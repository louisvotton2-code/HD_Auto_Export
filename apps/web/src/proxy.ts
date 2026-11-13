import { NextResponse, type NextRequest } from 'next/server';
import { notFoundDocument } from '@/shared/lib/not-found-document';
import type { Locale } from '@/i18n/routing';

function errorDocument(locale: Locale, status: 200 | 404) {
  return new NextResponse(notFoundDocument(locale), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, follow',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Invalid dynamic root locales otherwise fail before a locale layout can render its 404. */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // OPS uses these three documents only after a genuine vehicle HTML 404.
  // The gateway preserves the original 404; this body source itself returns 200.
  const fallbackLocale = /^\/404\/(zh|en|ru)\/$/.exec(path)?.[1] as Locale | undefined;
  if (fallbackLocale) {
    if (!['GET', 'HEAD'].includes(request.method))
      return new NextResponse(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
    return errorDocument(fallbackLocale, 200);
  }
  const segment = path.split('/')[1];
  const reserved = ['api', '_next', 'brand', 'fonts', 'demo-vehicles', 'staff'];
  if (
    !segment ||
    ['zh', 'en', 'ru'].includes(segment) ||
    reserved.includes(segment) ||
    /\.[a-z0-9]+$/i.test(path)
  )
    return NextResponse.next();
  return errorDocument('en', 404);
}
