import type { Command, LocalCommandCall } from '../../types/command.js'
import { listHandoffMetadata, refreshHandoffStatus } from '../../utils/handoff/handoffMetadata.js'

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d${h % 24}h`
}

function statusGlyph(status: string): string {
  switch (status) {
    case 'running':
      return '●'
    case 'done':
      return '✓'
    case 'failed':
      return '✗'
    case 'killed':
      return '×'
    case 'orphaned':
      return '?'
    default:
      return '·'
  }
}

const call: LocalCommandCall = async () => {
  const all = listHandoffMetadata().map(refreshHandoffStatus)

  if (all.length === 0) {
    return {
      type: 'text',
      value: 'No handoffs in this project. Spawn one with /handoff <prompt>.',
    }
  }

  const now = Date.now()
  const lines = ['ID                STATUS    PID      AGE      PROMPT']
  for (const meta of all) {
    const age =
      meta.status === 'running'
        ? formatAge(now - meta.startedAt)
        : formatAge((meta.finishedAt ?? now) - meta.startedAt)
    const id = meta.handoffId.padEnd(17)
    const status = `${statusGlyph(meta.status)} ${meta.status}`.padEnd(10)
    const pid = String(meta.pid ?? '-').padEnd(8)
    const ageStr = age.padEnd(8)
    const promptSummary =
      meta.prompt.length > 50 ? meta.prompt.slice(0, 50) + '...' : meta.prompt
    lines.push(`${id} ${status} ${pid} ${ageStr} ${promptSummary}`)
  }

  return { type: 'text', value: lines.join('\n') }
}

const handoffs = {
  type: 'local',
  name: 'handoffs',
  description: 'List background handoff agents (active and recent) for this project.',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default handoffs
