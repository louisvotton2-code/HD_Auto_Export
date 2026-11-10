import { describe, expect, it } from 'vitest';
import { publicMediaUrl } from './public-media';
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
});
