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

  let applyPromise:
    | ReturnType<typeof settingsSyncTest.applyRemoteEntriesToLocal>
    | undefined
  withSettingsFileLockSync(settingsPath, () => {
    // An async function runs synchronously until its first await. This call is
    // intentionally started under the lock so the settings write contends;
    // moving that write past an await makes the assertions below fail.
    applyPromise = settingsSyncTest.applyRemoteEntriesToLocal(
      {
        [SYNC_KEYS.USER_SETTINGS]: `${JSON.stringify({ env: { REMOTE: '1' } })}\n`,
      },
      null,
    )
  })

  if (!applyPromise) throw new Error('Settings sync did not start')
  const result = await applyPromise
  process.stdout.write(
    JSON.stringify({
      result,
      unchanged: readFileSync(settingsPath, 'utf8') === original,
    }),
  )
} finally {
  rmSync(configDir, { recursive: true, force: true })
}
