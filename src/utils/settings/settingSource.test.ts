import { describe, expect, test } from 'bun:test'
import type { SettingsWithSources } from './settings.js'
import { findSettingSource } from './settings.js'

// Fixtures typed loosely (SettingsJson is a large zod schema; these only
// exercise findSettingSource's key-lookup logic, not schema validation).
const sources = [
  { source: 'userSettings', settings: { theme: 'dark', verbose: true } },
  { source: 'projectSettings', settings: { theme: 'nord' } },
  { source: 'localSettings', settings: { verbose: false } },
] as unknown as SettingsWithSources['sources']

describe('findSettingSource', () => {
  test('returns the highest-priority source that defines the key', () => {
    // projectSettings is later in the array (higher priority) and overrides userSettings.
    expect(findSettingSource('theme', sources)).toBe('projectSettings')
  })

  test('falls back to the next-lower source when the key is absent higher up', () => {
    expect(findSettingSource('verbose', sources)).toBe('localSettings')
  })

  test('returns builtin when no source defines the key', () => {
    expect(findSettingSource('definitelyNotASetting', sources)).toBe('builtin')
  })

  test('treats a key explicitly set to undefined as unset', () => {
    const withUndefined = [
      { source: 'userSettings', settings: { theme: undefined } },
      { source: 'flagSettings', settings: { theme: 'light' } },
    ] as unknown as SettingsWithSources['sources']
    expect(findSettingSource('theme', withUndefined)).toBe('flagSettings')
  })

  test('falls through when the highest-priority source sets undefined', () => {
    // Higher-priority source (later in the array) explicitly sets undefined —
    // the lookup must skip it and report the lower-priority source.
    const undefinedAtTop = [
      { source: 'userSettings', settings: { theme: 'light' } },
      { source: 'flagSettings', settings: { theme: undefined } },
    ] as unknown as SettingsWithSources['sources']
    expect(findSettingSource('theme', undefinedAtTop)).toBe('userSettings')
  })

  test('resolves dotted keys to nested settings paths', () => {
    const nested = [
      { source: 'userSettings', settings: { permissions: { defaultMode: 'acceptEdits' } } },
    ] as unknown as SettingsWithSources['sources']
    expect(findSettingSource('permissions.defaultMode', nested)).toBe('userSettings')
  })

  test('does not match inherited Object.prototype keys', () => {
    const plain = [
      { source: 'userSettings', settings: { theme: 'dark' } },
    ] as unknown as SettingsWithSources['sources']
    expect(findSettingSource('hasOwnProperty', plain)).toBe('builtin')
    expect(findSettingSource('constructor', plain)).toBe('builtin')
  })

  test('returns builtin for an empty sources list', () => {
    expect(findSettingSource('theme', [])).toBe('builtin')
  })
})
