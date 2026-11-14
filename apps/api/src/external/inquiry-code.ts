/** Keep the inquiry reference separate from the permanent listing UUID. */
export function externalInquiryCode(uuid: string): string {
  const hex = uuid.replaceAll('-', '').toUpperCase();
  return `HDX-${hex.slice(0, 12)}${hex.slice(-4)}`;
}

/** Restrict lookup to the matching UUID prefix so PostgreSQL can use the existing index. */
export function externalInquiryBounds(value: string) {
  const match = /^HDX-([a-f0-9]{8})([a-f0-9]{4})([a-f0-9]{4})$/i.exec(value);
  if (!match) return null;
  const first = match[1]!.toLowerCase();
  const second = match[2]!.toLowerCase();
  const suffix = match[3]!.toLowerCase();
  const prefix = `${first}-${second}`;
  return {
    lower: `${prefix}-0000-0000-000000000000`,
    upper: `${prefix}-ffff-ffff-ffffffffffff`,
    suffix,
  };
}
