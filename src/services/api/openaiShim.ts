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
 * GitHub Models (models.github.ai), OpenAI-compatible:
 *   CLAUDE_CODE_USE_GITHUB=1         — enable GitHub inference (no need for USE_OPENAI)
 *   GITHUB_TOKEN or GH_TOKEN         — PAT with models access (mapped to Bearer auth)
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
  convertCodexResponseToAnthropicMessage,
  performCodexRequest,
  type AnthropicStreamEvent,
  type AnthropicUsage,
  type ShimCreateParams,
} from './codexShim.js'
import {
  isLocalProviderUrl,
  resolveCodexApiCredentials,
  resolveProviderRequest,
} from './providerConfig.js'
import { sanitizeSchemaForOpenAICompat } from '../../utils/schemaSanitizer.js'
import { redactSecretValueForDisplay } from '../../utils/providerProfile.js'

// ---------------------------------------------------------------------------
// Gemma 4 pythonic tool-call parser
//
// Gemma 4 emits tool calls as plain text inside `content` in the form:
//   call:func_name{key:value,key2:"quoted value"}
// vLLM 0.19 does not parse these into tool_calls[] even with --tool-call-parser pythonic.
// This shim detects the pattern, parses it, and injects proper tool_calls entries.
// ---------------------------------------------------------------------------

function makeToolId(): string {
  return `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
}

/**
 * Parse a Gemma 4 pythonic value token.
 * Handles: bare words, quoted strings (single/double, including multi-line),
 * numbers, booleans, and nested structures passed as raw text.
 */
function parseGemma4Value(raw: string): unknown {
  const s = raw.trim()
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null') return null
  const num = Number(s)
  if (!Number.isNaN(num) && s !== '') return num
  // Triple-quoted string (model sometimes wraps long values in """...""")
  if (s.startsWith('"""') && s.endsWith('"""')) {
    return s.slice(3, -3)
  }
  // Standard double or single quoted string — may span multiple lines
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\(.)/g, '$1')
  }
  return s
}

/**
 * Parse the argument body of a Gemma 4 call: `{key:val, key2:"quoted", ...}`
 * Returns a plain object or null if parsing fails.
 */
function parseGemma4Args(body: string): Record<string, unknown> | null {
  const args: Record<string, unknown> = {}
  // Strip surrounding braces
  const inner = body.trim().replace(/^\{/, '').replace(/\}$/, '').trim()
  if (!inner) return args

  // Extract top-level comma-separated parts, ignoring commas inside `{...}`, `[...]`, or `\"...\"`.
  // Single quotes are NOT ignored because they are common punctuation in unquoted English strings (e.g. "I'm", "don't")
  // and treating them as string delimiters breaks the parser immediately.
  const parts: string[] = []
  let currentPart = ''
  let depth = 0
  let inQuote = false

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (inQuote) {
      if (ch === '\\') {
        currentPart += ch
        if (i + 1 < inner.length) {
          currentPart += inner[i + 1]
          i++
        }
      } else if (ch === '"') {
        inQuote = false
        currentPart += ch
      } else {
        currentPart += ch
      }
    } else if (ch === '"') {
      inQuote = true
      currentPart += ch
    } else if (ch === '{' || ch === '[') {
      depth++
      currentPart += ch
    } else if (ch === '}' || ch === ']') {
      depth--
      currentPart += ch
    } else if (ch === ',' && depth === 0) {
      parts.push(currentPart)
      currentPart = ''
    } else {
      currentPart += ch
    }
  }
  if (currentPart.trim()) parts.push(currentPart)

  // 2. Process parts: identify valid parameter declarations vs embedded commas
  let currentKey = ''
  let currentVal = ''

  for (const part of parts) {
    // Check if this part starts a completely new parameter.
    // A parameter must be ` [optional spaces] identifier [spaces] : value `
    const match = part.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/s)
    
    if (match) {
      // It's a new parameter
      if (currentKey) {
        args[currentKey] = parseGemma4Value(currentVal)
      }
      currentKey = match[1]
      currentVal = match[2]
    } else {
      // It does NOT look like a new parameter declaration, so this comma
      // must have been embedded inside the previous unquoted parameter's value.
      if (currentKey) {
        currentVal += ',' + part
      } else {
        // Edge case: no valid key at start of string, just ignore or append
      }
    }
  }

  // Save the final parameter
  if (currentKey) {
    args[currentKey] = parseGemma4Value(currentVal)
  }

  return args
}

type ParsedGemma4Call = {
  name: string
  args: Record<string, unknown>
}

/**
 * Walk forward from `startIndex` (which must point to an opening `{`) in `str`
 * and return the index of the matching closing `}`, respecting:
 *  - Nested `{}`  and `[]`
 *  - Double quoted strings (with escape handling)
 * Single quotes are ignored because unquoted English text often contains apostrophes (e.g. "I'm").
 * Returns -1 if no matching brace is found.
 */
function findMatchingBrace(str: string, startIndex: number): number {
  let depth = 0
  let inQuote = false
  for (let i = startIndex; i < str.length; i++) {
    const ch = str[i]
    if (inQuote) {
      if (ch === '\\') { i++; continue } // skip escaped char
      if (ch === '"') inQuote = false
      continue
    }
    if (ch === '"') { inQuote = true; continue }
    if (ch === '{' || ch === '[') { depth++; continue }
    if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Scan a content string for one or more Gemma 4 tool calls.
 * Returns an array of parsed calls and the cleaned content (with call text removed).
 * Pattern to match (possibly preceded by thought block and newlines):
 *   call:func_name{...}
 */
function extractGemma4ToolCalls(content: string): {
  calls: ParsedGemma4Call[]
  cleanedContent: string
} {
  const calls: ParsedGemma4Call[] = []
  let cleaned = content

  // Find all call:funcname{...} occurrences using a brace-depth-aware scanner
  // so that nested objects/arrays are captured correctly.
  const callStartRe = /call:([A-Za-z_][A-Za-z0-9_]*)\s*\{/g
  let match: RegExpExecArray | null
  const matchedSpans: Array<{ start: number; end: number }> = []

  while ((match = callStartRe.exec(content)) !== null) {
    const funcName = match[1]
    // match.index is the start of "call:", the `{` is at match.index + match[0].length - 1
    const braceStart = match.index + match[0].length - 1
    const braceEnd = findMatchingBrace(content, braceStart)
    if (braceEnd < 0) continue // unmatched brace — skip

    const body = content.slice(braceStart, braceEnd + 1)
    const parsed = parseGemma4Args(body)
    if (parsed !== null) {
      calls.push({ name: funcName, args: parsed })
      matchedSpans.push({ start: match.index, end: braceEnd + 1 })
    }
  }

  if (calls.length > 0) {
    // Remove all matched spans from content (in reverse order)
    const parts: string[] = []
    let pos = 0
    for (const span of matchedSpans) {
      parts.push(content.slice(pos, span.start))
      pos = span.end
    }
    parts.push(content.slice(pos))
    cleaned = parts.join('').trim()

    // Also strip Gemma 4 thought channel markers from the visible content
    // Pattern: "thought\n...text..." at the start
    cleaned = cleaned.replace(/^thought\n[\s\S]*?(\n|$)/, '').trim()
  }

  return { calls, cleanedContent: cleaned
  }
}

type SecretValueSource = Partial<{
  OPENAI_API_KEY: string
  CODEX_API_KEY: string
  GEMINI_API_KEY: string
  GOOGLE_API_KEY: string
  GEMINI_ACCESS_TOKEN: string
}>

const GITHUB_MODELS_DEFAULT_BASE = 'https://models.github.ai/inference'
const GITHUB_API_VERSION = '2022-11-28'
const GITHUB_429_MAX_RETRIES = 3
const GITHUB_429_BASE_DELAY_SEC = 1
const GITHUB_429_MAX_DELAY_SEC = 32

function isGithubModelsMode(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
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
        // Append thinking as text with a marker for models that support reasoning
        if (block.thinking) {
          parts.push({ type: 'text', text: `<thinking>${block.thinking}</thinking>` })
        }
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

function convertMessages(
  messages: Array<{ role: string; message?: { role?: string; content?: unknown }; content?: unknown }>,
  system: unknown,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  // System message first
  const sysText = convertSystemPrompt(system)

  // Gemma 4 tool-calling instruction.
  // Appended to the system prompt so the model remembers to use the wrapper 
  // AND wraps complex string values in double quotes. 
  const gemma4ToolNote = [
    '\n\nCRITICAL TOOL CALL FORMAT NOTE:',
    '1. You MUST ALWAYS invoke tools using the exact syntax: call:funcname{key:"value"}',
    '2. If you simply output the parameter values as plain text without the call:funcname{ wrapper, the tool will FAIL to execute.',
    '3. Always wrap string argument values in double quotes (especially if they contain newlines, commas, or colons).',
    'Example: call:Write{file_path:"/path/file.md",content:"line1\\nline2"}',
  ].join(' ')

  const finalSysText = sysText ? sysText + gemma4ToolNote : gemma4ToolNote
  result.push({ role: 'system', content: finalSysText })

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
            }) => ({
              id: tu.id ?? `call_${crypto.randomUUID().replace(/-/g, '')}`,
              type: 'function' as const,
              function: {
                name: tu.name ?? 'unknown',
                arguments:
                  typeof tu.input === 'string'
                    ? tu.input
                    : JSON.stringify(tu.input ?? {}),
              },
              ...(tu.extra_content ? { extra_content: tu.extra_content } : {}),
            }),
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

  return result
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
      // OpenAI strict mode requires every property to be listed in required[]
      const allKeys = Object.keys(normalizedProps)
      record.required = Array.from(new Set([...existingRequired, ...allKeys]))
      // OpenAI strict mode requires additionalProperties: false on all object
      // schemas — override unconditionally to ensure nested objects comply.
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
  const isGemini = isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI)

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
  const activeToolCalls = new Map<number, { id: string; name: string; index: number; jsonBuffer: string }>()
  let hasEmittedContentStart = false
  let lastStopReason: 'tool_use' | 'max_tokens' | 'end_turn' | null = null
  let hasEmittedFinalUsage = false
  let hasProcessedFinishReason = false
  // Gemma 4: accumulate streamed content to detect pythonic tool calls at finish
  let streamingContentBuffer = ''

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

        // Text content — use != null to distinguish absent field from empty string,
        // some providers send "" as first delta to signal streaming start
        if (delta.content != null) {
          // Buffer streaming content for Gemma 4 pythonic tool call detection.
          // We accumulate the full text and emit at finish_reason so we can
          // detect and strip call:func{...} patterns before showing them.
          streamingContentBuffer += delta.content

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
              // New tool call starting
              if (hasEmittedContentStart) {
                yield {
                  type: 'content_block_stop',
                  index: contentBlockIndex,
                }
                contentBlockIndex++
                hasEmittedContentStart = false
              }

              const toolBlockIndex = contentBlockIndex
              activeToolCalls.set(tc.index, {
                id: tc.id,
                name: tc.function.name,
                index: toolBlockIndex,
                jsonBuffer: tc.function.arguments ?? '',
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
                },
              }
              contentBlockIndex++

              // Emit any initial arguments
              if (tc.function.arguments) {
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

          // --- Gemma 4 pythonic tool-call extraction (streaming) ---
          // If no structured tool_calls arrived but content contains call:func{...},
          // emit synthetic tool_use content blocks now (before closing content block).
          if (activeToolCalls.size === 0 && streamingContentBuffer.includes('call:')) {
            const { calls, cleanedContent } = extractGemma4ToolCalls(streamingContentBuffer)
            if (calls.length > 0) {
              // We already emitted the raw text as content_block_delta chunks.
              // Close the text block, then emit tool_use blocks for each call.
              if (hasEmittedContentStart) {
                // Retract the previously emitted text by emitting a stop
                // and replacing with cleaned text (re-open + emit cleaned delta)
                yield { type: 'content_block_stop', index: contentBlockIndex }
                // Re-emit cleaned content block if there's remaining text
                if (cleanedContent) {
                  contentBlockIndex++
                  yield {
                    type: 'content_block_start',
                    index: contentBlockIndex,
                    content_block: { type: 'text', text: '' },
                  }
                  yield {
                    type: 'content_block_delta',
                    index: contentBlockIndex,
                    delta: { type: 'text_delta', text: cleanedContent },
                  }
                  yield { type: 'content_block_stop', index: contentBlockIndex }
                }
                hasEmittedContentStart = false
                contentBlockIndex++
              }
              for (const call of calls) {
                const tcId = makeToolId()
                const toolIdx = contentBlockIndex
                yield {
                  type: 'content_block_start',
                  index: toolIdx,
                  content_block: { type: 'tool_use', id: tcId, name: call.name, input: {} },
                }
                const argsJson = JSON.stringify(call.args)
                yield {
                  type: 'content_block_delta',
                  index: toolIdx,
                  delta: { type: 'input_json_delta', partial_json: argsJson },
                }
                yield { type: 'content_block_stop', index: toolIdx }
                contentBlockIndex++
              }
              // Override stop reason to tool_use since we found tool calls
              lastStopReason = 'tool_use'
              yield {
                type: 'message_delta',
                delta: { stop_reason: 'tool_use', stop_sequence: null },
              }
              hasEmittedFinalUsage = true
              continue
            }
          }
          // --- end Gemma 4 ---

          // Close any open content blocks
          if (hasEmittedContentStart) {
            yield {
              type: 'content_block_stop',
              index: contentBlockIndex,
            }
          }
          // Close active tool calls
          for (const [, tc] of activeToolCalls) {
            let suffixToAdd = ''
            if (tc.jsonBuffer) {
              try {
                JSON.parse(tc.jsonBuffer)
              } catch {
                const str = tc.jsonBuffer.trimEnd()
                const combinations = [
                  '}', '"}', ']}', '"]}', '}}', '"}}', ']}}', '"]}}', '"]}]}', '}]}'
                ]
                for (const combo of combinations) {
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
      const response = await self._doRequest(request, params, options)
      httpResponse = response

      if (params.stream) {
        return new OpenAIShimStream(
          request.transport === 'codex_responses'
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

      const data = await response.json()
      return self._convertNonStreamingResponse(data, request.resolvedModel)
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

  private async _doRequest(
    request: ReturnType<typeof resolveProviderRequest>,
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<Response> {
    if (request.transport === 'codex_responses') {
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
        body.tools = converted
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

    const isGemini = isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI)
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
        if (geminiCredential.projectId) {
          headers['x-goog-user-project'] = geminiCredential.projectId
        }
      }
    }

    if (isGithub) {
      headers.Accept = 'application/vnd.github.v3+json'
      headers['X-GitHub-Api-Version'] = GITHUB_API_VERSION
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

    const fetchInit = {
      method: 'POST' as const,
      headers,
      body: JSON.stringify(body),
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
      const errorBody = await response.text().catch(() => 'unknown error')
      const rateHint =
        isGithub && response.status === 429 ? formatRetryAfterHint(response) : ''
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
      }
    },
    model: string,
  ) {
    const choice = data.choices?.[0]
    const content: Array<Record<string, unknown>> = []

    let rawContent = choice?.message?.content

    // --- Gemma 4 pythonic tool-call extraction (non-streaming) ---
    // When tool_calls[] is empty but content contains call:func{...} patterns,
    // parse them out and inject proper tool_calls entries.
    const existingToolCalls = choice?.message?.tool_calls ?? []
    let gemma4ToolCalls: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }> = []
    if (existingToolCalls.length === 0 && typeof rawContent === 'string' && rawContent.includes('call:')) {
      const { calls, cleanedContent } = extractGemma4ToolCalls(rawContent)
      if (calls.length > 0) {
        gemma4ToolCalls = calls.map(c => ({
          id: makeToolId(),
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        }))
        rawContent = cleanedContent || null
      }
    }
    // --- end Gemma 4 ---

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

    const allToolCalls = [...existingToolCalls, ...gemma4ToolCalls]
    if (allToolCalls) {
      for (const tc of allToolCalls) {
        let input: unknown
        try {
          input = JSON.parse(tc.function.arguments)
        } catch {
          input = { raw: tc.function.arguments }
        }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
          ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
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
    process.env.OPENAI_BASE_URL ??= GITHUB_MODELS_DEFAULT_BASE
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
