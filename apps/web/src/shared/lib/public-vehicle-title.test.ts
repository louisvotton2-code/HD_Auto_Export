import { describe, expect, it } from 'vitest';
import { makeImportedPublicVehicleFixture, makeLocalizedPublicVehicleFixture, makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { publicVehicleTitle } from './public-vehicle-title';

describe('public vehicle titles', () => {
  it('uses the available Chinese catalog fields when the source title is English', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.content.title = { ...vehicle.content.title, text: 'LI AUTO L7 Max 2024', contentLocale: 'en' };
    vehicle.facts.make = { id: 'li_auto', name: '理想汽车' };
    vehicle.facts.model = { id: 'l7', name: '理想L7' };
    vehicle.facts.trim = { id: 'l7_max', name: '2024款 Max 版' };
    expect(publicVehicleTitle(vehicle, 'zh')).toEqual({ text: '理想L7 2024款 Max 版', lang: 'zh' });
    expect(publicVehicleTitle(vehicle, 'en')).toEqual({ text: 'LI AUTO L7 Max 2024', lang: 'en' });
  });

  it('keeps a supplied Chinese title and only uses known facts for missing titles', () => {
    const supplied = makeImportedPublicVehicleFixture('zh');
    expect(publicVehicleTitle(supplied, 'zh')).toEqual({ text: '示例 R1 混动', lang: 'zh' });
    const disputed = makeImportedPublicVehicleFixture('zh', 'conflict');
    expect(publicVehicleTitle(disputed, 'zh')).toEqual({ text: '丰田', lang: 'zh' });
    disputed.facts.make = null;
    expect(publicVehicleTitle(disputed, 'zh')).toEqual({ text: '车辆信息', lang: 'zh' });
    const english = makeImportedPublicVehicleFixture('en', 'conflict');
    expect(publicVehicleTitle(english, 'en')).toEqual({ text: 'Toyota', lang: 'en' });
  });

  it('omits untranslated catalog fields when building a fallback title', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('zh', 'missing');
    vehicle.content.title = { ...vehicle.content.title, text: 'Source title', contentLocale: 'en' };
    vehicle.facts.trim = { id: 'old_trim', name: '待翻译' };
    expect(publicVehicleTitle(vehicle, 'zh')).toEqual({ text: '丰田 2024款', lang: 'zh' });

    const imported = makeImportedPublicVehicleFixture('zh');
    imported.content.title = { ...imported.content.title, text: 'R1 Hybrid', contentLocale: 'en' };
    imported.display!.model = { ...imported.display!.trim };
    expect(publicVehicleTitle(imported, 'zh')).toEqual({ text: '丰田 2024款', lang: 'zh' });
  });

  it('drops private source labels from visible titles even when the locale matches', () => {
    const vehicle = makeImportedPublicVehicleFixture('zh');
    vehicle.content.title = { ...vehicle.content.title, text: '懂车帝车源' };
    expect(publicVehicleTitle(vehicle, 'zh').text).not.toContain('懂车帝');
  });

  it('omits an English-only trim on a Russian fallback title', () => {
    const vehicle = makeImportedPublicVehicleFixture('ru');
    vehicle.content.title = { ...vehicle.content.title, text: 'Toyota Example Edition', contentLocale: 'en' };
    vehicle.facts.trim = { id: 'edition', name: 'Example Edition' };
    vehicle.display!.trim = { ...vehicle.display!.trim, status: 'ready', text: 'Example Edition', contentLocale: 'en', provenance: 'supplier' };
    expect(publicVehicleTitle(vehicle, 'ru')).toEqual({ text: 'Toyota 2024', lang: 'ru' });
  });

  it.each(['en', 'ru'] as const)('builds a %s title without relabeling the Chinese original', locale => {
    const imported = makeImportedPublicVehicleFixture(locale);
    imported.content.title = { ...imported.content.title, text: '原始车名 0 kW', contentLocale: 'zh' };
    expect(publicVehicleTitle(imported, locale)).toEqual({ text: 'Toyota 2024', lang: locale });
  });
});
