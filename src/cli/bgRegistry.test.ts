import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _setBackgroundSessionsRootForTesting,
  createBackgroundSession,
  isTerminalBackgroundSession,
  listBackgroundSessions,
  markBackgroundSessionKilled,
  refreshBackgroundSessionStatuses,
  resolveBackgroundSession,
} from './bgRegistry.js'

describe('background session registry', () => {
  let configDir: string

  function nameReservationPath(name: string): string {
    const digest = createHash('sha256').update(name).digest('hex')
    return join(configDir, 'bg-sessions', 'names', `${digest}.json`)
  }

  async function writeNameReservation(
    name: string,
    reservation: {
      id: string
      creatorPid?: number
      createdAt?: string
    },
  ): Promise<void> {
    await mkdir(join(configDir, 'bg-sessions', 'names'), { recursive: true })
    await writeFile(
      nameReservationPath(name),
      JSON.stringify({ name, ...reservation }),
    )
  }

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'openclaude-bg-registry-'))
    _setBackgroundSessionsRootForTesting(join(configDir, 'bg-sessions'))
  })

  afterEach(async () => {
    _setBackgroundSessionsRootForTesting(undefined)
    await rm(configDir, { force: true, recursive: true })
  })

  it('creates session metadata and log files under the OpenClaude config dir', async () => {
    const session = await createBackgroundSession({
      id: 'bg-test-1',
      name: 'auth-refactor',
      pid: 12345,
      cwd: '/repo',
      command: ['openclaude', '--print', 'refactor auth'],
      provider: 'openai',
      model: 'gpt-5',
      sessionId: 'conversation-1',
      now: new Date('2026-06-15T08:00:00.000Z'),
    })

    expect(session).toMatchObject({
      id: 'bg-test-1',
      name: 'auth-refactor',
      pid: 12345,
      cwd: '/repo',
      status: 'running',
      provider: 'openai',
      model: 'gpt-5',
      sessionId: 'conversation-1',
      startedAt: '2026-06-15T08:00:00.000Z',
      updatedAt: '2026-06-15T08:00:00.000Z',
      command: ['openclaude', '--print', 'refactor auth'],
    })
    expect(session.stdoutLogPath).toBe(
      join(configDir, 'bg-sessions', 'logs', 'bg-test-1.out.log'),
    )
    expect(session.stderrLogPath).toBe(
      join(configDir, 'bg-sessions', 'logs', 'bg-test-1.err.log'),
    )

    const sessions = await listBackgroundSessions()
    expect(sessions.map(s => s.id)).toEqual(['bg-test-1'])
  })

  it('resolves sessions by id, id prefix, and name', async () => {
    await createBackgroundSession({
      id: 'bg-abcdef',
      name: 'named-session',
      pid: 111,
      cwd: '/repo',
      command: ['openclaude', '--print', 'work'],
      sessionId: 'conversation-1',
    })

    expect((await resolveBackgroundSession('bg-abcdef')).id).toBe('bg-abcdef')
    expect((await resolveBackgroundSession('bg-abc')).id).toBe('bg-abcdef')
    expect((await resolveBackgroundSession('named-session')).id).toBe(
      'bg-abcdef',
    )
  })

  it('rejects missing and ambiguous session targets', async () => {
    await createBackgroundSession({
      id: 'bg-prefix-one',
      pid: 111,
      cwd: '/repo',
      command: ['openclaude', '--print', 'one'],
      sessionId: 'conversation-1',
    })
    await createBackgroundSession({
      id: 'bg-prefix-two',
      pid: 222,
      cwd: '/repo',
      command: ['openclaude', '--print', 'two'],
      sessionId: 'conversation-2',
    })

    await expect(resolveBackgroundSession('missing')).rejects.toThrow(
      'No background session found',
    )
    await expect(resolveBackgroundSession('bg-prefix')).rejects.toThrow(
      'ambiguous',
    )
  })

  it('rejects duplicate names and reports ambiguous names', async () => {
    await createBackgroundSession({
      id: 'bg-one',
      name: 'shared',
      pid: 111,
      cwd: '/repo',
      command: ['openclaude', '--print', 'one'],
      sessionId: 'conversation-1',
    })

    await expect(
      createBackgroundSession({
        id: 'bg-two',
        name: 'shared',
        pid: 222,
        cwd: '/repo',
        command: ['openclaude', '--print', 'two'],
        sessionId: 'conversation-2',
      }),
    ).rejects.toThrow('already exists')
  })

  it('rejects concurrent duplicate live names atomically', async () => {
    const attempts = await Promise.allSettled([
      createBackgroundSession({
        id: 'bg-race-one',
        name: 'shared-race',
        pid: 111,
        cwd: '/repo',
        command: ['openclaude', '--print', 'one'],
        sessionId: 'conversation-1',
      }),
      createBackgroundSession({
        id: 'bg-race-two',
        name: 'shared-race',
        pid: 222,
        cwd: '/repo',
        command: ['openclaude', '--print', 'two'],
        sessionId: 'conversation-2',
      }),
    ])
    const fulfilled = attempts.filter(result => result.status === 'fulfilled')
    const rejected = attempts.find(result => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected?.status).toBe('rejected')
    if (!rejected || rejected.status !== 'rejected') {
      throw new Error('Expected one duplicate-name registration to fail')
    }
    expect(String(rejected.reason?.message ?? rejected.reason)).toContain(
      'already exists',
    )
    expect(
      (await listBackgroundSessions()).filter(
        session => session.name === 'shared-race',
      ),
    ).toHaveLength(1)
  })

  it('does not steal an in-flight name reservation from a live creator', async () => {
    await writeNameReservation('in-flight', {
      id: 'bg-in-flight',
      creatorPid: process.pid,
      createdAt: '2026-06-15T08:00:00.000Z',
    })

    await expect(
      createBackgroundSession({
        id: 'bg-contender',
        name: 'in-flight',
        pid: 222,
        cwd: '/repo',
        command: ['openclaude', '--print', 'contender'],
        sessionId: 'conversation-contender',
      }),
    ).rejects.toThrow('already exists')
    expect(await listBackgroundSessions()).toEqual([])
  })

  it('recovers orphaned name reservations whose owner metadata is missing', async () => {
    await writeNameReservation('orphaned', {
      id: 'bg-missing-owner',
      creatorPid: Number.MAX_SAFE_INTEGER,
      createdAt: '2026-06-15T08:00:00.000Z',
    })

    const session = await createBackgroundSession({
      id: 'bg-recovered',
      name: 'orphaned',
      pid: 222,
      cwd: '/repo',
      command: ['openclaude', '--print', 'recovered'],
      sessionId: 'conversation-recovered',
    })

    expect(session.name).toBe('orphaned')
    expect((await listBackgroundSessions()).map(s => s.id)).toEqual([
      'bg-recovered',
    ])
  })

  it('recovers name reservations owned by terminal sessions', async () => {
    await mkdir(join(configDir, 'bg-sessions', 'sessions'), {
      recursive: true,
    })
    await writeFile(
      join(configDir, 'bg-sessions', 'sessions', 'bg-terminal-owner.json'),
      JSON.stringify({
        id: 'bg-terminal-owner',
        name: 'terminal-name',
        pid: 111,
        cwd: '/repo',
        status: 'killed',
        sessionId: 'conversation-terminal',
        startedAt: '2026-06-15T08:00:00.000Z',
        updatedAt: '2026-06-15T08:05:00.000Z',
        command: ['openclaude', '--print', 'old'],
        stdoutLogPath: '/tmp/old-out.log',
        stderrLogPath: '/tmp/old-err.log',
      }),
    )
    await writeNameReservation('terminal-name', {
      id: 'bg-terminal-owner',
      creatorPid: process.pid,
      createdAt: '2026-06-15T08:00:00.000Z',
    })

    const session = await createBackgroundSession({
      id: 'bg-new-owner',
      name: 'terminal-name',
      pid: 222,
      cwd: '/repo',
      command: ['openclaude', '--print', 'new'],
      sessionId: 'conversation-new',
    })

    expect(session.name).toBe('terminal-name')
    expect((await resolveBackgroundSession('terminal-name')).id).toBe(
      'bg-new-owner',
    )
  })

  it('allows terminal session names to be reused and resolves the active match', async () => {
    await createBackgroundSession({
      id: 'bg-old',
      name: 'reuse-me',
      pid: 111,
      cwd: '/repo',
      command: ['openclaude', '--print', 'old'],
      sessionId: 'conversation-old',
    })
    await markBackgroundSessionKilled('bg-old')

    await createBackgroundSession({
      id: 'bg-new',
      name: 'reuse-me',
      pid: 222,
      cwd: '/repo',
      command: ['openclaude', '--print', 'new'],
      sessionId: 'conversation-new',
    })

    expect((await resolveBackgroundSession('reuse-me')).id).toBe('bg-new')
  })

  it('does not overwrite existing metadata on id collision', async () => {
    await createBackgroundSession({
      id: 'bg-collision',
      name: 'first',
      pid: 111,
      cwd: '/repo',
      command: ['openclaude', '--print', 'one'],
      sessionId: 'conversation-1',
    })

    await expect(
      createBackgroundSession({
        id: 'bg-collision',
        name: 'second',
        pid: 222,
        cwd: '/repo',
        command: ['openclaude', '--print', 'two'],
        sessionId: 'conversation-2',
      }),
    ).rejects.toThrow('already exists')
    expect((await resolveBackgroundSession('bg-collision')).name).toBe('first')
  })

  it('rejects non-positive pids at creation', async () => {
    await expect(
      createBackgroundSession({
        id: 'bg-zero-pid',
        pid: 0,
        cwd: '/repo',
        command: ['openclaude', '--print', 'zero'],
        sessionId: 'conversation-zero',
      }),
    ).rejects.toThrow('Invalid background session pid')

    await expect(
      createBackgroundSession({
        id: 'bg-negative-pid',
        pid: -1,
        cwd: '/repo',
        command: ['openclaude', '--print', 'negative'],
        sessionId: 'conversation-negative',
      }),
    ).rejects.toThrow('Invalid background session pid')

    expect(await listBackgroundSessions()).toEqual([])
  })

  it('registers a session whose log files were created before spawn', async () => {
    const stdoutLogPath = join(
      configDir,
      'bg-sessions',
      'logs',
      'bg-precreated.out.log',
    )
    const stderrLogPath = join(
      configDir,
      'bg-sessions',
      'logs',
      'bg-precreated.err.log',
    )
    await mkdir(join(configDir, 'bg-sessions', 'logs'), {
      recursive: true,
    })
    await writeFile(stdoutLogPath, '')
    await writeFile(stderrLogPath, '')

    const session = await createBackgroundSession({
      id: 'bg-precreated',
      pid: 222,
      cwd: '/repo',
      command: ['openclaude', '--print', 'work'],
      sessionId: 'conversation-1',
      stdoutLogPath,
      stderrLogPath,
      logFilesPrecreated: true,
    })

    expect(session.stdoutLogPath).toBe(stdoutLogPath)
    expect(session.stderrLogPath).toBe(stderrLogPath)
    expect((await resolveBackgroundSession('bg-precreated')).id).toBe(
      'bg-precreated',
    )
  })

  it('preserves caller-owned precreated logs when metadata registration fails', async () => {
    const stdoutLogPath = join(
      configDir,
      'bg-sessions',
      'logs',
      'bg-precreated-collision.out.log',
    )
    const stderrLogPath = join(
      configDir,
      'bg-sessions',
      'logs',
      'bg-precreated-collision.err.log',
    )
    await mkdir(join(configDir, 'bg-sessions', 'logs'), {
      recursive: true,
    })
    await mkdir(join(configDir, 'bg-sessions', 'sessions'), {
      recursive: true,
    })
    await writeFile(stdoutLogPath, 'stdout already belongs to caller')
    await writeFile(stderrLogPath, 'stderr already belongs to caller')
    await writeFile(
      join(
        configDir,
        'bg-sessions',
        'sessions',
        'bg-precreated-collision.json',
      ),
      JSON.stringify({
        id: 'bg-precreated-collision',
        pid: 111,
        cwd: '/repo',
        status: 'running',
        sessionId: 'conversation-1',
        startedAt: '2026-06-15T08:00:00.000Z',
        updatedAt: '2026-06-15T08:00:00.000Z',
        command: ['openclaude', '--print', 'one'],
        stdoutLogPath: '/tmp/existing-out.log',
        stderrLogPath: '/tmp/existing-err.log',
      }),
    )

    await expect(
      createBackgroundSession({
        id: 'bg-precreated-collision',
        pid: 222,
        cwd: '/repo',
        command: ['openclaude', '--print', 'two'],
        sessionId: 'conversation-2',
        stdoutLogPath,
        stderrLogPath,
        logFilesPrecreated: true,
      }),
    ).rejects.toThrow('already exists')

    expect(await Bun.file(stdoutLogPath).text()).toBe(
      'stdout already belongs to caller',
    )
    expect(await Bun.file(stderrLogPath).text()).toBe(
      'stderr already belongs to caller',
    )
  })

  it('cleans up logs created before detecting a metadata id collision', async () => {
    await mkdir(join(configDir, 'bg-sessions', 'sessions'), {
      recursive: true,
    })
    await writeFile(
      join(configDir, 'bg-sessions', 'sessions', 'bg-log-cleanup.json'),
      JSON.stringify({
        id: 'bg-log-cleanup',
        pid: 111,
        cwd: '/repo',
        status: 'running',
        sessionId: 'conversation-1',
        startedAt: '2026-06-15T08:00:00.000Z',
        updatedAt: '2026-06-15T08:00:00.000Z',
        command: ['openclaude', '--print', 'one'],
        stdoutLogPath: '/tmp/existing-out.log',
        stderrLogPath: '/tmp/existing-err.log',
      }),
    )

    await expect(
      createBackgroundSession({
        id: 'bg-log-cleanup',
        pid: 222,
        cwd: '/repo',
        command: ['openclaude', '--print', 'two'],
        sessionId: 'conversation-2',
      }),
    ).rejects.toThrow('already exists')

    expect(
      await Bun.file(
        join(configDir, 'bg-sessions', 'logs', 'bg-log-cleanup.out.log'),
      ).exists(),
    ).toBe(false)
    expect(
      await Bun.file(
        join(configDir, 'bg-sessions', 'logs', 'bg-log-cleanup.err.log'),
      ).exists(),
    ).toBe(false)
  })

  it('marks running sessions stale when their process is gone', async () => {
    await createBackgroundSession({
      id: 'bg-stale',
      pid: 333,
      cwd: '/repo',
      command: ['openclaude', '--print', 'work'],
      sessionId: 'conversation-1',
      now: new Date('2026-06-15T08:00:00.000Z'),
    })

    const refreshed = await refreshBackgroundSessionStatuses({
      isProcessAlive: () => false,
      now: new Date('2026-06-15T08:05:00.000Z'),
    })

    expect(refreshed).toHaveLength(1)
    expect(refreshed[0]).toMatchObject({
      id: 'bg-stale',
      status: 'stale',
      updatedAt: '2026-06-15T08:05:00.000Z',
    })
  })

  it('keeps running sessions fresh when their process identity still matches', async () => {
    await createBackgroundSession({
      id: 'bg-running',
      pid: 333,
      cwd: '/repo',
      command: ['openclaude', '--session-id', 'conversation-1', '--print', 'work'],
      sessionId: 'conversation-1',
      now: new Date('2026-06-15T08:00:00.000Z'),
    })

    const refreshed = await refreshBackgroundSessionStatuses({
      isProcessAlive: () => true,
      getProcessCommand: () =>
        'node openclaude --session-id conversation-1 --print work',
      now: new Date('2026-06-15T08:05:00.000Z'),
    })

    expect(refreshed[0]).toMatchObject({
      id: 'bg-running',
      status: 'running',
      updatedAt: '2026-06-15T08:00:00.000Z',
    })
  })

  it('keeps PR-resume sessions fresh when the live command matches the stored invocation', async () => {
    await createBackgroundSession({
      id: 'bg-from-pr',
      pid: 333,
      cwd: '/repo',
      command: ['openclaude', '--from-pr', '1642', '--print'],
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      now: new Date('2026-06-15T08:00:00.000Z'),
    })

    const refreshed = await refreshBackgroundSessionStatuses({
      isProcessAlive: () => true,
      getProcessCommand: () => 'node openclaude --from-pr 1642 --print',
      now: new Date('2026-06-15T08:05:00.000Z'),
    })

    expect(refreshed[0]).toMatchObject({
      id: 'bg-from-pr',
      status: 'running',
      updatedAt: '2026-06-15T08:00:00.000Z',
    })
  })

  it('marks sessions stale when a live PID no longer matches the session command', async () => {
    await createBackgroundSession({
      id: 'bg-reused-pid',
      pid: 333,
      cwd: '/repo',
      command: ['openclaude', '--session-id', 'conversation-1', '--print', 'work'],
      sessionId: 'conversation-1',
      now: new Date('2026-06-15T08:00:00.000Z'),
    })

    const refreshed = await refreshBackgroundSessionStatuses({
      isProcessAlive: () => true,
      getProcessCommand: () => 'unrelated-process',
      now: new Date('2026-06-15T08:05:00.000Z'),
    })

    expect(refreshed[0]).toMatchObject({
      id: 'bg-reused-pid',
      status: 'stale',
      updatedAt: '2026-06-15T08:05:00.000Z',
    })
  })

  it('marks sessions unknown when a live PID command identity cannot be read', async () => {
    await createBackgroundSession({
      id: 'bg-unreadable-pid',
      pid: 333,
      cwd: '/repo',
      command: ['openclaude', '--session-id', 'conversation-1', '--print', 'work'],
      sessionId: 'conversation-1',
      now: new Date('2026-06-15T08:00:00.000Z'),
    })

    const refreshed = await refreshBackgroundSessionStatuses({
      isProcessAlive: () => true,
      getProcessCommand: () => null,
      now: new Date('2026-06-15T08:05:00.000Z'),
    })

    expect(refreshed[0]).toMatchObject({
      id: 'bg-unreadable-pid',
      status: 'unknown',
      updatedAt: '2026-06-15T08:05:00.000Z',
    })
    expect(isTerminalBackgroundSession(refreshed[0]!)).toBe(false)
  })

  it('marks a session killed without deleting its logs or metadata', async () => {
    await createBackgroundSession({
      id: 'bg-kill',
      pid: 444,
      cwd: '/repo',
      command: ['openclaude', '--print', 'work'],
      sessionId: 'conversation-1',
    })

    const killed = await markBackgroundSessionKilled('bg-kill', {
      now: new Date('2026-06-15T08:10:00.000Z'),
    })

    expect(killed.status).toBe('killed')
    expect(killed.updatedAt).toBe('2026-06-15T08:10:00.000Z')
    expect((await listBackgroundSessions()).map(s => s.id)).toEqual(['bg-kill'])
  })

  it('ignores malformed metadata files instead of returning unsafe sessions', async () => {
    await mkdir(join(configDir, 'bg-sessions', 'sessions'), {
      recursive: true,
    })
    await writeFile(
      join(configDir, 'bg-sessions', 'sessions', 'bad.json'),
      JSON.stringify({
        id: 'bg-bad',
        pid: 123,
        status: 'running',
      }),
    )

    expect(await listBackgroundSessions()).toEqual([])
  })

  it('ignores metadata with a non-positive pid', async () => {
    await mkdir(join(configDir, 'bg-sessions', 'sessions'), {
      recursive: true,
    })
    await writeFile(
      join(configDir, 'bg-sessions', 'sessions', 'bg-zero-pid.json'),
      JSON.stringify({
        id: 'bg-zero-pid',
        pid: 0,
        cwd: '/repo',
        status: 'running',
        sessionId: 'conversation-1',
        startedAt: '2026-06-15T08:00:00.000Z',
        updatedAt: '2026-06-15T08:00:00.000Z',
        command: ['openclaude', '--print', 'work'],
        stdoutLogPath: '/tmp/stdout.log',
        stderrLogPath: '/tmp/stderr.log',
      }),
    )

    expect(await listBackgroundSessions()).toEqual([])
  })

  it('ignores metadata whose id does not match its filename', async () => {
    await mkdir(join(configDir, 'bg-sessions', 'sessions'), {
      recursive: true,
    })
    await writeFile(
      join(configDir, 'bg-sessions', 'sessions', 'bg-file.json'),
      JSON.stringify({
        id: 'bg-other',
        pid: 123,
        cwd: '/repo',
        status: 'running',
        sessionId: 'conversation-1',
        startedAt: '2026-06-15T08:00:00.000Z',
        updatedAt: '2026-06-15T08:00:00.000Z',
        command: ['openclaude', '--print', 'work'],
        stdoutLogPath: '/tmp/stdout.log',
        stderrLogPath: '/tmp/stderr.log',
      }),
    )

    expect(await listBackgroundSessions()).toEqual([])
  })
})
