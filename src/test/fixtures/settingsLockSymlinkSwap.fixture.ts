import { mock } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as lockfile from '../../utils/lockfile.js'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'

if (process.platform === 'win32') {
  process.stdout.write(JSON.stringify({ skipped: true }))
  process.exit(0)
}

const configDir = realpathSync(
  mkdtempSync(join(tmpdir(), 'openclaude-settings-lock-swap-')),
)
const settingsPath = join(configDir, 'settings.json')
const lockPath = `${settingsPath}.lock`
const foreignDir = join(configDir, 'foreign')
const foreignOwnerPath = join(foreignDir, 'owner.json')

setClaudeConfigHomeDirForTesting(configDir)
getClaudeConfigHomeDir.cache?.clear?.()
writeFileSync(settingsPath, '{}\n', 'utf8')
mkdirSync(foreignDir)
writeFileSync(
  foreignOwnerPath,
  JSON.stringify({ pid: process.pid, token: 'foreign-owner' }),
  'utf8',
)

mock.module('../../utils/lockfile.js', () => ({
  ...lockfile,
  lockSync(_file: string, options?: { lockfilePath?: string }) {
    symlinkSync(foreignDir, options?.lockfilePath ?? lockPath, 'dir')
    return () => {}
  },
}))

const { updateSettingsForSource } = await import(
  '../../utils/settings/settings.js'
)
updateSettingsForSource('userSettings', { env: { MUST_NOT_LAND: 'true' } })

process.stdout.write(
  JSON.stringify({
    skipped: false,
    foreignOwnerExists: existsSync(foreignOwnerPath),
  }),
)
