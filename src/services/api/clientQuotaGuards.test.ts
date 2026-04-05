import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { tmpdir } from 'os'
import { lock } from '../../utils/lockfile.js'
import {
  __private__,
  type ClientQuotaGuardOptions,
  enforceClientQuotaGuards,
  resetClientQuotaGuardsForTests,
} from './clientQuotaGuards.js'

const CHILD_QUOTA_ATTEMPT_SCRIPT = `
import { enforceClientQuotaGuards } from './src/services/api/clientQuotaGuards.ts'

try {
  await enforceClientQuotaGuards()
  process.stdout.write('ok\\n')
  process.exit(0)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(message + '\\n')
  process.exit(2)
}
`

const originalEnv = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_CLIENT_RPM_LIMIT: process.env.CLAUDE_CODE_CLIENT_RPM_LIMIT,
  CLAUDE_CODE_CLIENT_RPM_WINDOW_MS:
    process.env.CLAUDE_CODE_CLIENT_RPM_WINDOW_MS,
  CLAUDE_CODE_CLIENT_RPD_LIMIT: process.env.CLAUDE_CODE_CLIENT_RPD_LIMIT,
  CLAUDE_CODE_CLIENT_RPD_WARN_THRESHOLD_PCT:
    process.env.CLAUDE_CODE_CLIENT_RPD_WARN_THRESHOLD_PCT,
  CLAUDE_CODE_CLIENT_RPD_STATE_FILE:
    process.env.CLAUDE_CODE_CLIENT_RPD_STATE_FILE,
}

let tempConfigDir: string

function buildChildEnv(overrides: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      base[key] = value
    }
  }

  return {
    ...base,
    ...overrides,
  }
}

async function runQuotaGuardChildAttempt(
  env: Record<string, string>,
): Promise<{ exitCode: number; output: string }> {
  const processHandle = Bun.spawn([process.execPath, '--eval', CHILD_QUOTA_ATTEMPT_SCRIPT], {
    cwd: process.cwd(),
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ])

  return {
    exitCode,
    output: `${stdout}${stderr}`,
  }
}

function enforceQuotaGuards(
  options: ClientQuotaGuardOptions = {},
): Promise<void> {
  return enforceClientQuotaGuards({
    provider: 'openai',
    ...options,
  })
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

beforeEach(async () => {
  tempConfigDir = await mkdtemp(join(tmpdir(), 'openclaude-quota-'))

  process.env.CLAUDE_CONFIG_DIR = tempConfigDir
  process.env.CLAUDE_CODE_USE_OPENAI = '1'

  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_CLIENT_RPM_LIMIT
  delete process.env.CLAUDE_CODE_CLIENT_RPM_WINDOW_MS
  delete process.env.CLAUDE_CODE_CLIENT_RPD_LIMIT
  delete process.env.CLAUDE_CODE_CLIENT_RPD_WARN_THRESHOLD_PCT
  delete process.env.CLAUDE_CODE_CLIENT_RPD_STATE_FILE

  resetClientQuotaGuardsForTests()
})

afterEach(async () => {
  restoreEnv('CLAUDE_CONFIG_DIR', originalEnv.CLAUDE_CONFIG_DIR)
  restoreEnv('CLAUDE_CODE_USE_OPENAI', originalEnv.CLAUDE_CODE_USE_OPENAI)
  restoreEnv('CLAUDE_CODE_USE_GEMINI', originalEnv.CLAUDE_CODE_USE_GEMINI)
  restoreEnv('CLAUDE_CODE_USE_GITHUB', originalEnv.CLAUDE_CODE_USE_GITHUB)
  restoreEnv(
    'CLAUDE_CODE_CLIENT_RPM_LIMIT',
    originalEnv.CLAUDE_CODE_CLIENT_RPM_LIMIT,
  )
  restoreEnv(
    'CLAUDE_CODE_CLIENT_RPM_WINDOW_MS',
    originalEnv.CLAUDE_CODE_CLIENT_RPM_WINDOW_MS,
  )
  restoreEnv(
    'CLAUDE_CODE_CLIENT_RPD_LIMIT',
    originalEnv.CLAUDE_CODE_CLIENT_RPD_LIMIT,
  )
  restoreEnv(
    'CLAUDE_CODE_CLIENT_RPD_WARN_THRESHOLD_PCT',
    originalEnv.CLAUDE_CODE_CLIENT_RPD_WARN_THRESHOLD_PCT,
  )
  restoreEnv(
    'CLAUDE_CODE_CLIENT_RPD_STATE_FILE',
    originalEnv.CLAUDE_CODE_CLIENT_RPD_STATE_FILE,
  )

  resetClientQuotaGuardsForTests()
  await rm(tempConfigDir, { recursive: true, force: true })
})

test('RPD guard blocks requests after reaching daily cap', async () => {
  process.env.CLAUDE_CODE_CLIENT_RPD_LIMIT = '2'

  await enforceQuotaGuards()
  await enforceQuotaGuards()

  await expect(enforceQuotaGuards()).rejects.toThrow(
    'Client quota guard blocked request',
  )
})

test('RPD guard resets counter on UTC day boundary', async () => {
  process.env.CLAUDE_CODE_CLIENT_RPD_LIMIT = '1'

  const start = Date.parse('2026-04-04T23:59:50.000Z')
  let now = start

  await enforceQuotaGuards({ nowMs: () => now })
  await expect(enforceQuotaGuards({ nowMs: () => now })).rejects.toThrow(
    'daily cap reached',
  )

  now = Date.parse('2026-04-05T00:00:05.000Z')
  await expect(
    enforceQuotaGuards({ nowMs: () => now }),
  ).resolves.toBeUndefined()
})

test('RPD guard persists warning marker once threshold is crossed', async () => {
  process.env.CLAUDE_CODE_CLIENT_RPD_LIMIT = '10'
  process.env.CLAUDE_CODE_CLIENT_RPD_WARN_THRESHOLD_PCT = '0.5'

  for (let i = 0; i < 5; i += 1) {
    await enforceQuotaGuards()
  }

  const statePath = __private__.getRpdStatePath()
  const raw = await readFile(statePath, 'utf8')
  const parsed = JSON.parse(raw) as {
    attempts: number
    warnedAtIso: string | null
  }

  expect(parsed.attempts).toBe(5)
  expect(typeof parsed.warnedAtIso).toBe('string')
})

test('RPD state-file override outside config dir is ignored', async () => {
  process.env.CLAUDE_CODE_CLIENT_RPD_STATE_FILE = join(
    tempConfigDir,
    '..',
    'outside-rpd-state.json',
  )

  const resolvedStatePath = resolve(__private__.getRpdStatePath())
  const expectedDefaultPath = resolve(join(tempConfigDir, 'client-quota-rpd.json'))

  expect(resolvedStatePath).toBe(expectedDefaultPath)
})

test('RPD guard enforces daily cap across concurrent processes', async () => {
  process.env.CLAUDE_CODE_CLIENT_RPD_LIMIT = '1'

  const sharedStatePath = join(tempConfigDir, 'shared-rpd-state.json')
  process.env.CLAUDE_CODE_CLIENT_RPD_STATE_FILE = sharedStatePath

  const childEnv = buildChildEnv({
    CLAUDE_CONFIG_DIR: tempConfigDir,
    CLAUDE_CODE_USE_OPENAI: '1',
    CLAUDE_CODE_CLIENT_RPD_LIMIT: '1',
    CLAUDE_CODE_CLIENT_RPD_STATE_FILE: sharedStatePath,
  })

  const [first, second] = await Promise.all([
    runQuotaGuardChildAttempt(childEnv),
    runQuotaGuardChildAttempt(childEnv),
  ])

  const results = [first, second]
  const successCount = results.filter(result => result.exitCode === 0).length
  const blockedCount = results.filter(
    result =>
      result.exitCode === 2 &&
      result.output.includes('daily cap reached'),
  ).length

  expect(successCount).toBe(1)
  expect(blockedCount).toBe(1)
})

test('RPD guard fails closed when state path is unusable', async () => {
  process.env.CLAUDE_CODE_CLIENT_RPD_LIMIT = '1'

  const stateDirectory = join(tempConfigDir, 'rpd-state-directory')
  await mkdir(stateDirectory, { recursive: true })
  process.env.CLAUDE_CODE_CLIENT_RPD_STATE_FILE = stateDirectory

  await expect(enforceQuotaGuards()).rejects.toThrow(
    'failed to persist daily state',
  )
})

test('RPD guard fails closed on corrupted state file content', async () => {
  process.env.CLAUDE_CODE_CLIENT_RPD_LIMIT = '1'

  const statePath = __private__.getRpdStatePath()
  await mkdir(dirname(statePath), { recursive: true })
  await writeFile(statePath, '{not-valid-json', 'utf8')

  await expect(enforceQuotaGuards()).rejects.toThrow(
    'failed to persist daily state',
  )
})

test('RPD guard aborts while waiting on cross-process lock', async () => {
  process.env.CLAUDE_CODE_CLIENT_RPD_LIMIT = '1'

  const statePath = __private__.getRpdStatePath()
  await mkdir(dirname(statePath), { recursive: true })
  await writeFile(statePath, '', { encoding: 'utf8', flag: 'a' })

  const releaseLock = await lock(statePath, {
    stale: 10_000,
    retries: 0,
  })

  const abortController = new AbortController()
  const abortMessage = 'aborted while waiting for lock'
  const expectedAbortError = new Error(abortMessage)
  const abortError = () => expectedAbortError
  const enforcePromise = enforceQuotaGuards({
    signal: abortController.signal,
    abortError,
  })

  setTimeout(() => abortController.abort(), 20)

  try {
    await enforcePromise
    expect.unreachable('Expected abort while waiting on lock')
  } catch (error) {
    expect(error).toBe(expectedAbortError)
    expect((error as Error).message).toBe(abortMessage)
    expect((error as Error).message).not.toContain('failed to persist daily state')
  } finally {
    await releaseLock()
  }
})

test('RPD guard surfaces lock contention with dedicated error message', async () => {
  process.env.CLAUDE_CODE_CLIENT_RPD_LIMIT = '1'

  const statePath = __private__.getRpdStatePath()
  await mkdir(dirname(statePath), { recursive: true })
  await writeFile(statePath, '', { encoding: 'utf8', flag: 'a' })

  const releaseLock = await lock(statePath, {
    stale: 10_000,
    retries: 0,
  })

  const contentionMessage = 'failed to acquire daily quota lock'
  const persistenceMessage = 'failed to persist daily state'
  const startedAt = Date.now()

  try {
    try {
      await enforceQuotaGuards()
      expect.unreachable('Expected lock contention error')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain(contentionMessage)
      expect(message).not.toContain(persistenceMessage)
    }
  } finally {
    await releaseLock()
  }

  // Prevent accidental indefinite waits if lock retry behavior regresses.
  expect(Date.now() - startedAt).toBeLessThan(5_000)
})

test('RPM guard waits until request leaves sliding window', async () => {
  process.env.CLAUDE_CODE_CLIENT_RPM_LIMIT = '2'
  process.env.CLAUDE_CODE_CLIENT_RPM_WINDOW_MS = '1000'

  let now = 0
  const waits: number[] = []

  const sleepFn = async (ms: number) => {
    waits.push(ms)
    now += ms
  }

  await enforceQuotaGuards({ nowMs: () => now, sleepFn })
  now = 100
  await enforceQuotaGuards({ nowMs: () => now, sleepFn })
  now = 200
  await enforceQuotaGuards({ nowMs: () => now, sleepFn })

  expect(waits).toEqual([800])
})

test('RPM guard serializes concurrent attempts in-process', async () => {
  process.env.CLAUDE_CODE_CLIENT_RPM_LIMIT = '1'
  process.env.CLAUDE_CODE_CLIENT_RPM_WINDOW_MS = '1000'

  let now = 0
  const waits: number[] = []

  const sleepFn = async (ms: number) => {
    waits.push(ms)
    now += ms
  }

  await Promise.all([
    enforceQuotaGuards({ nowMs: () => now, sleepFn }),
    enforceQuotaGuards({ nowMs: () => now, sleepFn }),
  ])

  expect(waits).toEqual([1000])
})

test('RPD cap blocks before waiting on RPM window', async () => {
  process.env.CLAUDE_CODE_CLIENT_RPD_LIMIT = '1'
  process.env.CLAUDE_CODE_CLIENT_RPM_LIMIT = '1'
  process.env.CLAUDE_CODE_CLIENT_RPM_WINDOW_MS = '1000'

  let now = 0
  const waits: number[] = []
  const sleepFn = async (ms: number) => {
    waits.push(ms)
    now += ms
  }

  await enforceQuotaGuards({ nowMs: () => now, sleepFn })

  now = 100
  await expect(
    enforceQuotaGuards({ nowMs: () => now, sleepFn }),
  ).rejects.toThrow('daily cap reached')

  expect(waits).toEqual([])
})
