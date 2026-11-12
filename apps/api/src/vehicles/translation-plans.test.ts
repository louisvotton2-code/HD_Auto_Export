import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Database } from '../db/index.js';
import { ApiError, conflict } from '../errors.js';
import { VehicleTranslator, type TranslationProvider } from './translation.js';
import { TranslationPlanService, validateTranslationTokens, translationPlanFingerprint,
  type TranslationPlanPersistence, type StoredTranslationPlan, type TranslationPlanSegment, type TranslationPlanInput } from './translation-plans.js';
import type { TranslationPlan, TranslationPlanResult, GenerateTranslationPlanRequest } from '@hd/contracts/admin';
import { TranslationPlanStatusSchema } from '@hd/contracts/admin';

const actor = { id: 'synthetic-staff', requestId: 'plan-unit' };
const vehicleId = '550e8400-e29b-41d4-a716-446655440000';
const input = (): TranslationPlanInput => ({ vehicleId, vehicleVersion: 3, localizationRevision: 2,
  fields: [{ ref: 'content.title', sourceText: '中文车辆 120 kW', sourceVersion: 4, sourceHash: 'a'.repeat(64),
    targetHumanEditVersions: { zh: 1, en: 2, ru: null } }] });
const confirmation = (plan: TranslationPlan): GenerateTranslationPlanRequest => ({ confirmed: true,
  sourceFingerprint: plan.sourceFingerprint, maximumCharacters: plan.estimate.maximumCharacters, acceptUnknownCost: true });
const errorCode = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
const segmentKey = (planId: string, row: TranslationPlanSegment) => `${planId}:${row.ref}:${row.target}:${row.index}`;

/** An explicit domain fake, never a database connection or SQL parser. */
class MemoryPlans implements TranslationPlanPersistence {
  clock = Date.parse('2026-11-12T00:00:00Z'); writes = 0;
  plans = new Map<string, StoredTranslationPlan>(); rows = new Map<string, TranslationPlanSegment>();
  current: TranslationPlanInput;
  constructor(current: TranslationPlanInput) { this.current = current; }
  async now() { return new Date(this.clock); }
  async insert(plan: TranslationPlan, source: TranslationPlanInput, actorId: string) {
    this.writes++; this.plans.set(plan.id, structuredClone({ plan, input: source, actorId, state: 'ready', key: null, requestHash: null,
      runToken: null, startedAt: null, finishedAt: null, expired: false, leaseExpired: false, result: null }));
  }
  async get(id: string, planId: string, actorId: string) {
    const found = this.plans.get(planId.toLowerCase());
    if (!found || found.actorId !== actorId || found.plan.vehicleId.toLowerCase() !== id.toLowerCase()) return null;
    return structuredClone({ ...found, expired: Date.parse(found.plan.expiresAt) <= this.clock,
      leaseExpired: found.startedAt !== null && Date.parse(found.startedAt) + 150000 <= this.clock });
  }
  async claim(record: StoredTranslationPlan, key: string, requestHash: string, runToken: string) {
    const found = this.plans.get(record.plan.id)!;
    if (found.state !== 'ready' || Date.parse(found.plan.expiresAt) <= this.clock || this.current.vehicleVersion !== record.plan.vehicleVersion || this.current.localizationRevision !== record.plan.localizationRevision) throw conflict();
    this.writes++; Object.assign(found, { state: 'running', key, requestHash, runToken, startedAt: new Date(this.clock).toISOString() });
  }
  async interrupt(record: StoredTranslationPlan) {
    const found = this.plans.get(record.plan.id)!;
    if (found.state === 'running' && found.startedAt && Date.parse(found.startedAt) + 150000 <= this.clock) {
      this.writes++; found.state = 'interrupted';
      for (const [key, row] of this.rows) if (key.startsWith(record.plan.id + ':') && row.state === 'running') {
        row.state = 'outcome_unknown'; row.failure = 'outcome_unknown';
      }
    }
  }
  async segments(planId: string) { return structuredClone([...this.rows].filter(([key]) => key.startsWith(planId + ':')).map(([, row]) => row)); }
  async startSegment(record: StoredTranslationPlan, row: TranslationPlanSegment): Promise<TranslationPlanSegment> {
    const key = segmentKey(record.plan.id, row), old = this.rows.get(key);
    if (old) return structuredClone(old.state === 'running' ? { ...old, state: 'outcome_unknown', failure: 'outcome_unknown' } : old);
    const cached = [...this.rows.values()].find(previous => previous.cacheKey === row.cacheKey && previous.state === 'succeeded' && previous.cacheable !== false);
    const invalidated = [...this.rows.values()].some(previous => previous.cacheKey === row.cacheKey && previous.cacheable === false);
    const next = cached ? { ...row, state: 'succeeded' as const, text: cached.text } : { ...row, cacheable: !invalidated };
    this.writes++; this.rows.set(key, structuredClone({ ...next, cacheable: true })); return structuredClone(next);
  }
  async finishSegment(record: StoredTranslationPlan, row: TranslationPlanSegment) {
    this.writes++; this.rows.set(segmentKey(record.plan.id, row), structuredClone({ ...row, cacheable: true }));
  }
  async invalidateTarget(record: StoredTranslationPlan, ref: string, target: 'en' | 'ru') {
    this.writes++;
    const keys = new Set([...this.rows].filter(([key, row]) => key.startsWith(record.plan.id + ':') && row.ref === ref && row.target === target).map(([, row]) => row.cacheKey));
    for (const row of this.rows.values()) if (keys.has(row.cacheKey)) row.cacheable = false;
    for (const [key, row] of this.rows) if (key.startsWith(record.plan.id + ':') && row.ref === ref && row.target === target && row.state === 'succeeded') {
      row.state = 'failed'; row.text = null; row.failure = 'invalid_result';
    }
  }
  async finish(record: StoredTranslationPlan, result: TranslationPlanResult) {
    const found = this.plans.get(record.plan.id)!;
    if (found.result) return structuredClone(found.result);
    this.writes++; Object.assign(found, { state: 'finished', result: structuredClone(result), finishedAt: new Date(this.clock).toISOString() });
    return structuredClone(result);
  }
}
function setup(provider?: TranslationProvider, budget = 50000) {
  const current = input(), store = new MemoryPlans(current), calls: Array<[string, string]> = [];
  const translator = new VehicleTranslator(provider ?? { engineVersion: 'fixture:1', async translate(text, target) {
    calls.push([text, target]); return text.replace('中文车辆', target === 'en' ? 'Vehicle' : 'Автомобиль');
  } }, budget, 'libretranslate');
  const makeService = (instance = translator) => new TranslationPlanService({} as Database, instance, async () => structuredClone(current), store);
  return { current, store, calls, translator, service: makeService(), makeService };
}

test('creating a plan performs no provider call and exposes immutable honest bounds and unknown cost', async () => {
  const { service, calls, current } = setup();
  const before = structuredClone(current), plan = await service.create(vehicleId, { version: 3 }, actor);
  assert.equal(calls.length, 0); assert.deepEqual(current, before);
  assert.equal(plan.estimate.maximumCharacters, '中文车辆 120 kW'.length * 2);
  assert.equal(plan.estimate.maximumRequests, 2); assert.equal(plan.estimate.hourlyCharacterLimit, 50000);
  assert.deepEqual(plan.estimate.cost, { status: 'unknown', amount: null, currency: null, freeAllowanceCharacters: null });
  assert.equal(Date.parse(plan.expiresAt) - Date.parse(plan.createdAt), 600000);
  assert.equal((await service.status(vehicleId, plan.id, actor)).state, 'ready');
});

test('segmented estimate counts all UTF-16-safe chunks for both targets', async () => {
  const { service, current } = setup();
  current.fields[0]!.ref = 'content.description'; current.fields[0]!.sourceText = '中'.repeat(4999) + '😀' + '中'.repeat(4999);
  const plan = await service.create(vehicleId, { version: 3 }, actor);
  assert.equal(plan.estimate.maximumCharacters, 20000); assert.equal(plan.estimate.maximumRequests, 6);
});

test('actor, confirmation, source/human edits, provider and expiry gates prevent provider calls', async () => {
  for (const change of ['actor', 'maximum', 'source', 'edit', 'provider', 'expiry'] as const) {
    const ctx = setup(), plan = await ctx.service.create(vehicleId, { version: 3 }, actor), body = confirmation(plan);
    if (change === 'maximum') body.maximumCharacters++;
    if (change === 'source') ctx.current.fields[0]!.sourceText += '更新';
    if (change === 'edit') ctx.current.fields[0]!.targetHumanEditVersions.en = 3;
    if (change === 'expiry') ctx.store.clock += 600000;
    const service = change === 'provider' ? ctx.makeService(new VehicleTranslator({ engineVersion: 'fixture:2', async translate() { throw new Error('must not call'); } }, 50000, 'libretranslate')) : ctx.service;
    await assert.rejects(service.generate(vehicleId, plan.id, body, change === 'actor' ? { ...actor, id: 'other-staff' } : actor, 'key'), errorCode(change === 'actor' ? 'NOT_FOUND' : 'VERSION_CONFLICT'));
    assert.equal(ctx.calls.length, 0, change);
  }
});

test('successful generation is persisted pending provenance and exact idempotent replay never calls upstream', async () => {
  const { service, calls, current, store } = setup(), before = structuredClone(current);
  const plan = await service.create(vehicleId, { version: 3 }, actor), body = confirmation(plan);
  const result = await service.generate(vehicleId, plan.id, body, actor, 'key');
  assert.equal(result.status, 'completed'); assert.equal(calls.length, 2); assert.deepEqual(current, before);
  assert.equal(result.fields[0]!.translations.zh.kind, 'original'); assert.equal(result.fields[0]!.translations.zh.engineVersion, null);
  assert.equal(result.fields[0]!.translations.en!.kind, 'machine'); assert.equal(result.fields[0]!.translations.en!.reviewStatus, 'pending');
  assert.equal(result.fields[0]!.translations.en!.humanEditVersion, 2);
  store.clock += 3600000;
  assert.deepEqual(await service.generate(vehicleId, plan.id, body, actor, 'key'), result); assert.equal(calls.length, 2);
  assert.deepEqual((await service.status(vehicleId, plan.id, actor)).result, result);
  await assert.rejects(service.generate(vehicleId, plan.id, body, actor, 'other'), errorCode('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(service.generate(vehicleId, plan.id, { ...body, maximumCharacters: 1 }, actor, 'key'), errorCode('IDEMPOTENCY_CONFLICT'));
});

test('failed targets remain partial without automatic retries; newly confirmed plans reuse successful persisted segments', async () => {
  let calls = 0;
  const ctx = setup({ engineVersion: 'fixture:partial', async translate(text, target) { calls++; if (target === 'en') throw new Error('private failure'); return text.replace('中文车辆', 'Автомобиль'); } });
  const plan = await ctx.service.create(vehicleId, { version: 3 }, actor), body = confirmation(plan);
  const result = await ctx.service.generate(vehicleId, plan.id, body, actor, 'key');
  assert.equal(result.status, 'partial'); assert.deepEqual(result.failures, [{ ref: 'content.title', targetLocale: 'en', code: 'upstream_failed' }]);
  assert.equal(calls, 2); await ctx.service.generate(vehicleId, plan.id, body, actor, 'key'); assert.equal(calls, 2);
  const restarted = ctx.makeService(new VehicleTranslator({ engineVersion: 'fixture:partial', async translate(text) { calls++; return text.replace('中文车辆', 'Vehicle'); } }, 50000, 'libretranslate'));
  const second = await restarted.create(vehicleId, { version: 3 }, actor);
  assert.equal((await restarted.generate(vehicleId, second.id, confirmation(second), actor, 'new-confirmation')).status, 'completed');
  assert.equal(calls, 3, 'only the failed target is a new explicitly confirmed attempt');
});

test('hourly budget is reserved for failed attempts and prevents further provider spending', async () => {
  let calls = 0;
  const ctx = setup({ engineVersion: 'fixture:budget', async translate() { calls++; throw new Error('may have been billed'); } }, input().fields[0]!.sourceText.length);
  const plan = await ctx.service.create(vehicleId, { version: 3 }, actor);
  const result = await ctx.service.generate(vehicleId, plan.id, confirmation(plan), actor, 'key');
  assert.equal(calls, 1); assert.deepEqual(result.failures.map(failure => failure.code), ['upstream_failed', 'budget_exceeded']);
});

test('source changes during paid work preserve the receipt but never overwrite employee data', async () => {
  let ctx: ReturnType<typeof setup>;
  ctx = setup({ engineVersion: 'fixture:race', async translate(text) { ctx.current.vehicleVersion++; return text.replace('中文车辆', 'Vehicle'); } });
  const plan = await ctx.service.create(vehicleId, { version: 3 }, actor);
  await assert.rejects(ctx.service.generate(vehicleId, plan.id, confirmation(plan), actor, 'key'), errorCode('VERSION_CONFLICT'));
  const status = await ctx.service.status(vehicleId, plan.id, actor);
  assert.equal(status.result?.vehicleVersion, 3); assert.equal(ctx.current.vehicleVersion, 5);
  assert.equal(status.result?.fields[0]!.translations.en!.reviewStatus, 'pending');
});

test('expired running status is read-only and recovery never resends an uncertain segment', async () => {
  const ctx = setup(), plan = await ctx.service.create(vehicleId, { version: 3 }, actor), body = confirmation(plan);
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const record = (await ctx.store.get(vehicleId, plan.id, actor.id))!;
  await ctx.store.claim(record, 'key', hash, '00000000-0000-4000-8000-000000000001');
  ctx.store.rows.set(`${plan.id}:content.title:en:0`, { ref: 'content.title', target: 'en', index: 0, cacheKey: 'b'.repeat(64), state: 'running', text: null, failure: null });
  ctx.store.clock += 150001; const before = ctx.store.writes;
  const status = await ctx.service.status(vehicleId, plan.id, actor);
  assert.equal(status.state, 'partial'); assert.equal(status.finishedAt, null); assert.equal(ctx.store.writes, before);
  assert.deepEqual(status.result?.failures.map(item => item.code), ['outcome_unknown', 'not_attempted']);
  assert.deepEqual(await ctx.service.generate(vehicleId, plan.id, body, actor, 'key'), status.result);
  assert.equal(ctx.calls.length, 0);
});

test('a crash after the final persisted successful segment can be recovered by a pure read', async () => {
  const ctx = setup(), plan = await ctx.service.create(vehicleId, { version: 3 }, actor);
  const result = await ctx.service.generate(vehicleId, plan.id, confirmation(plan), actor, 'key');
  // Restore exactly the state before finalizing the plan: all paid segments are saved, no result/timestamp yet.
  const record = ctx.store.plans.get(plan.id)!;
  record.state = 'running'; record.result = null; record.finishedAt = null;
  ctx.store.clock += 150001; const before = ctx.store.writes;
  const status = await ctx.service.status(vehicleId, plan.id.toUpperCase(), actor);
  assert.equal(status.planId, plan.id); assert.equal(status.state, 'completed'); assert.equal(status.finishedAt, null);
  assert.deepEqual(status.result, result); assert.equal(ctx.store.writes, before); assert.equal(ctx.calls.length, 2);
  assert.deepEqual(TranslationPlanStatusSchema.parse(status), status);
});

test('numeric/model/unit mutation is invalid_result rather than a machine suggestion', async () => {
  const ctx = setup({ engineVersion: 'fixture:unsafe', async translate() { return 'Vehicle 121 kW'; } });
  const plan = await ctx.service.create(vehicleId, { version: 3 }, actor), result = await ctx.service.generate(vehicleId, plan.id, confirmation(plan), actor, 'key');
  assert.equal(result.status, 'partial'); assert.ok(result.failures.every(failure => failure.code === 'invalid_result'));
  assert.equal(result.fields[0]!.translations.en, null);
  for (const [source, translated] of [['功率120kW', 'Power 120 kW'], ['型号 BMW 520Li', 'Model BMW 520Li']]) assert.equal(validateTranslationTokens(source!, translated!), true);
  for (const [source, translated] of [['功率120kW', 'Power 121 kW'], ['功率120kW', 'Power 120 hp'], ['型号520Li', 'Model 520Le'], ['日期2024-10-02', 'Date 2024-10-03'], ['车型', 'Model 2024'], ['电量30%', 'Charge 30']]) assert.equal(validateTranslationTokens(source!, translated!), false);
});

test('invalid token or field-length output is not a success cache hit on a newly confirmed plan', async () => {
  for (const reason of ['tokens', 'length'] as const) {
    let fixed = false; const calls: string[] = [];
    const ctx = setup({ engineVersion: `fixture:invalid-${reason}`, async translate(text, target) {
      calls.push(target);
      if (target === 'en' && !fixed) return reason === 'tokens' ? 'Vehicle 121 kW' : 'a'.repeat(121);
      return text.replace('中文车辆', 'Vehicle');
    } });
    if (reason === 'length') { ctx.current.fields[0]!.ref = 'model'; ctx.current.fields[0]!.sourceText = '中文车辆'; }
    const first = await ctx.service.create(vehicleId, { version: 3 }, actor);
    const result = await ctx.service.generate(vehicleId, first.id, confirmation(first), actor, 'first');
    assert.deepEqual(result.failures, [{ ref: ctx.current.fields[0]!.ref, targetLocale: 'en', code: 'invalid_result' }]);
    const stored = await ctx.store.segments(first.id);
    assert.equal(stored.find(row => row.target === 'en')?.state, 'failed');
    fixed = true;
    const second = await ctx.service.create(vehicleId, { version: 3 }, actor);
    assert.equal((await ctx.service.generate(vehicleId, second.id, confirmation(second), actor, 'second')).status, 'completed');
    assert.deepEqual(calls, ['en', 'ru', 'en'], reason);
  }
});

test('whole-field rejection invalidates donor cache eligibility while preserving historical paid receipts', async () => {
  let round = 0; const calls: Array<[number, string, string]> = [];
  const ctx = setup({ engineVersion: 'fixture:donor', async translate(text, target) {
    calls.push([round, target, text[0]!]);
    if (target === 'ru') return 'r'.repeat(1000);
    if (round === 0 && text[0] === '乙') throw new Error('partial upstream failure');
    return 'a'.repeat(round === 2 ? 4000 : 6000);
  } });
  ctx.current.fields[0]!.ref = 'content.description';
  ctx.current.fields[0]!.sourceText = '甲'.repeat(5000) + '乙'.repeat(5000);
  const first = await ctx.service.create(vehicleId, { version: 3 }, actor);
  const firstResult = await ctx.service.generate(vehicleId, first.id, confirmation(first), actor, 'first');
  assert.equal(firstResult.failures[0]!.code, 'upstream_failed');
  round = 1;
  const second = await ctx.service.create(vehicleId, { version: 3 }, actor);
  const secondResult = await ctx.service.generate(vehicleId, second.id, confirmation(second), actor, 'second');
  assert.equal(secondResult.failures[0]!.code, 'invalid_result');
  const donor = (await ctx.store.segments(first.id)).find(row => row.target === 'en' && row.index === 0)!;
  assert.equal(donor.state, 'succeeded'); assert.equal(donor.cacheable, false);
  assert.deepEqual((await ctx.service.status(vehicleId, first.id, actor)).result, firstResult);
  round = 2;
  const third = await ctx.service.create(vehicleId, { version: 3 }, actor);
  const thirdResult = await ctx.service.generate(vehicleId, third.id, confirmation(third), actor, 'third');
  assert.equal(thirdResult.status, 'completed'); assert.equal(thirdResult.fields[0]!.translations.en!.text.length, 8000);
  assert.deepEqual(calls, [[0, 'en', '甲'], [0, 'en', '乙'], [0, 'ru', '甲'], [0, 'ru', '乙'], [1, 'en', '乙'], [2, 'en', '甲'], [2, 'en', '乙']]);
});

test('two global translation sessions include aggregate plans and same-key callers join one generation', async () => {
  let release!: () => void, calls = 0;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const ctx = setup({ engineVersion: 'fixture:parallel', async translate(text) { calls++; await wait; return text.replace('中文车辆', 'Vehicle'); } });
  const plans = await Promise.all([1, 2, 3].map(() => ctx.service.create(vehicleId, { version: 3 }, actor)));
  const first = ctx.service.generate(vehicleId, plans[0]!.id, confirmation(plans[0]!), actor, 'one');
  const duplicate = ctx.service.generate(vehicleId, plans[0]!.id, confirmation(plans[0]!), actor, 'one');
  const second = ctx.service.generate(vehicleId, plans[1]!.id, confirmation(plans[1]!), actor, 'two');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(ctx.service.generate(vehicleId, plans[2]!.id, confirmation(plans[2]!), actor, 'three'), errorCode('TRANSLATION_BUSY'));
  release(); const [a, b, c] = await Promise.all([first, duplicate, second]);
  assert.deepEqual(a, b); assert.equal(c.status, 'completed'); assert.equal(calls, 2, 'shared segment cache/inflight bounds actual provider work');
});

test('full fingerprint includes edit versions, field identity and provider configuration', () => {
  const source = input(), metadata = { provider: 'libretranslate' as const, engineVersion: 'fixture:1', hourlyCharacterLimit: 50000 };
  const original = translationPlanFingerprint(source, metadata);
  const changed = structuredClone(source); changed.fields[0]!.targetHumanEditVersions.ru = 1;
  assert.notEqual(translationPlanFingerprint(changed, metadata), original);
  assert.notEqual(translationPlanFingerprint(source, { ...metadata, engineVersion: 'fixture:2' }), original);
  changed.fields[0]!.targetHumanEditVersions.ru = null; changed.fields[0]!.ref = 'content.description';
  assert.notEqual(translationPlanFingerprint(changed, metadata), original);
});

test('aggregate deadline is 120 seconds and late provider results never replace an uncertain receipt', async context => {
  const deadline = new AbortController(); let release!: (text: string) => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => { assert.equal(milliseconds, 120000); return deadline.signal; });
  let calls = 0;
  const ctx = setup({ engineVersion: 'fixture:deadline', async translate() {
    calls++; started(); return new Promise<string>(resolve => { release = resolve; });
  } });
  const plan = await ctx.service.create(vehicleId, { version: 3 }, actor);
  const pending = ctx.service.generate(vehicleId, plan.id, confirmation(plan), actor, 'key');
  await entered; deadline.abort(new DOMException('Test deadline', 'TimeoutError'));
  const result = await pending;
  assert.deepEqual(result.failures.map(failure => failure.code), ['outcome_unknown', 'not_attempted']);
  assert.equal(calls, 1);
  release('Vehicle 120 kW'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual((await ctx.service.status(vehicleId, plan.id, actor)).result, result);
  assert.equal(calls, 1);
});

test('timed-out sessions cannot exceed two provider calls when an adapter ignores cancellation', async context => {
  const controllers: AbortController[] = [], releases: Array<(text: string) => void> = [];
  context.mock.method(AbortSignal, 'timeout', () => { const value = new AbortController(); controllers.push(value); return value.signal; });
  let calls = 0;
  const translator = new VehicleTranslator({ engineVersion: 'fixture:stuck', async translate() {
    calls++; return new Promise<string>(resolve => { releases.push(resolve); });
  } });
  const first = translator.withPlanSession(translate => translate('中文一', 'en'));
  const second = translator.withPlanSession(translate => translate('中文二', 'en'));
  controllers[0]!.abort(); controllers[1]!.abort();
  await Promise.all([assert.rejects(first), assert.rejects(second)]);
  await assert.rejects(translator.withPlanSession(translate => translate('中文三', 'en')), errorCode('TRANSLATION_BUSY'));
  assert.equal(calls, 2);
  for (const release of releases) release('Late result');
  await new Promise(resolve => setImmediate(resolve));
});
