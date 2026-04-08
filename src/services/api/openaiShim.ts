/**
 * OpenAI-compatible API shim for Claude Code.
 *
 * Translates Anthropic SDK calls (anthropic.beta.messages.create) into
 * OpenAI-compatible chat completion requests and streams back events
 * in the Anthropic streaming format so the rest of the codebase is unaware.
 *
 * Supports: OpenAI, Azure OpenAI, Ollama, LM Studio, OpenRouter,
 * Together, Groq, Fireworks, DeepSeek, Mistral, and any OpenAI-compatible API.
 *
 * Environment variables:
 *   CLAUDE_CODE_USE_OPENAI=1          — enable this provider
 *   OPENAI_API_KEY=sk-...             — API key (optional for local models)
 *   OPENAI_BASE_URL=http://...        — base URL (default: https://api.openai.com/v1)
 *   OPENAI_MODEL=gpt-4o              — default model override
 *   CODEX_API_KEY / ~/.codex/auth.json — Codex auth for codexplan/codexspark
 *
 * GitHub Copilot API (api.githubcopilot.com), OpenAI-compatible:
 *   CLAUDE_CODE_USE_GITHUB=1         — enable GitHub inference (no need for USE_OPENAI)
 *   GITHUB_TOKEN or GH_TOKEN         — Copilot API token (mapped to Bearer auth)
 *   OPENAI_MODEL                     — optional; use github:copilot or openai/gpt-4.1 style IDs
 */

import { APIError } from '@anthropic-ai/sdk'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { resolveGeminiCredential } from '../../utils/geminiAuth.js'
import { hydrateGeminiAccessTokenFromSecureStorage } from '../../utils/geminiCredentials.js'
import { hydrateGithubModelsTokenFromSecureStorage } from '../../utils/githubModelsCredentials.js'
import {
  codexStreamToAnthropic,
  collectCodexCompletedResponse,
  convertAnthropicMessagesToResponsesInput,
  convertCodexResponseToAnthropicMessage,
  convertToolsToResponsesTools,
  performCodexRequest,
  type AnthropicStreamEvent,
  type AnthropicUsage,
  type ShimCreateParams,
} from './codexShim.js'
import {
  isLocalProviderUrl,
  resolveCodexApiCredentials,
  resolveProviderRequest,
  getGithubEndpointType,
} from './providerConfig.js'
import { sanitizeSchemaForOpenAICompat } from '../../utils/schemaSanitizer.js'
import { redactSecretValueForDisplay } from '../../utils/providerProfile.js'
import {
  normalizeToolArguments,
  hasToolFieldMapping,
} from './toolArgumentNormalization.js'

type SecretValueSource = Partial<{
  OPENAI_API_KEY: string
  CODEX_API_KEY: string
  GEMINI_API_KEY: string
  GOOGLE_API_KEY: string
  GEMINI_ACCESS_TOKEN: string
}>

const GITHUB_COPILOT_BASE = 'https://api.githubcopilot.com'
const GITHUB_429_MAX_RETRIES = 3
const GITHUB_429_BASE_DELAY_SEC = 1
const GITHUB_429_MAX_DELAY_SEC = 32
const GEMINI_API_HOST = 'generativelanguage.googleapis.com'

const COPILOT_HEADERS: Record<string, string> = {
  'User-Agent': 'GitHubCopilotChat/0.26.7',
  'Editor-Version': 'vscode/1.99.3',
  'Editor-Plugin-Version': 'copilot-chat/0.26.7',
  'Copilot-Integration-Id': 'vscode-chat',
}

// Groq request compaction constants — calibrated for the free tier 6K TPM limit.
// Token estimate uses bytes/4 (conservative: 1 token ≈ 4 chars ≈ 4 bytes for English).
const GROQ_MAX_REQUEST_TOKENS = 6_000
const GROQ_TARGET_PROMPT_TOKENS = 3_500
const GROQ_COMPLETION_TOKEN_SAFETY_MARGIN = 500
const GROQ_TOKEN_ESTIMATE_DIVISOR = 4

function isGithubModelsMode(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
}

function hasGeminiApiHost(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false

  try {
    return new URL(baseUrl).hostname.toLowerCase() === GEMINI_API_HOST
  } catch {
    return false
  }
}

function isGroqBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return hostname === 'groq.com' || hostname.endsWith('.groq.com')
  } catch {
    return baseUrl.toLowerCase().includes('groq.com')
  }
}

function isCerebrasBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return hostname === 'api.cerebras.ai' || hostname.endsWith('.cerebras.ai')
  } catch {
    return baseUrl.toLowerCase().includes('cerebras.ai')
  }
}

/**
 * Recursively add `additionalProperties: false` to every object node in a
 * JSON Schema. Required by Cerebras strict mode (constrained decoding).
 * Also strips array keywords unsupported by constrained decoding engines
 * (minItems, maxItems, uniqueItems).
 */
function addAdditionalPropertiesFalse(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...schema }
  // Strip array-constraint keywords that constrained decoding engines reject
  if (out.type === 'array') {
    delete out.minItems
    delete out.maxItems
    delete out.uniqueItems
  }
  if (out.type === 'object' && !('additionalProperties' in out)) {
    out.additionalProperties = false
  }
  if (out.properties && typeof out.properties === 'object') {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(out.properties as Record<string, unknown>)) {
      props[k] = v && typeof v === 'object' && !Array.isArray(v)
        ? addAdditionalPropertiesFalse(v as Record<string, unknown>)
        : v
    }
    out.properties = props
  }
  if (out.items && typeof out.items === 'object' && !Array.isArray(out.items)) {
    out.items = addAdditionalPropertiesFalse(out.items as Record<string, unknown>)
  }
  return out
}

/**
 * Apply Cerebras strict mode to tool definitions:
 * - adds `strict: true` inside `function` (enables constrained decoding)
 * - recursively adds `additionalProperties: false` to all schema objects
 * This prevents malformed tool calls and saves tokens from retries.
 */
function applyStrictModeToTools(tools: OpenAITool[]): OpenAITool[] {
  return tools.map(tool => ({
    ...tool,
    function: {
      ...tool.function,
      strict: true,
      parameters: tool.function.parameters
        ? addAdditionalPropertiesFalse(tool.function.parameters as Record<string, unknown>)
        : { type: 'object', properties: {}, additionalProperties: false },
    },
  }))
}

// ---------------------------------------------------------------------------
// Open Tool Search — reverse-engineered lightweight tool discovery for 3P models
// ---------------------------------------------------------------------------

/**
 * Keep only the first sentence of a tool description (up to maxLen chars).
 * 235B models already know what Bash/Read/Write/etc. do by name.
 * The fat Anthropic descriptions (500–2000 words) waste tokens on 3P providers.
 */
function truncateToolDescription(text: string, maxLen = 200): string {
  if (!text || text.length <= maxLen) return text
  // Try to cut at a sentence boundary in a generous window
  const window = text.slice(0, maxLen + 80)
  const match = window.match(/^[\s\S]{30,}?[.!?](\s|\n|$)/)
  if (match && match[0].length <= maxLen + 20) return match[0].trim()
  // Fall back to word boundary
  return text.slice(0, maxLen).replace(/\s\S*$/, '') + '…'
}

/**
 * Strip description/title from parameter schemas while preserving structure.
 * Models still get type/required/properties/enum — enough to generate valid calls.
 */
function stripParamDescriptions(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema)) {
    // Only description/title at PROPERTY level (not top-level function description)
    if (k === 'description' || k === 'title') continue
    if (Array.isArray(v)) {
      out[k] = v.map(item =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? stripParamDescriptions(item as Record<string, unknown>)
          : item,
      )
    } else if (v && typeof v === 'object') {
      out[k] = stripParamDescriptions(v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * Minify tool schemas for 3P providers — dramatically reduces token usage:
 *   Bash:      11.4KB → ~0.4KB  (function desc truncated, param descs stripped)
 *   TodoWrite:  9.6KB → ~1.2KB
 *   Aggregate:   36KB → ~5KB    (before task selection)
 * The model name alone (Bash, Read, Write…) carries enough semantics for
 * a 235B model to select and call tools correctly.
 */
function minifyToolSchemas(tools: OpenAITool[]): OpenAITool[] {
  return tools.map(tool => ({
    ...tool,
    function: {
      ...tool.function,
      description: truncateToolDescription(tool.function.description),
      parameters: stripParamDescriptions(tool.function.parameters as Record<string, unknown>),
    },
  }))
}

/** One-line descriptions for the tool directory injected during phase-1 of ShimToolSearch */
const TOOL_DIRECTORY: Record<string, string> = {
  Bash:            'Execute shell commands (build, test, install, git, etc.)',
  Read:            'Read file contents',
  Write:           'Create or overwrite a file',
  Edit:            'Make targeted edits to an existing file',
  Glob:            'List files matching a pattern',
  Grep:            'Search file contents with regex',
  TodoWrite:       'Create/update structured task list',
  AskUserQuestion: 'Ask the user a clarifying question',
}

/** The single meta-tool sent during phase-1 of ShimToolSearch */
const REQUEST_TOOLS_SCHEMA: OpenAITool = {
  type: 'function',
  function: {
    name: 'request_tools',
    description: 'Request the full schema for one or more tools before using them. Call this first if you need to use any tools.',
    parameters: {
      type: 'object',
      properties: {
        tools: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['tools'],
    },
  },
}

/**
 * Keyword heuristics to predict which tools a request needs.
 * Returns a Set of tool names. An empty Set means "uncertain — send all tools".
 * This is conservative: false positives (sending extra tools) are fine;
 * false negatives (missing a needed tool) would break the task.
 */
function predictNeededTools(messages: unknown[]): Set<string> | null {
  // Extract the last genuine user query from messages.
  // Openclaude wraps user messages with <system-reminder> XML blocks;
  // strip those to get to the actual user text.
  function extractUserQuery(text: string): string {
    // Remove <system-reminder>...</system-reminder> blocks
    return text
      .replace(/<system-reminder[\s\S]*?<\/system-reminder>/gi, '')
      .replace(/<context[\s\S]*?<\/context>/gi, '')
      .trim()
  }

  let lastUserText = ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown }
    if (m.role !== 'user') continue
    let rawText = ''
    if (typeof m.content === 'string') {
      rawText = m.content
    } else if (Array.isArray(m.content)) {
      const parts = (m.content as Array<{ type?: string; text?: string }>)
        .filter(p => p.type === 'text')
        .map(p => p.text ?? '')
      rawText = parts.join(' ')
    }
    const clean = extractUserQuery(rawText)
    if (clean) {
      lastUserText = clean
      break
    }
  }
  if (!lastUserText) return null

  const t = lastUserText.toLowerCase()

  // Pure conversational / no-tools signals
  const isConversational = /^(what|who|why|how|when|where|explain|describe|tell me|is it|can you|do you|list|summarize|overview|difference between|compare|pros and cons)/.test(t.trim())
    && !/file|code|function|class|test|build|run|install|create|write|edit|implement|fix|debug/.test(t)

  if (isConversational) {
    // Might not need tools at all — phase-1 ShimToolSearch territory
    return new Set([])
  }

  const tools = new Set<string>()

  // Bash: execution, builds, tests, git, package management
  if (/\brun\b|\bexecut|\bbuild|\btest\b|\binstall\b|\bnpm\b|\bpip\b|\bgit\b|\bcompil|\bscript|\bdocker|\bpython\b|\bnode\b/.test(t)) tools.add('Bash')
  // Read: reading/showing file content
  if (/\bread\b|\bshow\b|\bcontent|\blook at|\bopen\b|\bcat\b|\bwhat is in|\bwhat does.*file/.test(t)) tools.add('Read')
  // Write: creating new files
  if (/\bcreate\b|\bwrite\b|\bnew file|\bgenerat|\bscaffold|\binitializ|\btouch\b/.test(t)) tools.add('Write')
  // Edit: modifying existing files
  if (/\bedit\b|\bmodif|\bchange\b|\bfix\b|\bupdat|\brefactor|\breplace|\bimpleme|\badd.*to\b|\bremove\b|\bdelet.*from/.test(t)) tools.add('Edit')
  // Grep: searching content
  if (/\bsearch\b|\bfind\b|\bgrep\b|\blook for\b|\bwhere is\b|\boccurrenc|\bwhich file/.test(t)) { tools.add('Grep'); tools.add('Glob') }
  // Glob: file listing
  if (/\blist.*file|\bfind.*file|\bfiles in|\bwhat files|\blist.*dir|\bls\b/.test(t)) tools.add('Glob')
  // TodoWrite: planning
  if (/\btodo\b|\bplan\b|\btask list|\btrack\b|\bprogress\b/.test(t)) tools.add('TodoWrite')

  // If it's an implementation task, assume the full write suite
  if (/\bimplement\b|\bbuild.*feature|\badd.*feature|\bwrite.*function|\bwrite.*class|\bcreate.*function|\bcreate.*class/.test(t)) {
    tools.add('Bash'); tools.add('Write'); tools.add('Edit'); tools.add('Read')
  }

  // Always add Bash and AskUserQuestion for implementation/coding tasks
  if (tools.has('Edit') || tools.has('Write')) {
    tools.add('Bash')
    tools.add('Read')
  }

  return tools.size > 0 ? tools : null  // null = uncertain, use all tools
}

function formatRetryAfterHint(response: Response): string {
  const ra = response.headers.get('retry-after')
  return ra ? ` (Retry-After: ${ra})` : ''
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Types — minimal subset of Anthropic SDK types we need to produce
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Message format conversion: Anthropic → OpenAI
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
    extra_content?: Record<string, unknown>
  }>
  tool_call_id?: string
  name?: string
}

interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
    strict?: boolean
  }
}

// ---------------------------------------------------------------------------
// Groq payload compaction helpers
// ---------------------------------------------------------------------------

function estimateJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

function estimateGroqPromptTokens(value: unknown): number {
  return Math.ceil(estimateJsonBytes(value) / GROQ_TOKEN_ESTIMATE_DIVISOR)
}

function stripSchemaAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => stripSchemaAnnotations(item))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const reduced: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(record)) {
    // Strip "description" only when it's a string annotation, not when it's
    // a parameter definition object (e.g. BashTool's "description" parameter).
    if (key === 'description' && typeof child === 'string') continue
    reduced[key] = stripSchemaAnnotations(child)
  }
  return reduced
}

function stripToolSchemaDescriptions(tools: OpenAITool[]): OpenAITool[] {
  return stripSchemaAnnotations(tools) as OpenAITool[]
}

function compactPayloadForGroq(body: Record<string, unknown>): void {
  let promptTokens = estimateGroqPromptTokens(body)
  if (promptTokens <= GROQ_TARGET_PROMPT_TOKENS) return

  if (Array.isArray(body.tools)) {
    body.tools = stripToolSchemaDescriptions(body.tools as OpenAITool[]) as typeof body.tools
    promptTokens = estimateGroqPromptTokens(body)
  }
  if (promptTokens <= GROQ_TARGET_PROMPT_TOKENS) return

  if (Array.isArray(body.messages)) {
    const messages = [
      ...(body.messages as Array<{ role?: string } & Record<string, unknown>>),
    ]

    while (promptTokens > GROQ_TARGET_PROMPT_TOKENS) {
      const firstNonSystemIndex = messages.findIndex(
        (message, index) =>
          message.role !== 'system' && index < messages.length - 1,
      )
      if (firstNonSystemIndex === -1) break

      messages.splice(firstNonSystemIndex, 1)
      body.messages = messages
      promptTokens = estimateGroqPromptTokens(body)
    }
  }
  if (promptTokens <= GROQ_TARGET_PROMPT_TOKENS) return

  if (body.tools) {
    delete body.tools
    body.tool_choice = 'none'
    promptTokens = estimateGroqPromptTokens(body)
  }
  if (promptTokens <= GROQ_TARGET_PROMPT_TOKENS) return

  if (Array.isArray(body.messages)) {
    const messages = body.messages as Array<
      { role?: string } & Record<string, unknown>
    >
    const lastUserMessage = [...messages]
      .reverse()
      .find(message => message.role === 'user')
    const lastMessage = lastUserMessage ?? messages[messages.length - 1]
    body.messages = lastMessage ? [lastMessage] : []
  }
}

function clampGroqMaxTokens(body: Record<string, unknown>): void {
  const currentMaxTokens =
    typeof body.max_tokens === 'number'
      ? body.max_tokens
      : typeof body.max_completion_tokens === 'number'
        ? body.max_completion_tokens
        : 4000

  const estimatedPromptTokens = estimateGroqPromptTokens(body)
  const availableCompletionTokens =
    GROQ_MAX_REQUEST_TOKENS -
    estimatedPromptTokens -
    GROQ_COMPLETION_TOKEN_SAFETY_MARGIN

  body.max_tokens = Math.min(currentMaxTokens, Math.max(1, availableCompletionTokens))
  delete body.max_completion_tokens
}

function convertSystemPrompt(
  system: unknown,
): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system
      .map((block: { type?: string; text?: string }) =>
        block.type === 'text' ? block.text ?? '' : '',
      )
      .join('\n\n')
  }
  return String(system)
}

function convertToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content ?? '')

  const chunks: string[] = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      chunks.push(block.text)
      continue
    }

    if (block?.type === 'image') {
      const source = block.source
      if (source?.type === 'url' && source.url) {
        chunks.push(`[Image](${source.url})`)
      } else if (source?.type === 'base64') {
        chunks.push(`[image:${source.media_type ?? 'unknown'}]`)
      } else {
        chunks.push('[image]')
      }
      continue
    }

    if (typeof block?.text === 'string') {
      chunks.push(block.text)
    }
  }

  return chunks.join('\n')
}

function convertContentBlocks(
  content: unknown,
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')

  const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push({ type: 'text', text: block.text ?? '' })
        break
      case 'image': {
        const src = block.source
        if (src?.type === 'base64') {
          parts.push({
            type: 'image_url',
            image_url: {
              url: `data:${src.media_type};base64,${src.data}`,
            },
          })
        } else if (src?.type === 'url') {
          parts.push({ type: 'image_url', image_url: { url: src.url } })
        }
        break
      }
      case 'tool_use':
        // handled separately
        break
      case 'tool_result':
        // handled separately
        break
      case 'thinking':
      case 'redacted_thinking':
        // Strip thinking blocks for OpenAI-compatible providers.
        // These are Anthropic-specific content types that 3P providers
        // don't understand. Serializing them as <thinking> text corrupts
        // multi-turn context: the model sees the tags as part of its
        // previous reply and may mimic or misattribute them.
        break
      default:
        if (block.text) {
          parts.push({ type: 'text', text: block.text })
        }
    }
  }

  if (parts.length === 0) return ''
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text ?? ''
  return parts
}

function isGeminiMode(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI) ||
    hasGeminiApiHost(process.env.OPENAI_BASE_URL)
  )
}

function convertMessages(
  messages: Array<{ role: string; message?: { role?: string; content?: unknown }; content?: unknown }>,
  system: unknown,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  // System message first
  const sysText = convertSystemPrompt(system)
  if (sysText) {
    result.push({ role: 'system', content: sysText })
  }

  for (const msg of messages) {
    // Claude Code wraps messages in { role, message: { role, content } }
    const inner = msg.message ?? msg
    const role = (inner as { role?: string }).role ?? msg.role
    const content = (inner as { content?: unknown }).content

    if (role === 'user') {
      // Check for tool_result blocks in user messages
      if (Array.isArray(content)) {
        const toolResults = content.filter((b: { type?: string }) => b.type === 'tool_result')
        const otherContent = content.filter((b: { type?: string }) => b.type !== 'tool_result')

        // Emit tool results as tool messages
        for (const tr of toolResults) {
          const trContent = convertToolResultContent(tr.content)
          result.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id ?? 'unknown',
            content: tr.is_error ? `Error: ${trContent}` : trContent,
          })
        }

        // Emit remaining user content
        if (otherContent.length > 0) {
          result.push({
            role: 'user',
            content: convertContentBlocks(otherContent),
          })
        }
      } else {
        result.push({
          role: 'user',
          content: convertContentBlocks(content),
        })
      }
    } else if (role === 'assistant') {
      // Check for tool_use blocks
      if (Array.isArray(content)) {
        const toolUses = content.filter((b: { type?: string }) => b.type === 'tool_use')
        const thinkingBlock = content.find((b: { type?: string }) => b.type === 'thinking')
        const textContent = content.filter(
          (b: { type?: string }) => b.type !== 'tool_use' && b.type !== 'thinking',
        )

        const assistantMsg: OpenAIMessage = {
          role: 'assistant',
          content: (() => {
            const c = convertContentBlocks(textContent)
            return typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p.text ?? '').join('') : ''
          })(),
        }

        if (toolUses.length > 0) {
          assistantMsg.tool_calls = toolUses.map(
            (tu: {
              id?: string
              name?: string
              input?: unknown
              extra_content?: Record<string, unknown>
              signature?: string
            }, index) => {
              const toolCall: NonNullable<OpenAIMessage['tool_calls']>[number] = {
                id: tu.id ?? `call_${crypto.randomUUID().replace(/-/g, '')}`,
                type: 'function' as const,
                function: {
                  name: tu.name ?? 'unknown',
                  arguments:
                    typeof tu.input === 'string'
                      ? tu.input
                      : JSON.stringify(tu.input ?? {}),
                },
              }

              // Preserve existing extra_content if present
              if (tu.extra_content) {
                toolCall.extra_content = { ...tu.extra_content }
              }

              // Handle Gemini thought_signature
              if (isGeminiMode()) {
                // If the model provided a signature in the tool_use block itself (e.g. from a previous Turn/Step)
                // Use thinkingBlock.signature for ALL tool calls in the same assistant turn if available.
                // The API requires the same signature on every replayed function call part in a parallel set.
                const signature = tu.signature ?? (thinkingBlock as any)?.signature

                // Merge into existing google-specific metadata if present
                const existingGoogle = (toolCall.extra_content?.google as Record<string, unknown>) ?? {}

                toolCall.extra_content = {
                  ...toolCall.extra_content,
                  google: {
                    ...existingGoogle,
                    thought_signature: signature ?? "skip_thought_signature_validator"
                  }
                }
              }

              return toolCall
            },
          )
        }

        result.push(assistantMsg)
      } else {
        result.push({
          role: 'assistant',
          content: (() => {
            const c = convertContentBlocks(content)
            return typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p.text ?? '').join('') : ''
          })(),
        })
      }
    }
  }

  // Coalescing pass: merge consecutive messages of the same role.
  // OpenAI/vLLM/Ollama require strict user↔assistant alternation.
  // Multiple consecutive tool messages are allowed (assistant → tool* → user).
  // Consecutive user or assistant messages must be merged to avoid Jinja
  // template errors like "roles must alternate" (Devstral, Mistral models).
  const coalesced: OpenAIMessage[] = []
  for (const msg of result) {
    const prev = coalesced[coalesced.length - 1]

    if (prev && prev.role === msg.role && msg.role !== 'tool' && msg.role !== 'system') {
      const prevContent = prev.content
      const curContent = msg.content

      if (typeof prevContent === 'string' && typeof curContent === 'string') {
        prev.content = prevContent + (prevContent && curContent ? '\n' : '') + curContent
      } else {
        const toArray = (
          c: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | undefined,
        ): Array<{ type: string; text?: string; image_url?: { url: string } }> => {
          if (!c) return []
          if (typeof c === 'string') return c ? [{ type: 'text', text: c }] : []
          return c
        }
        prev.content = [...toArray(prevContent), ...toArray(curContent)]
      }

      if (msg.tool_calls?.length) {
        prev.tool_calls = [...(prev.tool_calls ?? []), ...msg.tool_calls]
      }
    } else {
      coalesced.push(msg)
    }
  }

  return coalesced
}

/**
 * OpenAI requires every key in `properties` to also appear in `required`.
 * Anthropic schemas often mark fields as optional (omitted from `required`),
 * which causes 400 errors on OpenAI/Codex endpoints. This normalizes the
 * schema by ensuring `required` is a superset of `properties` keys.
 */
function normalizeSchemaForOpenAI(
  schema: Record<string, unknown>,
  strict = true,
): Record<string, unknown> {
  const record = sanitizeSchemaForOpenAICompat(schema)

  if (record.type === 'object' && record.properties) {
    const properties = record.properties as Record<string, Record<string, unknown>>
    const existingRequired = Array.isArray(record.required) ? record.required as string[] : []

    // Recurse into each property
    const normalizedProps: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(properties)) {
      normalizedProps[key] = normalizeSchemaForOpenAI(
        value as Record<string, unknown>,
        strict,
      )
    }
    record.properties = normalizedProps

    if (strict) {
      // Keep only the properties that were originally marked required in the schema.
      // Adding every property to required[] (the previous behaviour) caused strict
      // OpenAI-compatible providers (Groq, Azure, etc.) to reject tool calls because
      // the model correctly omits optional arguments — but the provider treats them
      // as missing required fields and returns a 400 / tool_use_failed error.
      record.required = existingRequired.filter(k => k in normalizedProps)
      // additionalProperties: false is still required by strict-mode providers.
      record.additionalProperties = false
    } else {
      // For Gemini: keep only existing required keys that are present in properties
      record.required = existingRequired.filter(k => k in normalizedProps)
    }
  }

  // Recurse into array items
  if ('items' in record) {
    if (Array.isArray(record.items)) {
      record.items = (record.items as unknown[]).map(
        item => normalizeSchemaForOpenAI(item as Record<string, unknown>, strict),
      )
    } else {
      record.items = normalizeSchemaForOpenAI(record.items as Record<string, unknown>, strict)
    }
  }

  // Recurse into combinators
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (key in record && Array.isArray(record[key])) {
      record[key] = (record[key] as unknown[]).map(
        item => normalizeSchemaForOpenAI(item as Record<string, unknown>, strict),
      )
    }
  }

  return record
}

function convertTools(
  tools: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>,
): OpenAITool[] {
  const isGemini = isGeminiMode()

  return tools
    .filter(t => t.name !== 'ToolSearchTool') // Not relevant for OpenAI
    .map(t => {
      const schema = { ...(t.input_schema ?? { type: 'object', properties: {} }) } as Record<string, unknown>

      // For Codex/OpenAI: promote known Agent sub-fields into required[] only if
      // they actually exist in properties (Gemini rejects required keys absent from properties).
      if (t.name === 'Agent' && schema.properties) {
        const props = schema.properties as Record<string, unknown>
        if (!Array.isArray(schema.required)) schema.required = []
        const req = schema.required as string[]
        for (const key of ['message', 'subagent_type']) {
          if (key in props && !req.includes(key)) req.push(key)
        }
      }

      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description ?? '',
          parameters: normalizeSchemaForOpenAI(schema, !isGemini),
        },
      }
    })
}

// ---------------------------------------------------------------------------
// Streaming: OpenAI SSE → Anthropic stream events
// ---------------------------------------------------------------------------

interface OpenAIStreamChunk {
  id: string
  object: string
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
        extra_content?: Record<string, unknown>
      }>
    }
    finish_reason: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: {
      cached_tokens?: number
    }
    completion_tokens_details?: {
      reasoning_tokens?: number
    }
  }
}

function makeMessageId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, '')}`
}

function convertChunkUsage(
  usage: OpenAIStreamChunk['usage'] | undefined,
): Partial<AnthropicUsage> | undefined {
  if (!usage) return undefined

  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
  }
}

const JSON_REPAIR_SUFFIXES = [
  '}', '"}', ']}', '"]}', '}}', '"}}', ']}}', '"]}}', '"]}]}', '}]}'
]

function repairPossiblyTruncatedObjectJson(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? raw
      : null
  } catch {
    for (const combo of JSON_REPAIR_SUFFIXES) {
      try {
        const repaired = raw + combo
        const parsed = JSON.parse(repaired)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return repaired
        }
      } catch {}
    }
    return null
  }
}

/**
 * Log per-call token breakdown to stderr for analysis.
 * Shows reasoning overhead, cache hits, and net-new tokens charged against quota.
 */
function logCallTokens(
  rawUsage: OpenAIStreamChunk['usage'] | undefined,
  model: string,
): void {
  if (!rawUsage) return
  const inp = rawUsage.prompt_tokens ?? 0
  const out = rawUsage.completion_tokens ?? 0
  const cached = rawUsage.prompt_tokens_details?.cached_tokens ?? 0
  const reasoning = rawUsage.completion_tokens_details?.reasoning_tokens ?? 0
  const total = rawUsage.total_tokens ?? (inp + out)
  const netNew = inp - cached
  process.stderr.write(
    `[TOKENS] model=${model} in=${inp} out=${out}` +
    (reasoning > 0 ? ` reason=${reasoning}` : '') +
    (cached > 0 ? ` cache_hit=${cached}` : '') +
    ` total=${total} net_new=${netNew}\n`,
  )
}

/**
 * Async generator that transforms an OpenAI SSE stream into
 * Anthropic-format BetaRawMessageStreamEvent objects.
 */
async function* openaiStreamToAnthropic(
  response: Response,
  model: string,
): AsyncGenerator<AnthropicStreamEvent> {
  const messageId = makeMessageId()
  let contentBlockIndex = 0
  const activeToolCalls = new Map<
    number,
    {
      id: string
      name: string
      index: number
      jsonBuffer: string
      normalizeAtStop: boolean
    }
  >()
  let hasEmittedContentStart = false
  let hasEmittedThinkingStart = false
  let hasClosedThinking = false
  let lastStopReason: 'tool_use' | 'max_tokens' | 'end_turn' | null = null
  let hasEmittedFinalUsage = false
  let hasProcessedFinishReason = false

  // Emit message_start
  yield {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }

  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]') continue
      if (!trimmed.startsWith('data: ')) continue

      let chunk: OpenAIStreamChunk
      try {
        chunk = JSON.parse(trimmed.slice(6))
      } catch {
        continue
      }

      const chunkUsage = convertChunkUsage(chunk.usage)

      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta

        // Reasoning models (e.g. GLM-5, DeepSeek) may stream chain-of-thought
        // in `reasoning_content` before the actual reply appears in `content`.
        // Emit reasoning as a thinking block and content as a text block.
        if (delta.reasoning_content != null && delta.reasoning_content !== '') {
          if (!hasEmittedThinkingStart) {
            yield {
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: { type: 'thinking', thinking: '' },
            }
            hasEmittedThinkingStart = true
          }
          yield {
            type: 'content_block_delta',
            index: contentBlockIndex,
            delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
          }
        }

        // Text content — use != null to distinguish absent field from empty string,
        // some providers send "" as first delta to signal streaming start
        if (delta.content != null && delta.content !== '') {
          // Close thinking block if transitioning from reasoning to content
          if (hasEmittedThinkingStart && !hasClosedThinking) {
            yield { type: 'content_block_stop', index: contentBlockIndex }
            contentBlockIndex++
            hasClosedThinking = true
          }
          if (!hasEmittedContentStart) {
            yield {
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: { type: 'text', text: '' },
            }
            hasEmittedContentStart = true
          }
          yield {
            type: 'content_block_delta',
            index: contentBlockIndex,
            delta: { type: 'text_delta', text: delta.content },
          }
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id && tc.function?.name) {
              // New tool call starting — close any open thinking block first
              if (hasEmittedThinkingStart && !hasClosedThinking) {
                yield { type: 'content_block_stop', index: contentBlockIndex }
                contentBlockIndex++
                hasClosedThinking = true
              }
              if (hasEmittedContentStart) {
                yield {
                  type: 'content_block_stop',
                  index: contentBlockIndex,
                }
                contentBlockIndex++
                hasEmittedContentStart = false
              }

              const toolBlockIndex = contentBlockIndex
              const initialArguments = tc.function.arguments ?? ''
              const normalizeAtStop = hasToolFieldMapping(tc.function.name)
              activeToolCalls.set(tc.index, {
                id: tc.id,
                name: tc.function.name,
                index: toolBlockIndex,
                jsonBuffer: initialArguments,
                normalizeAtStop,
              })

              yield {
                type: 'content_block_start',
                index: toolBlockIndex,
                content_block: {
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.function.name,
                  input: {},
                  ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
                  // Extract Gemini signature from extra_content
                  ...((tc.extra_content?.google as any)?.thought_signature
                    ? {
                        signature: (tc.extra_content.google as any)
                          .thought_signature,
                      }
                    : {}),
                },
              }
              contentBlockIndex++

              // Emit any initial arguments
              if (tc.function.arguments && !normalizeAtStop) {
                yield {
                  type: 'content_block_delta',
                  index: toolBlockIndex,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: tc.function.arguments,
                  },
                }
              }
            } else if (tc.function?.arguments) {
              // Continuation of existing tool call
              const active = activeToolCalls.get(tc.index)
              if (active) {
                if (tc.function.arguments) {
                  active.jsonBuffer += tc.function.arguments
                }

                if (active.normalizeAtStop) {
                  continue
                }

                yield {
                  type: 'content_block_delta',
                  index: active.index,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: tc.function.arguments,
                  },
                }
              }
            }
          }
        }

        // Finish — guard ensures we only process finish_reason once even if
        // multiple chunks arrive with finish_reason set (some providers do this)
        if (choice.finish_reason && !hasProcessedFinishReason) {
          hasProcessedFinishReason = true

          // Close any open thinking block that wasn't closed by content transition
          if (hasEmittedThinkingStart && !hasClosedThinking) {
            yield { type: 'content_block_stop', index: contentBlockIndex }
            contentBlockIndex++
            hasClosedThinking = true
          }
          // Close any open content blocks
          if (hasEmittedContentStart) {
            yield {
              type: 'content_block_stop',
              index: contentBlockIndex,
            }
          }
          // Close active tool calls
          for (const [, tc] of activeToolCalls) {
            if (tc.normalizeAtStop) {
              let partialJson: string
              if (choice.finish_reason === 'length') {
                // Truncated by max tokens — preserve raw buffer to avoid
                // turning an incomplete tool call into an executable command
                partialJson = tc.jsonBuffer
              } else {
                const repairedStructuredJson = repairPossiblyTruncatedObjectJson(
                  tc.jsonBuffer,
                )
                if (repairedStructuredJson) {
                  partialJson = repairedStructuredJson
                } else {
                  partialJson = JSON.stringify(
                    normalizeToolArguments(tc.name, tc.jsonBuffer),
                  )
                }
              }

              yield {
                type: 'content_block_delta',
                index: tc.index,
                delta: {
                  type: 'input_json_delta',
                  partial_json: partialJson,
                },
              }
              yield { type: 'content_block_stop', index: tc.index }
              continue
            }

            let suffixToAdd = ''
            if (tc.jsonBuffer) {
              try {
                JSON.parse(tc.jsonBuffer)
              } catch {
                const str = tc.jsonBuffer.trimEnd()
                for (const combo of JSON_REPAIR_SUFFIXES) {
                  try {
                    JSON.parse(str + combo)
                    suffixToAdd = combo
                    break
                  } catch {}
                }
              }
            }

            if (suffixToAdd) {
              yield {
                type: 'content_block_delta',
                index: tc.index,
                delta: {
                  type: 'input_json_delta',
                  partial_json: suffixToAdd,
                },
              }
            }

            yield { type: 'content_block_stop', index: tc.index }
          }

          const stopReason =
            choice.finish_reason === 'tool_calls'
              ? 'tool_use'
              : choice.finish_reason === 'length'
                ? 'max_tokens'
                : 'end_turn'
          if (choice.finish_reason === 'content_filter' || choice.finish_reason === 'safety') {
            // Gemini/Azure content safety filter blocked the response.
            // Emit a visible text block so the user knows why output was truncated.
            if (!hasEmittedContentStart) {
              yield {
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: { type: 'text', text: '' },
              }
              hasEmittedContentStart = true
            }
            yield {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: { type: 'text_delta', text: '\n\n[Content blocked by provider safety filter]' },
            }
          }
          lastStopReason = stopReason

          yield {
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            ...(chunkUsage ? { usage: chunkUsage } : {}),
          }
          if (chunkUsage) {
            logCallTokens(chunk.usage, model)
            hasEmittedFinalUsage = true
          }
        }
      }

      if (
        !hasEmittedFinalUsage &&
        chunkUsage &&
        (chunk.choices?.length ?? 0) === 0 &&
        lastStopReason !== null
      ) {
        yield {
          type: 'message_delta',
          delta: { stop_reason: lastStopReason, stop_sequence: null },
          usage: chunkUsage,
        }
        logCallTokens(chunk.usage, model)
        hasEmittedFinalUsage = true
      }
    }
    }
  } finally {
    reader.releaseLock()
  }

  yield { type: 'message_stop' }
}

// ---------------------------------------------------------------------------
// The shim client — duck-types as Anthropic SDK
// ---------------------------------------------------------------------------

class OpenAIShimStream {
  private generator: AsyncGenerator<AnthropicStreamEvent>
  // The controller property is checked by claude.ts to distinguish streams from error messages
  controller = new AbortController()

  constructor(generator: AsyncGenerator<AnthropicStreamEvent>) {
    this.generator = generator
  }

  async *[Symbol.asyncIterator]() {
    yield* this.generator
  }
}

class OpenAIShimMessages {
  private defaultHeaders: Record<string, string>
  private reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  private providerOverride?: { model: string; baseURL: string; apiKey: string }

  constructor(defaultHeaders: Record<string, string>, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh', providerOverride?: { model: string; baseURL: string; apiKey: string }) {
    this.defaultHeaders = defaultHeaders
    this.reasoningEffort = reasoningEffort
    this.providerOverride = providerOverride
  }

  create(
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    const self = this

    let httpResponse: Response | undefined

    const promise = (async () => {
      const request = resolveProviderRequest({ model: self.providerOverride?.model ?? params.model, baseUrl: self.providerOverride?.baseURL, reasoningEffortOverride: self.reasoningEffort })

      // ---------------------------------------------------------------------------
      // ShimToolSearch: two-phase protocol for Cerebras (our open tool_reference)
      // When heuristic detects a conversational/no-tool turn, skip all tool schemas
      // on the first call. The model may answer directly (saving ~8K tokens) or
      // call request_tools([...]) to declare what it needs, then we inject only
      // those schemas and re-invoke.
      // ---------------------------------------------------------------------------
      if (
        isCerebrasBaseUrl(request.baseUrl) &&
        params.tools && (params.tools as unknown[]).length > 0
      ) {
        const msgs = Array.isArray(params.messages) ? params.messages as unknown[] : []
        const predicted = predictNeededTools(msgs)
        // predicted empty set = confident no-tool turn → use two-phase protocol
        if (predicted !== null && predicted.size === 0) {
          return await self._shimToolSearchCreate(request, params, options)
        }
      }

      const response = await self._doRequest(request, params, options)
      httpResponse = response

      if (params.stream) {
        const isResponsesStream = response.url?.includes('/responses')
        return new OpenAIShimStream(
          (request.transport === 'codex_responses' || isResponsesStream)
            ? codexStreamToAnthropic(response, request.resolvedModel)
            : openaiStreamToAnthropic(response, request.resolvedModel),
        )
      }

      if (request.transport === 'codex_responses') {
        const data = await collectCodexCompletedResponse(response)
        return convertCodexResponseToAnthropicMessage(
          data,
          request.resolvedModel,
        )
      }

      const isResponsesNonStream = response.url?.includes('/responses')
      if (isResponsesNonStream || (request.transport === 'chat_completions' && isGithubModelsMode())) {
        const contentType = response.headers.get('content-type') ?? ''
        if (contentType.includes('application/json')) {
          const parsed = await response.json() as Record<string, unknown>
          if (
            parsed &&
            typeof parsed === 'object' &&
            ('output' in parsed || 'incomplete_details' in parsed)
          ) {
            return convertCodexResponseToAnthropicMessage(
              parsed,
              request.resolvedModel,
            )
          }
          return self._convertNonStreamingResponse(parsed, request.resolvedModel)
        }
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const data = await response.json()
        return self._convertNonStreamingResponse(data, request.resolvedModel)
      }

      const textBody = await response.text().catch(() => '')
      throw APIError.generate(
        response.status,
        undefined,
        `OpenAI API error ${response.status}: unexpected response: ${textBody.slice(0, 500)}`,
        response.headers as unknown as Headers,
      )
    })()

      ; (promise as unknown as Record<string, unknown>).withResponse =
        async () => {
          const data = await promise
          return {
            data,
            response: httpResponse ?? new Response(),
            request_id:
              httpResponse?.headers.get('x-request-id') ?? makeMessageId(),
          }
        }

    return promise
  }

  private async _shimToolSearchCreate(
    request: ReturnType<typeof resolveProviderRequest>,
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    // Build a compact tool directory to inject into the system prompt
    const allToolNames = (
      params.tools as Array<{ name: string; description?: string }> ?? []
    )
      .filter(t => t.name in TOOL_DIRECTORY)
      .map(t => `- ${t.name}: ${TOOL_DIRECTORY[t.name] ?? ''}`)
      .join('\n')

    // Phase-1 params: replace full tools with single meta-tool + tool directory
    const phase1Params: ShimCreateParams = {
      ...params,
      stream: false, // collect fully to check for request_tools call
      tools: [{ name: REQUEST_TOOLS_SCHEMA.function.name, description: REQUEST_TOOLS_SCHEMA.function.description, input_schema: REQUEST_TOOLS_SCHEMA.function.parameters as Record<string,unknown> }] as unknown as typeof params.tools,
      system: (() => {
        const base = typeof params.system === 'string'
          ? params.system
          : Array.isArray(params.system)
            ? (params.system as Array<{ type?: string; text?: string }>)
                .filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
            : ''
        return base + `\n\nAvailable tools (call request_tools first to load schemas before using any tool):\n${allToolNames}`
      })(),
    }

    process.stderr.write('[ShimToolSearch] phase-1: no tool schemas sent\n')
    const phase1Response = await this._doOpenAIRequest(request, phase1Params, options)
    const phase1Data = await phase1Response.json() as {
      id?: string; model?: string
      choices?: Array<{
        message?: {
          content?: string | null
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
        }
        finish_reason?: string
      }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }

    logCallTokens(phase1Data.usage as OpenAIStreamChunk['usage'] | undefined, phase1Data.model ?? request.resolvedModel)

    const toolCall = phase1Data.choices?.[0]?.message?.tool_calls?.find(
      tc => tc.function.name === 'request_tools',
    )

    if (!toolCall) {
      // Model answered directly — no tools needed this turn
      process.stderr.write('[ShimToolSearch] phase-1 answered directly (0 tool tokens charged)\n')
      const result = this._convertNonStreamingResponse(phase1Data, request.resolvedModel)
      if (params.stream) {
        // Wrap as synthetic stream so caller gets what it expects
        return new OpenAIShimStream(this._syntheticStream(result))
      }
      return result
    }

    // Model requested specific tools
    let requestedNames: string[] = []
    try { requestedNames = JSON.parse(toolCall.function.arguments).tools ?? [] } catch { /**/ }
    // Fallback: if parse failed or returned empty, send all essential tools
    if (requestedNames.length === 0) {
      requestedNames = Object.keys(TOOL_DIRECTORY)
    }

    // Phase-2: re-invoke with only the requested tool schemas
    const phase2Params: ShimCreateParams = {
      ...params, // restore original params (stream, etc.)
      tools: (params.tools as Array<{ name: string; description?: string; input_schema?: Record<string,unknown> }>)
        .filter(t => requestedNames.includes(t.name)) as unknown as typeof params.tools,
      // Append tool call + result to messages so model knows tools are now loaded
      messages: [
        ...params.messages,
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: toolCall.id, name: 'request_tools', input: { tools: requestedNames } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: 'Tool schemas loaded. You may now call the requested tools.' }],
        },
      ],
    }

    const phase2Response = await this._doRequest(request, phase2Params, options)
    if (params.stream) {
      return new OpenAIShimStream(openaiStreamToAnthropic(phase2Response, request.resolvedModel))
    }
    const data2 = await phase2Response.json()
    return this._convertNonStreamingResponse(data2, request.resolvedModel)
  }

  private async *_syntheticStream(msg: ReturnType<OpenAIShimMessages['_convertNonStreamingResponse']>): AsyncGenerator<AnthropicStreamEvent> {
    yield { type: 'message_start', message: { id: msg.id, type: 'message', role: 'assistant', content: [], model: msg.model, stop_reason: null, stop_sequence: null, usage: msg.usage } }
    let blockIdx = 0
    for (const block of msg.content) {
      yield { type: 'content_block_start', index: blockIdx, content_block: block as { type: string; text: string } }
      if (block.type === 'text') {
        yield { type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: (block as { text: string }).text } }
      }
      yield { type: 'content_block_stop', index: blockIdx }
      blockIdx++
    }
    yield { type: 'message_delta', delta: { stop_reason: msg.stop_reason as 'end_turn', stop_sequence: null }, usage: msg.usage }
    yield { type: 'message_stop' }
  }

  private async _doRequest(
    request: ReturnType<typeof resolveProviderRequest>,
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<Response> {
    const githubEndpointType = getGithubEndpointType(request.baseUrl)
    const isGithubMode = isGithubModelsMode()
    const isGithubWithCodexTransport = isGithubMode && request.transport === 'codex_responses'
    const isGithubCopilotEndpoint = isGithubMode && githubEndpointType === 'copilot'

    if (isGithubWithCodexTransport) {
      const apiKey = this.providerOverride?.apiKey ?? process.env.OPENAI_API_KEY ?? ''
      if (!apiKey) {
        throw new Error(
          'GitHub Copilot auth is required. Run /onboard-github to sign in.',
        )
      }

      return performCodexRequest({
        request,
        credentials: {
          apiKey,
          source: 'env',
        },
        params,
        defaultHeaders: {
          ...this.defaultHeaders,
          ...(options?.headers ?? {}),
          ...COPILOT_HEADERS,
        },
        signal: options?.signal,
      })
    }

    if (request.transport === 'codex_responses' && !isGithubMode) {
      const credentials = resolveCodexApiCredentials()
      if (!credentials.apiKey) {
        const authHint = credentials.authPath
          ? ` or place a Codex auth.json at ${credentials.authPath}`
          : ''
        const safeModel =
          redactSecretValueForDisplay(request.requestedModel, process.env as SecretValueSource) ??
          'the requested model'
        throw new Error(
          `Codex auth is required for ${safeModel}. Set CODEX_API_KEY${authHint}.`,
        )
      }
      if (!credentials.accountId) {
        throw new Error(
          'Codex auth is missing chatgpt_account_id. Re-login with the Codex CLI or set CHATGPT_ACCOUNT_ID/CODEX_ACCOUNT_ID.',
        )
      }

      return performCodexRequest({
        request,
        credentials,
        params,
        defaultHeaders: {
          ...this.defaultHeaders,
          ...(options?.headers ?? {}),
        },
        signal: options?.signal,
      })
    }

    return this._doOpenAIRequest(request, params, options)
  }

  private async _doOpenAIRequest(
    request: ReturnType<typeof resolveProviderRequest>,
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<Response> {
    const openaiMessages = convertMessages(
      params.messages as Array<{
        role: string
        message?: { role?: string; content?: unknown }
        content?: unknown
      }>,
      params.system,
    )

    const body: Record<string, unknown> = {
      model: request.resolvedModel,
      messages: openaiMessages,
      stream: params.stream ?? false,
    }
    // Convert max_tokens to max_completion_tokens for OpenAI API compatibility.
    // Azure OpenAI requires max_completion_tokens and does not accept max_tokens.
    // Ensure max_tokens is a valid positive number before using it.
    const maxTokensValue = typeof params.max_tokens === 'number' && params.max_tokens > 0
      ? params.max_tokens
      : undefined
    const maxCompletionTokensValue = typeof (params as Record<string, unknown>).max_completion_tokens === 'number'
      ? (params as Record<string, unknown>).max_completion_tokens as number
      : undefined

    if (maxTokensValue !== undefined) {
      body.max_completion_tokens = maxTokensValue
    } else if (maxCompletionTokensValue !== undefined) {
      body.max_completion_tokens = maxCompletionTokensValue
    }

    if (params.stream && !isLocalProviderUrl(request.baseUrl)) {
      body.stream_options = { include_usage: true }
    }

    const isGithub = isGithubModelsMode()
    const githubEndpointType = getGithubEndpointType(request.baseUrl)
    const isGithubCopilot = isGithub && githubEndpointType === 'copilot'
    const isGithubModels = isGithub && (githubEndpointType === 'models' || githubEndpointType === 'custom')

    if (isGithub && body.max_completion_tokens !== undefined) {
      body.max_tokens = body.max_completion_tokens
      delete body.max_completion_tokens
    }

    if (params.temperature !== undefined) body.temperature = params.temperature
    if (params.top_p !== undefined) body.top_p = params.top_p

    if (params.tools && params.tools.length > 0) {
      const converted = convertTools(
        params.tools as Array<{
          name: string
          description?: string
          input_schema?: Record<string, unknown>
        }>,
      )
      if (converted.length > 0) {
        // For 3P providers (Groq, DeepSeek, etc.), limit tools to essential ones.
        // Full tool set (~50 tools) can exceed 100KB and triggers 413 errors on
        // free-tier providers with limited context/rate budgets (e.g. Groq 6K TPM).
        const ESSENTIAL_TOOLS = new Set([
          'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
          'TodoWrite', 'AskUserQuestion', 'Agent',
        ])
        const isOpenAIShim = isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI) || isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI)
        if (isOpenAIShim) {
          const essentialOnly = converted.filter(t => ESSENTIAL_TOOLS.has(t.function.name))
          let toolSet = essentialOnly.length > 0 ? essentialOnly : converted

          // Task-aware tool selection: narrow down further based on the user message.
          // Conservative — only filter when we're confident; default to all essential tools.
          if (isCerebrasBaseUrl(request.baseUrl)) {
            const predicted = predictNeededTools(
              Array.isArray(body.messages) ? body.messages as unknown[] : [],
            )
            if (predicted && predicted.size > 0) {
              const narrowed = toolSet.filter(t => predicted.has(t.function.name))
              // Always include AskUserQuestion for clarifications
              const askTool = toolSet.find(t => t.function.name === 'AskUserQuestion')
              if (askTool && !narrowed.find(t => t.function.name === 'AskUserQuestion')) narrowed.push(askTool)
              if (narrowed.length > 0 && narrowed.length < toolSet.length) toolSet = narrowed
            }
            // Minify tool schemas: truncate description + strip param descriptions
            toolSet = minifyToolSchemas(toolSet)
          }

          body.tools = toolSet
        } else {
          body.tools = converted
        }
        if (params.tool_choice) {
          const tc = params.tool_choice as { type?: string; name?: string }
          if (tc.type === 'auto') {
            body.tool_choice = 'auto'
          } else if (tc.type === 'tool' && tc.name) {
            body.tool_choice = {
              type: 'function',
              function: { name: tc.name },
            }
          } else if (tc.type === 'any') {
            body.tool_choice = 'required'
          } else if (tc.type === 'none') {
            body.tool_choice = 'none'
          }
        }
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.defaultHeaders,
      ...(options?.headers ?? {}),
    }

    const isGemini = isGeminiMode()
    const apiKey =
      this.providerOverride?.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    // Detect Azure endpoints by hostname (not raw URL) to prevent bypass via
    // path segments like https://evil.com/cognitiveservices.azure.com/
    let isAzure = false
    try {
      const { hostname } = new URL(request.baseUrl)
      isAzure = hostname.endsWith('.azure.com') &&
        (hostname.includes('cognitiveservices') || hostname.includes('openai') || hostname.includes('services.ai'))
    } catch { /* malformed URL — not Azure */ }

    if (apiKey) {
      if (isAzure) {
        // Azure uses api-key header instead of Bearer token
        headers['api-key'] = apiKey
      } else {
        headers.Authorization = `Bearer ${apiKey}`
      }
    } else if (isGemini) {
      const geminiCredential = await resolveGeminiCredential(process.env)
      if (geminiCredential.kind !== 'none') {
        headers.Authorization = `Bearer ${geminiCredential.credential}`
        if (geminiCredential.kind !== 'api-key' && 'projectId' in geminiCredential && geminiCredential.projectId) {
          headers['x-goog-user-project'] = geminiCredential.projectId
        }
      }
    }

    if (isGithubCopilot) {
      Object.assign(headers, COPILOT_HEADERS)
    } else if (isGithubModels) {
      headers['Accept'] = 'application/vnd.github+json'
      headers['X-GitHub-Api-Version'] = '2022-11-28'
    }

    // OpenRouter requires HTTP-Referer header
    const isOpenRouter = request.baseUrl.includes('openrouter.ai')
    if (isOpenRouter) {
      headers['HTTP-Referer'] = 'https://openrouter.ai/'
      headers['X-Title'] = 'OpenClaude'
    }

    // Build the chat completions URL
    // Azure Cognitive Services / Azure OpenAI require a deployment-specific path
    // and an api-version query parameter.
    // Standard format: {base}/openai/deployments/{model}/chat/completions?api-version={version}
    // Non-Azure: {base}/chat/completions
    let chatCompletionsUrl: string
    if (isAzure) {
      const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-12-01-preview'
      const deployment = request.resolvedModel ?? process.env.OPENAI_MODEL ?? 'gpt-4o'
      // If base URL already contains /deployments/, use it as-is with api-version
      if (/\/deployments\//i.test(request.baseUrl)) {
        const base = request.baseUrl.replace(/\/+$/, '')
        chatCompletionsUrl = `${base}/chat/completions?api-version=${apiVersion}`
      } else {
        // Strip trailing /v1 or /openai/v1 if present, then build Azure path
        const base = request.baseUrl.replace(/\/(openai\/)?v1\/?$/, '').replace(/\/+$/, '')
        chatCompletionsUrl = `${base}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`
      }
    } else {
      chatCompletionsUrl = `${request.baseUrl}/chat/completions`
    }

    if (isGroqBaseUrl(request.baseUrl)) {
      delete body.stream_options
      compactPayloadForGroq(body)
      clampGroqMaxTokens(body)
      // Apply strict mode on remaining tools after compaction (constrained decoding)
      if (Array.isArray(body.tools)) {
        body.tools = applyStrictModeToTools(body.tools as OpenAITool[])
      }
    }

    if (isCerebrasBaseUrl(request.baseUrl)) {
      const model = (body.model as string | undefined) ?? ''
      // Strict mode (constrained decoding) only for models that support it.
      // gpt-oss-120b and zai-glm-4.7 use constrained decoding; qwen uses standard sampling.
      const supportsStrictMode = model.includes('gpt-oss') || model.includes('glm')
      if (supportsStrictMode && Array.isArray(body.tools)) {
        body.tools = applyStrictModeToTools(body.tools as OpenAITool[])
      }
      // reasoning_effort: gpt-oss-120b and zai-glm-4.7 only.
      // qwen-3-235b does NOT support this parameter (returns 422).
      const reasoningEffort = process.env.CEREBRAS_REASONING_EFFORT ?? 'medium'
      if (supportsStrictMode) {
        body.reasoning_effort = reasoningEffort
      }
    }

    const bodyStr = JSON.stringify(body)
    const bodySizeKB = Math.round(bodyStr.length / 1024)
    const toolCount = Array.isArray((body as Record<string,unknown>).tools) ? ((body as Record<string,unknown>).tools as unknown[]).length : 0
    process.stderr.write(`[DEBUG] Request payload: ${bodySizeKB}KB, ${toolCount} tools\n`)
    if (Array.isArray((body as Record<string,unknown>).tools) && process.env.DUMP_TOOLS) {
      const tools = (body as Record<string,unknown>).tools as OpenAITool[]
      for (const t of tools) {
        const sz = Math.round(JSON.stringify(t).length / 1024 * 10) / 10
        process.stderr.write(`[DEBUG]   tool ${t.function.name}: ${sz}KB\n`)
      }
    }
    if (bodySizeKB > 5000 &&
        isEnvTruthy(process.env.OPENAI_SHIM_DEBUG_LARGE_REQUESTS)) {
      const messages = (body as Record<string,unknown>).messages
      const messageCount = Array.isArray(messages) ? messages.length : 0
      const messagesSizeKB = messages === undefined
        ? 0
        : Math.round(JSON.stringify(messages).length / 1024)
      process.stderr.write(
        `[DEBUG] LARGE REQUEST — payload: ${bodySizeKB}KB, messages: ${messageCount}, messagesSize: ${messagesSizeKB}KB\n`,
      )
    }

    const fetchInit = {
      method: 'POST' as const,
      headers,
      body: bodyStr,
      signal: options?.signal,
    }

    const maxAttempts = isGithub ? GITHUB_429_MAX_RETRIES : 1
    let response: Response | undefined
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      response = await fetch(chatCompletionsUrl, fetchInit)
      if (response.ok) {
        return response
      }
      if (
        isGithub &&
        response.status === 429 &&
        attempt < maxAttempts - 1
      ) {
        await response.text().catch(() => {})
        const delaySec = Math.min(
          GITHUB_429_BASE_DELAY_SEC * 2 ** attempt,
          GITHUB_429_MAX_DELAY_SEC,
        )
        await sleepMs(delaySec * 1000)
        continue
      }
      // Read body exactly once here — Response body is a stream that can only
      // be consumed a single time.
      const errorBody = await response.text().catch(() => 'unknown error')
      const rateHint =
        isGithub && response.status === 429 ? formatRetryAfterHint(response) : ''

      // If GitHub Copilot returns error about /chat/completions,
      // try the /responses endpoint (needed for GPT-5+ models)
      if (isGithub && response.status === 400) {
        if (errorBody.includes('/chat/completions') || errorBody.includes('not accessible')) {
          const responsesUrl = `${request.baseUrl}/responses`
          const responsesBody: Record<string, unknown> = {
            model: request.resolvedModel,
            input: convertAnthropicMessagesToResponsesInput(
              params.messages as Array<{
                role?: string
                message?: { role?: string; content?: unknown }
                content?: unknown
              }>,
            ),
            stream: params.stream ?? false,
          }

          if (!Array.isArray(responsesBody.input) || responsesBody.input.length === 0) {
            responsesBody.input = [
              {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: '' }],
              },
            ]
          }

          const systemText = convertSystemPrompt(params.system)
          if (systemText) {
            responsesBody.instructions = systemText
          }

          if (body.max_tokens !== undefined) {
            responsesBody.max_output_tokens = body.max_tokens
          }

          if (params.tools && params.tools.length > 0) {
            const convertedTools = convertToolsToResponsesTools(
              params.tools as Array<{
                name?: string
                description?: string
                input_schema?: Record<string, unknown>
              }>,
            )
            if (convertedTools.length > 0) {
              responsesBody.tools = convertedTools
            }
          }

          const responsesResponse = await fetch(responsesUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(responsesBody),
            signal: options?.signal,
          })
          if (responsesResponse.ok) {
            return responsesResponse
          }
          const responsesErrorBody = await responsesResponse.text().catch(() => 'unknown error')
          let responsesErrorResponse: object | undefined
          try { responsesErrorResponse = JSON.parse(responsesErrorBody) } catch { /* raw text */ }
          throw APIError.generate(
            responsesResponse.status,
            responsesErrorResponse,
            `OpenAI API error ${responsesResponse.status}: ${responsesErrorBody}`,
            responsesResponse.headers,
          )
        }
      }

      let errorResponse: object | undefined
      try { errorResponse = JSON.parse(errorBody) } catch { /* raw text */ }
      throw APIError.generate(
        response.status,
        errorResponse,
        `OpenAI API error ${response.status}: ${errorBody}${rateHint}`,
        response.headers as unknown as Headers,
      )
    }

    throw APIError.generate(
      500, undefined, 'OpenAI shim: request loop exited unexpectedly',
      new Headers(),
    )
  }

  private _convertNonStreamingResponse(
    data: {
      id?: string
      model?: string
      choices?: Array<{
        message?: {
          role?: string
          content?:
            | string
            | null
            | Array<{ type?: string; text?: string }>
          reasoning_content?: string | null
          tool_calls?: Array<{
            id: string
            function: { name: string; arguments: string }
            extra_content?: Record<string, unknown>
          }>
        }
        finish_reason?: string
      }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        prompt_tokens_details?: {
          cached_tokens?: number
        }
        completion_tokens_details?: {
          reasoning_tokens?: number
        }
      }
    },
    model: string,
  ) {
    const choice = data.choices?.[0]
    const content: Array<Record<string, unknown>> = []

    // Some reasoning models (e.g. GLM-5) put their reply in reasoning_content
    // while content stays null — emit reasoning as a thinking block, then
    // fall back to it for visible text if content is empty.
    const reasoningText = choice?.message?.reasoning_content
    if (typeof reasoningText === 'string' && reasoningText) {
      content.push({ type: 'thinking', thinking: reasoningText })
    }
    const rawContent =
      choice?.message?.content !== '' && choice?.message?.content != null
        ? choice?.message?.content
        : choice?.message?.reasoning_content
    if (typeof rawContent === 'string' && rawContent) {
      content.push({ type: 'text', text: rawContent })
    } else if (Array.isArray(rawContent) && rawContent.length > 0) {
      const parts: string[] = []
      for (const part of rawContent) {
        if (
          part &&
          typeof part === 'object' &&
          part.type === 'text' &&
          typeof part.text === 'string'
        ) {
          parts.push(part.text)
        }
      }
      const joined = parts.join('\n')
      if (joined) {
        content.push({ type: 'text', text: joined })
      }
    }

    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        const input = normalizeToolArguments(
          tc.function.name,
          tc.function.arguments,
        )
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
          ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
          // Extract Gemini signature from extra_content
          ...((tc.extra_content?.google as any)?.thought_signature
            ? { signature: (tc.extra_content.google as any).thought_signature }
            : {}),
        })
      }
    }

    const stopReason =
      choice?.finish_reason === 'tool_calls'
        ? 'tool_use'
        : choice?.finish_reason === 'length'
          ? 'max_tokens'
          : 'end_turn'

    if (choice?.finish_reason === 'content_filter' || choice?.finish_reason === 'safety') {
      content.push({
        type: 'text',
        text: '\n\n[Content blocked by provider safety filter]',
      })
    }

    logCallTokens(data.usage as OpenAIStreamChunk['usage'] | undefined, data.model ?? model)
    return {
      id: data.id ?? makeMessageId(),
      type: 'message',
      role: 'assistant',
      content,
      model: data.model ?? model,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
    }
  }
}

class OpenAIShimBeta {
  messages: OpenAIShimMessages
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'

  constructor(defaultHeaders: Record<string, string>, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh', providerOverride?: { model: string; baseURL: string; apiKey: string }) {
    this.messages = new OpenAIShimMessages(defaultHeaders, reasoningEffort, providerOverride)
    this.reasoningEffort = reasoningEffort
  }
}

export function createOpenAIShimClient(options: {
  defaultHeaders?: Record<string, string>
  maxRetries?: number
  timeout?: number
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  providerOverride?: { model: string; baseURL: string; apiKey: string }
}): unknown {
  hydrateGeminiAccessTokenFromSecureStorage()
  hydrateGithubModelsTokenFromSecureStorage()

  // When Gemini provider is active, map Gemini env vars to OpenAI-compatible ones
  // so the existing providerConfig.ts infrastructure picks them up correctly.
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI)) {
    process.env.OPENAI_BASE_URL ??=
      process.env.GEMINI_BASE_URL ??
      'https://generativelanguage.googleapis.com/v1beta/openai'
    const geminiApiKey =
      process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
    if (geminiApiKey && !process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = geminiApiKey
    }
    if (process.env.GEMINI_MODEL && !process.env.OPENAI_MODEL) {
      process.env.OPENAI_MODEL = process.env.GEMINI_MODEL
    }
  } else if (isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)) {
    process.env.OPENAI_BASE_URL ??= GITHUB_COPILOT_BASE
    process.env.OPENAI_API_KEY ??=
      process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? ''
  }

  const beta = new OpenAIShimBeta({
    ...(options.defaultHeaders ?? {}),
  }, options.reasoningEffort, options.providerOverride)

  return {
    beta,
    messages: beta.messages,
  }
}
