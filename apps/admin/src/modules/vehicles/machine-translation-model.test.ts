import { describe, expect, it } from 'vitest';
import { adminVehicleFixture } from '@hd/contracts/fixtures';
import type { VehicleTranslationSuggestions } from '@hd/contracts/admin';
import { applyMachineTranslationSuggestions, translationSourceHash } from './machine-translation-model';

async function setup() {
  const vehicle = structuredClone(adminVehicleFixture);
  vehicle.draft.content.title = { sourceLanguage: 'zh', sourceText: '比亚迪海鸥', sourceVersion: 2, translations: { zh: null, en: null, ru: null } };
  vehicle.draft.content.description = { sourceLanguage: 'zh', sourceText: null, sourceVersion: 1, translations: { zh: null, en: null, ru: null } };
  const field = vehicle.draft.content.title;
  const suggestions: VehicleTranslationSuggestions = {
    vehicleId: vehicle.id, version: vehicle.version, engineVersion: 'aliyun-general-v1',
    content: { title: { sourceLanguage: 'zh', sourceText: field.sourceText!, sourceVersion: 2, sourceHash: await translationSourceHash('zh', field.sourceText), targetHumanEditVersions: { zh: null, en: null, ru: null }, translations: {
      zh: { text: field.sourceText!, kind: 'original', reviewStatus: 'pending', sourceVersion: 2, humanEditVersion: 0, engineVersion: null },
      en: { text: 'BYD Seagull', kind: 'machine', reviewStatus: 'pending', sourceVersion: 2, humanEditVersion: 0, engineVersion: 'aliyun-general-v1' },
      ru: { text: 'BYD Seagull', kind: 'machine', reviewStatus: 'pending', sourceVersion: 2, humanEditVersion: 0, engineVersion: 'aliyun-general-v1' },
    } }, description: null },
  };
  return { vehicle, suggestions };
}

describe('machine translation adoption', () => {
  it('copies the Chinese original and adopts machine suggestions as pending without mutating the record', async () => {
    const { vehicle, suggestions } = await setup();
    const result = await applyMachineTranslationSuggestions(vehicle, vehicle.draft.content, suggestions);
    expect(result.applied).toBe(3);
    expect(result.content.title.translations.en).toMatchObject({ kind: 'machine', reviewStatus: 'pending' });
    expect(result.content.title.translations.zh).toMatchObject({ kind: 'original', text: '比亚迪海鸥' });
    expect(vehicle.draft.content.title.translations.en).toBeNull();
  });
  it('retains employee edits and approved content even when provider suggestions differ', async () => {
    const { vehicle, suggestions } = await setup();
    vehicle.draft.content.title.translations.en = { ...suggestions.content.title.translations.en, text: 'Human title', kind: 'human', humanEditVersion: 4 };
    vehicle.draft.content.title.translations.ru = { ...suggestions.content.title.translations.ru, reviewStatus: 'approved', humanEditVersion: 3 };
    suggestions.content.title.targetHumanEditVersions.en = 4;
    suggestions.content.title.targetHumanEditVersions.ru = 3;
    suggestions.content.title.translations.en.humanEditVersion = 4;
    suggestions.content.title.translations.ru.humanEditVersion = 3;
    const result = await applyMachineTranslationSuggestions(vehicle, vehicle.draft.content, suggestions);
    expect(result.protected).toBe(2);
    expect(result.content.title.translations.en?.text).toBe('Human title');
    expect(result.content.title.translations.ru?.reviewStatus).toBe('approved');
  });
  it('rejects a wrong vehicle, stale source hash, changed human revision or locally edited text', async () => {
    const { vehicle, suggestions } = await setup();
    for (const mutate of [
      (value: VehicleTranslationSuggestions) => { value.version += 1; },
      (value: VehicleTranslationSuggestions) => { value.content.title.sourceHash = '0'.repeat(64); },
      (value: VehicleTranslationSuggestions) => { value.content.title.targetHumanEditVersions.en = 1; },
    ]) {
      const other = structuredClone(suggestions); mutate(other);
      await expect(applyMachineTranslationSuggestions(vehicle, vehicle.draft.content, other)).rejects.toThrow('没有覆盖');
    }
    const current = structuredClone(vehicle.draft.content);
    current.title.translations.en = { ...suggestions.content.title.translations.en, text: 'Unsaved edit' };
    await expect(applyMachineTranslationSuggestions(vehicle, current, suggestions)).rejects.toThrow('没有覆盖');
  });
});
