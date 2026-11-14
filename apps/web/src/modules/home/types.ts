import type { DestinationCountryCode } from '@/shared/lib/destination-country';
import type { PublicMedia } from '@hd/contracts/public';

/** A catalog model facet, never a specific car or an inventory quotation. */
export type HomeModel = {
  name: string;
  brand: string;
  href: string;
  count: number;
  /** A representative from the already requested home sections, not a generic brand photo. */
  image: PublicMedia;
};

export type HomeDestination = { code: DestinationCountryCode; slug: string; name: string };
