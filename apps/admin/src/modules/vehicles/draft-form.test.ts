import { describe, expect, it } from 'vitest';
import { VehicleDraftInputSchema } from '@hd/contracts/admin';
import { makeExternalVehicleDraftFixture, makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { changedFields, draftToForm, emptyDraft, fieldForPath, formToDraft } from './draft-form';

describe('草稿表单与统一契约', () => {
  it('新草稿保留未知事实，待询价不变成零', () => {
    const result = formToDraft(emptyDraft(), draftToForm(emptyDraft()));
    expect(VehicleDraftInputSchema.safeParse(result).success).toBe(true);
    expect(result.facts.manufacturedAt).toBeNull();
    expect(result.facts.mileageKm).toBeNull();
    expect(result.price.money).toBeNull();
    expect(result.content.title.translations.ru).toBeNull();
  });
  it('只编辑备注，完整保留图片、三语文本与所有审核版本', () => {
    const draft = makeVehicleDraftFixture();
    const result = formToDraft(draft, { ...draftToForm(draft), notes: '新备注' });
    expect(result.media).toEqual(draft.media);
    expect(result.content).toEqual(draft.content);
    expect(result.facts).toEqual(draft.facts);
    expect(result.internal.notes).toBe('新备注');
    expect(draft.internal.notes).not.toBe('新备注');
  });
  it('原文修改交由服务端递增版本，客户端保留旧审核记录', () => {
    const draft = makeVehicleDraftFixture();
    const result = formToDraft(draft, { ...draftToForm(draft), title: '新的原文' });
    expect(result.content.title.sourceText).toBe('新的原文');
    expect(result.content.title.sourceVersion).toBe(draft.content.title.sourceVersion);
    expect(result.content.title.translations).toEqual(draft.content.title.translations);
  });
  it('不因修改另一字段清理原文空白或改写已有事实', () => {
    const draft = makeVehicleDraftFixture();
    draft.content.title.sourceText = ' 保留原文空白 ';
    draft.content.title.translations.zh!.text = draft.content.title.sourceText;
    draft.facts.make!.name = ' 品牌显示名 ';
    draft.price.includes = [' 既有范围 '];
    const result = formToDraft(draft, { ...draftToForm(draft), notes: '修改备注' });
    expect(result.content).toEqual(draft.content);
    expect(result.facts).toEqual(draft.facts);
    expect(result.price).toEqual(draft.price);
  });
  it('金额不经过浮点转换，已知零与未知值不同', () => {
    const draft = emptyDraft();
    const result = formToDraft(draft, { ...draftToForm(draft), priceKind: 'asking', amount: '99999999999999.99', mileageKm: '0', engineCc: '' });
    expect(result.price.money?.amount).toBe('99999999999999.99');
    expect(result.facts.mileageKm).toBe(0);
    expect(result.facts.engineCc).toBeNull();
  });
  it('切到待询价时清空金额但保留价格包含项目', () => {
    const draft = makeVehicleDraftFixture();
    const result = formToDraft(draft, { ...draftToForm(draft), priceKind: 'on_request' });
    expect(result.price.money).toBeNull();
    expect(result.price.includes).toEqual(draft.price.includes);
  });
  it('保留年精度，不把首次登记填成制造日期', () => {
    const draft = emptyDraft();
    const result = formToDraft(draft, { ...draftToForm(draft), manufacturedAt: '2021', manufacturedPrecision: 'year' });
    expect(result.facts.manufacturedAt).toEqual({ value: '2021', precision: 'year' });
    expect(result.facts.firstRegistration).toBeNull();
  });
  it('拒绝非法日期、非法金额与只填名称没有标识的车型', () => {
    const draft = emptyDraft(); const form = draftToForm(draft);
    expect(() => formToDraft(draft, { ...form, manufacturedAt: '2023-02-29', manufacturedPrecision: 'day' })).toThrow();
    expect(() => formToDraft(draft, { ...form, priceKind: 'asking', amount: '1,000' })).toThrow();
    expect(() => formToDraft(draft, { ...form, modelName: '未指定标识' })).toThrow();
    expect(() => formToDraft(draft, { ...form, mileageKm: '0x10' })).toThrow();
    expect(() => formToDraft(draft, { ...form, engineCc: '1e2' })).toThrow();
  });
  it('外部来源字段可往返并定位来源错误', () => {
    const draft = makeExternalVehicleDraftFixture();
    const form = draftToForm(draft);
    expect(formToDraft(draft, form)).toEqual(draft);
    expect(fieldForPath('draft.source.platform.id')).toBe('sourcePlatformId');
    expect(fieldForPath('draft.source.listingUrl')).toBe('sourceListingUrl');
    expect(fieldForPath('draft.source.collectedAt')).toBe('sourceCollectedAt');
  });
  it('冲突比较显示实际字段差异并定位嵌套错误', () => {
    const form = draftToForm(emptyDraft());
    expect(changedFields(form, { ...form, notes: '其他员工输入', amount: '12.50' })).toEqual(['amount', 'notes']);
    expect(fieldForPath('draft.facts.manufacturedAt.value')).toBe('manufacturedAt');
    expect(fieldForPath('draft.price.money.amount')).toBe('amount');
  });
});
