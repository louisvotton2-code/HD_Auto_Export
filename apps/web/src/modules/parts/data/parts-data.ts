import raw from './reference-parts.json';
import { partNames } from './name-translations';
import type { Part, PartCategory } from '../types';

const categories: Record<string, PartCategory> = {
  Chassis: 'chassis', Transmission: 'transmission', Engine: 'components', Body: 'body',
};

/** The legacy broad Engine group also contains connectors and ABS: do not invent engine fitment. */
export const partsData: readonly Part[] = raw.map((row) => {
  if (!partNames[row.name] || !categories[row.category] || !/^[A-Z0-9]+$/.test(row.oem))
    throw new Error(`Invalid static part record: ${row.oem}`);
  return {
    slug: row.oem.toLowerCase(),
    oem: row.oem,
    name: partNames[row.name]!,
    brand: row.brand,
    category: categories[row.category]!,
    referencePriceUsd: Number.isFinite(row.price) && row.price > 0 ? row.price : null,
    images: [{ id: `${row.oem}-cover`, url: `/parts/${row.img.split('/').at(-1)}` }],
  };
});
