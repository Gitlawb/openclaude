import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  _setBackgroundSessionsRootForTesting,
  createBackgroundSession,
  recordBackgroundSessionNaturalTermination,
} from '../cli/bgRegistry.js'
import { cleanupOldSessionFilesInProjectsDir } from './cleanup.js'
import { NodeFsOperations } from './fsOperations.js'

const tempDirs: string[] = []

afterEach(async () => {
  _setBackgroundSessionsRootForTesting(undefined)
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

async function runCleanupFixture(
  configDir: string,
  mode:
    | 'once'
    | 'post-completion'
    | 'post-finalization-gate'
    | 'post-finalization-exact-cutoff'
    | 'post-finalization-timeout'
    | 'explicit-kill' = 'once',
): Promise<Record<string, unknown>> {
  const fixture = join(import.meta.dir, 'cleanupBackgroundSessions.fixture.ts')
  const { USER_TYPE: _userType, ...inheritedEnv } = process.env
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  const child = Bun.spawn([process.execPath, fixture], {
    cwd: configDir,
    env: {
      ...inheritedEnv,
      HOME: configDir,
      XDG_CACHE_HOME: join(configDir, 'cache'),
      OPENCLAUDE_CONFIG_DIR: configDir,
      OPENCLAUDE_CLEANUP_FIXTURE_MODE: mode,
      NODE_ENV: 'test',
    },
    signal: controller.signal,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exitCode, stderr).toBe(0)
    const result = JSON.parse(stdout) as Record<string, unknown>
    if (mode === 'once') expect(result).toEqual({ completed: true })
    return result
  } finally {
    clearTimeout(timeout)
  }
}

async function createCompletedBackgroundSession(
  configDir: string,
  id: string,
  finishedAt: Date,
): Promise<string> {
  const root = join(configDir, 'bg-sessions')
  _setBackgroundSessionsRootForTesting(root)
  await createBackgroundSession({
    id,
    pid: process.pid,
    cwd: configDir,
    command: ['openclaude', '--print', 'fixture'],
    sessionId: `${id}-conversation`,
    now: new Date(finishedAt.getTime() - 60_000),
  })
  await recordBackgroundSessionNaturalTermination(
    id,
    { exitCode: 0 },
    { ownerPid: process.pid, now: finishedAt },
  )
  _setBackgroundSessionsRootForTesting(undefined)
  return join(root, 'sessions', `${id}.json`)
}

describe('cleanupOldSessionFiles', () => {
  test('removes old replay sidecars while preserving non-session files', async () => {
    const projectsDir = join(
      tmpdir(),
      `openclaude-cleanup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      'projects',
    )
    tempDirs.push(projectsDir)

    const projectDir = join(projectsDir, 'project')
    await mkdir(projectDir, { recursive: true })

    const replayPath = join(projectDir, 'session.replay.json')
    const keepPath = join(projectDir, 'session.notes.json')
    await writeFile(replayPath, '{}', 'utf-8')
    await writeFile(keepPath, '{}', 'utf-8')

    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    await utimes(replayPath, oldDate, oldDate)
    await utimes(keepPath, oldDate, oldDate)

    const result = await cleanupOldSessionFilesInProjectsDir(
      projectsDir,
      new Date(),
      NodeFsOperations,
    )

    expect(result.messages).toBe(1)
    await expect(stat(replayPath)).rejects.toThrow()
    expect((await stat(keepPath)).isFile()).toBe(true)
  })
})

describe('cleanupOldMessageFilesInBackground', () => {
  test(
    'removes old completed background-session artifacts through the scheduler',
    async () => {
      const configDir = join(
        tmpdir(),
        `openclaude-cleanup-bg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      )
      tempDirs.push(configDir)
      await mkdir(configDir, { recursive: true })
      await writeFile(
        join(configDir, 'settings.json'),
        JSON.stringify({ cleanupPeriodDays: 30 }),
      )
      const metadataPath = await createCompletedBackgroundSession(
        configDir,
        'bg-scheduler-old',
        new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      )

      await runCleanupFixture(configDir)

      expect(await Bun.file(metadataPath).exists()).toBe(false)
    },
    30_000,
  )

  test(
    'uses cleanupPeriodDays zero for completed background sessions',
    async () => {
      const configDir = join(
        tmpdir(),
        `openclaude-cleanup-bg-zero-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      )
      tempDirs.push(configDir)
      await mkdir(configDir, { recursive: true })
      await writeFile(
        join(configDir, 'settings.json'),
        JSON.stringify({ cleanupPeriodDays: 0 }),
      )
      const metadataPath = await createCompletedBackgroundSession(
        configDir,
        'bg-scheduler-zero',
        new Date(Date.now() - 1_000),
      )

      await runCleanupFixture(configDir)

      expect(await Bun.file(metadataPath).exists()).toBe(false)
    },
    30_000,
  )

  test(
    'includes the finalization millisecond in zero-day cleanup',
    async () => {
      const configDir = join(
        tmpdir(),
        `openclaude-cleanup-bg-exact-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      )
      tempDirs.push(configDir)
      await mkdir(configDir, { recursive: true })
      await writeFile(
        join(configDir, 'settings.json'),
        JSON.stringify({ cleanupPeriodDays: 0 }),
      )

      expect(
        await runCleanupFixture(
          configDir,
          'post-finalization-exact-cutoff',
        ),
      ).toEqual({
        waits: 1,
        metadataPresent: false,
        reservationPresent: false,
        stdoutPresent: false,
        stderrPresent: false,
      })
    },
    30_000,
  )

  test(
    'retains zero-day artifacts when worker ownership exit is unobserved',
    async () => {
      const configDir = join(
        tmpdir(),
        `openclaude-cleanup-bg-timeout-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      )
      tempDirs.push(configDir)
      await mkdir(configDir, { recursive: true })
      await writeFile(
        join(configDir, 'settings.json'),
        JSON.stringify({ cleanupPeriodDays: 0 }),
      )

      expect(
        await runCleanupFixture(configDir, 'post-finalization-timeout'),
      ).toEqual({
        waits: 1,
        metadataPresent: true,
        reservationPresent: false,
        stdoutPresent: true,
        stderrPresent: true,
      })
    },
    30_000,
  )

  test(
    'reclaims zero-day artifacts after an explicit kill transition',
    async () => {
      const configDir = join(
        tmpdir(),
        `openclaude-cleanup-bg-kill-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      )
      tempDirs.push(configDir)
      await mkdir(configDir, { recursive: true })
      await writeFile(
        join(configDir, 'settings.json'),
        JSON.stringify({ cleanupPeriodDays: 0 }),
      )

      expect(await runCleanupFixture(configDir, 'explicit-kill')).toEqual({
        metadataPresent: false,
        stdoutPresent: false,
        stderrPresent: false,
      })
    },
    30_000,
  )

  for (const setting of [30, 'invalid'] as const) {
    test(
      `does not wait for post-finalization cleanup with ${String(setting)} retention`,
      async () => {
        const configDir = join(
          tmpdir(),
          `openclaude-cleanup-bg-gate-${String(setting)}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        )
        tempDirs.push(configDir)
        await mkdir(configDir, { recursive: true })
        await writeFile(
          join(configDir, 'settings.json'),
          JSON.stringify({ cleanupPeriodDays: setting }),
        )

        expect(
          await runCleanupFixture(configDir, 'post-finalization-gate'),
        ).toEqual({ waits: 0 })
      },
      30_000,
    )
  }

  test(
    'reclaims a zero-day session that completes after the initial sweep',
    async () => {
      const configDir = join(
        tmpdir(),
        `openclaude-cleanup-bg-post-completion-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      )
      tempDirs.push(configDir)
      await mkdir(configDir, { recursive: true })
      await writeFile(
        join(configDir, 'settings.json'),
        JSON.stringify({ cleanupPeriodDays: 0 }),
      )

      expect(
        await runCleanupFixture(configDir, 'post-completion'),
      ).toEqual({
        presentAfterInitialSweep: true,
        metadataPresentAfterCompletion: false,
        metadataStatusAfterCompletion: null,
        reservationPresentAfterCompletion: false,
        stdoutPresentAfterCompletion: false,
        stderrPresentAfterCompletion: false,
      })
    },
    30_000,
  )

  test(
    'preserves background artifacts when explicit cleanupPeriodDays is invalid',
    async () => {
      const configDir = join(
        tmpdir(),
        `openclaude-cleanup-bg-invalid-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      )
      tempDirs.push(configDir)
      await mkdir(configDir, { recursive: true })
      await writeFile(
        join(configDir, 'settings.json'),
        JSON.stringify({ cleanupPeriodDays: 'invalid' }),
      )
      const metadataPath = await createCompletedBackgroundSession(
        configDir,
        'bg-scheduler-invalid',
        new Date('2026-06-01T00:00:00.000Z'),
      )

      await runCleanupFixture(configDir)

      expect(await Bun.file(metadataPath).exists()).toBe(true)
    },
    30_000,
  )

  test(
    'keeps post-completion artifacts when recurring retention is disabled by invalid settings',
    async () => {
      const configDir = join(
        tmpdir(),
        `openclaude-cleanup-bg-invalid-post-completion-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      )
      tempDirs.push(configDir)
      await mkdir(configDir, { recursive: true })
      await writeFile(
        join(configDir, 'settings.json'),
        JSON.stringify({ cleanupPeriodDays: 'invalid' }),
      )

      expect(
        await runCleanupFixture(configDir, 'post-completion'),
      ).toEqual({
        presentAfterInitialSweep: true,
        metadataPresentAfterCompletion: true,
        metadataStatusAfterCompletion: 'running',
        reservationPresentAfterCompletion: true,
        stdoutPresentAfterCompletion: true,
        stderrPresentAfterCompletion: true,
      })
    },
    30_000,
  )

  test(
    'retains recent background sessions under a nonzero cleanup period',
    async () => {
      const configDir = join(
        tmpdir(),
        `openclaude-cleanup-bg-recent-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      )
      tempDirs.push(configDir)
      await mkdir(configDir, { recursive: true })
      await writeFile(
        join(configDir, 'settings.json'),
        JSON.stringify({ cleanupPeriodDays: 30 }),
      )
      const oldMetadataPath = await createCompletedBackgroundSession(
        configDir,
        'bg-scheduler-old-pair',
        new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      )
      const recentMetadataPath = await createCompletedBackgroundSession(
        configDir,
        'bg-scheduler-recent',
        new Date(Date.now() - 60_000),
      )

      await runCleanupFixture(configDir)

      expect(await Bun.file(oldMetadataPath).exists()).toBe(false)
      expect(await Bun.file(recentMetadataPath).exists()).toBe(true)
    },
    30_000,
  )
})
