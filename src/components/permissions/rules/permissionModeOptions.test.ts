import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { getPermissionModeOptions } from './permissionModeOptions.js'

describe('permissionModeOptions', () => {
  test('includes dangerous modes in the permissions picker before session unlock', () => {
    const options = getPermissionModeOptions({
      ...getEmptyToolPermissionContext(),
      isBypassPermissionsModeAvailable: false,
    })

    expect(options.map(option => option.value)).toContain('bypassPermissions')
    expect(options.map(option => option.value)).toContain('fullAccess')
  })

  test('includes full access when dangerous modes are available', () => {
    const options = getPermissionModeOptions({
      ...getEmptyToolPermissionContext(),
      isBypassPermissionsModeAvailable: true,
    })

    expect(options.map(option => option.value)).toContain('fullAccess')
  })

  test('keeps the current dangerous mode visible even if availability is off', () => {
    const options = getPermissionModeOptions({
      ...getEmptyToolPermissionContext(),
      mode: 'fullAccess',
      isBypassPermissionsModeAvailable: false,
    })

    expect(options.map(option => option.value)).toContain('fullAccess')
    expect(options.find(option => option.value === 'fullAccess')?.label).toBe(
      'Full Access (current)',
    )
  })
})
