import { afterEach, describe, expect, test } from 'bun:test'

import { detectLocale } from './i18n/locale.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from './utils/settings/settingsCache.js'

afterEach(() => {
  resetSettingsCache()
})

describe('detectLocale', () => {
  test('accepts zh-HK as a supported locale', () => {
    setSessionSettingsCache({
      settings: { language: 'zh-HK' },
      errors: [],
    })

    expect(detectLocale()).toBe('zh-HK')
  })
})
