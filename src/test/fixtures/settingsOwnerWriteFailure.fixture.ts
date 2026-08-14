import { mock } from 'bun:test'
import * as fs from 'fs'
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'

const configDir = realpathSync(
  mkdtempSync(join(tmpdir(), 'openclaude-owner-write-failure-')),
)
const settingsPath = join(configDir, 'settings.json')
const realWriteFileSync = fs.writeFileSync
let failedOwnerWrite = false
const failureMode = process.argv[2] === 'empty' ? 'empty' : 'partial'

mock.module('fs', () => ({
  ...fs,
  writeFileSync(path: unknown, data: unknown, options?: unknown): void {
    if (
      !failedOwnerWrite &&
      typeof path === 'string' &&
      basename(path) === 'owner.json'
    ) {
      failedOwnerWrite = true
      if (failureMode === 'partial') {
        ;(realWriteFileSync as Function)(path, '{"pid":', {
          encoding: 'utf8',
          flag: 'wx',
        })
      }
      const error = new Error(`injected ${failureMode} owner write`) as Error & {
        code: string
      }
      error.code = 'EIO'
      throw error
    }
    ;(realWriteFileSync as Function)(path, data, options)
  },
}))

try {
  setClaudeConfigHomeDirForTesting(configDir)
  getClaudeConfigHomeDir.cache?.clear?.()
  const settingsModule = await import('../../utils/settings/settings.js')
  const lockModule = await import('../../utils/settings/settingsFileLock.js')
  const lockPath = lockModule.getSettingsFileLockPath(
    lockModule.resolveSettingsFileTarget(settingsPath),
  )

  const first = settingsModule.updateSettingsForSource('userSettings', {
    env: { FIRST: 'rejected' },
  })
  const lockAbsentAfterFailure = !fs.existsSync(lockPath)
  const abortedQuarantineAbsent = readdirSync(configDir).every(
    name => !name.startsWith('.openclaude-settings-aborted-'),
  )
  const second = settingsModule.updateSettingsForSource('userSettings', {
    env: { SECOND: 'committed' },
  })

  process.stdout.write(
    JSON.stringify({
      firstError: first.error?.message ?? null,
      firstCommitted: first.error === null,
      lockAbsentAfterFailure,
      abortedQuarantineAbsent,
      secondError: second.error?.message ?? null,
      secondCommitted: second.error === null,
      settings: settingsModule.getSettingsForSource('userSettings'),
    }),
  )
} finally {
  rmSync(configDir, { recursive: true, force: true })
}
