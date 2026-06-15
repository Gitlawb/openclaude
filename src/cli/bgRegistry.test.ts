import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setClaudeConfigHomeDirForTesting } from '../utils/envUtils.js'
import {
  createBackgroundSession,
  listBackgroundSessions,
  markBackgroundSessionKilled,
  refreshBackgroundSessionStatuses,
  resolveBackgroundSession,
} from './bgRegistry.js'

describe('background session registry', () => {
  let configDir: string

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'openclaude-bg-registry-'))
    setClaudeConfigHomeDirForTesting(configDir)
  })

  afterEach(async () => {
    setClaudeConfigHomeDirForTesting(undefined)
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
