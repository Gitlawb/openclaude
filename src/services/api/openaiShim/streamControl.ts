const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 90_000
const MAX_STREAM_IDLE_TIMEOUT_MS = 2_147_483_647

export class StreamIdleTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Stream idle timeout - no chunks received for ${timeoutMs}ms`)
    this.name = 'StreamIdleTimeoutError'
  }
}

export function createStreamAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

export function throwIfStreamAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createStreamAbortError()
  }
}

type StreamReadResult = Awaited<
  ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>
>

export function createReaderCanceller(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): {
    cancel: (error?: unknown) => void
    cleanup: () => void
  } {
  let cancelled = false
  const cancel = (error: unknown = createStreamAbortError()) => {
    if (cancelled) return
    cancelled = true
    void reader.cancel(error).catch(() => {})
  }
  const onAbort = () => cancel(createStreamAbortError())

  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) {
    onAbort()
  }

  return {
    cancel,
    cleanup: () => signal?.removeEventListener('abort', onAbort),
  }
}

export function getStreamIdleTimeoutMs(): number {
  const raw = process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS?.trim()
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_STREAM_IDLE_TIMEOUT_MS
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_STREAM_IDLE_TIMEOUT_MS)
    : DEFAULT_STREAM_IDLE_TIMEOUT_MS
}

export async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  options: {
    signal?: AbortSignal
    cancelReader?: (error?: unknown) => void
    onTimeout?: () => void
  } = {},
): Promise<StreamReadResult> {
  const signal = options.signal
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  return new Promise<StreamReadResult>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
      signal?.removeEventListener('abort', onAbort)
    }
    const finishResolve = (value: StreamReadResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const finishReject = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const cancelAndReject = (error: unknown) => {
      finishReject(error)
      try {
        if (options.cancelReader) {
          options.cancelReader(error)
        } else {
          void reader.cancel(error).catch(() => {})
        }
      } catch {
        // Cancellation is best effort; preserve the original stream error.
      }
    }
    const onAbort = () => cancelAndReject(createStreamAbortError())

    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }

    timeoutId = setTimeout(() => {
      const error = new StreamIdleTimeoutError(timeoutMs)
      try {
        options.onTimeout?.()
      } catch {
        // Ignore diagnostic callback failures.
      }
      cancelAndReject(error)
    }, timeoutMs)

    reader.read().then(finishResolve, finishReject)
  })
}

/**
 * Parses an Anthropic Messages SSE response while applying the same abort,
 * reader-cancellation, and idle-timeout policy used by converted streams.
 */
export async function* anthropicSsePassthrough<T extends object>(
  response: Response,
  signal: AbortSignal | undefined,
  logForDebugging: (message: string, options?: { level?: 'error' }) => void,
): AsyncGenerator<T> {
  const readerOrNull = response.body?.getReader()
  if (!readerOrNull) throw new Error('Response body is not readable')
  const reader: ReadableStreamDefaultReader<Uint8Array> = readerOrNull
  const readerCanceller = createReaderCanceller(reader, signal)
  const decoder = new TextDecoder()
  let buffer = ''
  const streamIdleTimeoutMs = getStreamIdleTimeoutMs()
  let lastDataTime = Date.now()
  let streamComplete = false

  try {
    while (true) {
      const { done, value } = await readWithIdleTimeout(reader, streamIdleTimeoutMs, {
        signal,
        cancelReader: readerCanceller.cancel,
        onTimeout: () => {
          const elapsed = Math.round((Date.now() - lastDataTime) / 1000)
          logForDebugging(
            `Anthropic-compatible SSE stream idle for ${elapsed}s (limit: ${streamIdleTimeoutMs / 1000}s). Connection likely dropped.`,
            { level: 'error' },
          )
        },
      })
      if (done) {
        streamComplete = true
        buffer += decoder.decode()
      } else {
        if (value) lastDataTime = Date.now()
        throwIfStreamAborted(signal)
        buffer += decoder.decode(value, { stream: true })
      }
      const chunks = done ? (buffer ? [buffer] : []) : buffer.split(/\r\n\r\n|\n\n|\r\r/)
      buffer = done ? '' : (chunks.pop() ?? '')
      for (const chunk of chunks) {
        throwIfStreamAborted(signal)
        const lines = chunk.split(/\r\n|\n|\r/).map(line => line.trim()).filter(Boolean)
        const dataLines = lines.filter(line => line.startsWith('data:'))
        if (dataLines.length === 0) continue
        const rawData = dataLines.map(line => line.slice(5).replace(/^ /, '')).join('\n')
        if (rawData === '[DONE]') {
          streamComplete = true
          readerCanceller.cancel()
          return
        }
        let parsed: T
        try {
          parsed = JSON.parse(rawData) as T
        } catch {
          // Ignore malformed frames and continue parsing later frames.
          continue
        }
        if (parsed && typeof parsed === 'object' && 'type' in parsed) {
          throwIfStreamAborted(signal)
          yield parsed as Awaited<T>
        }
      }
      if (done) break
    }
  } finally {
    if (!streamComplete || signal?.aborted) readerCanceller.cancel(createStreamAbortError())
    readerCanceller.cleanup()
    reader.releaseLock()
  }
}
