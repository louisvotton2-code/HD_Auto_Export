import { makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { draftEntryIssues } from './draft-entry-validation';
import { draftToForm, emptyDraft, formToDraft } from './draft-form';

function validForm() {
  const draft = makeVehicleDraftFixture();
  draft.facts.trim = { id: 'trim', name: '试验配置' };
  return draftToForm(draft);
}

describe('staff draft entry', () => {
  it('groups missing requirements by the step that can resolve them', () => {
    const issues = draftEntryIssues(draftToForm(emptyDraft()), 'manual', false);
    expect(issues.filter(issue => issue.tab === 'basics').map(issue => issue.key)).toEqual([
      'makeName', 'modelName', 'title', 'trimName', 'modelYear', 'powertrain', 'mileageKm',
    ]);
    expect(issues.filter(issue => issue.tab !== 'basics').map(issue => issue.key)).toEqual([
      'configuration', 'priceKind', 'purchaseAmount', 'description',
    ]);
  });

  it('accepts confirmed zero mileage and exact historical money; rejects invalid required values', () => {
    const form = validForm();
    expect(draftEntryIssues({ ...form, mileageKm: '0' }, 'manual', true)).toEqual([]);
    expect(draftEntryIssues({ ...form, modelYear: '1885', mileageKm: '1.5', powertrain: 'unknown',
      amount: '12.999', purchaseAmount: '0.00', description: '  ' }, 'manual', false).map(issue => issue.key))
      .toEqual(['modelYear', 'powertrain', 'mileageKm', 'configuration', 'amount', 'purchaseAmount', 'description']);
  });

  it('preserves hidden facts and currencies of historical unpriced amounts on unrelated edits', () => {
    const base = makeVehicleDraftFixture();
    base.facts.powerHp = 147.5;
    base.price = { kind: 'asking', money: { amount: null, currency: 'EUR' }, includes: [] };
    base.internal.purchaseCost = { amount: null, currency: 'USD' };
    const form = draftToForm(base);
    expect([form.currency, form.purchaseCurrency]).toEqual(['EUR', 'USD']);
    expect(formToDraft(base, { ...form, notes: '一条测试记录' })).toEqual({ ...base, internal: { ...base.internal, notes: '一条测试记录' } });
  });
});
