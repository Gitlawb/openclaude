/**
 * Shared infrastructure for profiler modules (startupProfiler, queryProfiler,
 * headlessProfiler). All three use the same perf_hooks timeline and the same
 * line format for detailed reports.
 */

import type { performance as PerformanceType } from 'perf_hooks'
import { formatFileSize } from './format.js'

const OPENCLAUDE_PERFORMANCE_PREFIX = 'openclaude:'

// Lazy-load performance API only when profiling is enabled.
// Shared across all profilers — perf_hooks.performance is a process-wide singleton.
let performance: typeof PerformanceType | null = null

export function getPerformance(): typeof PerformanceType {
  if (!performance) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    performance = require('perf_hooks').performance
  }
  return performance!
}

export function formatMs(ms: number): string {
  return ms.toFixed(3)
}

function getProfilerPrefix(scope: string): string {
  return `${OPENCLAUDE_PERFORMANCE_PREFIX}${scope}:`
}

export function getProfilerMarkName(scope: string, name: string): string {
  return `${getProfilerPrefix(scope)}${name}`
}

export function getProfilerDisplayName(scope: string, name: string): string {
  const prefix = getProfilerPrefix(scope)
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}

export function getProfilerEntries(
  scope: string,
  type: 'mark' | 'measure',
) {
  const prefix = getProfilerPrefix(scope)
  return getPerformance()
    .getEntriesByType(type)
    .filter(entry => entry.name.startsWith(prefix))
}

export function clearProfilerEntries(scope: string): void {
  const perf = getPerformance()

  for (const name of new Set(
    getProfilerEntries(scope, 'mark').map(entry => entry.name),
  )) {
    perf.clearMarks(name)
  }

  for (const name of new Set(
    getProfilerEntries(scope, 'measure').map(entry => entry.name),
  )) {
    perf.clearMeasures(name)
  }
}

/**
 * Render a single timeline line in the shared profiler report format:
 *   [+  total.ms] (+  delta.ms) name [extra] [| RSS: .., Heap: ..]
 *
 * totalPad/deltaPad control the padStart width so callers can align columns
 * based on their expected magnitude (startup uses 8/7, query uses 10/9).
 */
export function formatTimelineLine(
  totalMs: number,
  deltaMs: number,
  name: string,
  memory: NodeJS.MemoryUsage | undefined,
  totalPad: number,
  deltaPad: number,
  extra = '',
): string {
  const memInfo = memory
    ? ` | RSS: ${formatFileSize(memory.rss)}, Heap: ${formatFileSize(memory.heapUsed)}`
    : ''
  return `[+${formatMs(totalMs).padStart(totalPad)}ms] (+${formatMs(deltaMs).padStart(deltaPad)}ms) ${name}${extra}${memInfo}`
}
