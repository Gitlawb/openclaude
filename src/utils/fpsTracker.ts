export type FpsMetrics = {
  averageFps: number
  low1PctFps: number
}

const MAX_FRAME_DURATION_SAMPLES = 5000

export class FpsTracker {
  private frameDurations: number[] = new Array(MAX_FRAME_DURATION_SAMPLES)
  private sampleCount = 0
  private totalFrameCount = 0
  private writeIndex = 0
  private firstRenderTime: number | undefined
  private lastRenderTime: number | undefined

  record(durationMs: number): void {
    const now = performance.now()
    if (this.firstRenderTime === undefined) {
      this.firstRenderTime = now
    }
    this.lastRenderTime = now
    this.totalFrameCount += 1
    this.frameDurations[this.writeIndex] = durationMs
    this.writeIndex = (this.writeIndex + 1) % MAX_FRAME_DURATION_SAMPLES
    this.sampleCount = Math.min(this.sampleCount + 1, MAX_FRAME_DURATION_SAMPLES)
  }

  getMetrics(): FpsMetrics | undefined {
    if (
      this.sampleCount === 0 ||
      this.firstRenderTime === undefined ||
      this.lastRenderTime === undefined
    ) {
      return undefined
    }

    const totalTimeMs = this.lastRenderTime - this.firstRenderTime
    if (totalTimeMs <= 0) {
      return undefined
    }

    const totalFrames = this.totalFrameCount
    const averageFps = totalFrames / (totalTimeMs / 1000)

    const sorted = this.getSamples().sort((a, b) => b - a)
    const p99Index = Math.max(0, Math.ceil(sorted.length * 0.01) - 1)
    const p99FrameTimeMs = sorted[p99Index]!
    const low1PctFps = p99FrameTimeMs > 0 ? 1000 / p99FrameTimeMs : 0

    return {
      averageFps: Math.round(averageFps * 100) / 100,
      low1PctFps: Math.round(low1PctFps * 100) / 100,
    }
  }

  private getSamples(): number[] {
    if (this.sampleCount < MAX_FRAME_DURATION_SAMPLES) {
      return this.frameDurations.slice(0, this.sampleCount)
    }

    return [
      ...this.frameDurations.slice(this.writeIndex),
      ...this.frameDurations.slice(0, this.writeIndex),
    ]
  }
}
