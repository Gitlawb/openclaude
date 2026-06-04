import { getInitialSettings } from '../utils/settings/settings.js'
import type { Locale } from './types.js'

const LANGUAGE_MAP: Record<string, Locale> = {
  english: 'en',
  en: 'en',
  vietnamese: 'vi',
  vi: 'vi',
}

export function detectLocale(): Locale {
  const settings = getInitialSettings()
  const lang = settings.language
  if (typeof lang !== 'string') {
    return 'en'
  }
  return LANGUAGE_MAP[lang.toLowerCase()] ?? 'en'
}
