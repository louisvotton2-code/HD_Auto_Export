import { describe, expect, it } from 'vitest';
import zh from '../../../messages/zh.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import { calculateImportEstimate } from '../core/calculate';
import { countries } from '../config/countries';
import { createDefaultInput } from './defaults';
import { getCalculatorMessages } from './calculator-messages';

function flatten(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof entry === 'string'
        ? [[path, entry]]
        : Object.entries(flatten(entry as Record<string, unknown>, path));
    }),
  );
}
const placeholders = (value: string) =>
  [...value.matchAll(/\{(\w+)(?:\}|,)/g)].map((match) => match[1]).sort();

describe('calculation method and live translation contract', () => {
  it('merges all actual runtime namespaces with matching three-language keys and placeholders', () => {
    const dictionaries = [
      ['zh', zh],
      ['en', en],
      ['ru', ru],
    ] as const;
    const baseline = flatten({ ...zh, ...getCalculatorMessages('zh') });
    for (const [locale, base] of dictionaries) {
      const translated = flatten({ ...base, ...getCalculatorMessages(locale) });
      expect(Object.keys(translated).sort()).toEqual(Object.keys(baseline).sort());
      for (const key of Object.keys(baseline)) {
        expect(translated[key].trim(), key).not.toBe('');
        expect(placeholders(translated[key]), key).toEqual(placeholders(baseline[key]));
      }
    }
  });

  it('every emitted main and additional fee supplies a translatable method with all actual operands', () => {
    const messages = (['zh', 'en', 'ru'] as const).map((locale) =>
      flatten(getCalculatorMessages(locale).FeeMethods),
    );
    let explained = 0;
    for (const { code } of countries) {
      for (const powertrain of ['petrol', 'diesel', 'hev', 'phev', 'erev', 'bev'] as const) {
        for (const manufactureDate of [
          '2010-01',
          '2015-01',
          '2019-01',
          '2021-01',
          '2023-03',
          '2025-01',
          '2026-03',
        ]) {
          for (const importerType of code === 'KG'
            ? (['individual', 'company'] as const)
            : (['individual'] as const)) {
            const result = calculateImportEstimate({
              ...createDefaultInput(code, '2026-10-23'),
              powertrain,
              manufactureDate,
              importerType,
              condition: 'new',
              displacementCc: '3001',
              powerHp: '220',
              freight: '1000',
              insurance: '100',
            });
            expect(result.status).toBe('reference');
            for (const fee of [...result.lines, ...result.additionalCosts]) {
              expect(fee.method, `${code} ${fee.id}`).toBeDefined();
              for (const language of messages) {
                const template = language[fee.method!.key];
                expect(template, fee.method!.key).toBeTypeOf('string');
                for (const name of placeholders(template))
                  expect(fee.method!.params[name], `${fee.method!.key}.{${name}}`).toBeDefined();
              }
              explained++;
            }
          }
        }
      }
    }
    expect(explained).toBeGreaterThan(1000);
  });
});
