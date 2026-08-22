import type { Command, LocalCommandCall } from '../../types/command.js'
import {
  isPidAlive,
  listHandoffMetadata,
  readHandoffMetadata,
  refreshHandoffStatus,
  writeHandoffMetadata,
  type HandoffMetadata,
} from '../../utils/handoff/handoffMetadata.js'

const TERMINAL_STATUSES = new Set(['done', 'failed', 'killed', 'orphaned'])
const SIGTERM_GRACE_MS = 500

type KillOutcome =
  | { handoffId: string; result: 'killed'; usedSignal: 'SIGTERM' | 'SIGKILL' }
  | { handoffId: string; result: 'already-terminal'; status: string }
  | { handoffId: string; result: 'no-pid' }
  | { handoffId: string; result: 'not-found' }
  | { handoffId: string; result: 'error'; message: string }

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function trySignal(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal)
    return true
  } catch {
    return false
  }
}

async function killOne(handoffId: string): Promise<KillOutcome> {
  const raw = readHandoffMetadata(handoffId)
  if (!raw) return { handoffId, result: 'not-found' }

  const meta = refreshHandoffStatus(raw)

  if (TERMINAL_STATUSES.has(meta.status)) {
    return { handoffId, result: 'already-terminal', status: meta.status }
  }

  if (meta.pid === null) {
    // Spawning that never got a pid — mark killed so it doesn't linger.
    const finalMeta: HandoffMetadata = {
      ...meta,
      status: 'killed',
      finishedAt: Date.now(),
    }
    writeHandoffMetadata(finalMeta)
    return { handoffId, result: 'no-pid' }
  }

  // Write 'killed' eagerly so /handoffs reflects intent during the kill window.
  // If the original parent CLI is still alive, its child.on('exit') handler
  // will overwrite this with its own 'killed' write (idempotent — same status).
  const intent: HandoffMetadata = {
    ...meta,
    status: 'killed',
  }
  writeHandoffMetadata(intent)

  // SIGTERM, grace period, escalate to SIGKILL if still alive.
  if (!trySignal(meta.pid, 'SIGTERM')) {
    // Process already gone — finalize and exit.
    const finalMeta: HandoffMetadata = {
      ...intent,
      finishedAt: Date.now(),
    }
    writeHandoffMetadata(finalMeta)
    return { handoffId, result: 'killed', usedSignal: 'SIGTERM' }
  }

  await sleep(SIGTERM_GRACE_MS)

  let usedSignal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'
  if (isPidAlive(meta.pid)) {
    trySignal(meta.pid, 'SIGKILL')
    usedSignal = 'SIGKILL'
  }

  // Finalize finishedAt. Parent's exit handler may stomp this with its own
  // timestamp + exitCode — that's fine and strictly better.
  const finalMeta: HandoffMetadata = {
    ...intent,
    finishedAt: Date.now(),
  }
  writeHandoffMetadata(finalMeta)

  return { handoffId, result: 'killed', usedSignal }
}

function formatOutcome(o: KillOutcome): string {
  switch (o.result) {
    case 'killed':
      return `  ${o.handoffId}  killed (${o.usedSignal})`
    case 'already-terminal':
      return `  ${o.handoffId}  skipped (already ${o.status})`
    case 'no-pid':
      return `  ${o.handoffId}  marked killed (never had a pid)`
    case 'not-found':
      return `  ${o.handoffId}  not found`
    case 'error':
      return `  ${o.handoffId}  error: ${o.message}`
  }
}

const call: LocalCommandCall = async (args: string) => {
  const trimmed = args.trim()

  if (!trimmed) {
    const all = listHandoffMetadata().map(refreshHandoffStatus)
    const live = all.filter(m => !TERMINAL_STATUSES.has(m.status))
    const lines = [
      'Usage: /handoff-kill <handoffId>',
      '       /handoff-kill --all     (kill every running/spawning handoff)',
      '',
    ]
    if (live.length === 0) {
      lines.push('No live handoffs to kill.')
    } else {
      lines.push('Live handoffs:')
      for (const m of live) {
        lines.push(`  ${m.handoffId}  (${m.status}, pid ${m.pid ?? '-'})`)
      }
    }
    return { type: 'text', value: lines.join('\n') }
  }

  let targets: string[]
  if (trimmed === '--all' || trimmed === '-a') {
    const live = listHandoffMetadata()
      .map(refreshHandoffStatus)
      .filter(m => !TERMINAL_STATUSES.has(m.status))
    if (live.length === 0) {
      return { type: 'text', value: 'No live handoffs to kill.' }
    }
    targets = live.map(m => m.handoffId)
  } else {
    targets = [trimmed]
  }

  const outcomes: KillOutcome[] = []
  for (const id of targets) {
    try {
      outcomes.push(await killOne(id))
    } catch (err) {
      outcomes.push({
        handoffId: id,
        result: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const killedCount = outcomes.filter(o => o.result === 'killed').length
  const header =
    targets.length === 1
      ? `Killed ${killedCount} of 1 handoff:`
      : `Killed ${killedCount} of ${targets.length} handoffs:`

  return {
    type: 'text',
    value: [header, ...outcomes.map(formatOutcome)].join('\n'),
  }
}

const handoffKill = {
  type: 'local',
  name: 'handoff-kill',
  description:
    'Terminate a running handoff agent (SIGTERM, escalates to SIGKILL). Pass --all to kill every live handoff.',
  argumentHint: '<handoffId> | --all',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default handoffKill
