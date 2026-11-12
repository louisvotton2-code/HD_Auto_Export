import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeConfigurationDisplayFixture, makePublicationPreviewFixture } from '@hd/contracts/fixtures';
import { PreviewReadError, readPublicationPreview, validatePreviewScope } from './read-preview';
import { parsePreviewFrameScope } from './scope';

const vehicleId = '00000000-0000-4000-8000-000000000001';
const loadId = '00000000-0000-4000-8000-000000000099';
const scope = { vehicleId, loadId, locale: 'en' as const };

afterEach(() => vi.unstubAllGlobals());

describe('private preview scope', () => {
  it.each(['name', 'value'] as const)('validates configuration %s scope while retaining actual language and units', (field) => {
    const preview = makePublicationPreviewFixture('en');
    preview.vehicle.configuration = makeConfigurationDisplayFixture('en');
    preview.vehicle.configuration.items[0][field].contentLocale = 'zh';
    expect(validatePreviewScope(preview, scope)).toBe(preview);
    preview.vehicle.configuration.items[0][field].requestedLocale = 'ru';
    expect(() => validatePreviewScope(preview, scope)).toThrow('invalid_response');
  });
  it('uses the shared frame contract and only defaults a missing locale', () => {
    expect(parsePreviewFrameScope(vehicleId, undefined, loadId)).toEqual({ vehicleId, loadId, locale: 'zh' });
    for (const locale of ['', 'fr', ['en']]) expect(parsePreviewFrameScope(vehicleId, locale, loadId)).toBeNull();
    expect(parsePreviewFrameScope(vehicleId, 'en', 'invalid')).toBeNull();
    expect(parsePreviewFrameScope('../another-vehicle', 'en', loadId)).toBeNull();
  });

  it('rejects another vehicle or requested language while preserving an actual language fallback', () => {
    const preview = makePublicationPreviewFixture('en');
    expect(validatePreviewScope(preview, scope)).toBe(preview);
    expect(() => validatePreviewScope(preview, { ...scope, vehicleId: 'another' })).toThrow('invalid_response');
    expect(() => validatePreviewScope(preview, { ...scope, locale: 'ru' })).toThrow('invalid_response');
    preview.vehicle.content.title.contentLocale = 'zh';
    preview.vehicle.content.title.reviewStatus = 'pending';
    expect(validatePreviewScope(preview, scope)).toBe(preview);
    preview.vehicle.content.description.requestedLocale = 'ru';
    expect(() => validatePreviewScope(preview, scope)).toThrow('invalid_response');
  });
});

describe('authorized draft preview reads', () => {
  it('rejects a private original report URL mixed into the preview existence fact', async () => {
    const preview = makePublicationPreviewFixture('en');
    const data = { ...preview, vehicle: { ...preview.vehicle, report: { hasReport: true, url: 'https://reports.example.invalid/private' } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data, meta: { requestId: 'private-report' } }), { headers: { 'content-type': 'application/json' } })));
    await expect(readPublicationPreview(scope, new AbortController().signal)).rejects.toEqual(new PreviewReadError('invalid_response'));
  });
  it('fetches the dedicated endpoint with the employee session and no cache', async () => {
    const data = makePublicationPreviewFixture('en', 'incomplete');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data, meta: { requestId: 'private-preview-fixture' } }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    expect(await readPublicationPreview(scope, new AbortController().signal)).toEqual(data);
    expect(fetcher).toHaveBeenCalledWith(`/api/v1/admin/vehicles/${vehicleId}/publication-preview?locale=en`, expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' }));
  });

  it.each([[401, 'unauthenticated'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [503, 'unavailable']] as const)('maps HTTP %s to a safe error without forwarding server details', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('internal-fixture-sentinel', { status })));
    await expect(readPublicationPreview(scope, new AbortController().signal)).rejects.toEqual(new PreviewReadError(code));
  });

  it('rejects extra private data and invalid JSON instead of rendering a partial response', async () => {
    const data = { ...makePublicationPreviewFixture('en'), internal: { notes: 'private-fixture-sentinel' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data, meta: { requestId: 'fixture' } }), { headers: { 'content-type': 'application/json' } })));
    await expect(readPublicationPreview(scope, new AbortController().signal)).rejects.toEqual(new PreviewReadError('invalid_response'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{', { headers: { 'content-type': 'application/json' } })));
    await expect(readPublicationPreview(scope, new AbortController().signal)).rejects.toEqual(new PreviewReadError('invalid_response'));
  });
});
