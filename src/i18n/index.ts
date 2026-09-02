import { en } from './en';
import { vi } from './vi';
import { zhHK } from './zh-HK';

export const dictionaries = {
  en,
  vi,
  'zh-HK': zhHK,
};

export type Locale = keyof typeof dictionaries;

export function getDictionary(locale: string) {
  return dictionaries[locale as Locale] ?? dictionaries.en;
}

export function localize(locale: string, key: string, params?: Record<string, string>): string {
  const dict = getDictionary(locale);
  let text = (dict as Record<string, string>)[key] ?? (dictionaries.en as Record<string, string>)[key] ?? key;

  if (params) {
    Object.entries(params).forEach(([pKey, pVal]) => {
      text = text.replace(new RegExp(`{{${pKey}}}`, 'g'), pVal);
    });
  }

  return text;
}
