const localOriginal = /^(\/api\/v1\/media\/[A-Za-z0-9][A-Za-z0-9_-]{0,99})\/?$/;

/** Derivatives are public representations of local originals, never of signed or remote URLs. */
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
