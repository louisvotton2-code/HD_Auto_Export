import { describe, expect, it } from 'vitest';
import { uploadRightsForFiles } from './media-source';
import type { ExternalVehicleSource } from '@hd/contracts/admin';

const source: ExternalVehicleSource = { kind: 'external', platform: { id: 'test-market', name: 'Test Market' }, listingUrl: 'https://example.invalid/listings/001', externalId: '001', collectedAt: '2026-11-08T08:00:00Z', sourceUpdatedAt: null };
describe('per-file source declarations', () => {
  it('binds eight independent source URLs to the selected file order', () => {
    const urls = Array.from({ length: 8 }, (_, i) => `https://example.invalid/images/${i}.jpg`);
    const result = uploadRightsForFiles(source, 8, 'unverified', '本地核对，许可待核验', urls.join('\n'), '2026-11-08T09:30');
    expect(result.map(item => item.source?.imageUrl)).toEqual(urls);
    expect(result.every(item => item.source?.listingUrl === source.listingUrl && item.source.collectedAt === '2026-11-08T09:30:00.000Z')).toBe(true);
  });
  it('rejects a missing file source and credential-bearing URLs', () => {
    expect(() => uploadRightsForFiles(source, 2, 'unverified', '待核验', 'https://example.invalid/one.jpg', '2026-11-08T09:30')).toThrow('2 个原图地址');
    expect(() => uploadRightsForFiles(source, 1, 'unverified', '待核验', 'https://user:secret@example.invalid/a.jpg', '2026-11-08T09:30')).toThrow('账号密码');
  });
  it('keeps manual rights without invented external provenance', () => {
    expect(uploadRightsForFiles({ kind: 'manual' }, 1, 'owned', '公司拍摄', '', '')).toEqual([{ basis: 'owned', note: '公司拍摄' }]);
    expect(() => uploadRightsForFiles({ kind: 'demo' }, 1, 'unverified', '待核验', '', '')).toThrow('已授权');
  });
});
