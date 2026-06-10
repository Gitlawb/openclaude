import { describe, expect, test } from 'bun:test'

import { getClaudeInChromePermissionMode } from './usePromptsFromClaudeInChrome.tsx'

describe('getClaudeInChromePermissionMode', () => {
  test('maps only fullAccess to skip-all permission checks', () => {
    expect(getClaudeInChromePermissionMode('bypassPermissions')).toBe('ask')
    expect(getClaudeInChromePermissionMode('fullAccess')).toBe(
      'skip_all_permission_checks',
    )
  })

  test('keeps non-dangerous modes in ask mode', () => {
    expect(getClaudeInChromePermissionMode('default')).toBe('ask')
    expect(getClaudeInChromePermissionMode('acceptEdits')).toBe('ask')
    expect(getClaudeInChromePermissionMode('plan')).toBe('ask')
    expect(getClaudeInChromePermissionMode('dontAsk')).toBe('ask')
  })
})
