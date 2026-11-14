import { describe, expect, it } from 'vitest';
import { createDefaultInput } from './defaults';
import { estimateJanuaryManufacture } from './january-estimates';

describe('January manufacture estimates', () => {
  it('uses all seven January scenarios and keeps the actual manufacture field empty', () => {
    const input = createDefaultInput('RU', '2026-11-15');
    const rows = estimateJanuaryManufacture(input, 2026);
    expect(rows.map(row => row.manufactureDate)).toEqual([
      '2026-01', '2025-01', '2024-01', '2023-01', '2022-01', '2021-01', '2020-01',
    ]);
    expect(rows.every(row => row.result.status === 'reference')).toBe(true);
    expect(rows[5]?.result.total).toBe('926952');
    expect(new Set(rows.map(row => row.result.total)).size).toBeGreaterThan(1);
    expect(input.manufactureDate).toBe('');
  });

  it('keeps unavailable scenarios separate from actual fees', () => {
    const rows = estimateJanuaryManufacture({ ...createDefaultInput('RU', '2026-11-15'), price: '' }, 2026);
    expect(rows.every(row => row.result.status === 'incomplete' && row.result.total === null)).toBe(true);
    const past = estimateJanuaryManufacture(createDefaultInput('RU', '2026-11-15'), 2027);
    expect(past[0]?.result).toMatchObject({ status: 'invalid', total: null });
    expect(past[1]?.result.status).toBe('reference');
  });
});
