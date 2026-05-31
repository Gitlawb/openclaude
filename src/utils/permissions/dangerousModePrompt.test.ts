import { describe, expect, test } from 'bun:test'

import {
  getDangerousModeAcceptanceUpdate,
  getDangerousPermissionPromptState,
} from './dangerousModePrompt.js'

describe('getDangerousPermissionPromptState', () => {
  test('does not show a prompt for non-dangerous sessions', () => {
    expect(
      getDangerousPermissionPromptState({
        permissionMode: 'default',
        allowDangerouslySkipPermissions: false,
        hasAcceptedBypassPermissionsPrompt: false,
        hasAcceptedFullAccessPrompt: false,
      }),
    ).toEqual({
      mode: null,
      shouldShow: false,
    })
  })

  test('uses the bypass prompt for legacy dangerous sessions', () => {
    expect(
      getDangerousPermissionPromptState({
        permissionMode: 'default',
        allowDangerouslySkipPermissions: true,
        hasAcceptedBypassPermissionsPrompt: false,
        hasAcceptedFullAccessPrompt: true,
      }),
    ).toEqual({
      mode: 'bypassPermissions',
      shouldShow: true,
    })
  })

  test('requires a separate prompt for fullAccess even if bypass was accepted', () => {
    expect(
      getDangerousPermissionPromptState({
        permissionMode: 'fullAccess',
        allowDangerouslySkipPermissions: false,
        hasAcceptedBypassPermissionsPrompt: true,
        hasAcceptedFullAccessPrompt: false,
      }),
    ).toEqual({
      mode: 'fullAccess',
      shouldShow: true,
    })
  })

  test('skips the prompt after fullAccess has been explicitly accepted', () => {
    expect(
      getDangerousPermissionPromptState({
        permissionMode: 'fullAccess',
        allowDangerouslySkipPermissions: false,
        hasAcceptedBypassPermissionsPrompt: false,
        hasAcceptedFullAccessPrompt: true,
      }),
    ).toEqual({
      mode: 'fullAccess',
      shouldShow: false,
    })
  })
})

describe('getDangerousModeAcceptanceUpdate', () => {
  test('writes the bypass acceptance setting for bypassPermissions', () => {
    expect(getDangerousModeAcceptanceUpdate('bypassPermissions')).toEqual({
      skipDangerousModePermissionPrompt: true,
    })
  })

  test('writes the fullAccess acceptance setting separately', () => {
    expect(getDangerousModeAcceptanceUpdate('fullAccess')).toEqual({
      skipFullAccessModePermissionPrompt: true,
    })
  })
})
