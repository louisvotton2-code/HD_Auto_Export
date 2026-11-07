import { describe, expect, it } from 'vitest';
import { getCountryByCode } from '../config/countries';
import { calculateImportEstimate } from '../core/calculate';
import { createDefaultInput } from './defaults';
import { normalizePageInput } from './page-input';

describe('country page importer scope', () => {
  it.each(['RU', 'KZ', 'UZ', 'GE', 'AM', 'AL'] as const)(
    '%s removes legacy company state when the reference page has no importer choice',
    (code) => {
      const input = { ...createDefaultInput(code, '2026-10-23'), importerType: 'company' as const };
      const country = getCountryByCode(code)!;
      expect(country.hasImporterChoice).toBe(false);
      expect(normalizePageInput(input, country).importerType).toBe('individual');
    },
  );

  it('keeps an explicit company choice on the same Kyrgyzstan page', () => {
    const input = {
      ...createDefaultInput('KG', '2026-10-23'),
      importerType: 'company' as const,
      freight: '1500',
      insurance: '120',
      transactionRate: '13.2',
    };
    const country = getCountryByCode('KG')!;
    expect(country.hasImporterChoice).toBe(true);
    expect(normalizePageInput(input, country)).toEqual(input);
  });

  it('does not carry a company choice from another country into Kyrgyzstan', () => {
    const input = { ...createDefaultInput('RU', '2026-10-23'), importerType: 'company' as const };
    expect(normalizePageInput(input, getCountryByCode('KG')!)).toMatchObject({
      country: 'KG',
      importerType: 'individual',
      price: input.price,
      currency: input.currency,
      customsDate: input.customsDate,
    });
    expect(input).toMatchObject({ country: 'RU', importerType: 'company' });
  });

  it('keeps company API input unsupported even when the page uses a fixed reference scope', () => {
    const company = {
      ...createDefaultInput('RU', '2026-10-23'),
      importerType: 'company' as const,
    };
    expect(
      calculateImportEstimate(normalizePageInput(company, getCountryByCode('RU')!)),
    ).toMatchObject({
      status: 'reference',
      total: '926952',
    });
    expect(calculateImportEstimate(company)).toMatchObject({
      status: 'needs_review',
      reason: 'company_rules_pending',
      total: null,
      lines: [],
    });
    expect(company.importerType).toBe('company');
  });
});
