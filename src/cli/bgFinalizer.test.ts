import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  BACKGROUND_SESSION_ID_ENV,
  BACKGROUND_SESSION_LAUNCHER_PID_ENV,
  prepareBackgroundSessionFinalizer,
} from './bgFinalizer.js'
import { buildBackgroundChildProcessConfig } from './bg.js'
import {
  BACKGROUND_PROCESS_MARKER_FLAG,
  backgroundProcessMarkerToken,
  isValidBackgroundProcessMarker,
} from './bgRouting.js'
import {
  _setBackgroundSessionsRootForTesting,
  listBackgroundSessions,
  refreshBackgroundSessionStatuses,
  verifyBackgroundSessionProcessIdentity,
  type BackgroundSession,
} from './bgRegistry.js'

const fixturePath = join(import.meta.dir, 'bgFinalizer.fixture.ts')
const installedLauncherPath = join(import.meta.dir, '../../bin/openclaude')

describe('background session finalizer', () => {
  let configDir: string
  let sessionsRoot: string

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'openclaude-bg-finalizer-'))
    sessionsRoot = join(configDir, 'bg-sessions')
    _setBackgroundSessionsRootForTesting(sessionsRoot)
  })

  afterEach(async () => {
    _setBackgroundSessionsRootForTesting(undefined)
    await rm(configDir, { recursive: true, force: true })
  })

  function ownedSession(id: string, pid: number): BackgroundSession {
    return {
      id,
      pid,
      cwd: '/repo',
      status: 'running',
      sessionId: `conversation-${id}`,
      startedAt: '2026-08-15T08:00:00.000Z',
      updatedAt: '2026-08-15T08:00:00.000Z',
      command: ['openclaude', '--print', 'work'],
      stdoutLogPath: '/tmp/stdout.log',
      stderrLogPath: '/tmp/stderr.log',
    }
  }

  it('ignores missing and invalid private routing metadata', async () => {
    expect(
      await prepareBackgroundSessionFinalizer({ env: {} }),
    ).toBe('not-background')

    const partialEnv = {
      [BACKGROUND_SESSION_LAUNCHER_PID_ENV]: '123',
    }
    expect(
      await prepareBackgroundSessionFinalizer({ env: partialEnv }),
    ).toBe('invalid-routing')
    expect(partialEnv[BACKGROUND_SESSION_LAUNCHER_PID_ENV]).toBeUndefined()

    const env = {
      [BACKGROUND_SESSION_ID_ENV]: '../unsafe',
      [BACKGROUND_SESSION_LAUNCHER_PID_ENV]: '123',
    }
    expect(await prepareBackgroundSessionFinalizer({ env })).toBe(
      'invalid-routing',
    )
    expect(env[BACKGROUND_SESSION_ID_ENV]).toBeUndefined()
    expect(env[BACKGROUND_SESSION_LAUNCHER_PID_ENV]).toBeUndefined()
  })

  it('falls through when routing metadata does not own this PID', async () => {
    const env = {
      [BACKGROUND_SESSION_ID_ENV]: 'bg-mismatch',
      [BACKGROUND_SESSION_LAUNCHER_PID_ENV]: '123',
    }
    const preparation = await prepareBackgroundSessionFinalizer({
      env,
      pid: 500,
      readSession: async () => ownedSession('bg-mismatch', 501),
      isLauncherAlive: () => true,
    })

    expect(preparation).toBe('invalid-routing')
    expect(env[BACKGROUND_SESSION_ID_ENV]).toBeUndefined()
  })

  it('accepts a PID 1 launcher while waiting for exact ownership', async () => {
    const env = {
      [BACKGROUND_SESSION_ID_ENV]: 'bg-pid-one-launcher',
      [BACKGROUND_SESSION_LAUNCHER_PID_ENV]: '1',
    }
    let reads = 0

    const preparation = await prepareBackgroundSessionFinalizer({
      env,
      pid: 500,
      readSession: async () =>
        ++reads === 1 ? null : ownedSession('bg-pid-one-launcher', 500),
      sleep: async () => {},
      registrationWaitMs: 2,
      registrationPollMs: 1,
      registerCleanup: () => () => {},
      onBeforeExit: () => {},
      onExit: () => {},
    })

    expect(preparation).toBe('installed')
    expect(reads).toBe(2)
  })

  it('rechecks exact ownership before timing out after launcher exit', async () => {
    const env = {
      [BACKGROUND_SESSION_ID_ENV]: 'bg-launcher-exit-race',
      [BACKGROUND_SESSION_LAUNCHER_PID_ENV]: '123',
    }
    let reads = 0

    const preparation = await prepareBackgroundSessionFinalizer({
      env,
      pid: 500,
      readSession: async () =>
        ++reads === 1 ? null : ownedSession('bg-launcher-exit-race', 500),
      isLauncherAlive: () => false,
      sleep: async () => {},
      registrationWaitMs: 2,
      registrationPollMs: 1,
      registerCleanup: () => () => {},
      onBeforeExit: () => {},
      onExit: () => {},
    })

    expect(preparation).toBe('installed')
    expect(reads).toBe(2)
  })

  it('fails after the bounded registration wait without exact ownership', async () => {
    const env = {
      [BACKGROUND_SESSION_ID_ENV]: 'bg-registration-timeout',
      [BACKGROUND_SESSION_LAUNCHER_PID_ENV]: '123',
    }
    let reads = 0

    await expect(
      prepareBackgroundSessionFinalizer({
        env,
        pid: 500,
        readSession: async () => {
          reads += 1
          return null
        },
        isLauncherAlive: () => true,
        sleep: async () => {},
        registrationWaitMs: 2,
        registrationPollMs: 1,
      }),
    ).rejects.toThrow('Background session registration was not established')
    expect(reads).toBe(3)
    expect(env[BACKGROUND_SESSION_ID_ENV]).toBeUndefined()
    expect(env[BACKGROUND_SESSION_LAUNCHER_PID_ENV]).toBeUndefined()
  })

  it('waits for exact ownership before installing awaited and sync finalizers', async () => {
    const env = {
      [BACKGROUND_SESSION_ID_ENV]: 'bg-owned',
      [BACKGROUND_SESSION_LAUNCHER_PID_ENV]: '123',
    }
    let reads = 0
    let cleanup: (() => void | Promise<void>) | undefined
    let beforeExitListener: (() => void | Promise<void>) | undefined
    let exitListener: ((code: number) => void) | undefined
    const finalized: number[] = []
    const finalizedSync: number[] = []

    const preparation = await prepareBackgroundSessionFinalizer({
      env,
      pid: 500,
      readSession: async () =>
        ++reads < 3 ? null : ownedSession('bg-owned', 500),
      isLauncherAlive: () => true,
      sleep: async () => {},
      registrationWaitMs: 10,
      registrationPollMs: 1,
      registerCleanup: fn => {
        cleanup = fn
        return () => {}
      },
      onBeforeExit: listener => {
        beforeExitListener = listener
      },
      onExit: listener => {
        exitListener = listener
      },
      finalize: async (_id, termination) => {
        finalized.push(termination.exitCode ?? -1)
        return ownedSession('bg-owned', 500)
      },
      finalizeSync: (_id, termination) => {
        finalizedSync.push(termination.exitCode ?? -1)
      },
    })

    expect(preparation).toBe('installed')
    expect(reads).toBe(3)
    expect(env[BACKGROUND_SESSION_ID_ENV]).toBeUndefined()
    const previousExitCode = process.exitCode
    process.exitCode = '7' as unknown as number
    try {
      await beforeExitListener?.()
      await cleanup?.()
      exitListener?.(7)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
    expect(finalized).toEqual([7])
    expect(finalizedSync).toEqual([])
  })

  it('keeps the original exit code when both persistence paths fail', async () => {
    let cleanup: (() => void | Promise<void>) | undefined
    let exitListener: ((code: number) => void) | undefined
    const diagnostics: string[] = []
    const previousExitCode = process.exitCode
    process.exitCode = 29
    try {
      await prepareBackgroundSessionFinalizer({
        env: {
          [BACKGROUND_SESSION_ID_ENV]: 'bg-write-failure',
          [BACKGROUND_SESSION_LAUNCHER_PID_ENV]: '123',
        },
        pid: 500,
        readSession: async () => ownedSession('bg-write-failure', 500),
        isLauncherAlive: () => true,
        registerCleanup: fn => {
          cleanup = fn
          return () => {}
        },
        onBeforeExit: () => {},
        onExit: listener => {
          exitListener = listener
        },
        finalize: async () => {
          throw Object.assign(new Error('private path /secret'), { code: 'EIO' })
        },
        finalizeSync: () => {
          throw new Error('private sync details')
        },
        debug: message => {
          diagnostics.push(message)
          throw new Error('diagnostic sink failed')
        },
      })

      await cleanup?.()
      exitListener?.(29)
      expect(process.exitCode).toBe(29)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]).toContain('(EIO)')
    expect(diagnostics.join('\n')).not.toContain('/secret')
    expect(diagnostics.join('\n')).not.toContain('private sync details')
  })

  it('records an observed shutdown signal instead of a successful exit code', async () => {
    let cleanup: (() => void | Promise<void>) | undefined
    let termination: { exitCode?: number; signal?: string } | undefined
    const previousExitCode = process.exitCode
    process.exitCode = 0
    try {
      await prepareBackgroundSessionFinalizer({
        env: {
          [BACKGROUND_SESSION_ID_ENV]: 'bg-observed-sigint',
          [BACKGROUND_SESSION_LAUNCHER_PID_ENV]: '123',
        },
        pid: 500,
        readSession: async () => ownedSession('bg-observed-sigint', 500),
        isLauncherAlive: () => true,
        registerCleanup: fn => {
          cleanup = fn
          return () => {}
        },
        onBeforeExit: () => {},
        onExit: () => {},
        getObservedSignal: () => 'SIGINT',
        finalize: async (_id, observed) => {
          termination = observed
          return ownedSession('bg-observed-sigint', 500)
        },
      })

      await cleanup?.()
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
    expect(termination).toEqual({ signal: 'SIGINT' })
  })

  async function runFixture(
    mode: 'success' | 'fail' | 'throw' | 'wait' | 'sigint' | 'sigterm',
  ): Promise<{
    id: string
    child: ReturnType<typeof spawn>
    readyPath: string
  }> {
    const id = `bg-fixture-${mode}`
    const readyPath = join(configDir, `${id}.ready`)
    const child = spawn(process.execPath, [fixturePath, mode], {
      env: {
        ...process.env,
        OPENCLAUDE_CONFIG_DIR: configDir,
        [BACKGROUND_SESSION_ID_ENV]: id,
        [BACKGROUND_SESSION_LAUNCHER_PID_ENV]: String(process.pid),
        OPENCLAUDE_BG_FINALIZER_FIXTURE_READY: readyPath,
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    if (!child.pid) throw new Error('fixture did not start')

    await mkdir(join(sessionsRoot, 'sessions'), { recursive: true })
    await writeFile(
      join(sessionsRoot, 'sessions', `${id}.json`),
      JSON.stringify(ownedSession(id, child.pid)),
    )
    return { id, child, readyPath }
  }

  async function waitForFile(path: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await Bun.file(path).exists()) return
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('fixture readiness file was not created')
  }

  async function runBuiltCliSession(
    id: string,
    args: string[],
  ): Promise<number> {
    const processMarker = 'c'.repeat(64)
    const processEnv: NodeJS.ProcessEnv = {
      ...process.env,
      OPENCLAUDE_CONFIG_DIR: configDir,
    }
    delete processEnv.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN
    const childConfig = buildBackgroundChildProcessConfig({
      execPath: 'node',
      execArgv: [],
      entrypoint: installedLauncherPath,
      childArgs: args,
      processEnv,
      stdoutLogPath: join(configDir, `${id}.out.log`),
      backgroundSessionId: id,
      processMarker,
      launcherPid: process.pid,
    })
    const child = spawn(childConfig.command, childConfig.args, {
      env: childConfig.env,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    if (!child.pid) throw new Error('built CLI fixture did not start')

    await mkdir(join(sessionsRoot, 'sessions'), { recursive: true })
    await writeFile(
      join(sessionsRoot, 'sessions', `${id}.json`),
      JSON.stringify({
        ...ownedSession(id, child.pid),
        processMarker,
        command: [childConfig.command, ...childConfig.args],
      }),
    )
    const [code] = (await once(child, 'exit')) as [number]
    return code
  }

  async function waitForTerminalSession(): Promise<BackgroundSession> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [session] = await listBackgroundSessions()
      if (
        session &&
        (session.status === 'exited' || session.status === 'failed')
      ) {
        return session
      }
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('detached fixture did not persist a terminal outcome')
  }

  async function runDetachedLaunch(
    mode: 'success' | 'fail',
  ): Promise<{ stdout: string; session: BackgroundSession }> {
    const launcher = spawn(process.execPath, [fixturePath, 'launcher', mode], {
      env: {
        ...process.env,
        OPENCLAUDE_CONFIG_DIR: configDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    launcher.stdout?.setEncoding('utf8')
    launcher.stderr?.setEncoding('utf8')
    launcher.stdout?.on('data', chunk => {
      stdout += chunk
    })
    launcher.stderr?.on('data', chunk => {
      stderr += chunk
    })
    const [code] = (await once(launcher, 'exit')) as [number]
    expect(code).toBe(0)
    expect(stderr).toBe('')
    return { stdout, session: await waitForTerminalSession() }
  }

  for (const expectation of [
    { mode: 'success' as const, status: 'exited', exitCode: 0 },
    { mode: 'fail' as const, status: 'failed', exitCode: 23 },
    { mode: 'throw' as const, status: 'failed', exitCode: 1 },
  ]) {
    it(`records a real ${expectation.mode} child outcome`, async () => {
      const { id, child } = await runFixture(expectation.mode)
      const [code] = (await once(child, 'exit')) as [number]
      expect(code).toBe(expectation.exitCode)

      expect((await listBackgroundSessions())[0]).toMatchObject({
        id,
        status: expectation.status,
        exitCode: expectation.exitCode,
        terminalReason: 'exit_code',
      })
    })
  }

  for (const expectation of [
    {
      mode: 'sigint' as const,
      signal: 'SIGINT' as NodeJS.Signals,
      childExitCode: 0,
    },
    {
      mode: 'sigterm' as const,
      signal: 'SIGTERM' as NodeJS.Signals,
      childExitCode: 143,
    },
  ]) {
    it.skipIf(process.platform === 'win32')(
      `records an observed ${expectation.signal} as a failed signal fact`,
      async () => {
        const { id, child, readyPath } = await runFixture(expectation.mode)
        await waitForFile(readyPath)
        child.kill(expectation.signal)
        const [code, signal] = (await once(child, 'exit')) as [
          number,
          NodeJS.Signals | null,
        ]
        expect(code).toBe(expectation.childExitCode)
        expect(signal).toBeNull()
        expect((await listBackgroundSessions())[0]).toMatchObject({
          id,
          status: 'failed',
          signal: expectation.signal,
          terminalReason: 'signal',
        })
        expect('exitCode' in (await listBackgroundSessions())[0]!).toBe(false)
      },
    )
  }

  for (const expectation of [
    { mode: 'success' as const, status: 'exited', exitCode: 0 },
    { mode: 'fail' as const, status: 'failed', exitCode: 23 },
  ]) {
    it(`finalizes a detached ${expectation.mode} launch through handleBgFlag`, async () => {
      const { stdout, session } = await runDetachedLaunch(expectation.mode)

      expect(stdout).toMatch(
        new RegExp(
          `(?:Started background session ${session.id}\\.|Background session ${session.id} finished with status ${expectation.status}\\.)`,
        ),
      )
      expect(session).toMatchObject({
        status: expectation.status,
        exitCode: expectation.exitCode,
        terminalReason: 'exit_code',
      })
      expect(isValidBackgroundProcessMarker(session.processMarker)).toBe(true)
      expect(session.command).toContain(
        backgroundProcessMarkerToken(session.processMarker!),
      )
      expect(stdout).not.toContain(BACKGROUND_PROCESS_MARKER_FLAG)
      expect(await Bun.file(session.stdoutLogPath).exists()).toBe(true)
      expect(await Bun.file(session.stderrLogPath).exists()).toBe(true)
    })
  }

  it.skipIf(process.platform === 'win32')(
    'recognizes a live built marked child through the production command probe',
    async () => {
      const id = 'bg-built-live-marker'
      const processMarker = 'e'.repeat(64)
      const processEnv: NodeJS.ProcessEnv = {
        ...process.env,
        OPENCLAUDE_CONFIG_DIR: configDir,
      }
      delete processEnv.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN
      const childConfig = buildBackgroundChildProcessConfig({
        execPath: 'node',
        execArgv: [],
        entrypoint: installedLauncherPath,
        childArgs: ['--version'],
        processEnv,
        stdoutLogPath: join(configDir, `${id}.out.log`),
        backgroundSessionId: id,
        processMarker,
        launcherPid: process.pid,
      })
      const child = spawn(childConfig.command, childConfig.args, {
        env: childConfig.env,
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      if (!child.pid) throw new Error('built CLI fixture did not start')
      const exit = once(child, 'exit')
      let forceTimer: ReturnType<typeof setTimeout> | undefined

      try {
        expect(child.kill('SIGSTOP')).toBe(true)
        const session: BackgroundSession = {
          ...ownedSession(id, child.pid),
          processMarker,
          command: [childConfig.command, ...childConfig.args],
        }
        await mkdir(join(sessionsRoot, 'sessions'), { recursive: true })
        await writeFile(
          join(sessionsRoot, 'sessions', `${id}.json`),
          JSON.stringify(session),
        )

        expect(verifyBackgroundSessionProcessIdentity(session).state).toBe(
          'matches',
        )
        expect(await refreshBackgroundSessionStatuses()).toMatchObject([
          { id, status: 'running', processMarker },
        ])
      } finally {
        child.kill('SIGCONT')
        forceTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
        await exit
        clearTimeout(forceTimer)
      }
    },
  )

  it('keeps the installed launcher PID stable and shows outcomes truthfully in ps', async () => {
    expect(await runBuiltCliSession('bg-built-success', ['--version'])).toBe(0)
    expect(
      await runBuiltCliSession('bg-built-failure', [
        '--provider-env-file',
        join(configDir, 'missing.env'),
        '--print',
        'noop',
      ]),
    ).toBe(1)

    const ps = spawn('node', [installedLauncherPath, 'ps'], {
      env: { ...process.env, OPENCLAUDE_CONFIG_DIR: configDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    ps.stdout?.setEncoding('utf8')
    ps.stderr?.setEncoding('utf8')
    ps.stdout?.on('data', chunk => {
      stdout += chunk
    })
    ps.stderr?.on('data', chunk => {
      stderr += chunk
    })
    const [psCode] = (await once(ps, 'exit')) as [number]

    expect(psCode).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).toMatch(/bg-built-success\s+exited/)
    expect(stdout).toMatch(/bg-built-failure\s+failed/)
    for (const session of await listBackgroundSessions()) {
      expect(session.processMarker).toBe('c'.repeat(64))
      expect(session.command).toContain(
        backgroundProcessMarkerToken(session.processMarker!),
      )
    }
  })

  it.skipIf(process.platform === 'win32')(
    'does not invent success when a fixture is forcibly destroyed',
    async () => {
      const { child, readyPath } = await runFixture('wait')
      await waitForFile(readyPath)
      child.kill('SIGKILL')
      await once(child, 'exit')

      const refreshed = await refreshBackgroundSessionStatuses({
        isProcessAlive: () => false,
      })
      expect(refreshed[0]?.status).toBe('stale')
      expect('exitCode' in refreshed[0]!).toBe(false)
      expect('terminalReason' in refreshed[0]!).toBe(false)
    },
  )
})
