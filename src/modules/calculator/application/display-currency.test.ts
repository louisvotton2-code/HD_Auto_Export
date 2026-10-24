import { describe, expect, it } from 'vitest';
import type { CountryCode } from '../core/types';
import { createReferenceSnapshot } from '../infrastructure/exchange-rates';
import { createDefaultInput } from './defaults';
import { convertImportAmountToUsd } from './display-currency';

describe('secondary USD fee display', () => {
  it('uses the entered UZS/USD tariff rate for CNY-based Uzbek fees', () => {
    const snapshot = createReferenceSnapshot();
    const input = {
      ...createDefaultInput('UZ', '2026-10-23'),
      transactionRate: '1700',
      usdRate: '12500',
    };
    expect(convertImportAmountToUsd('25000', input, snapshot)).toBe('2.00');
    expect(
      convertImportAmountToUsd(
        '25000',
        { ...input, currency: 'USD', transactionRate: '10000' },
        snapshot,
      ),
    ).toBe('2.50');
  });
  it('uses a manually entered RUB/USD rate instead of replacing it with the snapshot rate', () => {
    const snapshot = createReferenceSnapshot();
    snapshot.rates.RUB = '100';
    const input = {
      ...createDefaultInput('RU', '2026-10-23'),
      currency: 'USD' as const,
      transactionRate: '80',
    };
    expect(convertImportAmountToUsd('800', input, snapshot)).toBe('10.00');
  });

  it('crosses a local-per-CNY input rate with the snapshot CNY-per-USD rate', () => {
    const snapshot = createReferenceSnapshot();
    snapshot.rates.CNY = '7';
    const input = { ...createDefaultInput('RU', '2026-10-23'), transactionRate: '12' };
    expect(convertImportAmountToUsd('840', input, snapshot)).toBe('10.00');
    expect(convertImportAmountToUsd('1', input, snapshot)).toBe('0.01');
  });

  it('ignores hidden invalid transaction values for GE and uses GEL/USD directly', () => {
    const snapshot = createReferenceSnapshot();
    const input = {
      ...createDefaultInput('GE', '2026-10-23'),
      transactionRate: 'bad',
      euroRate: '0',
    };
    expect(convertImportAmountToUsd('3605', input, snapshot)).toBe('1335.19');
    snapshot.rates.GEL = '4';
    expect(convertImportAmountToUsd('100', input, snapshot)).toBe('25.00');
  });

  it.each(['RU', 'KZ', 'UZ', 'AM', 'KG', 'AL'] as CountryCode[])(
    'handles the configured price-based %s destination',
    (country) => {
      const snapshot = createReferenceSnapshot();
      const input = {
        ...createDefaultInput(country, '2026-10-23'),
        currency: 'USD' as const,
        transactionRate: '25',
      };
      expect(convertImportAmountToUsd('250', input, snapshot)).toBe('10.00');
    },
  );

  it('keeps a real zero amount distinct from an unavailable conversion', () => {
    const snapshot = createReferenceSnapshot();
    const input = createDefaultInput('RU', '2026-10-23');
    expect(convertImportAmountToUsd('0', input, snapshot)).toBe('0.00');
    expect(convertImportAmountToUsd('0.00', input, snapshot)).toBe('0.00');
  });

  it('rounds decimal ties correctly without losing cents on large amounts', () => {
    const snapshot = createReferenceSnapshot();
    const input = {
      ...createDefaultInput('RU', '2026-10-23'),
      currency: 'USD' as const,
      transactionRate: '1',
    };
    expect(convertImportAmountToUsd('1.005', input, snapshot)).toBe('1.01');
    expect(convertImportAmountToUsd('100000000000000000.05', input, snapshot)).toBe(
      '100000000000000000.05',
    );
  });

  it.each(['', '-1', 'NaN', 'Infinity', '25,000', '1e3', '12x'])(
    'returns null for invalid local amount %s',
    (amount) => {
      expect(
        convertImportAmountToUsd(
          amount,
          createDefaultInput('RU', '2026-10-23'),
          createReferenceSnapshot(),
        ),
      ).toBeNull();
    },
  );

  it.each(['', '0', '-1', 'NaN', 'Infinity', '1,000'])(
    'does not manufacture a USD value from invalid transaction rate %s',
    (transactionRate) => {
      const snapshot = createReferenceSnapshot();
      const input = { ...createDefaultInput('RU', '2026-10-23'), transactionRate };
      expect(convertImportAmountToUsd('100', input, snapshot)).toBeNull();
    },
  );

  it('returns null when the applicable snapshot rate is unusable, without substituting zero', () => {
    const snapshot = createReferenceSnapshot();
    snapshot.rates.CNY = '0';
    expect(
      convertImportAmountToUsd('100', createDefaultInput('RU', '2026-10-23'), snapshot),
    ).toBeNull();
    snapshot.rates.GEL = '';
    expect(
      convertImportAmountToUsd('100', createDefaultInput('GE', '2026-10-23'), snapshot),
    ).toBeNull();
  });
});
