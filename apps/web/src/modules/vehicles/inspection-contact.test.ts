import { describe, expect, it } from 'vitest';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { buildPublicVehicleContactLinks } from '@/shared/lib/vehicle-contact';
import { externalDetailCopy } from './external-detail-copy';
import { buildVehicleInspectionContactLinks } from './inspection-contact';

describe('vehicle inspection report contact drafts', () => {
  it.each(['zh', 'en', 'ru'] as const)('preserves the %s vehicle, account and report request', (locale) => {
    const vehicle = makePublicVehicleFixture();
    vehicle.detailPath = `/${locale}/cars/${vehicle.id}/`;
    vehicle.stockCode = 'HD-REPORT-&-01';
    const ordinary = buildPublicVehicleContactLinks(vehicle, locale);
    const report = buildVehicleInspectionContactLinks(vehicle, locale);
    expect(report.message).toBe(`${externalDetailCopy[locale].requestReportMessage}\n\n${ordinary.message}`);
    expect(report.message).toContain(vehicle.stockCode);
    expect(report.message).toContain(vehicle.detailPath);
    for (const platform of ['telegram', 'whatsapp'] as const) {
      const link = new URL(report[platform]);
      const target = new URL(ordinary[platform]);
      expect(link.origin + link.pathname).toBe(target.origin + target.pathname);
      expect(link.searchParams.get('text')).toBe(report.message);
    }
  });

  it('rejects a different vehicle detail URL through the shared identity check', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.detailPath = '/en/cars/a-different-vehicle/';
    expect(() => buildVehicleInspectionContactLinks(vehicle, 'en')).toThrow('stable ID');
  });
});
