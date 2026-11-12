import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { makeImportedPublicVehicleFixture, makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { explicitHistoryEntries, vehicleHistory } from './vehicle-history-data';
import { VehicleHistory } from './ui/vehicle-history';
import { VehicleInspectionReport } from './ui/vehicle-inspection-report';

const entry = (name: string, value: string, lang = 'en') => ({ name: { text: name, contentLocale: lang }, value: { text: value, contentLocale: lang } });

describe('published vehicle history', () => {
  it('keeps explicit zero and false, and never derives owner count from transfers', () => {
    const history = explicitHistoryEntries([entry('Ownership transfers', '0'), entry('accidentCount', '0'), entry('isStolen', 'false'), entry('waterDamage', 'true')], 'zh');
    expect(history.map(({ kind, value }) => [kind, value])).toEqual([['accidents', '0'], ['transfers', '0'], ['theft', '无'], ['waterDamage', '有']]);
    expect(history.some(({ kind }) => kind === 'owners')).toBe(false);
  });

  it.each(['zh', 'en', 'ru'] as const)('shows only supplied records in %s', (locale) => {
    const history = explicitHistoryEntries([entry('Flood history', 'No recorded flooding'), entry('车牌变更次数', '2', 'zh'), entry('Fire damage', 'false')], locale);
    expect(history.map(({ kind }) => kind)).toEqual(['plateChanges', 'flood', 'fire']);
    expect(history[1]).toMatchObject({ value: 'No recorded flooding', lang: 'en' });
    expect(history[2]?.value).toBe(({ zh: '无', en: 'No', ru: 'Нет' })[locale]);
  });

  it('does not convert inspection coverage or defect counts into historical accidents/floods', () => {
    expect(explicitHistoryEntries([entry('Accident items', '0 faults / 24 checked'), entry('Flood items', '0 faults / 5 checked'), entry('Fire items', '1 faults / 3 checked'), entry('accidents', '0 faults / 24 checked'), entry('accidents', '0 / 24')], 'en')).toEqual([]);
  });

  it('omits unknown, invalid and conflicting values without creating a reassuring zero', () => {
    expect(explicitHistoryEntries([entry('事故次数', 'unknown'), entry('theftCount', '-1'), entry('floodCount', '1.5'), entry('Ownership transfers', '2'), entry('过户次数', '1')], 'zh')).toEqual([]);
    expect(explicitHistoryEntries([entry('ownership transfers', '2'), entry('过户次数', '02')], 'en')).toHaveLength(1);
  });

  it('keeps actual history statements that mention a registry check', () => {
    const history = explicitHistoryEntries([entry('Theft history', 'No theft reported; checked against registry'), entry('Flood history', 'Проверено: затоплений не было', 'ru')], 'zh');
    expect(history.map(({ value }) => value)).toEqual(['No theft reported; checked against registry', 'Проверено: затоплений не было']);
    expect(history[1]?.lang).toBe('ru');
  });

  it('hides the entire history section when only manufacturing/registration facts exist', () => {
    const vehicle = makePublicVehicleFixture();
    expect(vehicleHistory(vehicle, 'zh')).toEqual([]);
    expect(renderToStaticMarkup(createElement(VehicleHistory, { vehicle, locale: 'zh' }))).toBe('');
  });

  it('reads explicit facts from both published specifications and inspection entries', () => {
    const vehicle = makeImportedPublicVehicleFixture('en', 'supplier', true);
    vehicle.external!.detail!.specifications = [entry('Ownership transfers', '2')];
    vehicle.external!.detail!.inspection!.entries = [entry('theft', 'false')];
    const html = renderToStaticMarkup(createElement(VehicleHistory, { vehicle, locale: 'en' }));
    expect(html).toContain('data-history-kind="transfers"');
    expect(html).toContain('data-history-kind="theft"');
    expect(html).not.toContain('Manufactured');
  });
});

describe('inspection data versus an accessible report document', () => {
  it('preserves inspection facts without exposing an unverified external document link', () => {
    const html = renderToStaticMarkup(createElement(VehicleInspectionReport, { id: 'report', locale: 'en', inspection: { reportUrl: 'https://reports.example.invalid/report', entries: [entry('Result', 'Recorded inspection')] } }));
    expect(html).toContain('Recorded inspection');
    expect(html).not.toContain('https://reports.example.invalid');
    expect(html).not.toContain('target="_blank"');
  });
  it('does not render an empty report card just because a raw URL is supplied', () => {
    expect(renderToStaticMarkup(createElement(VehicleInspectionReport, { id: 'report', locale: 'zh', inspection: { reportUrl: 'https://reports.example.invalid/report', entries: [] } }))).toBe('');
  });
});
