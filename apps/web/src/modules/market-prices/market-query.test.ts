import { describe, expect, it } from 'vitest';
import { changeMarketFilter, marketPriceEndpoint, marketSearchParams, parseMarketPriceQuery, readMarketDraft, validateMarketDraft } from './market-query';

const draft = (query: string) => readMarketDraft(new URLSearchParams(query));

describe('market price filters', () => {
  it('requires a make and model and accepts an inclusive optional range', () => {
    expect(validateMarketDraft(draft('make=toyota'))).toBe('required');
    expect(validateMarketDraft(draft('make=toyota&model=rav4&yearMin=2022&yearMax=2022&mileageMin=0'))).toBeNull();
    expect(validateMarketDraft(draft('make=toyota&model=rav4&yearMin=2024&yearMax=2021'))).toBe('range');
    expect(validateMarketDraft(draft('make=toyota&model=rav4&mileageMin=100&mileageMax=0'))).toBe('range');
    expect(validateMarketDraft(draft('make=toyota&model=rav4&mileageMin=1.5'))).toBe('invalid');
  });

  it('keeps only filters in a shared URL and adds the current locale to the request', () => {
    const query = marketSearchParams(draft('utm_source=ad&powertrain=hev&model=rav4&make=toyota&mileageMin=0'));
    expect(query.toString()).toBe('make=toyota&model=rav4&mileageMin=0&powertrain=hev');
    expect(marketPriceEndpoint('en', query.toString())).toBe('/api/v1/public/market-prices?make=toyota&model=rav4&mileageMin=0&powertrain=hev&locale=en');
    expect(parseMarketPriceQuery(new URLSearchParams('make=toyota&make=lexus&model=rav4'))).toBeNull();
    expect(parseMarketPriceQuery(new URLSearchParams('make=toyota&model=rav4&extra=1'))).toBeNull();
  });

  it('clears dependent choices while preserving unrelated filters', () => {
    const form = draft('make=toyota&model=rav4&trim=limited&yearMin=2022');
    expect(changeMarketFilter(form, 'make', 'lexus')).toMatchObject({ make: 'lexus', model: '', trim: '', yearMin: '2022' });
    expect(changeMarketFilter(form, 'model', 'corolla')).toMatchObject({ make: 'toyota', model: 'corolla', trim: '', yearMin: '2022' });
    expect(changeMarketFilter(form, 'make', 'toyota')).toBe(form);
  });
});
