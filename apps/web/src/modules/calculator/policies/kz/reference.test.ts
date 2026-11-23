import { describe, expect, it } from 'vitest';
import type { CalculationInput, ReferencePolicyFacts } from '../../core/types';
import { calculateKzReference } from './reference';

const SAMPLE: CalculationInput = {
  country: 'KZ',
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
  transactionRate: '468.321957',
  euroRate: '541.1',
};
function result(changes: Partial<CalculationInput> = {}, ages: Partial<ReferencePolicyFacts> = {}) {
  return calculateKzReference({
    input: { ...SAMPLE, ...changes },
    ageMonths: 60,
    ageYears: 5,
    ...ages,
  });
}
function amount(
  id: string,
  changes: Partial<CalculationInput> = {},
  ages: Partial<ReferencePolicyFacts> = {},
) {
  return result(changes, ages).lines.find((line) => line.id === id)!.amount;
}

describe('KZ 2026 research reference', () => {
  it('applies the unified passenger charge to a four-year-old 1500cc car without duplicating VAT', () => {
    const quote = result({ price: '20000', transactionRate: '500', euroRate: '550', displacementCc: '1500',
      manufactureDate: '2022-10', customsDate: '2026-11-23' }, { ageMonths: 49, ageYears: 4 });
    expect(quote.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['customsFee', '25950'], ['duty', '1402500'], ['registration', '2162500'],
      ['plates', '17516'], ['recycling', '756875'],
    ]);
    expect(quote.additionalCosts).toMatchObject([{ id: 'relatedCosts', amount: '400000' }]);
    expect(quote.assumptions).toEqual(['kz_personal_declaration']);
  });

  it('applies the general-goods 15% to a BEV, using supplied freight and insurance only once', () => {
    const changes = { powertrain: 'bev' as const, displacementCc: '', price: '20000', transactionRate: '500' };
    expect(amount('duty', changes)).toBe('1500000');
    expect(amount('vat', changes)).toBe('1844152');
    expect(amount('duty', { ...changes, freight: '200', insurance: '20' })).toBe('1516500');
    expect(result(changes).assumptions).toEqual(['kz_standard_goods']);
    expect(result({ ...changes, importerType: 'company' }).lines).toEqual(result(changes).lines);
  });

  it('charges luxury excise at the inclusive threshold, using the import acquisition value', () => {
    const changes = { powertrain: 'bev' as const, transactionRate: '1' };
    expect(amount('luxuryExcise', { ...changes, price: '77849999' })).toBe('0');
    expect(amount('luxuryExcise', { ...changes, price: '77850000' })).toBe('7785000');
    expect(amount('luxuryExcise', { ...changes, price: '77849999', freight: '1' })).toBe('7785000');
  });

  it('requires a tariff code or proof for an unresolved declaration without granting relief', () => {
    expect(result({ kzDeclaration: 'wto' }).reason).toBe('kz_declaration_review');
    expect(result({ powertrain: 'bev', kzDeclaration: 'personal' }).reason).toBe('kz_declaration_review');
    expect(result({ importerType: 'company', kzDeclaration: 'personal' }).reason).toBe('kz_declaration_review');
    expect(result({ importerType: 'company' }).reason).toBe('kz_declaration_review');
    expect(amount('excise', { importerType: 'company', displacementCc: '3000' })).toBe('0');
    expect(amount('excise', { importerType: 'company', displacementCc: '3001' })).toBe('300100');
    expect(result({ powertrain: 'erev' }).reason).toBe('kz_declaration_review');
    expect(amount('recycling', { powertrain: 'erev', displacementCc: '1500' })).toBe('756875');
  });

  it.each([
    ['petrol', 1, '1081'],
    ['petrol', 2, '216250'],
    ['petrol', 3, '2162500'],
    ['bev', 1, '1081'],
    ['bev', 2, '108125'],
    ['bev', 3, '1081250'],
  ] as const)(
    'uses the %s registration schedule at calendar age %s',
    (powertrain, ageYears, expected) => {
      expect(amount('registration', { powertrain }, { ageYears })).toBe(expected);
    },
  );

  it.each([
    ['1000', '324375'],
    ['1001', '756875'],
    ['2000', '756875'],
    ['2001', '1081250'],
    ['3000', '1081250'],
    ['3001', '2486875'],
  ])('applies the recycling band at %s cc', (displacementCc, expected) => {
    expect(amount('recycling', { displacementCc })).toBe(expected);
  });

  it('ignores freight principal and is stable for equivalent currency facts without mutation', () => {
    const input = Object.freeze({ ...SAMPLE, freight: '1000', insurance: '50' });
    expect(calculateKzReference({ input, ageMonths: 60, ageYears: 5 })).toEqual(result());
    expect(
      result({ currency: 'CNY', price: '125000', transactionRate: '93.6643914' }).lines,
    ).toEqual(result().lines);
    expect(input.freight).toBe('1000');
  });
});
