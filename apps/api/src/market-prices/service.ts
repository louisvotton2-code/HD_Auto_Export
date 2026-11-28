import { performance } from 'node:perf_hooks';
import type { PoolClient } from 'pg';
import type { MarketPriceQuery, MarketPriceResponse, PublicVehicleCard } from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import { readFxQuote, type FxQuote } from '../external/fx.js';
import { PublicCatalogUnavailableError } from '../external/public-cache.js';
import type { InventoryService } from '../vehicles/service.js';
import { projectUsdPrice, usdSourceRange } from '../vehicles/usd-price.js';
import { prepareModelRows, summarizeModel, type MarketCohort, type ModelSnapshot } from './snapshot.js';
import { aggregateMarket, hasMarketFilters, marketScopeKey, readComparableRows, shouldAggregateMarket } from './queries.js';

type MarketData = MarketPriceResponse['data'];
type Cohort = MarketCohort;
type MarketSnapshot = ModelSnapshot | { cohort: Cohort; expiresAt: number; quoteVersion: string | null };
type Projection = Pick<InventoryService, 'readMarketVehicleCards'>;

const cacheTtlMs = 600_000;
const cacheLimit = 24;
const cacheRowLimit = 24_000;
const snapshotReadMs = 5_800;
const statementReadMs = 3_000;
const activeReadMs = 12_000;
const concurrentReads = 2;
const pendingLimit = 24;
const queueWaitMs = 6_000;
const marketReadTransaction = `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
  SET LOCAL jit=off; SET LOCAL max_parallel_workers_per_gather=0; SET LOCAL lock_timeout='220ms';
  SET LOCAL statement_timeout='${statementReadMs}ms'`;
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

function cohortIds(cohort: Cohort) {
  return [...new Set([cohort.min_id, cohort.max_id].filter(id => id !== null))];
}

async function extremesStillComparable(tx: PoolClient, query: MarketPriceQuery, externalCatalog: boolean, quote: FxQuote | null, cohort: Cohort) {
  const ids = cohortIds(cohort);
  if (!ids.length) return true;
  const rows = await readComparableRows(tx, query, externalCatalog, quote, ids);
  const prices = new Map(rows.map(row => [row.id, row.price]));
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
  private readonly models = new Map<string, MarketSnapshot>();
  private readonly modelLoads = new Map<string, Promise<MarketSnapshot>>();
  private readonly loads = new Map<string, Promise<MarketData>>();
  private readonly waiting = new Map<() => void, ReturnType<typeof setTimeout>>();
  private active = 0;
  private cachedRows = 0;
  constructor(private readonly db: Database, private readonly externalCatalog: boolean, private readonly inventory: Projection) {}

  read(query: MarketPriceQuery): Promise<MarketData> {
    const key = marketScopeKey(query);
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
    if ('rows' in previous) this.cachedRows -= previous.rows.length;
    this.models.delete(key);
  }

  private modelSnapshot(key: string, scope: MarketPriceQuery, deadline: number): Promise<MarketSnapshot> {
    const cached = this.models.get(key);
    this.removeModel(key);
    if (cached && cached.expiresAt > performance.now()) {
      this.models.set(key, cached);
      if ('rows' in cached) this.cachedRows += cached.rows.length;
      return Promise.resolve(cached);
    }
    const existing = this.modelLoads.get(key);
    if (existing) return existing;
    const load = this.db.transaction<MarketSnapshot>(async tx => {
      const started = performance.now();
      const reader = boundedMarketClient(tx, Math.min(deadline, started + snapshotReadMs));
      await tx.query(marketReadTransaction);
      const quote = await marketQuote(reader);
      const expiration = {
        expiresAt: Math.min(started + cacheTtlMs, quote ? performance.now() + Date.parse(quote.expiresAt) - Date.now() : Infinity),
        quoteVersion: quote?.version ?? null,
      };
      if (await shouldAggregateMarket(reader, scope, this.externalCatalog, quote)) {
        const cohort = await aggregateMarket(reader, scope, this.externalCatalog, quote);
        return { cohort, ...expiration };
      }
      const [clock] = (await reader.query<{ as_of: Date }>('SELECT transaction_timestamp() AS as_of')).rows;
      const rows = await readComparableRows(reader, scope, this.externalCatalog, quote);
      return { asOf: clock!.as_of, rows: prepareModelRows(rows), ...expiration };
    }).then(sample => {
      if (sample.expiresAt <= performance.now()) return sample;
      this.models.set(key, sample);
      if ('rows' in sample) this.cachedRows += sample.rows.length;
      while (this.models.size > cacheLimit || this.cachedRows > cacheRowLimit) {
        this.removeModel(this.models.keys().next().value!);
      }
      return sample;
    }).finally(() => { this.modelLoads.delete(key); });
    this.modelLoads.set(key, load);
    return load;
  }

  private async snapshotFor(query: MarketPriceQuery, deadline: number) {
    const model = { locale: query.locale, make: query.make, model: query.model };
    const modelKey = marketScopeKey(model);
    const key = marketScopeKey(query);
    if (!hasMarketFilters(query)) return { key, sample: await this.modelSnapshot(key, model, deadline) };
    const full = this.models.get(modelKey);
    if (full && 'rows' in full && full.expiresAt > performance.now())
      return { key: modelKey, sample: await this.modelSnapshot(modelKey, model, deadline) };
    const scoped = this.models.get(key);
    if ((!scoped || scoped.expiresAt <= performance.now()) && this.modelLoads.has(modelKey)) {
      try {
        const sample = await this.modelSnapshot(modelKey, model, deadline);
        if ('rows' in sample) return { key: modelKey, sample };
      } catch (error) {
        // A simultaneous unfiltered request may exceed the budget. A narrow scope
        // remains eligible for a separate exact read under the same active deadline.
        const bounded = error instanceof PublicCatalogUnavailableError &&
          (error.reason === 'load-capacity' || error.reason === 'deadline');
        if (!bounded && !(error && typeof error === 'object' && 'code' in error && error.code === '57014')) throw error;
      }
    }
    return { key, sample: await this.modelSnapshot(key, query, deadline) };
  }

  private async load(query: MarketPriceQuery): Promise<MarketData> {
    const deadline = performance.now() + activeReadMs;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (performance.now() >= deadline) throw new PublicCatalogUnavailableError('deadline');
        const { key, sample } = await this.snapshotFor(query, deadline);
        const cohort = 'rows' in sample ? summarizeModel(sample, query) : sample.cohort;
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
