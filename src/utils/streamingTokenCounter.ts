/**
 * Streaming Token Counter - Real-time token counting during generation
 * 
 * Tracks tokens as they arrive from the stream without waiting
 * for full response. Useful for live progress display.
 */

import { roughTokenCountEstimation } from '../services/tokenEstimation.js'

export class StreamingTokenCounter {
  private inputTokens = 0
  private outputTokens = 0
  private startTime = 0

  /**
   * Start tracking a new stream
   * @param initialInputTokens - Token count for system prompt + history
   */
  start(initialInputTokens?: number): void {
    this.reset()
    this.startTime = Date.now()
    this.inputTokens = initialInputTokens ?? 0
  }

  /**
   * Add tokens from a streaming chunk
   * @param deltaContent - New content received from stream
   */
  addChunk(deltaContent?: string): void {
    if (deltaContent) {
      this.outputTokens += roughTokenCountEstimation(deltaContent)
    }
  }

  /** Get total tokens (input + output) */
  get total(): number {
    return this.inputTokens + this.outputTokens
  }

  /** Get output tokens only */
  get output(): number {
    return this.outputTokens
  }

  /** Get elapsed time in milliseconds */
  get elapsedMs(): number {
    return this.startTime > 0 ? Date.now() - this.startTime : 0
  }

  /** Get tokens per second generation rate */
  get tokensPerSecond(): number {
    if (this.elapsedMs === 0) return 0
    return (this.outputTokens / this.elapsedMs) * 1000
  }

  /** Get estimated time remaining based on rate */
  getEstimatedRemainingTokens(): number {
    if (this.tokensPerSecond === 0) return 0
    return Math.round(this.outputTokens / this.tokensPerSecond)
  }

  /** Reset counter */
  reset(): void {
    this.inputTokens = 0
    this.outputTokens = 0
    this.startTime = 0
  }
}