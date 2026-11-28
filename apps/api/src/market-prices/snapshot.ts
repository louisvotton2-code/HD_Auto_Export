import type { MarketPriceQuery } from '@hd/contracts/public';

export type ModelScope = Pick<MarketPriceQuery, 'locale' | 'make' | 'model'>;
export type ModelRow = {
  id: string;
  price: string;
  trim: string | null;
  powertrain: string | null;
  year: number | null;
  mileage: number | null;
};
export type ModelSnapshot = {
  asOf: Date;
  rows: Array<Omit<ModelRow, 'price'> & { price: bigint }>;
  expiresAt: number;
  quoteVersion: string | null;
};

export function prepareModelRows(rows: ModelRow[]): ModelSnapshot['rows'] {
  return rows.map(row => ({ ...row, price: BigInt(row.price.replace('.', '')) }))
    .sort((a, b) => a.price < b.price ? -1 : a.price > b.price ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function inRange(value: number | null, min: number | undefined, max: number | undefined) {
  return (min === undefined && max === undefined) ||
    (value !== null && (min === undefined || value >= min) && (max === undefined || value <= max));
}

function rounded(numerator: bigint, denominator: bigint) {
  return (numerator + denominator / 2n) / denominator;
}

function amount(cents: bigint | undefined) {
  if (cents === undefined) return null;
  return String(cents / 100n) + '.' + String(cents % 100n).padStart(2, '0');
}

function quartile(rows: ModelSnapshot['rows'], quarters: 1 | 3) {
  if (rows.length < 10) return null;
  const offset = (rows.length - 1) * quarters;
  const lower = Math.floor(offset / 4);
  const remainder = offset % 4;
  const value = rows[lower]!.price;
  return amount(remainder === 0 ? value : rounded(
    value * BigInt(4 - remainder) + rows[lower + 1]!.price * BigInt(remainder), 4n));
}

export function summarizeModel(snapshot: ModelSnapshot, query: MarketPriceQuery) {
  const rows = snapshot.rows.filter(row =>
    (query.trim === undefined || row.trim === query.trim) &&
    (query.powertrain === undefined || row.powertrain === query.powertrain) &&
    inRange(row.year, query.yearMin, query.yearMax) &&
    inRange(row.mileage, query.mileageMin, query.mileageMax));
  const count = rows.length;
  const first = rows[0];
  const last = rows.at(-1);
  return {
    as_of: snapshot.asOf,
    sample_count: count,
    min: amount(first?.price),
    max: amount(last?.price),
    mean: count ? amount(rounded(rows.reduce((sum, row) => sum + row.price, 0n), BigInt(count))) : null,
    median: count ? amount(rounded(rows[Math.floor((count - 1) / 2)]!.price + rows[Math.floor(count / 2)]!.price, 2n)) : null,
    p25: quartile(rows, 1),
    p75: quartile(rows, 3),
    min_id: first?.id ?? null,
    max_id: last?.id ?? null,
  };
}
