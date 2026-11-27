import { ExternalHttpsUrlSchema, MarketPriceResponseSchema, type MarketPriceResponse, type PublicMedia } from '@hd/contracts/public';
import { publicVehicleCover } from '@/modules/vehicles';
import type { MarketExtreme, MarketMoney, MarketResultView } from './market-results';

// The catalog publishes external images through the BE source profiles. Mirror the current
// production media restrictions at this render boundary without proxying arbitrary addresses.
const unsignedPhotos = new Set(['p3-dcd.byteimg.com', 'p9-dcd.byteimg.com']);
const signedPhotos = new Set(['p3-dcd-sign.byteimg.com', 'p9-dcd-sign.byteimg.com']);
const psm = /^[A-Za-z0-9.]{1,80}$/;
const signingKey = /^[A-Za-z0-9]{1,32}$/;
const signedQuery = { psm, 'x-expires': /^\d{10}$/, 'x-signature': /^[A-Za-z0-9+_/=-]{10,160}$/ };

function exactQuery(params: URLSearchParams, rules: Record<string, RegExp>) {
  const entries = [...params];
  return entries.length === Object.keys(rules).length && new Set(params.keys()).size === entries.length
    && entries.every(([key, value]) => Object.hasOwn(rules, key) && rules[key]!.test(value));
}

function eligibleRemote(cover: PublicMedia, now: number) {
  if (!cover.remote || (cover.remote.expiresAt && Date.parse(cover.remote.expiresAt) <= now)
      || !ExternalHttpsUrlSchema.safeParse(cover.url).success) return false;
  const { hostname, search, searchParams } = new URL(cover.url);
  if (hostname === 'erscglobal2.autoimg.cn') return !search;
  if (unsignedPhotos.has(hostname)) return exactQuery(searchParams, { psm });
  return signedPhotos.has(hostname) && Number(searchParams.get('x-expires')) * 1_000 > now
    && (exactQuery(searchParams, { ...signedQuery, lk3s: signingKey }) || exactQuery(searchParams, { ...signedQuery, rk3s: signingKey }));
}

function eligibleCover(cover: PublicMedia | null) {
  if (!cover) return null;
  if (/^\/api\/v1\/media\/[A-Za-z0-9_-]+\/?(?:\?variant=(?:thumb|card))?$/.test(cover.url)) return cover;
  return eligibleRemote(cover, Date.now()) ? cover : null;
}

type MarketStatistics = MarketPriceResponse['data']['statistics'];
function amount(value: MarketStatistics['min']): MarketMoney | null {
  return value ? { usd: value.usd?.amount ?? null, cny: value.cny.amount } : null;
}

function toExtreme(extreme: MarketPriceResponse['data']['extremes']['min'], price: MarketMoney | null): MarketExtreme | undefined {
  if (!extreme || !price) return undefined;
  const { vehicle, detailPath } = extreme;
  if (detailPath !== vehicle.detailPath) throw new Error('Mismatched market vehicle link');
  const image = eligibleCover(publicVehicleCover(vehicle));
  const localizedTrim = vehicle.display?.trim;
  return {
    href: detailPath,
    title: vehicle.content.title.text,
    trim: localizedTrim?.text ?? vehicle.facts.trim?.name ?? null,
    modelYear: vehicle.facts.modelYear,
    mileageKm: vehicle.facts.mileageKm,
    image,
    price,
  };
}

export function parseMarketPriceResult(body: unknown): MarketResultView {
  const { data } = MarketPriceResponseSchema.parse(body);
  const statistics = data.statistics;
  const minimum = amount(statistics.min);
  const maximum = amount(statistics.max);
  const sample = (data.extremes.min ?? data.extremes.max)?.vehicle;
  return {
    sampleCount: data.sampleCount,
    calculatedAt: data.asOf,
    minimum, maximum,
    median: amount(statistics.median),
    mean: amount(statistics.mean),
    p25: amount(statistics.p25),
    p75: amount(statistics.p75),
    ...(sample ? { vehicleNames: { make: sample.facts.make?.name ?? null, model: sample.facts.model?.name ?? null,
      trim: sample.display?.trim?.text ?? sample.facts.trim?.name ?? null,
    } } : {}),
    extremes: {
      minimum: toExtreme(data.extremes.min, minimum),
      maximum: toExtreme(data.extremes.max, maximum),
    },
  };
}
