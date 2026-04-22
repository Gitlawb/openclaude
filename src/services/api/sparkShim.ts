/**
 * Spark (iFlytek 星火) API shim for Claude Code.
 *
 * Uses Spark OpenAI-compatible `/v1/chat/completions` endpoint with Bearer token auth.
 * Translates Anthropic SDK calls into Spark HTTP requests and streams back
 * events in the Anthropic streaming format so the rest of the codebase is unaware.
 *
 * Environment variables:
 *   CLAUDE_CODE_USE_SPARK=1              — enable this provider
 *   SPARK_API_KEY=your-api-password      — Spark API Password (from console, NOT API Key)
 *   SPARK_MODEL=generalv3.5              — default model override
 *   SPARK_BASE_URL=https://spark-api-open.xf-yun.com/v1/chat/completions  — custom endpoint
 *
 * Auth: Bearer token (Authorization: Bearer <APIPassword>)
 * Protocol: Spark OpenAI-compatible /v1/chat/completions, SSE streaming
 *
 * Note: Spark uses "functions"/"function_call" in requests (legacy OpenAI naming),
 * and wraps responses with code/message/sid fields (code=0 means success).
 */

import { APIError } from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { fetchWithProxyRetry } from './fetchWithProxyRetry.js'
import { logForDebugging } from '../../utils/debug.js'
import { compressToolHistory } from './compressToolHistory.js'
import { logApiCallStart, logApiCallEnd } from '../../utils/requestLogging.js'
import { createStreamState, processStreamChunk, getStreamStats } from '../../utils/streamingOptimizer.js'
import { sanitizeSchemaForOpenAICompat } from '../../utils/schemaSanitizer.js'

const DEFAULT_SPARK_BASE_URL = 'https://spark-api-open.xf-yun.com/v1/chat/completions'

// ---------------------------------------------------------------------------
// Types — minimal subset of Anthropic SDK types we need to produce
// ---------------------------------------------------------------------------

export interface AnthropicStreamEvent {
  type: string
  index?: number
  message?: {
    id: string
    type: string
    role: string
    content: unknown[]
    model: string
    stop_reason: string | null
    stop_sequence: string | null
    usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens: number
      cache_read_input_tokens: number
    }
  }
  delta?: {
    type: string
    text?: string
    thinking?: string
    partial_json?: string
    stop_reason?: string
    stop_sequence?: string | null
  }
  content_block?: {
    type: string
    text?: string
    thinking?: string
    id?: string
    name?: string
    input?: Record<string, unknown>
  }
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
}

export interface ShimCreateParams {
  model: string
  max_tokens: number
  messages: Array<{
    role: string
    content?: unknown
    message?: { role?: string; content?: unknown }
  }>
  system?: unknown
  stream?: boolean
  temperature?: number
  top_p?: number
  tools?: Array<{
    name: string
    description?: string
    input_schema?: Record<string, unknown>
  }>
  tool_choice?: { type?: string; name?: string }
}

// ---------------------------------------------------------------------------
// Message conversion: Anthropic → OpenAI
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: string
  content: unknown
  name?: string
  tool_calls?: Array<{
    id: string
    type: string
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

function convertSystemPrompt(system: unknown): string | null {
  if (!system) return null
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

function convertContentBlock(block: unknown): string {
  if (typeof block === 'string') return block
  if (!block || typeof block !== 'object') return ''

  const b = block as Record<string, unknown>
  switch (b.type) {
    case 'text':
      return (b.text as string) ?? ''
    case 'tool_result':
      if (typeof b.content === 'string') return b.content
      if (Array.isArray(b.content)) {
        return b.content
          .map((sub: Record<string, unknown>) => sub.type === 'text' ? (sub.text as string) ?? '' : '')
          .filter(Boolean)
          .join('\n')
      }
      if (b.content && typeof b.content === 'object') return JSON.stringify(b.content)
      return ''
    case 'thinking':
    case 'redacted_thinking':
      return ''
    default:
      return (b.text as string) ?? ''
  }
}

function convertMessages(
  messages: Array<{
    role: string
    content?: unknown
    message?: { role?: string; content?: unknown }
  }>,
  system: unknown,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  const sysText = convertSystemPrompt(system)
  if (sysText) {
    result.push({ role: 'system', content: sysText })
  }

  for (const msg of messages) {
    const inner = msg.message ?? msg
    const role = (inner as { role?: string }).role ?? msg.role
    const content = (inner as { content?: unknown }).content

    if (role === 'user') {
      if (Array.isArray(content)) {
        const parts = content.map(convertContentBlock).filter(Boolean)
        if (parts.length > 0) {
          result.push({ role: 'user', content: parts.join('\n') })
        }
      } else if (content) {
        result.push({ role: 'user', content: String(content) })
      }
    } else if (role === 'assistant') {
      if (Array.isArray(content)) {
        const textParts: string[] = []
        const toolCalls: OpenAIMessage['tool_calls'] = []
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text)
          }
          if (block.type === 'tool_use') {
            toolCalls?.push({
              id: block.id ?? `call_${randomUUID().replace(/-/g, '')}`,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input ?? {}),
              },
            })
          }
        }
        if (textParts.length > 0 || toolCalls.length > 0) {
          const assistantMsg: OpenAIMessage = {
            role: 'assistant',
            content: textParts.length > 0 ? textParts.join('\n') : null,
          }
          if (toolCalls.length > 0) {
            assistantMsg.tool_calls = toolCalls
          }
          result.push(assistantMsg)
        }
      } else if (content) {
        result.push({ role: 'assistant', content: String(content) })
      }
    } else if (role === 'tool') {
      if (Array.isArray(content)) {
        const text = content.map(convertContentBlock).filter(Boolean).join('\n')
        if (text) {
          result.push({ role: 'tool', content: text })
        }
      } else if (content) {
        result.push({ role: 'tool', content: String(content) })
      }
    }
  }

  // Coalesce consecutive messages of the same role
  const coalesced: OpenAIMessage[] = []
  for (const msg of result) {
    const prev = coalesced[coalesced.length - 1]
    if (prev && prev.role === msg.role) {
      const prevContent = typeof prev.content === 'string' ? prev.content : ''
      const msgContent = typeof msg.content === 'string' ? msg.content : ''
      prev.content = prevContent + '\n' + msgContent
    } else {
      coalesced.push(msg)
    }
  }

  return coalesced
}

// ---------------------------------------------------------------------------
// Tool conversion
// ---------------------------------------------------------------------------

function normalizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const record = sanitizeSchemaForOpenAICompat(schema)
  if (record.type === 'object' && record.properties) {
    const properties = record.properties as Record<string, unknown>
    const existingRequired = Array.isArray(record.required) ? record.required as string[] : []
    record.required = existingRequired.filter(k => k in properties)
    record.additionalProperties = false
  }
  if ('items' in record && record.items) {
    if (Array.isArray(record.items)) {
      record.items = record.items.map(item => normalizeSchema(item as Record<string, unknown>))
    } else {
      record.items = normalizeSchema(record.items as Record<string, unknown>)
    }
  }
  return record
}

function convertTools(
  tools: Array<{
    name: string
    description?: string
    input_schema?: Record<string, unknown>
  }>,
) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: normalizeSchema(t.input_schema ?? { type: 'object', properties: {} }),
    },
  }))
}

// ---------------------------------------------------------------------------
// Streaming: OpenAI SSE → Anthropic stream events
// ---------------------------------------------------------------------------

interface OpenAIStreamChunk {
  id?: string
  model?: string
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
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

async function* openAIStreamToAnthropic(
  response: Response,
  model: string,
  signal?: AbortSignal,
): AsyncGenerator<AnthropicStreamEvent> {
  const messageId = `msg_${randomUUID().replace(/-/g, '')}`
  let contentBlockIndex = 0
  let hasEmittedContentStart = false
  let hasEmittedFinalUsage = false
  let hasProcessedFinishReason = false
  let lastStopReason: 'tool_use' | 'max_tokens' | 'end_turn' | null = null
  const streamState = createStreamState()

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
  const STREAM_IDLE_TIMEOUT_MS = 120_000

  async function readWithTimeout(): Promise<ReadableStreamReadResult<Uint8Array>> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(
          `Spark SSE stream idle for ${STREAM_IDLE_TIMEOUT_MS / 1000}s. Connection likely dropped.`,
        ))
      }, STREAM_IDLE_TIMEOUT_MS)

      let abortCleanup: (() => void) | undefined
      if (signal) {
        abortCleanup = () => clearTimeout(timeoutId)
        signal.addEventListener('abort', abortCleanup, { once: true })
      }

      reader.read().then(
        result => {
          clearTimeout(timeoutId)
          if (signal && abortCleanup) signal.removeEventListener('abort', abortCleanup)
          resolve(result)
        },
        err => {
          clearTimeout(timeoutId)
          if (signal && abortCleanup) signal.removeEventListener('abort', abortCleanup)
          reject(err)
        },
      )
    })
  }

  try {
    while (true) {
      const { done, value } = await readWithTimeout()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data: ')) continue

        let chunk: OpenAIStreamChunk & { code?: number; message?: string }
        try {
          chunk = JSON.parse(trimmed.slice(6))
        } catch {
          continue
        }

        // Spark error: non-zero code means failure
        if (chunk.code !== undefined && chunk.code !== 0) {
          const msg = chunk.message ?? `Spark error code ${chunk.code}`
          throw new Error(msg)
        }

        // Spark end marker: empty choices array with usage
        const isEndFrame = Array.isArray(chunk.choices) && chunk.choices.length === 0
        if (isEndFrame) {
          // Close any open content block
          if (hasEmittedContentStart) {
            yield { type: 'content_block_stop', index: contentBlockIndex }
            contentBlockIndex++
            hasEmittedContentStart = false
          }

          // Set finish reason if not already done
          if (!hasProcessedFinishReason) {
            hasProcessedFinishReason = true
            lastStopReason = 'end_turn'
            yield {
              type: 'message_delta',
              delta: { stop_reason: lastStopReason, stop_sequence: null },
            }
          }

          // Emit usage if present
          if (chunk.usage && !hasEmittedFinalUsage) {
            hasEmittedFinalUsage = true
            yield {
              type: 'message_delta',
              delta: { stop_reason: lastStopReason, stop_sequence: null },
              usage: {
                input_tokens: chunk.usage.prompt_tokens ?? 0,
                output_tokens: chunk.usage.completion_tokens ?? 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            }
          }
          continue
        }

        const choice = chunk.choices?.[0]
        if (!choice) continue

        const delta = choice.delta
        const finishReason = choice.finish_reason

        // Tool calls
        if (delta?.tool_calls?.length) {
          for (const tc of delta.tool_calls) {
            if (tc.id) {
              // New tool call
              if (hasEmittedContentStart) {
                yield { type: 'content_block_stop', index: contentBlockIndex }
                contentBlockIndex++
                hasEmittedContentStart = false
              }
              yield {
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: {
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.function?.name ?? 'unknown',
                  input: {},
                },
              }
              contentBlockIndex++
            }
            if (tc.function?.arguments) {
              yield {
                type: 'content_block_delta',
                index: contentBlockIndex - 1,
                delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
              }
            }
          }
          continue
        }

        // Text content
        const textContent = delta?.content ?? ''
        if (textContent) {
          processStreamChunk(streamState, textContent)

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
            delta: { type: 'text_delta', text: textContent },
          }
        }

        // Finish
        if (finishReason && !hasProcessedFinishReason) {
          hasProcessedFinishReason = true

          if (hasEmittedContentStart) {
            yield { type: 'content_block_stop', index: contentBlockIndex }
            contentBlockIndex++
            hasEmittedContentStart = false
          }

          lastStopReason = finishReason === 'tool_calls' ? 'tool_use'
            : finishReason === 'length' ? 'max_tokens'
            : 'end_turn'

          yield {
            type: 'message_delta',
            delta: { stop_reason: lastStopReason, stop_sequence: null },
          }
        }

        // Usage
        if (chunk.usage && !hasEmittedFinalUsage && lastStopReason !== null) {
          hasEmittedFinalUsage = true
          yield {
            type: 'message_delta',
            delta: { stop_reason: lastStopReason, stop_sequence: null },
            usage: {
              input_tokens: chunk.usage.prompt_tokens ?? 0,
              output_tokens: chunk.usage.completion_tokens ?? 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  const stats = getStreamStats(streamState)
  if (stats.totalChunks > 0) {
    logForDebugging(
      JSON.stringify({
        type: 'stream_stats',
        model,
        total_chunks: stats.totalChunks,
        first_token_ms: stats.firstTokenMs,
        duration_ms: stats.durationMs,
      }),
      { level: 'debug' },
    )
  }

  yield { type: 'message_stop' }
}

// ---------------------------------------------------------------------------
// Non-streaming response conversion
// ---------------------------------------------------------------------------

function convertNonStreamingResponse(
  data: {
    code?: number
    message?: string
    sid?: string
    id?: string
    model: string
    choices: Array<{
      message: { role: string; content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }
      finish_reason: string
    }>
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  },
  model: string,
) {
  // Check for Spark error
  if (data.code !== undefined && data.code !== 0) {
    throw APIError.generate(
      400,
      undefined,
      `Spark API error (code ${data.code}): ${data.message ?? 'unknown'}`,
      new Headers(),
    )
  }

  const content: Array<Record<string, unknown>> = []
  const choice = data.choices?.[0]
  if (choice?.message?.content) {
    content.push({ type: 'text', text: choice.message.content })
  }
  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments || '{}'),
      })
    }
  }

  return {
    id: data.id ?? `msg_${randomUUID().replace(/-/g, '')}`,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: choice?.finish_reason === 'tool_calls' ? 'tool_use'
      : choice?.finish_reason === 'length' ? 'max_tokens'
      : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
}

// ---------------------------------------------------------------------------
// The shim client — duck-types as Anthropic SDK
// ---------------------------------------------------------------------------

class SparkShimStream {
  private generator: AsyncGenerator<AnthropicStreamEvent>
  controller = new AbortController()

  constructor(generator: AsyncGenerator<AnthropicStreamEvent>) {
    this.generator = generator
  }

  async *[Symbol.asyncIterator]() {
    yield* this.generator
  }
}

class SparkShimMessages {
  private defaultHeaders: Record<string, string>

  constructor(defaultHeaders: Record<string, string>) {
    this.defaultHeaders = defaultHeaders
  }

  async create(
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    const sparkApiKey = process.env.SPARK_API_KEY

    if (!sparkApiKey) {
      throw new Error(
        'Spark API key required. Set SPARK_API_KEY.',
      )
    }

    const baseUrl = process.env.SPARK_BASE_URL ?? DEFAULT_SPARK_BASE_URL
    const model = params.model

    // Compress tool history
    const compressedMessages = compressToolHistory(
      params.messages as Array<{
        role: string
        message?: { role?: string; content?: unknown }
        content?: unknown
      }>,
      model,
    )

    // Convert messages to OpenAI format
    const openaiMessages = convertMessages(compressedMessages, params.system)

    // Build OpenAI-compatible request body
    const body: Record<string, unknown> = {
      model,
      messages: openaiMessages,
      max_tokens: params.max_tokens ?? 4096,
      temperature: params.temperature ?? 0.7,
      stream: params.stream ?? true,
      ...(params.top_p !== undefined ? { top_p: params.top_p } : {}),
    }

    // Add tools if present — Spark uses "functions" (legacy OpenAI naming)
    if (params.tools && params.tools.length > 0) {
      body.functions = convertTools(
        params.tools as Array<{
          name: string
          description?: string
          input_schema?: Record<string, unknown>
        }>,
      )
      if (params.tool_choice) {
        body.function_call = params.tool_choice.type === 'any' ? 'auto'
          : params.tool_choice.type === 'auto' ? 'auto'
          : { name: params.tool_choice.name }
      }
    }

    const stream = params.stream ?? true

    // Bearer token auth
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sparkApiKey}`,
      ...this.defaultHeaders,
    }

    const serializedBody = JSON.stringify(body)

    const provider = 'spark'
    const { correlationId, startTime } = logApiCallStart(provider, model)

    try {
      const response = await fetchWithProxyRetry(baseUrl, {
        method: 'POST',
        headers,
        body: serializedBody,
        signal: options?.signal,
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown error')
        throw APIError.generate(
          response.status,
          undefined,
          `Spark API error ${response.status}: ${errorBody.slice(0, 500)}`,
          response.headers as unknown as Headers,
        )
      }

      let tokensIn = 0
      let tokensOut = 0

      if (stream) {
        logApiCallEnd(correlationId, startTime, model, 'success', tokensIn, tokensOut, false)
        return new SparkShimStream(
          openAIStreamToAnthropic(response, model, options?.signal),
        )
      }

      // Non-streaming
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const data = await response.json()
        const result = convertNonStreamingResponse(data, model)
        try {
          const clone = response.clone()
          const json = await clone.json()
          tokensIn = json.usage?.prompt_tokens ?? 0
          tokensOut = json.usage?.completion_tokens ?? 0
        } catch { /* ignore */ }
        logApiCallEnd(correlationId, startTime, model, 'success', tokensIn, tokensOut, false)
        return result
      }

      const textBody = await response.text().catch(() => '')
      throw APIError.generate(
        response.status,
        undefined,
        `Spark API error: unexpected response: ${textBody.slice(0, 500)}`,
        response.headers as unknown as Headers,
      )
    } catch (error) {
      if (error instanceof APIError) throw error
      throw APIError.generate(
        500,
        undefined,
        `Spark API request failed: ${error instanceof Error ? error.message : String(error)}`,
        new Headers(),
      )
    }
  }
}

class SparkShimBeta {
  messages: SparkShimMessages

  constructor(defaultHeaders: Record<string, string>) {
    this.messages = new SparkShimMessages(defaultHeaders)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createSparkShimClient(options: {
  defaultHeaders?: Record<string, string>
  maxRetries?: number
  timeout?: number
}): unknown {
  const beta = new SparkShimBeta({
    ...(options.defaultHeaders ?? {}),
  })

  return {
    beta,
    messages: beta.messages,
  }
}
