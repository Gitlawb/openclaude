/**
 * Streaming Response Optimizer
 * 
 * Chunk buffering for smooth streaming with backpressure handling.
 * Production-grade implementation for OpenAI-compatible responses.
 */

export interface StreamConfig {
  bufferSize: number
  flushInterval: number
  maxBufferSize: number
  minChunkSize: number
}

const DEFAULT_STREAM_CONFIG: StreamConfig = {
  bufferSize: 1024,
  flushInterval: 50,
  maxBufferSize: 4096,
  minChunkSize: 64,
}

function getStreamConfig(): StreamConfig {
  return {
    bufferSize: parseInt(process.env.STREAM_BUFFER_SIZE || '1024'),
    flushInterval: parseInt(process.env.STREAM_FLUSH_INTERVAL || '50'),
    maxBufferSize: parseInt(process.env.STREAM_MAX_BUFFER || '4096'),
    minChunkSize: parseInt(process.env.STREAM_MIN_CHUNK || '64'),
  }
}

export interface StreamState {
  buffer: string
  lastFlush: number
  totalChunks: number
  totalTokens: number
  firstTokenTime: number | null
  lastTokenTime: number
}

export function createStreamState(): StreamState {
  return {
    buffer: '',
    lastFlush: Date.now(),
    totalChunks: 0,
    totalTokens: 0,
    firstTokenTime: null,
    lastTokenTime: Date.now(),
  }
}

function shouldFlush(state: StreamState, config: StreamConfig): boolean {
  const now = Date.now()
  const timeSinceFlush = now - state.lastFlush
  const bufferLength = state.buffer.length
  
  if (bufferLength >= config.maxBufferSize) return true
  if (timeSinceFlush >= config.flushInterval) return true
  if (bufferLength >= config.minChunkSize && timeSinceFlush >= config.flushInterval / 2) return true
  
  return false
}

export function processStreamChunk(
  state: StreamState,
  chunk: string,
  config?: StreamConfig,
): string | null {
  const cfg = config ?? getStreamConfig()
  
  if (state.firstTokenTime === null) {
    state.firstTokenTime = Date.now()
  }
  
  state.buffer += chunk
  state.lastTokenTime = Date.now()
  
  if (shouldFlush(state, cfg)) {
    state.lastFlush = Date.now()
    state.totalChunks++
    const output = state.buffer
    state.buffer = ''
    return output
  }
  
  return null
}

export function flushStreamBuffer(state: StreamState): string {
  if (state.buffer.length > 0) {
    state.totalChunks++
    const output = state.buffer
    state.buffer = ''
    state.lastFlush = Date.now()
    return output
  }
  return ''
}

export async function* streamResponse(
  stream: AsyncIterable<string>,
  config?: StreamConfig,
): AsyncGenerator<string> {
  const cfg = config ?? getStreamConfig()
  const state = createStreamState()
  
  for await (const chunk of stream) {
    const flushed = processStreamChunk(state, chunk, cfg)
    if (flushed) {
      yield flushed
    }
  }
  
  const remaining = flushStreamBuffer(state)
  if (remaining) {
    yield remaining
  }
}

export function getStreamStats(state: StreamState): {
  totalChunks: number
  totalTokens: number
  firstTokenMs: number | null
  durationMs: number
  tokensPerSecond: number
} {
  const durationMs = state.lastTokenTime - (state.firstTokenTime ?? state.lastTokenTime)
  const tokensPerSecond = durationMs > 0 
    ? (state.totalTokens / durationMs) * 1000 
    : 0
  
  return {
    totalChunks: state.totalChunks,
    totalTokens: state.totalTokens,
    firstTokenMs: state.firstTokenTime ? Date.now() - state.firstTokenTime : null,
    durationMs,
    tokensPerSecond,
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export async function* bufferedStreamResponse(
  stream: AsyncIterable<string>,
  onChunk?: (text: string, tokens: number) => void,
): AsyncGenerator<string> {
  const state = createStreamState()
  
  for await (const chunk of stream) {
    const tokens = estimateTokens(chunk)
    state.totalTokens += tokens
    
    const flushed = processStreamChunk(state, chunk)
    if (flushed) {
      yield flushed
      onChunk?.(flushed, tokens)
    }
  }
  
  const remaining = flushStreamBuffer(state)
  if (remaining) {
    yield remaining
    onChunk?.(remaining, estimateTokens(remaining))
  }
}