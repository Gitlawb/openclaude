import { mock } from 'bun:test'
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
const foreignDir = join(configDir, 'foreign')
const foreignOwnerPath = join(foreignDir, 'owner.json')

setClaudeConfigHomeDirForTesting(configDir)
getClaudeConfigHomeDir.cache?.clear?.()
const original = '{}\n'
writeFileSync(settingsPath, original, 'utf8')
mkdirSync(foreignDir)
writeFileSync(
  foreignOwnerPath,
  JSON.stringify({ pid: process.pid, token: 'foreign-owner' }),
  'utf8',
)

mock.module('../../utils/lockfile.js', () => ({
  ...lockfile,
  lockSync(_file: string, options?: { lockfilePath?: string }) {
    if (!options?.lockfilePath) throw new Error('Missing settings lock path')
    symlinkSync(foreignDir, options.lockfilePath, 'dir')
    return () => {}
  },
}))

const { updateSettingsForSource } = await import(
  '../../utils/settings/settings.js'
)
let error: string | null = null
try {
  const result = updateSettingsForSource('userSettings', {
    env: { MUST_NOT_LAND: 'true' },
  })
  error = result.error?.message ?? null
} catch (cause) {
  error = String(cause)
}

const output = {
  skipped: false,
  error,
  foreignOwnerExists: existsSync(foreignOwnerPath),
  settingsUnchanged: readFileSync(settingsPath, 'utf8') === original,
}
rmSync(configDir, { recursive: true, force: true })

process.stdout.write(JSON.stringify(output))
