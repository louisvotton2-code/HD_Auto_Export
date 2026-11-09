import { randomUUID } from 'node:crypto';
import {
  EXTERNAL_TRIAL_CHARACTER_LIMIT, type ExternalTrial, type ExternalTrialField, type ExternalTrialRequest, type ExternalUpsertCandidate,
} from '@hd/contracts/admin';
import type { Locale } from '@hd/contracts/public';
import type { PoolClient } from 'pg';
import type { Database } from '../db/index.js';
import { ApiError, notFound } from '../errors.js';
import type { Actor } from '../vehicles/service.js';
import { listingUuid, publicListingId } from './catalog.js';
import { copyFields, glossaryModel, jsonHash, locales, sourceCopy, sourceHashes } from './normalize.js';

type Estimate = ExternalTrial['estimate'];
type TrialRow = { id: string; month: string; report: ExternalTrial; reserved_characters: number; attempted_characters: number };
type ArchivedListing = { listing_id: string; candidate: ExternalUpsertCandidate };
type WorkMember = { id: string; field: ExternalTrialField; sourceHash: string };
type Demand = { callKey: string; characters: number; text: string; sourceLanguage: string; target: Locale; member: WorkMember };
type Work = Omit<Demand, 'member'> & { members: WorkMember[] };
const estimates = (): Estimate => ({ grossCharacters: 0, existingCharacters: 0, glossaryCharacters: 0, cachedCharacters: 0,
  duplicateCharacters: 0, estimatedCharacters: 0, estimatedCalls: 0 });
const currentMonth = "date_trunc('month',clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date";
const trialColumns = 'id,month::text,report,reserved_characters,attempted_characters';
const monthVerified = `month=${currentMonth} AND verified_until>clock_timestamp()`;

function trialView(row: TrialRow): ExternalTrial {
  return { ...row.report, budget: { ...row.report.budget, reservedCharacters: row.reserved_characters, attemptedCharacters: row.attempted_characters } };
}

async function planWork(tx: PoolClient, rows: ArchivedListing[]) {
  const counters = { title: estimates(), model: estimates(), description: estimates() };
  const demands: Demand[] = [];
  for (const { listing_id, candidate } of rows) {
    const copy = sourceCopy(candidate);
    const hashes = sourceHashes(candidate, copy);
    for (const field of copyFields) {
      const content = copy[field];
      if (!content || content.original.contentLocale === 'und') continue;
      const { text, contentLocale } = content.original;
      const counts = counters[field];
      // Conservative UTF-16 units preserve whitespace and count supplementary characters as two.
      const characters = text.length;
      for (const target of locales) {
        if (contentLocale.split('-')[0] === target) continue;
        counts.grossCharacters += characters;
        if (content.translations[target]) counts.existingCharacters += characters;
        else if (field === 'model' && glossaryModel(candidate, target, content.original)) counts.glossaryCharacters += characters;
        else {
          const context = field === 'model' ? [candidate.facts.make?.id, candidate.facts.model?.id] : [];
          const callKey = jsonHash(['aliyun-cn-general:dry-run-v1', 'synthetic-glossary:v1', field, context, contentLocale, target, text]);
          demands.push({ callKey, characters, text, sourceLanguage: contentLocale, target,
            member: { id: publicListingId(listing_id), field, sourceHash: hashes[field]! } });
        }
      }
    }
  }
  const cached = new Set((await tx.query<{ call_key: string }>('SELECT call_key FROM external_translation_cache WHERE call_key=ANY($1::text[])',
    [[...new Set(demands.map(demand => demand.callKey))]])).rows.map(row => row.call_key));
  const work = new Map<string, Work>();
  for (const { member, ...demand } of demands) {
    const counts = counters[member.field];
    const duplicate = work.get(demand.callKey);
    if (cached.has(demand.callKey)) counts.cachedCharacters += demand.characters;
    else if (duplicate) {
      counts.duplicateCharacters += demand.characters;
      duplicate.members.push(member);
    } else {
      counts.estimatedCharacters += demand.characters;
      counts.estimatedCalls++;
      work.set(demand.callKey, { ...demand, members: [member] });
    }
  }
  const byField = copyFields.map(field => ({ field, ...counters[field] }));
  const estimate = estimates();
  for (const key of Object.keys(estimate) as (keyof Estimate)[]) estimate[key] = byField.reduce((sum, row) => sum + row[key], 0);
  return { byField, estimate, work: [...work.values()] };
}

export async function getTrial(db: Database, batchId: string): Promise<ExternalTrial | null> {
  const batch = await db.pool.query('SELECT 1 FROM external_import_batches WHERE id=$1', [batchId]);
  if (!batch.rowCount) throw notFound();
  const result = await db.pool.query<TrialRow>(`SELECT ${trialColumns} FROM external_translation_trials WHERE batch_id=$1`, [batchId]);
  return result.rows[0] ? trialView(result.rows[0]) : null;
}

export async function createTrial(db: Database, batchId: string, input: ExternalTrialRequest, actor: Actor): Promise<ExternalTrial> {
  return db.transaction(async tx => {
    if (!(await tx.query('SELECT 1 FROM external_import_batches WHERE id=$1 FOR UPDATE', [batchId])).rowCount) throw notFound();
    const prior = (await tx.query<TrialRow>(`SELECT ${trialColumns} FROM external_translation_trials WHERE batch_id=$1`, [batchId])).rows[0];
    if (prior) {
      if (prior.report.vehicleIds.some((id, index) => id !== input.vehicleIds[index])) {
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This batch already has a fixed trial selection.');
      }
      return trialView(prior);
    }
    const candidates = (await tx.query<ArchivedListing>(`SELECT listing_id,candidate FROM (
      SELECT DISTINCT ON(listing_id) listing_id,candidate,operation FROM external_import_records
      WHERE batch_id=$1 AND listing_id=ANY($2::uuid[]) AND status IN ('applied','unchanged') ORDER BY listing_id,row_number DESC
    ) records WHERE operation='upsert'`, [batchId, input.vehicleIds.map(listingUuid)])).rows;
    const byId = new Map(candidates.map(row => [publicListingId(row.listing_id), row]));
    if (candidates.length !== input.vehicleIds.length) {
      throw new ApiError(422, 'EXTERNAL_RESTRICTION', 'Trial members must have an accepted listing snapshot in the same batch.');
    }
    const { byField, estimate, work } = await planWork(tx, input.vehicleIds.map(id => byId.get(id)!));
    const clock = (await tx.query<{ month: string; at: Date }>(`SELECT (${currentMonth})::text AS month,clock_timestamp() AS at`)).rows[0]!;
    const report: ExternalTrial = { id: randomUUID(), batchId, createdAt: clock.at.toISOString(), status: 'dry_run',
      vehicleIds: input.vehicleIds, byField, estimate, budget: { month: clock.month.slice(0, 7), batchLimit: EXTERNAL_TRIAL_CHARACTER_LIMIT,
        accountFreeRemaining: null, reservedCharacters: 0, attemptedCharacters: 0, realCalls: 0 } };
    await tx.query('INSERT INTO external_translation_months(month) VALUES($1) ON CONFLICT DO NOTHING', [clock.month]);
    await tx.query('INSERT INTO external_translation_trials(id,batch_id,actor_id,month,report) VALUES($1,$2,$3,$4,$5)',
      [report.id, batchId, actor.id, clock.month, JSON.stringify(report)]);
    await tx.query(`INSERT INTO external_translation_work(trial_id,call_key,characters,data)
      SELECT $1, item->>'callKey', (item->>'characters')::integer, item FROM jsonb_array_elements($2::jsonb) item`, [report.id, JSON.stringify(work)]);
    return report;
  });
}

// Worker-facing budget primitives. Phase one exposes estimation only and has no provider dispatch path.
async function lockTrial(tx: PoolClient, id: string) {
  const row = (await tx.query<TrialRow>(`SELECT ${trialColumns} FROM external_translation_trials WHERE id=$1 FOR UPDATE`, [id])).rows[0];
  if (!row) throw notFound();
  return row;
}

export async function reserveTrialAttempt(db: Database, trialId: string, callKey: string, attemptId: string) {
  return db.transaction(async tx => {
    const trial = await lockTrial(tx, trialId);
    const prior = (await tx.query<{ call_key: string }>('SELECT call_key FROM external_translation_reservations WHERE trial_id=$1 AND attempt_id=$2',
      [trialId, attemptId])).rows[0];
    if (prior) {
      if (prior.call_key !== callKey) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This attempt already identifies different work.');
      return false;
    }
    const work = (await tx.query<{ characters: number }>(`SELECT characters FROM external_translation_work w WHERE trial_id=$1 AND call_key=$2
      AND NOT EXISTS(SELECT 1 FROM external_translation_reservations r WHERE r.trial_id=w.trial_id AND r.call_key=w.call_key AND r.finished_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM external_translation_cache cache WHERE cache.call_key=w.call_key)`, [trialId, callKey])).rows[0];
    if (!work || trial.reserved_characters + trial.attempted_characters + work.characters > EXTERNAL_TRIAL_CHARACTER_LIMIT) return false;
    const reserved = await tx.query(`UPDATE external_translation_months SET reserved_characters=reserved_characters+$2
      WHERE month=$1 AND ${monthVerified} AND attempted_characters+reserved_characters+$2<=verified_allowance`, [trial.month, work.characters]);
    if (!reserved.rowCount) return false;
    await tx.query('UPDATE external_translation_trials SET reserved_characters=reserved_characters+$2 WHERE id=$1', [trialId, work.characters]);
    await tx.query('INSERT INTO external_translation_reservations(trial_id,attempt_id,call_key,characters) VALUES($1,$2,$3,$4)',
      [trialId, attemptId, callKey, work.characters]);
    return true;
  });
}

export async function markTrialAttemptDispatched(db: Database, trialId: string, attemptId: string) {
  return db.transaction(async tx => {
    const trial = await lockTrial(tx, trialId);
    const reservation = (await tx.query<{ characters: number }>(`SELECT characters FROM external_translation_reservations
      WHERE trial_id=$1 AND attempt_id=$2 AND dispatched_at IS NULL`, [trialId, attemptId])).rows[0];
    if (!reservation) return false;
    const { characters } = reservation;
    const month = await tx.query(`UPDATE external_translation_months SET reserved_characters=reserved_characters-$2,
      attempted_characters=attempted_characters+$2 WHERE month=$1 AND ${monthVerified}`, [trial.month, characters]);
    if (!month.rowCount) return false;
    await tx.query(`UPDATE external_translation_trials SET reserved_characters=reserved_characters-$2,
      attempted_characters=attempted_characters+$2 WHERE id=$1`, [trialId, characters]);
    await tx.query('UPDATE external_translation_reservations SET dispatched_at=clock_timestamp() WHERE trial_id=$1 AND attempt_id=$2', [trialId, attemptId]);
    return true;
  });
}

/** Failure and timeout close the in-flight claim but keep the entire dispatched charge. */
export async function finishTrialAttempt(db: Database, trialId: string, attemptId: string) {
  await db.pool.query(`UPDATE external_translation_reservations SET finished_at=clock_timestamp()
    WHERE trial_id=$1 AND attempt_id=$2 AND dispatched_at IS NOT NULL AND finished_at IS NULL`, [trialId, attemptId]);
}
