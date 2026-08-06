import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'
import {
  getFsImplementation,
  setFsImplementation,
  setOriginalFsImplementation,
} from '../../utils/fsOperations.js'
import { clearInternalWrites } from '../../utils/settings/internalWrites.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import {
  replaceSettingsFileSync,
  resolveSettingsFileTarget,
  withSettingsFileLockSync,
} from '../../utils/settings/settingsFileLock.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { createCurrentSettingsLockOwner } from './settingsLockOwner.js'

const scenario = process.argv[2]
const configDir = realpathSync(
  mkdtempSync(join(tmpdir(), 'openclaude-settings-scenario-')),
)
const settingsPath = join(configDir, 'settings.json')
// Node forwards this PID to the OS, which reports ESRCH, while the invalid PID
// is rejected before the liveness probe. Recovery is allowed only for ESRCH.
const MISSING_PROCESS_PID = 2_147_483_647
const INVALID_PROCESS_PID = Number.MAX_SAFE_INTEGER

setClaudeConfigHomeDirForTesting(configDir)
getClaudeConfigHomeDir.cache?.clear?.()
resetSettingsCache()
clearInternalWrites()

function writeSettings(settings: unknown): void {
  writeFileSync(
    settingsPath,
    `${JSON.stringify(settings, null, 2)}\n`,
    'utf8',
  )
}

function readSettings(path = settingsPath): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function cacheScenario(): unknown {
  writeSettings({ env: { CACHED: 'old' } })
  const warmed = getSettingsForSource('userSettings')?.env

  writeSettings({ env: { EXTERNAL: 'fresh' } })
  const result = updateSettingsForSource('userSettings', {
    env: { LOCAL: 'added' },
  })

  return {
    warmed,
    error: result.error?.message ?? null,
    final: readSettings(),
  }
}

function malformedScenario(): unknown {
  writeSettings({ env: { CACHED: 'old' } })
  const warmed = getSettingsForSource('userSettings')?.env

  const malformed = '{ "env": '
  writeFileSync(settingsPath, malformed, 'utf8')
  const refused = updateSettingsForSource('userSettings', {
    env: { LOCAL: 'must-not-land' },
  })
  const bytesAfterRefusal = readFileSync(settingsPath, 'utf8')

  writeSettings({ env: { RECOVERED: 'yes' } })
  const recovered = updateSettingsForSource('userSettings', {
    env: { AFTER_ERROR: 'yes' },
  })

  return {
    warmed,
    refusedError: refused.error?.message ?? null,
    bytesAfterRefusal,
    malformed,
    recoveredError: recovered.error?.message ?? null,
    final: readSettings(),
  }
}

function semanticsScenario(): unknown {
  if (process.platform === 'win32') {
    return { skipped: true }
  }

  const physicalDir = join(configDir, 'physical')
  const targetPath = join(physicalDir, 'settings-target.json')
  mkdirSync(physicalDir)
  writeFileSync(
    targetPath,
    `${JSON.stringify(
      {
        env: { KEEP: '1' },
        permissions: {
          allow: ['Bash(old)'],
          deny: ['Read(secret)'],
        },
        enabledPlugins: { keep: true, remove: true },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  chmodSync(targetPath, 0o640)
  symlinkSync(targetPath, settingsPath, 'file')

  const warmed = getSettingsForSource('userSettings')?.env
  const update = {
    env: { ADD: '2' },
    permissions: { allow: ['Read(new)'] },
    enabledPlugins: { remove: undefined },
  } as unknown as SettingsJson
  const result = updateSettingsForSource('userSettings', update)

  return {
    skipped: false,
    warmed,
    error: result.error?.message ?? null,
    symlink: lstatSync(settingsPath).isSymbolicLink(),
    mode: statSync(targetPath).mode & 0o777,
    final: readSettings(targetPath),
    cached: getSettingsForSource('userSettings'),
  }
}

function liveLockScenario(): unknown {
  writeSettings({ env: { BASE: '1' } })
  const before = readFileSync(settingsPath, 'utf8')
  let updateError: string | null = null
  let replacementError: string | null = null

  withSettingsFileLockSync(settingsPath, () => {
    updateError =
      updateSettingsForSource('userSettings', {
        env: { BLOCKED: 'update' },
      }).error?.message ?? null
    try {
      replaceSettingsFileSync(
        settingsPath,
        `${JSON.stringify({ env: { BLOCKED: 'sync' } })}\n`,
      )
    } catch (error) {
      replacementError = String(error)
    }
  })

  return {
    updateError,
    replacementError,
    unchanged: readFileSync(settingsPath, 'utf8') === before,
  }
}

function deadOwnerScenario(): unknown {
  writeSettings({ env: { BASE: '1' } })
  const targetPath = resolveSettingsFileTarget(settingsPath)
  const lockPath = `${targetPath}.lock`
  const ownerPath = join(lockPath, 'owner.json')

  mkdirSync(lockPath)
  writeFileSync(
    ownerPath,
    JSON.stringify(
      createCurrentSettingsLockOwner(MISSING_PROCESS_PID, 'dead-owner'),
    ),
    'utf8',
  )
  const recovered = updateSettingsForSource('userSettings', {
    env: { RECOVERED: 'yes' },
  })
  const deadLockRemoved =
    !existsSync(lockPath) && !existsSync(ownerPath)

  const beforeCorrupt = readFileSync(settingsPath, 'utf8')
  rmSync(lockPath, { recursive: true, force: true })
  mkdirSync(lockPath)
  writeFileSync(ownerPath, 'not-json', 'utf8')
  const blocked = updateSettingsForSource('userSettings', {
    env: { MUST_NOT_LAND: 'true' },
  })
  const corruptUnchanged =
    readFileSync(settingsPath, 'utf8') === beforeCorrupt

  let symlinkBlockedError: string | null = null
  let symlinkOwnerUntouched = true
  if (process.platform !== 'win32') {
    rmSync(lockPath, { recursive: true, force: true })
    const foreignLockPath = join(configDir, 'foreign-lock')
    const foreignOwnerPath = join(foreignLockPath, 'owner.json')
    mkdirSync(foreignLockPath)
    writeFileSync(
      foreignOwnerPath,
      JSON.stringify({ pid: MISSING_PROCESS_PID, token: 'foreign-owner' }),
      'utf8',
    )
    symlinkSync(foreignLockPath, lockPath, 'dir')
    symlinkBlockedError =
      updateSettingsForSource('userSettings', {
        env: { SYMLINK_LOCK_MUST_NOT_LAND: 'true' },
      }).error?.message ?? null
    symlinkOwnerUntouched = existsSync(foreignOwnerPath)
  }

  return {
    recoveredError: recovered.error?.message ?? null,
    deadLockRemoved,
    blockedError: blocked.error?.message ?? null,
    corruptUnchanged,
    symlinkBlockedError,
    symlinkOwnerUntouched,
  }
}

function orphanedRecoveryClaimScenario(): unknown {
  writeSettings({ env: { BASE: '1' } })
  const targetPath = resolveSettingsFileTarget(settingsPath)
  const lockPath = `${targetPath}.lock`
  const ownerPath = join(lockPath, 'owner.json')
  const recoveryPath = join(lockPath, 'recovery.json')

  mkdirSync(lockPath)
  writeFileSync(
    ownerPath,
    JSON.stringify(
      createCurrentSettingsLockOwner(MISSING_PROCESS_PID, 'dead-owner'),
    ),
    'utf8',
  )
  writeFileSync(
    recoveryPath,
    JSON.stringify(
      createCurrentSettingsLockOwner(MISSING_PROCESS_PID, 'dead-recoverer'),
    ),
    'utf8',
  )

  const result = updateSettingsForSource('userSettings', {
    env: { RECOVERED_CLAIM: 'yes' },
  })

  return {
    error: result.error?.message ?? null,
    lockExists: existsSync(lockPath),
    final: readSettings(),
  }
}

function separatorRecoveryTokenScenario(): unknown {
  writeSettings({ env: { BASE: '1' } })
  const targetPath = resolveSettingsFileTarget(settingsPath)
  const lockPath = `${targetPath}.lock`
  const recoveryPath = join(lockPath, 'recovery.json')

  mkdirSync(lockPath)
  writeFileSync(
    recoveryPath,
    JSON.stringify(
      createCurrentSettingsLockOwner(
        MISSING_PROCESS_PID,
        join('nested', 'untrusted'),
      ),
    ),
    'utf8',
  )

  const result = updateSettingsForSource('userSettings', {
    env: { RECOVERED_UNTRUSTED_TOKEN: 'yes' },
  })

  return {
    error: result.error?.message ?? null,
    lockExists: existsSync(lockPath),
    final: readSettings(),
  }
}

function abandonedOwnerlessLockScenario(): unknown {
  writeSettings({ env: { BASE: '1' } })
  const targetPath = resolveSettingsFileTarget(settingsPath)
  const lockPath = `${targetPath}.lock`
  const originalFs = getFsImplementation()
  const abandonedAt = Date.now() - 10 * 60 * 1000

  mkdirSync(lockPath)
  const abandonedIdentity = originalFs.lstatSync(lockPath)
  setFsImplementation({
    ...originalFs,
    lstatSync(path) {
      const stats = originalFs.lstatSync(path)
      if (
        stats.dev !== abandonedIdentity.dev ||
        stats.ino !== abandonedIdentity.ino
      ) {
        return stats
      }
      return new Proxy(stats, {
        get(target, property) {
          if (
            property === 'birthtimeMs' ||
            property === 'ctimeMs' ||
            property === 'mtimeMs'
          ) {
            return abandonedAt
          }
          const value = Reflect.get(target, property, target) as unknown
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
  })

  try {
    const result = updateSettingsForSource('userSettings', {
      env: { RECOVERED_OWNERLESS_LOCK: 'yes' },
    })
    return {
      error: result.error?.message ?? null,
      lockExists: existsSync(lockPath),
      final: readSettings(),
    }
  } finally {
    setOriginalFsImplementation()
  }
}

function foreignRuntimeOwnerScenario(): unknown {
  writeSettings({ env: { BASE: '1' } })
  const targetPath = resolveSettingsFileTarget(settingsPath)
  const lockPath = `${targetPath}.lock`
  const ownerPath = join(lockPath, 'owner.json')
  const before = readFileSync(settingsPath, 'utf8')

  mkdirSync(lockPath)
  writeFileSync(
    ownerPath,
    JSON.stringify({
      pid: MISSING_PROCESS_PID,
      hostId: 'foreign-host',
      runtimeId: 'foreign-runtime',
      token: 'foreign-runtime-owner',
    }),
    'utf8',
  )
  const result = updateSettingsForSource('userSettings', {
    env: { FOREIGN_RUNTIME_MUST_NOT_LAND: 'true' },
  })

  return {
    error: result.error?.message ?? null,
    lockExists: existsSync(lockPath),
    unchanged: readFileSync(settingsPath, 'utf8') === before,
  }
}

function priorBootOwnerScenario(): unknown {
  writeSettings({ env: { BASE: '1' } })
  const targetPath = resolveSettingsFileTarget(settingsPath)
  const lockPath = `${targetPath}.lock`
  const ownerPath = join(lockPath, 'owner.json')
  const owner = createCurrentSettingsLockOwner(
    MISSING_PROCESS_PID,
    'prior-boot-owner',
  )

  mkdirSync(lockPath)
  writeFileSync(
    ownerPath,
    JSON.stringify({
      ...owner,
      bootId: 'v1:prior-boot',
      runtimeId: 'v1:prior-runtime',
    }),
    'utf8',
  )
  const result = updateSettingsForSource('userSettings', {
    env: { RECOVERED_AFTER_REBOOT: 'yes' },
  })

  return {
    error: result.error?.message ?? null,
    lockExists: existsSync(lockPath),
    final: readSettings(),
  }
}

function legacyOwnerScenario(): unknown {
  writeSettings({ env: { BASE: '1' } })
  const targetPath = resolveSettingsFileTarget(settingsPath)
  const lockPath = `${targetPath}.lock`
  const ownerPath = join(lockPath, 'owner.json')
  const before = readFileSync(settingsPath, 'utf8')

  mkdirSync(lockPath)
  writeFileSync(
    ownerPath,
    JSON.stringify({ pid: MISSING_PROCESS_PID, token: 'legacy-owner' }),
    'utf8',
  )
  const result = updateSettingsForSource('userSettings', {
    env: { LEGACY_OWNER_MUST_NOT_LAND: 'true' },
  })

  return {
    error: result.error?.message ?? null,
    lockExists: existsSync(lockPath),
    unchanged: readFileSync(settingsPath, 'utf8') === before,
  }
}

function longRecoveryQuarantineNameScenario(): unknown {
  if (process.platform === 'win32') {
    return { skipped: true }
  }

  const targetPath = join(configDir, 'x'.repeat(210))
  const lockPath = `${targetPath}.lock`
  const recoveryPath = join(lockPath, 'recovery.json')
  writeFileSync(targetPath, '{}\n', 'utf8')
  mkdirSync(lockPath)
  writeFileSync(
    recoveryPath,
    JSON.stringify(
      createCurrentSettingsLockOwner(MISSING_PROCESS_PID, 'x'.repeat(36)),
    ),
    'utf8',
  )

  let error: string | null = null
  try {
    withSettingsFileLockSync(targetPath, () => {})
  } catch (cause) {
    error = String(cause)
  }

  return {
    skipped: false,
    error,
    lockExists: existsSync(lockPath),
  }
}

function successorDuringReleaseScenario(): unknown {
  writeSettings({ env: { BASE: '1' } })
  const targetPath = resolveSettingsFileTarget(settingsPath)
  const lockPath = `${targetPath}.lock`
  const originalFs = getFsImplementation()
  let successorIdentity: { dev: number; ino: number } | null = null

  setFsImplementation({
    ...originalFs,
    renameSync(oldPath, newPath) {
      const result = originalFs.renameSync(oldPath, newPath)
      if (
        oldPath === lockPath &&
        typeof newPath === 'string' &&
        newPath.includes('.openclaude-settings-released-')
      ) {
        originalFs.mkdirSync(lockPath)
        const stats = originalFs.lstatSync(lockPath)
        successorIdentity = { dev: stats.dev, ino: stats.ino }
      }
      return result
    },
  })

  try {
    const result = updateSettingsForSource('userSettings', {
      env: { RELEASED_WITH_SUCCESSOR: 'yes' },
    })
    const expectedIdentity = successorIdentity as {
      dev: number
      ino: number
    } | null
    const current = existsSync(lockPath) ? lstatSync(lockPath) : null
    return {
      error: result.error?.message ?? null,
      successorCreated: expectedIdentity !== null,
      successorSurvived:
        expectedIdentity !== null &&
        current !== null &&
        current.dev === expectedIdentity.dev &&
        current.ino === expectedIdentity.ino,
      final: readSettings(),
    }
  } finally {
    setOriginalFsImplementation()
  }
}

function pidOneScenario(): unknown {
  writeSettings({ env: { BASE: '1' } })
  const targetPath = resolveSettingsFileTarget(settingsPath)
  const lockPath = `${targetPath}.lock`
  const originalPid = process.pid
  let error: string | null = null

  try {
    Object.defineProperty(process, 'pid', {
      configurable: true,
      enumerable: true,
      value: 1,
      writable: true,
    })
    error =
      updateSettingsForSource('userSettings', {
        env: { PID_ONE: 'works' },
      }).error?.message ?? null
  } finally {
    Object.defineProperty(process, 'pid', {
      configurable: true,
      enumerable: true,
      value: originalPid,
      writable: true,
    })
  }

  return {
    error,
    lockExists: existsSync(lockPath),
    final: readSettings(),
  }
}

function danglingAliasScenario(): unknown {
  if (process.platform === 'win32') {
    return { skipped: true }
  }

  const physicalDir = join(configDir, 'physical-dangling')
  const aliasA = join(configDir, 'dangling-alias-a')
  const aliasB = join(configDir, 'dangling-alias-b')
  const physicalLink = join(physicalDir, 'settings.json')
  const physicalTarget = join(physicalDir, 'missing.json')
  mkdirSync(physicalDir)
  symlinkSync(physicalDir, aliasA, 'dir')
  symlinkSync(physicalDir, aliasB, 'dir')
  symlinkSync('missing.json', physicalLink, 'file')

  return {
    skipped: false,
    physicalTarget,
    resolvedA: resolveSettingsFileTarget(join(aliasA, 'settings.json')),
    resolvedB: resolveSettingsFileTarget(join(aliasB, 'settings.json')),
  }
}

function longDanglingChainScenario(): unknown {
  if (process.platform === 'win32') {
    return { skipped: true }
  }

  const physicalDir = join(configDir, 'physical-long-chain')
  const aliasA = join(configDir, 'long-chain-alias-a')
  const aliasB = join(configDir, 'long-chain-alias-b')
  const physicalTarget = join(physicalDir, 'missing.json')
  mkdirSync(physicalDir)
  symlinkSync(physicalDir, aliasA, 'dir')
  symlinkSync(physicalDir, aliasB, 'dir')
  // Seventeen crosses the original 16-link regression boundary while staying
  // below the OS symlink limit, so resolution reaches the dangling final link.
  for (let index = 1; index <= 17; index++) {
    symlinkSync(
      index === 17 ? 'missing.json' : `link-${index + 1}`,
      join(physicalDir, `link-${index}`),
      'file',
    )
  }

  return {
    skipped: false,
    physicalTarget,
    resolvedA: resolveSettingsFileTarget(join(aliasA, 'link-1')),
    resolvedB: resolveSettingsFileTarget(join(aliasB, 'link-1')),
  }
}

function ownerMetadataScenario(): unknown {
  writeSettings({ env: { BASE: '1' } })
  const targetPath = resolveSettingsFileTarget(settingsPath)
  const lockPath = `${targetPath}.lock`
  const ownerPath = join(lockPath, 'owner.json')
  const recoveryPath = join(lockPath, 'recovery.json')
  const before = readFileSync(settingsPath, 'utf8')

  let symlinkError: string | null = null
  let symlinkOwnerUntouched = true
  if (process.platform !== 'win32') {
    const foreignOwnerPath = join(configDir, 'foreign-owner.json')
    writeFileSync(
      foreignOwnerPath,
      JSON.stringify({ pid: MISSING_PROCESS_PID, token: 'foreign-owner' }),
      'utf8',
    )
    mkdirSync(lockPath)
    symlinkSync(foreignOwnerPath, ownerPath, 'file')
    symlinkError =
      updateSettingsForSource('userSettings', {
        env: { SYMLINK_OWNER_MUST_NOT_LAND: 'true' },
      }).error?.message ?? null
    symlinkOwnerUntouched = existsSync(foreignOwnerPath)
    rmSync(lockPath, { recursive: true, force: true })
  }

  mkdirSync(lockPath)
  writeFileSync(
    ownerPath,
    `${JSON.stringify({ pid: MISSING_PROCESS_PID, token: 'oversized' })}${' '.repeat(8_192)}`,
    'utf8',
  )
  const oversizedError =
    updateSettingsForSource('userSettings', {
      env: { OVERSIZED_OWNER_MUST_NOT_LAND: 'true' },
    }).error?.message ?? null

  rmSync(lockPath, { recursive: true, force: true })
  mkdirSync(lockPath)
  const missingError =
    updateSettingsForSource('userSettings', {
      env: { MISSING_OWNER_MUST_NOT_LAND: 'true' },
    }).error?.message ?? null
  const missingUnchanged =
    readFileSync(settingsPath, 'utf8') === before

  rmSync(lockPath, { recursive: true, force: true })
  mkdirSync(lockPath)
  writeFileSync(
    recoveryPath,
    JSON.stringify(
      createCurrentSettingsLockOwner(process.pid, 'live-recoverer'),
    ),
    'utf8',
  )
  const liveRecoveryError =
    updateSettingsForSource('userSettings', {
      env: { LIVE_RECOVERY_MUST_NOT_LAND: 'true' },
    }).error?.message ?? null
  const liveRecoveryUnchanged =
    readFileSync(settingsPath, 'utf8') === before

  rmSync(lockPath, { recursive: true, force: true })
  const afterCleanup = updateSettingsForSource('userSettings', {
    env: { AFTER_MISSING_OWNER: 'works' },
  })

  return {
    symlinkError,
    symlinkOwnerUntouched,
    oversizedError,
    missingError,
    missingUnchanged,
    liveRecoveryError,
    liveRecoveryUnchanged,
    afterCleanupError: afterCleanup.error?.message ?? null,
  }
}

function unknownPidScenario(): unknown {
  writeSettings({ env: { BASE: '1' } })
  const targetPath = resolveSettingsFileTarget(settingsPath)
  const lockPath = `${targetPath}.lock`
  const ownerPath = join(lockPath, 'owner.json')
  const before = readFileSync(settingsPath, 'utf8')

  mkdirSync(lockPath)
  writeFileSync(
    ownerPath,
    JSON.stringify(
      createCurrentSettingsLockOwner(INVALID_PROCESS_PID, 'unknown-pid'),
    ),
    'utf8',
  )
  const blocked = updateSettingsForSource('userSettings', {
    env: { UNKNOWN_PID_MUST_NOT_LAND: 'true' },
  })

  return {
    error: blocked.error?.message ?? null,
    lockExists: existsSync(lockPath),
    unchanged: readFileSync(settingsPath, 'utf8') === before,
  }
}

function writeFailureScenario(): unknown {
  writeSettings({ env: { BASE: '1' } })
  const originalFs = getFsImplementation()
  setFsImplementation({
    ...originalFs,
    statSync(path) {
      if (path === settingsPath) {
        const error = new Error(
          'simulated settings stat failure',
        ) as Error & { code: string }
        error.code = 'EACCES'
        throw error
      }
      return originalFs.statSync(path)
    },
  })

  const first = updateSettingsForSource('userSettings', {
    env: { FIRST: 'blocked' },
  })
  setOriginalFsImplementation()
  const second = updateSettingsForSource('userSettings', {
    env: { SECOND: 'landed' },
  })
  const lockPath = `${resolveSettingsFileTarget(settingsPath)}.lock`

  return {
    firstError: first.error?.message ?? null,
    secondError: second.error?.message ?? null,
    lockExists: existsSync(lockPath),
    final: readSettings(),
  }
}

const individualScenarios: Record<string, () => unknown> = {
  'abandoned-ownerless-lock': abandonedOwnerlessLockScenario,
  cache: cacheScenario,
  dangling: danglingAliasScenario,
  dead: deadOwnerScenario,
  live: liveLockScenario,
  'legacy-owner': legacyOwnerScenario,
  'long-dangling': longDanglingChainScenario,
  'long-recovery-quarantine-name': longRecoveryQuarantineNameScenario,
  malformed: malformedScenario,
  metadata: ownerMetadataScenario,
  'orphaned-recovery-claim': orphanedRecoveryClaimScenario,
  'pid-one': pidOneScenario,
  'prior-boot-owner': priorBootOwnerScenario,
  'separator-recovery-token': separatorRecoveryTokenScenario,
  semantics: semanticsScenario,
  'successor-during-release': successorDuringReleaseScenario,
  'foreign-runtime-owner': foreignRuntimeOwnerScenario,
  'unknown-pid': unknownPidScenario,
  'write-failure': writeFailureScenario,
}

function resetScenarioState(): void {
  setOriginalFsImplementation()
  resetSettingsCache()
  clearInternalWrites()
  rmSync(configDir, { recursive: true, force: true })
  mkdirSync(configDir)
}

function allScenarios(): Record<string, unknown> {
  const results: Record<string, unknown> = {}
  for (const [name, run] of Object.entries(individualScenarios)) {
    resetScenarioState()
    try {
      results[name] = run()
    } catch (error) {
      results[name] = {
        scenarioError: error instanceof Error ? error.stack : String(error),
      }
    }
  }
  return results
}

const scenarios: Record<string, () => unknown> = {
  ...individualScenarios,
  all: allScenarios,
}

try {
  const run = scenario ? scenarios[scenario] : undefined
  if (!run) {
    throw new Error(`Unknown settings transaction scenario: ${scenario}`)
  }
  process.stdout.write(JSON.stringify({ ok: true, value: run() }))
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.stack : String(error),
    }),
  )
  process.exitCode = 1
} finally {
  setOriginalFsImplementation()
  resetSettingsCache()
  clearInternalWrites()
  rmSync(configDir, { recursive: true, force: true })
}
