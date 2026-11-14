import { MoneySchema, VehicleFactsSchema, type VehicleDraftSource } from '@hd/contracts/admin';
import type { DraftForm } from './draft-form';

export type EntryTab = 'basics' | 'configuration' | 'commercial';
export type EntryIssue = { key: keyof DraftForm; tab: EntryTab };

export function draftEntryIssues(form: DraftForm, kind: VehicleDraftSource['kind'], validConfiguration: boolean): EntryIssue[] {
  const issues: EntryIssue[] = [];
  const addIssueUnless = (valid: boolean, key: keyof DraftForm, tab: EntryTab) => {
    if (!valid) issues.push({ key, tab });
  };
  addIssueUnless(!!form.makeId && !!form.makeName.trim(), 'makeName', 'basics');
  addIssueUnless(!!form.modelId && !!form.modelName.trim(), 'modelName', 'basics');
  addIssueUnless(!!form.title.trim(), 'title', 'basics');
  if (kind === 'demo') return issues;

  addIssueUnless(!!form.trimId && !!form.trimName.trim(), 'trimName', 'basics');
  addIssueUnless(/^\d{4}$/.test(form.modelYear) && VehicleFactsSchema.shape.modelYear.safeParse(Number(form.modelYear)).success, 'modelYear', 'basics');
  addIssueUnless(form.powertrain !== 'unknown', 'powertrain', 'basics');
  addIssueUnless(/^\d+$/.test(form.mileageKm.trim()) && VehicleFactsSchema.shape.mileageKm.safeParse(Number(form.mileageKm)).success, 'mileageKm', 'basics');
  addIssueUnless(validConfiguration, 'configuration', 'configuration');

  const priced = (amount: string, currency: DraftForm['currency']) =>
    MoneySchema.safeParse({ amount: amount.trim(), currency }).success && Number(amount) > 0;
  const validPriceKind = form.priceKind === (kind === 'manual' ? 'asking' : 'reference');
  addIssueUnless(validPriceKind, 'priceKind', 'commercial');
  if (form.priceKind !== 'on_request') addIssueUnless(priced(form.amount, form.currency), 'amount', 'commercial');
  addIssueUnless(priced(form.purchaseAmount, form.purchaseCurrency), 'purchaseAmount', 'commercial');
  addIssueUnless(!!form.description.trim(), 'description', 'commercial');
  return issues;
}
