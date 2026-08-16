import {
  mkdtempSync,
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

const root = realpathSync(
  mkdtempSync(join(tmpdir(), 'openclaude-settings-sync-unapplied-')),
)
const configPath = join(root, 'config-is-a-file')

try {
  writeFileSync(configPath, 'not a directory', 'utf8')
  setClaudeConfigHomeDirForTesting(configPath)
  getClaudeConfigHomeDir.cache?.clear?.()

  const { __test } = await import('../../services/settingsSync/index.js')
  const { SYNC_KEYS } = await import('../../services/settingsSync/types.js')
  const oversized = await __test.applyRemoteEntriesToLocal(
    { [SYNC_KEYS.USER_SETTINGS]: 'x'.repeat(500 * 1024 + 1) },
    null,
  )
  const memoryFailure = await __test.applyRemoteEntriesToLocal(
    { [SYNC_KEYS.USER_MEMORY]: 'memory' },
    null,
  )

  process.stdout.write(JSON.stringify({ oversized, memoryFailure }))
} finally {
  rmSync(root, { recursive: true, force: true })
}
