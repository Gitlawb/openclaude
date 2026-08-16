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
import { basename, join, resolve } from 'node:path'
import { createCurrentSettingsLockOwner } from '../../test/fixtures/settingsLockOwner.js'
import {
  getFsImplementation,
  setFsImplementation,
  setOriginalFsImplementation,
} from '../fsOperations.js'
import {
  getSettingsFileLockPath,
  runSettingsWriteTransactionSync,
  resolveSettingsFileTarget,
  withSettingsFileLockSync,
} from './settingsFileLock.js'
import type { SettingsJson } from './types.js'

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
const SETTINGS_RELOAD_NOTIFICATION_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsReloadNotification.fixture.ts',
)
const SETTINGS_LOCK_SYMLINK_SWAP_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsLockSymlinkSwap.fixture.ts',
)
const SETTINGS_TARGET_RETARGET_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsTargetRetarget.fixture.ts',
)
const SETTINGS_OWNER_WRITE_FAILURE_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsOwnerWriteFailure.fixture.ts',
)
const SETTINGS_LOCK_RELEASE_FAILURE_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsLockReleaseFailure.fixture.ts',
)
const SETTINGS_SYMLINK_NOTIFICATION_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsSymlinkNotification.fixture.ts',
)
const SETTINGS_SYNC_RELEASE_FAILURE_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsSyncReleaseFailure.fixture.ts',
)
const SETTINGS_SYNC_UNAPPLIED_FIXTURE = join(
  import.meta.dir,
  '../../test/fixtures/settingsSyncUnapplied.fixture.ts',
)
const SUBPROCESS_TEST_TIMEOUT_MS = 30_000
const MISSING_PROCESS_PID = 2_147_483_647

setDefaultTimeout(SUBPROCESS_TEST_TIMEOUT_MS)

test('transaction wrapper forwards the publication callback exactly once', () => {
  const tempDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'openclaude-settings-published-callback-')),
  )
  const settingsPath = join(tempDir, 'settings.json')
  let published = 0
  try {
    const result = runSettingsWriteTransactionSync(
      settingsPath,
      ({ writeFile }) => {
        writeFile('{"published":true}\n', () => {
          published++
        })
      },
    )

    expect(result).toMatchObject({
      status: 'committed',
      bytesOnDisk: true,
      committed: true,
      cacheInvalidated: true,
    })
    expect(published).toBe(1)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

type ChildResult<T> = {
  exitCode: number
  stderr: string
  stdout: string
  value: T
}

function skipUnsupportedScenario(skipped: boolean, scenario: string): boolean {
  if (!skipped) return false
  console.warn(
    `[settings transaction test] skipped ${scenario} on ${process.platform}`,
  )
  return true
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
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let stdout: string
  let stderr: string
  let exitCode: number
  try {
    ;[stdout, stderr, exitCode] = await Promise.race([
      Promise.all([
        new Response(processHandle.stdout).text(),
        new Response(processHandle.stderr).text(),
        processHandle.exited,
      ]),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true
          reject(new Error('Timed out waiting for settings fixture process'))
        }, SUBPROCESS_TEST_TIMEOUT_MS - 1_000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    if (timedOut && processHandle.exitCode === null) {
      processHandle.kill('SIGKILL')
      await processHandle.exited.catch(() => undefined)
    }
  }
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

async function stopChild(
  processHandle: ReturnType<typeof startWriter> | undefined,
): Promise<void> {
  if (!processHandle) return
  if (processHandle.exitCode === null) {
    processHandle.kill('SIGKILL')
  }
  const drain = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    try {
      await new Response(stream).text()
    } catch {
      // A successful collectChild call has already consumed this stream.
    }
  }
  await Promise.allSettled([
    drain(processHandle.stdout),
    drain(processHandle.stderr),
    processHandle.exited,
  ])
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
  let writerA: ReturnType<typeof startWriter> | undefined
  let writerB: ReturnType<typeof startWriter> | undefined

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
    writerA = startWriter(
      aliasA,
      settingsPath,
      'WRITER_A',
      writerARead,
      releaseWriterA,
    )
    await waitFor(() => existsSync(writerARead), 'writer A to read settings')

    writerB = startWriter(
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
    await Promise.all([stopChild(writerA), stopChild(writerB)])
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

test('public settings updates preserve the legacy error-only result surface', async () => {
  const result = await getScenario<{
    keys: string[]
    error: string | null
    final: SettingsJson
  }>('public-result')

  expect(result).toEqual({
    keys: ['error'],
    error: null,
    final: { env: { BASE: '1', PUBLIC: 'committed' } },
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
    ownershipTested?: boolean
    gidBefore?: number
    gidAfter?: number
    final?: unknown
    cached?: unknown
  }>('semantics')
  if (skipUnsupportedScenario(result.skipped, 'symlink merge semantics')) return

  expect(result).toMatchObject({
    skipped: false,
    warmed: { KEEP: '1', REMOVE: 'stale' },
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
  if (result.ownershipTested) {
    expect(result.gidAfter).toBe(result.gidBefore)
  } else {
    console.warn(
      '[settings transaction test] skipped supplementary-group ownership preservation',
    )
  }
})

test('atomic replacement refuses a target swapped after metadata capture', async () => {
  const result = await getScenario<{
    skipped: boolean
    writeError?: string | null
    targetStatCalls?: number
    finalBytes?: string
    writeTemps?: string[]
  }>('publication-target-race')
  if (skipUnsupportedScenario(result.skipped, 'publication target race')) return

  expect(result).toEqual({
    skipped: false,
    writeError: 'Settings file changed during atomic replacement',
    targetStatCalls: 2,
    finalBytes: '{"env":{"EXTERNAL":"wins"}}\n',
    writeTemps: [],
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
  if (skipUnsupportedScenario(result.skipped, 'dangling symlink identity')) return

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
  if (skipUnsupportedScenario(result.skipped, 'long dangling symlink identity')) return

  expect(result.resolvedA).toBe(result.physicalTarget)
  expect(result.resolvedB).toBe(result.physicalTarget)
})

test('fixed-length lock names support long valid target basenames', () => {
  if (process.platform === 'win32') {
    console.warn(
      '[settings transaction test] skipped long target basename on win32',
    )
    return
  }
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
  let writerA: ReturnType<typeof startRecoveryWriter> | undefined
  let writerB: ReturnType<typeof startRecoveryWriter> | undefined

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
    writerA = startRecoveryWriter(
      tempDir,
      settingsPath,
      'RECOVERER_A',
      'pause-owner-unlink',
      aMarker,
      aRelease,
    )
    await waitFor(() => existsSync(aMarker), 'recoverer A to claim cleanup')

    writerB = startRecoveryWriter(
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
    await Promise.all([stopChild(writerA), stopChild(writerB)])
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

test('ownerless locks fail closed even when their directory is old', async () => {
  const result = await getScenario<{
    error: string | null
    lockExists: boolean
    final: unknown
  }>('abandoned-ownerless-lock')

  expect(result).toEqual({
    error: expect.stringContaining('already being held'),
    lockExists: true,
    final: { env: { BASE: '1' } },
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
  if (skipUnsupportedScenario(result.skipped, 'prior boot owner recovery')) return

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
  if (skipUnsupportedScenario(result.skipped, 'reused pid owner recovery')) return

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
  if (
    skipUnsupportedScenario(
      result.skipped,
      'long recovery quarantine filename',
    )
  )
    return

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
  if (skipUnsupportedScenario(result.value.skipped, 'symlink swap lock')) return

  expect(result).toMatchObject({
    exitCode: 0,
    value: {
      error: expect.stringContaining('Settings lock path is not a directory'),
      foreignOwnerExists: true,
      settingsUnchanged: true,
    },
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('settings sync does not report a physical write to a retargeted settings symlink as applied', async () => {
  const result = await collectChild<{
    skipped: boolean
    applied?: boolean
    directResult?: {
      status: string
      bytesOnDisk: boolean
      committed: boolean
      cacheInvalidated: boolean
      error: boolean
    }
    physicalWriteLanded?: boolean
    logicalTargetUnchanged?: boolean
  }>(
    Bun.spawn([process.execPath, SETTINGS_TARGET_RETARGET_FIXTURE], {
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    }),
  )
  if (skipUnsupportedScenario(result.value.skipped, 'post-write settings target retarget')) return

  expect(result).toMatchObject({
    exitCode: 0,
    value: {
      applied: false,
      directResult: {
        status: 'written-uncommitted',
        bytesOnDisk: true,
        committed: false,
        cacheInvalidated: true,
        error: true,
      },
      physicalWriteLanded: true,
      logicalTargetUnchanged: true,
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
  let crashedRecoverer: ReturnType<typeof startRecoveryWriter> | undefined

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
    crashedRecoverer = startRecoveryWriter(
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
    await stopChild(crashedRecoverer)
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

test.each(['partial', 'empty'] as const)(
  'an owner metadata %s-write failure does not strand or leak the acquired lock',
  async mode => {
  const result = await collectChild<{
    firstError: string | null
    firstCommitted: boolean
    lockAbsentAfterFailure: boolean
    abortedQuarantineAbsent: boolean
    secondError: string | null
    secondCommitted: boolean
    settings: SettingsJson
  }>(
    Bun.spawn(
      [process.execPath, SETTINGS_OWNER_WRITE_FAILURE_FIXTURE, mode],
      {
        cwd: process.cwd(),
        stderr: 'pipe',
        stdout: 'pipe',
      },
    ),
  )

  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.value).toMatchObject({
    firstError: expect.stringContaining(`injected ${mode} owner write`),
    firstCommitted: false,
    lockAbsentAfterFailure: true,
    abortedQuarantineAbsent: true,
    secondError: null,
    secondCommitted: true,
    settings: { env: { SECOND: 'committed' } },
  })
  },
)

for (const mode of ['acquisition', 'release'] as const) {
  test(`${mode === 'acquisition' ? 'an' : 'a'} ${mode} quarantine failure retires the underlying lock handle`, async () => {
    const result = await collectChild<{
      firstError: string | null
      firstWritten: boolean
      firstWriteLanded: boolean
      firstResult: {
        status: string
        bytesOnDisk: boolean
        committed: boolean
        cacheInvalidated: boolean
        sessionNotified: boolean
        error: boolean
      }
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
            mode === 'acquisition'
              ? '^Failed to update settings at .*ownership changed during acquisition'
              : '^Settings update committed but cleanup failed at .*injected release quarantine failure',
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

test('sync replacement and interactive update classify a release failure identically', async () => {
  type ReleaseFailureResult = {
    firstResult: {
      status: string
      bytesOnDisk: boolean
      committed: boolean
      cacheInvalidated: boolean
      sessionNotified: boolean
      error: boolean
    }
    firstWriteLanded: boolean
    retryError: string | null
  }
  const collect = (writer: 'update' | 'replace') =>
    collectChild<ReleaseFailureResult>(
      Bun.spawn(
        [
          process.execPath,
          SETTINGS_LOCK_RELEASE_FAILURE_FIXTURE,
          'release',
          writer,
        ],
        {
          cwd: process.cwd(),
          stderr: 'pipe',
          stdout: 'pipe',
        },
      ),
    )

  const [interactive, sync] = await Promise.all([
    collect('update'),
    collect('replace'),
  ])
  expect(interactive.exitCode, interactive.stderr).toBe(0)
  expect(sync.exitCode, sync.stderr).toBe(0)
  expect(interactive.value).toMatchObject({
    firstResult: {
      status: 'committed',
      bytesOnDisk: true,
      committed: true,
      cacheInvalidated: true,
      sessionNotified: false,
      error: true,
    },
    firstWriteLanded: true,
    retryError: null,
  })
  expect(sync.value).toMatchObject({
    firstResult: interactive.value.firstResult,
    firstWriteLanded: true,
    retryError: null,
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('legacy settings updates report a committed release-cleanup failure as success', async () => {
  const result = await collectChild<{
    firstError: string | null
    firstWriteLanded: boolean
    retryError: string | null
  }>(
    Bun.spawn(
      [
        process.execPath,
        SETTINGS_LOCK_RELEASE_FAILURE_FIXTURE,
        'release',
        'public',
      ],
      {
        cwd: process.cwd(),
        stderr: 'pipe',
        stdout: 'pipe',
      },
    ),
  )

  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.value).toMatchObject({
    firstError: null,
    firstWriteLanded: true,
    retryError: null,
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('settings sync reports contention as an unapplied download', async () => {
  const result = await collectChild<{
    result: { complete: boolean; settingsSourcesWritten: string[] }
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
      value: {
        result: { complete: false, settingsSourcesWritten: [] },
        unchanged: true,
      },
    },
  )
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('a superseded startup download cannot overwrite a newer redownload', async () => {
  const result = await collectChild<{
    finalValue: string
    sameResult: boolean
    redownloadResult: {
      complete: boolean
      failureKind: string | null
      settingsSourcesWritten: string[]
    }
  }>(
    Bun.spawn([process.execPath, SETTINGS_SYNC_PARTIAL_FIXTURE, 'supersession'], {
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    }),
  )

  expect(result, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toMatchObject(
    {
      exitCode: 0,
      value: {
        finalValue: 'new',
        sameResult: true,
        redownloadResult: {
          complete: true,
          failureKind: null,
          settingsSourcesWritten: ['userSettings'],
        },
      },
    },
  )
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('a newer settings generation applies after an in-flight older generation', async () => {
  const result = await collectChild<{
    applyEvents: string[]
    finalValue: string
    newerStartedBeforeRelease: boolean
    sameResult: boolean
  }>(
    Bun.spawn(
      [
        process.execPath,
        SETTINGS_SYNC_PARTIAL_FIXTURE,
        'supersession-inflight',
      ],
      {
        cwd: process.cwd(),
        stderr: 'pipe',
        stdout: 'pipe',
      },
    ),
  )

  expect(result, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toMatchObject(
    {
      exitCode: 0,
      value: {
        applyEvents: [
          'started:stale',
          'finished:stale',
          'started:new',
          'finished:new',
        ],
        finalValue: 'new',
        newerStartedBeforeRelease: false,
        sameResult: true,
      },
    },
  )
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('a post-apply partial result survives supersession by a failed fetch', async () => {
  const result = await collectChild<{
    finalValue: string
    redownloadResult: {
      complete: boolean
      failureKind: string | null
      settingsSourcesWritten: string[]
    }
    startupResult: {
      complete: boolean
      failureKind: string | null
      settingsSourcesWritten: string[]
    }
  }>(
    Bun.spawn(
      [
        process.execPath,
        SETTINGS_SYNC_PARTIAL_FIXTURE,
        'supersession-after-apply-fetch-fail',
      ],
      { cwd: process.cwd(), stderr: 'pipe', stdout: 'pipe' },
    ),
  )

  expect(result, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toMatchObject(
    {
      exitCode: 0,
      value: {
        finalValue: 'applied-by-startup',
        redownloadResult: {
          complete: false,
          failureKind: 'fetch_failed',
          settingsSourcesWritten: [],
        },
        startupResult: {
          complete: false,
          failureKind: 'apply_failed',
          settingsSourcesWritten: ['userSettings'],
        },
      },
    },
  )
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('a project-id failure after fetch is classified as preparation failure', async () => {
  const result = await collectChild<{
    complete: boolean
    failureKind: string | null
    settingsSourcesWritten: string[]
  }>(
    Bun.spawn(
      [process.execPath, SETTINGS_SYNC_PARTIAL_FIXTURE, 'prepare-failure'],
      { cwd: process.cwd(), stderr: 'pipe', stdout: 'pipe' },
    ),
  )

  expect(result).toMatchObject({
    exitCode: 0,
    value: {
      complete: false,
      failureKind: 'prepare_failed',
      settingsSourcesWritten: [],
    },
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('partial settings sync reports committed sources separately from completeness', async () => {
  const result = await collectChild<{
    result: { complete: boolean; settingsSourcesWritten: string[] }
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

test.each([
  'user-oversized',
  'user-unwritable',
  'project-oversized',
  'project-unwritable',
] as const)(
  'settings sync reports %s memory entries as incomplete without hiding committed settings',
  async scenario => {
    const result = await collectChild<{
      result: { complete: boolean; settingsSourcesWritten: string[] }
      settingsLanded: boolean
    }>(
      Bun.spawn(
        [process.execPath, SETTINGS_SYNC_PARTIAL_FIXTURE, scenario],
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
        result: {
          complete: false,
          settingsSourcesWritten: ['userSettings'],
        },
        settingsLanded: true,
      },
    })
  },
  SUBPROCESS_TEST_TIMEOUT_MS,
)

test('real settings watchers follow symlink peers, suppress internal writes, and retarget', async () => {
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

  if (skipUnsupportedScenario(result.value.skipped, 'settings symlink notifications')) {
    return
  }
  expect(result).toMatchObject({
    exitCode: 0,
    stderr: '',
    value: {
      exitCode: 0,
      stderr: '',
      peerNotified: expect.arrayContaining(['userSettings', 'projectSettings']),
      internalError: null,
      internalNotified: [],
      retargetExitCode: 0,
      retargetStderr: '',
      retargetNotified: expect.arrayContaining([
        'userSettings',
        'projectSettings',
      ]),
    },
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('settings sync retains committed sources when release cleanup fails', async () => {
  const result = await collectChild<{
    complete: boolean
    failureKind: string | null
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
    stderr: '',
    value: {
      complete: true,
      failureKind: null,
      settingsSourcesWritten: ['userSettings'],
    },
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('settings sync reports oversized and unwritable entries as unapplied', async () => {
  const result = await collectChild<{
    oversized: {
      complete: boolean
      failureKind: string | null
      settingsSourcesWritten: string[]
    }
    memoryFailure: {
      complete: boolean
      failureKind: string | null
      settingsSourcesWritten: string[]
    }
  }>(
    Bun.spawn([process.execPath, SETTINGS_SYNC_UNAPPLIED_FIXTURE], {
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    }),
  )

  expect(result).toMatchObject({
    exitCode: 0,
    stderr: '',
    value: {
      oversized: {
        complete: false,
        failureKind: 'apply_failed',
        settingsSourcesWritten: [],
      },
      memoryFailure: {
        complete: false,
        failureKind: 'apply_failed',
        settingsSourcesWritten: [],
      },
    },
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('reload plugins notifies committed sources and blocks after a partial apply', async () => {
  const result = await collectChild<{
    notified: string[]
    refreshed: number
    result: { type: string; value: string }
  }>(
    Bun.spawn(
      [
        process.execPath,
        '--feature=DOWNLOAD_USER_SETTINGS',
        SETTINGS_RELOAD_NOTIFICATION_FIXTURE,
        'partial',
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
    value: {
      notified: ['userSettings', 'localSettings'],
      refreshed: 0,
      result: {
        value: expect.stringContaining(
          'Remote settings were only partially applied',
        ),
      },
    },
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('reload plugins fails open to local disk after a total fetch failure', async () => {
  const result = await collectChild<{
    notified: string[]
    refreshed: number
    result: { type: string; value: string }
  }>(
    Bun.spawn(
      [
        process.execPath,
        '--feature=DOWNLOAD_USER_SETTINGS',
        SETTINGS_RELOAD_NOTIFICATION_FIXTURE,
        'fetch-failed',
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
    value: {
      notified: [],
      refreshed: 1,
      result: {
        value: expect.stringContaining(
          'Remote settings could not be downloaded; plugins were refreshed from local disk.',
        ),
      },
    },
  })
}, SUBPROCESS_TEST_TIMEOUT_MS)

test('reload plugins blocks a post-fetch preparation failure', async () => {
  const result = await collectChild<{
    notified: string[]
    refreshed: number
    result: { type: string; value: string }
  }>(
    Bun.spawn(
      [
        process.execPath,
        '--feature=DOWNLOAD_USER_SETTINGS',
        SETTINGS_RELOAD_NOTIFICATION_FIXTURE,
        'prepare-failed',
      ],
      { cwd: process.cwd(), stderr: 'pipe', stdout: 'pipe' },
    ),
  )

  expect(result).toMatchObject({
    exitCode: 0,
    value: {
      notified: [],
      refreshed: 0,
      result: {
        value: expect.stringContaining(
          'Remote settings could not be prepared for local application',
        ),
      },
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
