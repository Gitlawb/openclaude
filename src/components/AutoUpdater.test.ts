import { describe, expect, test } from 'bun:test'
import {
  getAutoUpdaterNpmMethod,
  shouldRemoveInstalledSymlinkForNpmUpdate,
  shouldUseNativeAutoUpdater,
} from '../utils/autoUpdaterRouting.js'

describe('getAutoUpdaterNpmMethod', () => {
  test('routes native npm-only builds to the global npm updater', () => {
    expect(getAutoUpdaterNpmMethod('native', 'native', false)).toBe('global')
  })

  test('leaves native-distribution builds to NativeAutoUpdater', () => {
    expect(getAutoUpdaterNpmMethod('native', 'native', true)).toBeNull()
  })

  test('preserves npm and unknown fallback routing', () => {
    expect(getAutoUpdaterNpmMethod('npm-local', undefined, false)).toBe('local')
    expect(getAutoUpdaterNpmMethod('npm-global', undefined, false)).toBe('global')
    expect(getAutoUpdaterNpmMethod('unknown', 'local', false)).toBe('local')
    expect(getAutoUpdaterNpmMethod('unknown', undefined, false)).toBe('global')
  })
})

describe('shouldUseNativeAutoUpdater', () => {
  test('only mounts NativeAutoUpdater for native builds with a native distribution', () => {
    expect(shouldUseNativeAutoUpdater('native', true)).toBe(true)
    expect(shouldUseNativeAutoUpdater('native', false)).toBe(false)
    expect(shouldUseNativeAutoUpdater('npm-global', true)).toBe(false)
    expect(shouldUseNativeAutoUpdater('development', true)).toBe(false)
  })
})

describe('shouldRemoveInstalledSymlinkForNpmUpdate', () => {
  test('removes stale native launchers for npm-only builds even with native config', () => {
    expect(shouldRemoveInstalledSymlinkForNpmUpdate('native', false)).toBe(true)
  })

  test('preserves native launchers for native-capable builds', () => {
    expect(shouldRemoveInstalledSymlinkForNpmUpdate('native', true)).toBe(false)
  })

  test('keeps existing npm-update cleanup for non-native config states', () => {
    expect(shouldRemoveInstalledSymlinkForNpmUpdate('global', false)).toBe(true)
    expect(shouldRemoveInstalledSymlinkForNpmUpdate('local', true)).toBe(true)
    expect(shouldRemoveInstalledSymlinkForNpmUpdate(undefined, true)).toBe(true)
  })
})
