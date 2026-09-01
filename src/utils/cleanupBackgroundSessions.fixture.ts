import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import * as lockfile from './lockfile.js'
import {
  createBackgroundSession,
  recordBackgroundSessionNaturalTerminationSync,
} from '../cli/bgRegistry.js'
import { killHandler } from '../cli/bg.js'
import { startBackgroundHousekeeping } from './backgroundHousekeeping.js'
import {
  cleanupBackgroundSessionsAfterFinalization,
  cleanupOldMessageFilesInBackground,
} from './cleanup.js'

try {
  const mode = process.env.OPENCLAUDE_CLEANUP_FIXTURE_MODE
  if (mode === 'post-completion') {
    const processMarker = 'c'.repeat(64)
    const session = await createBackgroundSession({
      id: 'bg-post-completion',
      name: 'post-completion',
      pid: process.pid,
      cwd: process.cwd(),
      command: [
        'openclaude',
        `--openclaude-bg-session-marker=${processMarker}`,
        '--print',
        'fixture',
      ],
      sessionId: 'bg-post-completion-conversation',
      processMarker,
    })
    const root = dirname(dirname(session.stdoutLogPath))
    const metadataPath = join(root, 'sessions', `${session.id}.json`)
    const reservationPath = join(
      root,
      'names',
      `${createHash('sha256').update(session.name!).digest('hex')}.json`,
    )
    let scheduledCallback: (() => void) | undefined
    let finishPass: (() => void) | undefined
    startBackgroundHousekeeping({
      backgroundSessionReconciliation: {
        setInterval: callback => {
          scheduledCallback = callback
          return { unref: () => {} }
        },
        _onPassFinishedForTesting: () => finishPass?.(),
      },
      _reconciliationOnlyForTesting: true,
    })
    const runScheduledPass = async (): Promise<void> => {
      if (!scheduledCallback) {
        throw new Error('background reconciliation was not scheduled')
      }
      await new Promise<void>(resolve => {
        finishPass = resolve
        scheduledCallback?.()
      })
      finishPass = undefined
    }

    await runScheduledPass()
    const presentAfterInitialSweep = await Bun.file(
      session.stdoutLogPath,
    ).exists()
    const release = await lockfile.lock(metadataPath, { realpath: false })
    try {
      recordBackgroundSessionNaturalTerminationSync(
        session.id,
        { exitCode: 0 },
        {
          ownerPid: process.pid,
          expectedSession: session,
          now: new Date(Date.now() - 1_000),
        },
      )
    } finally {
      await release()
    }
    await runScheduledPass()
    const metadataPresentAfterCompletion = await Bun.file(
      metadataPath,
    ).exists()
    const storedMetadata = metadataPresentAfterCompletion
      ? ((await Bun.file(metadataPath).json()) as { status?: unknown })
      : undefined
    process.stdout.write(
      `${JSON.stringify({
        presentAfterInitialSweep,
        metadataPresentAfterCompletion,
        metadataStatusAfterCompletion: storedMetadata?.status ?? null,
        reservationPresentAfterCompletion: await Bun.file(
          reservationPath,
        ).exists(),
        stdoutPresentAfterCompletion: await Bun.file(
          session.stdoutLogPath,
        ).exists(),
        stderrPresentAfterCompletion: await Bun.file(
          session.stderrLogPath,
        ).exists(),
      })}\n`,
    )
  } else if (mode === 'post-finalization-gate') {
    let waits = 0
    await cleanupBackgroundSessionsAfterFinalization(async () => {
      waits++
      return true
    })
    process.stdout.write(`${JSON.stringify({ waits })}\n`)
  } else if (
    mode === 'post-finalization-exact-cutoff' ||
    mode === 'post-finalization-timeout'
  ) {
    const exactNow = Date.now()
    const processMarker = 'd'.repeat(64)
    const session = await createBackgroundSession({
      id: 'bg-post-finalization-exact',
      name: 'post-finalization-exact',
      pid: process.pid,
      cwd: process.cwd(),
      command: [
        'openclaude',
        `--openclaude-bg-session-marker=${processMarker}`,
        '--print',
        'fixture',
      ],
      sessionId: 'bg-post-finalization-exact-conversation',
      processMarker,
      now: new Date(exactNow - 1_000),
    })
    const root = dirname(dirname(session.stdoutLogPath))
    const metadataPath = join(root, 'sessions', `${session.id}.json`)
    const reservationPath = join(
      root,
      'names',
      `${createHash('sha256').update(session.name!).digest('hex')}.json`,
    )
    recordBackgroundSessionNaturalTerminationSync(
      session.id,
      { exitCode: 0 },
      {
        ownerPid: process.pid,
        expectedSession: session,
        now: new Date(exactNow),
      },
    )
    const originalDateNow = Date.now
    let waits = 0
    try {
      Date.now = () => exactNow
      await cleanupBackgroundSessionsAfterFinalization(async () => {
        waits++
        return mode === 'post-finalization-exact-cutoff'
      })
    } finally {
      Date.now = originalDateNow
    }
    process.stdout.write(
      `${JSON.stringify({
        waits,
        metadataPresent: await Bun.file(metadataPath).exists(),
        reservationPresent: await Bun.file(reservationPath).exists(),
        stdoutPresent: await Bun.file(session.stdoutLogPath).exists(),
        stderrPresent: await Bun.file(session.stderrLogPath).exists(),
      })}\n`,
    )
  } else if (mode === 'explicit-kill') {
    const session = await createBackgroundSession({
      id: 'bg-explicit-kill-cleanup',
      pid: process.pid,
      cwd: process.cwd(),
      command: ['openclaude', '--print', 'fixture'],
      sessionId: 'bg-explicit-kill-cleanup-conversation',
    })
    recordBackgroundSessionNaturalTerminationSync(
      session.id,
      { exitCode: 0 },
      {
        ownerPid: process.pid,
        expectedSession: session,
        now: new Date(Date.now() - 1_000),
      },
    )
    const originalConsoleLog = console.log
    try {
      console.log = () => {}
      await killHandler([session.id])
    } finally {
      console.log = originalConsoleLog
    }
    const root = dirname(dirname(session.stdoutLogPath))
    process.stdout.write(
      `${JSON.stringify({
        metadataPresent: await Bun.file(
          join(root, 'sessions', `${session.id}.json`),
        ).exists(),
        stdoutPresent: await Bun.file(session.stdoutLogPath).exists(),
        stderrPresent: await Bun.file(session.stderrLogPath).exists(),
      })}\n`,
    )
  } else {
    await cleanupOldMessageFilesInBackground()
    process.stdout.write(`${JSON.stringify({ completed: true })}\n`)
  }
} catch {
  process.stderr.write('background cleanup fixture failed\n')
  process.exitCode = 1
}
