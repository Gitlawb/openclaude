import type { Command, LocalCommandCall } from '../../types/command.js'
import {
  getLogTail,
  listHandoffMetadata,
  readHandoffMetadata,
  refreshHandoffStatus,
} from '../../utils/handoff/handoffMetadata.js'

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

const call: LocalCommandCall = async (args: string) => {
  const handoffId = args.trim()
  if (!handoffId) {
    const all = listHandoffMetadata()
    if (all.length === 0) {
      return { type: 'text', value: 'No handoffs found. Spawn one with /handoff <prompt>.' }
    }
    return {
      type: 'text',
      value:
        'Usage: /handoff-status <handoffId>\n\n' +
        'Available handoffs:\n' +
        all.map(m => `  ${m.handoffId}  (${m.status})`).join('\n'),
    }
  }

  const raw = readHandoffMetadata(handoffId)
  if (!raw) {
    return { type: 'text', value: `No handoff with id '${handoffId}'. Try /handoffs to list them.` }
  }

  const meta = refreshHandoffStatus(raw)
  const elapsedMs =
    (meta.finishedAt ?? Date.now()) - meta.startedAt
  const elapsedStr =
    elapsedMs < 1000
      ? `${elapsedMs}ms`
      : elapsedMs < 60_000
        ? `${(elapsedMs / 1000).toFixed(1)}s`
        : `${Math.floor(elapsedMs / 60_000)}m${Math.floor((elapsedMs % 60_000) / 1000)}s`

  const lines: string[] = []
  lines.push(`Handoff ${meta.handoffId}`)
  lines.push(`  status:  ${meta.status}${meta.exitCode !== null ? ` (exit ${meta.exitCode})` : ''}`)
  lines.push(`  pid:     ${meta.pid ?? '-'}`)
  lines.push(`  started: ${formatTimestamp(meta.startedAt)}`)
  if (meta.finishedAt) {
    lines.push(`  ended:   ${formatTimestamp(meta.finishedAt)}`)
  }
  lines.push(`  elapsed: ${elapsedStr}`)
  lines.push(`  cwd:     ${meta.cwd}`)
  lines.push(`  prompt:  ${meta.prompt}`)
  lines.push(`  log:     ${meta.logPath}`)

  const tail = getLogTail(meta.handoffId, 4096)
  if (tail) {
    lines.push('')
    lines.push('--- log tail (last ~4KB) ---')
    lines.push(tail.trimEnd())
  }

  return { type: 'text', value: lines.join('\n') }
}

const handoffStatus = {
  type: 'local',
  name: 'handoff-status',
  description: 'Show progress and log tail for a specific background handoff agent.',
  argumentHint: '<handoffId>',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default handoffStatus
