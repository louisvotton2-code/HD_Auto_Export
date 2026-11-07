/** Demonstration vehicle fields. Values are not a live inventory or a quotation. */
export type VehicleFuel = 'electric' | 'petrol' | 'hybrid' | 'lpg';
export type VehicleBody = 'hatchback' | 'suv' | 'sedan';
export type Vehicle = {
  slug: string;
  make: string;
  model: string;
  year: number;
  priceUsd: number;
  /** Public reference snapshot only; never a current purchasing quote. */
  referencePriceKrw?: number;
  transmission?: 'automatic' | 'manual';
  /** Public detail page for this exact reference sample, not a runtime API. */
  referenceUrl?: string;
  mileageKm: number;
  fuel: VehicleFuel;
  body: VehicleBody;
  image: string;
  imageAlt: string;
  /** All records currently originate from mock data, not an inventory feed. */
  source: 'demo';
  /** Identifies the provenance of a demo sample, not current vehicle availability. */
  sampleOrigin: 'company-legacy' | 'reference-korea';
};
export type VehicleFilters = {
  query?: string;
  fuel?: VehicleFuel | 'all';
  body?: VehicleBody | 'all';
};
