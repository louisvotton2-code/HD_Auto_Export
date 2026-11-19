export const trimHttpWhitespace = (value: string): string => value.replace(/^[\t ]+|[\t ]+$/g, '');

export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  const value = header === undefined ? undefined : trimHttpWhitespace(header);
  if (!value) return false;
  if (value === '*') return true;
  const expected = etag.replace(/^W\//, '');
  // Entity tags can contain commas, and a GET compares opaque tags weakly.
  const token = /[\t ]*(?:(?:W\/)?"([\x21\x23-\x7e\x80-\xff]*)"[\t ]*(?:,|$)|,)/y;
  let matched = false;
  while (token.lastIndex < value.length) {
    const part = token.exec(value);
    if (!part) return false;
    if (part[1] !== undefined && `"${part[1]}"` === expected) matched = true;
  }
  return matched;
}
