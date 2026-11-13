import { describe, expect, it } from 'vitest';
import { formatActivityValue } from './activity-value';

describe('activity value display', () => {
  it('distinguishes absent evidence, an explicit null and an empty string', () => {
    expect(formatActivityValue(null, false)).toBe('未记录');
    expect(formatActivityValue(undefined)).toBe('未记录');
    expect(formatActivityValue(null)).toBe('null（空值）');
    expect(formatActivityValue('')).toBe('""（空字符串）');
  });

  it('retains value types and exact monetary or identifier strings', () => {
    expect(formatActivityValue(0)).toBe('0');
    expect(formatActivityValue('0')).toBe('"0"');
    expect(formatActivityValue(false)).toBe('false');
    expect(formatActivityValue('false')).toBe('"false"');
    expect(formatActivityValue('0001989.00 cc')).toBe('"0001989.00 cc"');
  });

  it('preserves full values and stable image identifiers for display', () => {
    const value = { media: ['image-a', 'image-b'], text: '长内容'.repeat(1000) };
    expect(JSON.parse(formatActivityValue(value))).toEqual(value);
    expect(formatActivityValue('<script>example</script>')).toBe('"<script>example</script>"');
  });

  it('does not turn unsupported values into a fabricated null', () => {
    expect(formatActivityValue(Number.NaN)).toBe('无法展示的值');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatActivityValue(circular)).toBe('无法展示的值');
  });
});
