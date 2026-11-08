/** A catalog model facet, never a specific car or an inventory quotation. */
export type HomeModel = {
  name: string;
  brand: string;
  href: string;
  count: number;
  /** A representative from the already requested home sections, not a generic brand photo. */
  image: { url: string; alt: string; width: number; height: number };
};
