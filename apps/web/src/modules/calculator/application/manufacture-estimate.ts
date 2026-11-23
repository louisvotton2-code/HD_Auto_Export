import type { PublicVehicle } from '@hd/contracts/public';
import { parseCustomsDate, parseManufactureMonth } from '../core/dates';

/** Legacy markers are read only to remove an older guessed date, never to create a new date. */
export type ManufactureEstimate = 'manufacture_year' | 'model_year';

/** Prefer the published date. Use a more precise matching fact when available. */
export function vehicleManufactureFacts(vehicle: PublicVehicle) {
  const dates = [vehicle.manufacture?.date, vehicle.facts.manufacturedAt].filter(date => date != null);
  const first = dates[0];
  if (!first) return { manufactureDate: '' };
  const compatible = dates.filter(date => date.value.startsWith(first.value));
  const day = compatible.find(date => date.precision === 'day' && parseCustomsDate(date.value));
  if (day) return { manufactureDate: day.value.slice(0, 7), manufactureDay: day.value };
  const month = compatible.find(date => date.precision === 'month' && parseManufactureMonth(date.value));
  if (month) return { manufactureDate: month.value };
  return { manufactureDate: '', ...(first.precision === 'year' ? { manufactureYear: first.value } : {}) };
}
export function vehicleManufactureMonth(vehicle: PublicVehicle): string {
  return vehicleManufactureFacts(vehicle).manufactureDate;
}

/** Accept the explicit estimate marker only with the January date it describes. */
export function readManufactureEstimate(value: unknown, date: unknown): ManufactureEstimate | undefined {
  if (value !== 'manufacture_year' && value !== 'model_year') return undefined;
  return typeof date === 'string' && parseManufactureMonth(date)?.month === 1 ? value : undefined;
}
