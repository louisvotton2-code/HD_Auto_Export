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

  it('keeps the backend content version in originals and both derivative paths', () => {
    const id = '01020304-0000-4000-8000-000000000001';
    const first = `/api/v1/media/${id}_xWkMVURnBu_xeQ6SmNYHDzv7OfI0fHeMgW_Gkwwl4lg`;
    const next = `/api/v1/media/${id}_dnOAAPMYdBkSHmuFYdtg93IhS48olBlWypfqZxzyWGg`;
    for (const original of [first, next]) {
      expect(publicMediaUrl(original)).toBe(`${original}/`);
      expect(publicMediaUrl(original, { thumbnail: true })).toBe(`${original}/?variant=thumb`);
      expect(publicMediaVariantUrl(original, 'thumb')).toBe(`${original}/?variant=thumb`);
      expect(publicMediaVariantUrl(original, 'card')).toBe(`${original}/?variant=card`);
      expect(publicMediaVariantUrl(`${original}/?variant=card`, 'thumb')).toBeNull();
    }
  });
});
