/** Fastify emits a relative reset in seconds; absolute dates, epochs and oversized waits are rejected. */
export function rateLimitSeconds(value: string | undefined): number | null {
  if (value === undefined || !/^(?:[1-9]|[1-5][0-9]|60)$/.test(value.trim())) return null;
  return Number(value.trim());
}

export function extendRateDeadline(previous: number, headers: Record<string, string>, receivedAt: number): number {
  const reset = rateLimitSeconds(headers['x-ratelimit-reset']);
  const retry = rateLimitSeconds(headers['retry-after']);
  const seconds = Math.max(reset ?? 0, retry ?? 0);
  return seconds ? Math.max(previous, receivedAt + seconds * 1000) : previous;
}

/** Small rounding allowance, with a hard bound even if the local clock moves backwards. */
export function rateCooldownMs(deadline: number, now: number): number {
  const remaining = Math.max(0, Math.ceil(deadline - now));
  return remaining ? Math.min(61_000, remaining + 100) : 0;
}
