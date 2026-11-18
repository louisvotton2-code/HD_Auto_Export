import { PublicEnglishVehicleTitleSchema, type DisplayText, type PublicEnglishVehicleTitle, type VehicleDisplay } from '@hd/contracts/public';
import { isPublicText } from '../external/normalize.js';

const english = /^en(?:-|$)/i;
const privateSource = /dongchedi|che1688?|懂车帝|车168/i;
const nonEnglishScript = /[\p{Script=Han}\p{Script=Cyrillic}]/u;
const placeholder = /^(?:[-–—]|awaiting translation|external listing|vehicle details)$/i;

function isUsable(text: string) {
  const normalized = text.normalize('NFKC').trim();
  return !privateSource.test(normalized) && !nonEnglishScript.test(normalized) &&
    !placeholder.test(normalized) && isPublicText(text);
}

export function explicitEnglishDetailTitle(value: unknown, allowReviewed = false): PublicEnglishVehicleTitle | undefined {
  const parsed = PublicEnglishVehicleTitleSchema.safeParse(value);
  if (parsed.success && parsed.data.kind !== 'catalog' && (allowReviewed || !parsed.data.reviewed) && isUsable(parsed.data.text))
    return parsed.data;
}

type TitleDisplay = Partial<Pick<VehicleDisplay, 'make' | 'model' | 'trim'>>;

function verifiedName(field?: DisplayText) {
  return field?.status === 'ready' && english.test(field.contentLocale) && isUsable(field.text) ? field.text.trim() : '';
}

export function englishCatalogTitle(display: TitleDisplay | undefined, year: number | null): PublicEnglishVehicleTitle | undefined {
  const model = verifiedName(display?.model);
  if (!model) return undefined;
  const make = verifiedName(display?.make);
  const identity = make && model !== make && !model.startsWith(`${make} `) ? `${make} ${model}` : model;
  const variant = verifiedName(display?.trim);
  const trim = variant !== model && variant !== identity ? variant : '';
  const modelYear = year !== null && !trim.includes(String(year)) ? String(year) : '';
  return { text: [identity, modelYear, trim].filter(Boolean).join(' '), requestedLocale: 'en', contentLocale: 'en', kind: 'catalog', reviewed: false };
}
