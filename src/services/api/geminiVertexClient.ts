import type { ClientOptions } from '@anthropic-ai/sdk'
import type { MessageCreateParamsBase } from '@anthropic-ai/sdk/resources/messages/messages'

type AccessTokenProvider = () => Promise<string>

type GeminiVertexClientOptions = {
  project: string
  location: string
  model: string
  getAccessToken: AccessTokenProvider
  fetch?: NonNullable<ClientOptions['fetch']>
}

type GeminiVertexFunctionCallPart = {
  functionCall: { name: string; args?: Record<string, unknown> }
}
type GeminiVertexFunctionResponsePart = {
  functionResponse: { name: string; response: Record<string, unknown> }
}
type GeminiVertexPart =
  | { text: string }
  | GeminiVertexFunctionCallPart
  | GeminiVertexFunctionResponsePart
type GeminiVertexContent = { role: 'user' | 'model'; parts: GeminiVertexPart[] }
type GeminiVertexSystemInstruction = { parts: Array<{ text: string }> }

// Vertex AI uses an OpenAPI-style schema with UPPERCASE type names and a
// restricted feature set. We translate Anthropic's lowercase JSON Schema and
// drop fields Vertex doesn't accept ($schema, $ref, additionalProperties).
type GeminiVertexSchema = Record<string, unknown>

type GeminiVertexFunctionDeclaration = {
  name: string
  description?: string
  parameters?: GeminiVertexSchema
}
type GeminiVertexTool = {
  functionDeclarations: GeminiVertexFunctionDeclaration[]
}
type GeminiVertexFunctionCallingMode = 'AUTO' | 'ANY' | 'NONE'
type GeminiVertexToolConfig = {
  functionCallingConfig: {
    mode: GeminiVertexFunctionCallingMode
    allowedFunctionNames?: string[]
  }
}

type GeminiVertexSafetyRating = {
  category?: string
  probability?: string
  blocked?: boolean
}

type GeminiVertexResponsePart = {
  text?: string
  functionCall?: { name?: string; args?: Record<string, unknown> }
}

type GeminiVertexResponse = {
  candidates?: Array<{
    content?: {
      role?: string
      parts?: GeminiVertexResponsePart[]
    }
    finishReason?: string
    safetyRatings?: GeminiVertexSafetyRating[]
  }>
  promptFeedback?: {
    blockReason?: string
    blockReasonMessage?: string
    safetyRatings?: GeminiVertexSafetyRating[]
  }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
    thoughtsTokenCount?: number
  }
}

function summarizeBlockedSafetyRatings(
  ratings: GeminiVertexSafetyRating[] | undefined,
): string {
  if (!ratings?.length) return ''
  const blocked = ratings
    .filter(r => r.blocked || r.probability === 'HIGH' || r.probability === 'MEDIUM')
    .map(r => `${r.category ?? '?'}=${r.probability ?? '?'}`)
  return blocked.length ? ` (${blocked.join(', ')})` : ''
}

// Thinking-capable Vertex Gemini models spend a chunk of maxOutputTokens on
// internal reasoning (thoughtsTokenCount) before emitting any visible text.
// If openclaude passes a tight budget — common for the first turn of a chat —
// the model burns the entire allotment thinking and the response comes back
// with finishReason=MAX_TOKENS and no `parts`. Boost the floor for these
// families so a simple greeting actually produces a reply.
const THINKING_MODEL_PREFIXES = ['gemini-3.', 'gemini-2.5-pro']
const THINKING_MODEL_MIN_OUTPUT_TOKENS = 8192

function isThinkingModel(model: string): boolean {
  const lower = model.toLowerCase()
  return THINKING_MODEL_PREFIXES.some(prefix => lower.startsWith(prefix))
}

type GeminiVertexTextBlock = { type: 'text'; text: string }
type GeminiVertexToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
type GeminiVertexContentBlock = GeminiVertexTextBlock | GeminiVertexToolUseBlock
type GeminiVertexStopReason = 'end_turn' | 'tool_use'

type GeminiVertexMessage = {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  stop_reason: GeminiVertexStopReason
  stop_sequence: null
  usage: { input_tokens: number; output_tokens: number }
  content: GeminiVertexContentBlock[]
}

export type GeminiVertexStreamEvent =
  | { type: 'message_start'; message: GeminiVertexMessage }
  | {
      type: 'content_block_start'
      index: number
      content_block:
        | GeminiVertexTextBlock
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } }
  | {
      type: 'content_block_delta'
      index: number
      delta: { type: 'input_json_delta'; partial_json: string }
    }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'message_delta'
      delta: { stop_reason: GeminiVertexStopReason; stop_sequence: null }
      usage: { output_tokens: number }
    }
  | { type: 'message_stop' }

type GeminiVertexWithResponseResult = {
  data: AsyncGenerator<GeminiVertexStreamEvent>
  response: Response
  request_id: string
}

type GeminiVertexPromise = Promise<GeminiVertexMessage> & {
  withResponse(): Promise<GeminiVertexWithResponseResult>
}

// JSON Schema → Vertex schema. Vertex requires UPPERCASE type names and
// doesn't accept $schema/$ref/additionalProperties. We translate recursively
// and drop anything we know Vertex will reject so a single odd field on one
// tool's schema doesn't fail the whole request.
const VERTEX_SCHEMA_DROP_KEYS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'additionalProperties',
  'unevaluatedProperties',
  'patternProperties',
  'dependentSchemas',
  'if',
  'then',
  'else',
])

function toVertexSchema(schema: unknown): GeminiVertexSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return {} as GeminiVertexSchema
  }
  const out: GeminiVertexSchema = {}
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (VERTEX_SCHEMA_DROP_KEYS.has(key)) continue
    if (key === 'type' && typeof value === 'string') {
      out.type = value.toUpperCase()
    } else if (key === 'properties' && value && typeof value === 'object') {
      const properties: Record<string, GeminiVertexSchema> = {}
      for (const [propName, propSchema] of Object.entries(
        value as Record<string, unknown>,
      )) {
        properties[propName] = toVertexSchema(propSchema)
      }
      out.properties = properties
    } else if (key === 'items') {
      out.items = toVertexSchema(value)
    } else if (key === 'anyOf' || key === 'oneOf') {
      if (Array.isArray(value)) {
        out.anyOf = value.map(s => toVertexSchema(s))
      }
    } else if (key === 'allOf') {
      // Vertex doesn't support allOf; collapse to anyOf as a best-effort.
      if (Array.isArray(value)) {
        out.anyOf = value.map(s => toVertexSchema(s))
      }
    } else {
      out[key] = value
    }
  }
  return out
}

// Anthropic tool definitions → Vertex `tools: [{ functionDeclarations }]`.
// Drops tools without an input_schema (e.g. server-side connector tools the
// Anthropic SDK exposes that aren't function-calls) so they don't pollute the
// declaration list.
function toGeminiTools(
  tools: MessageCreateParamsBase['tools'],
): GeminiVertexTool[] | undefined {
  if (!tools?.length) return undefined
  const functionDeclarations: GeminiVertexFunctionDeclaration[] = []
  for (const tool of tools) {
    const t = tool as { name?: string; description?: string; input_schema?: unknown }
    if (!t.name || !t.input_schema) continue
    const declaration: GeminiVertexFunctionDeclaration = { name: t.name }
    if (t.description) declaration.description = t.description
    const parameters = toVertexSchema(t.input_schema)
    if (Object.keys(parameters).length > 0) declaration.parameters = parameters
    functionDeclarations.push(declaration)
  }
  if (!functionDeclarations.length) return undefined
  return [{ functionDeclarations }]
}

// Translate Anthropic tool_choice (auto / any / tool / none) into Vertex's
// toolConfig. Vertex defaults to AUTO when omitted, so we only emit the
// config when a non-default behaviour is requested.
function toGeminiToolConfig(
  toolChoice: MessageCreateParamsBase['tool_choice'],
  hasTools: boolean,
): GeminiVertexToolConfig | undefined {
  if (!hasTools) return undefined
  if (!toolChoice) return undefined
  const choice = toolChoice as { type?: string; name?: string }
  if (choice.type === 'auto') {
    return { functionCallingConfig: { mode: 'AUTO' } }
  }
  if (choice.type === 'none') {
    return { functionCallingConfig: { mode: 'NONE' } }
  }
  if (choice.type === 'any') {
    return { functionCallingConfig: { mode: 'ANY' } }
  }
  if (choice.type === 'tool' && choice.name) {
    return {
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: [choice.name],
      },
    }
  }
  return undefined
}

function safeJsonParse(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* fall through */
    }
  }
  return {}
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(block => {
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

// Translate Anthropic message history → Vertex `contents`. Handles:
//   - plain text on user/assistant turns
//   - assistant tool_use blocks → model functionCall parts (keeps a name map
//     so the subsequent tool_result can be wired back to the right function)
//   - user tool_result blocks → user functionResponse parts, looking up the
//     function name from the most recent tool_use with the same id
// Drops blocks we can't translate (e.g. images) instead of failing the whole
// request — Vertex will respond from whatever it received.
function toGeminiContents(
  messages: MessageCreateParamsBase['messages'],
): GeminiVertexContent[] {
  const toolUseIdToName = new Map<string, string>()
  const out: GeminiVertexContent[] = []

  for (const message of messages) {
    const role: 'user' | 'model' = message.role === 'assistant' ? 'model' : 'user'
    const parts: GeminiVertexPart[] = []

    if (typeof message.content === 'string') {
      if (message.content) parts.push({ text: message.content })
    } else {
      for (const block of message.content) {
        const b = block as {
          type?: string
          text?: string
          name?: string
          id?: string
          input?: unknown
          tool_use_id?: string
          content?: unknown
        }
        if (b.type === 'text' && typeof b.text === 'string' && b.text) {
          parts.push({ text: b.text })
        } else if (b.type === 'tool_use' && b.name && b.id) {
          toolUseIdToName.set(b.id, b.name)
          parts.push({
            functionCall: {
              name: b.name,
              args: safeJsonParse(b.input),
            },
          })
        } else if (b.type === 'tool_result' && b.tool_use_id) {
          const name = toolUseIdToName.get(b.tool_use_id) ?? 'tool'
          parts.push({
            functionResponse: {
              name,
              response: { result: stringifyToolResultContent(b.content) },
            },
          })
        }
      }
    }

    if (parts.length === 0) continue
    out.push({ role, parts })
  }
  return out
}

// openclaude ships a large coding-agent system prompt as params.system. Vertex
// expects it in the top-level `systemInstruction` field — passing it inside
// `contents` would lose its role and confuse the model. Returns undefined if
// the caller didn't send one (so we don't emit an empty instruction object).
function toGeminiSystemInstruction(
  system: MessageCreateParamsBase['system'],
): GeminiVertexSystemInstruction | undefined {
  if (!system) {
    return undefined
  }
  const text = typeof system === 'string'
    ? system
    : system
        .map(block => ('text' in block && typeof block.text === 'string' ? block.text : ''))
        .filter(Boolean)
        .join('\n')
  if (!text.trim()) {
    return undefined
  }
  return { parts: [{ text }] }
}

// Pull every visible-text part out of a Vertex response and concatenate.
// Used both to detect empty-text outcomes and to build the final content
// blocks. Function-call parts are surfaced separately by extractContentBlocks.
function extractText(response: GeminiVertexResponse): string {
  return (
    response.candidates?.[0]?.content?.parts
      ?.map(part => part.text ?? '')
      .join('') ?? ''
  )
}

let toolUseCounter = 0
function nextToolUseId(): string {
  // Anthropic IDs look like `toolu_01XXXXXXXX...`. Vertex doesn't provide an
  // id with its functionCall, so we synthesise one stable per-call so the
  // assistant message and any follow-up tool_result can correlate.
  toolUseCounter = (toolUseCounter + 1) % Number.MAX_SAFE_INTEGER
  return `toolu_vertex_${Date.now().toString(36)}_${toolUseCounter}`
}

// Build Anthropic-shaped content blocks (text + tool_use) from Vertex parts,
// preserving the original ordering. A response that mixes text and function
// calls is valid and is what the agent loop needs to actually call tools.
function extractContentBlocks(
  response: GeminiVertexResponse,
): GeminiVertexContentBlock[] {
  const parts = response.candidates?.[0]?.content?.parts ?? []
  const blocks: GeminiVertexContentBlock[] = []
  let textBuffer = ''
  const flushText = (): void => {
    if (textBuffer) {
      blocks.push({ type: 'text', text: textBuffer })
      textBuffer = ''
    }
  }
  for (const part of parts) {
    if (typeof part.text === 'string' && part.text) {
      textBuffer += part.text
    } else if (part.functionCall?.name) {
      flushText()
      blocks.push({
        type: 'tool_use',
        id: nextToolUseId(),
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
      })
    }
  }
  flushText()
  return blocks
}

// Adapt the completed Vertex response to the Anthropic streaming event
// sequence the rest of openclaude consumes. Emits one content_block_start /
// delta / stop trio per block so the streaming accumulator builds the right
// shape for multi-block (text + tool_use) responses.
async function* toAnthropicStream(
  message: GeminiVertexMessage,
): AsyncGenerator<GeminiVertexStreamEvent> {
  yield { type: 'message_start', message }
  for (let index = 0; index < message.content.length; index++) {
    const block = message.content[index]!
    if (block.type === 'text') {
      yield {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      }
      if (block.text) {
        yield {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: block.text },
        }
      }
      yield { type: 'content_block_stop', index }
    } else {
      yield {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: {},
        },
      }
      yield {
        type: 'content_block_delta',
        index,
        delta: {
          type: 'input_json_delta',
          partial_json: JSON.stringify(block.input ?? {}),
        },
      }
      yield { type: 'content_block_stop', index }
    }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: message.stop_reason, stop_sequence: null },
    usage: { output_tokens: message.usage.output_tokens },
  }
  yield { type: 'message_stop' }
}

export function createGeminiVertexClient(options: GeminiVertexClientOptions) {
  const fetchImpl = options.fetch ?? fetch

  const create = (params: MessageCreateParamsBase & { stream?: boolean }): GeminiVertexPromise => {
    let capturedResponse: Response | undefined
    const promise = (async (): Promise<GeminiVertexMessage> => {
      const model = options.model
      const token = await options.getAccessToken()
      const host = options.location === 'global'
        ? 'aiplatform.googleapis.com'
        : `${options.location}-aiplatform.googleapis.com`
      const url = `https://${host}/v1/projects/${options.project}/locations/${options.location}/publishers/google/models/${model}:generateContent`

      // For thinking models, raise the floor so the model has room to think
      // *and* still emit visible output. Honor the caller's value when it's
      // already large enough — only boost when the requested budget would
      // certainly be eaten by the thinking phase.
      const requestedMaxTokens = params.max_tokens
      const effectiveMaxTokens = isThinkingModel(model)
        ? Math.max(requestedMaxTokens ?? 0, THINKING_MODEL_MIN_OUTPUT_TOKENS)
        : requestedMaxTokens

      const systemInstruction = toGeminiSystemInstruction(params.system)
      const tools = toGeminiTools(params.tools)
      const toolConfig = toGeminiToolConfig(params.tool_choice, Boolean(tools))

      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-goog-user-project': options.project,
        },
        body: JSON.stringify({
          contents: toGeminiContents(params.messages),
          ...(systemInstruction ? { systemInstruction } : {}),
          // Forward tool definitions so the model emits well-formed
          // functionCall parts instead of inventing syntax that Vertex
          // rejects with finishReason=MALFORMED_FUNCTION_CALL. Without
          // this, any agentic prompt (which always declares tools) returns
          // an empty, unusable response.
          ...(tools ? { tools } : {}),
          ...(toolConfig ? { toolConfig } : {}),
          generationConfig: {
            ...(effectiveMaxTokens !== undefined
              ? { maxOutputTokens: effectiveMaxTokens }
              : {}),
            ...(params.temperature !== undefined
              ? { temperature: params.temperature }
              : {}),
          },
        }),
      })
      capturedResponse = response

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`Gemini Vertex request failed: ${response.status} ${body}`)
      }

      const json = (await response.json()) as GeminiVertexResponse
      const contentBlocks = extractContentBlocks(json)
      const text = extractText(json)
      const candidate = json.candidates?.[0]
      const finishReason = candidate?.finishReason
      const thoughtsTokenCount = json.usageMetadata?.thoughtsTokenCount ?? 0
      const hasToolCall = contentBlocks.some(b => b.type === 'tool_use')

      // Surface every silent-empty-response path explicitly. We treat the
      // response as empty only when the candidate produced neither text nor
      // a function call — a function-call-only turn is a perfectly valid
      // agent response and must be passed through to the orchestrator.
      if (!text && !hasToolCall) {
        // 1. Prompt-level block: Vertex refuses to process the input before
        //    producing any candidate (safety filter at the prompt layer).
        const promptBlock = json.promptFeedback?.blockReason
        if (promptBlock) {
          const detail =
            json.promptFeedback?.blockReasonMessage ??
            summarizeBlockedSafetyRatings(json.promptFeedback?.safetyRatings)
          throw new Error(
            `Gemini Vertex blocked the prompt (${promptBlock})${detail ? `: ${detail}` : ''}. ` +
              `Try a less sensitive prompt or another Vertex model.`,
          )
        }

        // 2. Thinking model exhausted its output budget on internal reasoning.
        if (finishReason === 'MAX_TOKENS') {
          const usedForThinking = thoughtsTokenCount > 0
            ? ` (${thoughtsTokenCount} tokens consumed by internal thinking)`
            : ''
          throw new Error(
            `Gemini Vertex returned no visible text: hit MAX_TOKENS${usedForThinking}. ` +
              `Model "${model}" likely needs a larger maxOutputTokens budget. ` +
              `Try a non-thinking model (e.g. gemini-2.5-flash) or raise the budget.`,
          )
        }

        // 3. Candidate-level safety / recitation / blocklist refusal.
        if (
          finishReason === 'SAFETY' ||
          finishReason === 'RECITATION' ||
          finishReason === 'BLOCKLIST' ||
          finishReason === 'PROHIBITED_CONTENT' ||
          finishReason === 'SPII'
        ) {
          const detail = summarizeBlockedSafetyRatings(candidate?.safetyRatings)
          throw new Error(
            `Gemini Vertex refused to answer (${finishReason})${detail}. ` +
              `Try rephrasing or another Vertex model.`,
          )
        }

        // 4. Malformed function call: the model tried to emit a tool call
        //    Vertex couldn't parse. Almost always means tools weren't passed
        //    or the schema was unparseable. The toGeminiTools/toVertexSchema
        //    pipeline above should prevent this, but surface a clear error
        //    if it still happens (e.g. an unusual tool definition).
        if (finishReason === 'MALFORMED_FUNCTION_CALL') {
          throw new Error(
            `Gemini Vertex emitted a malformed function call from "${model}". ` +
              `This usually indicates a tool schema Vertex couldn't parse. ` +
              `Try another model or remove a recently-added custom tool.`,
          )
        }

        // 5. Catch-all: model finished normally (STOP / OTHER / undefined)
        //    but produced no text or function call. Surface it instead of
        //    silently dropping.
        throw new Error(
          `Gemini Vertex returned an empty response from "${model}"` +
            `${finishReason ? ` (finishReason: ${finishReason})` : ''}. ` +
            `This usually means the model couldn't generate output for this prompt — try another model or rephrase.`,
        )
      }

      const finalBlocks: GeminiVertexContentBlock[] =
        contentBlocks.length > 0
          ? contentBlocks
          : [{ type: 'text', text }]

      return {
        id: `gemini-vertex-${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model,
        stop_reason: hasToolCall ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: json.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        },
        content: finalBlocks,
      }
    })()

    const typed = promise as GeminiVertexPromise
    typed.withResponse = async () => {
      const data = await promise
      const response = capturedResponse ?? new Response()
      return {
        data: toAnthropicStream(data),
        response,
        request_id: response.headers.get('x-request-id') ?? data.id,
      }
    }

    return typed
  }

  const messages = { create }

  return {
    messages,
    beta: { messages },
  }
}
