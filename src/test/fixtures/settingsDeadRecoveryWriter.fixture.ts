import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'
import {
  getFsImplementation,
  setFsImplementation,
} from '../../utils/fsOperations.js'

const [configDir, targetPath, envKey, mode, marker, releaseMarker] =
  process.argv.slice(2)

if (
  !configDir ||
  !targetPath ||
  !envKey ||
  !mode ||
  !marker ||
  !releaseMarker
) {
  process.stderr.write(
    'usage: <config-dir> <target-path> <env-key> <mode> <marker> <release-marker>\n',
  )
  process.exit(2)
}

setClaudeConfigHomeDirForTesting(configDir)
getClaudeConfigHomeDir.cache?.clear?.()

const originalFs = getFsImplementation()
const normalizedTarget = resolve(targetPath)
const ownerPath = join(`${normalizedTarget}.lock`, 'owner.json')
let paused = false

function pauseAtBarrier(): void {
  paused = true
  writeFileSync(marker, 'ready', 'utf8')
  const waitView = new Int32Array(new SharedArrayBuffer(4))
  const deadline = Date.now() + 10_000
  while (!originalFs.existsSync(releaseMarker)) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting to release ${mode}`)
    }
    Atomics.wait(waitView, 0, 0, 10)
  }
}

setFsImplementation({
  ...originalFs,
  statSync(path) {
    const stats = originalFs.statSync(path)
    if (
      !paused &&
      mode === 'pause-write-stat' &&
      resolve(path) === normalizedTarget
    ) {
      pauseAtBarrier()
    }
    return stats
  },
  unlinkSync(path) {
    if (
      !paused &&
      mode === 'pause-owner-unlink' &&
      resolve(path) === ownerPath
    ) {
      pauseAtBarrier()
    }
    return originalFs.unlinkSync(path)
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
