import type { PublicVehicle, PublicVehicleInline } from '@hd/contracts/public';
import type { CalculationInput, CountryCode, Powertrain } from '../index';
import { Amount } from '../core/decimal';
import { deriveRates, type ExchangeRateSnapshot } from '../infrastructure/exchange-rates';
import { convertTransactionPrice, getTajikTariffDefaults } from './defaults';
import { vehicleManufactureDate } from './manufacture-estimate';

/** The UI can leave unknown enums empty; the core's required-field checks accept empty text. */
export type VehicleEstimateDraft = Omit<CalculationInput, 'powertrain' | 'condition' | 'steering'> & {
  powertrain: Powertrain | '';
  condition: 'new' | 'used' | '';
  steering: 'left' | 'right' | '';
};

const supportedPowertrains = new Set(['petrol', 'diesel', 'hev', 'phev', 'erev', 'bev']);

export type VehicleEstimateSource = PublicVehicle & Pick<PublicVehicleInline, 'technicalDetails'>;

function positivePower(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function vehicleEstimatePower(vehicle: VehicleEstimateSource) {
  const { powerHp, powertrain } = vehicle.facts;
  if (positivePower(powerHp)) return { hp: String(powerHp), source: 'reported' as const };
  if (!supportedPowertrains.has(powertrain) || powertrain === 'bev') return null;

  const { engineHp, engineKw } = vehicle.technicalDetails?.power ?? {};
  if (positivePower(engineHp)) return { hp: String(engineHp), source: 'engineHp' as const };
  if (!positivePower(engineKw)) return null;

  // Keep enough precision for fee brackets and stay within the full calculator draft format.
  const hp = new Amount(engineKw).times('1.35962').toDecimalPlaces(12);
  return hp.gt(0) ? { hp: hp.toFixed(), source: 'engineKw' as const } : null;
}

function vehicleTransactionPrice(vehicle: VehicleEstimateSource) {
  const projected = vehicle.displayPrice?.status === 'ready' ? vehicle.displayPrice.money : null;
  const money = projected?.currency === 'USD' ? projected : vehicle.price.money;
  const currency = money?.currency === 'CNY' ? 'CNY' : 'USD';
  const price = money && (money.currency === 'USD' || money.currency === 'CNY') ? money.amount : '';
  return { price, currency } as const;
}

function vehicleCondition(vehicle: VehicleEstimateSource, country: CountryCode): VehicleEstimateDraft['condition'] {
  const { registrationStatus, firstRegistration, mileageKm } = vehicle.facts;
  if (registrationStatus === 'registered' || firstRegistration) return 'used';
  if (registrationStatus !== 'never_registered' || country === 'AL' && mileageKm !== 0) return '';
  return 'new';
}

export function createVehicleEstimateDraft(
  vehicle: VehicleEstimateSource,
  country: CountryCode,
  date: string,
  rates: ExchangeRateSnapshot,
): VehicleEstimateDraft {
  const facts = vehicle.facts;
  const { price, currency } = vehicleTransactionPrice(vehicle);
  return {
    country,
    importerType: 'individual',
    powertrain: supportedPowertrains.has(facts.powertrain) ? facts.powertrain as Powertrain : '',
    price,
    currency,
    displacementCc: facts.engineCc !== null && facts.engineCc > 0 ? String(facts.engineCc) : '',
    powerHp: vehicleEstimatePower(vehicle)?.hp ?? '',
    manufactureDate: vehicleManufactureDate(vehicle),
    customsDate: date,
    freight: '',
    insurance: '',
    steering: '',
    condition: vehicleCondition(vehicle, country),
    ...getTajikTariffDefaults(country),
    ...deriveRates(rates, country, currency),
  };
}

export function retargetVehicleEstimateDraft(
  input: VehicleEstimateDraft,
  country: CountryCode,
  rates: ExchangeRateSnapshot,
  vehicle: VehicleEstimateSource,
): VehicleEstimateDraft {
  let price = input.price;
  if (input.country === 'TJ' && country !== 'TJ') {
    const published = vehicleTransactionPrice(vehicle);
    price = published.currency === input.currency
      ? published.price
      : convertTransactionPrice(published.price, published.currency, input.currency, rates);
  }
  return {
    ...getTajikTariffDefaults(country),
    ...input,
    price,
    country,
    ...(country === 'AL' && input.country !== 'AL' ? { condition: vehicleCondition(vehicle, country) } : {}),
    importerType: 'individual',
    ...deriveRates(rates, country, input.currency),
  };
}

/** No fallback facts are introduced here. Empty enum text remains missing to the existing core. */
export function vehicleEstimateInput(draft: VehicleEstimateDraft): CalculationInput {
  return draft as CalculationInput;
}

export function vehicleEstimateIdentity(vehicle: VehicleEstimateSource): string {
  return JSON.stringify([vehicle.id, vehicle.facts, vehicle.price, vehicle.displayPrice, vehicle.manufacture, vehicleEstimatePower(vehicle)]);
}

export function vehicleEstimateMissingLabel(locale: string): string {
  return locale === 'zh' ? '请选择' : locale === 'ru' ? 'Выберите' : 'Select';
}
