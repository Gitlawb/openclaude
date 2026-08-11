import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as configModule from '../utils/config.js'
import * as settingsModule from '../utils/settings/settings.js'

beforeEach(async () => {
  await acquireSharedMutationLock('migrations/settingsWriteCommit.test.ts')
})

afterEach(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

test('MCP migration preserves legacy fields when the destination write is rejected', async () => {
  spyOn(configModule, 'getCurrentProjectConfig').mockReturnValue({
    enabledMcpjsonServers: ['legacy-server'],
  } as never)
  const saveCurrentProjectConfig = spyOn(
    configModule,
    'saveCurrentProjectConfig',
  ).mockReturnValue(undefined)
  spyOn(
    settingsModule,
    'updateSettingsForSourceWithFreshSettings',
  ).mockReturnValue({ error: new Error('settings locked'), written: false })

  const { migrateEnableAllProjectMcpServersToSettings } = await import(
    `./migrateEnableAllProjectMcpServersToSettings.js?rejected=${Date.now()}`
  )
  migrateEnableAllProjectMcpServersToSettings()

  expect(saveCurrentProjectConfig).not.toHaveBeenCalled()
})

test('MCP migration unions server lists from the lock-scoped fresh settings', async () => {
  spyOn(configModule, 'getCurrentProjectConfig').mockReturnValue({
    enabledMcpjsonServers: ['legacy-server'],
  } as never)
  const saveCurrentProjectConfig = spyOn(
    configModule,
    'saveCurrentProjectConfig',
  ).mockReturnValue(undefined)
  let patch: ReturnType<
    Parameters<
      typeof settingsModule.updateSettingsForSourceWithFreshSettings
    >[1]
  > | undefined
  spyOn(
    settingsModule,
    'updateSettingsForSourceWithFreshSettings',
  ).mockImplementation((_source, createPatch) => {
    patch = createPatch({ enabledMcpjsonServers: ['peer-server'] })
    return { error: null, written: true }
  })

  const { migrateEnableAllProjectMcpServersToSettings } = await import(
    `./migrateEnableAllProjectMcpServersToSettings.js?committed=${Date.now()}`
  )
  migrateEnableAllProjectMcpServersToSettings()

  expect(patch?.enabledMcpjsonServers).toEqual([
    'peer-server',
    'legacy-server',
  ])
  expect(saveCurrentProjectConfig).toHaveBeenCalledTimes(1)
})

test('bypass-permission migration keeps the legacy flag after a rejected write', async () => {
  spyOn(configModule, 'getGlobalConfig').mockReturnValue({
    bypassPermissionsModeAccepted: true,
  } as never)
  const saveGlobalConfig = spyOn(
    configModule,
    'saveGlobalConfig',
  ).mockReturnValue(undefined)
  spyOn(
    settingsModule,
    'hasSkipDangerousModePermissionPrompt',
  ).mockReturnValue(false)
  spyOn(settingsModule, 'updateSettingsForSource').mockReturnValue({
    error: new Error('settings locked'),
    written: false,
  })

  const { migrateBypassPermissionsAcceptedToSettings } = await import(
    `./migrateBypassPermissionsAcceptedToSettings.js?rejected=${Date.now()}`
  )
  migrateBypassPermissionsAcceptedToSettings()

  expect(saveGlobalConfig).not.toHaveBeenCalled()
})
