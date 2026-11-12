import { createHash, randomUUID } from 'node:crypto';
import {
  TranslationPlanSchema, TranslationPlanResultSchema, GenerateTranslationPlanRequestSchema,
  getTranslationPlanTextLimit, translationRequestCount,
  type TranslationPlan, type TranslationPlanResult, type GenerateTranslationPlanRequest,
} from '@hd/contracts/admin';
import type { Database } from '../db/index.js';
import { ApiError, conflict, notFound } from '../errors.js';
import type { Actor } from './service.js';
import { splitTranslationText, TranslationResultValidationError, type VehicleTranslator } from './translation.js';

type Target = 'en' | 'ru';
type Failure = TranslationPlanResult['failures'][number]['code'];
export type TranslationPlanInputField = {
  ref: TranslationPlan['fields'][number]['ref']; sourceText: string; sourceVersion: number; sourceHash: string;
  targetHumanEditVersions: { zh: number | null; en: number | null; ru: number | null };
};
export type TranslationPlanInput = {
  vehicleId: string; vehicleVersion: number; localizationRevision: number; fields: TranslationPlanInputField[];
};
export type LoadTranslationPlanInput = (vehicleId: string, actor: Actor) => Promise<TranslationPlanInput>;
type Metadata = ReturnType<VehicleTranslator['metadata']>;
export type StoredTranslationPlan = {
  plan: TranslationPlan; input: TranslationPlanInput; actorId: string;
  state: 'ready' | 'running' | 'interrupted' | 'finished'; key: string | null; requestHash: string | null;
  runToken: string | null; startedAt: string | null; finishedAt: string | null;
  expired: boolean; leaseExpired: boolean; result: TranslationPlanResult | null;
};
export type TranslationPlanSegment = {
  ref: string; target: Target; index: number; cacheKey: string;
  state: 'running' | 'succeeded' | 'failed' | 'outcome_unknown'; text: string | null; failure: Failure | null;
  cacheable?: boolean;
};

/** Domain-specific persistence seam for deterministic fake-provider tests; not a background job API. */
export interface TranslationPlanPersistence {
  now(): Promise<Date>;
  insert(plan: TranslationPlan, input: TranslationPlanInput, actorId: string): Promise<void>;
  get(vehicleId: string, planId: string, actorId: string): Promise<StoredTranslationPlan | null>;
  claim(record: StoredTranslationPlan, key: string, requestHash: string, runToken: string): Promise<void>;
  interrupt(record: StoredTranslationPlan): Promise<void>;
  segments(planId: string): Promise<TranslationPlanSegment[]>;
  startSegment(record: StoredTranslationPlan, segment: TranslationPlanSegment): Promise<TranslationPlanSegment>;
  finishSegment(record: StoredTranslationPlan, segment: TranslationPlanSegment): Promise<void>;
  invalidateTarget(record: StoredTranslationPlan, ref: string, target: Target): Promise<void>;
  finish(record: StoredTranslationPlan, result: TranslationPlanResult): Promise<TranslationPlanResult>;
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const busy = () => new ApiError(503, 'TRANSLATION_BUSY', 'This translation plan is already running. Check its status before retrying.', undefined, true);
const keyConflict = () => new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This plan or key was already used for different generation input.');

/** Includes source identity and employee edits, not just visible source strings. */
export function translationPlanFingerprint(input: TranslationPlanInput, metadata: Metadata): string {
  return digest([input.vehicleId.toLowerCase(), input.vehicleVersion, input.localizationRevision, metadata.provider, metadata.engineVersion,
    [...input.fields].sort((a, b) => a.ref.localeCompare(b.ref)).map(field => [field.ref, field.sourceText, field.sourceVersion, field.sourceHash,
      field.targetHumanEditVersions.zh, field.targetHumanEditVersions.en, field.targetHumanEditVersions.ru])]);
}

const units = new Set(['cc', 'cm3', 'kW', 'kWh', 'hp', 'Nm', 'km', 'kg', 'mm', 'cm', 'L', 'l', 'V', 'Ah', 'mAh', 'Hz', 'GHz', 'MPa', 'psi', 'USD', 'CNY', 'RUB', 'EUR']);
function protectedTokens(text: string): string[] {
  const tokens = [...text.matchAll(/\d+(?:[.,:/-]\d+)*/gu)].map(match => `number:${match[0]}`);
  for (const [symbol] of text.matchAll(/[%$€₽¥℃℉°]/gu)) tokens.push(`unit:${symbol}`);
  for (const [word] of text.matchAll(/[A-Za-z0-9]+(?:[._/-][A-Za-z0-9]+)*/gu)) {
    const attachedUnit = /^\d+(?:\.\d+)?([A-Za-z]+)$/.exec(word)?.[1];
    if (attachedUnit && units.has(attachedUnit)) tokens.push(`unit:${attachedUnit}`);
    else if (units.has(word)) tokens.push(`unit:${word}`);
    else if ((/\d/.test(word) && /[A-Za-z]/.test(word)) || /^[A-Z]{2,}$/.test(word)) tokens.push(`model:${word}`);
  }
  // Units immediately following a number are tokenized independently above too.
  return tokens.sort();
}
/** Conservative token check only; successful machine output still requires employee review. */
export function validateTranslationTokens(source: string, translated: string): boolean {
  return JSON.stringify(protectedTokens(source)) === JSON.stringify(protectedTokens(translated));
}

export class PgTranslationPlanPersistence implements TranslationPlanPersistence {
  constructor(private db: Database) {}
  async now() { return (await this.db.pool.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now; }
  async insert(plan: TranslationPlan, input: TranslationPlanInput, actorId: string) {
    await this.db.pool.query(`INSERT INTO translation_plans(id,vehicle_id,actor_id,plan,source_input,created_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [plan.id, plan.vehicleId, actorId, JSON.stringify(plan), JSON.stringify(input), plan.createdAt, plan.expiresAt]);
  }
  async get(vehicleId: string, planId: string, actorId: string): Promise<StoredTranslationPlan | null> {
    const row = (await this.db.pool.query(`SELECT *,expires_at<=clock_timestamp() AS expired,
      lease_until<=clock_timestamp() AS lease_expired FROM translation_plans WHERE id=$1 AND vehicle_id=$2 AND actor_id=$3`, [planId, vehicleId, actorId])).rows[0];
    return row ? { plan: TranslationPlanSchema.parse(row.plan), input: row.source_input, actorId: row.actor_id, state: row.state,
      key: row.generation_key, requestHash: row.request_hash, runToken: row.run_token,
      startedAt: row.started_at?.toISOString() ?? null, finishedAt: row.finished_at?.toISOString() ?? null,
      expired: row.expired, leaseExpired: !!row.lease_expired, result: row.result ? TranslationPlanResultSchema.parse(row.result) : null } : null;
  }
  async claim(record: StoredTranslationPlan, key: string, requestHash: string, runToken: string) {
    await this.db.transaction(async tx => {
      const staff = (await tx.query('SELECT banned FROM staff WHERE id=$1 FOR SHARE', [record.actorId])).rows[0];
      if (!staff || staff.banned) throw new ApiError(401, 'UNAUTHENTICATED', 'Staff session is no longer active.');
      const vehicle = (await tx.query('SELECT version,deleted_at FROM vehicles WHERE id=$1 FOR SHARE', [record.plan.vehicleId])).rows[0];
      const localization = (await tx.query('SELECT revision FROM vehicle_localizations WHERE vehicle_id=$1', [record.plan.vehicleId])).rows[0];
      if (!vehicle || vehicle.deleted_at || vehicle.version !== record.plan.vehicleVersion || (localization?.revision ?? 0) !== record.plan.localizationRevision) throw conflict();
      const updated = await tx.query(`WITH timing AS (SELECT clock_timestamp() AS at)
        UPDATE translation_plans SET state='running',generation_key=$2,request_hash=$3,run_token=$4,
        started_at=timing.at,lease_until=timing.at+interval '150 seconds' FROM timing
        WHERE id=$1 AND state='ready' AND expires_at>timing.at`, [record.plan.id, key, requestHash, runToken]);
      if (!updated.rowCount) throw conflict();
    });
  }
  async interrupt(record: StoredTranslationPlan) {
    await this.db.transaction(async tx => {
      const changed = await tx.query(`UPDATE translation_plans SET state='interrupted' WHERE id=$1 AND run_token=$2
        AND state='running' AND lease_until<=clock_timestamp() RETURNING id`, [record.plan.id, record.runToken]);
      if (changed.rowCount) await tx.query(`UPDATE translation_plan_segments SET state='outcome_unknown',failure_code='outcome_unknown',updated_at=clock_timestamp()
        WHERE plan_id=$1 AND state='running'`, [record.plan.id]);
    });
  }
  async segments(planId: string): Promise<TranslationPlanSegment[]> {
    return (await this.db.pool.query('SELECT * FROM translation_plan_segments WHERE plan_id=$1', [planId])).rows.map(row => ({
      ref: row.field_ref, target: row.target_locale, index: row.segment_index, cacheKey: row.cache_key, state: row.state,
      text: row.translated_text, failure: row.failure_code,
      cacheable: row.cache_valid,
    }));
  }
  async startSegment(record: StoredTranslationPlan, segment: TranslationPlanSegment): Promise<TranslationPlanSegment> {
    return this.db.transaction(async tx => {
      const lease = (await tx.query(`SELECT id FROM translation_plans WHERE id=$1 AND run_token=$2 AND state='running'
        AND lease_until>clock_timestamp() FOR UPDATE`, [record.plan.id, record.runToken])).rows[0];
      if (!lease) throw busy();
      const old = (await tx.query('SELECT * FROM translation_plan_segments WHERE plan_id=$1 AND field_ref=$2 AND target_locale=$3 AND segment_index=$4',
        [record.plan.id, segment.ref, segment.target, segment.index])).rows[0];
      if (old) return { ...segment, state: old.state === 'running' ? 'outcome_unknown' : old.state,
        text: old.translated_text, failure: old.state === 'running' ? 'outcome_unknown' : old.failure_code };
      const cached = (await tx.query(`SELECT translated_text FROM translation_plan_segments WHERE cache_key=$1 AND state='succeeded' AND cache_valid
        AND updated_at>clock_timestamp()-interval '24 hours' ORDER BY updated_at DESC LIMIT 1`, [segment.cacheKey])).rows[0];
      const invalidated = !cached && !!(await tx.query('SELECT 1 FROM translation_plan_segments WHERE cache_key=$1 AND NOT cache_valid LIMIT 1', [segment.cacheKey])).rows[0];
      const next: TranslationPlanSegment = cached ? { ...segment, state: 'succeeded', text: cached.translated_text } : { ...segment, cacheable: !invalidated };
      await tx.query(`INSERT INTO translation_plan_segments(plan_id,field_ref,target_locale,segment_index,cache_key,state,translated_text)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [record.plan.id, next.ref, next.target, next.index, next.cacheKey, next.state, next.text]);
      return next;
    });
  }
  async finishSegment(record: StoredTranslationPlan, segment: TranslationPlanSegment) {
    const result = await this.db.pool.query(`UPDATE translation_plan_segments s SET state=$6,translated_text=$7,failure_code=$8,updated_at=clock_timestamp()
      WHERE plan_id=$1 AND field_ref=$2 AND target_locale=$3 AND segment_index=$4 AND s.state='running'
      AND EXISTS(SELECT FROM translation_plans p WHERE p.id=s.plan_id AND p.run_token=$5 AND p.state='running' AND p.lease_until>clock_timestamp())`,
    [record.plan.id, segment.ref, segment.target, segment.index, record.runToken, segment.state, segment.text, segment.failure]);
    if (!result.rowCount) throw busy();
  }
  async invalidateTarget(record: StoredTranslationPlan, ref: string, target: Target) {
    // Invalidate donor cache eligibility too: a copied partial success must not
    // continually restore an output rejected after whole-field assembly. Keep
    // historical segment outcomes and already finalized receipts unchanged.
    await this.db.pool.query(`WITH affected AS MATERIALIZED (
      SELECT s.plan_id,s.field_ref,s.target_locale,s.segment_index FROM translation_plan_segments s
      WHERE s.cache_valid AND s.cache_key IN (SELECT cache_key FROM translation_plan_segments
        WHERE plan_id=$1 AND field_ref=$2 AND target_locale=$3)
      ORDER BY s.plan_id,s.field_ref,s.target_locale,s.segment_index FOR UPDATE)
      UPDATE translation_plan_segments s SET cache_valid=false FROM affected a
      WHERE (s.plan_id,s.field_ref,s.target_locale,s.segment_index)=(a.plan_id,a.field_ref,a.target_locale,a.segment_index)`,
    [record.plan.id, ref, target]);
    await this.db.pool.query(`UPDATE translation_plan_segments s SET state='failed',translated_text=NULL,failure_code='invalid_result',cache_valid=false,updated_at=clock_timestamp()
      WHERE plan_id=$1 AND field_ref=$2 AND target_locale=$3 AND s.state='succeeded'
      AND EXISTS(SELECT FROM translation_plans p WHERE p.id=s.plan_id AND p.run_token=$4 AND p.state='running' AND p.lease_until>clock_timestamp())`,
    [record.plan.id, ref, target, record.runToken]);
  }
  async finish(record: StoredTranslationPlan, result: TranslationPlanResult) {
    const updated = await this.db.pool.query(`UPDATE translation_plans SET state='finished',result=$3,finished_at=clock_timestamp()
      WHERE id=$1 AND run_token=$2 AND state IN ('running','interrupted') RETURNING result`, [record.plan.id, record.runToken, JSON.stringify(result)]);
    if (updated.rows[0]) return TranslationPlanResultSchema.parse(updated.rows[0].result);
    const current = await this.get(record.plan.vehicleId, record.plan.id, record.actorId);
    if (current?.result) return current.result;
    throw busy();
  }
}

export class TranslationPlanService {
  private persistence: TranslationPlanPersistence;
  private running = new Map<string, { hash: string; key: string; promise: Promise<TranslationPlanResult> }>();
  constructor(db: Database, private translator: VehicleTranslator, private loadInput: LoadTranslationPlanInput,
    persistence?: TranslationPlanPersistence) { this.persistence = persistence ?? new PgTranslationPlanPersistence(db); }

  async create(vehicleId: string, request: { version: number }, actor: Actor): Promise<TranslationPlan> {
    const input = await this.loadInput(vehicleId, actor);
    if (input.vehicleId.toLowerCase() !== vehicleId.toLowerCase() || input.vehicleVersion !== request.version) throw conflict();
    const metadata = this.translator.metadata(), created = await this.persistence.now();
    const fields = input.fields.map(field => ({ ref: field.ref, sourceText: field.sourceText, sourceVersion: field.sourceVersion,
      sourceHash: field.sourceHash, mode: 'translate' as const, sourceCharacters: field.sourceText.length }));
    const plan = TranslationPlanSchema.parse({ id: randomUUID(), vehicleId: input.vehicleId, vehicleVersion: input.vehicleVersion,
      localizationRevision: input.localizationRevision, sourceFingerprint: translationPlanFingerprint(input, metadata),
      sourceLanguage: 'zh', targetLocales: ['en', 'ru'], provider: metadata.provider, engineVersion: metadata.engineVersion, fields,
      estimate: { characterBasis: 'utf16_upper_bound', maximumCharacters: fields.reduce((sum, field) => sum + field.sourceCharacters * 2, 0),
        maximumRequests: fields.reduce((sum, field) => sum + translationRequestCount(field.sourceText) * 2, 0),
        hourlyCharacterLimit: metadata.hourlyCharacterLimit, cost: { status: 'unknown', amount: null, currency: null, freeAllowanceCharacters: null } },
      createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + 600_000).toISOString(),
    });
    await this.persistence.insert(plan, input, actor.id);
    return plan;
  }
  private async get(vehicleId: string, planId: string, actor: Actor) {
    const record = await this.persistence.get(vehicleId, planId, actor.id);
    if (!record) throw notFound();
    return record;
  }
  async status(vehicleId: string, planId: string, actor: Actor) {
    const record = await this.get(vehicleId, planId, actor);
    const result = record.result ?? ((record.state === 'interrupted' || (record.state === 'running' && record.leaseExpired))
      ? this.result(record, await this.persistence.segments(record.plan.id)) : null);
    return { planId: record.plan.id, vehicleId: record.plan.vehicleId, state: result?.status ?? (record.state === 'ready' ? 'ready' : 'running'),
      result, startedAt: record.startedAt, finishedAt: record.finishedAt };
  }
  async generate(vehicleId: string, planId: string, confirmation: GenerateTranslationPlanRequest, actor: Actor, key: string): Promise<TranslationPlanResult> {
    const parsed = GenerateTranslationPlanRequestSchema.parse(confirmation);
    if (!key || key.length > 200) throw new ApiError(422, 'INVALID_REQUEST', 'A bounded idempotency key is required.');
    const hash = digest(parsed), record = await this.get(vehicleId, planId, actor);
    planId = record.plan.id;
    if (record.key !== null && (record.key !== key || record.requestHash !== hash)) throw keyConflict();
    if (record.result) return record.result;
    const ongoing = this.running.get(planId);
    if (ongoing) { if (ongoing.hash !== hash || ongoing.key !== key) throw keyConflict(); return ongoing.promise; }
    if (record.state !== 'ready') {
      if (record.state === 'running' && !record.leaseExpired) throw busy();
      await this.persistence.interrupt(record);
      const current = await this.get(vehicleId, planId, actor);
      if (current.result) return current.result;
      if (current.state !== 'interrupted') throw busy();
      return this.persistence.finish(current, this.result(current, await this.persistence.segments(planId)));
    }
    if (record.expired || parsed.sourceFingerprint !== record.plan.sourceFingerprint || parsed.maximumCharacters !== record.plan.estimate.maximumCharacters) throw conflict();
    const current = await this.loadInput(vehicleId, actor);
    const joined = this.running.get(planId);
    if (joined) { if (joined.hash !== hash || joined.key !== key) throw keyConflict(); return joined.promise; }
    if (translationPlanFingerprint(current, this.translator.metadata()) !== record.plan.sourceFingerprint) throw conflict();
    const job = this.translator.withPlanSession(async (translate, signal) => {
      const runToken = randomUUID();
      await this.persistence.claim(record, key, hash, runToken);
      const claimed = { ...record, state: 'running' as const, key, requestHash: hash, runToken };
      await this.execute(claimed, translate, signal);
      const result = await this.persistence.finish(claimed, this.result(claimed, await this.persistence.segments(planId)));
      // Persist the paid work before a stale-source response; adoption remains an explicit version-checked operation.
      if (translationPlanFingerprint(await this.loadInput(vehicleId, actor), this.translator.metadata()) !== record.plan.sourceFingerprint) throw conflict();
      return result;
    });
    this.running.set(planId, { hash, key, promise: job });
    try { return await job; } finally { this.running.delete(planId); }
  }
  private async execute(record: StoredTranslationPlan, translate: (text: string, target: Target, validate?: (text: string) => boolean) => Promise<string>, signal: AbortSignal) {
    for (const field of record.input.fields) for (const target of ['en', 'ru'] as const) {
      const chunks = splitTranslationText(field.sourceText);
      const translated: string[] = [];
      const valid = (source: string, text: string) => !!text.trim() && text.length <= getTranslationPlanTextLimit(field.ref)
        && !(text === source && /\p{Script=Han}/u.test(source)) && validateTranslationTokens(source, text);
      for (const [index, source] of chunks.entries()) {
        if (signal.aborted) return;
        const metadata = this.translator.metadata();
        if (metadata.provider !== record.plan.provider || metadata.engineVersion !== record.plan.engineVersion) return;
        const segment = await this.persistence.startSegment(record, { ref: field.ref, target, index,
          cacheKey: digest([record.plan.provider, record.plan.engineVersion, field.ref, getTranslationPlanTextLimit(field.ref), field.sourceHash, source, target]),
          state: 'running', text: null, failure: null });
        if (segment.state === 'succeeded') { translated.push(segment.text!); continue; }
        if (segment.state !== 'running') break;
        if (segment.cacheable === false) this.translator.invalidatePlanSegment(source, target);
        try {
          const text = await translate(source, target, text => valid(source, text));
          if (!valid(source, text)) {
            segment.state = 'failed'; segment.failure = 'invalid_result';
          } else { segment.state = 'succeeded'; segment.text = text; }
        } catch (error) {
          segment.state = signal.aborted ? 'outcome_unknown' : 'failed';
          segment.failure = signal.aborted ? 'outcome_unknown' : error instanceof TranslationResultValidationError ? 'invalid_result'
            : error instanceof ApiError && error.code === 'TRANSLATION_QUOTA_EXCEEDED' ? 'budget_exceeded'
            : error instanceof ApiError && error.code === 'TRANSLATION_BUSY' ? 'not_attempted' : 'upstream_failed';
        }
        await this.persistence.finishSegment(record, segment);
        if (segment.failure === 'budget_exceeded' || segment.failure === 'not_attempted' || signal.aborted) return;
        if (segment.state !== 'succeeded') break;
        translated.push(segment.text!);
      }
      if (translated.length === chunks.length && !valid(field.sourceText, translated.join(''))) {
        // Individually usable segments can still exceed the field bound after joining.
        // Preserve the attempt, but never reuse these outputs as successful cache entries.
        await this.persistence.invalidateTarget(record, field.ref, target);
        for (const source of chunks) this.translator.invalidatePlanSegment(source, target);
      }
    }
  }
  private result(record: StoredTranslationPlan, segments: TranslationPlanSegment[]): TranslationPlanResult {
    const failures: TranslationPlanResult['failures'] = [];
    const fields = record.input.fields.map(field => {
      const translations: TranslationPlanResult['fields'][number]['translations'] = {
        zh: { text: field.sourceText, kind: 'original', reviewStatus: 'pending', sourceVersion: field.sourceVersion,
          humanEditVersion: field.targetHumanEditVersions.zh ?? 0, engineVersion: null }, en: null, ru: null,
      };
      for (const target of ['en', 'ru'] as const) {
        const parts = splitTranslationText(field.sourceText).map((_, index) => segments.find(segment => segment.ref === field.ref && segment.target === target && segment.index === index));
        const failed = parts.find(segment => segment && segment.state !== 'succeeded');
        let code: Failure | null = failed ? failed.state === 'running' ? 'outcome_unknown' : failed.failure ?? 'outcome_unknown' : parts.some(part => !part) ? 'not_attempted' : null;
        const text = parts.map(part => part?.text ?? '').join('');
        if (!code && (text.length > getTranslationPlanTextLimit(field.ref) || !text.trim() || (text === field.sourceText && /\p{Script=Han}/u.test(text)) || !validateTranslationTokens(field.sourceText, text))) code = 'invalid_result';
        if (code) failures.push({ ref: field.ref, targetLocale: target, code });
        else translations[target] = { text, kind: 'machine', reviewStatus: 'pending', sourceVersion: field.sourceVersion,
          humanEditVersion: field.targetHumanEditVersions[target] ?? 0, engineVersion: record.plan.engineVersion };
      }
      return { ...field, mode: 'translate' as const, sourceCharacters: field.sourceText.length, translations };
    });
    return TranslationPlanResultSchema.parse({ planId: record.plan.id, vehicleId: record.plan.vehicleId, vehicleVersion: record.plan.vehicleVersion,
      localizationRevision: record.plan.localizationRevision, sourceFingerprint: record.plan.sourceFingerprint,
      status: failures.length ? 'partial' : 'completed', fields, failures });
  }
}
