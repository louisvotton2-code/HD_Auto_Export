import { describe, expect, it } from 'vitest';
import type { DisplayText, PublicVehicleInline } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import {
  makeLocalizedPublicVehicleFixture,
  makePublicVehicleFixture,
  makeConfigurationDisplayFixture,
} from '@hd/contracts/fixtures';
import {
  localizedHomeSchema,
  localizedInlineVehicleSchema,
  localizedListSchema,
  localizedVehicleSchema,
} from './localized-projection';

function inlineFixture(locale: Locale = 'ru'): PublicVehicleInline {
  const text = (value: string): DisplayText => ({
    status: 'ready', text: value, requestedLocale: locale, contentLocale: 'en', provenance: 'supplier', reviewed: false,
  });
  return {
    ...makeLocalizedPublicVehicleFixture(locale), projection: 'detail-inline-v1',
    inspectionSummary: {
      status: 'available', contentLocale: 'en', checked: 45, faults: 1,
      categories: [{ id: 'body', label: text('Body'), checked: 16, faults: 1, outcome: 'defect' }],
    },
    inspectionInline: {
      conclusions: [{ id: 'conclusion-1', name: text('Overall condition'), value: text('Repair required') }],
      defects: [{
        id: 'defect-1', categoryId: 'body', partId: 'front_left_door', groupId: 'doors', kind: 'defect',
        category: text('Body'), part: text('Front left door'), group: text('Doors'),
        name: text('Outer panel'), value: text('Dent'), outcome: 'defect',
      }],
      normalItemCount: 44, hasMoreConclusions: false, hasMoreDefects: false,
    },
    configurationInline: [{ id: 'parameter-1', semanticKey: 'motorKw', name: text('Motor power (kW)'), value: text('0') }],
  };
}

const inlineLocaleFields: readonly [string, (value: PublicVehicleInline) => DisplayText][] = [
  ['summary category', value => value.inspectionSummary.categories[0]!.label],
  ['conclusion name', value => value.inspectionInline.conclusions[0]!.name],
  ['conclusion value', value => value.inspectionInline.conclusions[0]!.value],
  ['defect category', value => value.inspectionInline.defects[0]!.category!],
  ['defect part', value => value.inspectionInline.defects[0]!.part!],
  ['defect group', value => value.inspectionInline.defects[0]!.group!],
  ['defect name', value => value.inspectionInline.defects[0]!.name],
  ['defect value', value => value.inspectionInline.defects[0]!.value],
  ['configuration name', value => value.configurationInline[0]!.name],
  ['configuration value', value => value.configurationInline[0]!.value],
];

describe('explicit inline detail projection boundary', () => {
  it.each(['zh', 'en', 'ru'] as const)('keeps actual English report/configuration text in a requested %s envelope', locale => {
    const data = inlineFixture(locale);
    const result = localizedInlineVehicleSchema(locale).parse({ data, meta: { requestId: 'inline' } });
    expect(result.data).toEqual(data);
    expect(result.data.inspectionSummary.contentLocale).toBe('en');
    for (const [, select] of inlineLocaleFields) {
      expect(select(result.data)).toMatchObject({ requestedLocale: locale, contentLocale: 'en', reviewed: false });
    }
    expect(result.data.configurationInline[0]!.value.text).toBe('0');
  });

  it('keeps old and explicit new schemas mutually strict rather than accepting an accidental mixed response', () => {
    const data = inlineFixture();
    const wrap = (value: unknown) => ({ data: value, meta: { requestId: 'boundary' } });
    expect(() => localizedVehicleSchema('ru').parse(wrap(data))).toThrow();
    expect(() => localizedInlineVehicleSchema('ru').parse(wrap(makeLocalizedPublicVehicleFixture('ru')))).toThrow();
    for (const key of ['projection', 'inspectionSummary', 'inspectionInline', 'configurationInline']) {
      const incomplete: Record<string, unknown> = { ...data };
      delete incomplete[key];
      expect(() => localizedInlineVehicleSchema('ru').parse(wrap(incomplete))).toThrow();
    }
    expect(() => localizedInlineVehicleSchema('ru').parse(wrap({ ...data, projection: 'detail-inline-v2' }))).toThrow();
  });

  it.each(inlineLocaleFields)('rejects mismatched requestedLocale for %s while preserving actual language', (_name, select) => {
    const data = inlineFixture('ru');
    select(data).requestedLocale = 'en';
    expect(() => localizedInlineVehicleSchema('ru').parse({ data, meta: { requestId: 'locale' } })).toThrow();
  });

  it('checks missing inline text metadata too and allows an honestly absent part/group', () => {
    const data = inlineFixture('zh');
    const missing: DisplayText = { status: 'missing', text: null, requestedLocale: 'zh', contentLocale: null, provenance: null, reviewed: false };
    data.configurationInline[0]!.value = missing;
    data.inspectionInline.defects[0]!.part = null;
    data.inspectionInline.defects[0]!.group = null;
    expect(localizedInlineVehicleSchema('zh').parse({ data, meta: { requestId: 'missing' } }).data).toEqual(data);
    missing.requestedLocale = 'ru';
    expect(() => localizedInlineVehicleSchema('zh').parse({ data, meta: { requestId: 'missing' } })).toThrow();
  });

  it('refuses private additional properties at the new projection and nested DTO boundaries', () => {
    const data = inlineFixture();
    for (const value of [
      { ...data, internalCost: '100' },
      { ...data, inspectionInline: { ...data.inspectionInline, sourceDocumentUrl: 'https://private.invalid/report' } },
      { ...data, inspectionInline: { ...data.inspectionInline, defects: [{ ...data.inspectionInline.defects[0], operatorNote: 'private' }] } },
      { ...data, inspectionInline: { ...data.inspectionInline, conclusions: [{ ...data.inspectionInline.conclusions[0], rawSource: 'private' }] } },
      { ...data, configurationInline: [{ ...data.configurationInline[0], supplierRaw: { private: true } }] },
      { ...data, configurationInline: [{ ...data.configurationInline[0], value: { ...data.configurationInline[0]!.value, engineMetadata: 'private' } }] },
    ]) {
      expect(() => localizedInlineVehicleSchema('ru').parse({ data: value, meta: { requestId: 'private' } })).toThrow();
    }
  });
});

describe('localized public projection boundary', () => {
  it('validates the requested scope of per-image metadata without rewriting its actual language', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('ru');
    vehicle.images[0].altText = { status: 'ready', text: '正面', requestedLocale: 'ru', contentLocale: 'zh', provenance: 'supplier', reviewed: false };
    const value = { data: vehicle, meta: { requestId: 'image-alt' } };
    expect(localizedVehicleSchema('ru').parse(value).data.images[0].altText).toMatchObject({ contentLocale: 'zh', provenance: 'supplier', reviewed: false });
    vehicle.images[0].altText.requestedLocale = 'en';
    expect(() => localizedVehicleSchema('ru').parse(value)).toThrow();
  });
  it.each([true, false])('only accepts the detail report existence fact (%s) without an original URL', (hasReport) => {
    const vehicle = makeLocalizedPublicVehicleFixture('en');
    vehicle.report = { hasReport };
    const meta = { requestId: 'report-presence' };
    expect(localizedVehicleSchema('en').parse({ data: vehicle, meta }).data.report).toEqual({ hasReport });
    expect(() => localizedVehicleSchema('en').parse({ data: { ...vehicle, report: { hasReport, url: 'https://reports.example.invalid/private' } }, meta })).toThrow();
    expect(() => localizedListSchema('en').parse({ data: { items: [vehicle], page: 1, pageSize: 24, hasMore: false }, meta })).toThrow();
    expect(() => localizedHomeSchema('en').parse({ data: { sections: [{ id: 'featured', title: 'Cars', vehicles: [vehicle] }] }, meta })).toThrow();
  });
  it.each(['name', 'value'] as const)('checks configuration %s locale and keeps detail-only content out of lists/home', (field) => {
    const vehicle = makeLocalizedPublicVehicleFixture('en');
    vehicle.configuration = makeConfigurationDisplayFixture('en');
    const envelope = { data: vehicle, meta: { requestId: 'configuration' } };
    expect(localizedVehicleSchema('en').parse(envelope).data.configuration).toEqual(vehicle.configuration);
    expect(() => localizedHomeSchema('en').parse({ data: { sections: [{ id: 'featured', title: 'Cars', vehicles: [vehicle] }] }, meta: envelope.meta })).toThrow();
    expect(() => localizedListSchema('en').parse({ data: { items: [vehicle], page: 1, pageSize: 24, hasMore: false }, meta: envelope.meta })).toThrow();
    vehicle.configuration.items[0][field].contentLocale = 'zh';
    expect(localizedVehicleSchema('en').parse(envelope).data.configuration).toEqual(vehicle.configuration);
    vehicle.configuration.items[0][field].requestedLocale = 'ru';
    expect(() => localizedVehicleSchema('en').parse(envelope)).toThrow();
  });
  it.each(['zh', 'en', 'ru'] as const)(
    'accepts actual %s projections including missing text metadata',
    (locale) => {
      const vehicle = makeLocalizedPublicVehicleFixture(locale, 'missing');
      expect(
        localizedVehicleSchema(locale).parse({ data: vehicle, meta: { requestId: 'localized' } })
          .data,
      ).toEqual(vehicle);
      expect(
        localizedHomeSchema(locale).parse({
          data: { sections: [{ id: 'featured', title: 'Cars', vehicles: [vehicle] }] },
          meta: { requestId: 'localized' },
        }).data.sections,
      ).toHaveLength(1);
    },
  );
  it('refuses a legacy DTO and a wrong requested language instead of leaking raw text', () => {
    const wrap = (data: unknown) => ({ data, meta: { requestId: 'localized' } });
    expect(() => localizedVehicleSchema('en').parse(wrap(makePublicVehicleFixture()))).toThrow();
    expect(() =>
      localizedVehicleSchema('ru').parse(wrap(makeLocalizedPublicVehicleFixture('zh'))),
    ).toThrow();
    const vehicle = makeLocalizedPublicVehicleFixture('en');
    vehicle.display!.make.requestedLocale = 'zh';
    expect(() => localizedVehicleSchema('en').parse(wrap(vehicle))).toThrow();
    const wrongDescription = makeLocalizedPublicVehicleFixture('en');
    wrongDescription.content.description = {
      ...wrongDescription.content.title,
      text: 'Description',
      requestedLocale: 'zh',
    };
    expect(() => localizedVehicleSchema('en').parse(wrap(wrongDescription))).toThrow();
    const wrongPath = makeLocalizedPublicVehicleFixture('en');
    wrongPath.detailPath = `/ru/cars/${wrongPath.id}/`;
    expect(() => localizedVehicleSchema('en').parse(wrap(wrongPath))).toThrow();
  });
  it('does not require invented display fields for an empty result', () => {
    expect(
      localizedListSchema('en').parse({
        data: { items: [], page: 1, pageSize: 24, hasMore: false },
        meta: {
          requestId: 'empty',
          catalog: 'curated',
          total: 0,
          totalKind: 'exact',
          accessibleTotal: 0,
          dataAsOf: '2026-11-08T00:00:00Z',
          freshness: 'fresh',
        },
      }).data.items,
    ).toEqual([]);
  });

  it('requires the USD price only on opt-in projections', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('en');
    const envelope = { data: vehicle, meta: { requestId: 'price-view' } };
    expect(() => localizedVehicleSchema('en', 'usd').parse(envelope)).toThrow();
    vehicle.displayPrice = {
      status: 'ready', kind: 'asking',
      money: { amount: '23500.00', currency: 'USD' }, conversion: null,
    };
    expect(localizedVehicleSchema('en', 'usd').parse(envelope).data.displayPrice).toEqual(
      vehicle.displayPrice,
    );
    expect(() => localizedVehicleSchema('en').parse(envelope)).toThrow();
  });
});
