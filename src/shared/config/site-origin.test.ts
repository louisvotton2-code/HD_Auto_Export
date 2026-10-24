import { describe, expect, it } from 'vitest';
import { resolveSiteOrigin } from './site-origin';

describe('public deployment origin', () => {
  it('keeps local preview usable and normalizes the public origin', () => {
    expect(resolveSiteOrigin(undefined, false)).toBe('http://localhost:3000');
    expect(resolveSiteOrigin(' https://auto.example.com/ ', true)).toBe('https://auto.example.com');
    expect(resolveSiteOrigin('http://192.0.2.10:3000', false)).toBe('http://192.0.2.10:3000');
  });
  it.each([
    'ftp://example.com',
    'https://example.com/path',
    'https://user:pass@example.com',
    'https://example.com?a=1',
    'https://example.com#part',
    'not-a-url',
  ])('rejects a malformed or non-origin value: %s', (value) => {
    expect(() => resolveSiteOrigin(value, false)).toThrow();
  });
  it.each([undefined, '', 'http://localhost:3000', 'http://127.0.0.1', 'http://[::1]'])(
    'prevents indexing a preview with origin %s',
    (value) => {
      expect(() => resolveSiteOrigin(value, true)).toThrow();
    },
  );
});
