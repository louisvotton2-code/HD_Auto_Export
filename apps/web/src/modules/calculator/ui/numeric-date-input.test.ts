import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NumericDateInput } from './numeric-date-input';

describe('numeric date dropdown rendering', () => {
  it.each(['zh', 'en', 'ru'] as const)('renders actual year/month/day selects with a valid leap day in %s', locale => {
    const html = renderToStaticMarkup(createElement(NumericDateInput, {
      id: 'clearance', name: 'customsDate', value: '2024-02-29', precision: 'date',
      label: 'Clearance', locale, referenceYear: 2026, onChange: () => {},
    }));
    expect(html.match(/<select /g)).toHaveLength(3);
    expect(html).not.toContain('type="text"');
    expect(html).toContain('type="hidden" name="customsDate" value="2024-02-29"');
    const days = html.match(/<select[^>]*id="clearance-day"[^>]*>(.*?)<\/select>/s)?.[1];
    expect(days).toContain('value="29" selected=""');
    expect(days).not.toContain('value="30"');
  });
  it.each(['1700', '0001', '9999'])('preserves a legitimate saved year %s outside the common choices', year => {
    const html = renderToStaticMarkup(createElement(NumericDateInput, {
      id: 'manufacture', name: 'manufactureDate', value: `${year}-02`, precision: 'month',
      label: 'Manufacture', locale: 'en', referenceYear: 2026, onChange: () => {},
    }));
    const years = html.match(/<select[^>]*id="manufacture-year"[^>]*>(.*?)<\/select>/s)?.[1] ?? '';
    expect(years).toContain(`value="${year}" selected=""`);
    expect(years.match(/<option /g)!.length).toBeLessThanOrEqual(302);
    expect(years).not.toContain('value="0000"');
    expect(html).toContain(`value="${year}-02"`);
  });
});
