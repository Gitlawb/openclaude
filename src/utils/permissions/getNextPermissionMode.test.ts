import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { getNextPermissionMode } from './getNextPermissionMode.js'

describe('getNextPermissionMode', () => {
  test('cycles from bypassPermissions to fullAccess when dangerous modes are available', () => {
    expect(
      getNextPermissionMode({
        ...getEmptyToolPermissionContext(),
        mode: 'bypassPermissions',
        isBypassPermissionsModeAvailable: true,
      }),
    ).toBe('fullAccess')
  })

  test('cycles from fullAccess back to default without auto mode', () => {
    expect(
      getNextPermissionMode({
        ...getEmptyToolPermissionContext(),
        mode: 'fullAccess',
        isBypassPermissionsModeAvailable: true,
      }),
    ).toBe('default')
  })
})
