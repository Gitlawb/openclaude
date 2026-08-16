import { existsSync, writeFileSync } from 'node:fs'

import { withSettingsFileLockSync } from '../../utils/settings/settingsFileLock.js'

const [settingsPath, readyMarker, releaseMarker] = process.argv.slice(2)
if (!settingsPath || !readyMarker || !releaseMarker) {
  throw new Error('usage: <settings-path> <ready-marker> <release-marker>')
}

withSettingsFileLockSync(settingsPath, () => {
  writeFileSync(readyMarker, 'ready', 'utf8')
  const waitView = new Int32Array(new SharedArrayBuffer(4))
  const deadline = Date.now() + 20_000
  while (!existsSync(releaseMarker)) {
    if (Date.now() >= deadline) {
      throw new Error('timed out waiting to release settings lock')
    }
    Atomics.wait(waitView, 0, 0, 10)
  }
})

process.stdout.write(JSON.stringify({ released: true }))
