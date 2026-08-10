import { expect, setDefaultTimeout, test } from 'bun:test'
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
import { basename, join, resolve, sep } from 'node:path'
import { createCurrentSettingsLockOwner } from '../../test/fixtures/settingsLockOwner.js'
import {
  getFsImplementation,
  setFsImplementation,
  setOriginalFsImplementation,
} from '../fsOperations.js'
import {
  clearInternalWrites,
  consumeInternalWrite,
  markInternalWrite,
} from './internalWrites.js'
import {
  getSettingsFileLockPath,
  resolveSettingsFileTarget,
  withSettingsFileLockSync,
} from './settingsFileLock.js'

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
const SETTINGS_SYNC_PARTIAL_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsSyncPartial.fixture.ts',
)
const SETTINGS_SYNC_RELEASE_FAILURE_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsSyncReleaseFailure.fixture.ts',
)
const SETTINGS_SYNC_UNAPPLIED_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsSyncUnapplied.fixture.ts',
)
const SETTINGS_LOCK_SYMLINK_SWAP_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsLockSymlinkSwap.fixture.ts',
)
const SETTINGS_RELOAD_NOTIFICATION_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsReloadNotification.fixture.ts',
)
const SETTINGS_LOCK_RELEASE_FAILURE_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsLockReleaseFailure.fixture.ts',
)
const SETTINGS_SYMLINK_NOTIFICATION_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsSymlinkNotification.fixture.ts',
)
const SUBPROCESS_TEST_TIMEOUT_MS = 30_000
const MISSING_PROCESS_PID = 2_147_483_647

setDefaultTimeout(SUBPROCESS_TEST_TIMEOUT_MS)

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

function startRecoveryWriter(
  configDir: string,
  targetPath: string,
  envKey: string,
  mode: string,
  marker: string,
  releaseMarker: string,
) {
  return Bun.spawn(
    [
      process.execPath,
      DEAD_RECOVERY_WRITER_FIXTURE,
      configDir,
      targetPath,
      envKey,
      mode,
      marker,
      releaseMarker,
    ],
    { cwd: process.cwd(), stderr: 'pipe', stdout: 'pipe' },
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

test('validation fallback does not mutate safeParseJSON cached objects', async () => {
  const result = await getScenario<{
    error: string | null
    cachedBefore: unknown
    cachedAfter: unknown
    final: unknown
  }>('validation-fallback-cache')

  expect(result.error).toBeNull()
  expect(result.cachedAfter).toEqual(result.cachedBefore)
  expect(result.final).toEqual({
    spinnerTipsEnabled: 'invalid',
    env: { BASE: '1', LOCAL: 'added' },
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
    liveRecoveryError: string | null
    liveRecoveryUnchanged: boolean
    afterCleanupError: string | null
  }>('metadata')

  if (process.platform !== 'win32') {
    expect(result.symlinkError).toContain('Lock file is already being held')
    expect(result.symlinkOwnerUntouched).toBe(true)
  }
  expect(result.oversizedError).toContain('Lock file is already being held')
  expect(result.missingError).toContain('Lock file is already being held')
  expect(result.missingUnchanged).toBe(true)
  expect(result.liveRecoveryError).toContain('Lock file is already being held')
  expect(result.liveRecoveryUnchanged).toBe(true)
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

test('fixed-length lock names support long valid target basenames', () => {
  const tempDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'openclaude-settings-long-target-')),
  )
  const settingsPath = join(tempDir, 's'.repeat(252))
  writeFileSync(settingsPath, '{}\n', 'utf8')

  try {
    const lockPath = getSettingsFileLockPath(settingsPath)
    expect(Buffer.byteLength(basename(lockPath))).toBeLessThanOrEqual(255)
    expect(withSettingsFileLockSync(settingsPath, () => 'locked')).toBe(
      'locked',
    )
    expect(existsSync(lockPath)).toBe(false)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('settings target resolution avoids realpath for UNC and special files', () => {
  const originalFs = getFsImplementation()
  const specialPath = resolve('/tmp/openclaude-special-settings')
  const ordinaryStats = originalFs.lstatSync(import.meta.path)
  const specialStats = new Proxy(ordinaryStats, {
    get(target, property, receiver) {
      if (property === 'isCharacterDevice') return () => true
      if (
        property === 'isFIFO' ||
        property === 'isSocket' ||
        property === 'isBlockDevice'
      ) {
        return () => false
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  let realpathCalls = 0
  let lstatCalls = 0

  setFsImplementation({
    ...originalFs,
    lstatSync(path) {
      lstatCalls++
      return resolve(path) === specialPath
        ? specialStats
        : originalFs.lstatSync(path)
    },
    realpathSync(path) {
      realpathCalls++
      return originalFs.realpathSync(path)
    },
  })

  try {
    expect(resolveSettingsFileTarget(specialPath)).toBe(specialPath)
    const specialLstatCalls = lstatCalls
    expect(resolveSettingsFileTarget('\\\\server\\share\\settings.json')).toBe(
      '\\\\server\\share\\settings.json',
    )
    expect(lstatCalls).toBe(specialLstatCalls)
    expect(realpathCalls).toBe(0)
  } finally {
    setOriginalFsImplementation()
  }
})

test('recovery quarantine cannot remove a newly acquired live lock', async () => {
  const tempDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'openclaude-settings-dead-recovery-')),
  )
  const settingsPath = join(tempDir, 'settings.json')
  const lockPath = getSettingsFileLockPath(settingsPath)
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
    JSON.stringify(
      createCurrentSettingsLockOwner(MISSING_PROCESS_PID, 'dead-owner'),
    ),
    'utf8',
  )

  try {
    const writerA = startRecoveryWriter(
      tempDir,
      settingsPath,
      'RECOVERER_A',
      'pause-owner-unlink',
      aMarker,
      aRelease,
    )
    await waitFor(() => existsSync(aMarker), 'recoverer A to claim cleanup')

    const writerB = startRecoveryWriter(
      tempDir,
      settingsPath,
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
      resultA: { exitCode: 0, value: { ok: false } },
      resultB: { exitCode: 0, value: { ok: true } },
    })
    expect(existsSync(bMarker)).toBe(true)
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
      env: { BASE: '1', RECOVERER_B: 'true' },
    })
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('recovery resumes from a dead claim with owner metadata absent', async () => {
  const tempDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'openclaude-settings-ownerless-recovery-')),
  )
  const settingsPath = join(tempDir, 'settings.json')
  const lockPath = getSettingsFileLockPath(settingsPath)
  const ownerPath = join(lockPath, 'owner.json')
  const recoveryPath = join(lockPath, 'recovery.json')

  writeFileSync(
    settingsPath,
    `${JSON.stringify({ env: { BASE: '1' } }, null, 2)}\n`,
    'utf8',
  )
  mkdirSync(lockPath)
  writeFileSync(
    recoveryPath,
    JSON.stringify(
      createCurrentSettingsLockOwner(MISSING_PROCESS_PID, 'dead-recoverer'),
    ),
    'utf8',
  )

  try {
    expect(existsSync(ownerPath)).toBe(false)
    expect(existsSync(recoveryPath)).toBe(true)

    const result = await collectChild<{ ok: boolean; error?: string }>(
      startRecoveryWriter(
        tempDir,
        settingsPath,
        'RECOVERED_AFTER_CRASH',
        'complete',
        join(tempDir, 'unused-marker'),
        join(tempDir, 'unused-release'),
      ),
    )

    expect(result).toMatchObject({
      exitCode: 0,
      value: { ok: true },
    })
    expect(existsSync(lockPath)).toBe(false)
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
      env: { BASE: '1', RECOVERED_AFTER_CRASH: 'true' },
    })
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('recovery metadata tokens cannot control quarantine paths', async () => {
  const result = await getScenario<{
    error: string | null
    lockExists: boolean
    final: unknown
  }>('separator-recovery-token')

  expect(result).toEqual({
    error: null,
    lockExists: false,
    final: { env: { BASE: '1', RECOVERED_UNTRUSTED_TOKEN: 'yes' } },
  })
})

test('abandoned ownerless locks are recovered after a conservative grace period', async () => {
  const result = await getScenario<{
    error: string | null
    lockExists: boolean
    final: unknown
  }>('abandoned-ownerless-lock')

  expect(result).toEqual({
    error: null,
    lockExists: false,
    final: { env: { BASE: '1', RECOVERED_OWNERLESS_LOCK: 'yes' } },
  })
})

test('foreign runtime PIDs cannot authorize local dead-lock recovery', async () => {
  const result = await getScenario<{
    error: string | null
    lockExists: boolean
    unchanged: boolean
  }>('foreign-runtime-owner')

  expect(result).toMatchObject({
    error: expect.stringContaining('already being held'),
    lockExists: true,
    unchanged: true,
  })
})

test('same-host locks from a prior boot are recoverable without probing a reused PID', async () => {
  const result = await getScenario<{
    skipped: boolean
    error: string | null
    lockExists: boolean
    final: unknown
  }>('prior-boot-owner')
  if (result.skipped) return

  expect(result).toEqual({
    skipped: false,
    error: null,
    lockExists: false,
    final: { env: { BASE: '1', RECOVERED_AFTER_REBOOT: 'yes' } },
  })
})

test('same-runtime locks from a reused PID are recoverable by process start identity', async () => {
  const result = await getScenario<{
    skipped: boolean
    error?: string | null
    lockExists?: boolean
    final?: unknown
  }>('reused-pid-owner')
  if (result.skipped) return

  expect(result).toEqual({
    skipped: false,
    error: null,
    lockExists: false,
    final: {
      env: { BASE: '1', RECOVERED_AFTER_PID_REUSE: 'yes' },
    },
  })
})

test('legacy owner metadata fails closed without a runtime boundary', async () => {
  const result = await getScenario<{
    error: string | null
    lockExists: boolean
    unchanged: boolean
  }>('legacy-owner')

  expect(result).toMatchObject({
    error: expect.stringContaining('already being held'),
    lockExists: true,
    unchanged: true,
  })
})

test('a crashed writer is recoverable from another process in the same runtime', async () => {
  const tempDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'openclaude-settings-runtime-recovery-')),
  )
  const settingsPath = join(tempDir, 'settings.json')
  const lockedMarker = join(tempDir, 'writer-locked')
  const neverRelease = join(tempDir, 'never-release')

  writeFileSync(
    settingsPath,
    `${JSON.stringify({ env: { BASE: '1' } }, null, 2)}\n`,
    'utf8',
  )
  const crashedWriter = startRecoveryWriter(
    tempDir,
    settingsPath,
    'CRASHED_WRITER',
    'pause-write-stat',
    lockedMarker,
    neverRelease,
  )

  try {
    await waitFor(() => existsSync(lockedMarker), 'writer to acquire lock')
    crashedWriter.kill('SIGKILL')
    await Promise.all([
      new Response(crashedWriter.stdout).text(),
      new Response(crashedWriter.stderr).text(),
      crashedWriter.exited,
    ])

    const next = await collectChild<{ ok: boolean; error?: string }>(
      startRecoveryWriter(
        tempDir,
        settingsPath,
        'RECOVERED_AFTER_WRITER_CRASH',
        'complete',
        join(tempDir, 'unused-marker'),
        join(tempDir, 'unused-release'),
      ),
    )

    expect(next).toMatchObject({ exitCode: 0, value: { ok: true } })
  } finally {
    crashedWriter.kill('SIGKILL')
    rmSync(tempDir, { recursive: true, force: true })
  }
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('recovery quarantine names stay within the parent filename limit', async () => {
  const result = await getScenario<{
    skipped: boolean
    error?: string | null
    lockExists?: boolean
  }>('long-recovery-quarantine-name')
  if (result.skipped) return

  expect(result).toEqual({ skipped: false, error: null, lockExists: false })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('acquisition failure cannot unlink owner metadata through a swapped lock symlink', async () => {
  const result = await collectChild<{
    skipped: boolean
    error?: string | null
    foreignOwnerExists?: boolean
    settingsUnchanged?: boolean
  }>(
    Bun.spawn([process.execPath, SETTINGS_LOCK_SYMLINK_SWAP_FIXTURE], {
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    }),
  )
  if (result.value.skipped) return

  expect(result).toMatchObject({
    exitCode: 0,
    value: {
      error: expect.stringContaining('Settings lock path is not a directory'),
      foreignOwnerExists: true,
      settingsUnchanged: true,
    },
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('recovery cleanup crashes only after the live lock path is freed', async () => {
  const tempDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'openclaude-settings-recovery-cleanup-')),
  )
  const settingsPath = join(tempDir, 'settings.json')
  const lockPath = getSettingsFileLockPath(settingsPath)
  const ownerPath = join(lockPath, 'owner.json')
  const cleanupMarker = join(tempDir, 'recovery-metadata-removed')
  const neverRelease = join(tempDir, 'never-release')

  writeFileSync(
    settingsPath,
    `${JSON.stringify({ env: { BASE: '1' } }, null, 2)}\n`,
    'utf8',
  )
  mkdirSync(lockPath)
  writeFileSync(
    ownerPath,
    JSON.stringify(
      createCurrentSettingsLockOwner(MISSING_PROCESS_PID, 'dead-owner'),
    ),
    'utf8',
  )

  try {
    const crashedRecoverer = startRecoveryWriter(
      tempDir,
      settingsPath,
      'CRASHED_DURING_CLEANUP',
      'pause-after-recovery-unlink',
      cleanupMarker,
      neverRelease,
    )
    await waitFor(
      () => existsSync(cleanupMarker),
      'recoverer to remove its recovery metadata',
    )

    expect(existsSync(lockPath)).toBe(false)

    crashedRecoverer.kill('SIGKILL')
    await Promise.all([
      new Response(crashedRecoverer.stdout).text(),
      new Response(crashedRecoverer.stderr).text(),
      crashedRecoverer.exited,
    ])

    const result = await collectChild<{ ok: boolean; error?: string }>(
      startRecoveryWriter(
        tempDir,
        settingsPath,
        'RECOVERED_AFTER_CLEANUP_CRASH',
        'complete',
        join(tempDir, 'unused-marker'),
        join(tempDir, 'unused-release'),
      ),
    )

    expect(result).toMatchObject({
      exitCode: 0,
      value: { ok: true },
    })
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
      env: { BASE: '1', RECOVERED_AFTER_CLEANUP_CRASH: 'true' },
    })
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('normal release frees the canonical lock before owner cleanup', async () => {
  const tempDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'openclaude-settings-release-cleanup-')),
  )
  const settingsPath = join(tempDir, 'settings.json')
  const lockPath = getSettingsFileLockPath(settingsPath)
  const cleanupMarker = join(tempDir, 'owner-metadata-removed')
  const neverRelease = join(tempDir, 'never-release')

  writeFileSync(
    settingsPath,
    `${JSON.stringify({ env: { BASE: '1' } }, null, 2)}\n`,
    'utf8',
  )
  const writer = startRecoveryWriter(
    tempDir,
    settingsPath,
    'FIRST_WRITER',
    'pause-after-owner-unlink',
    cleanupMarker,
    neverRelease,
  )

  try {
    await waitFor(
      () => existsSync(cleanupMarker),
      'writer to remove its owner metadata',
    )
    const canonicalFreedBeforeCleanup = !existsSync(lockPath)

    writer.kill('SIGKILL')
    await Promise.all([
      new Response(writer.stdout).text(),
      new Response(writer.stderr).text(),
      writer.exited,
    ])

    const next = await collectChild<{ ok: boolean; error?: string }>(
      startRecoveryWriter(
        tempDir,
        settingsPath,
        'SECOND_WRITER',
        'complete',
        join(tempDir, 'unused-marker'),
        join(tempDir, 'unused-release'),
      ),
    )

    expect({ canonicalFreedBeforeCleanup, next }).toMatchObject({
      canonicalFreedBeforeCleanup: true,
      next: { exitCode: 0, value: { ok: true } },
    })
  } finally {
    writer.kill('SIGKILL')
    rmSync(tempDir, { recursive: true, force: true })
  }
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('normal release cannot remove a successor acquired after quarantine', async () => {
  const result = await getScenario<{
    error: string | null
    successorCreated: boolean
    successorSurvived: boolean
    final: unknown
  }>('successor-during-release')

  expect(result).toEqual({
    error: null,
    successorCreated: true,
    successorSurvived: true,
    final: { env: { BASE: '1', RELEASED_WITH_SUCCESSOR: 'yes' } },
  })
})

for (const mode of ['acquisition', 'release'] as const) {
  test(`${mode === 'acquisition' ? 'an' : 'a'} ${mode} quarantine failure retires the underlying lock handle`, async () => {
    const result = await collectChild<{
      firstError: string | null
      firstWriteLanded: boolean
      retryError: string | null
      releaseCalls: number
      ownerLeftBehind: boolean
    }>(
      Bun.spawn(
        [process.execPath, SETTINGS_LOCK_RELEASE_FAILURE_FIXTURE, mode],
        {
          cwd: process.cwd(),
          stderr: 'pipe',
          stdout: 'pipe',
        },
      ),
    )

    expect(result).toMatchObject({
      exitCode: 0,
      value: {
        firstError: expect.stringMatching(
          new RegExp(
            `^Failed to update settings at .*${
              mode === 'acquisition'
                ? 'ownership changed during acquisition'
                : 'injected release quarantine failure'
            }`,
          ),
        ),
        firstWritten: mode === 'release',
        firstWriteLanded: mode === 'release',
        retryError: null,
        releaseCalls: 2,
        ownerLeftBehind: false,
      },
    })
  }, SUBPROCESS_TEST_TIMEOUT_MS)
}

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

test('partial settings sync reports landed writes separately from completeness', async () => {
  const result = await collectChild<{
    result: {
      complete: boolean
      settingsSourcesWritten: string[]
    }
    userLanded: boolean
    localUnchanged: boolean
    cachedUser?: string
  }>(
    Bun.spawn([process.execPath, SETTINGS_SYNC_PARTIAL_FIXTURE], {
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    }),
  )

  expect(result).toMatchObject({
    exitCode: 0,
    value: {
      result: {
        complete: false,
        settingsSourcesWritten: ['userSettings'],
      },
      userLanded: true,
      localUnchanged: true,
      cachedUser: 'yes',
    },
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('settings sync reports bytes landed before a release failure', async () => {
  const result = await collectChild<{
    complete: boolean
    settingsSourcesWritten: string[]
  }>(
    Bun.spawn([process.execPath, SETTINGS_SYNC_RELEASE_FAILURE_FIXTURE], {
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    }),
  )

  expect(result).toMatchObject({
    exitCode: 0,
    value: {
      complete: false,
      settingsSourcesWritten: ['userSettings'],
    },
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('settings sync reports oversized and failed memory entries as incomplete', async () => {
  const result = await collectChild<{
    oversized: { complete: boolean; settingsSourcesWritten: string[] }
    memoryFailure: { complete: boolean; settingsSourcesWritten: string[] }
  }>(
    Bun.spawn([process.execPath, SETTINGS_SYNC_UNAPPLIED_FIXTURE], {
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    }),
  )

  expect(result).toMatchObject({
    exitCode: 0,
    value: {
      oversized: { complete: false, settingsSourcesWritten: [] },
      memoryFailure: { complete: false, settingsSourcesWritten: [] },
    },
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('reload plugins notifies every settings source landed by a partial download', async () => {
  const result = await collectChild<{ notified: string[] }>(
    Bun.spawn(
      [
        process.execPath,
        '--feature=DOWNLOAD_USER_SETTINGS',
        SETTINGS_RELOAD_NOTIFICATION_FIXTURE,
      ],
      {
        cwd: process.cwd(),
        stderr: 'pipe',
        stdout: 'pipe',
      },
    ),
  )

  expect(result).toMatchObject({
    exitCode: 0,
    value: { notified: ['userSettings', 'localSettings'] },
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('peer writes through a settings symlink notify the watching session', async () => {
  const result = await collectChild<{
    skipped: boolean
    exitCode?: number
    stderr?: string
    peerNotified?: string[]
    internalError?: string | null
    internalNotified?: string[]
    retargetExitCode?: number
    retargetStderr?: string
    retargetNotified?: string[]
  }>(
    Bun.spawn([process.execPath, SETTINGS_SYMLINK_NOTIFICATION_FIXTURE], {
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    }),
  )
  if (result.value.skipped) return

  expect(result).toMatchObject({
    exitCode: 0,
    value: {
      exitCode: 0,
      stderr: '',
      peerNotified: ['userSettings', 'projectSettings'],
      internalError: null,
      internalNotified: [],
      retargetExitCode: 0,
      retargetStderr: '',
      retargetNotified: ['userSettings', 'projectSettings'],
    },
  })
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
    serializationError: string | null
    markerAfterSerializationFailure: boolean
    secondError: string | null
    lockExists: boolean
    final: unknown
  }>('write-failure')

  expect(result.firstError).toContain('simulated settings stat failure')
  expect(result.serializationError).toContain('BigInt')
  expect(result.markerAfterSerializationFailure).toBe(false)
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
