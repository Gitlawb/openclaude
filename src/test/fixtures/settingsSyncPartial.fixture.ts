import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'

const originalCwd = process.cwd()
const configDir = realpathSync(
  mkdtempSync(join(tmpdir(), 'openclaude-settings-sync-partial-')),
)

try {
  process.chdir(configDir)
  setClaudeConfigHomeDirForTesting(configDir)
  getClaudeConfigHomeDir.cache?.clear?.()

  const { __test } = await import('../../services/settingsSync/index.js')
  const { SYNC_KEYS } = await import('../../services/settingsSync/types.js')
  const {
    getSettingsFilePathForSource,
    getSettingsForSource,
  } = await import('../../utils/settings/settings.js')
  const { withSettingsFileLockSync } = await import(
    '../../utils/settings/settingsFileLock.js'
  )
  const { resetSettingsCache } = await import(
    '../../utils/settings/settingsCache.js'
  )

  const userPath = getSettingsFilePathForSource('userSettings')!
  const localPath = getSettingsFilePathForSource('localSettings')!
  const originalLocal = '{}\n'
  mkdirSync(dirname(localPath), { recursive: true })
  writeFileSync(userPath, '{"env":{"CACHED":"old"}}\n', 'utf8')
  writeFileSync(localPath, originalLocal, 'utf8')
  resetSettingsCache()
  getSettingsForSource('userSettings')

  let applyPromise:
    | ReturnType<typeof __test.applyRemoteEntriesToLocal>
    | undefined
  withSettingsFileLockSync(localPath, () => {
    applyPromise = __test.applyRemoteEntriesToLocal(
      {
        [SYNC_KEYS.USER_SETTINGS]: '{"env":{"REMOTE":"yes"}}\n',
        [SYNC_KEYS.projectSettings('project')]:
          '{"env":{"LOCAL":"blocked"}}\n',
      },
      'project',
    )
  })
  if (!applyPromise) throw new Error('Settings sync did not start')
  const result = await applyPromise

  process.stdout.write(
    JSON.stringify({
      result,
      userLanded: readFileSync(userPath, 'utf8').includes('REMOTE'),
      localUnchanged: readFileSync(localPath, 'utf8') === originalLocal,
      cachedUser: getSettingsForSource('userSettings')?.env?.REMOTE,
    }),
  )
} finally {
  process.chdir(originalCwd)
  rmSync(configDir, { recursive: true, force: true })
}
