export const externalInquiryCode = (number: string) => `HX${number}`;

export { externalInquiryNumber } from '@hd/contracts/public';

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
