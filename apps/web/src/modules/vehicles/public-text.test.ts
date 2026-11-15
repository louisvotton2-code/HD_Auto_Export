import { describe, expect, it } from 'vitest';
import { publicVehicleReference } from '@/shared/lib/public-vehicle-reference';
import { clearPrivateVehicleText } from './public-text';

describe('public display privacy', () => {
  it('keeps current customer references and discards source-derived numbers', () => {
    const legacy = { sourceId: '357217151', source: 'dongchedi', inquiryCode: 'DCD-357217151', vin: null };
    expect(publicVehicleReference({ identifiers: legacy, stockCode: 'HD-000003' }).code).toBe('HD-000003');
    expect(publicVehicleReference({ identifiers: legacy, stockCode: 'EXT-000003' }).code).toBe('—');
    expect(publicVehicleReference({ identifiers: { ...legacy, inquiryCode: 'HX100001' }, stockCode: 'EXT-000003' }).code).toBe('HX100001');
  });

  it('removes branded labels and source URLs without changing IDs, dates, or media delivery URLs', () => {
    const quote = {
      id: 'che168-car',
      alt: 'BYD 懂车帝',
      url: 'https://images.example.invalid/asset',
      date: '2026-11',
      original: { text: 'BYD https://www.che168.com/listing.html', contentLocale: 'en' },
      configuration: [{ name: { text: '懂车帝' }, value: { text: '162 kW' } }],
      make: { id: 'BYD', name: 'Dongchedi BYD' },
    };
    expect(clearPrivateVehicleText(quote)).toEqual({
      ...quote,
      alt: 'BYD',
      original: { text: 'BYD', contentLocale: 'en' },
      configuration: [{ name: { text: '—' }, value: { text: '162 kW' } }],
      make: { id: 'BYD', name: 'BYD' },
    });
    expect(quote.alt).toBe('BYD 懂车帝');
  });
});
