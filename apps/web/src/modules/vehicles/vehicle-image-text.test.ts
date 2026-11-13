import { describe, expect, it } from 'vitest';
import type { DisplayText } from '@hd/contracts/public';
import { imageAltAttributes, withImageAltText } from './vehicle-image-text';

const source: DisplayText = { status: 'ready', text: '原图说明', requestedLocale: 'en', contentLocale: 'zh', provenance: 'supplier', reviewed: false };
const legacy: DisplayText = { status: 'ready', text: 'Reviewed old description', requestedLocale: 'en', contentLocale: 'en', provenance: 'human', reviewed: true };

describe('image text metadata compatibility', () => {
  it('uses per-image original language and review facts before the legacy display map', () => {
    const image = { id: 'image-31', altText: source };
    expect(withImageAltText(image, [{ mediaId: image.id, value: legacy }])).toBe(image);
    expect(imageAltAttributes(image, 'Old raw alt')).toMatchObject({ alt: '原图说明', lang: 'zh', 'data-provenance': 'supplier', 'data-reviewed': false });
  });
  it('does not replace an explicit missing field with old approved text', () => {
    const missing: DisplayText = { status: 'missing', text: null, requestedLocale: 'en', contentLocale: null, provenance: null, reviewed: false };
    const image = withImageAltText({ id: 'image', altText: missing }, [{ mediaId: 'image', value: legacy }]);
    expect(image.altText).toBe(missing);
    expect(imageAltAttributes(image, 'Vehicle')).toEqual({ alt: 'Vehicle', lang: undefined, 'data-alt-status': 'missing', 'data-provenance': undefined, 'data-reviewed': false });
  });
  it('uses matching legacy metadata unchanged when the item lacks it', () => {
    const image = withImageAltText({ id: 'image' }, [{ mediaId: 'another', value: source }, { mediaId: 'image', value: legacy }]);
    expect(imageAltAttributes(image, 'Raw alt')).toMatchObject({ alt: legacy.text, lang: 'en', 'data-reviewed': true });
  });
  it('does not infer language or human review for old strings without metadata', () => {
    expect(imageAltAttributes(withImageAltText({ id: 'image' }), 'Raw alt')).toEqual({ alt: 'Raw alt', lang: undefined, 'data-alt-status': undefined, 'data-provenance': undefined, 'data-reviewed': undefined });
  });
  it('retains empty alt text for deliberately decorative pictures', () => {
    expect(imageAltAttributes({ altText: source }, '').alt).toBe('');
  });
});
