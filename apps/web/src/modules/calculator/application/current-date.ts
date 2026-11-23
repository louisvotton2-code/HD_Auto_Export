/** Current-date selection belongs to the page adapter, never the tax core. */
export function shanghaiDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

const fortnightMs = 14 * 86400000;
export function getClearanceDate(now: Date): string {
  // Add civil days to the Shanghai date, independent of the browser's time zone.
  return new Date(Date.parse(shanghaiDate(now) + 'T00:00:00Z') + fortnightMs).toISOString().slice(0, 10);
}
export function visitYearForDefault(clearance: string): number {
  return new Date(Date.parse(clearance + 'T00:00:00Z') - fortnightMs).getUTCFullYear();
}
