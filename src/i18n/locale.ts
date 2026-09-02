import { dictionaries, type Locale } from './index';

export function detectLocale(): Locale {
  const envLang = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || '';
  
  if (envLang.toLowerCase().includes('zh') || envLang.toLowerCase().includes('hk')) {
    return 'zh-HK';
  }
  if (envLang.toLowerCase().includes('vi')) {
    return 'vi';
  }

  return 'en';
}
