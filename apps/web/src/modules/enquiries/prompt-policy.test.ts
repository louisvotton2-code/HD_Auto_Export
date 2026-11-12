import { describe, expect, it } from 'vitest';
import { enquiryCooldownMs, enquirySeenRecently } from './prompt-policy';

describe('enquiry repeat interval', () => {
  const now = 1_800_000_000_000;
  it('suppresses the prompt for seven days after a display', () => {
    expect(enquirySeenRecently(String(now), now)).toBe(true);
    expect(enquirySeenRecently(String(now - enquiryCooldownMs + 1), now)).toBe(true);
    expect(enquirySeenRecently(String(now - enquiryCooldownMs), now)).toBe(false);
  });
  it('allows the prompt when a stored preference is absent or corrupt', () => {
    for (const stored of [null, '', 'broken', '-1', 'Infinity', '1.5', String(now + 1)]) {
      expect(enquirySeenRecently(stored, now)).toBe(false);
    }
  });
});
