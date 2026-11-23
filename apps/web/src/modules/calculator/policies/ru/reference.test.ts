import { describe, expect, it } from 'vitest';
import { Amount } from '../../core/decimal';
import { calculateImportEstimate } from '../../core/calculate';
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
  customsDate: '2026-01-16',
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
  // The official high-power schedule supersedes the public-reference catch-all.
  const compatibleCases = fixtures.cases.filter(({ fuel, cc, hp }) =>
    !(fuel === 'ice' && cc > 2000 && cc <= 3000 && hp > 430));
  it.each(compatibleCases)(
    '$fuel / $cc cc / $hp hp: preserves both age columns of the published matrix',
    ({ fuel, cc, hp, fresh, aged }) => {
      const input: Partial<CalculationInput> = {
        powertrain: fuel === 'electric' ? 'bev' : 'petrol',
        displacementCc: cc ? String(cc) : '',
        powerHp: String(hp),
      };
      const comparableLines = (months: number) => calculate(input, months).lines
        .filter(({ id }) => ['duty', 'customsFee', 'recycling'].includes(id)).map(({ amount }) => amount);
      expect(comparableLines(24)).toEqual(fresh);
      expect(comparableLines(36)).toEqual(aged);
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
    expect(RU_REFERENCE_VERSION).toBe('ru-personal-2026.11.23-v2');
  });

  it('includes aggregate EV taxes and distinguishes the substantiated personal concession', () => {
    const changes = { powertrain: 'bev', price: '20000', transactionRate: '100', powerHp: '70', displacementCc: '', euroRate: '' } as const;
    const result = calculate({ ...changes, ruPersonalRelief: 'eligible' }, 22);
    expect(result.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['duty', '300000'], ['excise', '0'], ['vat', '506000'], ['customsFee', '13541'], ['recycling', '3400'],
    ]);
    expect(recycling({ ...changes, ruPersonalRelief: 'ineligible' }, 22)).toBe('800800');
    expect(calculate(changes, 22).assumptions).toContain('ru_personal_relief_assumed');
    expect(recycling({ powerHp: '150', displacementCc: '1998', ruPersonalRelief: 'ineligible' }, 22)).toBe('800800');
  });

  it.each([[90, 0], [91, 64], [150, 64], [151, 613], [200, 613], [201, 1004], [300, 1004], [301, 1711], [401, 1771], [501, 1829]])(
    'uses the 2026 excise band for %i certified hp', (hp, rate) => {
      const result = calculate({ powertrain: 'bev', powerHp: String(hp), displacementCc: '' }, 22);
      expect(result.lines.find(({id}) => id === 'excise')?.amount).toBe(String(hp * rate));
    },
  );

  it('uses the 15th for a known month and an evidenced day when present', () => {
    const input = { manufactureDate: '2021-11', euroRate: '100' };
    expect(calculate({ ...input, customsDate: '2026-11-15' }).lines[0].amount).toBe('539460');
    expect(calculate({ ...input, customsDate: '2026-11-16' }).lines[0].amount).toBe('959040');
    expect(calculate({ ...input, manufactureDay: '2021-11-20', customsDate: '2026-11-20' }).lines[0].amount).toBe('539460');
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

  it.each(['hev', 'phev'] as const)('applies the parallel hybrid schedule with an explicit rated power basis for %s', (powertrain) => {
    const hybrid = calculate({ powertrain, powerHp: '161' });
    expect(hybrid.lines).toEqual(calculate({ powerHp: '161' }).lines);
    expect(hybrid.assumptions).toContain('ru_hybrid_certified_power');
  });
  it('requires classification for a range extender', () => {
    expect(calculate({ powertrain: 'erev' }).reason).toBe('powertrain_rules_pending');
  });

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

describe('official 2026 recycling coefficients for >2,000–3,000 cc', () => {
  const input: CalculationInput = {
    ...SAMPLE, displacementCc: '2500', powerHp: '510', transactionRate: '80', euroRate: '100',
    customsDate: '2026-11-23', manufactureDate: '2025-01',
  };

  it.each([
    ['430', '3067200', '4209600'],
    ['430.01', '3189600', '4327200'],
    ['460', '3189600', '4327200'],
    ['460.01', '3316800', '4447200'],
    ['500', '3316800', '4447200'],
    ['500.01', '3448800', '4572000'],
    ['501', '3448800', '4572000'],
    ['510', '3448800', '4572000'],
  ])('selects the official power band and both age columns at %s hp', (powerHp, fresh, aged) => {
    for (const [manufactureDate, amount] of [['2025-01', fresh], ['2022-01', aged]]) {
      const result = calculateImportEstimate({ ...input, powerHp, manufactureDate });
      expect(result.status).toBe('reference');
      expect(result.lines.find(line => line.id === 'recycling')?.amount).toBe(amount);
    }
  });

  it('reproduces the 510 hp example and its full amount', () => {
    const result = calculateImportEstimate(input);
    expect(result.total).toBe('4837341');
    expect(result.lines.find(line => line.id === 'recycling')).toMatchObject({
      amount: '3448800',
      method: { key: 'RU.recyclingOfficialHighPower', params: { kw: '375.10', coefficient: '172.44' } },
    });
    expect(result.assumptions).toContain('ru_recycling_payment_date_assumed');
  });

  it('uses the exact anniversary when known and withholds the total for a disputed month', () => {
    const near = { ...input, manufactureDate: '2023-11' };
    expect(calculateImportEstimate(near)).toMatchObject({
      status: 'needs_review', reason: 'ru_recycling_age_review', total: null,
    });
    expect(calculateImportEstimate({ ...near, customsDate: '2026-11-01' }).lines)
      .toContainEqual(expect.objectContaining({ id: 'recycling', amount: '3448800' }));
    expect(calculateImportEstimate({ ...near, manufactureDay: '2023-11-23' }).lines)
      .toContainEqual(expect.objectContaining({ id: 'recycling', amount: '3448800' }));
    expect(calculateImportEstimate({ ...near, manufactureDay: '2023-11-22' }).lines)
      .toContainEqual(expect.objectContaining({ id: 'recycling', amount: '4572000' }));
  });

  it('keeps the scope at 2026 individual imports', () => {
    expect(calculateImportEstimate({ ...input, importerType: 'company' })).toMatchObject({
      status: 'needs_review', reason: 'company_rules_pending', total: null,
    });
    expect(calculateImportEstimate({ ...input, customsDate: '2025-12-01' })).toMatchObject({
      status: 'needs_review', reason: 'rule_date_outside_reference', total: null,
    });
    expect(calculateImportEstimate({ ...input, customsDate: '2027-01-01' })).toMatchObject({
      status: 'needs_review', reason: 'rule_date_outside_reference', total: null,
    });
  });
});
