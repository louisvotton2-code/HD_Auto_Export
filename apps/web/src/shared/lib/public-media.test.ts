import { describe, expect, it } from 'vitest';
import { publicMediaUrl, publicMediaVariantUrl } from './public-media';
describe('same-origin public media paths', () => {
  it('avoids a redirect for originals and the fixed thumbnail', () => {
    expect(publicMediaUrl('/api/v1/media/photo')).toBe('/api/v1/media/photo/');
    expect(publicMediaUrl('/api/v1/media/photo/', { thumbnail: true })).toBe(
      '/api/v1/media/photo/?variant=thumb',
    );
    expect(publicMediaUrl('/api/v1/media/photo?variant=thumb')).toBe(
      '/api/v1/media/photo/?variant=thumb',
    );
  });
  it('does not rewrite external URLs or invent an unsupported variant', () => {
    for (const url of [
      'https://images.example/photo.jpg',
      '/api/v1/media/photo?width=999',
      '/other/photo',
    ])
      expect(publicMediaUrl(url, { thumbnail: true })).toBe(url);
  });

  it('derives fixed representations only from a relative local original', () => {
    expect(publicMediaVariantUrl('/api/v1/media/photo', 'thumb')).toBe('/api/v1/media/photo/?variant=thumb');
    expect(publicMediaVariantUrl('/api/v1/media/photo/', 'card')).toBe('/api/v1/media/photo/?variant=card');
    for (const url of [
      'https://images.example/api/v1/media/photo',
      '//images.example/api/v1/media/photo',
      '/api/v1/media/photo/?signature=opaque',
      '/api/v1/media/photo/?variant=thumb',
      '/api/v1/media/photo/other',
    ]) expect(publicMediaVariantUrl(url, 'card')).toBeNull();
  });
});
