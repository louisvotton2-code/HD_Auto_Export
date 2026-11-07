/** Presentation-only contract. Records arrive through the vehicle module facade. */
export type HomeVehicle = {
  slug: string;
  make: string;
  model: string;
  year: number;
  priceUsd: number;
  referencePriceKrw?: number;
  transmission?: 'automatic' | 'manual';
  mileageKm: number;
  fuel: string;
  body: string;
  image: string;
  imageAlt: string;
  sampleOrigin: 'company-legacy' | 'reference-korea';
};
export type HomeModel = {
  name: string;
  brand: string;
  image: string;
  href: string;
  subtitle?: string;
  priceUsd?: number;
};
