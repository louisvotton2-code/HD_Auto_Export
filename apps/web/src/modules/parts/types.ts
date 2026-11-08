import type { Locale } from '@/i18n/routing';

export type PartCategory = 'chassis' | 'transmission' | 'components' | 'body';
export type PartText = Record<Locale, string>;
export type PartImage = { id: string; url: string };
export interface Part {
  slug: string;
  oem: string;
  name: PartText;
  brand: string;
  category: PartCategory;
  /** A captured USD reference, never a current stock or delivered-price promise. */
  referencePriceUsd: number | null;
  images: readonly PartImage[];
}
export interface PartsQuery {
  q: string;
  brand: string;
  category: PartCategory | '';
  min: string;
  max: string;
  sort: 'default' | 'price-asc' | 'price-desc' | 'name';
}
export interface PartsRepository {
  list(): Promise<readonly Part[]>;
  findBySlug(slug: string): Promise<Part | null>;
}
