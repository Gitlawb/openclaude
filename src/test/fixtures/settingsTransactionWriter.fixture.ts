import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import {
  getFsImplementation,
  setFsImplementation,
} from '../../utils/fsOperations.js'

const [
  role,
  target,
  key,
  value,
  enteredMarker,
  completedMarker,
  readMarker,
  releaseMarker,
] = process.argv.slice(2)

const supportedRoles: ReadonlySet<string> = new Set([
  'normal',
  'hold-lock',
  'hold-path-for',
  'pause-after-read',
])

if (!role || !supportedRoles.has(role)) {
  throw new Error(`Invalid settings transaction fixture role: ${role}`)
}

if (
  !target ||
  !key ||
  !value ||
  !enteredMarker ||
  !completedMarker
) {
  throw new Error('Missing settings transaction fixture arguments')
}

if (role !== 'hold-path-for') {
  process.env.OPENCLAUDE_CONFIG_DIR = target
}
const settingsPath =
  role === 'hold-path-for'
    ? resolve(target)
    : resolve(target, 'settings.json')
const settingsParentPath = dirname(settingsPath)
const settingsReadPath = existsSync(settingsPath)
  ? realpathSync(settingsPath)
  : existsSync(settingsParentPath)
    ? join(realpathSync(settingsParentPath), basename(settingsPath))
    : settingsPath
const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

function waitForMarker(marker: string): void {
  const deadline = performance.now() + 15_000
  while (!existsSync(marker)) {
    if (performance.now() >= deadline) {
      throw new Error(`Timed out waiting for fixture marker: ${marker}`)
    }
    Atomics.wait(waitBuffer, 0, 0, 10)
  }
}

if (role === 'pause-after-read') {
  if (!readMarker || !releaseMarker) {
    throw new Error('Pause-after-read fixture requires read and release markers')
  }
  const originalFs = getFsImplementation()
  let paused = false
  setFsImplementation({
    ...originalFs,
    readFileSync(path, options) {
      const content = originalFs.readFileSync(path, options)
      if (!paused && resolve(path) === settingsReadPath) {
        paused = true
        writeFileSync(readMarker, '')
        waitForMarker(releaseMarker)
      }
      return content
    },
  })
}

if (role === 'hold-lock' || role === 'hold-path-for') {
  const { withSettingsFileTransactionSync } = await import(
    '../../utils/settings/settingsFileTransaction.js'
  )
  withSettingsFileTransactionSync(settingsPath, () => {
    writeFileSync(enteredMarker, '')
    if (role === 'hold-path-for') {
      const holdMs = Number(value)
      if (!Number.isFinite(holdMs) || holdMs < 0) {
        throw new Error(`Invalid hold duration: ${value}`)
      }
      Atomics.wait(waitBuffer, 0, 0, holdMs)
    } else {
      if (!releaseMarker) {
        throw new Error('Hold-lock fixture requires a release marker')
      }
      waitForMarker(releaseMarker)
    }
  })
  writeFileSync(completedMarker, '')
  process.stdout.write(`${JSON.stringify({ ok: true })}\n`)
} else {
  const { updateSettingsForSource } = await import(
    '../../utils/settings/settings.js'
  )
  writeFileSync(enteredMarker, '')
  const result = updateSettingsForSource('userSettings', {
    env: { [key]: value },
  })
  writeFileSync(completedMarker, '')
  process.stdout.write(
    `${JSON.stringify({
      ok: result.error === null,
      error: result.error?.message,
    })}\n`,
  )
}
