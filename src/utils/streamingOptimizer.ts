/**
 * Streaming Stats Tracker
 * 
 * Observational stats tracking for streaming responses.
 * No buffering - purely tracks metrics for monitoring.
 */

export interface StreamStats {
  totalChunks: number
  firstTokenMs: number | null
  durationMs: number
}

export interface StreamState {
  chunkCount: number
  firstTokenTime: number | null
  startTime: number
}

export function createStreamState(): StreamState {
  return {
    chunkCount: 0,
    firstTokenTime: null,
    startTime: Date.now(),
  }
}

export function processStreamChunk(state: StreamState, _chunk: string): void {
  if (state.firstTokenTime === null) {
    state.firstTokenTime = Date.now()
  }
  state.chunkCount++
}

export function flushStreamBuffer(_state: StreamState): string {
  return '' // No-op - kept for API compatibility
}

export function getStreamStats(state: StreamState): StreamStats {
  const now = Date.now()
  const firstTokenMs = state.firstTokenTime
    ? now - state.firstTokenTime
    : null
  const durationMs = now - state.startTime

  return {
    totalChunks: state.chunkCount,
    firstTokenMs,
    durationMs,
  }
}