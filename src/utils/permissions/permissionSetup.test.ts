import { describe, expect, test } from 'bun:test'

import {
  applyPermissionModeChange,
  applyPermissionUpdatesToLiveContext,
  getDangerousPermissionModeTransitionError,
  getEffectiveDefaultPermissionModeFromSettingsSources,
} from './permissionSetup.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { requestPermissionModeChange } from './permissionModeChange.js'

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
      },
    })

    expect(error).toBe(
      'Cannot set permission mode to fullAccess until the user explicitly confirms Full Access in a local interactive session',
    )
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
