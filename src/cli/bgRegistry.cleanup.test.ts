import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as nameReservationLock from '../utils/lockfile.js'
import {
  _setBackgroundSessionsRootForTesting,
  cleanupBackgroundSessionsBefore,
  createBackgroundSession,
  markBackgroundSessionKilled,
  recordBackgroundSessionNaturalTermination,
  refreshBackgroundSessionStatuses,
  type BackgroundSession,
  type BackgroundSessionNaturalTermination,
} from './bgRegistry.js'

const CUTOFF = new Date('2026-07-01T00:00:00.000Z')
const OLD_FINISH = new Date('2026-06-01T00:00:00.000Z')
const RECENT_FINISH = new Date('2026-07-01T00:00:01.000Z')

describe('background session retention cleanup', () => {
  let configDir: string
  let root: string
  let nextPid: number

  function paths(id: string): {
    metadata: string
    stdout: string
    stderr: string
    natural: string
    killed: string
  } {
    return {
      metadata: join(root, 'sessions', `${id}.json`),
      stdout: join(root, 'logs', `${id}.out.log`),
      stderr: join(root, 'logs', `${id}.err.log`),
      natural: join(root, 'terminal', `${id}.natural.json`),
      killed: join(root, 'terminal', `${id}.killed.json`),
    }
  }

  function reservationPath(name: string): string {
    const digest = createHash('sha256').update(name).digest('hex')
    return join(root, 'names', `${digest}.json`)
  }

  async function exists(path: string): Promise<boolean> {
    try {
      await lstat(path)
      return true
    } catch {
      return false
    }
  }

  async function createRunning(
    id: string,
    options: { name?: string; startedAt?: Date } = {},
  ): Promise<BackgroundSession> {
    return await createBackgroundSession({
      id,
      ...(options.name ? { name: options.name } : {}),
      pid: nextPid++,
      cwd: configDir,
      command: ['openclaude', '--print', id],
      sessionId: `${id}-conversation`,
      now: options.startedAt ?? new Date(OLD_FINISH.getTime() - 60_000),
    })
  }

  async function finishNaturally(
    session: BackgroundSession,
    termination: BackgroundSessionNaturalTermination,
    finishedAt: Date = OLD_FINISH,
  ): Promise<void> {
    await recordBackgroundSessionNaturalTermination(session.id, termination, {
      ownerPid: session.pid,
      now: finishedAt,
    })
  }

  async function writeRawSession(options: {
    id: string
    status: BackgroundSession['status']
    finishedAt?: string
    name?: string
    stdoutLogPath?: string
    stderrLogPath?: string
    createLogs?: boolean
    processMarker?: string
  }): Promise<BackgroundSession> {
    const idPaths = paths(options.id)
    await Promise.all([
      mkdir(join(root, 'sessions'), { recursive: true }),
      mkdir(join(root, 'logs'), { recursive: true }),
      mkdir(join(root, 'terminal'), { recursive: true }),
      mkdir(join(root, 'names'), { recursive: true }),
    ])
    if (options.createLogs !== false) {
      await writeFile(idPaths.stdout, 'stdout')
      await writeFile(idPaths.stderr, 'stderr')
    }
    const session: BackgroundSession = {
      id: options.id,
      ...(options.name ? { name: options.name } : {}),
      pid: nextPid++,
      cwd: configDir,
      status: options.status,
      sessionId: `${options.id}-conversation`,
      ...(options.processMarker !== undefined
        ? { processMarker: options.processMarker }
        : {}),
      startedAt: new Date(OLD_FINISH.getTime() - 60_000).toISOString(),
      updatedAt: options.finishedAt ?? OLD_FINISH.toISOString(),
      command: ['openclaude', '--print', options.id],
      stdoutLogPath: options.stdoutLogPath ?? idPaths.stdout,
      stderrLogPath: options.stderrLogPath ?? idPaths.stderr,
      ...(options.finishedAt ? { finishedAt: options.finishedAt } : {}),
    }
    await writeFile(idPaths.metadata, JSON.stringify(session))
    return session
  }

  async function writeReservation(name: string, id: string): Promise<void> {
    await mkdir(join(root, 'names'), { recursive: true })
    await writeFile(
      reservationPath(name),
      JSON.stringify({ name, id, creatorPid: process.pid }),
    )
  }

  function deniedError(): NodeJS.ErrnoException {
    return Object.assign(new Error('denied'), { code: 'EACCES' })
  }

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'openclaude-bg-cleanup-'))
    root = join(configDir, 'bg-sessions')
    nextPid = 20_000
    _setBackgroundSessionsRootForTesting(root)
  })

  afterEach(async () => {
    _setBackgroundSessionsRootForTesting(undefined)
    await rm(configDir, { recursive: true, force: true })
  })

  for (const scenario of [
    {
      name: 'old natural exit zero',
      id: 'bg-exit-zero',
      termination: { exitCode: 0 } as const,
    },
    {
      name: 'old natural nonzero failure',
      id: 'bg-exit-nonzero',
      termination: { exitCode: 23 } as const,
    },
    {
      name: 'old signal failure',
      id: 'bg-signal',
      termination: { signal: 'SIGTERM' } as const,
    },
  ]) {
    it(`removes ${scenario.name} artifacts`, async () => {
      const session = await createRunning(scenario.id)
      await finishNaturally(session, scenario.termination)

      const result = await cleanupBackgroundSessionsBefore(CUTOFF)

      expect(result).toEqual({
        sessionsRemoved: 1,
        artifactsRemoved: 4,
        errors: 0,
      })
      for (const path of Object.values(paths(scenario.id))) {
        expect(await exists(path)).toBe(false)
      }
    })
  }

  it('removes old explicit-kill artifacts', async () => {
    const session = await createRunning('bg-killed')
    await markBackgroundSessionKilled(session.id, { now: OLD_FINISH })

    const result = await cleanupBackgroundSessionsBefore(CUTOFF)

    expect(result).toEqual({
      sessionsRemoved: 1,
      artifactsRemoved: 4,
      errors: 0,
    })
    expect(await exists(paths(session.id).metadata)).toBe(false)
    expect(await exists(paths(session.id).killed)).toBe(false)
  })

  it('retains recent completed sessions', async () => {
    const session = await createRunning('bg-recent')
    await finishNaturally(session, { exitCode: 0 }, RECENT_FINISH)

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 0,
    })
    expect(await exists(paths(session.id).metadata)).toBe(true)
    expect(await exists(paths(session.id).natural)).toBe(true)
  })

  it('retains running, unknown, and stale sessions', async () => {
    const running = await createRunning('bg-running')
    const unknown = await createRunning('bg-unknown')
    const stale = await createRunning('bg-stale')
    await refreshBackgroundSessionStatuses({
      isProcessAlive: pid => pid !== stale.pid,
      getProcessCommand: pid =>
        pid === running.pid ? running.command.join(' ') : null,
      now: OLD_FINISH,
    })

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 0,
    })
    for (const session of [running, unknown, stale]) {
      expect(await exists(paths(session.id).metadata)).toBe(true)
    }
  })

  it('retains completed metadata without a valid finishedAt', async () => {
    const missing = await writeRawSession({
      id: 'bg-missing-finished',
      status: 'exited',
    })
    const invalid = await writeRawSession({
      id: 'bg-invalid-finished',
      status: 'failed',
      finishedAt: 'not-a-date',
    })

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 0,
    })
    expect(await exists(paths(missing.id).metadata)).toBe(true)
    expect(await exists(paths(invalid.id).metadata)).toBe(true)
  })

  it('removes an old completed session with a valid process marker', async () => {
    const session = await writeRawSession({
      id: 'bg-valid-process-marker',
      status: 'exited',
      finishedAt: OLD_FINISH.toISOString(),
      processMarker: 'a'.repeat(64),
    })

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 1,
      artifactsRemoved: 3,
      errors: 0,
    })
    expect(await exists(paths(session.id).metadata)).toBe(false)
  })

  it('retains metadata with an invalid process marker', async () => {
    const session = await writeRawSession({
      id: 'bg-invalid-process-marker',
      status: 'exited',
      finishedAt: OLD_FINISH.toISOString(),
      processMarker: 'not-a-valid-marker',
    })

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 0,
    })
    expect(await exists(paths(session.id).metadata)).toBe(true)
    expect(await exists(paths(session.id).stdout)).toBe(true)
  })

  it('retains a completion exactly at the cutoff', async () => {
    const session = await writeRawSession({
      id: 'bg-at-cutoff',
      status: 'exited',
      finishedAt: CUTOFF.toISOString(),
    })

    await cleanupBackgroundSessionsBefore(CUTOFF)

    expect(await exists(paths(session.id).metadata)).toBe(true)
  })

  it('uses authoritative facts to clean stale metadata', async () => {
    const session = await createRunning('bg-stale-with-fact')
    await refreshBackgroundSessionStatuses({
      isProcessAlive: () => false,
      now: new Date(OLD_FINISH.getTime() - 1_000),
    })
    await finishNaturally(session, { exitCode: 0 })

    const result = await cleanupBackgroundSessionsBefore(CUTOFF)

    expect(result.sessionsRemoved).toBe(1)
    expect(await exists(paths(session.id).metadata)).toBe(false)
    expect(await exists(paths(session.id).natural)).toBe(false)
  })

  it('ignores malformed metadata without deleting same-looking logs', async () => {
    const id = 'bg-malformed'
    const idPaths = paths(id)
    await mkdir(join(root, 'sessions'), { recursive: true })
    await mkdir(join(root, 'logs'), { recursive: true })
    await writeFile(idPaths.metadata, '{bad json')
    await writeFile(idPaths.stdout, 'keep stdout')
    await writeFile(idPaths.stderr, 'keep stderr')

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 0,
    })
    expect(await exists(idPaths.stdout)).toBe(true)
    expect(await exists(idPaths.stderr)).toBe(true)
  })

  it('does not follow symlinked metadata outside the registry root', async () => {
    const id = 'bg-symlink-metadata'
    const idPaths = paths(id)
    const externalMetadata = join(configDir, 'external-metadata.json')
    await mkdir(join(root, 'sessions'), { recursive: true })
    await mkdir(join(root, 'logs'), { recursive: true })
    await writeFile(
      externalMetadata,
      JSON.stringify({
        id,
        pid: 123,
        cwd: configDir,
        status: 'exited',
        sessionId: 'external-conversation',
        startedAt: '2026-05-31T23:59:00.000Z',
        updatedAt: OLD_FINISH.toISOString(),
        finishedAt: OLD_FINISH.toISOString(),
        command: ['openclaude'],
        stdoutLogPath: idPaths.stdout,
        stderrLogPath: idPaths.stderr,
      }),
    )
    await symlink(externalMetadata, idPaths.metadata)
    await writeFile(idPaths.stdout, 'keep stdout')
    await writeFile(idPaths.stderr, 'keep stderr')

    await cleanupBackgroundSessionsBefore(CUTOFF)

    expect(await exists(externalMetadata)).toBe(true)
    expect(await exists(idPaths.metadata)).toBe(true)
    expect(await exists(idPaths.stdout)).toBe(true)
  })

  it('does not follow a symlinked metadata directory outside the registry root', async () => {
    const id = 'bg-symlink-sessions-dir'
    const idPaths = paths(id)
    const externalSessions = join(configDir, 'external-sessions')
    await mkdir(externalSessions, { recursive: true })
    await mkdir(join(root, 'logs'), { recursive: true })
    await mkdir(join(root, 'terminal'), { recursive: true })
    await mkdir(join(root, 'names'), { recursive: true })
    await writeFile(
      join(externalSessions, `${id}.json`),
      JSON.stringify({
        id,
        pid: 123,
        cwd: configDir,
        status: 'exited',
        sessionId: 'external-conversation',
        startedAt: '2026-05-31T23:59:00.000Z',
        updatedAt: OLD_FINISH.toISOString(),
        finishedAt: OLD_FINISH.toISOString(),
        command: ['openclaude'],
        stdoutLogPath: idPaths.stdout,
        stderrLogPath: idPaths.stderr,
      }),
    )
    await symlink(externalSessions, join(root, 'sessions'), 'dir')
    await writeFile(idPaths.stdout, 'keep stdout')
    await writeFile(idPaths.stderr, 'keep stderr')

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 1,
    })
    expect(await exists(join(externalSessions, `${id}.json`))).toBe(true)
    expect(await exists(idPaths.stdout)).toBe(true)
    expect(await exists(idPaths.stderr)).toBe(true)
  })

  it('does not follow symlinked artifact directories outside the registry root', async () => {
    const externalLogs = join(configDir, 'external-logs')
    const session = await writeRawSession({
      id: 'bg-symlink-logs-dir',
      status: 'exited',
      finishedAt: OLD_FINISH.toISOString(),
      createLogs: false,
    })
    await rm(join(root, 'logs'), { recursive: true, force: true })
    await mkdir(externalLogs, { recursive: true })
    await writeFile(join(externalLogs, `${session.id}.out.log`), 'outside')
    await writeFile(join(externalLogs, `${session.id}.err.log`), 'outside')
    await symlink(externalLogs, join(root, 'logs'), 'dir')

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 1,
    })
    expect(await exists(paths(session.id).metadata)).toBe(true)
    expect(
      await exists(join(externalLogs, `${session.id}.out.log`)),
    ).toBe(true)
    expect(
      await exists(join(externalLogs, `${session.id}.err.log`)),
    ).toBe(true)
  })

  it('stops when the metadata directory identity changes during cleanup', async () => {
    const session = await writeRawSession({
      id: 'bg-sessions-dir-swapped',
      status: 'exited',
      finishedAt: OLD_FINISH.toISOString(),
    })
    const sessionsDir = join(root, 'sessions')
    const externalSessions = join(configDir, 'swapped-sessions')
    await mkdir(externalSessions, { recursive: true })
    await writeFile(
      join(externalSessions, `${session.id}.json`),
      await readFile(paths(session.id).metadata, 'utf8'),
    )
    let swapped = false

    const result = await cleanupBackgroundSessionsBefore(CUTOFF, {
      _beforeMetadataDirectoryReadForTesting: async () => {
        swapped = true
        await rm(sessionsDir, { recursive: true, force: true })
        await symlink(externalSessions, sessionsDir, 'dir')
      },
    })

    expect(result).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 1,
    })
    expect(swapped).toBe(true)
    expect(
      await exists(join(externalSessions, `${session.id}.json`)),
    ).toBe(true)
    expect(await exists(paths(session.id).stdout)).toBe(true)
  })

  it('never trusts persisted external log paths', async () => {
    const externalStdout = join(configDir, 'external.out.log')
    const externalStderr = join(configDir, 'external.err.log')
    await writeFile(externalStdout, 'external stdout')
    await writeFile(externalStderr, 'external stderr')
    const session = await writeRawSession({
      id: 'bg-external-logs',
      status: 'exited',
      finishedAt: OLD_FINISH.toISOString(),
      stdoutLogPath: externalStdout,
      stderrLogPath: externalStderr,
    })

    await cleanupBackgroundSessionsBefore(CUTOFF)

    expect(await exists(paths(session.id).metadata)).toBe(false)
    expect(await Bun.file(externalStdout).text()).toBe('external stdout')
    expect(await Bun.file(externalStderr).text()).toBe('external stderr')
  })

  it('unlinks symlinked expected logs without touching their targets', async () => {
    const id = 'bg-symlink-log'
    const external = join(configDir, 'external-target.log')
    await writeFile(external, 'outside')
    const session = await writeRawSession({
      id,
      status: 'exited',
      finishedAt: OLD_FINISH.toISOString(),
      createLogs: false,
    })
    await symlink(external, paths(id).stdout)
    await writeFile(paths(id).stderr, 'stderr')

    await cleanupBackgroundSessionsBefore(CUTOFF)

    expect(await exists(paths(session.id).stdout)).toBe(false)
    expect(await Bun.file(external).text()).toBe('outside')
  })

  it('preserves malformed, wrong-owner, and symlinked terminal facts', async () => {
    const malformed = await writeRawSession({
      id: 'bg-malformed-fact',
      status: 'exited',
      finishedAt: OLD_FINISH.toISOString(),
    })
    await writeFile(paths(malformed.id).killed, '{bad json')

    const wrongOwner = await writeRawSession({
      id: 'bg-wrong-owner-fact',
      status: 'failed',
      finishedAt: OLD_FINISH.toISOString(),
    })
    await writeFile(
      paths(wrongOwner.id).natural,
      JSON.stringify({
        version: 1,
        id: wrongOwner.id,
        pid: wrongOwner.pid + 1,
        status: 'failed',
        finishedAt: OLD_FINISH.toISOString(),
        terminalReason: 'exit_code',
        exitCode: 1,
      }),
    )

    const symlinked = await writeRawSession({
      id: 'bg-symlink-fact',
      status: 'killed',
      finishedAt: OLD_FINISH.toISOString(),
    })
    const externalFact = join(configDir, 'external-fact.json')
    await writeFile(
      externalFact,
      JSON.stringify({
        version: 1,
        id: symlinked.id,
        pid: symlinked.pid,
        status: 'killed',
        finishedAt: OLD_FINISH.toISOString(),
        terminalReason: 'explicit_kill',
      }),
    )
    await symlink(externalFact, paths(symlinked.id).killed)

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 0,
    })
    for (const session of [malformed, wrongOwner, symlinked]) {
      expect(await exists(paths(session.id).metadata)).toBe(true)
    }
    expect(await exists(externalFact)).toBe(true)
  })

  it('preserves terminal facts with invalid timestamps', async () => {
    const session = await writeRawSession({
      id: 'bg-invalid-fact-time',
      status: 'exited',
      finishedAt: OLD_FINISH.toISOString(),
    })
    await writeFile(
      paths(session.id).natural,
      JSON.stringify({
        version: 1,
        id: session.id,
        pid: session.pid,
        status: 'exited',
        finishedAt: 'not-a-date',
        terminalReason: 'exit_code',
        exitCode: 0,
      }),
    )

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 0,
    })
    expect(await exists(paths(session.id).metadata)).toBe(true)
    expect(await exists(paths(session.id).natural)).toBe(true)
  })

  it('treats missing artifacts as idempotent success', async () => {
    const session = await writeRawSession({
      id: 'bg-missing-artifacts',
      status: 'exited',
      finishedAt: OLD_FINISH.toISOString(),
      createLogs: false,
    })

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 1,
      artifactsRemoved: 1,
      errors: 0,
    })
    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 0,
    })
    expect(await exists(paths(session.id).metadata)).toBe(false)
  })

  it('counts one unlink failure and continues with unrelated sessions', async () => {
    const blocked = await createRunning('bg-blocked-unlink')
    await finishNaturally(blocked, { exitCode: 0 })
    const removable = await createRunning('bg-other-removable')
    await finishNaturally(removable, { exitCode: 0 })
    const blockedStdout = paths(blocked.id).stdout

    const result = await cleanupBackgroundSessionsBefore(CUTOFF, {
      unlinkFile: async path => {
        if (path === blockedStdout) throw deniedError()
        await unlink(path)
      },
    })

    expect(result.errors).toBe(1)
    expect(result.sessionsRemoved).toBe(1)
    expect(await exists(paths(blocked.id).metadata)).toBe(true)
    expect(await exists(paths(blocked.id).natural)).toBe(true)
    expect(await exists(paths(removable.id).metadata)).toBe(false)

    expect((await cleanupBackgroundSessionsBefore(CUTOFF)).errors).toBe(0)
    expect(await exists(paths(blocked.id).metadata)).toBe(false)
  })

  it('counts a metadata read error and continues with unrelated sessions', async () => {
    const blocked = await writeRawSession({
      id: 'bg-metadata-read-error',
      status: 'exited',
      finishedAt: OLD_FINISH.toISOString(),
    })
    const removable = await writeRawSession({
      id: 'bg-after-metadata-read-error',
      status: 'exited',
      finishedAt: OLD_FINISH.toISOString(),
    })
    const blockedMetadata = paths(blocked.id).metadata

    const result = await cleanupBackgroundSessionsBefore(CUTOFF, {
      readTextFile: async path => {
        if (path === blockedMetadata) throw deniedError()
        return await readFile(path, 'utf8')
      },
    })

    expect(result.errors).toBe(1)
    expect(result.sessionsRemoved).toBe(1)
    expect(await exists(blockedMetadata)).toBe(true)
    expect(await exists(paths(blocked.id).stdout)).toBe(true)
    expect(await exists(paths(removable.id).metadata)).toBe(false)
  })

  it('counts a terminal-fact read error and retains the session', async () => {
    const session = await createRunning('bg-fact-read-error')
    await finishNaturally(session, { exitCode: 0 })
    const naturalFact = paths(session.id).natural

    const result = await cleanupBackgroundSessionsBefore(CUTOFF, {
      readTextFile: async path => {
        if (path === naturalFact) throw deniedError()
        return await readFile(path, 'utf8')
      },
    })

    expect(result.errors).toBe(1)
    expect(result.sessionsRemoved).toBe(0)
    expect(await exists(paths(session.id).metadata)).toBe(true)
    expect(await exists(naturalFact)).toBe(true)
  })

  it('keeps authoritative facts retryable after metadata unlink fails', async () => {
    const session = await createRunning('bg-metadata-retry')
    await finishNaturally(session, { exitCode: 0 })
    const metadataPath = paths(session.id).metadata

    const first = await cleanupBackgroundSessionsBefore(CUTOFF, {
      unlinkFile: async path => {
        if (path === metadataPath) throw deniedError()
        await unlink(path)
      },
    })

    expect(first.errors).toBe(1)
    expect(first.sessionsRemoved).toBe(0)
    expect(await exists(metadataPath)).toBe(true)
    expect(await exists(paths(session.id).natural)).toBe(true)

    const retry = await cleanupBackgroundSessionsBefore(CUTOFF)
    expect(retry.sessionsRemoved).toBe(1)
    expect(await exists(metadataPath)).toBe(false)
    expect(await exists(paths(session.id).natural)).toBe(false)
  })

  it('reclaims an old terminal fact after metadata-first partial cleanup', async () => {
    const session = await createRunning('bg-terminal-fact-retry')
    await finishNaturally(session, { exitCode: 0 })
    const naturalFact = paths(session.id).natural

    const first = await cleanupBackgroundSessionsBefore(CUTOFF, {
      unlinkFile: async path => {
        if (path === naturalFact) throw deniedError()
        await unlink(path)
      },
    })

    expect(first.errors).toBe(1)
    expect(first.sessionsRemoved).toBe(1)
    expect(await exists(paths(session.id).metadata)).toBe(false)
    expect(await exists(naturalFact)).toBe(true)

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 1,
      errors: 0,
    })
    expect(await exists(naturalFact)).toBe(false)
  })

  it('reclaims an old killed fact after metadata-first partial cleanup', async () => {
    const session = await createRunning('bg-killed-fact-retry')
    await markBackgroundSessionKilled(session.id, { now: OLD_FINISH })
    const killedFact = paths(session.id).killed

    const first = await cleanupBackgroundSessionsBefore(CUTOFF, {
      unlinkFile: async path => {
        if (path === killedFact) throw deniedError()
        await unlink(path)
      },
    })

    expect(first.errors).toBe(1)
    expect(first.sessionsRemoved).toBe(1)
    expect(await exists(paths(session.id).metadata)).toBe(false)
    expect(await exists(killedFact)).toBe(true)

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 1,
      errors: 0,
    })
    expect(await exists(killedFact)).toBe(false)
  })

  it('retains recent and malformed orphaned terminal facts', async () => {
    const recent = await createRunning('bg-recent-orphan')
    await finishNaturally(recent, { exitCode: 0 }, RECENT_FINISH)
    await unlink(paths(recent.id).metadata)

    const malformed = await createRunning('bg-malformed-orphan')
    await finishNaturally(malformed, { exitCode: 0 })
    await unlink(paths(malformed.id).metadata)
    await writeFile(paths(malformed.id).natural, '{bad json')

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 0,
    })
    expect(await exists(paths(recent.id).natural)).toBe(true)
    expect(await exists(paths(malformed.id).natural)).toBe(true)
  })

  it('advances the bounded scan past preserved orphaned facts', async () => {
    const terminalDir = join(root, 'terminal')
    await mkdir(terminalDir, { recursive: true })
    const preservedFacts = Array.from({ length: 256 }, (_, index) => {
      const id = `bg-preserved-orphan-${index.toString().padStart(3, '0')}`
      return writeFile(
        paths(id).natural,
        JSON.stringify({
          version: 1,
          id,
          pid: nextPid++,
          status: 'exited',
          finishedAt: RECENT_FINISH.toISOString(),
          terminalReason: 'exit_code',
          exitCode: 0,
        }),
      )
    })
    await Promise.all(preservedFacts)
    const oldId = 'zz-bg-old-orphan'
    await writeFile(
      paths(oldId).natural,
      JSON.stringify({
        version: 1,
        id: oldId,
        pid: nextPid++,
        status: 'exited',
        finishedAt: OLD_FINISH.toISOString(),
        terminalReason: 'exit_code',
        exitCode: 0,
      }),
    )

    // The fixed seed selects the initial index; later calls resume from the module-level offset.
    const scanOptions = {
      _orphanedTerminalFactScanStartForTesting: 0,
    }
    expect(
      await cleanupBackgroundSessionsBefore(CUTOFF, scanOptions),
    ).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 0,
    })
    expect(await exists(paths(oldId).natural)).toBe(true)

    expect(
      await cleanupBackgroundSessionsBefore(CUTOFF, scanOptions),
    ).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 1,
      errors: 0,
    })
    expect(await exists(paths(oldId).natural)).toBe(false)
  })

  it('removes only a reservation that still belongs to the session', async () => {
    const matching = await createRunning('bg-matching-name', {
      name: 'matching-name',
    })
    await finishNaturally(matching, { exitCode: 0 })
    await writeReservation(matching.name!, matching.id)

    const reassigned = await createRunning('bg-reassigned-name', {
      name: 'reassigned-name',
    })
    await finishNaturally(reassigned, { exitCode: 0 })
    await writeReservation(reassigned.name!, 'bg-new-owner')

    await cleanupBackgroundSessionsBefore(CUTOFF)

    expect(await exists(reservationPath(matching.name!))).toBe(false)
    expect(await exists(reservationPath(reassigned.name!))).toBe(true)
    expect(await exists(paths(reassigned.id).metadata)).toBe(false)
  })

  it('does not remove a reservation replaced during artifact cleanup', async () => {
    const session = await createRunning('bg-reservation-replaced', {
      name: 'reservation-replaced',
    })
    await finishNaturally(session, { exitCode: 0 })
    await writeReservation(session.name!, session.id)
    let replaced = false

    await cleanupBackgroundSessionsBefore(CUTOFF, {
      unlinkFile: async path => {
        await unlink(path)
        if (!replaced && path === paths(session.id).stdout) {
          replaced = true
          await writeReservation(session.name!, 'bg-new-owner')
        }
      },
    })

    expect(
      JSON.parse(await readFile(reservationPath(session.name!), 'utf8')),
    ).toMatchObject({ id: 'bg-new-owner' })
    expect(await exists(paths(session.id).metadata)).toBe(false)
  })

  it(
    'serializes cleanup with a replacement using the supported name writer',
    async () => {
      const session = await createRunning('bg-reservation-generation', {
        name: 'reservation-generation',
      })
      await finishNaturally(session, { exitCode: 0 })
      await writeReservation(session.name!, session.id)
      const target = reservationPath(session.name!)
      let replacementPromise: Promise<BackgroundSession> | undefined
      let replacementStarted = false
      let cleanupLockAcquired = false
      let cleanupLockReleased = false
      let replacementLockAttempted = false
      let targetLockCalls = 0
      let signalCleanupLockRelease!: () => void
      const cleanupLockRelease = new Promise<void>(resolve => {
        signalCleanupLockRelease = resolve
      })
      let signalReplacementLockAttempt!: () => void
      const replacementLockAttempt = new Promise<void>(resolve => {
        signalReplacementLockAttempt = resolve
      })
      const originalLock = nameReservationLock.lock
      const lockSpy = spyOn(nameReservationLock, 'lock').mockImplementation(
        async (path, options) => {
          if (path !== target) return await originalLock(path, options)
          targetLockCalls++
          if (!replacementStarted) {
            cleanupLockAcquired = true
            const release = await originalLock(path, options)
            return async () => {
              try {
                await release()
              } finally {
                cleanupLockReleased = true
                signalCleanupLockRelease()
              }
            }
          }

          replacementLockAttempted = true
          signalReplacementLockAttempt()
          await cleanupLockRelease
          return await originalLock(path, options)
        },
      )

      const result = await (async () => {
        try {
          return await cleanupBackgroundSessionsBefore(CUTOFF, {
            _beforeReservationRemovalForTesting: async path => {
              if (path !== target) return
              if (!cleanupLockAcquired) {
                throw new Error(
                  'cleanup did not acquire the name lock before reservation removal',
                )
              }
              replacementStarted = true
              replacementPromise = createBackgroundSession({
                id: 'bg-new-generation',
                name: session.name,
                pid: nextPid++,
                cwd: configDir,
                command: ['openclaude', '--print', 'replacement'],
                sessionId: 'replacement-conversation',
              })
              let timeout: ReturnType<typeof setTimeout> | undefined
              try {
                await Promise.race([
                  replacementLockAttempt,
                  new Promise<void>((_, reject) => {
                    timeout = setTimeout(
                      () =>
                        reject(
                          new Error('replacement lock barrier timed out'),
                        ),
                      5_000,
                    )
                    timeout.unref?.()
                  }),
                ])
              } finally {
                if (timeout !== undefined) clearTimeout(timeout)
              }
            },
          })
        } finally {
          lockSpy.mockRestore()
        }
      })()

      expect({
        cleanupLockAcquired,
        cleanupLockReleased,
        replacementLockAttempted,
        replacementStarted,
        targetLockCalls,
      }).toEqual({
        cleanupLockAcquired: true,
        cleanupLockReleased: true,
        replacementLockAttempted: true,
        replacementStarted: true,
        targetLockCalls: 2,
      })
      expect(result).toEqual({
        sessionsRemoved: 1,
        artifactsRemoved: 5,
        errors: 0,
      })
      expect(replacementPromise).toBeDefined()
      if (!replacementPromise) {
        throw new Error('replacement writer did not run')
      }
      const replacement = await replacementPromise
      expect(
        JSON.parse(await readFile(target, 'utf8')),
      ).toMatchObject({ id: replacement.id })
      expect(await exists(paths(session.id).metadata)).toBe(false)
      expect(await exists(paths(replacement.id).metadata)).toBe(true)
    },
    10_000,
  )

  it('allows a replacement to claim the name after cleanup', async () => {
    const session = await createRunning('bg-reservation-final-window', {
      name: 'reservation-final-window',
    })
    await finishNaturally(session, { exitCode: 0 })
    await writeReservation(session.name!, session.id)
    const target = reservationPath(session.name!)

    await cleanupBackgroundSessionsBefore(CUTOFF)
    const replacement = await createBackgroundSession({
      id: 'bg-reservation-final-replacement',
      name: session.name,
      pid: nextPid++,
      cwd: configDir,
      command: ['openclaude', '--print', 'replacement'],
      sessionId: 'replacement-conversation',
    })

    expect(
      JSON.parse(await readFile(target, 'utf8')),
    ).toMatchObject({ id: replacement.id })
  })

  it('counts reservation unlink failure and keeps metadata for retry', async () => {
    const session = await createRunning('bg-reservation-error', {
      name: 'reservation-error',
    })
    await finishNaturally(session, { exitCode: 0 })
    await writeReservation(session.name!, session.id)
    const target = reservationPath(session.name!)

    const result = await cleanupBackgroundSessionsBefore(CUTOFF, {
      unlinkFile: async path => {
        if (path === target) throw deniedError()
        await unlink(path)
      },
    })

    expect(result.errors).toBe(1)
    expect(await exists(paths(session.id).metadata)).toBe(true)
    expect(await exists(paths(session.id).natural)).toBe(true)
    expect(await exists(target)).toBe(true)
  })

  it('counts a reservation read error and retains the session', async () => {
    const session = await createRunning('bg-reservation-read-error', {
      name: 'reservation-read-error',
    })
    await finishNaturally(session, { exitCode: 0 })
    await writeReservation(session.name!, session.id)
    const target = reservationPath(session.name!)

    const result = await cleanupBackgroundSessionsBefore(CUTOFF, {
      readTextFile: async path => {
        if (path === target) throw deniedError()
        return await readFile(path, 'utf8')
      },
    })

    expect(result.errors).toBe(1)
    expect(result.sessionsRemoved).toBe(0)
    expect(await exists(paths(session.id).metadata)).toBe(true)
    expect(await exists(paths(session.id).natural)).toBe(true)
    expect(await exists(target)).toBe(true)
  })

  it('preserves a malformed reservation while cleaning owned artifacts', async () => {
    const session = await createRunning('bg-malformed-reservation', {
      name: 'malformed-reservation',
    })
    await finishNaturally(session, { exitCode: 0 })
    const target = reservationPath(session.name!)
    await writeFile(target, '{bad json')

    const result = await cleanupBackgroundSessionsBefore(CUTOFF)

    expect(result).toEqual({
      sessionsRemoved: 1,
      artifactsRemoved: 4,
      errors: 0,
    })
    expect(await exists(target)).toBe(true)
    expect(await exists(paths(session.id).metadata)).toBe(false)
  })

  it('reports sessions-directory errors without throwing', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'sessions'), 'not a directory')

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 1,
    })
  })

  it('treats a missing sessions directory as an empty registry', async () => {
    await mkdir(root, { recursive: true })

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 0,
    })
  })

  it('retains eligible sessions when the terminal directory is invalid', async () => {
    const session = await writeRawSession({
      id: 'bg-invalid-terminal-directory',
      status: 'exited',
      finishedAt: OLD_FINISH.toISOString(),
    })
    await rm(join(root, 'terminal'), { recursive: true, force: true })
    await writeFile(join(root, 'terminal'), 'not a directory')

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 0,
      artifactsRemoved: 0,
      errors: 1,
    })
    expect(await exists(paths(session.id).metadata)).toBe(true)
    expect(await exists(paths(session.id).stdout)).toBe(true)
  })

  it('cleans an unnamed session when only the names directory is invalid', async () => {
    const session = await writeRawSession({
      id: 'bg-invalid-names-directory',
      status: 'exited',
      finishedAt: OLD_FINISH.toISOString(),
    })
    await rm(join(root, 'names'), { recursive: true, force: true })
    await writeFile(join(root, 'names'), 'not a directory')

    expect(await cleanupBackgroundSessionsBefore(CUTOFF)).toEqual({
      sessionsRemoved: 1,
      artifactsRemoved: 3,
      errors: 1,
    })
    expect(await exists(paths(session.id).metadata)).toBe(false)
  })
})
