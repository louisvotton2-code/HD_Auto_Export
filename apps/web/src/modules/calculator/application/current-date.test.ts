import { describe, expect, it } from 'vitest';
import { getClearanceDate } from './current-date';

describe('browser clearance-date adapter', () => {
  it('defaults to fourteen days after the visit date in Asia/Shanghai, independent of the build machine timezone', () => {
    expect(getClearanceDate(new Date('2026-10-24T15:59:59Z'))).toBe('2026-11-07');
    expect(getClearanceDate(new Date('2026-10-24T16:00:00Z'))).toBe('2026-11-08');
  });
  it('does not freeze at the build year across a year boundary', () => {
    expect(getClearanceDate(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-15');
  });
});
