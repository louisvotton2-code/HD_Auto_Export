import { NextResponse, type NextRequest } from 'next/server';
import { notFoundDocument } from '@/shared/lib/not-found-document';
import { siteConfig } from '@/shared/config/site';
import type { Locale } from '@/i18n/routing';

function errorDocument(locale: Locale, status: 200 | 404 | 429 | 503,
  problem?: Parameters<typeof notFoundDocument>[1], retryAfter?: string) {
  return new NextResponse(notFoundDocument(locale, problem), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': problem ? 'noindex, nofollow' : 'noindex, follow',
      'X-Content-Type-Options': 'nosniff',
      ...(retryAfter && { 'Retry-After': retryAfter }),
    },
  });
}

/** Invalid dynamic root locales otherwise fail before a locale layout can render its 404. */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // OPS uses these three documents only after a genuine vehicle HTML 404.
  // The gateway preserves the original 404; this body source itself returns 200.
  const fallbackLocale = /^\/404\/(zh|en|ru)\/$/.exec(path)?.[1] as Locale | undefined;
  if (fallbackLocale) {
    if (!['GET', 'HEAD'].includes(request.method))
      return new NextResponse(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
    return errorDocument(fallbackLocale, 200);
  }
  const detail = /^\/(zh|en|ru)\/cars\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})\/$/.exec(path);
  const accept = request.headers.get('accept')?.toLowerCase() ?? '';
  // Next can remove its internal Flight query and headers before calling Proxy.
  const flight = accept.includes('text/x-component') || request.headers.get('sec-fetch-dest') === 'empty';
  if (siteConfig.indexable && detail && ['GET', 'HEAD'].includes(request.method) &&
    (accept.includes('text/html') || !flight && (!accept || accept.includes('*/*')))) {
    const locale = detail[1] as Locale;
    const id = detail[2];
    const { publicVehicleDocumentFailure } = await import('@/app/[locale]/cars/[slug]/document-status');
    const failure = await publicVehicleDocumentFailure(id, locale, path, request.headers);
    if (failure) {
      const { status } = failure;
      return status === 404 ? errorDocument(locale, status) :
        errorDocument(locale, status, { status, ...failure.problem }, failure.retryAfter);
    }
  }
  const segment = path.split('/')[1];
  const reserved = ['api', '_next', 'brand', 'fonts', 'demo-vehicles', 'staff'];
  if (
    !segment ||
    /^\/internal\/public-html\/(?:render|version|browse)\/$/.test(path) ||
    ['zh', 'en', 'ru'].includes(segment) ||
    reserved.includes(segment) ||
    /\.[a-z0-9]+$/i.test(path)
  )
    return NextResponse.next();
  return errorDocument('en', 404);
}
