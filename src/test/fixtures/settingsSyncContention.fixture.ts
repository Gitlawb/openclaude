import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'
import { __test as settingsSyncTest } from '../../services/settingsSync/index.js'
import { SYNC_KEYS } from '../../services/settingsSync/types.js'
import { withSettingsFileLockSync } from '../../utils/settings/settingsFileLock.js'

const configDir = realpathSync(
  mkdtempSync(join(tmpdir(), 'openclaude-settings-sync-lock-')),
)
const settingsPath = join(configDir, 'settings.json')
const original = `${JSON.stringify({ env: { BASE: '1' } }, null, 2)}\n`

try {
  setClaudeConfigHomeDirForTesting(configDir)
  getClaudeConfigHomeDir.cache?.clear?.()
  writeFileSync(settingsPath, original, 'utf8')

  let applyPromise: Promise<boolean> | undefined
  withSettingsFileLockSync(settingsPath, () => {
    applyPromise = settingsSyncTest.applyRemoteEntriesToLocal(
      {
        [SYNC_KEYS.USER_SETTINGS]: `${JSON.stringify({ env: { REMOTE: '1' } })}\n`,
      },
      null,
    )
  })

  const applied = await applyPromise
  process.stdout.write(
    JSON.stringify({
      applied,
      unchanged: readFileSync(settingsPath, 'utf8') === original,
    }),
  )
} finally {
  rmSync(configDir, { recursive: true, force: true })
}
