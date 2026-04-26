import {
  getCacheStatsHistory,
  getCurrentTurnCacheMetrics,
  getSessionCacheMetrics,
  type CacheStatsEntry,
} from '../../services/api/cacheStatsTracker.js'
import {
  formatCacheMetricsCompact,
  formatCacheMetricsFull,
  type CacheMetrics,
} from '../../services/api/cacheMetrics.js'
import type { LocalCommandCall } from '../../types/command.js'

// Cap the per-request breakdown to keep output readable. Users wanting
// the full history can rely on OPENCLAUDE_LOG_TOKEN_USAGE=verbose for
// structured per-request stderr output.
const MAX_RECENT_ROWS = 20

function formatRow(entry: CacheStatsEntry, idx: number): string {
  // `YYYY-MM-DD HH:MM:SS` — long-running sessions can span midnight and a
  // bare time-of-day makes the wrong row look "most recent" when two
  // entries on different days share the same HH:MM:SS.
  const iso = new Date(entry.timestamp).toISOString()
  const ts = `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
  const line = formatCacheMetricsCompact(entry.metrics)
  return `  #${String(idx + 1).padStart(3)}  ${ts}  ${entry.label.padEnd(28).slice(0, 28)}  ${line}`
}

function summarize(label: string, m: CacheMetrics): string {
  return `${label.padEnd(18)}${formatCacheMetricsFull(m)}`
}

export const call: LocalCommandCall = async () => {
  const history = getCacheStatsHistory()
  const session = getSessionCacheMetrics()
  const turn = getCurrentTurnCacheMetrics()

  if (history.length === 0) {
    return {
      type: 'text',
      value:
        'Cache stats\n  No API requests yet this session.\n  Start a turn and re-run /cache-stats to see results.',
    }
  }

  const recent = history.slice(-MAX_RECENT_ROWS)
  const omitted = history.length - recent.length

  const lines: string[] = ['Cache stats', '']
  lines.push(summarize('Current turn:', turn))
  lines.push(summarize('Session total:', session))
  lines.push('')
  lines.push(`Recent requests (${recent.length}${omitted > 0 ? ` of ${history.length}, ${omitted} older omitted` : ''}):`)
  lines.push(`  #     time      model                         cache`)
  for (const [i, entry] of recent.entries()) {
    lines.push(formatRow(entry, history.length - recent.length + i))
  }

  // Honesty footnote — providers without cache reporting (vanilla Copilot,
  // Ollama) show [Cache: N/A] rather than a fake 0%. Tell the user so they
  // don't read "N/A" as "broken".
  const hasUnsupported = recent.some((e) => !e.metrics.supported)
  if (hasUnsupported) {
    lines.push('')
    lines.push(
      '  N/A rows: provider API does not expose cache usage (GitHub Copilot, Ollama).',
    )
    lines.push(
      '  The request still ran normally — only the metric is unavailable.',
    )
  }

  return { type: 'text', value: lines.join('\n') }
}
