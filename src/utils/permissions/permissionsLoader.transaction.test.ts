import { afterAll, expect, mock, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { SettingsJson } from '../settings/types.js'

await acquireSharedMutationLock(
  'utils/permissions/permissionsLoader.transaction.test.ts',
)

const actualSettings = await import(
  `../settings/settings.ts?permissionsTransactionActual=${Date.now()}-${Math.random()}`
)
const staleSettings: SettingsJson = {
  permissions: { allow: ['Read(base)'] },
}
let diskSettings: SettingsJson = {
  permissions: { allow: ['Read(base)', 'Read(concurrent)'] },
}

function applyPatch(patch: SettingsJson): void {
  diskSettings = {
    ...diskSettings,
    ...patch,
    permissions: {
      ...diskSettings.permissions,
      ...patch.permissions,
    },
  }
}

mock.module('../settings/settings.js', () => ({
  ...actualSettings,
  getSettingsForSource: (source: string) =>
    source === 'policySettings' ? {} : structuredClone(staleSettings),
  updateSettingsForSource: (_source: string, patch: SettingsJson) => {
    applyPatch(patch)
    return { error: null, written: true }
  },
  updateSettingsForSourceWithFreshSettings: (
    _source: string,
    createPatch: (settings: SettingsJson) => SettingsJson,
  ) => {
    applyPatch(createPatch(structuredClone(diskSettings)))
    return { error: null, written: true }
  },
}))

afterAll(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

test('permission additions are computed from the lock-scoped settings snapshot', async () => {
  const { addPermissionRulesToSettings } = await import(
    `./permissionsLoader.js?transaction=${Date.now()}-${Math.random()}`
  )

  expect(
    addPermissionRulesToSettings(
      {
        ruleValues: [{ toolName: 'Read', ruleContent: 'requested' }],
        ruleBehavior: 'allow',
      },
      'userSettings',
    ),
  ).toBe(true)
  expect(diskSettings.permissions?.allow).toEqual([
    'Read(base)',
    'Read(concurrent)',
    'Read(requested)',
  ])
})
