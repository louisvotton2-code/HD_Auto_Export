import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { EXTERNAL_TRIAL_CHARACTER_LIMIT } from '@hd/contracts/admin';
import { makeExternalImportFixture } from '@hd/contracts/fixtures';
import type { Config } from '../config.js';
import { readConfig } from '../config.js';
import { createDatabase, type Database } from '../db/index.js';
import { readDatabaseEnvironment } from '../local-secrets.js';
import { ExternalStore } from './store.js';
import { createTrial, finishTrialAttempt, markTrialAttemptDispatched, reserveTrialAttempt } from './trial.js';

type Work = { call_key: string; data: { text: string; sourceLanguage: string; target: string } };
type Attempt = { attempt_id: string; dispatched_at: Date | null };
type TrialProvider = (input: Work['data']) => Promise<string>;
const simulatedProvider: TrialProvider = async input => `[simulated ${input.target}] ${input.text}`;
const actor = { id: 'hd-ext-scale-trial-fixture', requestId: 'capacity-trial-simulation' };

async function withScaleDb<T>(config: Config, operation: (db: Database) => Promise<T>): Promise<T> {
  if (!config.externalScale || config.translation.provider !== 'disabled') throw new Error('Trial simulation requires the isolated capacity mode');
  const db = createDatabase(config.databaseUrl, 2);
  try { return await operation(db); } finally { await db.close(); }
}

async function requireSyntheticTrial(db: Database, id: string) {
  const row = (await db.pool.query<{ month: string }>(`SELECT t.month::text AS month FROM external_translation_trials t
    JOIN external_import_batches b ON b.id=t.batch_id WHERE t.id=$1 AND b.provider='synthetic-feed'
    AND jsonb_array_length(t.report->'vehicleIds')=100`, [z.uuid().parse(id)])).rows[0];
  if (!row) throw new Error('An archived synthetic trial is required');
  return row;
}

export async function seedTrialSimulation(config: Config) {
  return withScaleDb(config, async db => {
    await db.pool.query(`INSERT INTO staff(id,name,email,role,banned) VALUES($1,'Trial fixture','scale-trial@example.invalid','editor',true)
      ON CONFLICT(id) DO NOTHING`, [actor.id]);
    const store = new ExternalStore(db);
    const batch = await store.importBatch(makeExternalImportFixture(100), 'scale-trial-fixture-v1', actor);
    const records = await store.listRecords(batch.id, { page: 1, pageSize: 100 });
    const vehicleIds = records.items.flatMap(item => item.status === 'applied' && item.listingId ? [item.listingId] : []);
    if (new Set(vehicleIds).size !== 100) throw new Error('Expected a complete fixed synthetic fixture');
    return createTrial(db, batch.id, { vehicleIds }, actor);
  });
}

export async function grantSimulationAllowance(config: Config, id: string, characters: number) {
  if (!Number.isInteger(characters) || characters < 1 || characters > EXTERNAL_TRIAL_CHARACTER_LIMIT) throw new Error('Invalid simulation allowance');
  return withScaleDb(config, async db => {
    const { month } = await requireSyntheticTrial(db, id);
    const result = await db.pool.query(`UPDATE external_translation_months SET verified_allowance=$2,
      verified_until=clock_timestamp()+interval '1 hour' WHERE month=$1
      AND month=date_trunc('month',clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date
      AND reserved_characters+attempted_characters<=$2`, [month, characters]);
    if (!result.rowCount) throw new Error('Simulation allowance cannot cover existing reservations');
    return { simulationAllowance: characters, realCalls: 0 };
  });
}

export async function runTrialSimulation(config: Config, id: string, options: { limit: number; interruptAfterDispatch?: boolean }) {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) throw new Error('Invalid simulation work limit');
  return withScaleDb(config, async db => {
    await requireSyntheticTrial(db, id);
    // A separate connection owns the per-trial process lock. A crash releases the lock but not the budget.
    const lock = await db.pool.connect();
    try {
      const lease = await lock.query<{ acquired: boolean }>(`SELECT pg_try_advisory_lock(hashtextextended('trial-simulation:'||($1::uuid)::text,0)) AS acquired`, [id]);
      if (!lease.rows[0]?.acquired) return { status: 'busy' as const, realCalls: 0 };
      const work = await db.pool.query<Work>(`SELECT w.call_key,w.data FROM external_translation_work w WHERE w.trial_id=$1
        AND NOT EXISTS(SELECT 1 FROM external_translation_simulation_results r WHERE r.trial_id=w.trial_id AND r.call_key=w.call_key)
        AND (SELECT count(*) FROM external_translation_reservations a WHERE a.trial_id=w.trial_id AND a.call_key=w.call_key AND a.finished_at IS NOT NULL)<3
        ORDER BY w.call_key LIMIT $2`, [id, options.limit]);
      const result = { status: 'completed' as const, processed: 0, budgetBlocked: 0, recoveredUncertain: 0, realCalls: 0 };
      for (const item of work.rows) {
        const inflight = (await db.pool.query<Attempt>(`SELECT attempt_id,dispatched_at FROM external_translation_reservations
          WHERE trial_id=$1 AND call_key=$2 AND finished_at IS NULL`, [id, item.call_key])).rows[0];
        if (inflight?.dispatched_at) {
          // We cannot assume an interrupted dispatch was free. Close it while retaining its charge.
          await finishTrialAttempt(db, id, inflight.attempt_id);
          result.recoveredUncertain++;
          const prior = await db.pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM external_translation_reservations
            WHERE trial_id=$1 AND call_key=$2`, [id, item.call_key]);
          if (prior.rows[0]!.total >= 3) continue;
        }
        const outstanding = inflight && !inflight.dispatched_at ? inflight.attempt_id : null;
        const attempt = outstanding ?? randomUUID();
        if ((!outstanding && !await reserveTrialAttempt(db, id, item.call_key, attempt)) ||
            !await markTrialAttemptDispatched(db, id, attempt)) { result.budgetBlocked++; continue; }
        if (options.interruptAfterDispatch) throw new Error('Simulated interruption after durable dispatch');
        try {
          const translated = await simulatedProvider(item.data);
          await db.transaction(async tx => {
            await tx.query(`INSERT INTO external_translation_simulation_results(trial_id,call_key,attempt_id,result) VALUES($1,$2,$3,$4)`,
              [id, item.call_key, attempt, translated]);
            await tx.query(`UPDATE external_translation_reservations SET finished_at=clock_timestamp()
              WHERE trial_id=$1 AND attempt_id=$2 AND finished_at IS NULL AND dispatched_at IS NOT NULL`, [id, attempt]);
          });
          result.processed++;
        } catch (error) {
          await finishTrialAttempt(db, id, attempt);
          throw error;
        }
      }
      return result;
    } finally {
      // Destroy this session so PostgreSQL releases its advisory lock even on error.
      lock.release(true);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [action, id, value, fault] = process.argv.slice(2);
    const env = readDatabaseEnvironment();
    const config = readConfig({ ...env, AUTH_SECRET_FILE: undefined, AUTH_SECRET: 'capacity-trial-no-http-listener-secret' });
    if (action === '--seed' && !id) {
      const trial = await seedTrialSimulation(config);
      console.log(JSON.stringify({ trialId: trial.id, estimatedCharacters: trial.estimate.estimatedCharacters, realCalls: 0 }));
    } else if (action === '--grant' && id && value && !fault) console.log(JSON.stringify(await grantSimulationAllowance(config, id, Number(value))));
    else if (action === '--run' && id && (!fault || fault === '--interrupt-after-dispatch')) {
      console.log(JSON.stringify(await runTrialSimulation(config, id, { limit: value ? Number(value) : 20, interruptAfterDispatch: !!fault })));
    } else throw new Error('Invalid trial simulation command');
  } catch {
    console.error('Capacity trial simulation stopped.');
    process.exitCode = 1;
  }
}
