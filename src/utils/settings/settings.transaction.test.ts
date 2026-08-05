import { expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import {
  clearInternalWrites,
  consumeInternalWrite,
  markInternalWrite,
} from './internalWrites.js'

const CONCURRENT_WRITER_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsConcurrentWriter.fixture.ts',
)
const TRANSACTION_SCENARIO_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsTransaction.fixture.ts',
)
const DEAD_RECOVERY_WRITER_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsDeadRecoveryWriter.fixture.ts',
)
const SETTINGS_SYNC_CONTENTION_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsSyncContention.fixture.ts',
)
const SUBPROCESS_TEST_TIMEOUT_MS = 30_000
const MISSING_PROCESS_PID = 2_147_483_647

type ChildResult<T> = {
  exitCode: number
  stderr: string
  stdout: string
  value: T
}

function startWriter(
  configDir: string,
  targetPath: string,
  envKey: string,
  readMarker: string,
  releaseMarker = '-',
) {
  return Bun.spawn(
    [
      process.execPath,
      CONCURRENT_WRITER_FIXTURE,
      configDir,
      targetPath,
      envKey,
      readMarker,
      releaseMarker,
    ],
    {
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    },
  )
}

async function waitFor(
  predicate: () => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`)
    }
    await Bun.sleep(10)
  }
}

async function collectChild<T>(
  processHandle: ReturnType<typeof startWriter>,
): Promise<ChildResult<T>> {
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ])
  const line = stdout.trim().split('\n').at(-1) ?? ''
  let value: T
  try {
    value = JSON.parse(line) as T
  } catch {
    throw new Error(
      `fixture produced no parsable result\nexitCode: ${exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`,
    )
  }
  return {
    exitCode,
    stderr,
    stdout,
    value,
  }
}

async function runScenario<T>(scenario: string): Promise<T> {
  const result = await collectChild<{ ok: boolean; value?: T; error?: string }>(
    Bun.spawn([process.execPath, TRANSACTION_SCENARIO_FIXTURE, scenario], {
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    }),
  )

  expect(
    result,
    `scenario ${scenario} failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  ).toMatchObject({ exitCode: 0, value: { ok: true } })
  return result.value.value as T
}

let allScenariosPromise: Promise<Record<string, unknown>> | undefined

async function getScenario<T>(scenario: string): Promise<T> {
  allScenariosPromise ??= runScenario<Record<string, unknown>>('all')
  return (await allScenariosPromise)[scenario] as T
}

test('concurrent writers through symlink aliases cannot both report success and lose an update', async () => {
  const tempDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'openclaude-settings-transaction-')),
  )
  const physicalDir = join(tempDir, 'physical')
  const aliasA = join(tempDir, 'alias-a')
  const aliasB = join(tempDir, 'alias-b')
  const settingsPath = join(physicalDir, 'settings.json')
  const writerARead = join(tempDir, 'writer-a-read')
  const writerBRead = join(tempDir, 'writer-b-read')
  const releaseWriterA = join(tempDir, 'release-writer-a')

  mkdirSync(physicalDir)
  symlinkSync(
    physicalDir,
    aliasA,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  symlinkSync(
    physicalDir,
    aliasB,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  writeFileSync(
    settingsPath,
    `${JSON.stringify({ env: { BASE: '1' } }, null, 2)}\n`,
    'utf8',
  )

  try {
    const writerA = startWriter(
      aliasA,
      settingsPath,
      'WRITER_A',
      writerARead,
      releaseWriterA,
    )
    await waitFor(() => existsSync(writerARead), 'writer A to read settings')

    const writerB = startWriter(
      aliasB,
      settingsPath,
      'WRITER_B',
      writerBRead,
    )
    let writerBExited = false
    void writerB.exited.then(() => {
      writerBExited = true
    })
    await waitFor(
      () => existsSync(writerBRead) || writerBExited,
      'writer B to read settings or reject the lock',
    )

    writeFileSync(releaseWriterA, 'release', 'utf8')
    const [resultA, resultB] = await Promise.all([
      collectChild<{ ok: boolean; error?: string }>(writerA),
      collectChild<{ ok: boolean; error?: string }>(writerB),
    ])

    expect(
      { resultA, resultB },
      `writer failures\nA stdout: ${resultA.stdout}\nA stderr: ${resultA.stderr}\nB stdout: ${resultB.stdout}\nB stderr: ${resultB.stderr}`,
    ).toMatchObject({
      resultA: { exitCode: 0, value: { ok: true } },
      resultB: { exitCode: 0, value: { ok: false } },
    })
    expect(existsSync(writerBRead)).toBe(false)

    const finalSettings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      env: Record<string, string>
    }
    expect(finalSettings.env).toEqual({ BASE: '1', WRITER_A: 'true' })
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('locked update ignores a warmed parse cache and merges the fresh disk state', async () => {
  const result = await getScenario<{
    warmed: unknown
    error: string | null
    final: unknown
  }>('cache')

  expect(result).toEqual({
    warmed: { CACHED: 'old' },
    error: null,
    final: { env: { EXTERNAL: 'fresh', LOCAL: 'added' } },
  })
})

test('locked update rechecks malformed disk bytes and releases after refusal', async () => {
  const result = await getScenario<{
    warmed: unknown
    refusedError: string | null
    bytesAfterRefusal: string
    malformed: string
    recoveredError: string | null
    final: unknown
  }>('malformed')

  expect(result.warmed).toEqual({ CACHED: 'old' })
  expect(result.refusedError).toContain('Invalid JSON syntax')
  expect(result.bytesAfterRefusal).toBe(result.malformed)
  expect(result.recoveredError).toBeNull()
  expect(result.final).toEqual({
    env: { RECOVERED: 'yes', AFTER_ERROR: 'yes' },
  })
})

test('locked update preserves merge semantics, final symlinks, modes, and cache invalidation', async () => {
  const result = await getScenario<{
    skipped: boolean
    warmed?: unknown
    error?: string | null
    symlink?: boolean
    mode?: number
    final?: unknown
    cached?: unknown
  }>('semantics')
  if (result.skipped) return

  expect(result).toEqual({
    skipped: false,
    warmed: { KEEP: '1' },
    error: null,
    symlink: true,
    mode: 0o640,
    final: {
      env: { KEEP: '1', ADD: '2' },
      permissions: {
        allow: ['Read(new)'],
        deny: ['Read(secret)'],
      },
      enabledPlugins: { keep: true },
    },
    cached: {
      env: { KEEP: '1', ADD: '2' },
      permissions: {
        allow: ['Read(new)'],
        deny: ['Read(secret)'],
      },
      enabledPlugins: { keep: true },
    },
  })
})

test('live physical lock blocks update and settings-sync replacement without touching bytes', async () => {
  const result = await getScenario<{
    updateError: string | null
    replacementError: string | null
    unchanged: boolean
  }>('live')

  expect(result.updateError).toContain('Lock file is already being held')
  expect(result.replacementError).toContain('Lock file is already being held')
  expect(result.unchanged).toBe(true)
})

test('dead owner is recovered but corrupt ownership fails closed', async () => {
  const result = await getScenario<{
    recoveredError: string | null
    deadLockRemoved: boolean
    blockedError: string | null
    corruptUnchanged: boolean
    symlinkBlockedError: string | null
    symlinkOwnerUntouched: boolean
  }>('dead')

  expect(result.recoveredError).toBeNull()
  expect(result.deadLockRemoved).toBe(true)
  expect(result.blockedError).toContain('Lock file is already being held')
  expect(result.corruptUnchanged).toBe(true)
  if (process.platform !== 'win32') {
    expect(result.symlinkBlockedError).toContain(
      'Lock file is already being held',
    )
    expect(result.symlinkOwnerUntouched).toBe(true)
  }
})

test('orphaned recovery claims from dead processes are reclaimed', async () => {
  const result = await getScenario<{
    error: string | null
    lockExists: boolean
    final: unknown
  }>('orphaned-recovery-claim')

  expect(result).toEqual({
    error: null,
    lockExists: false,
    final: { env: { BASE: '1', RECOVERED_CLAIM: 'yes' } },
  })
})

test('PID 1 can own and release a settings lock', async () => {
  const result = await getScenario<{
    error: string | null
    lockExists: boolean
    final: unknown
  }>('pid-one')

  expect(result).toEqual({
    error: null,
    lockExists: false,
    final: { env: { BASE: '1', PID_ONE: 'works' } },
  })
})

test('dangling final symlinks under parent aliases resolve to one physical target', async () => {
  const result = await getScenario<{
    skipped: boolean
    physicalTarget?: string
    resolvedA?: string
    resolvedB?: string
  }>('dangling')
  if (result.skipped) return

  expect(result.resolvedA).toBe(result.physicalTarget)
  expect(result.resolvedB).toBe(result.physicalTarget)
})

test('symlinked and oversized owner metadata fail closed', async () => {
  const result = await getScenario<{
    symlinkError: string | null
    symlinkOwnerUntouched: boolean
    oversizedError: string | null
    missingError: string | null
    missingUnchanged: boolean
    afterCleanupError: string | null
  }>('metadata')

  if (process.platform !== 'win32') {
    expect(result.symlinkError).toContain('Lock file is already being held')
    expect(result.symlinkOwnerUntouched).toBe(true)
  }
  expect(result.oversizedError).toContain('Lock file is already being held')
  expect(result.missingError).toContain('Lock file is already being held')
  expect(result.missingUnchanged).toBe(true)
  expect(result.afterCleanupError).toBeNull()
})

test('long dangling symlink chains preserve physical lock identity', async () => {
  const result = await getScenario<{
    skipped: boolean
    physicalTarget?: string
    resolvedA?: string
    resolvedB?: string
  }>('long-dangling')
  if (result.skipped) return

  expect(result.resolvedA).toBe(result.physicalTarget)
  expect(result.resolvedB).toBe(result.physicalTarget)
})

test('two dead-owner recoverers cannot remove a newly acquired live lock', async () => {
  const tempDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'openclaude-settings-dead-recovery-')),
  )
  const settingsPath = join(tempDir, 'settings.json')
  const lockPath = `${settingsPath}.lock`
  const ownerPath = join(lockPath, 'owner.json')
  const aMarker = join(tempDir, 'a-owner-unlink')
  const aRelease = join(tempDir, 'a-release')
  const bMarker = join(tempDir, 'b-write-stat')
  const bRelease = join(tempDir, 'b-release')

  writeFileSync(
    settingsPath,
    `${JSON.stringify({ env: { BASE: '1' } }, null, 2)}\n`,
    'utf8',
  )
  mkdirSync(lockPath)
  writeFileSync(
    ownerPath,
    JSON.stringify({ pid: MISSING_PROCESS_PID, token: 'dead-owner' }),
    'utf8',
  )

  const startRecoveryWriter = (
    envKey: string,
    mode: string,
    marker: string,
    releaseMarker: string,
  ) =>
    Bun.spawn(
      [
        process.execPath,
        DEAD_RECOVERY_WRITER_FIXTURE,
        tempDir,
        settingsPath,
        envKey,
        mode,
        marker,
        releaseMarker,
      ],
      { cwd: process.cwd(), stderr: 'pipe', stdout: 'pipe' },
    )

  try {
    const writerA = startRecoveryWriter(
      'RECOVERER_A',
      'pause-owner-unlink',
      aMarker,
      aRelease,
    )
    await waitFor(() => existsSync(aMarker), 'recoverer A to claim cleanup')

    const writerB = startRecoveryWriter(
      'RECOVERER_B',
      'pause-write-stat',
      bMarker,
      bRelease,
    )
    let writerBExited = false
    void writerB.exited.then(() => {
      writerBExited = true
    })
    await waitFor(
      () => existsSync(bMarker) || writerBExited,
      'recoverer B to reach the write or reject recovery',
    )

    writeFileSync(aRelease, 'release', 'utf8')
    const resultA = await collectChild<{ ok: boolean; error?: string }>(writerA)
    writeFileSync(bRelease, 'release', 'utf8')
    const resultB = await collectChild<{ ok: boolean; error?: string }>(writerB)

    expect({ resultA, resultB }).toMatchObject({
      resultA: { exitCode: 0, value: { ok: true } },
      resultB: { exitCode: 0, value: { ok: false } },
    })
    expect(existsSync(bMarker)).toBe(false)
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
      env: { BASE: '1', RECOVERER_A: 'true' },
    })
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('settings sync reports contention as an unapplied download', async () => {
  const result = await collectChild<{
    applied: boolean
    unchanged: boolean
  }>(
    Bun.spawn([process.execPath, SETTINGS_SYNC_CONTENTION_FIXTURE], {
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    }),
  )

  expect(result, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toMatchObject(
    {
      exitCode: 0,
      value: { applied: false, unchanged: true },
    },
  )
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('unexpected PID probe errors do not authorize dead-owner recovery', async () => {
  const result = await getScenario<{
    error: string | null
    lockExists: boolean
    unchanged: boolean
  }>('unknown-pid')

  expect(result.error).toContain('Lock file is already being held')
  expect(result.lockExists).toBe(true)
  expect(result.unchanged).toBe(true)
})

test('write failure releases the settings lock for a later update', async () => {
  const result = await getScenario<{
    firstError: string | null
    secondError: string | null
    lockExists: boolean
    final: unknown
  }>('write-failure')

  expect(result.firstError).toContain('simulated settings stat failure')
  expect(result.secondError).toBeNull()
  expect(result.lockExists).toBe(false)
  expect(result.final).toEqual({
    env: { BASE: '1', SECOND: 'landed' },
  })
})

test('internal write suppression normalizes equivalent watcher paths', () => {
  clearInternalWrites()
  const canonicalPath = join('settings-root', 'settings.json')
  const equivalentPath = `settings-root${sep}nested${sep}..${sep}settings.json`

  markInternalWrite(equivalentPath)
  expect(consumeInternalWrite(canonicalPath, 5_000)).toBe(true)
  clearInternalWrites()
})
