import { PublicVehicleQuerySchema } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';

/** Identical validation for SSR, browser history and the allowlisted BFF. */
export function parseCatalogQuery(
  params: Record<string, string | string[] | undefined>,
  locale: Locale,
) {
  const input: Record<string, unknown> = { locale, catalog: 'curated' };
  for (const key of ['q', 'make', 'model', 'powertrain', 'page', 'pageSize']) {
    const value = params[key];
    if (value === undefined || value === '') continue;
    if (Array.isArray(value)) return null;
    input[key] =
      key === 'page' || key === 'pageSize'
        ? /^[1-9]\d*$/.test(value)
          ? Number(value)
          : NaN
        : value;
  }
  const parsed = PublicVehicleQuerySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
export function publicQueryString(query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) params.set(key, String(value));
  return params.toString();
}
