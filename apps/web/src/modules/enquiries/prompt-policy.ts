export const enquiryDelayMs = 30_000;
export const enquiryCooldownMs = 7 * 24 * 60 * 60 * 1000;
export const enquirySeenKey = 'hd-auto:enquiry-seen:v1';

export function enquirySeenRecently(stored: string | null, now: number): boolean {
  if (!stored || !/^\d+$/.test(stored)) return false;
  const shownAt = Number(stored);
  return Number.isSafeInteger(shownAt) && shownAt <= now && now - shownAt < enquiryCooldownMs;
}
