import { MarketPriceQuerySchema } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import type { MarketFiltersDraft } from './market-query-form';

const filterKeys = ['make', 'model', 'trim', 'yearMin', 'yearMax', 'mileageMin', 'mileageMax', 'powertrain'] as const satisfies readonly (keyof MarketFiltersDraft)[];

export function readMarketDraft(params: URLSearchParams): MarketFiltersDraft {
  return {
    make: params.get('make') ?? '',
    model: params.get('model') ?? '',
    trim: params.get('trim') ?? '',
    yearMin: params.get('yearMin') ?? '',
    yearMax: params.get('yearMax') ?? '',
    mileageMin: params.get('mileageMin') ?? '',
    mileageMax: params.get('mileageMax') ?? '',
    powertrain: params.get('powertrain') ?? '',
  };
}

export function marketSearchParams(draft: MarketFiltersDraft) {
  const params = new URLSearchParams();
  for (const key of filterKeys) {
    const value = draft[key].trim();
    if (value) params.set(key, value);
  }
  return params;
}

export function hasMarketFilters(params: URLSearchParams) {
  return filterKeys.some(key => params.has(key));
}

export function hasDuplicateMarketFilters(params: URLSearchParams) {
  return filterKeys.some(key => params.getAll(key).length > 1);
}

export function changeMarketFilter(draft: MarketFiltersDraft, name: keyof MarketFiltersDraft, value: string): MarketFiltersDraft {
  if (draft[name] === value) return draft;
  if (name === 'make') return { ...draft, make: value, model: '', trim: '' };
  if (name === 'model') return { ...draft, model: value, trim: '' };
  return { ...draft, [name]: value };
}

export const marketPriceApiPath = '/api/v1/public/market-prices';
const rangeFields = ['yearMin', 'yearMax', 'mileageMin', 'mileageMax'] as const;
type DraftError = 'invalid' | 'range' | 'required';

export function parseMarketPriceQuery(params: URLSearchParams) {
  const allowed = new Set<string>([...filterKeys, 'locale']);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) return null;
  }
  const query: Record<string, string | number> = Object.fromEntries(params);
  for (const key of rangeFields) {
    const value = params.get(key);
    if (value === null) continue;
    if (!/^\d{1,8}$/.test(value)) return null;
    query[key] = Number(value);
  }
  return MarketPriceQuerySchema.safeParse(query);
}

export function validateMarketDraft(draft: MarketFiltersDraft): DraftError | null {
  const params = marketSearchParams(draft);
  if (!params.has('make') || !params.has('model')) return 'required';
  const result = parseMarketPriceQuery(params);
  if (result?.success) return null;
  return result?.error.issues.some(issue => issue.code === 'custom' && (issue.path[0] === 'yearMax' || issue.path[0] === 'mileageMax'))
    ? 'range' : 'invalid';
}

export function marketPriceEndpoint(locale: Locale, query: string) {
  const params = new URLSearchParams(query);
  params.set('locale', locale);
  return `${marketPriceApiPath}?${params}`;
}
