import type { Locale } from './types.js';

export function detectLocale(): Locale {
  const envLang = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '').toLowerCase();

  if (envLang.includes('zh_hk') || envLang.includes('zh-hk')) {
    return 'zh-HK';
  }
  if (envLang.includes('vi')) {
    return 'vi';
  }

  return 'en';
}
