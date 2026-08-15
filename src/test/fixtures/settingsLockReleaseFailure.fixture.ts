import { mock } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as lockfile from '../../utils/lockfile.js'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'
import {
  getFsImplementation,
  setFsImplementation,
  setOriginalFsImplementation,
} from '../../utils/fsOperations.js'

const mode = process.argv[2]
const writer = process.argv[3] ?? 'update'
if (mode !== 'acquisition' && mode !== 'release') {
  process.stderr.write('usage: <acquisition|release>\n')
  process.exit(2)
}
if (writer !== 'update' && writer !== 'replace' && writer !== 'public') {
  process.stderr.write(
    'usage: <acquisition|release> <update|replace|public>\n',
  )
  process.exit(2)
}

const configDir = realpathSync(
  mkdtempSync(join(tmpdir(), 'openclaude-settings-release-failure-')),
)
const settingsPath = join(configDir, 'settings.json')
let lockPath: string | null = null
let active = false
let releaseCalls = 0

setClaudeConfigHomeDirForTesting(configDir)
getClaudeConfigHomeDir.cache?.clear?.()
writeFileSync(settingsPath, '{}\n', 'utf8')

mock.module('../../utils/lockfile.js', () => ({
  ...lockfile,
  lockSync(_file: string, options?: { lockfilePath?: string }) {
    if (!options?.lockfilePath) throw new Error('Missing settings lock path')
    lockPath = options.lockfilePath
    if (active || existsSync(lockPath)) {
      throw Object.assign(new Error('Lock file is already being held'), {
        code: 'ELOCKED',
      })
    }
    active = true
    mkdirSync(lockPath)
    return () => {
      active = false
      releaseCalls++
    }
  },
}))

const originalFs = getFsImplementation()
let lockIdentityReads = 0
setFsImplementation({
  ...originalFs,
  lstatSync(path) {
    const stats = originalFs.lstatSync(path)
    if (
      mode === 'acquisition' &&
      lockPath &&
      resolve(path) === resolve(lockPath)
    ) {
      lockIdentityReads++
      if (lockIdentityReads === 2) {
        return new Proxy(stats, {
          get(target, property) {
            return property === 'ino'
              ? target.ino + 1
              : Reflect.get(target, property, target)
          },
        })
      }
    }
    return stats
  },
  renameSync(oldPath, newPath) {
    if (lockPath && resolve(oldPath) === resolve(lockPath)) {
      throw Object.assign(new Error(`injected ${mode} quarantine failure`), {
        code: 'EIO',
      })
    }
    return originalFs.renameSync(oldPath, newPath)
  },
})

const { updateSettingsForSource, updateSettingsForSourceWithResult } =
  await import('../../utils/settings/settings.js')
const { replaceSettingsFileSync } = await import(
  '../../utils/settings/settingsFileLock.js'
)
const writeSetting = (key: string, value: string) => {
  if (writer === 'replace') {
    return replaceSettingsFileSync(
      settingsPath,
      `${JSON.stringify({ env: { [key]: value } }, null, 2)}\n`,
    )
  }
  const settings = { env: { [key]: value } }
  if (writer === 'update') {
    return updateSettingsForSourceWithResult('userSettings', settings)
  }
  const result = updateSettingsForSource('userSettings', settings)
  const bytesOnDisk = readFileSync(settingsPath, 'utf8').includes(key)
  return {
    status: result.error ? 'rejected' : 'committed',
    bytesOnDisk,
    committed: result.error === null,
    cacheInvalidated: bytesOnDisk,
    sessionNotified: false,
    error: result.error,
  } as const
}
try {
  const first = writeSetting('FIRST_ATTEMPT', mode)
  const firstWriteLanded = readFileSync(settingsPath, 'utf8').includes(
    'FIRST_ATTEMPT',
  )

  setOriginalFsImplementation()
  const retry = writeSetting('RETRY_AFTER_RELEASE', mode)

  const output = {
    firstError: first.error?.message ?? null,
    firstWritten: first.bytesOnDisk,
    firstWriteLanded,
    firstResult: {
      status: first.status,
      bytesOnDisk: first.bytesOnDisk,
      committed: first.committed,
      cacheInvalidated: first.cacheInvalidated,
      sessionNotified: first.sessionNotified,
      error: first.error !== null,
    },
    retryError: retry.error?.message ?? null,
    releaseCalls,
    ownerLeftBehind:
      lockPath !== null && existsSync(join(lockPath, 'owner.json')),
  }
  process.stdout.write(JSON.stringify(output))
} finally {
  setOriginalFsImplementation()
  rmSync(configDir, { recursive: true, force: true })
}
