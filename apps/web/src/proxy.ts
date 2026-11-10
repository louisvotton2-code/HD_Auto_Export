import { NextResponse, type NextRequest } from 'next/server';
import { siteConfig } from '@/shared/config/site';

/** Invalid dynamic root locales otherwise fail before a locale layout can render its 404. */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segment = path.split('/')[1];
  const reserved = ['api', '_next', 'brand', 'fonts', 'demo-vehicles'];
  if (
    !segment ||
    ['zh', 'en', 'ru'].includes(segment) ||
    reserved.includes(segment) ||
    /\.[a-z0-9]+$/i.test(path)
  )
    return NextResponse.next();
  const brand = siteConfig.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>404 | ${brand}</title><style>body{margin:0;background:#0a0a0a;color:#f5f0eb;font-family:system-ui,sans-serif}main{min-height:100vh;display:grid;align-content:center;justify-items:center;gap:18px;padding:24px;box-sizing:border-box}h1{font-size:64px;margin:0}nav{display:flex;flex-wrap:wrap;gap:20px}a{color:#d6a27c;padding:12px}img{object-fit:contain}</style></head><body><main id="main"><img src="${siteConfig.brand.logo.src}" width="144" height="97" alt=""><span>${brand} / 404</span><h1>404</h1><p>Page not found</p><nav aria-label="Choose your language"><a href="/zh/" lang="zh-Hans">中文首页</a><a href="/en/" lang="en">Home</a><a href="/ru/" lang="ru">На главную</a></nav></main></body></html>`,
    {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
