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
import { SYNC_KEYS } from '../../services/settingsSync/types.js'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'
import {
  getFsImplementation,
  setFsImplementation,
  setOriginalFsImplementation,
} from '../../utils/fsOperations.js'

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

try {
  setClaudeConfigHomeDirForTesting(configDir)
  getClaudeConfigHomeDir.cache?.clear?.()
  writeFileSync(originalTarget, original, 'utf8')
  writeFileSync(replacementTarget, replacement, 'utf8')
  symlinkSync(originalTarget, settingsPath)

  const originalFs = getFsImplementation()
  let retargeted = false
  setFsImplementation({
    ...originalFs,
    renameSync(oldPath, newPath) {
      originalFs.renameSync(oldPath, newPath)
      if (!retargeted && newPath === originalTarget) {
        retargeted = true
        unlinkSync(settingsPath)
        symlinkSync(replacementTarget, settingsPath)
      }
    },
  })

  const { __test: settingsSyncTest } = await import(
    '../../services/settingsSync/index.js'
  )
  const applyResult = await settingsSyncTest.applyRemoteEntriesToLocal(
    {
      [SYNC_KEYS.USER_SETTINGS]: `${JSON.stringify({ env: { REMOTE: '1' } })}\n`,
    },
    null,
  )
  const applied =
    applyResult.settingsSourcesWritten.includes('userSettings')

  process.stdout.write(
    JSON.stringify({
      skipped: false,
      applied,
      physicalWriteLanded:
        readFileSync(originalTarget, 'utf8') !== original,
      logicalTargetUnchanged:
        readFileSync(replacementTarget, 'utf8') === replacement,
    }),
  )
} finally {
  setOriginalFsImplementation()
  rmSync(configDir, { recursive: true, force: true })
}
