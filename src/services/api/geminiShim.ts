/**
 * Native Gemini API shim for Claude Code.
 *
 * Translates Anthropic SDK calls (anthropic.beta.messages.create) into
 * native Google Generative AI API requests using the @google/generative-ai
 * SDK, and streams back events in the Anthropic streaming format so the
 * rest of the codebase is unaware.
 *
 * Unlike the OpenAI-compatible shim, this uses Gemini's native API which
 * handles thought_signatures, function calling, and thinking blocks
 * correctly without workarounds.
 *
 * Environment variables:
 *   CLAUDE_CODE_GOOGLE=1       — enable this provider
 *   GEMINI_API_KEY=...             — API key (or GOOGLE_API_KEY)
 *   GEMINI_MODEL=gemini-2.0-flash  — model override
 */

import {
  GoogleGenerativeAI,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type GenerationConfig,
  type GenerateContentStreamResult,
  type Part,
  type Schema,
  type Tool,
} from '@google/generative-ai'
import type {
  AnthropicStreamEvent,
  AnthropicUsage,
  ShimCreateParams,
} from './codexShim.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

function makeMessageId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, '')}`
}

// ---------------------------------------------------------------------------
// Message format conversion: Anthropic → Gemini
// ---------------------------------------------------------------------------

function convertSystemPrompt(system: unknown): string {
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
      chunks.push('[image]')
      continue
    }
    if (typeof block?.text === 'string') {
      chunks.push(block.text)
    }
  }
  return chunks.join('\n')
}

function convertContentToParts(content: unknown): Part[] {
  if (typeof content === 'string') {
    return [{ text: content }]
  }
  if (!Array.isArray(content)) {
    return [{ text: String(content ?? '') }]
  }

  const parts: Part[] = []
  for (const block of content) {
    switch (block?.type) {
      case 'text':
        if (block.text) parts.push({ text: block.text })
        break
      case 'image': {
        const src = block.source
        if (src?.type === 'base64' && src.data) {
          parts.push({
            inlineData: {
              mimeType: src.media_type ?? 'image/png',
              data: src.data,
            },
          })
        }
        break
      }
      case 'thinking':
        // Gemini uses thought=true on the generation config and returns
        // thought parts in the response. For replayed thinking blocks,
        // we include them as text with a marker.
        if (block.thinking) {
          parts.push({ text: `[thought]\n${block.thinking}\n[/thought]` })
        }
        break
      case 'tool_use':
        // Handled separately — converted to functionCall parts
        break
      case 'tool_result':
        // Handled separately — converted to functionResponse parts
        break
      default:
        if (block?.text) parts.push({ text: block.text })
    }
  }

  if (parts.length === 0) return [{ text: '' }]
  return parts
}

/**
 * Convert Anthropic messages to Gemini Content array.
 * Handles user, assistant, and tool result messages.
 */
function convertMessages(
  messages: Array<{
    role: string
    message?: { role?: string; content?: unknown }
    content?: unknown
  }>,
): Content[] {
  // First pass: build a map of tool_use_id → function name from assistant messages
  const toolNameMap = new Map<string, string>()
  for (const msg of messages) {
    const inner = msg.message ?? msg
    const content = (inner as { content?: unknown }).content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_use' && block.id && block.name) {
          toolNameMap.set(block.id, block.name)
        }
      }
    }
  }

  const result: Content[] = []

  for (const msg of messages) {
    const inner = msg.message ?? msg
    const role = (inner as { role?: string }).role ?? msg.role
    const content = (inner as { content?: unknown }).content

    if (role === 'user') {
      if (Array.isArray(content)) {
        const toolResults = content.filter(
          (b: { type?: string }) => b.type === 'tool_result',
        )
        const otherContent = content.filter(
          (b: { type?: string }) => b.type !== 'tool_result',
        )

        const parts: Part[] = []

        // Convert tool results to functionResponse parts
        for (const tr of toolResults) {
          const resultText = convertToolResultContent(tr.content)
          // Gemini requires the function name (not the call ID) in functionResponse
          const funcName =
            toolNameMap.get(tr.tool_use_id ?? '') ?? tr.tool_use_id ?? 'unknown'
          parts.push({
            functionResponse: {
              name: funcName,
              response: tr.is_error
                ? { error: resultText }
                : { output: resultText },
            },
          })
        }

        // Convert remaining user content
        if (otherContent.length > 0) {
          parts.push(...convertContentToParts(otherContent))
        }

        if (parts.length > 0) {
          result.push({ role: 'user', parts })
        }
      } else {
        const parts = convertContentToParts(content)
        result.push({ role: 'user', parts })
      }
    } else if (role === 'assistant') {
      if (Array.isArray(content)) {
        const parts: Part[] = []

        for (const block of content) {
          switch (block?.type) {
            case 'text':
              if (block.text) parts.push({ text: block.text })
              break
            case 'thinking':
              // Include thinking as text for context continuity
              if (block.thinking) {
                parts.push({
                  text: `[thought]\n${block.thinking}\n[/thought]`,
                })
              }
              break
            case 'tool_use':
              parts.push({
                functionCall: {
                  name: block.name ?? 'unknown',
                  args:
                    typeof block.input === 'string'
                      ? JSON.parse(block.input ?? '{}')
                      : (block.input ?? {}),
                },
              })
              break
          }
        }

        if (parts.length > 0) {
          result.push({ role: 'model', parts })
        }
      } else {
        const parts = convertContentToParts(content)
        result.push({ role: 'model', parts })
      }
    }
  }

  // Gemini requires alternating user/model turns. Merge consecutive same-role messages.
  const merged: Content[] = []
  for (const item of result) {
    const prev = merged[merged.length - 1]
    if (prev && prev.role === item.role) {
      prev.parts = [...prev.parts, ...item.parts]
    } else {
      merged.push({ ...item, parts: [...item.parts] })
    }
  }

  // Gemini requires the conversation to start with a user role
  if (merged.length > 0 && merged[0].role !== 'user') {
    merged.unshift({ role: 'user', parts: [{ text: ' ' }] })
  }

  // Gemini requires the conversation to end with a user role (for next turn)
  if (merged.length > 0 && merged[merged.length - 1].role !== 'user') {
    // This is normal — the last assistant message is what we're responding to
    // The API will handle this correctly
  }

  return merged
}

// ---------------------------------------------------------------------------
// Tool format conversion: Anthropic → Gemini
// ---------------------------------------------------------------------------

function convertJsonSchemaToGeminiSchema(
  schema: Record<string, unknown>,
): Schema {
  const result: Record<string, unknown> = {}

  if (schema.type) result.type = String(schema.type).toUpperCase()
  if (schema.description) result.description = String(schema.description)
  if (schema.enum) result.enum = schema.enum as string[]

  if (schema.type === 'object' && schema.properties) {
    const props = schema.properties as Record<string, Record<string, unknown>>
    const required = Array.isArray(schema.required)
      ? (schema.required as string[])
      : []

    const properties: Record<string, Schema> = {}
    for (const [key, value] of Object.entries(props)) {
      properties[key] = convertJsonSchemaToGeminiSchema(
        value as Record<string, unknown>,
      )
    }

    result.properties = properties
    if (required.length > 0) {
      result.required = required
    }
  }

  if (schema.type === 'array' && schema.items) {
    result.items = convertJsonSchemaToGeminiSchema(
      schema.items as Record<string, unknown>,
    )
  }

  // Handle anyOf/oneOf
  for (const key of ['anyOf', 'oneOf'] as const) {
    if (schema[key] && Array.isArray(schema[key])) {
      result[key === 'anyOf' ? 'anyOf' : 'oneOf'] = (
        schema[key] as Record<string, unknown>[]
      ).map(item => convertJsonSchemaToGeminiSchema(item))
    }
  }

  return result as Schema
}

function convertTools(
  tools: Array<{
    name: string
    description?: string
    input_schema?: Record<string, unknown>
  }>,
): Tool[] {
  const functionDeclarations: FunctionDeclaration[] = tools
    .filter(t => t.name !== 'ToolSearchTool')
    .map(t => {
      const schema = (t.input_schema ?? {
        type: 'object',
        properties: {},
      }) as Record<string, unknown>

      return {
        name: t.name,
        description: t.description ?? '',
        parameters: convertJsonSchemaToGeminiSchema(schema),
      }
    })

  return [{ functionDeclarations }]
}

// ---------------------------------------------------------------------------
// Streaming: Gemini SSE → Anthropic stream events
// ---------------------------------------------------------------------------

async function* geminiStreamToAnthropic(
  streamResult: GenerateContentStreamResult,
  model: string,
): AsyncGenerator<AnthropicStreamEvent> {
  const messageId = makeMessageId()
  let contentBlockIndex = 0
  let hasEmittedContentStart = false
  let hasEmittedThinkingStart = false
  let hasClosedThinking = false
  let inputTokens = 0
  let outputTokens = 0

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

  try {
    for await (const chunk of streamResult.stream) {
      // Extract usage from chunk if available
      const usageMeta = chunk.usageMetadata
      if (usageMeta) {
        inputTokens = usageMeta.promptTokenCount ?? 0
        outputTokens = usageMeta.candidatesTokenCount ?? 0
      }

      const candidate = chunk.candidates?.[0]
      if (!candidate) continue

      const parts = candidate.content?.parts ?? []

      for (const part of parts) {
        // Thinking / thought parts
        if (part.thought || (part.text && candidate.content?.role === 'model' && !hasClosedThinking && !hasEmittedContentStart && part.text.startsWith('[thought]'))) {
          if (!hasEmittedThinkingStart) {
            yield {
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: { type: 'thinking', thinking: '' },
            }
            hasEmittedThinkingStart = true
          }

          const thinkingText = part.thought
            ? (part.text ?? '')
            : (part.text ?? '').replace(/^\[thought\]\n?/, '').replace(/\n?\[\/thought\]$/, '')

          if (thinkingText) {
            yield {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: { type: 'thinking_delta', thinking: thinkingText },
            }
          }
          continue
        }

        // Text content
        if (part.text && !part.thought) {
          // Close thinking block if open
          if (hasEmittedThinkingStart && !hasClosedThinking) {
            yield { type: 'content_block_stop', index: contentBlockIndex }
            contentBlockIndex++
            hasClosedThinking = true
          }

          // Strip [thought]...[/thought] wrappers from text if present
          let text = part.text
          text = text.replace(/\[thought\][\s\S]*?\[\/thought\]\n?/g, '')

          if (text) {
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
              delta: { type: 'text_delta', text },
            }
          }
        }

        // Function calls (tool use)
        if (part.functionCall) {
          // Close thinking block if open
          if (hasEmittedThinkingStart && !hasClosedThinking) {
            yield { type: 'content_block_stop', index: contentBlockIndex }
            contentBlockIndex++
            hasClosedThinking = true
          }
          // Close text block if open
          if (hasEmittedContentStart) {
            yield { type: 'content_block_stop', index: contentBlockIndex }
            contentBlockIndex++
            hasEmittedContentStart = false
          }

          const fc = part.functionCall
          const toolId = `call_${crypto.randomUUID().replace(/-/g, '')}`
          const toolBlockIndex = contentBlockIndex

          yield {
            type: 'content_block_start',
            index: toolBlockIndex,
            content_block: {
              type: 'tool_use',
              id: toolId,
              name: fc.name ?? 'unknown',
              input: {},
            },
          }

          const argsStr = JSON.stringify(fc.args ?? {})
          if (argsStr && argsStr !== '{}') {
            yield {
              type: 'content_block_delta',
              index: toolBlockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: argsStr,
              },
            }
          }

          yield { type: 'content_block_stop', index: toolBlockIndex }
          contentBlockIndex++
        }
      }

      // Finish reason
      const finishReason = candidate.finishReason
      if (finishReason) {
        // Close any open blocks
        if (hasEmittedThinkingStart && !hasClosedThinking) {
          yield { type: 'content_block_stop', index: contentBlockIndex }
          contentBlockIndex++
          hasClosedThinking = true
        }
        if (hasEmittedContentStart) {
          yield { type: 'content_block_stop', index: contentBlockIndex }
          contentBlockIndex++
          hasEmittedContentStart = false
        }

        const stopReason =
          finishReason === 'STOP'
            ? 'end_turn'
            : finishReason === 'MAX_TOKENS'
              ? 'max_tokens'
              : finishReason === 'TOOL_CALLS' || finishReason === 'TOOL_CODE'
                ? 'tool_use'
                : 'end_turn'

        yield {
          type: 'message_delta',
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          },
        }
      }
    }
  } catch (error) {
    // Ensure we close any open blocks on error
    if (hasEmittedThinkingStart && !hasClosedThinking) {
      yield { type: 'content_block_stop', index: contentBlockIndex }
    }
    if (hasEmittedContentStart) {
      yield { type: 'content_block_stop', index: contentBlockIndex }
    }
    throw error
  }

  yield { type: 'message_stop' }
}

// ---------------------------------------------------------------------------
// Non-streaming response conversion
// ---------------------------------------------------------------------------

function convertGeminiResponseToAnthropic(
  response: Awaited<ReturnType<ReturnType<GoogleGenerativeAI['getGenerativeModel']>['generateContent']>>,
  model: string,
): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = []
  const candidate = response.response?.candidates?.[0]
  const parts = candidate?.content?.parts ?? []

  for (const part of parts) {
    if (part.thought && part.text) {
      content.push({ type: 'thinking', thinking: part.text })
    } else if (part.text && !part.thought) {
      // Strip [thought] wrappers
      let text = part.text
      text = text.replace(/\[thought\][\s\S]*?\[\/thought\]\n?/g, '')
      if (text) {
        content.push({ type: 'text', text })
      }
    } else if (part.functionCall) {
      const fc = part.functionCall
      content.push({
        type: 'tool_use',
        id: `call_${crypto.randomUUID().replace(/-/g, '')}`,
        name: fc.name ?? 'unknown',
        input: fc.args ?? {},
      })
    }
  }

  const finishReason = candidate?.finishReason
  const stopReason =
    finishReason === 'STOP'
      ? 'end_turn'
      : finishReason === 'MAX_TOKENS'
        ? 'max_tokens'
        : finishReason === 'TOOL_CALLS' || finishReason === 'TOOL_CODE'
          ? 'tool_use'
          : 'end_turn'

  const usage = response.response?.usageMetadata

  return {
    id: makeMessageId(),
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: usage?.promptTokenCount ?? 0,
      output_tokens: usage?.candidatesTokenCount ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
}

// ---------------------------------------------------------------------------
// The shim client — duck-types as Anthropic SDK
// ---------------------------------------------------------------------------

class GeminiShimStream {
  private generator: AsyncGenerator<AnthropicStreamEvent>
  controller = new AbortController()

  constructor(generator: AsyncGenerator<AnthropicStreamEvent>) {
    this.generator = generator
  }

  async *[Symbol.asyncIterator]() {
    yield* this.generator
  }
}

class GeminiShimMessages {
  private apiKey: string
  private model: string

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey
    this.model = model
  }

  async create(
    params: ShimCreateParams,
    options?: { signal?: AbortSignal },
  ) {
    const genAI = new GoogleGenerativeAI(this.apiKey)
    const modelName = params.model || this.model

    const systemPrompt = convertSystemPrompt(params.system)
    const contents = convertMessages(
      params.messages as Array<{
        role: string
        message?: { role?: string; content?: unknown }
        content?: unknown
      }>,
    )

    const generationConfig: GenerationConfig = {}
    if (params.temperature !== undefined)
      generationConfig.temperature = params.temperature
    if (params.top_p !== undefined) generationConfig.topP = params.top_p
    if (params.max_tokens)
      generationConfig.maxOutputTokens = params.max_tokens

    // Enable thinking if the model supports it
    generationConfig.thinkingConfig = {
      includeThoughts: true,
    }

    const tools =
      params.tools && params.tools.length > 0
        ? convertTools(
            params.tools as Array<{
              name: string
              description?: string
              input_schema?: Record<string, unknown>
            }>,
          )
        : undefined

    // Handle tool_choice
    let toolConfig: Record<string, unknown> | undefined
    if (params.tool_choice) {
      const tc = params.tool_choice as { type?: string; name?: string }
      if (tc.type === 'auto') {
        toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
      } else if (tc.type === 'any') {
        toolConfig = { functionCallingConfig: { mode: 'ANY' } }
      } else if (tc.type === 'none') {
        toolConfig = { functionCallingConfig: { mode: 'NONE' } }
      } else if (tc.type === 'tool' && tc.name) {
        toolConfig = {
          functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: [tc.name],
          },
        }
      }
    }

    const modelInstance = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt || undefined,
      tools,
      toolConfig,
      generationConfig,
    })

    if (params.stream) {
      const streamResult = await modelInstance.generateContentStream(
        { contents },
        { signal: options?.signal },
      )
      return new GeminiShimStream(
        geminiStreamToAnthropic(streamResult, modelName),
      )
    }

    // Non-streaming — return a promise with .withResponse() like the OpenAI shim
    const promise = (async () => {
      const result = await modelInstance.generateContent(
        { contents },
        { signal: options?.signal },
      )
      return convertGeminiResponseToAnthropic(result, modelName)
    })()

    const httpResponse = new Response()
    ;(promise as unknown as Record<string, unknown>).withResponse =
      async () => {
        const data = await promise
        return {
          data,
          response: httpResponse,
          request_id: makeMessageId(),
        }
      }

    return promise
  }
}

class GeminiShimBeta {
  messages: GeminiShimMessages

  constructor(apiKey: string, model: string) {
    this.messages = new GeminiShimMessages(apiKey, model)
  }
}

export function createGeminiShimClient(options: {
  apiKey?: string
  model?: string
}): unknown {
  const apiKey =
    options.apiKey ??
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    ''
  const model =
    options.model ??
    process.env.GEMINI_MODEL ??
    process.env.OPENAI_MODEL ??
    'gemini-2.0-flash'

  if (!apiKey) {
    throw new Error(
      'Gemini API key is required. Set GEMINI_API_KEY or GOOGLE_API_KEY.',
    )
  }

  const beta = new GeminiShimBeta(apiKey, model)

  return {
    beta,
    messages: beta.messages,
  }
}
