import { afterEach, describe, expect, test } from 'bun:test'

import {
  applyPermissionModeChange,
  applyPermissionUpdatesToLiveContext,
  getDangerousPermissionModeTransitionError,
  getEffectiveDefaultPermissionModeFromSettingsSources,
  stripDangerousPermissionsForAutoMode,
} from './permissionSetup.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { requestPermissionModeChange } from './permissionModeChange.js'
import { resetSafetyLevelCache } from './safetyLevel.js'

describe('getEffectiveDefaultPermissionModeFromSettingsSources', () => {
  test('ignores dangerous default modes from shared project settings', () => {
    const mode = getEffectiveDefaultPermissionModeFromSettingsSources([
      {
        source: 'projectSettings',
        settings: {
          permissions: {
            defaultMode: 'fullAccess',
          },
        },
      },
    ])

    expect(mode).toBeUndefined()
  })

  test('still honors dangerous default modes from trusted sources', () => {
    const mode = getEffectiveDefaultPermissionModeFromSettingsSources([
      {
        source: 'projectSettings',
        settings: {
          permissions: {
            defaultMode: 'fullAccess',
          },
        },
      },
      {
        source: 'localSettings',
        settings: {
          permissions: {
            defaultMode: 'fullAccess',
          },
        },
      },
    ])

    expect(mode).toBe('fullAccess')
  })

  test('preserves non-dangerous project default modes', () => {
    const mode = getEffectiveDefaultPermissionModeFromSettingsSources([
      {
        source: 'projectSettings',
        settings: {
          permissions: {
            defaultMode: 'plan',
          },
        },
      },
    ])

    expect(mode).toBe('plan')
  })
})

describe('getDangerousPermissionModeTransitionError', () => {
  test('rejects remote dangerous-mode activation until the user confirms locally', async () => {
    const error = await getDangerousPermissionModeTransitionError({
      mode: 'fullAccess',
      toolPermissionContext: {
        isBypassPermissionsModeAvailable: true,
      },
      deps: {
        getStartupDangerousPermissionPromptState: () => ({
          mode: 'fullAccess',
          shouldShow: true,
        }),
        shouldDisableBypassPermissions: async () => false,
        isBypassPermissionsModeDisabled: () => false,
      },
    })

    expect(error).toBe(
      'Cannot set permission mode to fullAccess until the user explicitly confirms Full Access in a local interactive session',
    )
  })

  test('reports the settings-disabled reason instead of enablement guidance', async () => {
    // Every other call site injects `() => false` to reach the guidance branch,
    // which left the deny branch this dep controls untested: dropping the
    // `deps.isBypassPermissionsModeDisabled()` call would keep the suite green
    // while making a configuration-disabled bypass reachable.
    const error = await getDangerousPermissionModeTransitionError({
      mode: 'bypassPermissions',
      toolPermissionContext: {
        isBypassPermissionsModeAvailable: false,
      },
      requireLocalConfirmation: false,
      deps: {
        getStartupDangerousPermissionPromptState: () => ({
          mode: 'bypassPermissions',
          shouldShow: false,
        }),
        shouldDisableBypassPermissions: async () => false,
        isBypassPermissionsModeDisabled: () => true,
      },
    })

    expect(error).toContain('disabled by settings or configuration')
    // and it must NOT hand out the enablement route while disabled
    expect(error).not.toContain('--yolo')
  })

  test('names both spellings when bypass is not yet enabled (PR #1939)', async () => {
    // The enablement message is the one place a blocked transition tells the
    // user how to unblock it, so it has to mention the alias as well as the
    // canonical flag — otherwise `--yolo` is undiscoverable from the error.
    const error = await getDangerousPermissionModeTransitionError({
      mode: 'bypassPermissions',
      toolPermissionContext: {
        isBypassPermissionsModeAvailable: false,
      },
      requireLocalConfirmation: false,
      deps: {
        getStartupDangerousPermissionPromptState: () => ({
          mode: 'bypassPermissions',
          shouldShow: false,
        }),
        shouldDisableBypassPermissions: async () => false,
        isBypassPermissionsModeDisabled: () => false,
      },
    })

    // Deterministic: the resolver consults isBypassPermissionsModeDisabled()
    // BEFORE this branch and it reads settings plus the Statsig gate, so on a
    // machine configured that way the guidance was never reached and the
    // assertions silently skipped. It is injected above instead of branching on
    // ambient state — and module mocking was not an option here, since bun's
    // mock.module is process-wide and broke 84 tests elsewhere in this suite.
    expect(error).toContain('--dangerously-skip-permissions (alias --yolo)')
    expect(error).toContain('--allow-dangerously-skip-permissions')
    expect(error).toContain('permissions.allowBypassPermissionsMode')

    // …and the same guidance is given for fullAccess, which the flag also
    // unblocks (it sets the shared isBypassPermissionsModeAvailable bit).
    const fullAccessError = await getDangerousPermissionModeTransitionError({
      mode: 'fullAccess',
      toolPermissionContext: {
        isBypassPermissionsModeAvailable: false,
      },
      requireLocalConfirmation: false,
      deps: {
        getStartupDangerousPermissionPromptState: () => ({
          mode: 'fullAccess',
          shouldShow: false,
        }),
        shouldDisableBypassPermissions: async () => false,
        isBypassPermissionsModeDisabled: () => false,
      },
    })
    expect(fullAccessError).toContain('--yolo')
  })

  test('uses the authoritative org gate for later dangerous-mode entry', async () => {
    const error = await getDangerousPermissionModeTransitionError({
      mode: 'bypassPermissions',
      toolPermissionContext: {
        isBypassPermissionsModeAvailable: true,
      },
      deps: {
        getStartupDangerousPermissionPromptState: () => ({
          mode: 'bypassPermissions',
          shouldShow: false,
        }),
        shouldDisableBypassPermissions: async () => true,
        isBypassPermissionsModeDisabled: () => false,
      },
    })

    expect(error).toBe(
      'Cannot set permission mode to bypassPermissions because it is disabled by your organization policy',
    )
  })

  test('can skip the local prompt check for trusted delegated transitions', async () => {
    const error = await getDangerousPermissionModeTransitionError({
      mode: 'fullAccess',
      toolPermissionContext: {
        isBypassPermissionsModeAvailable: true,
      },
      requireLocalConfirmation: false,
      deps: {
        getStartupDangerousPermissionPromptState: () => ({
          shouldShow: true,
          mode: 'fullAccess',
        }),
        shouldDisableBypassPermissions: async () => false,
        isBypassPermissionsModeDisabled: () => false,
      },
    })

    expect(error).toBeUndefined()
  })

  test('allows local session unlocks from the permissions UI', async () => {
    const error = await getDangerousPermissionModeTransitionError({
      mode: 'fullAccess',
      toolPermissionContext: {
        isBypassPermissionsModeAvailable: false,
      },
      allowSessionBypassPermissionsModeEnable: true,
      requireLocalConfirmation: false,
      deps: {
        getStartupDangerousPermissionPromptState: () => ({
          shouldShow: true,
          mode: 'fullAccess',
        }),
        shouldDisableBypassPermissions: async () => false,
        isBypassPermissionsModeDisabled: () => false,
      },
    })

    expect(error).toBeUndefined()
  })
})

describe('applyPermissionUpdatesToLiveContext', () => {
  test('routes setMode updates through the live transition flow', () => {
    const updated = applyPermissionUpdatesToLiveContext(
      {
        mode: 'plan',
        prePlanMode: 'acceptEdits',
      } as never,
      [{ type: 'setMode', mode: 'default', destination: 'session' }],
    )

    expect(updated.mode).toBe('default')
    expect(updated.prePlanMode).toBeUndefined()
  })
})

describe('applyPermissionModeChange', () => {
  test('marks dangerous modes as available once they are enabled in-session', () => {
    const updated = applyPermissionModeChange(
      {
        ...getEmptyToolPermissionContext(),
        isBypassPermissionsModeAvailable: false,
      },
      'fullAccess',
    )

    expect(updated.mode).toBe('fullAccess')
    expect(updated.isBypassPermissionsModeAvailable).toBe(true)
  })
})

describe('requestPermissionModeChange', () => {
  test('applies the mode change when validation passes', async () => {
    let applied = false

    const result = await requestPermissionModeChange({
      mode: 'default',
      toolPermissionContext: {
        isBypassPermissionsModeAvailable: true,
      },
      onApply: () => {
        applied = true
      },
      deps: {
        getPermissionModeChangeRequestDecision: async () => ({
          status: 'apply',
        }),
      },
    })

    expect(result).toEqual({ status: 'applied' })
    expect(applied).toBe(true)
  })

  test('reports blocked transitions', async () => {
    const errors: string[] = []

    const result = await requestPermissionModeChange({
      mode: 'fullAccess',
      toolPermissionContext: {
        isBypassPermissionsModeAvailable: false,
      },
      onApply: () => {
        throw new Error('should not apply')
      },
      onBlocked: error => {
        errors.push(error)
      },
      deps: {
        getPermissionModeChangeRequestDecision: async () => ({
          status: 'blocked',
          error: 'blocked by policy',
        }),
      },
    })

    expect(result).toEqual({
      status: 'blocked',
      error: 'blocked by policy',
    })
    expect(errors).toEqual(['blocked by policy'])
  })

  test('requires a confirmation handler for dangerous-mode prompts', async () => {
    const result = await requestPermissionModeChange({
      mode: 'fullAccess',
      toolPermissionContext: {
        isBypassPermissionsModeAvailable: true,
      },
      onApply: () => {
        throw new Error('should not apply')
      },
      deps: {
        getPermissionModeChangeRequestDecision: async () => ({
          status: 'confirm',
          mode: 'fullAccess',
        }),
      },
    })

    expect(result).toEqual({
      status: 'blocked',
      error:
        'Cannot set permission mode to fullAccess without a dangerous-mode confirmation handler',
    })
  })

  test('continues through confirmation and applies after acceptance', async () => {
    let applied = 0
    let callCount = 0

    const result = await requestPermissionModeChange({
      mode: 'fullAccess',
      toolPermissionContext: {
        isBypassPermissionsModeAvailable: true,
      },
      onApply: () => {
        applied += 1
      },
      onConfirmDangerousMode: (_mode, onConfirm) => {
        onConfirm()
      },
      deps: {
        getPermissionModeChangeRequestDecision: async ({
          skipDangerousModePrompt,
        }) => {
          callCount += 1
          if (!skipDangerousModePrompt) {
            return {
              status: 'confirm',
              mode: 'fullAccess',
            }
          }

          return { status: 'apply' }
        },
      },
    })

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(result).toEqual({
      status: 'confirm-pending',
      mode: 'fullAccess',
    })
    expect(callCount).toBe(2)
    expect(applied).toBe(1)
  })
})

describe('stripDangerousPermissionsForAutoMode permissive safety', () => {
  afterEach(() => {
    delete process.env.OPENCLAUDE_SAFETY_LEVEL
    resetSafetyLevelCache()
  })

  test('keeps focused Bash interpreter allow rules in permissive safety mode', () => {
    process.env.OPENCLAUDE_SAFETY_LEVEL = 'permissive'
    resetSafetyLevelCache()

    const updated = stripDangerousPermissionsForAutoMode({
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: {
        userSettings: ['Bash(python:*)', 'Bash(npm run:*)'],
      },
    })

    expect(updated.alwaysAllowRules.userSettings).toEqual([
      'Bash(python:*)',
      'Bash(npm run:*)',
    ])
    expect(updated.strippedDangerousRules).toEqual({})
  })

  test('still strips broad classifier-bypass allow rules in permissive safety mode', () => {
    process.env.OPENCLAUDE_SAFETY_LEVEL = 'permissive'
    resetSafetyLevelCache()

    const updated = stripDangerousPermissionsForAutoMode({
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: {
        userSettings: [
          'Bash(*)',
          'PowerShell(*)',
          'Agent(*)',
          'Bash(python:*)',
        ],
      },
    })

    expect(updated.alwaysAllowRules.userSettings).toEqual(['Bash(python:*)'])
    expect(updated.strippedDangerousRules).toEqual({
      userSettings: ['Bash', 'PowerShell', 'Agent'],
    })
  })
})
