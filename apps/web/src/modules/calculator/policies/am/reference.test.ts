import { describe, expect, it } from 'vitest';
import type { CalculationInput } from '../../core/types';
import { calculateAmReference } from './reference';

const INPUT: CalculationInput = {
  country: 'AM', importerType: 'individual', powertrain: 'petrol', price: '10000',
  currency: 'USD', displacementCc: '1998', powerHp: '', manufactureDate: '2022-11',
  customsDate: '2026-11-23', freight: '', insurance: '', steering: 'left', transactionRate: '400', euroRate: '420',
};

function quote(changes: Partial<CalculationInput> = {}) {
  const input = { ...INPUT, ...changes };
  const [year, month] = input.manufactureDate.split('-').map(Number);
  const [customsYear, customsMonth] = input.customsDate.split('-').map(Number);
  const ageYears = customsYear - year;
  const { lines } = calculateAmReference({ input, ageYears, ageMonths: ageYears * 12 + customsMonth - month });
  return Object.fromEntries(lines.map(({ id, amount }) => [id, amount]));
}

describe('Armenian private imports', () => {
  it('applies unified duty and environmental tax on the stated assessed base', () => {
    expect(quote()).toEqual({ duty: '2265732', excise: '0', vat: '0', environmental: '160000' });
    expect(quote({ freight: '1000', insurance: '30' })).toEqual(quote());
  });

  it.each([[0, 80000], [3, 80000], [4, 160000], [5, 160000], [6, 240000], [10, 240000],
    [11, 480000], [15, 480000], [16, 960000]])('applies the environmental band at production-year age %i', (years, amount) => {
    expect(quote({ manufactureDate: `${2026 - years}-01` }).environmental).toBe(String(amount));
  });

  it.each([
    ['2021-01', '2026-01-31', '0'], ['2021-01', '2026-02-01', '920000'],
    ['2023-12', '2026-11-23', '920000'], ['2024-01', '2026-11-23', '0'],
  ])('separates EV quota and VAT conditions for %s cleared %s', (manufactureDate, customsDate, vat) => {
    expect(quote({ powertrain: 'bev', displacementCc: '', manufactureDate, customsDate })).toMatchObject({ duty: '600000', vat });
  });
});
