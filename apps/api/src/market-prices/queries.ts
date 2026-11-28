import type { PoolClient } from 'pg';
import type { MarketPriceQuery } from '@hd/contracts/public';
import type { FxQuote } from '../external/fx.js';
import { PublicCatalogUnavailableError } from '../external/public-cache.js';
import { staffPriceAmountSql } from '../vehicles/usd-price.js';
import type { MarketCohort, ModelRow } from './snapshot.js';

const modelRowLimit = 8_192;
const supplierBatchSize = 128;
const localeMask = { zh: 1, en: 2, ru: 4 } as const;
const titleWhitespace = String.raw`U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'`;

const filterColumns = [
  ['trim', "p.data#>>'{facts,trim,id}'", 'f.trim_id', '='],
  ['powertrain', "p.data#>>'{facts,powertrain}'", 'f.powertrain', '='],
  ['mileageMin', "(p.data#>>'{facts,mileageKm}')::numeric", 'f.mileage_km', '>='],
  ['mileageMax', "(p.data#>>'{facts,mileageKm}')::numeric", 'f.mileage_km', '<='],
  ['yearMin', "(p.data#>>'{facts,modelYear}')::numeric", 'f.model_year', '>='],
  ['yearMax', "(p.data#>>'{facts,modelYear}')::numeric", 'f.model_year', '<='],
] as const;

export function marketScopeKey(query: MarketPriceQuery) {
  return JSON.stringify([query.locale, query.make, query.model, ...filterColumns.map(([key]) => query[key])]);
}

export function hasMarketFilters(query: MarketPriceQuery) {
  return filterColumns.some(([key]) => query[key] !== undefined);
}

export async function readMarketProjectionGeneration(tx: PoolClient, query: MarketPriceQuery, externalCatalog: boolean) {
  if (!externalCatalog) return null;
  const { rows: [model] } = await tx.query<{ generation: string }>(`SELECT generation
    FROM public.external_market_quote_models WHERE make_id=$1 AND model_id=$2 AND phase='ready'`,
  [query.make, query.model]);
  return model?.generation ?? null;
}

function parameters() {
  const values: unknown[] = [];
  return { values, bind: (value: unknown) => '$' + values.push(value) };
}

function filterRange(query: MarketPriceQuery, bind: (value: unknown) => string, source: 'manual' | 'supplier') {
  return filterColumns.flatMap(([key, manualColumn, supplierColumn, operator]) => query[key] === undefined ? [] :
    [`${source === 'manual' ? manualColumn : supplierColumn}${operator}${bind(query[key])}`]);
}

function manualQuotes(query: MarketPriceQuery, quote: FxQuote | null, picks?: readonly string[],
  { bind, values } = parameters()) {
  const locale = bind(query.locale), make = bind(query.make), model = bind(query.model);
  const currency = "p.data#>>'{price,money,currency}'";
  const cnyRate = quote ? `${bind(quote.rates.CNY)}::numeric` : null;
  const price = cnyRate ? `CASE WHEN ${currency}='USD' THEN round((${staffPriceAmountSql})*${cnyRate},2)
    ELSE ${staffPriceAmountSql} END` : staffPriceAmountSql;
  const conditions = [
    "v.deleted_at IS NULL AND v.publication_state='published' AND v.availability='available'",
    "p.data#>>'{source,kind}'='manual' AND p.data#>>'{facts,location,country}'='CN'",
    `p.data#>>'{price,kind}'='asking' AND ${currency} ${cnyRate ? "IN ('CNY','USD')" : "='CNY'"}`,
    `p.data#>'{price,includes}'='[]'::jsonb AND (${price}) BETWEEN 0.01 AND 99999999999999.99`,
    `nullif(btrim(p.data->'content'->'title'->'translations'->${locale}::text->>'text',${titleWhitespace}),'') IS NOT NULL`,
    `p.data#>>'{facts,make,id}'=${make} AND p.data#>>'{facts,model,id}'=${model}`,
    ...filterRange(query, bind, 'manual'),
  ];
  if (cnyRate) conditions.push(`(${currency}='CNY' OR round((${price})/${cnyRate},2)=(${staffPriceAmountSql}))`);
  if (picks) conditions.push(`v.id=ANY(${bind(picks)}::uuid[])`);
  return { values, text: `SELECT v.id::text AS id,round((${price}),2)::text AS price,
    p.data#>>'{facts,trim,id}' AS trim,p.data#>>'{facts,powertrain}' AS powertrain,
    (p.data#>>'{facts,modelYear}')::integer AS year,(p.data#>>'{facts,mileageKm}')::integer AS mileage
    FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id AND p.vehicle_id=v.id
    WHERE ${conditions.join(' AND ')}` };
}

function supplierScope(query: MarketPriceQuery, bind: (value: unknown) => string) {
  return ['f.active AND f.locale_mask<>0',
    `f.make_id IS NOT NULL AND f.model_id IS NOT NULL AND f.make_id=${bind(query.make)} AND f.model_id=${bind(query.model)}`,
    'f.price_cny>0',
    `(f.locale_mask & ${bind(localeMask[query.locale])}::smallint)<>0`,
    ...filterRange(query, bind, 'supplier'),
  ].join(' AND ');
}

function supplierCandidates(query: MarketPriceQuery, picks?: readonly string[], { bind, values } = parameters()) {
  const scope = supplierScope(query, bind);
  const ids = picks ? `AND f.listing_id=ANY(${bind(picks)}::uuid[])` : '';
  const locale = bind(query.locale);
  const identity = `l.platform_id IN ('che168','dongchedi') AND l.external_id ~ '^[0-9]{1,100}$'`;
  return { values, text: `WITH candidates AS MATERIALIZED (
    SELECT f.listing_id,f.price_cny,f.trim_id,f.powertrain,f.model_year,f.mileage_km
    FROM external_catalog_filter f WHERE ${scope} ${ids}
  ) SELECT 'ext-'||f.listing_id::text AS id,f.price_cny::text AS price,
    f.trim_id AS trim,f.powertrain,f.model_year AS year,f.mileage_km AS mileage
    FROM candidates f CROSS JOIN LATERAL (
      SELECT 1 FROM external_catalog c
      WHERE c.listing_id=f.listing_id AND c.price_cny=f.price_cny AND coalesce(c.facts#>>'{location,country}','CN')='CN'
      AND NOT EXISTS (SELECT 1 FROM external_listing_overrides o WHERE o.listing_id=f.listing_id AND o.data->'hidden'='true'::jsonb)
      AND (EXISTS (SELECT 1 FROM external_listings l WHERE l.id=f.listing_id AND l.provider='chinacarapi'
        AND l.upstream_state='active' AND l.formal_canonical_id IS NOT NULL AND l.formal_primary AND ${identity})
      OR EXISTS (SELECT 1 FROM external_listings l WHERE l.id=f.listing_id AND l.upstream_state='active'
        AND (l.formal_canonical_id IS NULL OR l.formal_primary)
        AND l.provider IN ('chinacarapi','chinacarapi-sample') AND ${identity}
        AND (l.provider='chinacarapi' OR NOT EXISTS (SELECT 1 FROM external_listings successor
          WHERE successor.provider='chinacarapi' AND successor.platform_id=l.platform_id AND successor.external_id=l.external_id))
        AND (l.formal_canonical_id IS NOT NULL OR EXISTS (SELECT 1 FROM external_catalog_search s
          WHERE s.listing_id=l.id AND s.locale=${locale}::text))))
      LIMIT 1
    ) eligible` };
}

function projectedSupplierCandidates(query: MarketPriceQuery, generation: string, { bind, values } = parameters()) {
  const args = [
    `${bind(query.make)}::text`, `${bind(query.model)}::text`, `${bind(generation)}::uuid`, `${bind(query.locale)}::text`,
    `${bind(query.trim ?? null)}::text`, `${bind(query.yearMin ?? null)}::integer`, `${bind(query.yearMax ?? null)}::integer`,
    `${bind(query.mileageMin ?? null)}::integer`, `${bind(query.mileageMax ?? null)}::integer`,
    `${bind(query.powertrain ?? null)}::text`,
  ];
  return { values, text: `SELECT 'ext-'||q.listing_id::text AS id,q.price_cny::text AS price,
    q.trim_id AS trim,q.powertrain,q.model_year AS year,q.mileage_km AS mileage
    FROM public.read_external_market_quote_rows(${args.join(',')}) q` };
}

export type MarketRowPhase = 'market_read_manual' | 'market_declare' | 'market_fetch';

export async function readComparableRows(tx: PoolClient, query: MarketPriceQuery, externalCatalog: boolean,
  quote: FxQuote | null, picks?: readonly string[], phase?: (stage: MarketRowPhase) => void, projectionGeneration?: string | null) {
  phase?.('market_read_manual');
  const manualIds = picks?.filter(id => !id.startsWith('ext-'));
  const manual = manualQuotes(query, quote, manualIds);
  const rows = manualIds?.length === 0 ? [] : (await tx.query<ModelRow>(`${manual.text} LIMIT ${modelRowLimit + 1}`, manual.values)).rows;
  if (rows.length > modelRowLimit) throw new PublicCatalogUnavailableError('load-capacity');
  if (!externalCatalog) return rows;

  const supplierIds = picks?.filter(id => id.startsWith('ext-')).map(id => id.slice(4));
  if (supplierIds?.length === 0) return rows;
  // Picks are a live price and eligibility check. Only use the projection to build a cohort.
  if (!supplierIds && projectionGeneration) {
    const supplier = projectedSupplierCandidates(query, projectionGeneration);
    const limit = modelRowLimit + 1 - rows.length;
    phase?.('market_fetch');
    const { rows: projected } = await tx.query<ModelRow>(`${supplier.text} LIMIT ${limit}`, supplier.values);
    if (rows.length + projected.length > modelRowLimit) throw new PublicCatalogUnavailableError('load-capacity');
    return rows.concat(projected);
  }
  const supplier = supplierCandidates(query, supplierIds);
  if (supplierIds) {
    return rows.concat((await tx.query<ModelRow>(supplier.text, supplier.values)).rows);
  }
  phase?.('market_declare');
  await tx.query(`DECLARE market_candidates NO SCROLL CURSOR FOR ${supplier.text}`, supplier.values);
  phase?.('market_fetch');
  for (;;) {
    const page = (await tx.query<ModelRow>(`FETCH FORWARD ${supplierBatchSize} FROM market_candidates`)).rows;
    rows.push(...page);
    if (rows.length > modelRowLimit) throw new PublicCatalogUnavailableError('load-capacity');
    if (page.length < supplierBatchSize) return rows;
  }
}

// Count qualified staff rows and possible supplier rows up to the cache limit.
// Legacy eligibility can only reduce this upper bound.
export async function shouldAggregateMarket(tx: PoolClient, query: MarketPriceQuery, externalCatalog: boolean,
  quote: FxQuote | null, projectionGeneration?: string | null) {
  const params = parameters();
  const { bind } = params;
  let supplier = '';
  if (externalCatalog && projectionGeneration) {
    const conditions = [`f.make_id=${bind(query.make)}`, `f.model_id=${bind(query.model)}`,
      `f.generation=${bind(projectionGeneration)}::uuid`, `(f.locale_mask & ${bind(localeMask[query.locale])}::smallint)<>0`,
      'f.price_cny>0', ...filterRange(query, bind, 'supplier')];
    supplier = `SELECT 1 FROM public.external_market_quote_rows f WHERE ${conditions.join(' AND ')} UNION ALL`;
  } else if (externalCatalog) {
    supplier = `SELECT 1 FROM external_catalog_filter f WHERE ${supplierScope(query, bind)} UNION ALL`;
  }
  const manual = manualQuotes(query, quote, undefined, params);
  const { rows: [probe] } = await tx.query<{ oversized: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM (${supplier} SELECT 1 FROM (${manual.text}) manual)
    AS possible OFFSET ${modelRowLimit} LIMIT 1
  ) AS oversized`, params.values);
  return probe!.oversized;
}

function quartile(rank: 1 | 3) {
  const step = `(${rank}*(population-1))`;
  return `CASE WHEN count(*)>=10 THEN round(sum(
    CASE WHEN ordinal=1+${step}/4 THEN price*(4-${step}%4) ELSE 0 END +
    CASE WHEN ordinal=1+(${step}+3)/4 THEN price*(${step}%4) ELSE 0 END
  )/4,2)::text END`;
}

export async function aggregateMarket(tx: PoolClient, query: MarketPriceQuery, externalCatalog: boolean,
  quote: FxQuote | null, projectionGeneration?: string | null) {
  const params = parameters();
  const manual = manualQuotes(query, quote, undefined, params);
  const supplier = externalCatalog ? (projectionGeneration ? projectedSupplierCandidates(query, projectionGeneration, params) :
    supplierCandidates(query, undefined, params)) : null;
  const { rows: [cohort] } = await tx.query<MarketCohort>(`WITH comparable AS (
    ${manual.text}${supplier ? ` UNION ALL SELECT * FROM (${supplier.text}) supplier` : ''}
  ), ranked AS (
    SELECT id, price::numeric AS price,
      row_number() OVER (ORDER BY price::numeric,id COLLATE "C") AS ordinal,
      count(*) OVER () AS population
    FROM comparable
  )
  SELECT transaction_timestamp() AS as_of,count(*)::int AS sample_count,
    round(min(price),2)::text AS min,round(max(price),2)::text AS max,round(avg(price),2)::text AS mean,
    round(avg(price) FILTER (WHERE ordinal BETWEEN (population+1)/2 AND (population+2)/2),2)::text AS median,
    ${quartile(1)} AS p25,${quartile(3)} AS p75,
    min(id) FILTER (WHERE ordinal=1) AS min_id,min(id) FILTER (WHERE ordinal=population) AS max_id
  FROM ranked`, params.values);
  return cohort!;
}
