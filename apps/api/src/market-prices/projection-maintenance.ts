import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { IdSchema } from '@hd/contracts/public';
import type { PoolClient } from 'pg';
import { createDatabase, type Database } from '../db/index.js';
import { readDatabaseEnvironment } from '../local-secrets.js';

const actions = ['begin', 'seed', 'step', 'activate', 'disable', 'status'] as const;
type Action = typeof actions[number];
type Phase = 'preparing' | 'filling' | 'verified' | 'ready' | 'disabled';
type ModelScope = { make: string; model: string; database: string };
type Maintenance = ModelScope & { action: Action; generation?: string };
type ModelState = {
  generation: string; phase: Phase; updated_at: Date; pending: boolean;
  seed_mask: number; seed_published_at: string | null; seed_listing_id: string | null;
};

const batchSize = 128;
const seedPageSize = 256;
const databaseName = /^[A-Za-z0-9_]{1,63}$/;
const generationId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const usage = 'Expected begin, seed, step, activate, disable or status with --make, --model and --database. Set --generation for seed, step, activate and disable.';
const pendingWhere = 'make_id=$1 AND model_id=$2 AND generation=$3::uuid';

class MarketMaintenanceError extends Error {}

function validate(input: Maintenance) {
  const { action, database, generation, make, model } = input;
  const needsGeneration = action !== 'begin' && action !== 'status';
  if (!actions.includes(action) || !databaseName.test(database)
      || !IdSchema.safeParse(make).success || !IdSchema.safeParse(model).success
      || (needsGeneration ? !generation || !generationId.test(generation) : generation !== undefined)) {
    throw new MarketMaintenanceError(usage);
  }
}

async function readModel(tx: PoolClient, { make, model }: ModelScope) {
  const { rows: [state] } = await tx.query<ModelState>(`SELECT m.generation,m.phase,m.updated_at,
    m.seed_mask,m.seed_published_at::text AS seed_published_at,m.seed_listing_id,
    EXISTS(SELECT 1 FROM public.external_market_quote_pending p
      WHERE (p.make_id,p.model_id,p.generation)=(m.make_id,m.model_id,m.generation)) AS pending
    FROM public.external_market_quote_models m WHERE m.make_id=$1 AND m.model_id=$2`, [make, model]);
  return state;
}

function report(input: Maintenance, state: ModelState | undefined, counts: { processed?: number; discarded?: number } = {}) {
  return {
    make: input.make, model: input.model,
    generation: state?.generation ?? null, phase: state?.phase ?? 'unregistered',
    updatedAt: state?.updated_at.toISOString() ?? null, pending: state?.pending ?? false,
    ...(state?.phase === 'preparing' ? { seedMask: state.seed_mask } : {}),
    ...counts,
  };
}

async function setPhase(tx: PoolClient, input: Maintenance, phase: Phase) {
  await tx.query(`UPDATE public.external_market_quote_models SET phase=$4,updated_at=clock_timestamp()
    WHERE ${pendingWhere}`, [input.make, input.model, input.generation, phase]);
}

async function begin(tx: PoolClient, input: Maintenance) {
  // An operator retry observes the same enrollment until it is explicitly disabled.
  await tx.query(`INSERT INTO public.external_market_quote_models AS registered
    (make_id,model_id,generation,phase,updated_at)
    VALUES($1,$2,$3::uuid,'preparing',clock_timestamp())
    ON CONFLICT(make_id,model_id) DO UPDATE
      SET generation=excluded.generation,phase=excluded.phase,updated_at=excluded.updated_at,
          seed_mask=1,seed_published_at=NULL,seed_listing_id=NULL
      WHERE registered.phase='disabled'`, [input.make, input.model, randomUUID()]);
  return report(input, await readModel(tx, input));
}

async function discardRetiredPending(tx: PoolClient, { make, model }: ModelScope, keepGeneration?: string) {
  const select = `SELECT generation,listing_id FROM public.external_market_quote_pending
    WHERE make_id=$1 AND model_id=$2`;
  const page = 'ORDER BY generation,listing_id LIMIT $3';
  // When preparing, only use PK ranges outside the generation being seeded.
  const batch = keepGeneration ? `SELECT generation,listing_id FROM (
      (${select} AND generation<$4::uuid ${page})
      UNION ALL
      (${select} AND generation>$4::uuid ${page})
    ) retired ${page}` : `${select} ${page}`;
  const result = await tx.query(`WITH batch AS MATERIALIZED (${batch})
    DELETE FROM public.external_market_quote_pending p USING batch
    WHERE p.make_id=$1 AND p.model_id=$2 AND (p.generation,p.listing_id)=(batch.generation,batch.listing_id)`,
  keepGeneration ? [make, model, batchSize, keepGeneration] : [make, model, batchSize]);
  return result.rowCount ?? 0;
}

async function seed(tx: PoolClient, input: Maintenance, state: ModelState) {
  if (state.phase !== 'preparing') return report(input, state, { processed: 0 });
  const resume = state.seed_listing_id !== null;
  if (state.seed_mask === 1 && !resume) {
    const discarded = await discardRetiredPending(tx, input, state.generation);
    if (discarded) return report(input, state, { processed: 0, discarded });
  }
  // A fixed mask keeps both timestamp ranges on the ordered 0051 model index.
  // The separate equality range avoids revisiting UUIDs before the cursor.
  const select = `SELECT listing_id,published_at FROM public.external_catalog_filter
    WHERE active AND locale_mask<>0 AND make_id IS NOT NULL AND model_id IS NOT NULL
      AND make_id=$1 AND model_id=$2 AND locale_mask=$4::smallint`;
  const page = 'ORDER BY published_at DESC,listing_id LIMIT $5';
  const candidates = resume ? `SELECT listing_id,published_at FROM (
      (${select} AND published_at=$6::timestamptz AND listing_id>$7::uuid ${page})
      UNION ALL
      (${select} AND published_at<$6::timestamptz ${page})
    ) ranges ${page}` : `${select} ${page}`;
  const scope = [input.make, input.model, input.generation];
  const pageValues = [...scope, state.seed_mask, seedPageSize];
  const values = resume ? [...pageValues, state.seed_published_at, state.seed_listing_id] : pageValues;
  const { rows: [result] } = await tx.query<{
    candidates: number; added: number; last_published_at: string | null; last_listing_id: string | null;
  }>(`WITH candidates AS MATERIALIZED (${candidates}), added AS (
      INSERT INTO public.external_market_quote_pending(make_id,model_id,generation,listing_id)
      SELECT $1,$2,$3::uuid,listing_id FROM candidates
      ON CONFLICT(make_id,model_id,generation,listing_id) DO NOTHING RETURNING 1
    ), last_candidate AS (
      SELECT published_at,listing_id FROM candidates ORDER BY published_at,listing_id DESC LIMIT 1
    )
    SELECT (SELECT count(*) FROM candidates)::integer AS candidates,
           (SELECT count(*) FROM added)::integer AS added,
           (SELECT published_at::text FROM last_candidate) AS last_published_at,
           (SELECT listing_id FROM last_candidate) AS last_listing_id`, values);
  if (!result) throw new MarketMaintenanceError('Market projection seed did not return a page.');
  const exhausted = result.candidates < seedPageSize;
  if (!exhausted && (!result.last_published_at || !result.last_listing_id)) {
    throw new MarketMaintenanceError('Market projection seed did not return a complete cursor.');
  }
  const finished = exhausted && state.seed_mask === 7;
  const nextMask = exhausted && !finished ? state.seed_mask + 1 : state.seed_mask;
  // PostgreSQL passes its own timestamp text across calls to preserve microseconds.
  await tx.query(`UPDATE public.external_market_quote_models
    SET phase=$4,seed_mask=$5,seed_published_at=$6::timestamptz,seed_listing_id=$7::uuid,updated_at=clock_timestamp()
    WHERE ${pendingWhere}`, [...scope, finished ? 'filling' : 'preparing', nextMask,
    exhausted ? null : result.last_published_at, exhausted ? null : result.last_listing_id]);
  return report(input, await readModel(tx, input), { processed: result.added });
}

async function step(tx: PoolClient, input: Maintenance, state: ModelState) {
  if (state.phase === 'verified' || state.phase === 'ready') return report(input, state, { processed: 0 });
  if (state.phase !== 'filling') throw new MarketMaintenanceError('Seed this generation before refreshing it.');
  const scope = [input.make, input.model, input.generation];
  const { rows } = await tx.query<{ listing_id: string }>(`SELECT listing_id
    FROM public.external_market_quote_pending WHERE ${pendingWhere} ORDER BY listing_id LIMIT $4`, [...scope, batchSize]);
  const ids = rows.map(row => row.listing_id);
  if (ids.length) {
    await tx.query(`SELECT public.refresh_external_market_quote(target.listing_id)
      FROM unnest($1::uuid[]) AS target(listing_id)`, [ids]);
    const { rows: [verification] } = await tx.query<{ matches: boolean }>(
      'SELECT public.verify_external_market_quote_batch($1::uuid[]) AS matches', [ids]);
    if (verification?.matches !== true) throw new MarketMaintenanceError('Market projection batch differs from authoritative data.');
    const deleted = await tx.query(`DELETE FROM public.external_market_quote_pending
      WHERE ${pendingWhere} AND listing_id=ANY($4::uuid[])`, [...scope, ids]);
    if (deleted.rowCount !== ids.length) throw new MarketMaintenanceError('Market projection batch changed during verification.');
  }
  const after = await readModel(tx, input);
  if (!after) throw new MarketMaintenanceError('Market projection enrollment changed during the batch.');
  await setPhase(tx, input, after.pending ? 'filling' : 'verified');
  return report(input, await readModel(tx, input), { processed: ids.length });
}

export async function maintainMarketProjection(db: Database, input: Maintenance) {
  validate(input);
  return db.transaction(async tx => {
    await tx.query(input.action === 'status'
      ? 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED READ ONLY'
      : 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await tx.query(`SET LOCAL lock_timeout='220ms'; SET LOCAL statement_timeout='1200ms';
      SET LOCAL transaction_timeout='3s'; SET LOCAL jit=off; SET LOCAL max_parallel_workers_per_gather=0;
      SET LOCAL TIME ZONE 'UTC'`);
    const { rows: [target] } = await tx.query<{ matches: boolean }>('SELECT current_database()=$1 AS matches', [input.database]);
    if (target?.matches !== true) throw new MarketMaintenanceError('Market projection database target does not match.');
    if (input.action === 'status') return report(input, await readModel(tx, input));
    const { rows: [guard] } = await tx.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock(78291332) AS locked');
    if (!guard?.locked) return { status: 'busy' } as const;

    if (input.action === 'begin') return begin(tx, input);
    const state = await readModel(tx, input);
    if (!state || state.generation !== input.generation) throw new MarketMaintenanceError('Market projection generation does not match.');
    if (input.action === 'disable') {
      if (state.phase !== 'disabled') {
        // A rollback to the authoritative reader never waits to clear the queue.
        await setPhase(tx, input, 'disabled');
        return report(input, await readModel(tx, input));
      }
      const discarded = await discardRetiredPending(tx, input);
      return report(input, await readModel(tx, input), { discarded });
    }
    if (state.phase === 'disabled') throw new MarketMaintenanceError('Begin a new generation before changing a disabled projection.');
    if (input.action === 'seed') return seed(tx, input, state);
    if (input.action === 'step') return step(tx, input, state);
    if ((state.phase !== 'verified' && state.phase !== 'ready') || state.pending) {
      throw new MarketMaintenanceError('Market projection activation requires successful verification and an empty pending queue.');
    }
    if (state.phase !== 'ready') await setPhase(tx, input, 'ready');
    return report(input, await readModel(tx, input));
  });
}

async function run() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { make: { type: 'string' }, model: { type: 'string' }, database: { type: 'string' }, generation: { type: 'string' } },
  });
  const action = actions.find(value => value === positionals[0]);
  if (!action || positionals.length !== 1 || !values.make || !values.model || !values.database) {
    throw new MarketMaintenanceError(usage);
  }
  const input = { action, make: values.make, model: values.model, database: values.database, generation: values.generation };
  validate(input);
  const env = readDatabaseEnvironment();
  const address = new URL(env.DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(address.protocol) || decodeURIComponent(address.pathname.slice(1)) !== input.database
      || (env.NODE_ENV === 'production' && !/^(?:[a-f0-9]{40,64}|sha256:[a-f0-9]{64})$/.test(env.HD_RELEASE_ID ?? ''))) {
    throw new MarketMaintenanceError('Explicit market projection database and release target required.');
  }

  const db = createDatabase(address.toString(), 1);
  try {
    const result = await maintainMarketProjection(db, input);
    console.log(JSON.stringify(result));
    if ('status' in result && result.status === 'busy') process.exitCode = 75;
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run().catch(error => {
    console.error(error instanceof MarketMaintenanceError ? error.message : 'Market projection maintenance failed.');
    process.exitCode = 1;
  });
}
