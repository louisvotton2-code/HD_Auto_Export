import { describe, expect, it } from 'vitest';
import { makeVehicleLocalizationFixture, contractFixtures } from '@hd/contracts/fixtures';
import { DisplayTranslationSuggestionsSchema, type DisplayTranslationSuggestions } from '@hd/contracts/admin';
import {
  applyDisplaySuggestions, assertLocalizationReadNotOlder, assertLocalizationSnapshot, brandIdentityOptions, changeDisplayLanguage, displayFieldLabel,
  displayReviewState, editDisplayTranslation, localizationChanged, localizationComparison, localizationSaveRequest, reviewDisplayTranslation,
} from './vehicle-localization-model';

function suggestion(): DisplayTranslationSuggestions {
  const base = makeVehicleLocalizationFixture();const field = structuredClone(base.data.fields[0]);
  for (const locale of ['zh', 'en', 'ru'] as const) field.translations[locale] = {
    text: locale === 'zh' ? field.sourceText : `${locale}:new suggestion`, kind: locale === 'zh' ? 'original' : 'machine',
    reviewStatus: 'pending', sourceVersion: field.sourceVersion, humanEditVersion: base.data.fields[0].translations[locale]?.humanEditVersion ?? 0,
    engineVersion: locale === 'zh' ? null : 'test-engine',
  };
  return DisplayTranslationSuggestionsSchema.parse({ vehicleId: base.vehicleId, vehicleVersion: base.vehicleVersion, revision: base.revision, fields: [field] });
}

describe('独立公开展示资料的编辑与保存', () => {
  it('明确部分来源或仅录入已知事实时允许保存，其他und与null保持，不猜语言', () => {
    const base = makeVehicleLocalizationFixture();base.data.fields[0].sourceLanguage = 'und';
    const data = structuredClone(base.data);data.facts.drivetrain = 'awd';
    expect(localizationSaveRequest(base, data)).toEqual({ vehicleVersion: base.vehicleVersion, revision: base.revision, data });
    expect(localizationSaveRequest(base, data).data.fields[0].sourceLanguage).toBe('und');
    expect(localizationSaveRequest(base, data).data.facts.generation).toBeNull();
    data.fields.push({ ...structuredClone(data.fields[0]), ref: 'trim' });
    data.fields[0] = changeDisplayLanguage(data.fields[0], 'zh');
    const saved = localizationSaveRequest(base, data);expect(saved.data.fields.map(field => field.sourceLanguage)).toEqual(['zh', 'und']);
    expect(localizationChanged(base, data)).toBe(true);expect(localizationChanged(base, base.data)).toBe(false);
  });
  it('来源语言改变保留服务端hash与版本，旧译文stale；同次不能审核', () => {
    const original = makeVehicleLocalizationFixture().data.fields[0];original.sourceLanguage = 'und';
    const changed = changeDisplayLanguage(original, 'zh');
    expect(changed).toMatchObject({ ref: original.ref, sourceText: original.sourceText, sourceHash: original.sourceHash, sourceVersion: original.sourceVersion });
    expect(changed.translations.zh?.reviewStatus).toBe('stale');expect(changed.translations.zh?.humanEditVersion).toBe(original.translations.zh?.humanEditVersion);
    expect(reviewDisplayTranslation(changed, original, 'zh', true)).toBe(changed);
    expect(reviewDisplayTranslation(original, original, 'en', true)).toBe(original);
  });
  it('人工修改与清空重填沿用GET人工版本，采用原文也只是pending', () => {
    const saved = makeVehicleLocalizationFixture().data.fields[0];saved.translations.en!.humanEditVersion = 7;
    const edited = editDisplayTranslation(saved, saved, 'en', 'Human correction');
    expect(edited.translations.en).toMatchObject({ kind: 'human', engineVersion: null, reviewStatus: 'pending', humanEditVersion: 7 });
    const cleared = editDisplayTranslation(edited, saved, 'en', '');expect(cleared.translations.en).toBeNull();
    expect(editDisplayTranslation(cleared, saved, 'en', 'Restored input').translations.en?.humanEditVersion).toBe(7);
    const original = editDisplayTranslation({ ...saved, translations: { ...saved.translations, zh: null } }, saved, 'zh', saved.sourceText);
    expect(original.translations.zh).toMatchObject({ kind: 'original', reviewStatus: 'pending', humanEditVersion: saved.translations.zh!.humanEditVersion });
  });
  it('明确审核旧译文改为当前来源版本，人工版本不自增', () => {
    const saved = makeVehicleLocalizationFixture().data.fields[0];saved.sourceVersion = 2;saved.translations.en!.reviewStatus = 'stale';
    expect(displayReviewState(saved, saved, 'en')).toBe('stale');
    const approved = reviewDisplayTranslation(saved, saved, 'en', true);
    expect(approved.translations.en).toMatchObject({ sourceVersion: 2, humanEditVersion: 0, reviewStatus: 'approved', kind: 'machine', engineVersion: 'fixture-engine-1' });
  });
  it('展示文本按正式字段上限校验，超限不截断也不进入保存或建议采用', () => {
    const base = makeVehicleLocalizationFixture();const data = structuredClone(base.data);
    data.fields[0] = editDisplayTranslation(data.fields[0], base.data.fields[0], 'en', 'x'.repeat(121));
    expect(data.fields[0].translations.en?.text).toHaveLength(121);expect(() => localizationSaveRequest(base, data)).toThrow();
    const generated = suggestion();generated.fields[0].translations.en!.text = 'x'.repeat(121);
    expect(() => applyDisplaySuggestions(base, base.data, generated, ['model'])).toThrow();
    data.fields[0].translations.en!.text = 'x'.repeat(120);expect(() => localizationSaveRequest(base, data)).not.toThrow();
  });
});

describe('展示机器建议的快照与人工保护', () => {
  it('成对旧GET迟于核心保存返回时拒绝采用，已保存的新车辆输入保持', () => {
    const old = makeVehicleLocalizationFixture();const oldVehicle = { ...structuredClone(contractFixtures.draft), id: old.vehicleId, version: old.vehicleVersion };
    const savedVehicle = structuredClone(oldVehicle);savedVehicle.version++;savedVehicle.draft.content.title.sourceText = '已经保存的新核心资料';
    let displayed = savedVehicle;
    expect(() => { assertLocalizationReadNotOlder(displayed, oldVehicle, old, null);displayed = oldVehicle; }).toThrow('已忽略');
    expect(displayed.version).toBe(savedVehicle.version);expect(displayed.draft.content.title.sourceText).toBe('已经保存的新核心资料');
    const fresh = { ...structuredClone(old), vehicleVersion: savedVehicle.version };
    expect(() => assertLocalizationReadNotOlder(savedVehicle, savedVehicle, fresh, null)).not.toThrow();
  });
  it('加载、比较、保存及生成共用的读取门槛拒绝旧sidecar/错配/删除状态', () => {
    const known = makeVehicleLocalizationFixture();const vehicle = { ...contractFixtures.draft, id: known.vehicleId, version: known.vehicleVersion };
    expect(() => assertLocalizationReadNotOlder(vehicle, vehicle, structuredClone(known), known)).not.toThrow();
    const older = structuredClone(known);older.revision--;
    expect(() => assertLocalizationReadNotOlder(vehicle, vehicle, older, known)).toThrow();
    expect(() => assertLocalizationReadNotOlder(vehicle, { ...vehicle, version: vehicle.version + 1 }, known, known)).toThrow();
    expect(() => assertLocalizationReadNotOlder({ ...vehicle, deletedAt: '2026-11-08T00:00:00Z' }, vehicle, known, known)).toThrow();
    expect(() => assertLocalizationReadNotOlder(vehicle, { ...vehicle, deletedAt: '2026-11-08T00:00:00Z' }, known, known)).toThrow();
  });
  it('仅填本地pending，保护原有human/approved，保存快照不变', () => {
    const base = makeVehicleLocalizationFixture();const before = structuredClone(base);const result = applyDisplaySuggestions(base, base.data, suggestion(), ['model']);
    expect(result.applied).toBe(2);expect(result.protected).toBe(1);expect(result.data.fields[0].translations.zh).toEqual(base.data.fields[0].translations.zh);
    expect(result.data.fields[0].translations.ru).toMatchObject({ kind: 'machine', reviewStatus: 'pending', humanEditVersion: 0 });expect(base).toEqual(before);
    base.data.fields[0].translations.en!.kind = 'human';
    const protectedResult = applyDisplaySuggestions(base, base.data, suggestion(), ['model']);
    expect(protectedResult.data.fields[0].translations.en).toEqual(base.data.fields[0].translations.en);expect(protectedResult.protected).toBe(2);
  });
  it('独立拒绝车辆版本、sidecar修订、hash或人工目标改变的fresh快照', () => {
    const original = makeVehicleLocalizationFixture();
    for (const mutate of [
      (value: typeof original) => { value.vehicleVersion++; }, (value: typeof original) => { value.revision++; },
      (value: typeof original) => { value.data.fields[0].sourceHash = 'b'.repeat(64); },
      (value: typeof original) => { value.data.fields[0].translations.en!.humanEditVersion++; },
      (value: typeof original) => { value.data.fields[0].translations.en!.text = 'Concurrent edit'; },
    ]) { const fresh = structuredClone(original);mutate(fresh);expect(() => assertLocalizationSnapshot(original, fresh)).toThrow(); }
    expect(() => assertLocalizationSnapshot(original, structuredClone(original))).not.toThrow();
  });
  it('拒绝本地dirty、错位refs、错误hash、人改版本和伪装机器/审核结果', () => {
    const base = makeVehicleLocalizationFixture();const changed = structuredClone(base.data);changed.facts.drivetrain = 'fwd';
    expect(() => applyDisplaySuggestions(base, changed, suggestion(), ['model'])).toThrow();
    for (const mutate of [
      (value: DisplayTranslationSuggestions) => { value.vehicleVersion++; }, (value: DisplayTranslationSuggestions) => { value.revision++; },
      (value: DisplayTranslationSuggestions) => { value.fields[0].ref = 'trim'; }, (value: DisplayTranslationSuggestions) => { value.fields[0].sourceHash = 'b'.repeat(64); },
      (value: DisplayTranslationSuggestions) => { value.fields[0].translations.en!.humanEditVersion++; },
      (value: DisplayTranslationSuggestions) => { value.fields[0].translations.en!.reviewStatus = 'approved'; },
      (value: DisplayTranslationSuggestions) => { value.fields[0].translations.en!.kind = 'original'; },
    ]) { const value = suggestion();mutate(value);expect(() => applyDisplaySuggestions(base, base.data, value, ['model'])).toThrow(); }
  });
});

describe('稳定引用与品牌目录接入', () => {
  it('图片按mediaId识别当前编号，费用按GET引用，不拿排序号当身份', () => {
    const vehicle = structuredClone(contractFixtures.draft);const field = makeVehicleLocalizationFixture().data.fields[0];
    vehicle.draft.media = [{ id: '550e8400-e29b-41d4-a716-446655440001', alt: '', sortOrder: 1, isCover: false }, { id: '550e8400-e29b-41d4-a716-446655440002', alt: '', sortOrder: 0, isCover: true }];
    field.ref = 'media.550e8400-e29b-41d4-a716-446655440001.alt';expect(displayFieldLabel(field, [field], vehicle)).toBe('图片 2 说明');
    vehicle.draft.media[0].sortOrder = 0;vehicle.draft.media[1].sortOrder = 1;expect(displayFieldLabel(field, [field], vehicle)).toBe('图片 1 说明');
    const fee = { ...field, ref: 'price.includes.550e8400-e29b-41d4-a716-446655440003' };expect(displayFieldLabel(fee, [field, fee], vehicle)).toBe('费用条目 1');expect(fee.ref).toContain('550e8400');
  });
  it('提供预设品牌并保留历史ID与原名，未识别品牌照常保留', () => {
    const selected = { id: 'manual_existing_toyota', name: 'Toyota' };
    const options = brandIdentityOptions([{ ...selected }, { id: 'custom', name: 'Custom Brand' }], selected);
    expect(options.find(option => option.value === selected.id)).toMatchObject({ rawName: 'Toyota', label: expect.stringContaining('丰田') });
    expect(options.find(option => option.value === 'toyota')).toMatchObject({ rawName: '丰田' });
    expect(options.find(option => option.value === 'custom')?.label).toBe('Custom Brand');expect(selected).toEqual({ id: 'manual_existing_toyota', name: 'Toyota' });
  });
  it('冲突比较保留本地与服务端差异，不把远端自动覆盖为输入', () => {
    const base = makeVehicleLocalizationFixture();const remote = structuredClone(base.data);remote.fields[0].translations.en!.text = 'Remote result';
    expect(localizationComparison(base.data, remote, contractFixtures.draft)).toContainEqual(expect.objectContaining({ label: '车型名称 · 英文', local: expect.stringContaining('Sample model'), remote: expect.stringContaining('Remote result') }));
    expect(base.data.fields[0].translations.en!.text).toBe('Sample model');
  });
});
