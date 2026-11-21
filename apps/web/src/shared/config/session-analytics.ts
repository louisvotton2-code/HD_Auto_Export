/** Runtime opt-in for public sites. The loopback acceptance and fixture sites can exercise consent by default. */
export function sessionAnalyticsEnabledForSite(origin: string, setting: string | undefined): boolean {
  if (setting !== undefined) return setting === 'true';
  return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
}
