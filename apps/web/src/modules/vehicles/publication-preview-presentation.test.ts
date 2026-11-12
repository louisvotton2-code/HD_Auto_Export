import { describe, expect, it } from 'vitest';
import { makePublicationPreviewFixture } from '@hd/contracts/fixtures';
import { publicationPreviewImages, publicationPreviewPrice } from './publication-preview-presentation';

describe('publication preview presentation', () => {
  it('keeps an incomplete amount distinct from both zero and on-request pricing', () => {
    const { price } = makePublicationPreviewFixture('en', 'incomplete').vehicle;
    expect(publicationPreviewPrice(price, 'en')).toEqual({
      original: 'Price not entered · CNY', approximation: null,
    });
    expect(publicationPreviewPrice({ ...price, money: null }, 'en')).toEqual({
      original: 'Price not entered', approximation: null,
    });
    const onRequest = { ...price, kind: 'on_request' as const, money: null,
      status: 'on_request' as const,
      displayPrice: { status: 'on_request' as const, money: null, conversion: null } };
    expect(publicationPreviewPrice(onRequest, 'en')).toEqual({
      original: 'Price on request', approximation: null,
    });
  });

  it.each(['zh', 'en', 'ru'] as const)('retains a legal zero USD amount in %s', (locale) => {
    const { price } = makePublicationPreviewFixture(locale).vehicle;
    price.money = { amount: '0', currency: 'USD' };
    price.displayPrice = { status: 'ready', kind: 'asking', money: { amount: '0', currency: 'USD' }, conversion: null };
    expect(publicationPreviewPrice(price, locale)).toEqual({ original: '0 USD', approximation: null });
  });

  it('shares original-currency precision and half-up USD rounding with the public site', () => {
    const { price } = makePublicationPreviewFixture('en').vehicle;
    price.money = { amount: '99999999999999.99', currency: 'CNY' };
    price.displayPrice = { status: 'ready', kind: 'reference', money: { amount: '23500.50', currency: 'USD' },
      conversion: { asOf: '2026-11-12T00:00:00Z', source: 'synthetic' } };
    expect(publicationPreviewPrice(price, 'en')).toEqual({
      original: '¥ 99,999,999,999,999.99', approximation: '≈ 23,501 USD',
    });
    price.displayPrice = { status: 'unavailable', money: null, conversion: null, reason: 'rate_unavailable' };
    expect(publicationPreviewPrice(price, 'en')).toEqual({
      original: '¥ 99,999,999,999,999.99', approximation: null,
    });
  });

  it('passes only ready private image URLs to the common gallery without changing the source', () => {
    const { images } = makePublicationPreviewFixture('en').vehicle;
    const ready = images[0]!;
    images.push({ ...ready, id: 'pending-photo', status: 'missing', url: ready.url });
    images.push({ ...ready, id: 'missing-url', url: null });
    const before = structuredClone(images);
    expect(publicationPreviewImages(images)).toEqual([{
      id: ready.id, url: ready.url, alt: '', sortOrder: 0, isCover: true, width: 800, height: 600,
    }]);
    expect(images).toEqual(before);
    expect(publicationPreviewImages([])).toEqual([]);
  });
});
