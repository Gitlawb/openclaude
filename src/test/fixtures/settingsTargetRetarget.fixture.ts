import { mock } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as lockfile from '../../utils/lockfile.js'
import * as fileUtils from '../../utils/file.js'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'

if (process.platform === 'win32') {
  process.stdout.write(JSON.stringify({ skipped: true }))
  process.exit(0)
}

const configDir = realpathSync(
  mkdtempSync(join(tmpdir(), 'openclaude-settings-target-retarget-')),
)
const settingsPath = join(configDir, 'settings.json')
const originalTarget = join(configDir, 'settings-original.json')
const replacementTarget = join(configDir, 'settings-replacement.json')
const original = `${JSON.stringify({ env: { ORIGINAL: '1' } }, null, 2)}\n`
const replacement = `${JSON.stringify({ env: { REPLACEMENT: '1' } }, null, 2)}\n`
const requestedMode = process.argv[2]
const mode =
  requestedMode === 'after-write' || requestedMode === 'physical-before-write'
    ? requestedMode
    : 'before-write'

let output: {
  skipped: false
  error: string | null
  written: boolean
  committed: boolean
  originalUnchanged: boolean
  replacementUnchanged: boolean
} = {
  skipped: false,
  error: 'fixture did not complete',
  written: false,
  committed: false,
  originalUnchanged: false,
  replacementUnchanged: false,
}

try {
  setClaudeConfigHomeDirForTesting(configDir)
  getClaudeConfigHomeDir.cache?.clear?.()
  writeFileSync(originalTarget, original, 'utf8')
  writeFileSync(replacementTarget, replacement, 'utf8')
  symlinkSync(originalTarget, settingsPath)
  const realLockSync = lockfile.lockSync

  if (mode === 'before-write') {
    mock.module('../../utils/lockfile.js', () => ({
      ...lockfile,
      lockSync(file: string, options?: Parameters<typeof lockfile.lockSync>[1]) {
        const release = realLockSync(file, options)
        unlinkSync(settingsPath)
        symlinkSync(replacementTarget, settingsPath)
        return release
      },
    }))
  } else if (mode === 'after-write') {
    const realWrite = fileUtils.writeFileSyncAndFlush_DEPRECATED
    mock.module('../../utils/file.js', () => ({
      ...fileUtils,
      writeFileSyncAndFlush_DEPRECATED(...args: Parameters<typeof realWrite>) {
        realWrite(...args)
        unlinkSync(settingsPath)
        symlinkSync(replacementTarget, settingsPath)
      },
    }))
  } else {
    const realWrite = fileUtils.writeFileSyncAndFlush_DEPRECATED
    mock.module('../../utils/file.js', () => ({
      ...fileUtils,
      writeFileSyncAndFlush_DEPRECATED(...args: Parameters<typeof realWrite>) {
        unlinkSync(originalTarget)
        symlinkSync(replacementTarget, originalTarget)
        realWrite(...args)
      },
    }))
  }

  const { updateSettingsForSource, wasSettingsUpdateCommitted } = await import(
    '../../utils/settings/settings.js'
  )
  const result = updateSettingsForSource('userSettings', {
    env: { MUST_NOT_LAND: 'true' },
  })

  output = {
    skipped: false,
    error: result.error?.message ?? null,
    written: result.written,
    committed: wasSettingsUpdateCommitted(result),
    originalUnchanged: readFileSync(originalTarget, 'utf8') === original,
    replacementUnchanged:
      readFileSync(replacementTarget, 'utf8') === replacement,
  }
} finally {
  rmSync(configDir, { recursive: true, force: true })
}

process.stdout.write(JSON.stringify(output))
