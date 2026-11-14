import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeImportedPublicVehicleFixture, makeLocalizedPublicVehicleFixture } from '@hd/contracts/fixtures';
import type { Locale } from '@/i18n/routing';
import { publicVehicleRecordsCopy } from '../public-vehicle-records-copy';
import { publicSourcePrivacy } from '../public-source-privacy';
import { PublicVehicleDetail } from './public-vehicle-detail';

describe('public vehicle detail export conditions', () => {
  it.each(['zh', 'en', 'ru'] as Locale[])('omits export conditions for every status in %s', locale => {
    for (const exportStatus of ['eligible', 'restricted', 'unknown'] as const) {
      const vehicle = { ...makeLocalizedPublicVehicleFixture(locale), exportStatus };
      const html = renderToStaticMarkup(createElement(PublicVehicleDetail, { vehicle, locale }));
      const copy = publicVehicleRecordsCopy[locale];
      expect(html).toContain(`data-public-vehicle-detail="${vehicle.id}"`);
      expect(html).not.toContain('data-public-export-status');
      expect(html).not.toContain(copy.exportStatus);
      expect(html).not.toContain(copy.exportStatuses[exportStatus]);
      expect(vehicle.exportStatus).toBe(exportStatus);
    }
  });
});

describe('public inquiry, VIN and inspection terms', () => {
  it.each(['zh', 'en', 'ru'] as const)('renders safe listing identity and the customer inspection fee in %s', locale => {
    const vehicle = makeImportedPublicVehicleFixture(locale);
    vehicle.identifiers = { sourceId: '12345', source: 'che168', inquiryCode: 'che168-12345', vin: 'LHGCM82633A004352' };
    const html = renderToStaticMarkup(createElement(PublicVehicleDetail, { vehicle: publicSourcePrivacy(vehicle), locale }));
    expect(html).toContain('HDX-0000000000000001');
    expect(html).toContain('LHGCM82633A004352');
    expect(html).toContain({ zh: '60 美元', en: 'USD 60', ru: '60 долларов США' }[locale]);
    expect(html).not.toMatch(/che168|12345|data-availability="available"/i);
    expect(html).toContain(encodeURIComponent(vehicle.detailPath));
  });
});
