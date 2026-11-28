import { performance } from 'node:perf_hooks';
import type { PoolClient } from 'pg';
import type { MarketPriceQuery, MarketPriceResponse, PublicVehicleCard } from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import { readFxQuote, type FxQuote } from '../external/fx.js';
import { PublicCatalogUnavailableError } from '../external/public-cache.js';
import type { InventoryService } from '../vehicles/service.js';
import { projectUsdPrice, staffPriceAmountSql, usdSourceRange } from '../vehicles/usd-price.js';
import { prepareModelRows, summarizeModel, type ModelRow, type ModelScope, type ModelSnapshot } from './snapshot.js';

type MarketData = MarketPriceResponse['data'];
type Cohort = ReturnType<typeof summarizeModel>;
type Projection = Pick<InventoryService, 'readMarketVehicleCards'>;

const cacheTtlMs = 600_000;
const cacheLimit = 24;
const cacheRowLimit = 24_000;
const modelRowLimit = 8_192;
const fetchSize = 128;
const snapshotReadMs = 5_800;
const statementReadMs = 3_000;
const activeReadMs = 12_000;
const concurrentReads = 2;
const pendingLimit = 24;
const queueWaitMs = 6_000;
const localeMask = { zh: 1, en: 2, ru: 4 } as const;
const marketReadTransaction = `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
  SET LOCAL jit=off; SET LOCAL max_parallel_workers_per_gather=0; SET LOCAL lock_timeout='220ms';
  SET LOCAL statement_timeout='${statementReadMs}ms'`;
// Match the catalogue's translation presence test (btrim with the ECMAScript whitespace set).
const titleWhitespace = String.raw`U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'`;

function selectComparable(query: ModelScope, externalCatalog: boolean, quote: FxQuote | null,
  validation?: { query: MarketPriceQuery; picks: readonly string[] }) {
  const values: unknown[] = [];
  const bind = (value: unknown) => '$' + values.push(value);
  const locale = bind(query.locale), make = bind(query.make), model = bind(query.model);
  const currency = "p.data#>>'{price,money,currency}'";
  const cnyRate = quote ? `${bind(quote.rates.CNY)}::numeric` : null;
  const staffPrice = cnyRate ? `CASE WHEN ${currency}='USD' THEN round((${staffPriceAmountSql})*${cnyRate},2)
    ELSE ${staffPriceAmountSql} END` : staffPriceAmountSql;
  const manual = [`v.deleted_at IS NULL AND v.publication_state='published' AND v.availability='available'`,
    `p.data#>>'{source,kind}'='manual' AND p.data#>>'{facts,location,country}'='CN'`,
    `p.data#>>'{price,kind}'='asking' AND ${currency} ${cnyRate ? "IN ('CNY','USD')" : "='CNY'"}`,
    // Existing inclusions are free text. The comparable manual cohort has no stated package inclusions.
    `p.data#>'{price,includes}'='[]'::jsonb AND (${staffPrice}) BETWEEN 0.01 AND 99999999999999.99`,
    `nullif(btrim(p.data->'content'->'title'->'translations'->${locale}::text->>'text',${titleWhitespace}),'') IS NOT NULL`,
    `p.data#>>'{facts,make,id}'=${make} AND p.data#>>'{facts,model,id}'=${model}`];
  const supplier = [`f.active AND f.locale_mask<>0`,
    `f.make_id IS NOT NULL AND f.model_id IS NOT NULL AND f.make_id=${make} AND f.model_id=${model}`,
    `f.price_cny>0`];
  const supplierEligibility = [`l.upstream_state='active' AND (l.formal_canonical_id IS NULL OR l.formal_primary)`,
    `l.provider IN ('chinacarapi','chinacarapi-sample') AND l.platform_id IN ('che168','dongchedi')
      AND l.external_id ~ '^[0-9]{1,100}$'`,
    // The formal feed supersedes the same provider-facing listing in an older import.
    // An old copy cannot resurrect a formal withdrawal or a non-primary alias.
    `(l.provider='chinacarapi' OR NOT EXISTS (SELECT 1 FROM external_listings current_listing
      WHERE current_listing.provider='chinacarapi' AND current_listing.platform_id=l.platform_id
      AND current_listing.external_id=l.external_id))`,
    `(l.formal_canonical_id IS NOT NULL OR EXISTS (SELECT 1 FROM external_catalog_search s
      WHERE s.listing_id=l.id AND s.locale=${locale}::text))`];
  const hidden = `(o.data->'hidden') IS DISTINCT FROM 'true'::jsonb`;
  const domestic = `coalesce(c.facts#>>'{location,country}','CN')='CN'`;
  const filterColumns = [
    ['trim', "p.data#>>'{facts,trim,id}'", 'f.trim_id', '='],
    ['powertrain', "p.data#>>'{facts,powertrain}'", 'f.powertrain', '='],
    ['mileageMin', "(p.data#>>'{facts,mileageKm}')::numeric", 'f.mileage_km', '>='],
    ['mileageMax', "(p.data#>>'{facts,mileageKm}')::numeric", 'f.mileage_km', '<='],
    ['yearMin', "(p.data#>>'{facts,modelYear}')::numeric", 'f.model_year', '>='],
    ['yearMax', "(p.data#>>'{facts,modelYear}')::numeric", 'f.model_year', '<='],
  ] as const;
  if (validation) {
    const { query, picks } = validation;
    for (const [key, staffColumn, supplierColumn, op] of filterColumns) {
      if (query[key] === undefined) continue;
      const parameter = bind(query[key]);
      manual.push(`${staffColumn}${op}${parameter}`);
      supplier.push(`${supplierColumn}${op}${parameter}`);
    }
    manual.push(`v.id=ANY(${bind(picks.filter(id => !id.startsWith('ext-')))}::uuid[])`);
    if (externalCatalog) {
      supplier.push(`f.listing_id=ANY(${bind(picks.filter(id => id.startsWith('ext-')).map(id => id.slice(4)))}::uuid[])`);
    }
  }
  if (cnyRate) {
    // A native USD card must still equal the value expressed by the curve after rounding to CNY cents.
    manual.push(`(${currency}='CNY' OR round((${staffPrice})/${cnyRate},2)=(${staffPriceAmountSql}))`);
  }
  const manualSql = `SELECT v.id::text AS id,${staffPrice} AS price${validation ? '' : `,
      p.data#>>'{facts,trim,id}' AS trim,p.data#>>'{facts,powertrain}' AS powertrain,
      (p.data#>>'{facts,modelYear}')::integer AS year,(p.data#>>'{facts,mileageKm}')::integer AS mileage`}
    FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id AND p.vehicle_id=v.id
    WHERE ${manual.join(' AND ')}`;
  if (!externalCatalog) return { text: manualSql, values };
  supplier.push(`(f.locale_mask & ${bind(localeMask[query.locale])}::smallint)<>0`);
  // The canonical primary has a unique index per provider. Staff snapshots of source
  // kind external are excluded above, so those copies cannot duplicate supplier listings.
  if (validation) return { text: `${manualSql}
    UNION ALL SELECT 'ext-'||f.listing_id::text,f.price_cny FROM external_catalog_filter f
    JOIN external_listings l ON l.id=f.listing_id JOIN external_catalog c ON c.listing_id=f.listing_id
    LEFT JOIN external_listing_overrides o ON o.listing_id=f.listing_id
    WHERE ${[...supplier, ...supplierEligibility, hidden, domestic, 'f.price_cny=c.price_cny'].join(' AND ')}`, values };
  // The compact index locates the model once. Keep wide-table reads inside the
  // lateral probe so the cursor can stop each fetch before evaluating the next rows.
  return { text: `WITH model_candidates AS MATERIALIZED (
    SELECT f.listing_id,f.price_cny,f.trim_id,f.powertrain,f.model_year,f.mileage_km FROM external_catalog_filter f
    WHERE ${supplier.join(' AND ')}
  )
    ${manualSql}
    UNION ALL SELECT 'ext-'||f.listing_id::text,f.price_cny,f.trim_id,f.powertrain,f.model_year,f.mileage_km
    FROM model_candidates f
    CROSS JOIN LATERAL (
      SELECT 1 FROM external_listings l JOIN external_catalog c ON c.listing_id=l.id
      LEFT JOIN external_listing_overrides o ON o.listing_id=l.id
      WHERE l.id=f.listing_id AND ${[...supplierEligibility, hidden, domestic, 'f.price_cny=c.price_cny'].join(' AND ')}
      LIMIT 1
    ) eligible`, values };
}

function boundedMarketClient(tx: PoolClient, deadline: number): PoolClient {
  let timeout = statementReadMs;
  const client = Object.create(tx) as PoolClient;
  client.query = (async (text: string, values?: unknown[]) => {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0) throw new PublicCatalogUnavailableError('deadline');
    if (remaining < timeout) {
      timeout = remaining;
      await tx.query("SELECT set_config('statement_timeout',$1,true)", [String(remaining)]);
    }
    const result = await tx.query(text, values);
    if (performance.now() >= deadline) throw new PublicCatalogUnavailableError('deadline');
    return result;
  }) as typeof tx.query;
  return client;
}

async function readModelRows(tx: PoolClient, query: ModelScope, externalCatalog: boolean, quote: FxQuote | null) {
  const { text, values } = selectComparable(query, externalCatalog, quote);
  await tx.query(`DECLARE market_model NO SCROLL CURSOR FOR
    SELECT id,round(price,2)::text AS price,trim,powertrain,year,mileage FROM (${text}) AS comparable`, values);
  const rows: ModelRow[] = [];
  // A short fetch proves exhaustion. At the cap, probe one more row and reject
  // any larger model instead of publishing statistics from a truncated sample.
  while (rows.length <= modelRowLimit) {
    const size = Math.min(fetchSize, modelRowLimit + 1 - rows.length);
    const page = (await tx.query<ModelRow>(`FETCH FORWARD ${size} FROM market_model`)).rows;
    rows.push(...page);
    if (page.length < size) return rows;
  }
  throw new PublicCatalogUnavailableError('load-capacity');
}

function cohortIds(cohort: Cohort) {
  return [...new Set([cohort.min_id, cohort.max_id].filter(id => id !== null))];
}

async function extremesStillComparable(tx: PoolClient, query: MarketPriceQuery, externalCatalog: boolean, quote: FxQuote | null, cohort: Cohort) {
  const ids = cohortIds(cohort);
  if (!ids.length) return true;
  const { text, values } = selectComparable(query, externalCatalog, quote, { query, picks: ids });
  const result = await tx.query<{ id: string; price: string }>(
    `SELECT id,round(price,2)::text AS price FROM (${text}) comparable`, values);
  const prices = new Map(result.rows.map(row => [row.id, row.price]));
  return prices.get(cohort.min_id!) === cohort.min && prices.get(cohort.max_id!) === cohort.max;
}

function statisticsAmount(amount: string | null, quote: FxQuote | null): MarketData['statistics']['min'] {
  if (amount === null) return null;
  const cny = { amount, currency: 'CNY' as const };
  const display = projectUsdPrice({ kind: 'reference', money: cny, includes: [] }, quote);
  return { cny, usd: display.status === 'ready' ? display.money : null };
}

function marketData(cohort: Cohort, cards: PublicVehicleCard[], quote: FxQuote | null): MarketData {
  const vehicles = new Map(cards.map(vehicle => [vehicle.id, vehicle]));
  const extreme = (id: string | null) => {
    if (id === null) return null;
    const vehicle = vehicles.get(id);
    if (!vehicle) throw new PublicCatalogUnavailableError('revision-changed');
    return { vehicle, detailPath: vehicle.detailPath };
  };
  return {
    sampleCount: cohort.sample_count, asOf: cohort.as_of.toISOString(),
    fx: cohort.sample_count && quote ? { asOf: quote.asOf, source: quote.source } : null,
    statistics: {
      min: statisticsAmount(cohort.min, quote), max: statisticsAmount(cohort.max, quote),
      mean: statisticsAmount(cohort.mean, quote), median: statisticsAmount(cohort.median, quote),
      p25: statisticsAmount(cohort.p25, quote), p75: statisticsAmount(cohort.p75, quote),
    },
    extremes: { min: extreme(cohort.min_id), max: extreme(cohort.max_id) },
  };
}

export class MarketPriceService {
  private readonly models = new Map<string, ModelSnapshot>();
  private readonly modelLoads = new Map<string, Promise<ModelSnapshot>>();
  private readonly loads = new Map<string, Promise<MarketData>>();
  private readonly waiting = new Map<() => void, ReturnType<typeof setTimeout>>();
  private active = 0;
  private cachedRows = 0;
  constructor(private readonly db: Database, private readonly externalCatalog: boolean, private readonly inventory: Projection) {}

  read(query: MarketPriceQuery): Promise<MarketData> {
    const key = JSON.stringify([query.locale, query.make, query.model, query.trim, query.yearMin, query.yearMax,
      query.mileageMin, query.mileageMax, query.powertrain]);
    const existing = this.loads.get(key);
    if (existing) return existing;
    const load = this.schedule(() => this.load(query)).finally(() => { this.loads.delete(key); });
    this.loads.set(key, load);
    return load;
  }

  private schedule<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        void work().then(resolve, reject).finally(() => {
          this.active--;
          const next = this.waiting.entries().next().value;
          if (!next) return;
          const [run, timer] = next;
          this.waiting.delete(run);
          clearTimeout(timer);
          run();
        });
      };
      if (this.active < concurrentReads) {
        start();
      } else if (this.waiting.size < pendingLimit) {
        const timer = setTimeout(() => {
          this.waiting.delete(start);
          reject(new PublicCatalogUnavailableError('deadline'));
        }, queueWaitMs);
        this.waiting.set(start, timer);
      } else reject(new PublicCatalogUnavailableError('load-capacity'));
    });
  }

  private removeModel(key: string) {
    const previous = this.models.get(key);
    if (!previous) return;
    this.cachedRows -= previous.rows.length;
    this.models.delete(key);
  }

  private modelSnapshot(key: string, scope: ModelScope, deadline: number): Promise<ModelSnapshot> {
    const cached = this.models.get(key);
    this.removeModel(key);
    if (cached && cached.expiresAt > performance.now()) {
      this.models.set(key, cached);
      this.cachedRows += cached.rows.length;
      return Promise.resolve(cached);
    }
    const existing = this.modelLoads.get(key);
    if (existing) return existing;
    const load = this.db.transaction(async tx => {
      const started = performance.now();
      const reader = boundedMarketClient(tx, Math.min(deadline, started + snapshotReadMs));
      await tx.query(marketReadTransaction);
      const [clock] = (await reader.query<{ as_of: Date }>('SELECT transaction_timestamp() AS as_of')).rows;
      const quote = await marketQuote(reader);
      const rows = await readModelRows(reader, scope, this.externalCatalog, quote);
      return {
        asOf: clock!.as_of,
        rows: prepareModelRows(rows),
        expiresAt: Math.min(started + cacheTtlMs, quote ? performance.now() + Date.parse(quote.expiresAt) - Date.now() : Infinity),
        quoteVersion: quote?.version ?? null,
      };
    }).then(sample => {
      if (sample.expiresAt <= performance.now()) return sample;
      this.models.set(key, sample);
      this.cachedRows += sample.rows.length;
      while (this.models.size > cacheLimit || this.cachedRows > cacheRowLimit) {
        this.removeModel(this.models.keys().next().value!);
      }
      return sample;
    }).finally(() => { this.modelLoads.delete(key); });
    this.modelLoads.set(key, load);
    return load;
  }

  private async load(query: MarketPriceQuery): Promise<MarketData> {
    const deadline = performance.now() + activeReadMs;
    const scope = { locale: query.locale, make: query.make, model: query.model };
    const key = JSON.stringify([scope.locale, scope.make, scope.model]);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (performance.now() >= deadline) throw new PublicCatalogUnavailableError('deadline');
        const sample = await this.modelSnapshot(key, scope, deadline);
        const cohort = summarizeModel(sample, query);
        // The cohort is disposable and contains no cached cards or media URLs.
        // Recheck FX, current eligibility, price and cards in one fresh snapshot.
        const data = await this.db.transaction(async connection => {
          await connection.query(marketReadTransaction);
          const tx = boundedMarketClient(connection, deadline);
          const quote = await marketQuote(tx);
          if (sample.expiresAt <= performance.now() || sample.quoteVersion !== (quote?.version ?? null) ||
              !await extremesStillComparable(tx, query, this.externalCatalog, quote, cohort)) return null;
          const ids = cohortIds(cohort);
          const cards = await this.inventory.readMarketVehicleCards(tx, ids, query.locale, quote, Date.now());
          if (sample.expiresAt <= performance.now() || cards.length !== ids.length) return null;
          return marketData(cohort, cards, quote);
        });
        if (data) return data;
        if (this.models.get(key) === sample) this.removeModel(key);
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === '57014') throw new PublicCatalogUnavailableError('deadline', undefined, error.code);
        if (error.code === '55P03') throw new PublicCatalogUnavailableError('deadline');
      }
      throw error;
    }
    throw new PublicCatalogUnavailableError('revision-changed');
  }
}

async function marketQuote(tx: PoolClient) {
  const quote = await readFxQuote(tx);
  return usdSourceRange('CNY', quote) ? quote : null;
}
