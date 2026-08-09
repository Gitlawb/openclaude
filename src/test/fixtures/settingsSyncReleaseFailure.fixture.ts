import { mock } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'
import * as settingsFileLock from '../../utils/settings/settingsFileLock.js'

const configDir = realpathSync(
  mkdtempSync(join(tmpdir(), 'openclaude-settings-sync-release-failure-')),
)

mock.module('../../utils/settings/settingsFileLock.js', () => ({
  ...settingsFileLock,
  replaceSettingsFileSync() {
    return {
      written: true,
      error: Object.assign(new Error('injected release failure'), {
        code: 'EIO',
      }),
    }
  },
}))

try {
  setClaudeConfigHomeDirForTesting(configDir)
  getClaudeConfigHomeDir.cache?.clear?.()

  const { __test } = await import('../../services/settingsSync/index.js')
  const { SYNC_KEYS } = await import('../../services/settingsSync/types.js')
  const result = await __test.applyRemoteEntriesToLocal(
    {
      [SYNC_KEYS.USER_SETTINGS]: '{"env":{"REMOTE":"landed"}}\n',
    },
    null,
  )

  process.stdout.write(JSON.stringify(result))
} finally {
  rmSync(configDir, { recursive: true, force: true })
}
