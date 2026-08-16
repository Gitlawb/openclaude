import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  buildPermissionUpdates,
  buildPlanApprovalOptions,
  getDangerousPlanExitMode,
  persistPlanFileBeforeExit,
} from './ExitPlanModePermissionRequest.tsx'

describe('getDangerousPlanExitMode', () => {
  test('restores fullAccess when plan mode was entered from fullAccess', () => {
    expect(
      getDangerousPlanExitMode({
        isBypassPermissionsModeAvailable: true,
        prePlanMode: 'fullAccess',
      }),
    ).toBe('fullAccess')
  })

  test('falls back to bypassPermissions for other dangerous sessions', () => {
    expect(
      getDangerousPlanExitMode({
        isBypassPermissionsModeAvailable: true,
        prePlanMode: 'bypassPermissions',
      }),
    ).toBe('bypassPermissions')
  })

  test('returns null when dangerous modes are unavailable', () => {
    expect(
      getDangerousPlanExitMode({
        isBypassPermissionsModeAvailable: false,
        prePlanMode: 'fullAccess',
      }),
    ).toBeNull()
  })
})

describe('buildPlanApprovalOptions', () => {
  test('labels fullAccess plan exits explicitly', () => {
    const options = buildPlanApprovalOptions({
      showClearContext: true,
      showUltraplan: false,
      usedPercent: 42,
      isAutoModeAvailable: false,
      dangerousPlanExitMode: 'fullAccess',
      planAuthorName: 'OpenClaude',
      onFeedbackChange: () => {},
    })

    expect(options[0]).toMatchObject({
      label: 'Yes, clear context (42% used) and full access',
      value: 'yes-full-access',
    })
    expect(options[1]).toMatchObject({
      label: 'Yes, and full access',
      value: 'yes-full-access-keep-context',
    })
  })

  test('adds fullAccess as an additional dangerous plan exit when bypass is primary', () => {
    const options = buildPlanApprovalOptions({
      showClearContext: true,
      showUltraplan: false,
      usedPercent: 42,
      isAutoModeAvailable: false,
      dangerousPlanExitMode: 'bypassPermissions',
      planAuthorName: 'OpenClaude',
      onFeedbackChange: () => {},
    })

    expect(options.map(option => option.value)).toEqual([
      'yes-bypass-permissions',
      'yes-full-access',
      'yes-bypass-permissions-keep-context',
      'yes-full-access-keep-context',
      'yes-default-keep-context',
      'no',
    ])
  })
})

describe('buildPermissionUpdates', () => {
  test('preserves fullAccess when building session updates', () => {
    expect(buildPermissionUpdates('fullAccess')).toEqual([
      {
        type: 'setMode',
        mode: 'fullAccess',
        destination: 'session',
      },
    ])
  })
})

// Covers the write-before-permission guard that keeps the user in plan mode
// when the plan file can't be persisted (#1725). Uses real filesystem paths
// instead of a global fs/promises mock so it stays isolated from other tests.
describe('persistPlanFileBeforeExit', () => {
  test('writes the plan and returns true without notifying on success', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-plan-ok-'))
    const planFilePath = join(dir, 'plan.md')
    const notifications: Array<{ key: string }> = []
    try {
      const ok = await persistPlanFileBeforeExit({
        planFilePath,
        currentPlan: '# my plan',
        addNotification: n => notifications.push(n as { key: string }),
      })

      expect(ok).toBe(true)
      expect(notifications).toHaveLength(0)
      expect(await readFile(planFilePath, 'utf-8')).toBe('# my plan')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('returns false and queues a plan-save-error notification on write failure', async () => {
    // Parent directory does not exist → writeFile rejects with ENOENT.
    const planFilePath = join(
      tmpdir(),
      `oc-plan-missing-${Date.now()}-${Math.random()}`,
      'nested',
      'plan.md',
    )
    const notifications: Array<{ key: string; color?: string; priority?: string }> = []

    const ok = await persistPlanFileBeforeExit({
      planFilePath,
      currentPlan: '# my plan',
      addNotification: n => notifications.push(n as { key: string }),
    })

    expect(ok).toBe(false)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.key).toBe('plan-save-error')
    expect(notifications[0]?.color).toBe('warning')
    expect(notifications[0]?.priority).toBe('high')
  })
})
