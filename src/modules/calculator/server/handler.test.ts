import { describe, expect, it } from 'vitest';
import { handleCalculationRequest } from './handler';
import type { CalculationInput } from '../index';

const sample: CalculationInput = {
  country: 'RU',
  importerType: 'individual',
  powertrain: 'petrol',
  price: '25000',
  currency: 'USD',
  displacementCc: '1998',
  powerHp: '150',
  manufactureDate: '2021-01',
  customsDate: '2026-10-22',
  freight: '',
  insurance: '',
  steering: 'left',
  transactionRate: '81.969182',
  euroRate: '94.7',
};
const request = (input: unknown) =>
  new Request('https://example.com/calculations', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
  });

describe('optional backend adapter, outside the static site', () => {
  it('preserves independent RU and GE fixed amounts for future service callers', async () => {
    for (const [input, total, currency] of [
      [sample, '926952', 'RUB'],
      [
        { ...sample, country: 'GE', price: '', powerHp: '', transactionRate: '', euroRate: '' },
        '3605',
        'GEL',
      ],
    ] as const) {
      const response = await handleCalculationRequest(request(input));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: 'reference',
        total,
        currency,
        quality: 'reference_only',
      });
    }
  });
  it('keeps unsupported company rules distinct from missing or invalid facts', async () => {
    const company = await handleCalculationRequest(request({ ...sample, importerType: 'company' }));
    expect(company.status).toBe(200);
    expect(await company.json()).toMatchObject({
      status: 'needs_review',
      total: null,
      reason: 'company_rules_pending',
    });
    const missing = await handleCalculationRequest(request({ ...sample, price: '' }));
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ status: 'incomplete', total: null });
    const invalid = await handleCalculationRequest(
      request({ ...sample, customsDate: '2026-02-30' }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      status: 'invalid',
      total: null,
      fieldErrors: { customsDate: 'invalid_date' },
    });
  });
  it('rejects non-string fields before calling the pure calculator', async () => {
    const response = await handleCalculationRequest(request({ ...sample, price: 25000 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
  });
});
