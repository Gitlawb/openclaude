import { describe, expect, test } from 'bun:test'
import type { AutoUpdaterResult } from '../utils/autoUpdater.js'
import { shouldRenderNativeAutoUpdater } from './NativeAutoUpdater.js'

describe('shouldRenderNativeAutoUpdater', () => {
  test('renders install failures even when no update version is available', () => {
    const result: AutoUpdaterResult = {
      status: 'install_failed',
      version: null,
    }

    expect(shouldRenderNativeAutoUpdater(result, false, {})).toBe(true)
  })

  test('renders update progress only with complete version info', () => {
    expect(
      shouldRenderNativeAutoUpdater(null, true, {
        current: '1.0.0',
        latest: '1.1.0',
      }),
    ).toBe(true)
    expect(
      shouldRenderNativeAutoUpdater(null, true, {
        current: '1.0.0',
      }),
    ).toBe(false)
  })

  test('does not render with no update result and no active check', () => {
    expect(shouldRenderNativeAutoUpdater(null, false, {})).toBe(false)
  })
})
