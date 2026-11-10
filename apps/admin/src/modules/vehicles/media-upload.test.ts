import { describe, expect, it, vi } from 'vitest';
import type { MediaAsset } from '@hd/contracts/admin';
import { appendReadyMedia, finishMediaUpload, normalizeMedia, recycleMediaAsset, validateMediaFile, type MediaTransport } from './media-upload';

function media(status: MediaAsset['status'] = 'pending', version = 1): MediaAsset {
  return { id: 'test-media', vehicleId: 'test-vehicle', version, status, contentType: 'image/png', rights: { basis: 'owned', note: 'Synthetic test image' }, sizeBytes: 3, width: status === 'pending' ? null : 20, height: status === 'pending' ? null : 20, previewPath: status === 'ready' ? '/api/v1/admin/media/test-media/preview' : null, createdAt: '2026-11-08T00:00:00Z' };
}
function transport(): MediaTransport {
  return { get: vi.fn().mockResolvedValue(media('pending')), upload: vi.fn().mockResolvedValue(media('uploaded', 2)), complete: vi.fn().mockResolvedValue(media('ready', 3)) };
}

describe('vehicle media edits and upload recovery', () => {
  it('rejects unsupported and excessive uploads while accepting the exact size limit', () => {
    expect(validateMediaFile({ name: 'photo.png', type: 'image/png', size: 10 * 1024 * 1024 })).toBeNull();
    expect(validateMediaFile({ name: 'photo.png', type: 'image/png', size: 10 * 1024 * 1024 + 1 })).toContain('10 MiB');
    expect(validateMediaFile({ name: 'photo.gif', type: 'image/gif', size: 4 })).toContain('JPEG');
    expect(validateMediaFile({ name: 'photo.png', type: 'image/png', size: 0 })).toContain('空文件');
  });
  it('only attaches ready media, deduplicates retries, and preserves the chosen cover', () => {
    expect(() => appendReadyMedia([], media('uploaded'))).toThrow('尚未处理完成');
    const first = appendReadyMedia([], media('ready'), 'front view');
    expect(first[0]).toMatchObject({ isCover: true, sortOrder: 0, alt: 'front view' });
    expect(appendReadyMedia(first, media('ready'))).toEqual(first);
    const next = appendReadyMedia(first, { ...media('ready'), id: 'second-media' });
    expect(next[1]).toMatchObject({ isCover: false, sortOrder: 1 });
    expect(normalizeMedia([next[1], next[0]])).toEqual([{ ...next[1], sortOrder: 0 }, { ...next[0], sortOrder: 1 }]);
  });
  it('uses each new server version through upload and complete', async () => {
    const api = transport();
    const file = new Blob(['png']);
    const ready = await finishMediaUpload(media(), file, false, api);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.upload).toHaveBeenCalledWith(media(), file, 'image/png');
    expect(api.complete).toHaveBeenCalledWith(media('uploaded', 2));
    expect(ready.version).toBe(3);
  });
  it('after a lost upload response reads current state and completes without uploading again', async () => {
    const api = transport();
    vi.mocked(api.get).mockResolvedValue(media('uploaded', 7));
    await finishMediaUpload(media(), new Blob(['png']), true, api);
    expect(api.get).toHaveBeenCalledWith('test-media');
    expect(api.upload).not.toHaveBeenCalled();
    expect(api.complete).toHaveBeenCalledWith(media('uploaded', 7));
  });
  it('after a lost complete response reads ready state and does not repeat either write', async () => {
    const api = transport();
    vi.mocked(api.get).mockResolvedValue(media('ready', 8));
    const ready = await finishMediaUpload(media('uploaded', 2), new Blob(['png']), true, api);
    expect(ready.version).toBe(8);
    expect(api.upload).not.toHaveBeenCalled();
    expect(api.complete).not.toHaveBeenCalled();
  });
  it('refuses another vehicle or a terminal media record before writing', async () => {
    const api = transport();
    vi.mocked(api.get).mockResolvedValue({ ...media(), vehicleId: 'other-vehicle' });
    await expect(finishMediaUpload(media(), new Blob(['png']), true, api)).rejects.toThrow('不一致');
    expect(api.upload).not.toHaveBeenCalled();
    vi.mocked(api.get).mockResolvedValue(media('failed'));
    await expect(finishMediaUpload(media(), new Blob(['png']), true, api)).rejects.toThrow('无法继续上传');
    expect(api.complete).not.toHaveBeenCalled();
  });
  it('recycles only after both local and saved draft references have been removed', async () => {
    const api = { get: vi.fn().mockResolvedValue(media('ready', 9)), remove: vi.fn().mockResolvedValue(undefined) };
    await expect(recycleMediaAsset('test-media', 'test-vehicle', ['test-media'], [], api)).rejects.toThrow('当前草稿');
    await expect(recycleMediaAsset('test-media', 'test-vehicle', [], ['test-media'], api)).rejects.toThrow('保存草稿');
    expect(api.get).not.toHaveBeenCalled();
    await recycleMediaAsset('test-media', 'test-vehicle', [], [], api);
    expect(api.remove).toHaveBeenCalledWith(media('ready', 9));
  });
  it('confirms a prior lost delete response without issuing another delete', async () => {
    const api = { get: vi.fn().mockResolvedValue(null), remove: vi.fn() };
    await recycleMediaAsset('test-media', 'test-vehicle', [], [], api);
    expect(api.remove).not.toHaveBeenCalled();
  });
  it('preserves a server refusal to recycle protected historical media', async () => {
    const protectedHistory = new Error('MEDIA_IN_USE');
    const api = { get: vi.fn().mockResolvedValue(media('ready')), remove: vi.fn().mockRejectedValue(protectedHistory) };
    await expect(recycleMediaAsset('test-media', 'test-vehicle', [], [], api)).rejects.toBe(protectedHistory);
  });
});
