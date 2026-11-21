import type { Locale } from '@/i18n/routing';
import { getConfiguredPixelId } from '@/modules/analytics/server';
import { siteConfig } from '@/shared/config/site';
import { publicVehicleMessages } from '@/modules/vehicles';
import { PublicApiError, readPublicVehicleDocument } from '@/modules/vehicles/server';

export async function publicVehicleDocumentFailure(id: string, locale: Locale, path: string, incoming: Headers) {
  try {
    const vehicle = await readPublicVehicleDocument(id, locale, incoming, {
      includePixel: Boolean(getConfiguredPixelId()),
      includeSeo: siteConfig.indexable,
    });
    return vehicle ? null : { status: 404 as const };
  } catch (error) {
    const limited = error instanceof PublicApiError && error.status === 429;
    const { unavailable: message, retry: reload } = publicVehicleMessages(locale);
    return { status: limited ? 429 as const : 503 as const, problem: { message, reload, path },
      retryAfter: limited ? error.retryAfter ?? '60' : '60' };
  }
}
