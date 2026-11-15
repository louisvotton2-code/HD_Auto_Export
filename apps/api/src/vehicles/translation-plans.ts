import { createHash, randomUUID } from 'node:crypto';
import {
  TranslationPlanSchema, TranslationPlanResultSchema, GenerateTranslationPlanRequestSchema, RecoverableTranslationPlanResponseSchema,
  getTranslationPlanTextLimit, translationRequestCount, TRANSLATION_PLAN_TARGETS,
  type TranslationPlan, type TranslationPlanResult, type RecoverableTranslationPlan, type CreateTranslationPlanRequest, type GenerateTranslationPlanRequest,
} from '@hd/contracts/admin';
import type { Database } from '../db/index.js';
import { ApiError, conflict, notFound } from '../errors.js';
import type { Actor } from './service.js';
import { configurationCatalogText, CONFIGURATION_TRANSLATION_CATALOG_VERSION } from './configuration-translation-catalog.js';
import { splitTranslationText, TranslationResultValidationError, type VehicleTranslator } from './translation.js';

type Target = typeof TRANSLATION_PLAN_TARGETS[number];
type Failure = TranslationPlanResult['failures'][number]['code'];
type FailureReason = NonNullable<TranslationPlanResult['failures'][number]['reason']>;
type PlanCatalog = {
  version: typeof CONFIGURATION_TRANSLATION_CATALOG_VERSION;
  fields: Record<string, Partial<Record<Target, string>>>;
};
export type TranslationPlanInputField = {
  ref: TranslationPlan['fields'][number]['ref']; sourceText: string; sourceVersion: number; sourceHash: string;
  targetHumanEditVersions: { zh: number | null; en: number | null; ru: number | null };
  targets?: Target[];
};
export type TranslationPlanInput = {
  vehicleId: string; vehicleVersion: number; localizationRevision: number; fields: TranslationPlanInputField[];
  scope?: CreateTranslationPlanRequest['scope'];
  catalog?: PlanCatalog;
  diagnostics?: true;
};
export type LoadTranslationPlanInput = (vehicleId: string, actor: Actor, scope?: CreateTranslationPlanRequest['scope']) => Promise<TranslationPlanInput>;
type Metadata = ReturnType<VehicleTranslator['metadata']>;
type RecoverableReceipt = Pick<RecoverableTranslationPlan, 'plan' | 'result'> & { input: TranslationPlanInput };
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
  recoverableReceipts(vehicleId: string, actorId: string): AsyncIterable<RecoverableReceipt>;
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
export function translationPlanFingerprint(input: TranslationPlanInput, metadata: Metadata, catalog = input.catalog): string {
  return digest([input.vehicleId.toLowerCase(), input.vehicleVersion, input.localizationRevision, metadata.provider, metadata.engineVersion,
    [...input.fields].sort((a, b) => a.ref.localeCompare(b.ref)).map(field => [field.ref, field.sourceText, field.sourceVersion, field.sourceHash,
      field.targetHumanEditVersions.zh, field.targetHumanEditVersions.en, field.targetHumanEditVersions.ru,
      ...(input.scope === 'missing' ? [field.targets] : [])]), ...(input.scope === 'missing' ? [input.scope] : []), ...(catalog ? [[catalog.version, Object.entries(catalog.fields).sort(([a], [b]) => a.localeCompare(b))
      .map(([ref, terms]) => [ref, terms.en ?? null, terms.ru ?? null])]] : [])]);
}

function sameSource(a: TranslationPlanInputField, b: Pick<TranslationPlanInputField, 'ref' | 'sourceText' | 'sourceVersion' | 'sourceHash'>) {
  return a.ref === b.ref && a.sourceText === b.sourceText && a.sourceVersion === b.sourceVersion && a.sourceHash === b.sourceHash;
}

function sameTargets(a: readonly Target[] | undefined, b: readonly Target[] | undefined, fallback: readonly Target[] = TRANSLATION_PLAN_TARGETS) {
  return TRANSLATION_PLAN_TARGETS.every(target => (a ?? fallback).includes(target) === (b ?? fallback).includes(target));
}

function usableOutput(text: string, ref: string) {
  return text.trim().length > 0 && text.length <= getTranslationPlanTextLimit(ref);
}

function plannedField(field: TranslationPlanInputField, catalog?: PlanCatalog) {
  const catalogTargets = TRANSLATION_PLAN_TARGETS.filter(target => catalog?.fields[field.ref]?.[target] !== undefined);
  return { ref: field.ref, sourceText: field.sourceText, sourceVersion: field.sourceVersion, sourceHash: field.sourceHash,
    mode: 'translate' as const, sourceCharacters: field.sourceText.length,
    ...(field.targets ? { targets: field.targets } : {}), ...(catalogTargets.length ? { catalogTargets } : {}) };
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
  async *recoverableReceipts(vehicleId: string, actorId: string): AsyncIterable<RecoverableReceipt> {
    let afterId: string | null = null;
    const pageSize = 16;
    type ReceiptRow = { id: string; plan: unknown; result: unknown; source_input: TranslationPlanInput };
    for (;;) {
      const { rows }: { rows: ReceiptRow[] } = await this.db.pool.query<ReceiptRow>(
        `SELECT p.id,p.plan,p.result,p.source_input
        FROM translation_plans p JOIN vehicles v ON v.id=p.vehicle_id
        WHERE p.vehicle_id=$1 AND v.deleted_at IS NULL AND p.actor_id=$2 AND p.state='finished' AND p.result IS NOT NULL
          AND ($3::uuid IS NULL OR (p.finished_at,p.id) <
            (SELECT finished_at,id FROM translation_plans WHERE id=$3))
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.result->'fields') field
            WHERE field->'translations'->>'en' IS NOT NULL OR field->'translations'->>'ru' IS NOT NULL)
        ORDER BY p.finished_at DESC,p.id DESC LIMIT $4`, [vehicleId, actorId, afterId, pageSize]);
      for (const row of rows) {
        const pair = RecoverableTranslationPlanResponseSchema.shape.data.safeParse({ plan: row.plan, result: row.result });
        if (pair.success && pair.data) yield { plan: pair.data.plan, result: pair.data.result, input: row.source_input };
      }
      if (rows.length < pageSize) return;
      afterId = rows[rows.length - 1]!.id;
    }
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

  async create(vehicleId: string, request: CreateTranslationPlanRequest, actor: Actor): Promise<TranslationPlan> {
    const input = await this.loadInput(vehicleId, actor, request.scope);
    if (input.vehicleId.toLowerCase() !== vehicleId.toLowerCase() || input.vehicleVersion !== request.version) throw conflict();
    const metadata = this.translator.metadata(), created = await this.persistence.now();
    if (request.scope === 'missing' && request.useCatalog) {
      input.diagnostics = true;
      const entries: PlanCatalog['fields'] = Object.create(null);
      for (const field of input.fields) for (const target of field.targets ?? TRANSLATION_PLAN_TARGETS) {
        const text = configurationCatalogText(field.ref, field.sourceText, target);
        if (text !== undefined) (entries[field.ref] ??= {})[target] = text;
      }
      if (Object.keys(entries).length) input.catalog = { version: CONFIGURATION_TRANSLATION_CATALOG_VERSION, fields: entries };
    }
    const fields = input.fields.map(field => plannedField(field, input.catalog));
    const supplierTargets = (field: typeof fields[number]) =>
      (field.targets ?? TRANSLATION_PLAN_TARGETS).length - (field.catalogTargets?.length ?? 0);
    const maximumCharacters = fields.reduce((sum, field) => sum + field.sourceCharacters * supplierTargets(field), 0);
    const maximumRequests = fields.reduce((sum, field) => sum + translationRequestCount(field.sourceText) * supplierTargets(field), 0);
    const plan = TranslationPlanSchema.parse({ id: randomUUID(), vehicleId: input.vehicleId, vehicleVersion: input.vehicleVersion,
      localizationRevision: input.localizationRevision, sourceFingerprint: translationPlanFingerprint(input, metadata),
      sourceLanguage: 'zh', targetLocales: ['en', 'ru'], provider: metadata.provider, engineVersion: metadata.engineVersion, fields,
      ...(input.catalog ? { catalogVersion: input.catalog.version } : {}),
      estimate: { characterBasis: 'utf16_upper_bound', maximumCharacters, maximumRequests,
        hourlyCharacterLimit: metadata.hourlyCharacterLimit, cost: input.catalog && maximumRequests === 0
          ? { status: 'no_supplier_calls', amount: 0, currency: null, freeAllowanceCharacters: null }
          : { status: 'unknown', amount: null, currency: null, freeAllowanceCharacters: null } },
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
  async recoverable(vehicleId: string, actor: Actor): Promise<RecoverableTranslationPlan | null> {
    // The current missing set controls adoption only. It cannot authenticate
    // the scope or fingerprint of an already-paid, immutable receipt.
    const current = await this.loadInput(vehicleId, actor, 'missing');
    if (current.vehicleId.toLowerCase() !== vehicleId.toLowerCase() || !current.fields.length) return null;
    const available = new Map(current.fields.map(field => [field.ref, field]));
    for await (const { plan, result, input } of this.persistence.recoverableReceipts(vehicleId, actor.id)) {
      const metadata = { provider: plan.provider, engineVersion: plan.engineVersion, hourlyCharacterLimit: plan.estimate.hourlyCharacterLimit };
      if (!Array.isArray(input.fields) || input.fields.some(field => !field?.targetHumanEditVersions) ||
          (input.catalog && !input.catalog.fields) ||
          plan.vehicleId.toLowerCase() !== current.vehicleId.toLowerCase() || input.vehicleId !== plan.vehicleId ||
          input.vehicleVersion !== plan.vehicleVersion || input.localizationRevision !== plan.localizationRevision ||
          plan.vehicleVersion > current.vehicleVersion || plan.localizationRevision > current.localizationRevision ||
          (input.scope !== undefined && input.scope !== 'missing') || input.catalog?.version !== plan.catalogVersion ||
          input.fields.length !== plan.fields.length || result.fields.length !== plan.fields.length ||
          translationPlanFingerprint(input, metadata) !== plan.sourceFingerprint) continue;

      const archive = new Map(input.fields.map(field => [field.ref, field]));
      const quoted = new Map(plan.fields.map(field => [field.ref, field]));
      const belongsToArchive = result.fields.every(field => {
        const source = archive.get(field.ref), estimate = quoted.get(field.ref);
        return source && estimate && sameSource(source, field) && sameSource(source, estimate) &&
          sameTargets(source.targets, estimate.targets) && sameTargets(estimate.targets, field.targets) &&
          sameTargets(plannedField(source, input.catalog).catalogTargets, estimate.catalogTargets, []) &&
          sameTargets(estimate.catalogTargets, field.catalogTargets, []) &&
          (['zh', ...TRANSLATION_PLAN_TARGETS] as const).every(locale =>
            source.targetHumanEditVersions[locale] === field.targetHumanEditVersions[locale]);
      });
      if (!belongsToArchive) continue;

      let canAdopt = false;
      const blockedTargets = result.fields.flatMap(field => TRANSLATION_PLAN_TARGETS.flatMap(targetLocale => {
        const suggestion = field.translations[targetLocale];
        if (!suggestion) return [];
        const live = available.get(field.ref);
        const hasCatalogText = field.catalogTargets?.includes(targetLocale);
        const matchingProvenance = hasCatalogText
          ? suggestion.engineVersion === input.catalog?.version && input.catalog?.fields[field.ref]?.[targetLocale] === suggestion.text
          : suggestion.engineVersion === plan.engineVersion;
        if (live && sameSource(live, field) && live.targets?.includes(targetLocale) &&
            live.targetHumanEditVersions[targetLocale] === field.targetHumanEditVersions[targetLocale] &&
            matchingProvenance && usableOutput(suggestion.text, field.ref)) {
          canAdopt = true;
          return [];
        }
        return [{ ref: field.ref, targetLocale }];
      }));
      if (canAdopt) return { plan, result, ...(blockedTargets.length ? { blockedTargets } : {}),
        ...(current.vehicleVersion !== plan.vehicleVersion || current.localizationRevision !== plan.localizationRevision
          ? { adoptionBase: { vehicleVersion: current.vehicleVersion, localizationRevision: current.localizationRevision } } : {}) };
    }
    return null;
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
    if (!parsed.acceptUnknownCost && record.plan.estimate.cost.status !== 'no_supplier_calls')
      throw new ApiError(422, 'TRANSLATION_CONFIRMATION_REQUIRED', 'Supplier work requires accepting unknown cost.');
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
    const current = await this.loadInput(vehicleId, actor, record.input.scope);
    const joined = this.running.get(planId);
    if (joined) { if (joined.hash !== hash || joined.key !== key) throw keyConflict(); return joined.promise; }
    if (record.input.catalog?.version !== record.plan.catalogVersion ||
        translationPlanFingerprint(current, this.translator.metadata(), record.input.catalog) !== record.plan.sourceFingerprint) throw conflict();
    const run = async (execute?: (claimed: StoredTranslationPlan, reasons: Map<string, FailureReason>) => Promise<void>) => {
      const runToken = randomUUID();
      await this.persistence.claim(record, key, hash, runToken);
      const claimed = { ...record, state: 'running' as const, key, requestHash: hash, runToken };
      const reasons = new Map<string, FailureReason>();
      if (execute) await execute(claimed, reasons);
      const segments = execute ? await this.persistence.segments(planId) : [];
      const result = await this.persistence.finish(claimed, this.result(claimed, segments, reasons));
      // Persist the paid work before a stale-source response; adoption remains an explicit version-checked operation.
      if (translationPlanFingerprint(await this.loadInput(vehicleId, actor, record.input.scope), this.translator.metadata(), record.input.catalog) !== record.plan.sourceFingerprint) throw conflict();
      return result;
    };
    // Empty plans still use normal confirmation and idempotency, without reserving provider capacity.
    const job = record.plan.estimate.maximumRequests === 0 ? run() :
      this.translator.withPlanSession((translate, signal) => run((claimed, reasons) => this.execute(claimed, translate, signal, reasons)));
    this.running.set(planId, { hash, key, promise: job });
    try { return await job; } finally { this.running.delete(planId); }
  }
  private async execute(record: StoredTranslationPlan, translate: (text: string, target: Target, validate?: (text: string) => boolean) => Promise<string>,
    signal: AbortSignal, reasons: Map<string, FailureReason>) {
    for (const field of record.input.fields) for (const target of field.targets ?? TRANSLATION_PLAN_TARGETS) {
      if (record.input.catalog?.fields[field.ref]?.[target] !== undefined) continue;
      const chunks = splitTranslationText(field.sourceText);
      const translated: string[] = [];
      const reasonKey = field.ref + ':' + target;
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
        let reason: FailureReason | undefined;
        try {
          const text = await translate(source, target, text => {
            reason = usableOutput(text, field.ref) ? undefined : 'output_constraint';
            return reason === undefined;
          });
          if (reason) {
            segment.state = 'failed'; segment.failure = 'invalid_result';
          } else { segment.state = 'succeeded'; segment.text = text; }
        } catch (error) {
          if (record.input.diagnostics && !signal.aborted && error instanceof ApiError && error.code === 'TRANSLATION_UPSTREAM_FAILED')
            reasons.set(reasonKey, 'provider_unusable');
          segment.state = signal.aborted ? 'outcome_unknown' : 'failed';
          segment.failure = signal.aborted ? 'outcome_unknown' : error instanceof TranslationResultValidationError ? 'invalid_result'
            : error instanceof ApiError && error.code === 'TRANSLATION_QUOTA_EXCEEDED' ? 'budget_exceeded'
            : error instanceof ApiError && error.code === 'TRANSLATION_BUSY' ? 'not_attempted' : 'upstream_failed';
        }
        if (record.input.diagnostics && segment.failure === 'invalid_result' && reason) reasons.set(reasonKey, reason);
        await this.persistence.finishSegment(record, segment);
        if (segment.failure === 'budget_exceeded' || segment.failure === 'not_attempted' || signal.aborted) return;
        if (segment.state !== 'succeeded') break;
        translated.push(segment.text!);
      }
      if (translated.length === chunks.length && !usableOutput(translated.join(''), field.ref)) {
        if (record.input.diagnostics) reasons.set(reasonKey, 'output_constraint');
        // Individually usable segments can still exceed the field bound after joining.
        // Preserve the attempt, but never reuse these outputs as successful cache entries.
        await this.persistence.invalidateTarget(record, field.ref, target);
        for (const source of chunks) this.translator.invalidatePlanSegment(source, target);
      }
    }
  }
  private result(record: StoredTranslationPlan, segments: TranslationPlanSegment[], reasons?: Map<string, FailureReason>): TranslationPlanResult {
    const failures: TranslationPlanResult['failures'] = [];
    const fields = record.input.fields.map(field => {
      const translations: TranslationPlanResult['fields'][number]['translations'] = {
        zh: { text: field.sourceText, kind: 'original', reviewStatus: 'pending', sourceVersion: field.sourceVersion,
          humanEditVersion: field.targetHumanEditVersions.zh ?? 0, engineVersion: null }, en: null, ru: null,
      };
      for (const target of field.targets ?? TRANSLATION_PLAN_TARGETS) {
        const localText = record.input.catalog?.fields[field.ref]?.[target];
        if (localText !== undefined) {
          if (!usableOutput(localText, field.ref))
            failures.push({ ref: field.ref, targetLocale: target, code: 'invalid_result', reason: 'output_constraint' });
          else translations[target] = { text: localText, kind: 'machine', reviewStatus: 'pending', sourceVersion: field.sourceVersion,
            humanEditVersion: field.targetHumanEditVersions[target] ?? 0, engineVersion: record.input.catalog!.version };
          continue;
        }
        const parts = splitTranslationText(field.sourceText).map((_, index) => segments.find(segment => segment.ref === field.ref && segment.target === target && segment.index === index));
        const failed = parts.find(segment => segment && segment.state !== 'succeeded');
        let code: Failure | null = failed ? failed.state === 'running' ? 'outcome_unknown' : failed.failure ?? 'outcome_unknown' : parts.some(part => !part) ? 'not_attempted' : null;
        const text = parts.map(part => part?.text ?? '').join('');
        if (!code && !usableOutput(text, field.ref)) code = 'invalid_result';
        const reason = reasons?.get(field.ref + ':' + target);
        if (code) failures.push({ ref: field.ref, targetLocale: target, code, ...(reason ? { reason } : {}) });
        else translations[target] = { text, kind: 'machine', reviewStatus: 'pending', sourceVersion: field.sourceVersion,
          humanEditVersion: field.targetHumanEditVersions[target] ?? 0, engineVersion: record.plan.engineVersion };
      }
      return { ...plannedField(field, record.input.catalog), targetHumanEditVersions: field.targetHumanEditVersions, translations };
    });
    return TranslationPlanResultSchema.parse({ planId: record.plan.id, vehicleId: record.plan.vehicleId, vehicleVersion: record.plan.vehicleVersion,
      localizationRevision: record.plan.localizationRevision, sourceFingerprint: record.plan.sourceFingerprint,
      status: failures.length ? 'partial' : 'completed', fields, failures });
  }
}
