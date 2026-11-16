import { describe, expect, it } from 'vitest';
import { adminVehicleFixture } from '@hd/contracts/fixtures';
import {
  TranslationPlanSchema, TranslationPlanResultSchema, VehicleTranslationBundleSchema,
  type DisplayField, type TranslationPlanResult,
} from '@hd/contracts/admin';
import { translationSourceHash } from './machine-translation-model';
import {
  applyTranslationPlanResult, assertTranslationPlan, assertWorkspaceFresh, assertWorkspaceSnapshot,
  translationPlanConfirmation, workspaceData, workspaceDirty, workspaceNeedsChineseNormalization, workspaceSaveRequest, workspaceIsFactsOnly, workspaceIsSourceDeclarationOnly, workspaceTranslationGaps,
} from './workspace-model';

async function setup() {
  const vehicle = structuredClone(adminVehicleFixture);
  vehicle.id = '10000000-0000-4000-8000-000000000001';
  vehicle.draft.content.title = { sourceLanguage: 'zh', sourceText: '合成车辆', sourceVersion: 2, translations: { zh: null, en: null, ru: null } };
  vehicle.draft.content.description = { sourceLanguage: 'zh', sourceText: null, sourceVersion: 1, translations: { zh: null, en: null, ru: null } };
  const display: DisplayField = { ref: 'model', sourceLanguage: 'zh', sourceText: '合成车型', sourceVersion: 1,
    sourceHash: '1'.repeat(64), translations: { zh: null, en: null, ru: null } };
  const bundle = VehicleTranslationBundleSchema.parse({ vehicle, localization: { vehicleId: vehicle.id, vehicleVersion: vehicle.version,
    revision: 3, retiredFieldCount: 0, data: { facts: { generation: null, drivetrain: null }, fields: [display] } }, sourceLanguageConfirmationRequired: [] });
  const fields = [
    { ref: 'content.title', sourceText: '合成车辆', sourceVersion: 2, sourceHash: await translationSourceHash('zh', '合成车辆'), mode: 'translate', sourceCharacters: 4 },
    { ref: 'model', sourceText: '合成车型', sourceVersion: 1, sourceHash: display.sourceHash, mode: 'translate', sourceCharacters: 4 },
  ];
  const plan = TranslationPlanSchema.parse({ id: '20000000-0000-4000-8000-000000000001', vehicleId: vehicle.id, vehicleVersion: vehicle.version,
    localizationRevision: 3, sourceFingerprint: '2'.repeat(64), sourceLanguage: 'zh', targetLocales: ['en', 'ru'], provider: 'aliyun', engineVersion: 'synthetic-engine-v1', fields,
    estimate: { characterBasis: 'utf16_upper_bound', maximumCharacters: 16, maximumRequests: 4, hourlyCharacterLimit: 50000,
      cost: { status: 'unknown', amount: null, currency: null, freeAllowanceCharacters: null } },
    createdAt: '2026-11-12T12:00:00.000Z', expiresAt: '2026-11-12T12:10:00.000Z' });
  const result = TranslationPlanResultSchema.parse({ planId: plan.id, vehicleId: vehicle.id, vehicleVersion: vehicle.version,
    localizationRevision: 3, sourceFingerprint: plan.sourceFingerprint, status: 'completed', failures: [],
    fields: plan.fields.map(field => ({ ...field, targetHumanEditVersions: { zh: null, en: null, ru: null }, translations: {
      zh: { text: field.sourceText, kind: 'original', reviewStatus: 'pending', sourceVersion: field.sourceVersion, humanEditVersion: 0, engineVersion: null },
      en: { text: 'Synthetic English', kind: 'machine', reviewStatus: 'pending', sourceVersion: field.sourceVersion, humanEditVersion: 0, engineVersion: plan.engineVersion },
      ru: { text: 'Синтетический перевод', kind: 'machine', reviewStatus: 'pending', sourceVersion: field.sourceVersion, humanEditVersion: 0, engineVersion: plan.engineVersion },
    } })),
  });
  return { bundle, plan, result };
}

describe('统一多语工作区的不可变计划与来源保护', () => {
  it('费用确认只使用已展示的指纹及字符上界，过期或禁用服务不能提交', async () => {
    const { plan } = await setup();
    expect(translationPlanConfirmation(plan, Date.parse(plan.createdAt))).toEqual({ confirmed: true,
      sourceFingerprint: plan.sourceFingerprint, maximumCharacters: 16, acceptUnknownCost: true });
    expect(() => translationPlanConfirmation(plan, Date.parse(plan.expiresAt))).toThrow('过期');
    expect(() => translationPlanConfirmation({ ...plan, provider: 'disabled', engineVersion: null }, Date.parse(plan.createdAt))).toThrow('尚未启用');
  });
  it('计划只接受当前保存字段，错误源哈希或展示修订不能采用', async () => {
    const { bundle, plan } = await setup();
    await expect(assertTranslationPlan(plan, bundle)).resolves.toBeUndefined();
    const wrongHash = structuredClone(plan); wrongHash.fields[0]!.sourceHash = '0'.repeat(64);
    await expect(assertTranslationPlan(wrongHash, bundle)).rejects.toThrow('没有覆盖');
    await expect(assertTranslationPlan({ ...plan, localizationRevision: 2 }, bundle)).rejects.toThrow('没有覆盖');
    const oldLanguage = structuredClone(bundle); oldLanguage.localization.data.fields[0]!.sourceLanguage = 'und';
    oldLanguage.sourceLanguageConfirmationRequired = ['model'];
    await expect(assertTranslationPlan(plan, oldLanguage)).rejects.toThrow('没有覆盖');
  });
  it('旧 en 和 und 来源标签可以补译及恢复，原文槽和来源保护照常生效', async () => {
    const { bundle, plan, result } = await setup();
    const title = bundle.vehicle.draft.content.title;
    title.sourceLanguage = 'en';
    plan.fields[0]!.sourceHash = result.fields[0]!.sourceHash = await translationSourceHash('en', title.sourceText);
    const display = bundle.localization.data.fields[0]!;
    display.sourceLanguage = 'und';
    display.sourceHash = plan.fields[1]!.sourceHash = result.fields[1]!.sourceHash = '3'.repeat(64);
    for (const field of [...plan.fields, ...result.fields]) field.targets = ['en', 'ru'];

    await expect(assertTranslationPlan(plan, bundle, true)).resolves.toBeUndefined();
    const applied = await applyTranslationPlanResult(plan, bundle, workspaceData(bundle), bundle, result);
    expect(applied.applied).toBe(4);
    expect(applied.data.content.title).toMatchObject({ sourceLanguage: 'en', translations: { zh: null, ru: result.fields[0]!.translations.ru } });
    expect(applied.data.localization.fields[0]).toMatchObject({ sourceLanguage: 'und', translations: { zh: null, en: result.fields[1]!.translations.en } });

    const refreshed = structuredClone(bundle);
    refreshed.vehicle.version++;
    refreshed.localization.vehicleVersion = refreshed.vehicle.version;
    refreshed.localization.revision++;
    const adoptionBase = { vehicleVersion: refreshed.vehicle.version, localizationRevision: refreshed.localization.revision };
    const recovered = await applyTranslationPlanResult(plan, refreshed, workspaceData(refreshed), refreshed, result, [], adoptionBase);
    expect(recovered.applied).toBe(4);
    refreshed.vehicle.draft.content.title.sourceLanguage = 'und';
    const rebound = await applyTranslationPlanResult(plan, refreshed, workspaceData(refreshed), refreshed, result, [], adoptionBase);
    expect(rebound.applied).toBe(2);
    expect(rebound.data.content.title.translations.ru).toBeNull();
  });
  it('缺项续译拒绝包含有效或受保护译文的计划', async () => {
    const { bundle, plan, result } = await setup();
    await expect(assertTranslationPlan(plan, bundle, true)).rejects.toThrow('未标明每项待译语言');
    const explicitPlan = TranslationPlanSchema.parse({
      ...plan, fields: plan.fields.map(field => ({ ...field, targets: ['en', 'ru'] })),
    });
    bundle.vehicle.draft.content.title.translations.en = { ...result.fields[0]!.translations.en! };
    await expect(assertTranslationPlan(explicitPlan, bundle, true)).rejects.toThrow('已有或受保护');
    const remaining = TranslationPlanSchema.parse({
      ...plan,
      fields: [{ ...explicitPlan.fields[0], targets: ['ru'] }, explicitPlan.fields[1]],
      estimate: { ...plan.estimate, maximumCharacters: 12, maximumRequests: 3 },
    });
    await expect(assertTranslationPlan(remaining, bundle, true)).resolves.toBeUndefined();
    const incomplete = TranslationPlanSchema.parse({
      ...remaining, fields: [], estimate: { ...remaining.estimate, maximumCharacters: 0, maximumRequests: 0 },
    });
    await expect(assertTranslationPlan(incomplete, bundle, true)).rejects.toThrow('遗漏待译项目');
    const historical = structuredClone(bundle);
    historical.vehicle.draft.content.title.translations.en = {
      ...result.fields[0]!.translations.en!, kind: 'original', engineVersion: null,
    };
    await expect(assertTranslationPlan(remaining, historical, true)).resolves.toBeUndefined();
    result.fields[0]!.targetHumanEditVersions.en = 0;
    const corrected = await applyTranslationPlanResult(explicitPlan, historical, workspaceData(historical), historical,
      { ...result, fields: result.fields.map(field => ({ ...field, targets: ['en', 'ru'] })) });
    expect(corrected.data.content.title.translations.en?.kind).toBe('original');
    bundle.vehicle.draft.content.title.translations.ru = {
      ...result.fields[0]!.translations.ru!, kind: 'human', engineVersion: null, reviewStatus: 'stale',
    };
    await expect(assertTranslationPlan(remaining, bundle, true)).rejects.toThrow('已有或受保护');
  });
  it('完整与部分结果直接填入pending建议，缺失目标保留原内容，已过期计划仍可只读采用当前源的结果', async () => {
    const { bundle, plan, result } = await setup();
    const full = await applyTranslationPlanResult(plan, bundle, workspaceData(bundle), structuredClone(bundle), result);
    expect(full.applied).toBe(4); expect(full.missing).toBe(0);
    expect(full.data.content.title.translations.en).toMatchObject({ kind: 'machine', reviewStatus: 'pending', humanEditVersion: 0 });
    expect(bundle.vehicle.draft.content.title.translations.en).toBeNull();
    bundle.vehicle.draft.content.title.translations.ru = { ...result.fields[0]!.translations.ru!, text: 'Ранее сохранённый текст', humanEditVersion: 2 };
    const partial = structuredClone(result); partial.status = 'partial'; partial.fields[0]!.translations.ru = null;
    partial.fields[0]!.targetHumanEditVersions.ru = 2;
    partial.failures = [{ ref: 'content.title', targetLocale: 'ru', code: 'outcome_unknown' }];
    const adopted = await applyTranslationPlanResult(plan, bundle, workspaceData(bundle), bundle, partial);
    expect(adopted.applied).toBe(3); expect(adopted.missing).toBe(1);
    expect(adopted.data.content.title.translations.ru).toEqual(bundle.vehicle.draft.content.title.translations.ru);
    expect(adopted.data.localization.fields[0]!.translations.ru?.kind).toBe('machine');
  });
  it('旧回执只填当前版本下仍为空、且来源与人工编辑版本匹配的译文', async () => {
    const { bundle, plan, result } = await setup();
    const current = structuredClone(bundle);
    current.vehicle.version++;
    current.localization.vehicleVersion = current.vehicle.version;
    current.localization.revision++;
    current.vehicle.draft.content.title.translations.en = {
      ...result.fields[0]!.translations.en!, text: '已保存的文字', kind: 'human', humanEditVersion: 3, engineVersion: null,
    };
    current.localization.data.fields[0]!.sourceHash = '3'.repeat(64);
    const adoptionBase = { vehicleVersion: current.vehicle.version, localizationRevision: current.localization.revision };
    const adopted = await applyTranslationPlanResult(plan, current, workspaceData(current), current, result, [], adoptionBase);
    expect(adopted.applied).toBe(1);
    expect(adopted.data.content.title.translations).toEqual({
      zh: null, en: current.vehicle.draft.content.title.translations.en, ru: result.fields[0]!.translations.ru,
    });
    expect(adopted.data.localization.fields[0]!.translations).toEqual({ zh: null, en: null, ru: null });
    expect(workspaceSaveRequest(current, adopted.data)).toMatchObject({ version: adoptionBase.vehicleVersion, localizationRevision: adoptionBase.localizationRevision });
    await expect(applyTranslationPlanResult(plan, current, workspaceData(current), current, result, [], {
      ...adoptionBase, localizationRevision: adoptionBase.localizationRevision - 1,
    })).rejects.toThrow('没有覆盖');
  });
  it('人工修改和已核对内容完整保留，包括原目标人工版本', async () => {
    const { bundle, plan, result } = await setup();
    const title = bundle.vehicle.draft.content.title;
    title.translations.en = { ...result.fields[0]!.translations.en!, text: 'Employee title', kind: 'human', humanEditVersion: 5, engineVersion: null };
    const display = bundle.localization.data.fields[0]!;
    display.translations.ru = { ...result.fields[1]!.translations.ru!, text: 'Проверенный текст', reviewStatus: 'approved', humanEditVersion: 8 };
    result.fields[0]!.targetHumanEditVersions.en = 5; result.fields[0]!.translations.en!.humanEditVersion = 5;
    result.fields[1]!.targetHumanEditVersions.ru = 8; result.fields[1]!.translations.ru!.humanEditVersion = 8;
    const adopted = await applyTranslationPlanResult(plan, bundle, workspaceData(bundle), bundle, result);
    expect(adopted.protected).toBe(2);
    expect(adopted.data.content.title.translations.en).toEqual(title.translations.en);
    expect(adopted.data.localization.fields[0]!.translations.ru).toEqual(display.translations.ru);
  });
  it('拒绝过期车辆、公开源、配置、删除或本地输入，读到同版本旧对也不能覆盖新父版本', async () => {
    const { bundle, plan, result } = await setup();
    for (const mutate of [
      (next: typeof bundle) => { next.vehicle.version++; next.localization.vehicleVersion++; },
      (next: typeof bundle) => { next.vehicle.draft.content.title.sourceText = '另一标题'; },
      (next: typeof bundle) => { next.vehicle.draft.configuration = { version: 1, items: [{ name: '座位数', value: '5' }] }; },
      (next: typeof bundle) => { next.vehicle.deletedAt = '2026-11-12T12:05:00.000Z'; },
    ]) {
      const fresh = structuredClone(bundle); mutate(fresh);
      await expect(applyTranslationPlanResult(plan, bundle, workspaceData(bundle), fresh, result)).rejects.toThrow('没有覆盖');
    }
    const dirty = workspaceData(bundle); dirty.content.title.translations.en = { ...result.fields[0]!.translations.en!, kind: 'human' };
    await expect(applyTranslationPlanResult(plan, bundle, dirty, bundle, result)).rejects.toThrow('没有覆盖');
    expect(() => assertWorkspaceFresh({ ...bundle.vehicle, version: bundle.vehicle.version + 1 }, bundle)).toThrow('过期');
  });
  it('拒绝错计划、指纹、目标人工修订、引擎及缺失字段，不允许结果伪记人工审核', async () => {
    const { bundle, plan, result } = await setup();
    const mutations: Array<(next: TranslationPlanResult) => void> = [
      next => { next.planId = '20000000-0000-4000-8000-000000000002'; },
      next => { next.sourceFingerprint = '0'.repeat(64); },
      next => { next.fields[0]!.targetHumanEditVersions.en = 1; next.fields[0]!.translations.en!.humanEditVersion = 1; },
      next => { next.fields[0]!.translations.en!.engineVersion = 'another-engine'; },
      next => { next.fields.pop(); },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(result); mutate(changed);
      await expect(applyTranslationPlanResult(plan, bundle, workspaceData(bundle), bundle, changed)).rejects.toThrow();
    }
    const falselyReviewed = structuredClone(result) as unknown as { fields: Array<{ translations: { en: { reviewStatus: string } } }> };
    falselyReviewed.fields[0]!.translations.en.reviewStatus = 'approved';
    expect(TranslationPlanResultSchema.safeParse(falselyReviewed).success).toBe(false);
  });
  it('一次明确中文确认只提交GET范围，保存保留正文源、空值和额外事实', async () => {
    const { bundle } = await setup();
    bundle.sourceLanguageConfirmationRequired = ['content.title', 'model'];
    bundle.vehicle.draft.content.title.sourceLanguage = 'und'; bundle.localization.data.fields[0]!.sourceLanguage = 'en';
    const data = workspaceData(bundle); data.sourceLanguageConfirmations = [...bundle.sourceLanguageConfirmationRequired];
    const input = workspaceSaveRequest(bundle, data);
    expect(input.sourceLanguageConfirmations).toEqual(['content.title', 'model']);
    expect(input.content.title.sourceLanguage).toBe('und');
    expect(input.localization.fields[0]!.sourceLanguage).toBe('en');
    expect(input.content.description.sourceText).toBeNull(); expect(input.localization.facts).toEqual({ generation: null, drivetrain: null });
    expect(workspaceDirty(bundle, data)).toBe(true);
    expect(() => workspaceSaveRequest(bundle, { ...data, sourceLanguageConfirmations: ['content.title'] })).toThrow('范围');
    const wrongSource = structuredClone(data); wrongSource.content.title.sourceText = '多语页偷偷改原文';
    expect(() => workspaceSaveRequest(bundle, wrongSource)).toThrow('车辆资料');
  });
  it('未知保存读取只有完整原始快照未变才允许原正文重试判断', async () => {
    const { bundle } = await setup();
    expect(() => assertWorkspaceSnapshot(bundle, structuredClone(bundle))).not.toThrow();
    const newer = structuredClone(bundle); newer.localization.revision++;
    expect(() => assertWorkspaceSnapshot(bundle, newer)).toThrow('没有覆盖');
  });
  it('历史中文偏离时可无本地修改主动保存，客户端不篡改human或伪造审核', async () => {
    const { bundle, result } = await setup();
    bundle.vehicle.draft.content.title.translations.zh = { ...result.fields[0]!.translations.zh, text: '旧人工中文', kind: 'human', reviewStatus: 'approved', humanEditVersion: 9 };
    bundle.vehicle.draft.content.title.translations.en = { ...result.fields[0]!.translations.en!, kind: 'human', text: 'Kept employee English', engineVersion: null };
    const data = workspaceData(bundle);
    expect(workspaceDirty(bundle, data)).toBe(false);
    expect(workspaceNeedsChineseNormalization(bundle)).toBe(true);
    const save = workspaceSaveRequest(bundle, data);
    expect(save.content.title.translations.zh).toEqual(bundle.vehicle.draft.content.title.translations.zh);
    expect(save.content.title.translations.en).toEqual(bundle.vehicle.draft.content.title.translations.en);
    // Synthetic server PUT response: canonical Chinese is original/current/pending, never approved.
    bundle.vehicle.draft.content.title.translations.zh = result.fields[0]!.translations.zh;
    bundle.localization.data.fields[0]!.translations.zh = result.fields[1]!.translations.zh;
    expect(workspaceNeedsChineseNormalization(bundle)).toBe(false);
    bundle.localization.data.fields[0]!.translations.zh!.reviewStatus = 'stale';
    expect(workspaceNeedsChineseNormalization(bundle)).toBe(false);
  });
});

it('counts only empty slots for saved sources, allowing generated Chinese', async () => {
  const { bundle } = await setup();
  const data = workspaceData(bundle);
  expect(workspaceTranslationGaps(bundle, data).every(gap => gap.ref !== 'content.description')).toBe(true);
  expect(workspaceIsSourceDeclarationOnly(bundle, { ...data, sourceLanguageConfirmations: ['model'] })).toBe(true);
  const factsOnly = workspaceData(bundle);
  factsOnly.localization.facts.drivetrain = 'awd';
  expect(workspaceIsFactsOnly(bundle, factsOnly)).toBe(true);
  factsOnly.content.description.sourceText = 'Changed';
  expect(workspaceIsFactsOnly(bundle, factsOnly)).toBe(false);
  data.content.description.sourceText = '合成车况';
  for (const field of [...Object.values(data.content), ...data.localization.fields]) {
    for (const locale of ['en', 'ru'] as const) field.translations[locale] = {
      text: 'Synthetic translation', kind: 'human', reviewStatus: 'pending',
      sourceVersion: field.sourceVersion, humanEditVersion: 0, engineVersion: null,
    };
  }
  expect(workspaceTranslationGaps(bundle, data)).toEqual([]);
  data.content.title.translations.ru!.reviewStatus = 'stale';
  data.content.title.translations.ru!.sourceVersion = 1;
  data.localization.fields[0]!.translations.en!.text = ' \t\n';
  expect(workspaceTranslationGaps(bundle, data)).toEqual([{ ref: 'model', locale: 'en' }]);
});
