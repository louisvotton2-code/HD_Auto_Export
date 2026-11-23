import { describe, expect, it } from 'vitest';
import { calculateImportEstimate, type CalculationInput } from '../index';
import { createDefaultInput } from '../application/defaults';

const date = '2026-11-22';
const quote = (country: 'TJ' | 'TM', changes: Partial<CalculationInput> = {}) => calculateImportEstimate({
  ...createDefaultInput(country, date), price: '20000', displacementCc: '1998', manufactureDate: '2023-01',
  transactionRate: country === 'TJ' ? '10' : '3.5', euroRate: '11', ...changes,
});

describe('Central Asian passenger-vehicle policies', () => {
  it('Tajikistan estimates standard ICE only from supplied rates and includes the statutory payments in VAT', () => {
    expect(quote('TJ', { tjDutyPercent: '', tjExcisePercent: '', tjExciseMinimum: '' })).toMatchObject({ status: 'incomplete', total: null, missingFields: [
      'tjDutyPercent', 'tjExcisePercent', 'tjExciseMinimum',
    ] });
    const priced = quote('TJ');
    expect(priced).toMatchObject({ status: 'reference', currency: 'TJS', total: '96322.48' });
    expect(Object.fromEntries(priced.lines.map(({ id, amount }) => [id, amount]))).toEqual({
      duty: '20000.00', excise: '28000.00', customsFee: '700.00', recycling: '11232.00', vat: '36390.48',
    });
    expect(quote('TJ', { freight: '1000', insurance: '300' }).total).toBe(priced.total);
    expect(quote('TJ', { price: '1000' }).lines.find(({ id }) => id === 'excise')?.amount).toBe('4395.60');
    expect(quote('TJ', { powertrain: 'diesel', price: '1000', tjExciseMinimum: '0.15' })
      .reason).toBe('manual_pricing');
    expect(quote('TJ', { tjDutyPercent: '101' })).toMatchObject({ status: 'invalid', total: null });
    expect(quote('TJ', { manufactureDate: '2012-12' })).toMatchObject({ reason: 'tj_age_limit', total: null });
  });

  it('Tajikistan prices the documented young electric relief and stops at the uncertain anniversary', () => {
    expect(quote('TJ', { powertrain: 'bev', manufactureDate: '2026-01', euroRate: '' })).toMatchObject({
      status: 'reference', total: '11932.00',
    });
    expect(quote('TJ', { powertrain: 'bev', manufactureDate: '2025-11' })).toMatchObject({
      status: 'needs_review', reason: 'tj_electric_age_review', total: null,
    });
  });

  it('Turkmenistan uses personal value, the completed-year duty band and official border charges', () => {
    expect(quote('TM', { freight: '1000', insurance: '100' })).toMatchObject({
      status: 'reference', currency: 'TMT', total: '30237.90',
    });
    expect(quote('TM', { powertrain: 'phev' }).total).toBe('16237.90');
    expect(quote('TM', { powertrain: 'bev' }).total).toBe('140.00');
    expect(quote('TM', { price: '1000' }).lines.find(({ id }) => id === 'duty')?.amount).toBe('6993.00');
    expect(quote('TM', { manufactureDate: '2022-01' }).lines.find(({ id }) => id === 'duty')?.amount).toBe('35000.00');
    expect(quote('TM', { currency: 'CNY', transactionRate: '0.5', price: '140000', usdRate: '3.5' }).total).toBe('30237.90');
  });

  it.each([
    [{ manufactureDate: '2021-12' }, 'tm_age_limit'],
    [{ steering: 'right' }, 'tm_steering_limit'],
    [{ displacementCc: '3501' }, 'tm_displacement_review'],
    [{ powertrain: 'erev' }, 'powertrain_rules_pending'],
  ] as const)('does not quote a Turkmenistan restriction or unverified classification (%o)', (changes, reason) => {
    expect(quote('TM', changes)).toMatchObject({ status: 'needs_review', total: null, reason });
  });
});
