import { describe, expect, it } from 'vitest';
import { Amount } from '../../core/decimal';
import type { CalculationInput, ReferencePolicyFacts } from '../../core/types';
import fixtures from './reference-fixtures.json';
import { calculateRuReference, RU_REFERENCE_VERSION } from './reference';

const SAMPLE: CalculationInput = {
  country: 'RU',
  importerType: 'individual',
  powertrain: 'petrol',
  price: '25000',
  currency: 'USD',
  displacementCc: '1998',
  powerHp: '150',
  manufactureDate: '2021-01',
  customsDate: '2026-01-01',
  freight: '',
  insurance: '',
  steering: 'left',
  transactionRate: '81.969182',
  euroRate: '94.7',
};

function calculate(changes: Partial<CalculationInput> = {}, ageMonths = 60) {
  return calculateRuReference({
    input: { ...SAMPLE, ...changes },
    ageMonths,
    ageYears: Math.floor(ageMonths / 12),
  });
}

function recycling(changes: Partial<CalculationInput>, ageMonths = 60) {
  return calculate(changes, ageMonths).lines.find((line) => line.id === 'recycling')?.amount;
}

describe('RU public reference compatibility fixtures', () => {
  // Frozen, literal expected values were obtained from the public reference
  // calculator in an isolated research VM, never from calculateRuReference.
  it.each(fixtures.cases)(
    '$fuel / $cc cc / $hp hp: preserves both age columns of the published matrix',
    ({ fuel, cc, hp, fresh, aged }) => {
      const input: Partial<CalculationInput> = {
        powertrain: fuel === 'electric' ? 'bev' : 'petrol',
        displacementCc: cc ? String(cc) : '',
        powerHp: String(hp),
      };
      expect(calculate(input, 24).lines.map((line) => line.amount)).toEqual(fresh);
      expect(calculate(input, 36).lines.map((line) => line.amount)).toEqual(aged);
    },
  );

  it('preserves the historical low-power 926952 RUB sample', () => {
    const result = calculate();
    expect(result.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['duty', '908211'],
      ['customsFee', '13541'],
      ['recycling', '5200'],
    ]);
    expect(result.lines.reduce((sum, line) => sum.add(line.amount), new Amount(0)).toString()).toBe(
      '926952',
    );
    expect(result.additionalCosts).toEqual([]);
    expect(RU_REFERENCE_VERSION).toBe('ru-personal-reference-2026.10.23-v2');
  });

  it('calculates BEV with no displacement or EUR exchange rate', () => {
    const result = calculate({ powertrain: 'bev', displacementCc: '', euroRate: '' });
    expect(result.lines.map((line) => line.amount)).toEqual(['307384', '13541', '2227200']);
    expect(result.lines.reduce((sum, line) => sum.add(line.amount), new Amount(0)).toString()).toBe(
      '2548125',
    );
  });

  it('does not grant the combustion personal-use low coefficient to BEV', () => {
    expect(recycling({ powertrain: 'bev', powerHp: '100', displacementCc: '' }, 35)).toBe('991200');
    expect(recycling({ powertrain: 'bev', powerHp: '100', displacementCc: '' }, 36)).toBe(
      '1641600',
    );
  });

  it('changes both recycling age columns exactly at 36 months', () => {
    expect(recycling({}, 35)).toBe('3400');
    expect(recycling({}, 36)).toBe('5200');
    expect(recycling({ powerHp: '161' }, 35)).toBe('900000');
    expect(recycling({ powerHp: '161' }, 36)).toBe('1492800');
  });

  it('changes the personal coefficient above 160 hp, including fractional power', () => {
    expect(recycling({ powerHp: '160' })).toBe('5200');
    expect(recycling({ powerHp: '160.01' })).toBe('1492800');
    expect(recycling({ powerHp: '161' })).toBe('1492800');
  });

  it('does not extend the personal coefficient above 3000 cc', () => {
    expect(recycling({ powerHp: '160', displacementCc: '3000' })).toBe('5200');
    expect(recycling({ powerHp: '160', displacementCc: '3001' })).toBe('3956200');
  });

  it.each([
    ['1000', '568800', '1001', '1492800'],
    ['2000', '1492800', '2001', '3456000'],
    ['3000', '3456000', '3001', '4000800'],
    ['3500', '4000800', '3501', '4389600'],
  ])('changes matrix immediately above %s cc', (lowerCc, lowerFee, upperCc, upperFee) => {
    expect(recycling({ powerHp: '161', displacementCc: lowerCc })).toBe(lowerFee);
    expect(recycling({ powerHp: '161', displacementCc: upperCc })).toBe(upperFee);
  });

  it('uses inclusive power boundaries with the next band immediately above', () => {
    expect(recycling({ powerHp: '190' })).toBe('1492800');
    expect(recycling({ powerHp: '190.01' })).toBe('1584000');
    expect(recycling({ powertrain: 'bev', powerHp: '100', displacementCc: '' })).toBe('1641600');
    expect(recycling({ powertrain: 'bev', powerHp: '100.01', displacementCc: '' })).toBe('1912800');
  });

  it('supports the over-3000 cc duty band at both age thresholds', () => {
    const input = { displacementCc: '3001', powerHp: '161' };
    expect(calculate(input, 35).lines[0].amount).toBe('1563071');
    expect(calculate(input, 36).lines[0].amount).toBe('1023101');
    expect(calculate(input, 59).lines[0].amount).toBe('1023101');
    expect(calculate(input, 60).lines[0].amount).toBe('1619910');
  });

  it.each(['hev', 'phev', 'erev'] as const)(
    'maps %s to the reference hybrid/combustion branch rather than assuming BEV exemption',
    (powertrain) => {
      expect(calculate({ powertrain, powerHp: '161' })).toEqual(calculate({ powerHp: '161' }));
    },
  );

  it('uses the explicit CNY transaction rate without changing destination amounts', () => {
    expect(calculate({ currency: 'CNY', price: '250000', transactionRate: '8.1969182' })).toEqual(
      calculate(),
    );
  });

  it('is deterministic and does not mutate facts', () => {
    const facts: ReferencePolicyFacts = Object.freeze({
      input: Object.freeze({ ...SAMPLE }),
      ageMonths: 60,
      ageYears: 5,
    });
    const before = JSON.stringify(facts);
    expect(calculateRuReference(facts)).toEqual(calculateRuReference(facts));
    expect(JSON.stringify(facts)).toBe(before);
  });
});
