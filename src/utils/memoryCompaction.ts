/**
 * Memory Compaction Trigger
 *
 * Connects memory pressure levels to compaction actions.
 * When pressure rises, triggers conversation compaction and cache pruning.
 */

import { logForDebugging } from './debug.js'
import { onMemoryPressure } from './memoryPressure.js'

export interface CompactionTrigger {
  forceCompact(): void
  dispose(): void
}

export function createMemoryCompactionTrigger(opts: {
  onCompact: (aggressive: boolean) => void
  onPruneCache: () => void
}): CompactionTrigger {
  const dispose = onMemoryPressure(level => {
    if (level === 'elevated') {
      logForDebugging(
        '[MemoryCompaction] Elevated pressure - requesting compaction',
      )
      opts.onCompact(false)
    } else if (level === 'critical') {
      logForDebugging(
        '[MemoryCompaction] Critical pressure - forcing aggressive compaction',
      )
      opts.onCompact(true)
      opts.onPruneCache()
    }
  })

  return {
    forceCompact() {
      opts.onCompact(true)
      opts.onPruneCache()
    },
    dispose,
  }
}
