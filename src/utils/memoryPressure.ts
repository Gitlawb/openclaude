/**
 * Memory Pressure Monitor
 *
 * Watches process RSS and triggers cleanup actions at configurable thresholds.
 * Designed to prevent OOM when running multiple OpenClaude sessions.
 */

import { logForDebugging } from './debug.js'

export type MemoryPressureLevel = 'normal' | 'elevated' | 'critical'

export interface MemoryPressureConfig {
  elevatedThresholdMB: number
  criticalThresholdMB: number
  checkIntervalMs: number
  perSessionBudgetMB: number
}

const DEFAULT_CONFIG: MemoryPressureConfig = {
  elevatedThresholdMB: 0,
  criticalThresholdMB: 0,
  checkIntervalMs: 30_000,
  perSessionBudgetMB: Number.parseInt(
    process.env.OPENCLAUDE_MAX_MEMORY_MB ?? '1536',
    10,
  ),
}

let currentLevel: MemoryPressureLevel = 'normal'
let pressureListeners: Array<(level: MemoryPressureLevel) => void> = []
let monitorInterval: ReturnType<typeof setInterval> | null = null
let compactionRequested = false

// Registry of caches that can be pruned under critical memory pressure.
// Caches register themselves at init; the monitor prunes them all when
// RSS crosses the critical threshold.
const prunableCaches: Array<{ clear(): void }> = []

/**
 * Register a cache for automatic pruning under critical memory pressure.
 * Safe to call multiple times with the same cache (idempotent).
 */
export function registerPrunableCache(cache: { clear(): void }): void {
  if (!prunableCaches.includes(cache)) {
    prunableCaches.push(cache)
  }
}

/**
 * Clear all registered prunable caches. Called automatically when memory
 * pressure reaches 'critical'. Also callable directly for manual cache
 * eviction.
 */
export function pruneRegisteredCaches(): void {
  for (const cache of prunableCaches) {
    try {
      cache.clear()
    } catch {
      // best-effort — cache may already be empty
    }
  }
}

export function getMemoryPressureLevel(): MemoryPressureLevel {
  return currentLevel
}

export function onMemoryPressure(
  callback: (level: MemoryPressureLevel) => void,
): () => void {
  pressureListeners.push(callback)
  return () => {
    pressureListeners = pressureListeners.filter(l => l !== callback)
  }
}

export function startMemoryPressureMonitor(
  config: Partial<MemoryPressureConfig> = {},
): void {
  if (monitorInterval) return

  const resolved = { ...DEFAULT_CONFIG, ...config }

  if (resolved.elevatedThresholdMB === 0) {
    resolved.elevatedThresholdMB = Math.floor(
      resolved.perSessionBudgetMB * 0.8,
    )
  }
  if (resolved.criticalThresholdMB === 0) {
    resolved.criticalThresholdMB = Math.floor(
      resolved.perSessionBudgetMB * 0.9,
    )
  }

  logForDebugging(
    `[MemoryPressure] Monitor started: elevated=${resolved.elevatedThresholdMB}MB, critical=${resolved.criticalThresholdMB}MB, interval=${resolved.checkIntervalMs}ms`,
  )

  monitorInterval = setInterval(() => {
    const rss = process.memoryUsage().rss / 1024 / 1024
    const previousLevel = currentLevel

    if (rss >= resolved.criticalThresholdMB) {
      currentLevel = 'critical'
    } else if (rss >= resolved.elevatedThresholdMB) {
      currentLevel = 'elevated'
    } else {
      currentLevel = 'normal'
    }

    if (currentLevel !== previousLevel) {
      logForDebugging(
        `[MemoryPressure] Level changed: ${previousLevel} -> ${currentLevel} (RSS: ${rss.toFixed(0)}MB)`,
      )
      if (currentLevel === 'critical') {
        logForDebugging('[MemoryPressure] Critical — pruning registered caches')
        pruneRegisteredCaches()
      }
      for (const listener of pressureListeners) {
        try {
          listener(currentLevel)
        } catch {
          // Don't let listener errors crash the monitor
        }
      }
    }

    // Keep requesting compaction while pressure stays elevated/critical.
    // The previous level-change-only gate meant one compact/prune cycle then
    // silence even if RSS remained high.  consumeCompactionRequest() is
    // one-shot so the existing autocompact cooldown prevents retry storms.
    if (currentLevel !== 'normal') {
      compactionRequested = true
    }
  }, resolved.checkIntervalMs)

  // Don't keep process alive just for monitoring
  ;(monitorInterval as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.()
}

/**
 * Returns true if memory pressure triggered a compaction request since last check.
 * Consumes the flag (resets to false).
 */
export function consumeCompactionRequest(): boolean {
  if (compactionRequested) {
    compactionRequested = false
    return true
  }
  return false
}

export function stopMemoryPressureMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval)
    monitorInterval = null
  }
  currentLevel = 'normal'
  pressureListeners = []
}
