import { parseConfigurationImportJson, vehicleConfigurationItemId } from '@hd/contracts/admin';
import { adminVehicleFixture, makeVehicleLocalizationFixture } from '@hd/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { configurationImportIssues, configurationImportPrompt, importExampleText, prepareConfigurationImport, savedImportRows } from './configuration-import-model';
import { draftToForm, emptyDraft } from './draft-form';

describe('configuration import prompt', () => {
  it('uses a complete sample accepted by the configuration import parser', () => {
    const prompt = configurationImportPrompt(draftToForm(emptyDraft()), null);
    expect(prompt).toContain('直接输出成 UTF-8 JSON 文件，文件名为 vehicle-configuration.json，并提供下载');
    expect(prompt).toContain('不要在聊天中逐段输出文件内容');
    expect(prompt).toContain('不能把语言代号作为占位值');
    const exampleLine = prompt.split('结构示例（只说明格式，不能套用示例值和标识）：\n')[1]!.split('\n')[0]!;
    const { json, document: example } = prepareConfigurationImport(exampleLine);

    expect(example).toEqual(prepareConfigurationImport(importExampleText).document);
    expect(parseConfigurationImportJson(json)).toEqual(example);
    expect(JSON.parse(exampleLine).items[0]).not.toHaveProperty('id');
    expect(example.items).toContainEqual(expect.objectContaining({ id: vehicleConfigurationItemId('动力类型') }));
    expect(example.facts).toEqual({ powertrain: 'petrol' });
    expect(example.content).toHaveProperty('title.ru');
    expect(example.content).toHaveProperty('description.en');
    expect(example.display).toEqual([{ ref: 'model', text: { zh: '卡罗拉', ru: 'Corolla', en: 'Corolla' } }]);
    expect(exampleLine).toBe(JSON.stringify(JSON.parse(exampleLine)));
  });

  it('checks duplicate keys and keeps existing import IDs bound to their Chinese names', () => {
    const { json } = prepareConfigurationImport(importExampleText);
    expect(prepareConfigurationImport(json).json).toBe(json);
    expect(() => prepareConfigurationImport(importExampleText.replace('"zh": "挡位数"', '"zh": "挡位数", "zh": "档位数"'))).toThrow(/Duplicate JSON property/);
    expect(() => prepareConfigurationImport(json.replace('"zh":"挡位数"', '"zh":"档位数"'))).toThrow(/Item ID must be unique and match its Chinese name/);
  });

  it.each([
    { value: { zh: 'zh', en: 'en', ru: 'ru' }, path: 'items[0].value' },
    { value: { zh: '8', en: '8', ru: '9' }, path: 'items[0].value.ru' },
  ])('reports the literal mismatch at $path', ({ value, path }) => {
    const document = JSON.parse(importExampleText);
    document.items[0].value = value;
    let failure: unknown;
    try { prepareConfigurationImport(JSON.stringify(document)); }
    catch (error) { failure = error; }

    expect(configurationImportIssues(failure)).toEqual([
      { path, message: expect.stringContaining('避免使用 zh、en、ru 作为占位值') },
    ]);
  });

  it('limits the copied vehicle context to public inputs and existing display refs', () => {
    const form = {
      ...draftToForm(emptyDraft()),
      makeName: '丰田', modelName: '卡罗拉', modelYear: '2024', title: '合成标题', description: '合成描述',
      sourceListingUrl: 'https://example.invalid/private-listing', purchaseAmount: '8811223',
      notes: '合成内部备注', supplierContact: '合成供应商联系方式', vin: 'SYNTHETICVIN00001',
    };
    const publicField = { ref: 'location.displayName', sourceText: '成都市', sourceHash: 'private-hash' };
    const prompt = configurationImportPrompt(form, null, [
      publicField,
      { ref: `configuration.${vehicleConfigurationItemId('挡位数')}.name`, sourceText: '单独配置字段' },
      { ref: 'internal.notes', sourceText: '不受支持的内部字段' },
    ]);
    const publicFieldsLine = prompt.split('已有公开展示文案：\n')[1]!.split('\n')[0]!;
    const draftFactsLine = prompt.split('以下是待检索车辆基础资料：\n')[1]!;

    expect(JSON.parse(publicFieldsLine)).toEqual([{ ref: 'location.displayName', sourceText: '成都市', maxLength: 200 }]);
    expect(JSON.parse(draftFactsLine)).toMatchObject({ 品牌: '丰田', 车型: '卡罗拉', 年款: '2024', 中文标题: '合成标题', 车况描述: '合成描述' });
    for (const privateValue of [form.sourceListingUrl, form.purchaseAmount, form.notes, form.supplierContact, form.vin, publicField.sourceHash]) {
      expect(prompt).not.toContain(privateValue);
    }
    expect(prompt).not.toContain('单独配置字段');
    expect(prompt).not.toContain('不受支持的内部字段');
  });
});

describe('saved configuration comparison', () => {
  it('reads exact saved language slots, known originals and locale-neutral values', () => {
    const localization = makeVehicleLocalizationFixture();
    const vehicle = { ...structuredClone(adminVehicleFixture), id: localization.vehicleId, version: localization.vehicleVersion };
    vehicle.draft.content.title = {
      sourceLanguage: 'ru-RU', sourceText: 'Заголовок', sourceVersion: 1,
      translations: { zh: null, en: null, ru: null },
    };
    vehicle.draft.configuration = { version: 1, items: [{ name: '挡位数', value: '8' }, { name: '驱动方式', value: '四轮驱动' }] };
    const fields = localization.data.fields;
    const savedModel = fields[0]!;
    fields.push({ ...savedModel, ref: `configuration.${vehicleConfigurationItemId('挡位数')}.name`, sourceText: '挡位数',
      translations: { zh: null, en: { ...savedModel.translations.en!, text: 'Number of gears' }, ru: null } });

    const rows = savedImportRows({ vehicle, localization, sourceLanguageConfirmationRequired: [] });
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '车辆标题', zh: null, en: null, ru: 'Заголовок' }),
      expect.objectContaining({ label: '车型名称', zh: '样例车型', en: 'Sample model', ru: null }),
      expect.objectContaining({ label: '挡位数 · 名称', zh: '挡位数', en: 'Number of gears', ru: null }),
      expect.objectContaining({ label: '挡位数 · 内容', zh: '8', en: '8', ru: '8' }),
      expect.objectContaining({ label: '驱动方式 · 内容', zh: '四轮驱动', en: null, ru: null }),
    ]));
  });
});
