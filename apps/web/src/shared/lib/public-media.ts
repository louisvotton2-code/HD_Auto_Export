/** Normalize local media only; the API supports one fixed thumbnail variant. */
export function publicMediaUrl(raw: string, options: { thumbnail?: boolean } = {}): string {
  const match = /^(\/api\/v1\/media\/[A-Za-z0-9][A-Za-z0-9_-]{0,99})\/?(?:\?variant=thumb)?$/.exec(
    raw,
  );
  if (!match) return raw;
  return `${match[1]}/${options.thumbnail || raw.includes('?variant=thumb') ? '?variant=thumb' : ''}`;
}
