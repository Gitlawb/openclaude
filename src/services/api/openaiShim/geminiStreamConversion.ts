import { buildAnthropicUsageFromRawUsage } from '../cacheMetrics.js'
import type { AnthropicStreamEvent, AnthropicUsage } from '../codexShim.js'
import { logForDebugging } from '../../../utils/debug.js'

type ReaderCanceller = {
  cancel(error?: unknown): void
  cleanup(): void
}

type StreamReadResult = Awaited<
  ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>
>

export type GeminiStreamDependencies = {
  createReaderCanceller(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal?: AbortSignal,
  ): ReaderCanceller
  createStreamAbortError(): DOMException
  getStreamIdleTimeoutMs(): number
  makeMessageId(): string
  readWithIdleTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs: number,
    options?: {
      signal?: AbortSignal
      cancelReader?: (error?: unknown) => void
      onTimeout?: () => void
    },
  ): Promise<StreamReadResult>
  throwIfStreamAborted(signal?: AbortSignal): void
}

export async function* geminiSseToAnthropic(
  response: Response,
  model: string,
  signal: AbortSignal | undefined,
  dependencies: GeminiStreamDependencies,
): AsyncGenerator<AnthropicStreamEvent> {
  const {
    createReaderCanceller,
    createStreamAbortError,
    getStreamIdleTimeoutMs,
    makeMessageId,
    readWithIdleTimeout,
    throwIfStreamAborted,
  } = dependencies
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Response body is not readable')
  const readerCanceller = createReaderCanceller(reader, signal)
  const decoder = new TextDecoder()
  let buffer = ''
  const messageId = makeMessageId()
  let contentBlockIndex = 0
  let hasEmittedStart = false
  let hasEmittedTextStart = false
  let hasEmittedCurrentTool = false
  let usage: Partial<AnthropicUsage> | undefined
  let finishReason: string | undefined
  const streamIdleTimeoutMs = getStreamIdleTimeoutMs()
  let lastDataTime = Date.now()
  let streamComplete = false

  const mapFinishReason = (
    reason: string | undefined,
    hasToolUse: boolean,
  ): 'tool_use' | 'max_tokens' | 'end_turn' => {
    if (hasToolUse) return 'tool_use'
    if (reason === 'MAX_TOKENS') return 'max_tokens'
    return 'end_turn'
  }

  try {
    while (true) {
      const { done, value } = await readWithIdleTimeout(
        reader,
        streamIdleTimeoutMs,
        {
          signal,
          cancelReader: readerCanceller.cancel,
          onTimeout: () => {
            const elapsed = Math.round((Date.now() - lastDataTime) / 1000)
            logForDebugging(
              `Gemini SSE stream idle for ${elapsed}s (limit: ${streamIdleTimeoutMs / 1000}s). Connection likely dropped.`,
              { level: 'error' },
            )
          },
        },
      )
      if (done) {
        streamComplete = true
        break
      }
      if (value) lastDataTime = Date.now()

      throwIfStreamAborted(signal)
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''

      for (const chunk of chunks) {
        throwIfStreamAborted(signal)
        const lines = chunk.split('\n').map(line => line.trim()).filter(Boolean)
        const dataLines = lines.filter(line => line.startsWith('data: '))
        if (dataLines.length === 0) continue

        const rawData = dataLines.map(line => line.slice(6)).join('\n')
        if (rawData === '[DONE]') {
          if (hasEmittedTextStart || hasEmittedCurrentTool) {
            throwIfStreamAborted(signal)
            yield { type: 'content_block_stop', index: contentBlockIndex }
          }
          throwIfStreamAborted(signal)
          yield {
            type: 'message_delta',
            delta: {
              stop_reason: mapFinishReason(
                finishReason,
                hasEmittedCurrentTool,
              ),
            },
            usage: usage ?? {},
          }
          throwIfStreamAborted(signal)
          yield { type: 'message_stop' }
          streamComplete = true
          return
        }

        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(rawData) as Record<string, unknown>
        } catch {
          continue
        }

        if (!hasEmittedStart) {
          throwIfStreamAborted(signal)
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
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          }
          hasEmittedStart = true
        }

        if (parsed.usageMetadata && typeof parsed.usageMetadata === 'object') {
          const metadata = parsed.usageMetadata as Record<string, number>
          usage = buildAnthropicUsageFromRawUsage({
            input_tokens: metadata.promptTokenCount ?? 0,
            output_tokens:
              (metadata.candidatesTokenCount ?? 0) +
              (metadata.thoughtsTokenCount ?? 0),
          })
        }

        const candidates = parsed.candidates as
          | Array<Record<string, unknown>>
          | undefined
        if (!candidates?.length) continue
        const candidate = candidates[0]
        if (typeof candidate.finishReason === 'string') {
          finishReason = candidate.finishReason
        }

        const content = candidate.content as
          | { role?: string; parts?: Array<Record<string, unknown>> }
          | undefined
        if (!content?.parts) continue

        for (const part of content.parts) {
          throwIfStreamAborted(signal)
          const text = typeof part.text === 'string' ? part.text : undefined
          const functionCall = part.functionCall as
            | { name?: string; args?: unknown }
            | undefined

          if (text) {
            if (hasEmittedCurrentTool) {
              throwIfStreamAborted(signal)
              yield { type: 'content_block_stop', index: contentBlockIndex }
              contentBlockIndex++
              hasEmittedCurrentTool = false
            }
            if (!hasEmittedTextStart) {
              throwIfStreamAborted(signal)
              yield {
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: { type: 'text', text: '' },
              }
              hasEmittedTextStart = true
            }
            throwIfStreamAborted(signal)
            yield {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: { type: 'text_delta', text },
            }
          } else if (functionCall?.name) {
            if (hasEmittedTextStart) {
              throwIfStreamAborted(signal)
              yield { type: 'content_block_stop', index: contentBlockIndex }
              contentBlockIndex++
              hasEmittedTextStart = false
            }
            const toolId = `toolu_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
            throwIfStreamAborted(signal)
            yield {
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: {
                type: 'tool_use',
                id: toolId,
                name: functionCall.name,
                input: {},
              },
            }
            hasEmittedCurrentTool = true
            throwIfStreamAborted(signal)
            yield {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json:
                  typeof functionCall.args === 'string'
                    ? functionCall.args
                    : JSON.stringify(functionCall.args ?? {}),
              },
            }
          }
        }
      }
    }

    if (hasEmittedTextStart || hasEmittedCurrentTool) {
      throwIfStreamAborted(signal)
      yield { type: 'content_block_stop', index: contentBlockIndex }
    }
    throwIfStreamAborted(signal)
    yield {
      type: 'message_delta',
      delta: {
        stop_reason: mapFinishReason(finishReason, hasEmittedCurrentTool),
      },
      usage: usage ?? {},
    }
    throwIfStreamAborted(signal)
    yield { type: 'message_stop' }
    streamComplete = true
  } finally {
    if (!streamComplete || signal?.aborted) {
      readerCanceller.cancel(createStreamAbortError())
    }
    readerCanceller.cleanup()
    reader.releaseLock()
  }
}
