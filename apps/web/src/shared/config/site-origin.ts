/** Normalize the public origin and reject deployment values that would corrupt SEO URLs. */
export function resolveSiteOrigin(value: string | undefined, indexable: boolean): string {
  const configured = value?.trim();
  const origin = new URL(configured || 'http://localhost:3000');
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error(
      'NEXT_PUBLIC_SITE_URL must be an http(s) origin without a path, credentials, query or fragment.',
    );
  if (indexable && (!configured || ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))
    throw new Error(
      'SITE_INDEXABLE=true requires the real public NEXT_PUBLIC_SITE_URL before building.',
    );
  return origin.origin;
}
