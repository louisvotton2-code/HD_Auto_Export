import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';

const copy = {
  zh: { message: '页面未找到', navigation: '选择语言' },
  en: { message: 'Page not found', navigation: 'Choose your language' },
  ru: { message: 'Страница не найдена', navigation: 'Выберите язык' },
} satisfies Record<Locale, { message: string; navigation: string }>;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** Standalone error document: no vehicle data, request context, React or API read. */
export function notFoundDocument(locale: Locale = 'en') {
  const brand = escapeHtml(siteConfig.name);
  const text = copy[locale];
  return `<!doctype html><html lang="${locale === 'zh' ? 'zh-Hans' : locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>404 | ${brand}</title><style>body{margin:0;background:#0a0a0a;color:#f5f0eb;font-family:system-ui,sans-serif}main{min-height:100vh;display:grid;align-content:center;justify-items:center;gap:18px;padding:24px;box-sizing:border-box;text-align:center}h1{font-size:64px;margin:0}nav{display:flex;flex-wrap:wrap;justify-content:center;gap:20px}a{color:#d6a27c;padding:12px}img{object-fit:contain}</style></head><body><main id="main"><img src="${escapeHtml(siteConfig.brand.logo.src)}" width="144" height="97" alt=""><span>${brand} / 404</span><h1>404</h1><p>${text.message}</p><nav aria-label="${text.navigation}"><a href="/zh/" lang="zh-Hans">中文首页</a><a href="/en/" lang="en">Home</a><a href="/ru/" lang="ru">На главную</a></nav></main></body></html>`;
}
