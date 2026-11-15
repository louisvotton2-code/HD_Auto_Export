import { hasPrivateVehicleSource } from '@/shared/lib/public-vehicle-reference';

const textFields = new Set(['text', 'label', 'name', 'alt', 'displayName', 'city', 'includes']);

/** Remove supplier branding from validated display text without changing IDs, media or dates. */
export function clearPrivateVehicleText<T>(dto: T): T {
  function visit(value: unknown, field = ''): unknown {
    if (typeof value === 'string' && textFields.has(field) && hasPrivateVehicleSource(value)) {
      return value.replace(/https?:\/\/[^\s<>"']+/gi, url => hasPrivateVehicleSource(url) ? '' : url)
        .replace(/dongchedi|che1688?|懂车帝|车168/gi, '').replace(/ {2,}/g, ' ').trim() || '—';
    }
    if (Array.isArray(value)) return value.map(item => visit(item, field));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, own]) => [key, visit(own, key)]));
    return value;
  }
  return visit(dto) as T;
}
