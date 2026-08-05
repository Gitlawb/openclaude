import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'
import {
  getFsImplementation,
  setFsImplementation,
} from '../../utils/fsOperations.js'

const [configDir, targetPath, envKey, readMarker, releaseMarker] =
  process.argv.slice(2)

if (!configDir || !targetPath || !envKey || !readMarker || !releaseMarker) {
  process.stderr.write(
    'usage: <config-dir> <target-path> <env-key> <read-marker> <release-marker>\n',
  )
  process.exit(2)
}

setClaudeConfigHomeDirForTesting(configDir)
getClaudeConfigHomeDir.cache?.clear?.()

const originalFs = getFsImplementation()
const normalizedTarget = resolve(targetPath)
let markedRead = false

setFsImplementation({
  ...originalFs,
  readFileSync(path, options) {
    const content = originalFs.readFileSync(path, options)
    if (!markedRead && resolve(path) === normalizedTarget) {
      markedRead = true
      writeFileSync(readMarker, 'ready', 'utf8')

      if (releaseMarker !== '-') {
        const waitView = new Int32Array(new SharedArrayBuffer(4))
        const deadline = Date.now() + 10_000
        while (!existsSync(releaseMarker)) {
          if (Date.now() >= deadline) {
            throw new Error('timed out waiting to release settings read')
          }
          Atomics.wait(waitView, 0, 0, 10)
        }
      }
    }
    return content
  },
})

const { updateSettingsForSource } = await import(
  '../../utils/settings/settings.js'
)
const result = updateSettingsForSource('userSettings', {
  env: { [envKey]: 'true' },
})

process.stdout.write(
  JSON.stringify({
    ok: result.error === null,
    error: result.error?.message,
  }),
)
