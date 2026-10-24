import { describe, expect, it } from 'vitest';
import { calculateImportEstimate } from '../core/calculate';
import type { CountryCode } from '../core/types';
import {
  createReferenceSnapshot,
  getReferenceRate,
  REFERENCE_FX_SNAPSHOT,
} from '../infrastructure/exchange-rates';
import { convertTransactionPrice, createDefaultInput } from './defaults';

describe('ready-to-edit calculator defaults', () => {
  it('supplies a useful RU preview while leaving unquoted freight and insurance unknown', () => {
    const input = createDefaultInput('RU', '2026-10-23');
    expect(input).toMatchObject({
      country: 'RU',
      importerType: 'individual',
      powertrain: 'petrol',
      currency: 'CNY',
      price: '180000',
      displacementCc: '1998',
      powerHp: '150',
      manufactureDate: '2021-01',
      customsDate: '2026-10-23',
      freight: '',
      insurance: '',
    });
    expect(input.transactionRate).toBe(getReferenceRate('RU', 'CNY').transactionRate);
    expect(calculateImportEstimate(input)).toMatchObject({ status: 'reference', total: '926952' });
  });

  it('does not make GE depend on the default price or exchange rate', () => {
    const input = createDefaultInput('GE', '2026-10-23');
    expect(
      calculateImportEstimate({ ...input, price: '', transactionRate: '', euroRate: '' }),
    ).toMatchObject({ status: 'reference', total: '3605' });
  });

  it.each(['KZ', 'UZ', 'AM', 'KG', 'AL'] as CountryCode[])(
    'provides the implemented reference for %s without inventing a freight quote',
    (country) => {
      const input = createDefaultInput(country, '2026-10-23');
      expect(input.freight).toBe('');
      const result = calculateImportEstimate(input);
      expect(result.status).toBe('reference');
      expect(result.total).not.toBeNull();
      if (['UZ', 'AM', 'KG', 'AL'].includes(country))
        expect(result.assumptions).toContain('transport_not_in_tax_base');
    },
  );

  it('uses a caller-supplied snapshot without changing the date or vehicle facts', () => {
    const rates = createReferenceSnapshot();
    rates.rates.CNY = '7';
    rates.rates.RUB = '84';
    expect(createDefaultInput('RU', '2027-01-01', rates)).toMatchObject({
      customsDate: '2027-01-01',
      price: '180000',
      transactionRate: '12',
    });
    expect(calculateImportEstimate(createDefaultInput('RU', '2027-01-01', rates)).status).toBe(
      'needs_review',
    );
  });
});

describe('transaction currency changes', () => {
  it('converts CNY to USD and back with decimal rounding to two places', () => {
    expect(convertTransactionPrice('180000', 'CNY', 'USD', REFERENCE_FX_SNAPSHOT)).toBe('26086.96');
    expect(convertTransactionPrice('25000', 'USD', 'CNY', REFERENCE_FX_SNAPSHOT)).toBe('172500.00');
  });

  it.each(['', '-', '-10', '25,000', '12x', '1e3'])(
    'keeps unfinished or invalid input %s intact for validation',
    (amount) => {
      expect(convertTransactionPrice(amount, 'CNY', 'USD', REFERENCE_FX_SNAPSHOT)).toBe(amount);
    },
  );
});
