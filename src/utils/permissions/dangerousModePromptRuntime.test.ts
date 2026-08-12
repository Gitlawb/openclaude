import { afterEach, describe, expect, mock, test } from 'bun:test'

afterEach(() => {
  mock.restore()
})

describe('dangerousModePromptRuntime', () => {
  test('startup prompt state and acceptance persistence use the settings-backed runtime wiring', async () => {
    let hasBypassAcceptance = false
    let hasFullAccessAcceptance = false
    let writeCommitted = true
    const updates: Array<{
      source: string
      settings: Record<string, unknown>
    }> = []

    mock.module('../settings/settings.js', () => ({
      hasSkipDangerousModePermissionPrompt: () => hasBypassAcceptance,
      hasSkipFullAccessModePermissionPrompt: () => hasFullAccessAcceptance,
      updateSettingsForSource: (
        source: string,
        settings: Record<string, unknown>,
      ) => {
        updates.push({ source, settings })
        return { error: null, written: writeCommitted }
      },
      updateSettingsForSourceWithResult: (
        source: string,
        settings: Record<string, unknown>,
      ) => {
        updates.push({ source, settings })
        return { error: null, written: writeCommitted }
      },
      wasSettingsUpdateCommitted: (result: {
        written: boolean
        committed?: boolean
      }) => result.committed ?? result.written,
    }))

    const {
      getStartupDangerousPermissionPromptState,
      persistDangerousModeAcceptance,
    } = await import(
      `./dangerousModePromptRuntime.js?ts=${Date.now()}-${Math.random()}`
    )

    expect(
      getStartupDangerousPermissionPromptState({
        permissionMode: 'fullAccess',
        allowDangerouslySkipPermissions: false,
      }),
    ).toEqual({
      mode: 'fullAccess',
      shouldShow: true,
    })

    hasFullAccessAcceptance = true

    expect(
      getStartupDangerousPermissionPromptState({
        permissionMode: 'fullAccess',
        allowDangerouslySkipPermissions: false,
      }),
    ).toEqual({
      mode: 'fullAccess',
      shouldShow: false,
    })

    expect(persistDangerousModeAcceptance('fullAccess')).toBeNull()
    expect(persistDangerousModeAcceptance('bypassPermissions')).toBeNull()

    expect(updates).toEqual([
      {
        source: 'userSettings',
        settings: { skipFullAccessModePermissionPrompt: true },
      },
      {
        source: 'userSettings',
        settings: { skipDangerousModePermissionPrompt: true },
      },
    ])

    writeCommitted = false
    expect(persistDangerousModeAcceptance('fullAccess')).toBe(
      'Could not save dangerous mode acceptance',
    )
  })
})
