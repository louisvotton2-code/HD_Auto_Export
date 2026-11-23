import type { PublicVehicle } from '@hd/contracts/public';
import { parseCustomsDate, parseManufactureMonth } from '../core/dates';

/** Legacy markers are read only to remove an older guessed date, never to create a new date. */
export type ManufactureEstimate = 'manufacture_year' | 'model_year';

/** Preserve the confirmed day. Model years alone never become manufacture dates. */
export function vehicleManufactureDate(vehicle: PublicVehicle): string {
  for (const date of [vehicle.manufacture?.date, vehicle.facts.manufacturedAt]) {
    if (!date || date.precision === 'year') continue;
    if (date.precision === 'day' && parseCustomsDate(date.value)) return date.value;
    const month = date.value.slice(0, 7);
    if (parseManufactureMonth(month)) return month;
  }
  return '';
}

/** Accept the explicit estimate marker only with the January date it describes. */
export function readManufactureEstimate(value: unknown, date: unknown): ManufactureEstimate | undefined {
  if (value !== 'manufacture_year' && value !== 'model_year') return undefined;
  return typeof date === 'string' && parseManufactureMonth(date)?.month === 1 ? value : undefined;
}
