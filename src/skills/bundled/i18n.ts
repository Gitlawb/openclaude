/**
 * Simple i18n helper for bundled skill descriptions.
 * Reads the `language` setting from config to determine locale.
 *
 * To switch language, set `language` in ~/.claude/settings.json:
 *   { "language": "vietnamese" }  // or "vi"
 *   { "language": "english" }     // or "en" (default)
 */

type Locale = 'en' | 'vi'

const LANGUAGE_MAP: Record<string, Locale> = {
  english: 'en',
  en: 'en',
  vietnamese: 'vi',
  vi: 'vi',
}

function detectLocale(): Locale {
  try {
    // Dynamic import to avoid circular deps at module init
    // The config module caches settings, so this is fast after first call
    const { getConfig } = require('../../utils/config.js')
    const lang = getConfig()?.language ?? 'en'
    return LANGUAGE_MAP[lang.toLowerCase()] ?? 'en'
  } catch {
    return 'en'
  }
}

/**
 * Get a localized string from a translations map.
 * Falls back to English if the current locale is not available.
 */
export function t(translations: Record<Locale, string>): string {
  const locale = detectLocale()
  return translations[locale] ?? translations.en
}
