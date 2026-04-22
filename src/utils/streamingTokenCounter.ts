/**
 * Streaming Token Counter - Accurate token counting during generation
 * 
 * Accumulates raw content and counts tokens at consistent boundaries
 * to avoid dependency on arbitrary chunk boundaries.
 */

import { roughTokenCountEstimation } from '../services/tokenEstimation.js'

export class StreamingTokenCounter {
  private inputTokens = 0
  private accumulatedContent = ''
  private lastCountedIndex = 0
  private cachedOutputTokens = 0
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
   * Add content from a streaming chunk
   * Accumulates raw content, counting only at word boundaries
   * to avoid instability from arbitrary chunk boundaries.
   */
  addChunk(deltaContent?: string): void {
    if (deltaContent) {
      this.accumulatedContent += deltaContent
      this.recountAtWordBoundary()
    }
  }

  /**
   * Recount tokens at word boundaries for stability.
   * Only counts after whitespace to avoid mid-word splits.
   */
  private recountAtWordBoundary(): void {
    const content = this.accumulatedContent
    const lastSpace = content.lastIndexOf(' ', this.lastCountedIndex)
    
    // Only recount if we have content past the last counted index
    // and we're at a word boundary (or near end)
    if (lastSpace > this.lastCountedIndex || content.length - this.lastCountedIndex > 50) {
      const toCount = content.slice(0, lastSpace > 0 ? lastSpace : content.length)
      this.cachedOutputTokens = roughTokenCountEstimation(toCount)
      this.lastCountedIndex = lastSpace > 0 ? lastSpace : content.length
    }
  }

  /**
   * Flush remaining content and finalize count.
   * Call this when stream completes.
   */
  finalize(): number {
    if (this.accumulatedContent.length > this.lastCountedIndex) {
      this.cachedOutputTokens = roughTokenCountEstimation(this.accumulatedContent)
      this.lastCountedIndex = this.accumulatedContent.length
    }
    return this.cachedOutputTokens
  }

  /** Get total tokens (input + output) */
  get total(): number {
    return this.inputTokens + this.cachedOutputTokens
  }

  /** Get output tokens only */
  get output(): number {
    return this.cachedOutputTokens
  }

  /** Get elapsed time in milliseconds */
  get elapsedMs(): number {
    return this.startTime > 0 ? Date.now() - this.startTime : 0
  }

  /** Get tokens per second generation rate */
  get tokensPerSecond(): number {
    if (this.elapsedMs === 0) return 0
    return (this.cachedOutputTokens / this.elapsedMs) * 1000
  }

  /** Get estimated total generation time based on current rate */
  getEstimatedGenerationTimeMs(): number {
    if (this.tokensPerSecond === 0) return 0
    return Math.round((this.cachedOutputTokens / this.tokensPerSecond) * 1000)
  }

  /** Get character count for raw content */
  get characterCount(): number {
    return this.accumulatedContent.length
  }

  /** Reset counter */
  reset(): void {
    this.inputTokens = 0
    this.accumulatedContent = ''
    this.lastCountedIndex = 0
    this.cachedOutputTokens = 0
    this.startTime = 0
  }
}