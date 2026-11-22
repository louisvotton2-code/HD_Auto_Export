const localOriginal = /^(\/api\/v1\/media\/[A-Za-z0-9][A-Za-z0-9_-]{0,99})\/?$/;

/** Keep the entire API-issued identifier, including an optional content version, for each rendition. */
export function publicMediaVariantUrl(raw: string, variant: 'thumb' | 'card'): string | null {
  const match = localOriginal.exec(raw);
  return match ? `${match[1]}/?variant=${variant}` : null;
}

/** Normalize local media and its existing thumbnail callers. */
export function publicMediaUrl(raw: string, options: { thumbnail?: boolean } = {}): string {
  const match = /^(\/api\/v1\/media\/[A-Za-z0-9][A-Za-z0-9_-]{0,99})\/?(?:\?variant=thumb)?$/.exec(
    raw,
  );
  if (!match) return raw;
  return `${match[1]}/${options.thumbnail || raw.includes('?variant=thumb') ? '?variant=thumb' : ''}`;
}
