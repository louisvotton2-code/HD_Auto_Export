import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CreateVehicleRequestSchema, SaveVehicleRequestSchema, VehicleDraftInputSchema, parseVehicleDraftWrite,
  TranslationPlanSchema, TranslationPlanResultSchema, TranslationPlanRefSchema } from '../dist/admin.js';
import { makeVehicleDraftFixture } from '../dist/fixtures.js';

test('pasted configuration is validated before duplicates can be discarded and stored canonically', () => {
  const draft = makeVehicleDraftFixture();
  const raw = '{"version":1,"items":[{"name":"排量(cc)","value":"1989"}]}';
  const canonical = parseVehicleDraftWrite(CreateVehicleRequestSchema.parse({ draft: { ...draft, configuration: raw } }).draft);
  assert.deepEqual(canonical.configuration, JSON.parse(raw));
  assert.equal(VehicleDraftInputSchema.safeParse({ ...draft, configuration: raw }).success, false);
  for (const input of [raw.replace('"version":1', '"version":1,"version":1'), raw + '\nExplanation', raw.replace('"1989"', '1989')]) {
    const parsed = SaveVehicleRequestSchema.safeParse({ version: 1, draft: { ...draft, configuration: input } });
    assert.equal(parsed.success, false);
    assert.ok(parsed.error.issues.some(issue => issue.path[0] === 'draft' && issue.path[1] === 'configuration'));
  }
  assert.equal(parseVehicleDraftWrite(CreateVehicleRequestSchema.parse({ draft: { ...draft, configuration: ' \n ' } }).draft).configuration, null);
  assert.equal(SaveVehicleRequestSchema.parse({ version: 1, draft: { ...draft, configuration: null } }).draft.configuration, null);
  const { configuration: ignored, ...old } = draft;
  assert.equal(Object.hasOwn(SaveVehicleRequestSchema.parse({ version: 1, draft: old }).draft, 'configuration'), false);
});

const hash = 'a'.repeat(64), id = '11111111-1111-4111-8111-111111111111';
const field = { ref: 'content.title', sourceText: '测试', sourceVersion: 1, sourceHash: hash, sourceCharacters: 2, mode: 'translate' };
const plan = () => ({ id, vehicleId: id, vehicleVersion: 1, localizationRevision: 0, sourceFingerprint: hash,
  sourceLanguage: 'zh', targetLocales: ['en', 'ru'], provider: 'aliyun', engineVersion: 'fake:1', fields: [structuredClone(field)],
  estimate: { characterBasis: 'utf16_upper_bound', maximumCharacters: 4, maximumRequests: 2, hourlyCharacterLimit: 50000,
    cost: { status: 'unknown', amount: null, currency: null, freeAllowanceCharacters: null } },
  createdAt: '2026-11-12T00:00:00Z', expiresAt: '2026-11-12T00:10:00Z' });
const result = () => ({ planId: id, vehicleId: id, vehicleVersion: 1, localizationRevision: 0, sourceFingerprint: hash, status: 'completed',
  fields: [{ ...field, targetHumanEditVersions: { zh: null, en: null, ru: null }, translations: Object.fromEntries(['zh','en','ru'].map(locale => [locale,
    { text: { zh: '测试', en: 'Test', ru: 'Тест' }[locale], kind: locale === 'zh' ? 'original' : 'machine', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 0, engineVersion: locale === 'zh' ? null : 'fake:1' }])) }], failures: [] });

test('translation estimates bind exact bounded source counts and never infer free allowance', () => {
  assert.deepEqual(TranslationPlanSchema.parse(plan()), plan());
  for (const mutate of [p => p.estimate.maximumCharacters = 2, p => p.estimate.maximumRequests = 1,
    p => p.estimate.cost.amount = '0', p => p.fields[0].sourceCharacters = 1,
    p => p.fields.push({ ...field }), p => p.expiresAt = p.createdAt]) {
    const p = plan(); mutate(p); assert.equal(TranslationPlanSchema.safeParse(p).success, false);
  }
  assert.equal(TranslationPlanRefSchema.safeParse('media.' + '-'.repeat(36) + '.alt').success, false);
  const p = plan(); p.fields = [{ ...field, ref: 'configuration.cfg-0041.name', sourceText: 'a'.repeat(101), sourceCharacters: 101 }];
  assert.equal(TranslationPlanSchema.safeParse(p).success, false);
});

test('partial results cannot masquerade as completion or forged human review', () => {
  assert.deepEqual(TranslationPlanResultSchema.parse(result()), result());
  for (const mutate of [r => r.fields[0].translations.en = null, r => r.fields[0].translations.en.reviewStatus = 'approved',
    r => r.fields[0].translations.en.kind = 'original', r => r.fields[0].translations.ru.sourceVersion = 2,
    r => r.fields[0].translations.zh.text = '不同', r => r.status = 'partial']) {
    const r = result(); mutate(r); assert.equal(TranslationPlanResultSchema.safeParse(r).success, false);
  }
  const partial = result(); partial.status = 'partial'; partial.fields[0].translations.ru = null;
  partial.failures.push({ ref: 'content.title', targetLocale: 'ru', code: 'outcome_unknown' });
  assert.deepEqual(TranslationPlanResultSchema.parse(partial), partial);
  partial.failures.push({ ...partial.failures[0] });
  assert.equal(TranslationPlanResultSchema.safeParse(partial).success, false);
});
