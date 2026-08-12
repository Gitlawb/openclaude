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
if (mode !== 'acquisition' && mode !== 'release') {
  process.stderr.write('usage: <acquisition|release>\n')
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

const { updateSettingsForSourceWithResult } = await import(
  '../../utils/settings/settings.js'
)
try {
  const first = updateSettingsForSourceWithResult('userSettings', {
    env: { FIRST_ATTEMPT: mode },
  })

  setOriginalFsImplementation()
  const retry = updateSettingsForSourceWithResult('userSettings', {
    env: { RETRY_AFTER_RELEASE: mode },
  })

  const output = {
    firstError: first.error?.message ?? null,
    firstWritten: first.written,
    firstWriteLanded: readFileSync(settingsPath, 'utf8').includes('FIRST_ATTEMPT'),
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
