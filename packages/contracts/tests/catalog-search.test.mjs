import assert from 'node:assert/strict';
import test from 'node:test';
import { CATALOG_SEARCH_TERM_TOO_SHORT, publicCatalogSearchIssue } from '../dist/public.js';

test('only unscoped nonempty English and Russian short terms are rejected', () => {
  for (const locale of ['en', 'ru']) {
    for (const q of ['  EV ', 'БМ', 'Ａ１', 'A-12', '🚘', 'A\u0301B']) {
      assert.equal(publicCatalogSearchIssue({ locale, q }), CATALOG_SEARCH_TERM_TOO_SHORT, q);
    }
    for (const q of ['', '  ', 'RAV4', '汉字１', '🚘А１B', 'HX1', 'HD-000001']) {
      assert.equal(publicCatalogSearchIssue({ locale, q }), undefined, q);
    }
    assert.equal(publicCatalogSearchIssue({ locale, q: 'EV', make: 'toyota' }), undefined);
    assert.equal(publicCatalogSearchIssue({ locale, q: 'EV', model: 'rav4' }), undefined);
    assert.equal(publicCatalogSearchIssue({ locale, q: 'EV', make: 'not an id', model: '' }), CATALOG_SEARCH_TERM_TOO_SHORT);
  }
  assert.equal(publicCatalogSearchIssue({ locale: 'zh', q: '海狮' }), undefined);
  assert.equal(publicCatalogSearchIssue({ locale: 'en' }), undefined);
});
