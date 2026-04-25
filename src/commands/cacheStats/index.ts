/**
 * /cache-stats — per-session cache diagnostics.
 *
 * Always-on diagnostic command (no toggle) that surfaces the metrics
 * tracked in `cacheStatsTracker.ts`. Breaks cache usage down by request
 * and also reports the session-wide aggregate — useful when the user
 * suspects a cache bust (e.g. after /reload-plugins) and wants to see
 * whether recent turns still hit the cache.
 *
 * Lazy-loaded (implementation in cacheStats.ts) to keep startup time
 * minimal — same pattern used by /cost and /cache-probe.
 */
import type { Command } from '../../commands.js'

const cacheStats = {
  type: 'local',
  name: 'cache-stats',
  description:
    'Show per-turn and session cache hit/miss stats (works across all providers)',
  supportsNonInteractive: true,
  load: () => import('./cacheStats.js'),
} satisfies Command

export default cacheStats
