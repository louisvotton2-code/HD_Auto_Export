import { partsData } from './data/parts-data';
import type { PartsRepository } from './types';

/** Replace this adapter with an HTTP-backed repository without changing page or UI contracts. */
const staticPartsRepository: PartsRepository = {
  async list() { return partsData; },
  async findBySlug(slug) {
    if (!/^[a-zA-Z0-9]{1,60}$/.test(slug)) return null;
    return partsData.find((part) => part.slug === slug.toLowerCase()) ?? null;
  },
};
export const listParts = () => staticPartsRepository.list();
export const getPart = (slug: string) => staticPartsRepository.findBySlug(slug);
