import type { PublicVehicle } from '@hd/contracts/public';
import { parseCustomsDate, parseManufactureMonth } from '../core/dates';

export type ManufactureEstimate = 'manufacture_year' | 'model_year';

/** Keep a real manufacture month first. January is an editable estimate when only a year is known. */
export function vehicleManufacturePrefill(vehicle: PublicVehicle, clearanceDate: string): {
  value: string;
  estimate?: ManufactureEstimate;
} {
  const { manufacturedAt, modelYear } = vehicle.facts;
  if (manufacturedAt && manufacturedAt.precision !== 'year') {
    return { value: manufacturedAt.value.slice(0, 7) };
  }
  const year = manufacturedAt ? Number(manufacturedAt.value) : modelYear;
  const clearance = parseCustomsDate(clearanceDate);
  if (!year || !clearance || year > clearance.year) return { value: '' };

  return {
    value: `${String(year).padStart(4, '0')}-01`,
    estimate: manufacturedAt ? 'manufacture_year' : 'model_year',
  };
}

/** Accept the explicit estimate marker only with the January date it describes. */
export function readManufactureEstimate(value: unknown, date: unknown): ManufactureEstimate | undefined {
  if (value !== 'manufacture_year' && value !== 'model_year') return undefined;
  return typeof date === 'string' && parseManufactureMonth(date)?.month === 1 ? value : undefined;
}
