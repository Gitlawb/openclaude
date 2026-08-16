import { mock } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as state from '../../bootstrap/state.js'
import { createWaitForCondition } from '../waitForCondition.js'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'

if (process.platform === 'win32') {
  process.stdout.write(JSON.stringify({ skipped: true }))
  process.exit(0)
}

mock.module('../../bootstrap/state.js', () => ({
  ...state,
  getIsRemoteMode: () => false,
}))

const root = realpathSync(
  mkdtempSync(join(tmpdir(), 'openclaude-settings-symlink-notify-')),
)
const originalCwd = process.cwd()
const originalSettingsCwd = state.getOriginalCwd()
const configDir = join(root, 'config')
const physicalDir = join(root, 'physical')
const logicalPath = join(configDir, 'settings.json')
const projectDir = join(root, '.openclaude')
const projectLogicalPath = join(projectDir, 'settings.json')
const physicalPath = join(physicalDir, 'settings.json')
const retargetDir = join(root, 'retarget')
const retargetPath = join(retargetDir, 'settings.json')
mkdirSync(configDir)
mkdirSync(physicalDir)
mkdirSync(projectDir)
mkdirSync(retargetDir)
symlinkSync(physicalPath, logicalPath, 'file')
symlinkSync(physicalPath, projectLogicalPath, 'file')
process.chdir(root)
state.setOriginalCwd(root)
setClaudeConfigHomeDirForTesting(configDir)
getClaudeConfigHomeDir.cache?.clear?.()

const { settingsChangeDetector } = await import(
  '../../utils/settings/changeDetector.js'
)
await settingsChangeDetector.resetForTesting({
  stabilityThreshold: 20,
  pollInterval: 10,
  settingsDebounce: 20,
})
const notified: string[] = []
const waitForNotification = createWaitForCondition(
  'settings symlink notification',
)
const unsubscribe = settingsChangeDetector.subscribe(source => {
  notified.push(source)
})

async function waitForNotificationQuietPeriod(): Promise<void> {
  const quietPeriodMs = 100
  const timeoutMs = 2_000
  let previousCount = notified.length
  let unchangedSince = Date.now()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await Bun.sleep(10)
    if (notified.length !== previousCount) {
      previousCount = notified.length
      unchangedSince = Date.now()
    } else if (Date.now() - unchangedSince >= quietPeriodMs) {
      return
    }
  }
  throw new Error('Timed out waiting for settings notifications to settle')
}

try {
  await settingsChangeDetector.initialize()
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, 'settingsConcurrentWriter.fixture.ts'),
      configDir,
      physicalPath,
      'PEER_WRITE',
      join(root, 'read-marker'),
      '-',
    ],
    { cwd: process.cwd(), stderr: 'pipe', stdout: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  await waitForNotification(
    () =>
      notified.includes('userSettings') &&
      notified.includes('projectSettings'),
  )

  const peerNotified = [...notified]
  notified.length = 0
  const { updateSettingsForSource } = await import(
    '../../utils/settings/settings.js'
  )
  const internalUpdate = updateSettingsForSource('userSettings', {
    env: { INTERNAL_WRITE: 'true' },
  })
  await waitForNotificationQuietPeriod()
  const internalNotified = [...notified]

  writeFileSync(retargetPath, '{}\n', 'utf8')
  const nextUserLink = join(configDir, 'settings.next.json')
  const nextProjectLink = join(projectDir, 'settings.next.json')
  symlinkSync(retargetPath, nextUserLink, 'file')
  symlinkSync(retargetPath, nextProjectLink, 'file')
  renameSync(nextUserLink, logicalPath)
  renameSync(nextProjectLink, projectLogicalPath)
  await waitForNotification(
    () =>
      notified.includes('userSettings') &&
      notified.includes('projectSettings'),
  )
  notified.length = 0

  const retargetChild = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, 'settingsConcurrentWriter.fixture.ts'),
      configDir,
      retargetPath,
      'RETARGETED_PEER_WRITE',
      join(root, 'retarget-read-marker'),
      '-',
    ],
    { cwd: process.cwd(), stderr: 'pipe', stdout: 'pipe' },
  )
  const [retargetStdout, retargetStderr, retargetExitCode] = await Promise.all([
    new Response(retargetChild.stdout).text(),
    new Response(retargetChild.stderr).text(),
    retargetChild.exited,
  ])
  await waitForNotification(
    () =>
      notified.includes('userSettings') &&
      notified.includes('projectSettings'),
  )
  const retargetNotified = [...notified]

  process.stdout.write(
    JSON.stringify({
      skipped: false,
      exitCode,
      stdout,
      stderr,
      peerNotified,
      internalError: internalUpdate.error?.message ?? null,
      internalNotified,
      retargetExitCode,
      retargetStdout,
      retargetStderr,
      retargetNotified,
    }),
  )
} finally {
  unsubscribe()
  await settingsChangeDetector.dispose()
  state.setOriginalCwd(originalSettingsCwd)
  process.chdir(originalCwd)
  rmSync(root, { recursive: true, force: true })
}
