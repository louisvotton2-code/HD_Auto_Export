import { describe, expect, it } from 'vitest';
import { makePublicVehicleFixture, makeConfigurationDisplayFixture } from '@hd/contracts/fixtures';
import { PublicVehicleSchema, type DisplayText, type PublicVehicleGalleryResponse, type PublicVehicleConfigurationResponse, type PublicVehicleInspectionResponse } from '@hd/contracts/public';
import { parseVehicleSegment, mergeVehicleSegment, VehicleSegmentError } from './public-segments';

const vehicle = makePublicVehicleFixture();
const image = vehicle.images[0];
const revision = 'a'.repeat(64);
const gallery = (ids: string[], total: number, nextCursor: string | null): PublicVehicleGalleryResponse['data'] => ({
  vehicleId: vehicle.id, locale: 'ru', revision, total, nextCursor,
  items: ids.map((id, index) => ({ ...image, id, sortOrder: index + 35 })),
});
const envelope = (data: unknown) => ({ data, meta: { requestId: 'segment-test' } });
const inspectionField = (text: string): DisplayText => ({
  status: 'ready', text, requestedLocale: 'zh', contentLocale: 'en', provenance: 'supplier', reviewed: false,
});
const inspection = (): PublicVehicleInspectionResponse['data'] => ({
  vehicleId: vehicle.id, locale: 'zh', revision, status: 'available', total: 1, nextCursor: null,
  summary: { status: 'available', contentLocale: 'en', checked: 0, faults: null,
    categories: [{ id: 'accident', label: inspectionField('Accident inspection'), checked: 0, faults: null, outcome: 'unknown' }] },
  conclusions: [{ id: 'recorded-conclusion', name: inspectionField('Recorded conclusion'), value: inspectionField('No conclusion supplied') }],
  items: [{ id: 'check-one', categoryId: 'accident', partId: 'body', groupId: 'body', kind: 'summary',
    category: inspectionField('Accident inspection'), part: inspectionField('Body'), group: inspectionField('Stored checks'),
    name: inspectionField('Structural inspection'), value: inspectionField('No observation supplied'), outcome: 'unknown' }],
});

describe('public segment identity, privacy and complete page merging', () => {
  it('keeps gallery alt provenance beyond the preview and rejects another requested locale', () => {
    const data = gallery(['image-31'], 1, null);
    data.items[0].altText = { status: 'ready', text: '正面', requestedLocale: 'ru', contentLocale: 'zh', provenance: 'supplier', reviewed: false };
    expect(parseVehicleSegment('gallery', envelope(data), vehicle.id, 'ru').data.items[0].altText).toMatchObject({ contentLocale: 'zh', reviewed: false });
    data.items[0].altText.requestedLocale = 'en';
    expect(() => parseVehicleSegment('gallery', envelope(data), vehicle.id, 'ru')).toThrow();
  });
  it('accepts absolute positions beyond the preview but retains the 30-image preview bound', () => {
    const parsed = parseVehicleSegment('gallery', envelope(gallery(['a'], 1, null)), vehicle.id, 'ru');
    expect(parsed.data.items[0].sortOrder).toBe(35);
    expect(() => PublicVehicleSchema.parse({ ...vehicle, images: Array.from({ length: 31 }, () => image) })).toThrow();
  });
  it.each(['vehicleId', 'locale'] as const)('rejects a response for another %s', field => {
    const data = { ...gallery(['a'], 1, null), [field]: field === 'locale' ? 'zh' : 'another' };
    expect(() => parseVehicleSegment('gallery', envelope(data), vehicle.id, 'ru')).toThrow();
  });
  it('rejects private page fields and duplicate page identities', () => {
    for (const extra of [{ staffId: 'private' }, { vin: 'private' }, { seller: 'private' }, { reportUrl: 'https://private.invalid/' }])
      expect(() => parseVehicleSegment('gallery', envelope({ ...gallery(['a'], 1, null), ...extra }), vehicle.id, 'ru')).toThrow();
    expect(() => parseVehicleSegment('gallery', envelope(gallery(['a', 'a'], 2, null)), vehicle.id, 'ru')).toThrow();
    expect(() => parseVehicleSegment('gallery', envelope(gallery(['a'], 1, '')), vehicle.id, 'ru')).toThrow();
  });
  it('preserves actual source language, zero and units while validating requested configuration locale', () => {
    const item = structuredClone(makeConfigurationDisplayFixture('ru').items[0]);
    item.value = { status: 'ready', text: '0 kW', contentLocale: 'zh', requestedLocale: 'ru', provenance: 'original', reviewed: false };
    const data = { vehicleId: vehicle.id, locale: 'ru', revision, total: 1, items: [item], nextCursor: null };
    const parsed = parseVehicleSegment('configuration', envelope(data), vehicle.id, 'ru');
    expect(parsed.data.items[0].value).toMatchObject({ text: '0 kW', contentLocale: 'zh' });
    item.name.requestedLocale = 'en';
    expect(() => parseVehicleSegment('configuration', envelope(data), vehicle.id, 'ru')).toThrow();
  });
  it('keeps inspection English content under the Chinese request locale and preserves complete zero and unknown statistics', () => {
    const parsed = parseVehicleSegment('inspection', envelope(inspection()), vehicle.id, 'zh').data;
    expect(parsed.locale).toBe('zh');
    expect(parsed.summary).toMatchObject({ contentLocale: 'en', checked: 0, faults: null });
    expect(parsed.summary?.categories[0]).toMatchObject({ checked: 0, faults: null,
      label: { requestedLocale: 'zh', contentLocale: 'en' } });
    expect(parsed.conclusions?.[0].name).toMatchObject({ requestedLocale: 'zh', contentLocale: 'en' });
    expect(parsed.conclusions?.[0].value).toMatchObject({ requestedLocale: 'zh', contentLocale: 'en' });
    expect(parsed.items[0].group).toMatchObject({ requestedLocale: 'zh', contentLocale: 'en' });
    expect(parsed.total).toBe(1); // Itemized record count is separate from the stored check count.
  });
  it.each(['summary', 'conclusion-name', 'conclusion-value', 'group'] as const)(
    'rejects a requested locale mismatch in the inspection %s', field => {
      const data = inspection();
      const fields = { summary: data.summary!.categories[0].label,
        'conclusion-name': data.conclusions![0].name, 'conclusion-value': data.conclusions![0].value,
        group: data.items[0].group! };
      fields[field].requestedLocale = 'en';
      expect(() => parseVehicleSegment('inspection', envelope(data), vehicle.id, 'zh')).toThrow(VehicleSegmentError);
    },
  );
  it('merges stable overlapping pages without treating the seed as a first page', () => {
    const first = gallery(['a', 'b'], 3, 'next');
    const second = gallery(['b', 'c'], 3, null);
    // The same identity must have the exact same public value in this revision.
    second.items[0] = first.items[1];
    expect(mergeVehicleSegment<'gallery'>(first, second).items.map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(mergeVehicleSegment<'gallery'>(null, gallery(['b'], 1, null)).items.map(item => item.id)).toEqual(['b']);
  });
  it.each(['revision', 'total', 'locale', 'vehicleId'] as const)('does not merge changed %s across a page stack', field => {
    const first = gallery(['a'], 2, 'next');
    const second = { ...gallery(['b'], 2, null), [field]: field === 'total' ? 3 : field === 'revision' ? 'b'.repeat(64) : field === 'locale' ? 'en' : 'another' };
    expect(() => mergeVehicleSegment<'gallery'>(first, second as typeof first)).toThrow();
  });
  it('rejects changed duplicates and a silent truncated terminal page', () => {
    const first = gallery(['a'], 2, 'next');
    const changed = gallery(['a'], 2, 'another-page');
    changed.items[0].alt += ' changed';
    expect(() => mergeVehicleSegment<'gallery'>(first, changed)).toThrow();
    expect(() => mergeVehicleSegment<'gallery'>(null, gallery(['a'], 2, null))).toThrow();
    expect(() => mergeVehicleSegment<'gallery'>(null, gallery([], 2, 'next'))).toThrow();
    expect(() => mergeVehicleSegment<'gallery'>(null, gallery(['a'], 1, 'next'))).toThrow();
  });
  it('can accumulate complete public configurations beyond the old 500-entry projection', () => {
    const seed = makeConfigurationDisplayFixture('ru').items[0];
    let current: PublicVehicleConfigurationResponse['data'] | null = null;
    for (let page = 0; page < 6; page++) {
      const next = { vehicleId: vehicle.id, locale: 'ru' as const, revision, total: 600,
        items: Array.from({ length: 100 }, (_, i) => ({ ...seed, id: `entry-${page * 100 + i}` })), nextCursor: page === 5 ? null : `page-${page + 1}` };
      current = mergeVehicleSegment<'configuration'>(current, parseVehicleSegment('configuration', envelope(next), vehicle.id, 'ru').data);
    }
    expect(current?.items).toHaveLength(600);
    expect(current?.nextCursor).toBeNull();
  });
});
