import { BRAND_CATALOG, NamedValueSchema } from '@hd/contracts/admin';
import { describe, expect, it } from 'vitest';
import { brandIdentityOptions, findIdentityByName, matchesIdentitySearch, modelIdentityOptions } from './model-suggestions';
import { entryBrands } from './vehicle-entry-brands';
import { modelsByBrand } from './vehicle-entry-models';

const empty = { id: '', name: '' };

describe('车辆录入品牌车型选项', () => {
  it('名录保留共享品牌 ID，与保存契约一致，并在各品牌内保持车型身份唯一', () => {
    const brands = brandIdentityOptions([], empty);
    expect(new Set(brands.map(brand => brand.value)).size).toBe(entryBrands.length);
    expect(brands.map(brand => brand.value)).toEqual(expect.arrayContaining(BRAND_CATALOG.map(brand => brand.catalogId)));
    const modelIds = new Set<string>();
    for (const brand of brands) {
      const make = NamedValueSchema.parse({ id: brand.value, name: brand.rawName });
      const models = modelIdentityOptions(make, [], empty);
      for (const model of models) {
        NamedValueSchema.parse({ id: model.value, name: model.rawName });
        expect(modelIds.has(model.value)).toBe(false);
        modelIds.add(model.value);
        for (const alias of [model.rawName, ...model.aliases]) {
          expect(findIdentityByName(models, alias)?.value).toBe(model.value);
        }
      }
    }
    expect(modelIds.size).toBe(Object.values(modelsByBrand).reduce((total, models) => total + models.length, 0));
  });

  it('使用中文、英文和俄语常用名搜索，并将车型限制在当前品牌下', () => {
    const brands = brandIdentityOptions([], empty);
    expect(brands.filter(option => matchesIdentitySearch('Джетур', option)).map(option => option.value)).toEqual(['jetour']);
    expect(findIdentityByName(brands, 'Ｘｉａｏｍｉ')).toMatchObject({ value: 'xiaomi', rawName: '小米汽车' });
    const mazda = modelIdentityOptions({ id: 'mazda', name: '马自达' }, [], empty);
    expect(mazda.filter(option => matchesIdentitySearch('ｃｘ５', option)).map(option => option.value)).toEqual(['mazda-cx-5', 'mazda-cx-50']);
    const li = modelIdentityOptions({ id: 'li-auto', name: '理想' }, [], empty);
    const galaxy = modelIdentityOptions({ id: 'geely-galaxy', name: '吉利银河' }, [], empty);
    expect(findIdentityByName(li, 'L6')).toMatchObject({ value: 'li-auto-l6', rawName: '理想L6' });
    expect(findIdentityByName(galaxy, 'L6')).toMatchObject({ value: 'geely-galaxy-l6', rawName: '银河L6' });
  });

  it('复用历史品牌车型 ID 与原名，接受未知品牌车型以及字典未返回的现有选择', () => {
    const selectedMake = { id: 'manual_existing_toyota', name: 'Toyota' };
    const unknown = { id: 'custom', name: 'Custom Brand' };
    const options = brandIdentityOptions([unknown], selectedMake);
    expect(options.find(option => option.value === selectedMake.id)).toMatchObject({ rawName: 'Toyota', label: '丰田 / Toyota（现有记录）' });
    expect(options.find(option => option.value === 'toyota')).toMatchObject({ rawName: '丰田' });
    expect(options.find(option => option.value === unknown.id)?.label).toBe(unknown.name);
    const selectedModel = { id: 'old-corolla', name: 'Corolla' };
    const knownModels = [{ ...selectedModel, name: '卡罗拉' }, { id: 'custom-model', name: 'Custom Model' }];
    const models = modelIdentityOptions(selectedMake, knownModels, selectedModel);
    expect(findIdentityByName(models, '卡罗拉')).toMatchObject({ value: 'old-corolla', rawName: 'Corolla' });
    expect(models.some(option => option.value === 'toyota-corolla')).toBe(false);
    expect(findIdentityByName(models, 'Custom Model')?.value).toBe('custom-model');
    expect(modelIdentityOptions(selectedMake, [], empty).find(option => option.value === 'toyota-corolla')?.label).toBe('卡罗拉 / Corolla');
    expect(modelIdentityOptions(unknown, [], selectedModel)).toMatchObject([{ value: selectedModel.id, rawName: selectedModel.name }]);
  });
});
