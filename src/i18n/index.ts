import { detectLocale } from './locale.js';
import en from './languages/en.js';
import vi from './languages/vi.js';
import zhHK from './languages/zh-HK.js';
import type { I18nDictionary, InterpolationValues, LocalizationKey, Locale } from './types.js';

export const dictionaries = {
  en,
  vi,
  'zh-HK': zhHK,
};

export { detectLocale };
export type { Locale, I18nDictionary, LocalizationKey, InterpolationValues };

export function getDictionary(locale: string): I18nDictionary {
  return dictionaries[locale as Locale] ?? dictionaries.en;
}

export function localize(
  key: string,
  params?: Record<string, string> | string,
  overrideLocale?: string
): string {
  const targetLocale = overrideLocale ?? detectLocale();
  const dict = getDictionary(targetLocale);
  let text = (dict as Record<string, string>)[key] ?? (dictionaries.en as Record<string, string>)[key] ?? key;

  if (typeof params === 'object' && params !== null) {
    Object.entries(params).forEach(([pKey, pVal]) => {
      text = text.replace(new RegExp(`{{${pKey}}}`, 'g'), pVal);
    });
  }

  return text;
}
