export const externalInquiryCode = (number: string) => `HX${number}`;

export function externalInquiryNumber(value: string): string | undefined {
  const number = /^HX([1-9][0-9]{0,18})$/i.exec(value)?.[1];
  if (number && (number.length < 19 || number <= '9223372036854775807')) return number;
}

// Previously issued codes remain usable in staff search. Bounds use the UUID index.
export function legacyInquiryBounds(value: string) {
  const match = /^HDX-([a-f0-9]{8})([a-f0-9]{4})([a-f0-9]{4})$/i.exec(value);
  if (!match) return null;
  const prefix = `${match[1]}-${match[2]}`;
  return {
    lower: `${prefix}-0000-0000-000000000000`,
    upper: `${prefix}-ffff-ffff-ffffffffffff`,
    suffix: match[3]!.toLowerCase(),
  };
}
