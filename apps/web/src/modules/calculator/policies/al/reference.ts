import { Amount, roundedAmount } from '../../core/decimal';
import type { CalculationLine, ReferencePolicyFacts, ReferencePolicyResult } from '../../core/types';

export const AL_REFERENCE_VERSION = 'al-hs8703-2026.11.23-v3';
export const AL_REFERENCE_SOURCE = 'https://www.dogana.gov.al/english/c/179/customs-clearance-of-vehicles';

export function calculateAlReference({ input }: ReferencePolicyFacts): ReferencePolicyResult {
  // Ordinary transaction-value method. A rejected sale price requires Customs'
  // alternative valuation, which cannot be recovered from displacement alone.
  const customsValue = new Amount(input.price).add(input.freight || 0).add(input.insurance || 0).mul(input.transactionRate);
  const electric = input.powertrain === 'bev';
  const cc = new Amount(electric ? 0 : input.displacementCc);
  const zeroKm = input.mileageKm !== undefined && /^0+$/.test(input.mileageKm);
  const evExempt = electric && (input.vehicleRegistration ? input.vehicleRegistration === 'never_registered' : input.condition === 'new') && zeroKm;
  const vatKey = evExempt ? 'AL.vatNewElectric' : electric ? 'AL.vatElectric' : 'AL.vatDeclared';
  const vat = evExempt ? '0' : roundedAmount(customsValue.mul('0.20'));

  const lines: CalculationLine[] = [
    { id: 'duty', amount: '0', formula: '0', method: { key: 'AL.duty', params: {} } },
    { id: 'excise', amount: '0', formula: '0', method: { key: 'AL.excise', params: {} } },
    {
      id: 'vat', amount: vat, formula: evExempt ? '0' : `round(${customsValue} × 20%)`,
      method: { key: vatKey, params: { taxableBase: customsValue.toFixed() } },
    },
    { id: 'registration', amount: '8500', formula: '2000 + 2500 + 2 × 2000', method: { key: 'AL.registration', params: {} } },
  ];

  const additionalCosts: ReferencePolicyResult['additionalCosts'] = [];
  // The optional approved registration value is already in ALL. Transaction
  // value can signal a possible additional cost, but never establishes liability.
  const seats = input.seatCount ? Number(input.seatCount) : null;
  const registeredValue = input.alRegistrationValueAll ? new Amount(input.alRegistrationValueAll) : null;
  const highValue = (registeredValue ?? customsValue).gte(5_000_000);
  const largeEngine = cc.gte(3000);
  const proven = seats !== null && seats > 0 && seats <= 7 && (largeEngine || Boolean(registeredValue?.gte(5_000_000)));
  if ((seats === null || seats <= 7) && (largeEngine || highValue)) {
    const once: CalculationLine = {
      id: 'luxuryOnce', amount: '70000', formula: '70000',
      method: { key: proven ? 'AL.luxuryConfirmed' : 'AL.luxuryConditional', params: {} },
    };
    if (proven) lines.push(once);
    else additionalCosts.push({ ...once, kind: 'one_time_estimate' });
    additionalCosts.push({
      id: 'annualLuxury', amount: '21000', formula: '21000', kind: 'annual',
      method: { key: proven ? 'AL.annualLuxury' : 'AL.annualConditional', params: {} },
    });
  }
  return { lines, additionalCosts };
}
