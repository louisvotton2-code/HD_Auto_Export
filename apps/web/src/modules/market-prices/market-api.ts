import { MarketPriceResponseSchema, type MarketPriceResponse } from '@hd/contracts/public';
import { publicVehicleCover } from '@/modules/vehicles';
import { publicMediaVariantUrl } from '@/shared/lib/public-media';
import type { MarketExtreme, MarketMoney, MarketResultView } from './market-results';

type MarketStatistics = MarketPriceResponse['data']['statistics'];
function amount(value: MarketStatistics['min']): MarketMoney | null {
  return value ? { usd: value.usd?.amount ?? null, cny: value.cny.amount } : null;
}

function toExtreme(extreme: MarketPriceResponse['data']['extremes']['min'], price: MarketMoney | null): MarketExtreme | undefined {
  if (!extreme || !price) return undefined;
  const { vehicle, detailPath } = extreme;
  if (detailPath !== vehicle.detailPath) throw new Error('Mismatched market vehicle link');
  const cover = publicVehicleCover(vehicle);
  const image = cover && /^\/api\/v1\/media\//.test(cover.url)
    ? { url: publicMediaVariantUrl(cover.url, 'card') ?? cover.url, alt: cover.alt }
    : null;
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
