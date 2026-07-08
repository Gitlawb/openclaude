import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _setBackgroundSessionsRootForTesting,
  createBackgroundSession,
  isBackgroundSessionProcessAlive,
  isTerminalBackgroundSession,
  listBackgroundSessions,
  markBackgroundSessionKilled,
  refreshBackgroundSessionStatuses,
  resolveBackgroundSession,
  type BackgroundSession,
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

  it('resolves exact live names before session id prefixes', async () => {
    await createBackgroundSession({
      id: 'bg-abcdef',
      pid: 111,
      cwd: '/repo',
      command: ['openclaude', '--print', 'work'],
      sessionId: 'conversation-1',
    })
    await createBackgroundSession({
      id: 'bg-named',
      name: 'bg-abc',
      pid: 222,
      cwd: '/repo',
      command: ['openclaude', '--print', 'named'],
      sessionId: 'conversation-2',
    })

    expect((await resolveBackgroundSession('bg-abc')).id).toBe('bg-named')
  })

  it('resolves exact session ids before exact session names', async () => {
    await createBackgroundSession({
      id: 'bg-target',
      pid: 111,
      cwd: '/repo',
      command: ['openclaude', '--print', 'id'],
      sessionId: 'conversation-id',
    })
    await createBackgroundSession({
      id: 'bg-named',
      name: 'bg-target',
      pid: 222,
      cwd: '/repo',
      command: ['openclaude', '--print', 'named'],
      sessionId: 'conversation-name',
    })

    expect((await resolveBackgroundSession('bg-target')).id).toBe('bg-target')
  })

  it('resolves unique session id prefixes when no exact name matches', async () => {
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

  it('rejects ambiguous session id prefixes', async () => {
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

    await expect(resolveBackgroundSession('bg-prefix')).rejects.toThrow(
      'ambiguous',
    )
  })

  it('preserves missing session target errors', async () => {
    await expect(resolveBackgroundSession('missing')).rejects.toThrow(
      'No background session found',
    )
  })

  it('resolves unique terminal session names', async () => {
    await createBackgroundSession({
      id: 'bg-old',
      name: 'old-name',
      pid: 111,
      cwd: '/repo',
      command: ['openclaude', '--print', 'old'],
      sessionId: 'conversation-old',
    })
    await markBackgroundSessionKilled('bg-old')

    expect((await resolveBackgroundSession('old-name')).id).toBe('bg-old')
  })

  it('rejects duplicate terminal session names as ambiguous', async () => {
    await createBackgroundSession({
      id: 'bg-old-one',
      name: 'old-shared',
      pid: 111,
      cwd: '/repo',
      command: ['openclaude', '--print', 'old-one'],
      sessionId: 'conversation-old-one',
    })
    await markBackgroundSessionKilled('bg-old-one')
    await createBackgroundSession({
      id: 'bg-old-two',
      name: 'old-shared',
      pid: 222,
      cwd: '/repo',
      command: ['openclaude', '--print', 'old-two'],
      sessionId: 'conversation-old-two',
    })
    await markBackgroundSessionKilled('bg-old-two')

    await expect(resolveBackgroundSession('old-shared')).rejects.toThrow(
      'Background session name "old-shared" is ambiguous',
    )
  })

  it('rejects duplicate live names before considering id prefixes', async () => {
    await mkdir(join(configDir, 'bg-sessions', 'sessions'), {
      recursive: true,
    })
    const base = {
      cwd: '/repo',
      status: 'running',
      startedAt: '2026-06-15T08:00:00.000Z',
      updatedAt: '2026-06-15T08:00:00.000Z',
      command: ['openclaude', '--print', 'work'],
      stdoutLogPath: '/tmp/stdout.log',
      stderrLogPath: '/tmp/stderr.log',
    }
    await writeFile(
      join(configDir, 'bg-sessions', 'sessions', 'bg-live-one.json'),
      JSON.stringify({
        ...base,
        id: 'bg-live-one',
        name: 'bg-abc',
        pid: 111,
        sessionId: 'conversation-live-one',
      }),
    )
    await writeFile(
      join(configDir, 'bg-sessions', 'sessions', 'bg-live-two.json'),
      JSON.stringify({
        ...base,
        id: 'bg-live-two',
        name: 'bg-abc',
        pid: 222,
        sessionId: 'conversation-live-two',
      }),
    )
    await createBackgroundSession({
      id: 'bg-abcdef',
      pid: 333,
      cwd: '/repo',
      command: ['openclaude', '--print', 'prefix'],
      sessionId: 'conversation-prefix',
    })

    await expect(resolveBackgroundSession('bg-abc')).rejects.toThrow(
      'Background session name "bg-abc" is ambiguous',
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

describe('isBackgroundSessionProcessAlive process identity', () => {
  const session: BackgroundSession = {
    id: 'bg-identity',
    pid: 4242,
    cwd: '/repo',
    status: 'running',
    startedAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
    // sessionId deliberately absent from the command lines below so the stored
    // launch invocation (command) is what has to match.
    sessionId: 'conversation-identity',
    command: ['node', 'openclaude', '1642'],
    stdoutLogPath: '/tmp/stdout.log',
    stderrLogPath: '/tmp/stderr.log',
  }

  it('does not treat a reused PID whose command merely contains the arg as alive (#1770)', () => {
    // The live process at this PID is unrelated: its final token "16420" only
    // contains the stored selector "1642" as a substring. Ordered substring
    // matching wrongly reported this session as alive, so `kill` could target
    // the wrong process.
    const alive = isBackgroundSessionProcessAlive(session, {
      isProcessAlive: () => true,
      getProcessCommand: () => 'node openclaude 16420 --serve',
    })
    expect(alive).toBe(false)
  })

  it('still recognizes the real process by exact command tokens', () => {
    const alive = isBackgroundSessionProcessAlive(session, {
      isProcessAlive: () => true,
      getProcessCommand: () => 'node openclaude 1642 --serve',
    })
    expect(alive).toBe(true)
  })

  it('matches on the session id when it is present on the command line', () => {
    const alive = isBackgroundSessionProcessAlive(session, {
      isProcessAlive: () => true,
      getProcessCommand: () => 'node openclaude conversation-identity',
    })
    expect(alive).toBe(true)
  })

  it('does not match the session id as a substring of a larger token (#1770)', () => {
    // A short id must not match an unrelated live command that merely contains
    // it inside a longer token — the same reused-PID collision class as the
    // command-arg path. Command args are absent from the live line so only the
    // session-id branch can produce a match here.
    const shortIdSession: BackgroundSession = {
      ...session,
      sessionId: 'sess-1',
      command: ['node', 'openclaude', 'unused-token'],
    }
    const alive = isBackgroundSessionProcessAlive(shortIdSession, {
      isProcessAlive: () => true,
      getProcessCommand: () => 'node openclaude sess-100 --serve',
    })
    expect(alive).toBe(false)
  })

  it('matches the session id only as a whole token', () => {
    const shortIdSession: BackgroundSession = {
      ...session,
      sessionId: 'sess-1',
      command: ['node', 'openclaude', 'unused-token'],
    }
    const alive = isBackgroundSessionProcessAlive(shortIdSession, {
      isProcessAlive: () => true,
      getProcessCommand: () => 'node openclaude sess-1 --serve',
    })
    expect(alive).toBe(true)
  })

  it('matches a stored multi-word prompt arg across command tokens (#1770)', () => {
    // A prompt like "refactor auth" is stored as a single argv entry but `ps`
    // renders it as separate words; the matcher must span both. The session id
    // is absent from the live line so the command args are what must match.
    const promptSession: BackgroundSession = {
      ...session,
      sessionId: 'conversation-absent',
      command: ['node', 'openclaude', '--print', 'refactor auth'],
    }
    const alive = isBackgroundSessionProcessAlive(promptSession, {
      isProcessAlive: () => true,
      getProcessCommand: () =>
        'node openclaude --print refactor auth --serve',
    })
    expect(alive).toBe(true)
  })

  it('matches a quoted Windows command line with a spaced exe path and prompt (#1770)', () => {
    // Windows `Get-CimInstance ... CommandLine` returns the raw command line
    // with quoted paths/prompts, so a whitespace split fuses quotes onto the
    // edge tokens (`"C:\Program`, `node.exe"`, `"refactor`, `auth"`). The stored
    // argv holds those values unquoted, so without quote trimming the contiguous
    // run never matched and a live `--from-pr` resume (whose only identity path
    // is the stored command) was wrongly marked stale.
    const windowsSession: BackgroundSession = {
      ...session,
      sessionId: 'conversation-absent',
      command: [
        'C:\\Program Files\\nodejs\\node.exe',
        'C:\\repo\\dist\\cli.mjs',
        '--from-pr',
        '1642',
        '--print',
        'refactor auth',
      ],
    }
    const alive = isBackgroundSessionProcessAlive(windowsSession, {
      isProcessAlive: () => true,
      getProcessCommand: () =>
        '"C:\\Program Files\\nodejs\\node.exe" C:\\repo\\dist\\cli.mjs --from-pr 1642 --print "refactor auth"',
    })
    expect(alive).toBe(true)
  })

  it('quote trimming does not reopen the substring collision (#1770)', () => {
    // Trimming surrounding quotes must not degrade to substring matching: a
    // quoted live token "16420" still only contains the stored selector "1642",
    // so it must not satisfy the lookup.
    const alive = isBackgroundSessionProcessAlive(session, {
      isProcessAlive: () => true,
      getProcessCommand: () => '"node" openclaude "16420" --serve',
    })
    expect(alive).toBe(false)
  })

  it('does not treat interspersed stored tokens as alive (#1770)', () => {
    // The stored tokens all appear on the live command line but only as an
    // ordered subsequence with unrelated tokens ("attacker", "extra") wedged
    // between them, i.e. a different process at a reused PID. Requiring a
    // contiguous whole-token run rejects this token-insertion collision; a
    // subsequence match would wrongly report it alive and risk killing the
    // wrong process.
    const alive = isBackgroundSessionProcessAlive(session, {
      isProcessAlive: () => true,
      getProcessCommand: () => 'node attacker openclaude extra 1642 --serve',
    })
    expect(alive).toBe(false)
  })

  it('reports a dead process regardless of command line', () => {
    const alive = isBackgroundSessionProcessAlive(session, {
      isProcessAlive: () => false,
      getProcessCommand: () => 'node openclaude 1642',
    })
    expect(alive).toBe(false)
  })
})
