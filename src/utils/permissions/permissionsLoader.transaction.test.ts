import { afterAll, expect, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { settingsWriteResult } from '../../test/settingsWriteResult.js'
import {
  SETTINGS_UPDATE_NO_CHANGE,
  type SettingsWriteResult,
} from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'
import {
  addPermissionRulesToSettings,
  deletePermissionRuleFromSettings,
} from './permissionsLoader.js'

await acquireSharedMutationLock(
  'utils/permissions/permissionsLoader.transaction.test.ts',
)

let diskSettings: SettingsJson = {
  permissions: { allow: ['Read(base)', 'Read(concurrent)'] },
}
let writeResult: SettingsWriteResult = settingsWriteResult({ written: true })
let appliedPatchCount = 0

function applyPatch(patch: SettingsJson): void {
  appliedPatchCount += 1
  diskSettings = {
    ...diskSettings,
    ...patch,
    permissions: {
      ...diskSettings.permissions,
      ...patch.permissions,
    },
  }
}

const dependencies = {
  shouldAllowManagedRulesOnly: () => false,
  updateFreshSettingsOrNoop: (
    _source: string,
    createPatch: (
      settings: SettingsJson,
    ) => SettingsJson | typeof SETTINGS_UPDATE_NO_CHANGE,
  ) => {
    if (!writeResult.written) return writeResult
    const patch = createPatch(structuredClone(diskSettings))
    if (patch === SETTINGS_UPDATE_NO_CHANGE) {
      if (writeResult.unchanged) return writeResult
      return settingsWriteResult({ written: false, unchanged: true })
    }
    applyPatch(patch)
    return writeResult
  },
}

afterAll(() => {
  releaseSharedMutationLock()
})

test('permission additions are computed from the lock-scoped settings snapshot', () => {
  expect(
    addPermissionRulesToSettings(
      {
        ruleValues: [{ toolName: 'Read', ruleContent: 'requested' }],
        ruleBehavior: 'allow',
      },
      'userSettings',
      dependencies,
    ),
  ).toBe(true)
  expect(diskSettings.permissions?.allow).toEqual([
    'Read(base)',
    'Read(concurrent)',
    'Read(requested)',
  ])
})

test('an uncommitted write reports failure and leaves permission rules unchanged', () => {
  const before = structuredClone(diskSettings.permissions?.allow ?? [])
  writeResult = settingsWriteResult({ written: false })

  try {
    expect(
      addPermissionRulesToSettings(
        {
          ruleValues: [{ toolName: 'Read', ruleContent: 'dropped' }],
          ruleBehavior: 'allow',
        },
        'userSettings',
        dependencies,
      ),
    ).toBe(false)
    expect(diskSettings.permissions?.allow).toEqual(before)
  } finally {
    writeResult = settingsWriteResult({ written: true })
  }
})

test('an already-present permission is a successful lock-scoped no-op', () => {
  const patchCountBefore = appliedPatchCount

  expect(
    addPermissionRulesToSettings(
      {
        ruleValues: [{ toolName: 'Read', ruleContent: 'concurrent' }],
        ruleBehavior: 'allow',
      },
      'userSettings',
      dependencies,
    ),
  ).toBe(true)
  expect(appliedPatchCount).toBe(patchCountBefore)
})

test('a no-op with a transaction error is not accepted as persisted', () => {
  writeResult = settingsWriteResult({
    error: new Error('settings target changed during release'),
    written: true,
    committed: false,
    unchanged: true,
  })

  try {
    expect(
      addPermissionRulesToSettings(
        {
          ruleValues: [{ toolName: 'Read', ruleContent: 'concurrent' }],
          ruleBehavior: 'allow',
        },
        'userSettings',
        dependencies,
      ),
    ).toBe(false)
  } finally {
    writeResult = settingsWriteResult({ written: true })
  }
})

test('a concurrent permission deletion is a lock-scoped no-op', () => {
  let writerInvoked = false
  let capturedPatch: unknown
  expect(
    deletePermissionRuleFromSettings(
      {
        source: 'userSettings',
        ruleBehavior: 'allow',
        ruleValue: { toolName: 'Read', ruleContent: 'base' },
      },
      {
        getSettings: () => ({ permissions: { allow: ['Read(base)'] } }),
        updateFreshSettingsOrNoop: (_source, createPatch) => {
          writerInvoked = true
          capturedPatch = createPatch({ permissions: { allow: [] } })
          return settingsWriteResult({ written: false, unchanged: true })
        },
      },
    ),
  ).toBe(false)
  expect(writerInvoked).toBe(true)
  expect(capturedPatch).toBe(SETTINGS_UPDATE_NO_CHANGE)
})

test('managed-rules-only policy rejects additions before writing', () => {
  let writeCalled = false
  expect(
    addPermissionRulesToSettings(
      {
        ruleValues: [{ toolName: 'Read', ruleContent: 'managed' }],
        ruleBehavior: 'allow',
      },
      'userSettings',
      {
        shouldAllowManagedRulesOnly: () => true,
        updateFreshSettingsOrNoop: () => {
          writeCalled = true
          return settingsWriteResult({ written: true })
        },
      },
    ),
  ).toBe(false)
  expect(writeCalled).toBe(false)
})
