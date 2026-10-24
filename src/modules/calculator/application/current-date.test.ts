import { describe, expect, it } from 'vitest';
import { getClearanceDate } from './current-date';

describe('browser clearance-date adapter', () => {
  it('uses the visit date in Asia/Shanghai, independent of the build machine timezone', () => {
    expect(getClearanceDate(new Date('2026-10-24T15:59:59Z'))).toBe('2026-10-24');
    expect(getClearanceDate(new Date('2026-10-24T16:00:00Z'))).toBe('2026-10-25');
  });
  it('does not freeze at the build year across a year boundary', () => {
    expect(getClearanceDate(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
  });
});
