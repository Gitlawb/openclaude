import type { LocalCommandCall } from '../../types/command.js'
import { getHealthSnapshot } from '../../services/autonomy/providerHealth.js'
import {
  isAutonomyEnabled,
  resolveAutonomyMode,
} from '../../services/autonomy/routePolicy.js'
import { readRecentTelemetry } from '../../services/autonomy/telemetry.js'
import { listInsightFiles } from '../../services/autonomy/sessionInsights.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

export const call: LocalCommandCall = async () => {
  const settings = getInitialSettings()
  const enabled = isAutonomyEnabled(settings)
  const mode = resolveAutonomyMode(settings)
  const health = getHealthSnapshot()
  const recent = await readRecentTelemetry(12)
  const insights = await listInsightFiles()

  const lines: string[] = []
  lines.push('## Autonomy route status')
  lines.push('')
  lines.push(`| Field | Value |`)
  lines.push(`| --- | --- |`)
  lines.push(`| enabled | ${enabled} |`)
  lines.push(`| mode | ${mode} |`)
  lines.push(
    `| classifier | ${settings.autonomy?.classifier ?? 'heuristic'} |`,
  )
  lines.push(
    `| circuitBreakers | ${settings.autonomy?.circuitBreakers !== false} |`,
  )
  lines.push(`| telemetry | ${settings.autonomy?.telemetry !== false} |`)
  lines.push('')

  if (settings.taskRouting) {
    lines.push('### taskRouting')
    lines.push('')
    for (const [tier, model] of Object.entries(settings.taskRouting)) {
      if (model) lines.push(`- **${tier}** → \`${model}\``)
    }
    lines.push('')
  } else {
    lines.push('_taskRouting not configured — autonomy falls back to agentRouting._')
    lines.push('')
  }

  if (health.entries.length > 0) {
    lines.push('### Provider health (this process)')
    lines.push('')
    for (const e of health.entries) {
      const flag = e.healthy ? 'OK' : 'BAD'
      lines.push(
        `- [${flag}] \`${e.model}\` avg ${Math.round(e.avgLatencyMs)}ms · req ${e.requestCount} · err ${e.errorCount}`,
      )
    }
    lines.push('')
  }

  if (recent.length > 0) {
    lines.push('### Recent route telemetry')
    lines.push('')
    for (const r of recent.slice().reverse()) {
      const t = r.ts ? new Date(r.ts).toISOString().slice(11, 19) : '--:--:--'
      lines.push(
        `- ${t} **${r.event}** \`${r.model ?? '?'}\`${r.tier ? ` tier=${r.tier}` : ''}${r.source ? ` src=${r.source}` : ''}`,
      )
    }
    lines.push('')
  } else {
    lines.push('_No local telemetry yet. Run a turn with autonomy enabled._')
    lines.push('')
  }

  if (insights.length > 0) {
    lines.push(`### Insights on disk (${insights.length})`)
    lines.push('')
    for (const f of insights.slice(0, 5)) {
      lines.push(`- \`${f}\``)
    }
    lines.push('')
    lines.push('Promote durable lessons into `docs/superpowers/knowledge/`.')
  }

  lines.push('')
  lines.push(
    'CLI: `bun run doctor:autonomy` · `bun run doctor:autonomy:probe`',
  )

  return { type: 'text', value: lines.join('\n') }
}
