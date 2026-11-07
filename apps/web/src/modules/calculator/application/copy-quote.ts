import type { CountryRecord } from '../config/countries';
import type { CalculationInput, CalculationResult } from '../core/types';
import type { ExchangeRateSnapshot } from '../infrastructure/exchange-rates';

export type CopyQuoteText =
  { text: string } | { namespace: 'Calculator' | 'CopyQuote'; key: string };

export interface CopyQuoteFact {
  label: Exclude<CopyQuoteText, { text: string }>;
  value: CopyQuoteText;
}

/**
 * Selects the effective, reproducible input facts for a copied reference estimate.
 * It neither computes taxes nor reads browser state. Inactive fields carried in a
 * cross-country draft are omitted so they cannot be mistaken for calculation facts.
 */
export function getCopyQuoteFacts(
  input: CalculationInput,
  result: CalculationResult,
  country: CountryRecord,
  snapshot: ExchangeRateSnapshot,
  manualRates: boolean,
): CopyQuoteFact[] {
  const facts: CopyQuoteFact[] = [];
  const literal = (
    label: string,
    value: string,
    namespace: 'Calculator' | 'CopyQuote' = 'Calculator',
  ) => facts.push({ label: { namespace, key: label }, value: { text: value.trim() } });
  const translated = (
    label: string,
    value: string,
    labelNamespace: 'Calculator' | 'CopyQuote' = 'Calculator',
    valueNamespace: 'Calculator' | 'CopyQuote' = 'Calculator',
  ) =>
    facts.push({
      label: { namespace: labelNamespace, key: label },
      value: { namespace: valueNamespace, key: value },
    });
  const electric = input.powertrain === 'bev';
  if (country.needsPrice) literal('price', `${input.price} ${input.currency}`);
  translated('powertrain', input.powertrain);
  if (!electric && !(country.code === 'KG' && input.powertrain === 'erev'))
    literal('displacement', input.displacementCc);
  if (country.needsPower) literal(electric ? 'electricPower' : 'power', input.powerHp);
  if (country.needsManufactureDate) literal('manufactureDate', input.manufactureDate);
  literal('customsDate', input.customsDate);
  if (country.code === 'UZ')
    translated('condition', input.condition === 'new' ? 'newVehicle' : 'usedVehicle');
  if (country.needsSteering) translated('steering', input.steering);
  if (country.needsFreight) {
    for (const field of ['freight', 'insurance'] as const) {
      if (input[field].trim()) literal(field, `${input[field]} ${input.currency}`);
      else translated(field, 'notProvided', 'Calculator', 'CopyQuote');
    }
  }
  if (country.needsPrice)
    literal('transactionRate', `${input.transactionRate} ${country.currency}/${input.currency}`);
  if (country.needsEuroRate && !(country.code === 'RU' && electric))
    literal('euroRate', `${input.euroRate} ${country.currency}/EUR`);
  if (country.code === 'UZ' && input.currency !== 'USD')
    literal('usdRate', `${input.usdRate ?? ''} UZS/USD`);
  if (!country.needsPrice) {
    // GE's market USD rate affects display only, not the GEL taxes.
    literal('usdRate', `${snapshot.rates[country.currency]} ${country.currency}/USD`);
  } else if (input.currency === 'CNY' && country.code !== 'UZ') {
    // Preserve the market leg used alongside an explicitly overridden local/CNY rate.
    literal('marketCrossRate', `${snapshot.rates.CNY} CNY/USD`, 'CopyQuote');
  }
  translated(
    'fxStatus',
    manualRates && country.needsPrice
      ? 'manualFx'
      : snapshot.status === 'live'
        ? 'automaticFx'
        : 'fallbackFx',
    'CopyQuote',
    'CopyQuote',
  );
  literal('fxSnapshotDate', snapshot.asOf, 'CopyQuote');
  if (result.ruleVersion) literal('ruleVersion', result.ruleVersion, 'CopyQuote');
  return facts;
}
