/**
 * Homepage-only reference demonstration material, captured 2026-11-04.
 * These model-family cards are not individual inventory records and must not
 * be combined with a different vehicle's specifications or photographs.
 */
export type PopularModelDemo = {
  slug: string;
  make: string;
  model: string;
  description: string;
  startingPriceUsd: number;
  image: string;
  imageAlt: string;
  source: 'reference-demo';
  sourceUrl: string;
  sourceImageUrl: string;
};

export const referenceHomepageSource = {
  url: 'https://www.kmotors.shop/en',
  capturedOn: '2026-11-04',
  purpose: 'local-reference-demo',
  liveInventory: false,
  thirdPartyImagesRequirePermissionForPublication: true,
} as const;

/** Prices reproduce the reference card snapshot; they are not HD Auto quotes. */
export const popularModels: readonly PopularModelDemo[] = [
  {
    slug: 'kia-sorento',
    make: 'KIA',
    model: 'Sorento',
    description: '7-seat crossover',
    startingPriceUsd: 24000,
    image: '/demo-vehicles/popular-models/kia-sorento.webp',
    imageAlt: 'KIA Sorento',
    source: 'reference-demo',
    sourceUrl: 'https://www.kmotors.shop/en/models/kia-sorento',
    sourceImageUrl: 'https://www.kmotors.shop/models/kia-sorento/1.webp',
  },
  {
    slug: 'kia-sportage',
    make: 'KIA',
    model: 'Sportage',
    description: 'Compact crossover',
    startingPriceUsd: 16000,
    image: '/demo-vehicles/popular-models/kia-sportage.jpg',
    imageAlt: 'KIA Sportage',
    source: 'reference-demo',
    sourceUrl: 'https://www.kmotors.shop/en/models/kia-sportage',
    sourceImageUrl: 'https://www.kmotors.shop/models/sportage.jpg',
  },
  {
    slug: 'kia-carnival',
    make: 'KIA',
    model: 'Carnival',
    description: 'Premium 7–9 seat minivan',
    startingPriceUsd: 33000,
    image: '/demo-vehicles/popular-models/kia-carnival.jpg',
    imageAlt: 'KIA Carnival',
    source: 'reference-demo',
    sourceUrl: 'https://www.kmotors.shop/en/models/kia-carnival',
    sourceImageUrl: 'https://www.kmotors.shop/models/carnival.jpg',
  },
  {
    slug: 'hyundai-tucson',
    make: 'Hyundai',
    model: 'Tucson',
    description: 'Best price-to-quality ratio',
    startingPriceUsd: 16000,
    image: '/demo-vehicles/popular-models/hyundai-tucson.jpg',
    imageAlt: 'Hyundai Tucson',
    source: 'reference-demo',
    sourceUrl: 'https://www.kmotors.shop/en/models/hyundai-tucson',
    sourceImageUrl: 'https://www.kmotors.shop/models/tucson.jpg',
  },
  {
    slug: 'hyundai-palisade',
    make: 'Hyundai',
    model: 'Palisade',
    description: 'Flagship full-size crossover',
    startingPriceUsd: 38000,
    image: '/demo-vehicles/popular-models/hyundai-palisade.jpg',
    imageAlt: 'Hyundai Palisade',
    source: 'reference-demo',
    sourceUrl: 'https://www.kmotors.shop/en/models/hyundai-palisade',
    sourceImageUrl: 'https://www.kmotors.shop/models/palisade.jpg',
  },
  {
    slug: 'hyundai-santa-fe',
    make: 'Hyundai',
    model: 'Santa Fe',
    description: 'Family 5–7 seat crossover',
    startingPriceUsd: 22000,
    image: '/demo-vehicles/popular-models/hyundai-santa-fe.jpg',
    imageAlt: 'Hyundai Santa Fe',
    source: 'reference-demo',
    sourceUrl: 'https://www.kmotors.shop/en/models/hyundai-santa-fe',
    sourceImageUrl: 'https://www.kmotors.shop/models/santafe.jpg',
  },
  {
    slug: 'genesis-gv80',
    make: 'Genesis',
    model: 'GV80',
    description: 'Luxury crossover — BMW X5 rival',
    startingPriceUsd: 49000,
    image: '/demo-vehicles/popular-models/genesis-gv80.jpg',
    imageAlt: 'Genesis GV80',
    source: 'reference-demo',
    sourceUrl: 'https://www.kmotors.shop/en/models/genesis-gv80',
    sourceImageUrl: 'https://www.kmotors.shop/models/genesis-gv80.jpg',
  },
  {
    slug: 'kia-k5',
    make: 'KIA',
    model: 'K5',
    description: 'Sporty business-class sedan',
    startingPriceUsd: 16000,
    image: '/demo-vehicles/popular-models/kia-k5.jpg',
    imageAlt: 'KIA K5',
    source: 'reference-demo',
    sourceUrl: 'https://www.kmotors.shop/en/models/kia-k5',
    sourceImageUrl: 'https://www.kmotors.shop/models/k5.jpg',
  },
  {
    slug: 'hyundai-sonata',
    make: 'Hyundai',
    model: 'Sonata',
    description: 'Comfort sedan — space and reliability',
    startingPriceUsd: 16000,
    image: '/demo-vehicles/popular-models/hyundai-sonata.jpg',
    imageAlt: 'Hyundai Sonata',
    source: 'reference-demo',
    sourceUrl: 'https://www.kmotors.shop/en/models/hyundai-sonata',
    sourceImageUrl: 'https://www.kmotors.shop/models/sonata.jpg',
  },
];
