import { describe, expect, it } from 'vitest';
import { adminVehicleFixture } from '@hd/contracts/fixtures';
import type { AdminVehicle } from '@hd/contracts/admin';
import { addHomeVehicleId, isHomeEligible, moveHomeVehicleId, reorderHomeVehicleId } from './home-sections-model';

function vehicle(publicationState: AdminVehicle['publicationState'], availability: AdminVehicle['availability']): AdminVehicle {
  return { ...structuredClone(adminVehicleFixture), publicationState, availability };
}

describe('homepage recommendations', () => {
  it('only admits published available real vehicles, while keeping draft/reserved/sold records out', () => {
    expect(isHomeEligible(vehicle('published', 'available'))).toBe(true);
    for (const availability of ['reserved', 'sold', 'unknown'] as const) expect(isHomeEligible(vehicle('published', availability))).toBe(false);
    expect(isHomeEligible(vehicle('draft', 'available'))).toBe(false);
    expect(isHomeEligible(vehicle('archived', 'available'))).toBe(false);
  });
  it('allows a published demo without inventing available inventory', () => {
    const demo = vehicle('published', 'unknown');
    Object.assign(demo.draft.source, { kind: 'demo' });
    demo.availabilityCheckedAt = null;
    expect(isHomeEligible(demo)).toBe(true);
    expect(demo.availability).toBe('unknown');
    demo.publicationState = 'draft';
    expect(isHomeEligible(demo)).toBe(false);
  });
  it('allows honest external listings but excludes deleted or inventory-claimed records', () => {
    const external = vehicle('published', 'unknown');
    external.draft.source = { kind: 'external', platform: { id: 'market', name: 'Market' }, listingUrl: 'https://example.invalid/1', externalId: '1', collectedAt: '2026-11-08T00:00:00Z', sourceUpdatedAt: null };
    external.availabilityCheckedAt = null;
    expect(isHomeEligible(external)).toBe(true);
    external.deletedAt = '2026-11-08T10:00:00Z';
    expect(isHomeEligible(external)).toBe(false);
    external.deletedAt = null; external.availability = 'available';
    expect(isHomeEligible(external)).toBe(false);
  });
  it('rejects duplicate selections, ineligible vehicles and more than thirty recommendations', () => {
    const ready = vehicle('published', 'available');
    expect(addHomeVehicleId([], ready)).toEqual([ready.id]);
    expect(addHomeVehicleId([ready.id], ready)).toEqual([ready.id]);
    expect(addHomeVehicleId([], vehicle('published', 'sold'))).toEqual([]);
    const full = Array.from({ length: 30 }, (_, index) => `existing_${index}`);
    expect(addHomeVehicleId(full, ready)).toEqual(full);
  });
  it('changes only the requested relative order without losing selected IDs', () => {
    const original = ['a', 'b', 'c'];
    expect(moveHomeVehicleId(original, 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveHomeVehicleId(original, 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveHomeVehicleId(original, 0, -1)).toEqual(original);
    expect(moveHomeVehicleId(original, 2, 1)).toEqual(original);
    expect(original).toEqual(['a', 'b', 'c']);
  });
  it('places a new vehicle first without bypassing eligibility, uniqueness or the limit', () => {
    const ready = vehicle('published', 'available');
    expect(addHomeVehicleId(['a', 'b'], ready, 'start')).toEqual([ready.id, 'a', 'b']);
    expect(addHomeVehicleId(['a', ready.id], ready, 'start')).toEqual(['a', ready.id]);
    expect(addHomeVehicleId(['a'], vehicle('published', 'sold'), 'start')).toEqual(['a']);
    const full = Array.from({ length: 30 }, (_, index) => `existing_${index}`);
    expect(addHomeVehicleId(full, ready, 'start')).toEqual(full);
  });
  it('moves by vehicle identity to a final position and preserves the other vehicles’ relative order', () => {
    const original = ['a', 'b', 'c', 'd'];
    expect(reorderHomeVehicleId(original, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(reorderHomeVehicleId(original, 'a', 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(reorderHomeVehicleId(original, 'd', 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(original).toEqual(['a', 'b', 'c', 'd']);
  });
  it('rejects missing identities and invalid positions without dropping or duplicating vehicles', () => {
    const ids = ['a', 'b', 'c'];
    for (const position of [-1, 3, 1.5, NaN, Infinity]) expect(reorderHomeVehicleId(ids, 'b', position)).toEqual(ids);
    expect(reorderHomeVehicleId(ids, 'removed', 0)).toEqual(ids);
    expect(reorderHomeVehicleId(ids, 'b', 1)).toEqual(ids);
    expect(reorderHomeVehicleId([], 'a', 0)).toEqual([]);
  });
});
