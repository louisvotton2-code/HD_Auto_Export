import type { PublicVehicle } from '@hd/contracts/public';
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
  const projected = vehicle.displayPrice?.status === 'ready' ? vehicle.displayPrice.money : null;
  const money = projected?.currency === 'USD' ? projected : vehicle.price.money;
  const currency = money?.currency === 'CNY' ? 'CNY' : 'USD';
  const price = money && (money.currency === 'USD' || money.currency === 'CNY') ? money.amount : '';
  return {
    country,
    importerType: 'individual',
    powertrain: supportedPowertrains.has(facts.powertrain) ? facts.powertrain as Powertrain : '',
    price,
    currency,
    displacementCc: facts.engineCc !== null && facts.engineCc > 0 ? String(facts.engineCc) : '',
    // The public adapter supplies the confirmed hp field. Do not infer it from another power scope.
    powerHp: typeof facts.powerHp === 'number' && Number.isFinite(facts.powerHp) && facts.powerHp > 0
      ? String(facts.powerHp) : '',
    manufactureDate: vehicleManufacturePrefill(vehicle, date).value,
    customsDate: date,
    freight: '',
    insurance: '',
    steering: '',
    condition: facts.registrationStatus === 'never_registered'
      ? 'new'
      : facts.registrationStatus === 'registered' ? 'used' : '',
    ...deriveRates(rates, country, currency),
  };
}

/** No fallback facts are introduced here. Empty enum text remains missing to the existing core. */
export function vehicleEstimateInput(draft: VehicleEstimateDraft): CalculationInput {
  return draft as CalculationInput;
}

export function vehicleEstimateIdentity(vehicle: PublicVehicle): string {
  return JSON.stringify([vehicle.id, vehicle.facts, vehicle.price, vehicle.displayPrice, vehicle.manufacture]);
}

export function vehicleEstimateMissingLabel(locale: string): string {
  return locale === 'zh' ? '请选择' : locale === 'ru' ? 'Выберите' : 'Select';
}
