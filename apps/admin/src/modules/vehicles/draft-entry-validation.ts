import { LocationSchema, VehicleFactsSchema } from '@hd/contracts/admin';
import type { DraftForm } from './draft-form';

export function draftLocationIssues(form: DraftForm, primary: 'city' | 'locationName'): (keyof DraftForm)[] {
  const issues: (keyof DraftForm)[] = [];
  const country = form.country.trim().toUpperCase();
  const useCity = primary === 'city' || !form.locationName.trim() && !!form.city.trim();
  const text = (useCity ? form.city : form.locationName).trim();
  const schema = useCity ? LocationSchema.shape.city : LocationSchema.shape.displayName;
  if (!LocationSchema.shape.country.safeParse(country).success) issues.push('country');
  if (!schema.safeParse(text).success) issues.push(primary);
  return issues;
}

/** Only the first step gates new draft saves. The publication checklist still applies later. */
export function basicDraftIssues(form: DraftForm): (keyof DraftForm)[] {
  const issues: (keyof DraftForm)[] = [];
  if (!form.makeId || !form.makeName.trim()) issues.push('makeName');
  if (!form.modelId || !form.modelName.trim()) issues.push('modelName');
  if (!form.title.trim()) issues.push('title');
  if (!form.trimId || !form.trimName.trim()) issues.push('trimName');
  if (!/^\d{4}$/.test(form.modelYear.trim()) ||
      !VehicleFactsSchema.shape.modelYear.safeParse(Number(form.modelYear)).success) issues.push('modelYear');
  if (!/^\d+$/.test(form.mileageKm.trim()) ||
      !VehicleFactsSchema.shape.mileageKm.safeParse(Number(form.mileageKm)).success) issues.push('mileageKm');
  return [...issues, ...draftLocationIssues(form, 'city')];
}
