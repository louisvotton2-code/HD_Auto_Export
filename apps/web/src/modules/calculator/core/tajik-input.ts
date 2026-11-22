import type { Powertrain } from './types';

export const TAJIK_TARIFF_FIELDS = ['tjDutyPercent', 'tjExcisePercent', 'tjExciseMinimum'] as const;
export type TajikTariffField = (typeof TAJIK_TARIFF_FIELDS)[number];

export function needsTajikTariffInputs(country: string, powertrain: Powertrain | ''): boolean {
  return country === 'TJ' && (powertrain === 'petrol' || powertrain === 'diesel');
}
