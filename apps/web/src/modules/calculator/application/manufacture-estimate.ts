import type { PublicVehicle } from '@hd/contracts/public';
import { parseManufactureMonth } from '../core/dates';
import { isManufactureMonthRange, type ManufactureMonthRange } from './manufacture-range';

/** Legacy markers are read only to remove an older guessed date, never to create a new date. */
export type ManufactureEstimate = 'manufacture_year' | 'model_year';

/** Only a real manufacture month is an exact date. Model years are never manufacture months. */
export function vehicleManufacturePrefill(vehicle: PublicVehicle, _clearanceDate: string): {
  value: string;
  range?: ManufactureMonthRange;
} {
  const exact = [vehicle.manufacture?.date, vehicle.facts.manufacturedAt]
    .find(date => date && date.precision !== 'year');
  if (exact && parseManufactureMonth(exact.value.slice(0, 7))) return { value: exact.value.slice(0, 7) };
  const range = vehicle.manufacture?.range;
  if (range) {
    const months = {
      from: range.earliest.precision === 'year' ? `${range.earliest.value}-01` : range.earliest.value.slice(0, 7),
      to: range.latest.precision === 'year' ? `${range.latest.value}-12` : range.latest.value.slice(0, 7),
    };
    if (isManufactureMonthRange(months)) return { value: '', range: months };
  }
  return { value: '' };
}

/** Accept the explicit estimate marker only with the January date it describes. */
export function readManufactureEstimate(value: unknown, date: unknown): ManufactureEstimate | undefined {
  if (value !== 'manufacture_year' && value !== 'model_year') return undefined;
  return typeof date === 'string' && parseManufactureMonth(date)?.month === 1 ? value : undefined;
}
