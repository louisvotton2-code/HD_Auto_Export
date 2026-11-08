/** Public API contract uses bounded delta-seconds, never arbitrary upstream header text. */
export function retryAfterSeconds(value: string | null | undefined): number {
  if (value && /^\d{1,6}$/.test(value)) {
    const seconds = Number(value);
    if (seconds <= 3600) return seconds;
  }
  return 60;
}
