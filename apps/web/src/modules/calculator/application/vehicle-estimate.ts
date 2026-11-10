import type { PublicVehicle } from '@hd/contracts/public';
import { Amount } from '../core/decimal';
import type { CalculationInput, CountryCode, Powertrain } from '../index';
import { deriveRates, type ExchangeRateSnapshot } from '../infrastructure/exchange-rates';
import { vehicleManufacturePrefill } from './manufacture-estimate';

/** The UI can leave unknown enums empty; the core's required-field checks accept empty text. */
export type VehicleEstimateDraft = Omit<CalculationInput, 'powertrain' | 'condition' | 'steering'> & {
  powertrain: Powertrain | '';
  condition: 'new' | 'used' | '';
  steering: 'left' | 'right' | '';
};

const supportedPowertrains = new Set(['petrol', 'diesel', 'hev', 'phev', 'erev', 'bev']);

export function createVehicleEstimateDraft(
  vehicle: PublicVehicle,
  country: CountryCode,
  date: string,
  rates: ExchangeRateSnapshot,
): VehicleEstimateDraft {
  const facts = vehicle.facts;
  const money = vehicle.price.money;
  let price = '';
  if (money && money.currency in rates.rates) {
    const rate = rates.rates[money.currency as keyof typeof rates.rates];
    if (new Amount(rate).gt(0)) price = new Amount(money.amount).div(rate).toFixed(2);
  }
  return {
    country,
    importerType: 'individual',
    powertrain: supportedPowertrains.has(facts.powertrain) ? facts.powertrain as Powertrain : '',
    price,
    currency: 'USD',
    displacementCc: facts.engineCc !== null && facts.engineCc > 0 ? String(facts.engineCc) : '',
    // kW -> metric horsepower, not an assertion that the supplier supplied hp.
    powerHp: facts.powerKw !== null && facts.powerKw > 0
      ? new Amount(facts.powerKw).mul('1.3596216173').toFixed(6).replace(/\.?0+$/, '')
      : '',
    manufactureDate: vehicleManufacturePrefill(vehicle, date).value,
    customsDate: date,
    freight: '',
    insurance: '',
    steering: '',
    condition: facts.registrationStatus === 'never_registered'
      ? 'new'
      : facts.registrationStatus === 'registered' ? 'used' : '',
    ...deriveRates(rates, country, 'USD'),
  };
}

/** No fallback facts are introduced here. Empty enum text remains missing to the existing core. */
export function vehicleEstimateInput(draft: VehicleEstimateDraft): CalculationInput {
  return draft as CalculationInput;
}

export function vehicleEstimateIdentity(vehicle: PublicVehicle): string {
  return JSON.stringify([vehicle.id, vehicle.facts, vehicle.price]);
}

export function vehicleEstimateMissingLabel(locale: string): string {
  return locale === 'zh' ? '请选择' : locale === 'ru' ? 'Выберите' : 'Select';
}
