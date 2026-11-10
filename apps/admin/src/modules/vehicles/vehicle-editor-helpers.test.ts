import { describe, expect, it } from 'vitest';
import { draftToForm, emptyDraft } from './draft-form';
import { formForDemo, hasDemoRestrictedValues } from './vehicle-editor-helpers';

describe('display sample conversion', () => {
  it('clears specific-vehicle inventory facts and public offer without fabricating replacements', () => {
    const original = { ...draftToForm(emptyDraft()), manufacturedAt: '2024-03', firstRegistration: '2024-05', mileageKm: '100', registrationStatus: 'registered' as const, country: 'KR', city: 'Seoul', locationName: 'Seoul', vin: 'TESTVIN', priceKind: 'asking' as const, amount: '23500.00', includes: 'Vehicle only', makeId: 'toyota', makeName: 'Toyota', modelYear: '2024', powerKw: '150', notes: 'Private note' };
    const result = formForDemo(original);
    expect(result).toMatchObject({ manufacturedAt: '', firstRegistration: '', mileageKm: '', registrationStatus: 'unknown', country: '', city: '', locationName: '', vin: '', priceKind: 'on_request', amount: '', includes: '' });
    expect(result).toMatchObject({ makeId: 'toyota', makeName: 'Toyota', modelYear: '2024', powerKw: '150', notes: 'Private note' });
    expect(original.mileageKm).toBe('100');
    expect(hasDemoRestrictedValues(original)).toBe(true);
    expect(hasDemoRestrictedValues(result)).toBe(false);
  });
  it('treats a confirmed zero mileage as a fact requiring conversion confirmation', () => {
    expect(hasDemoRestrictedValues({ ...draftToForm(emptyDraft()), mileageKm: '0' })).toBe(true);
    expect(hasDemoRestrictedValues(draftToForm(emptyDraft()))).toBe(false);
  });
});

import { makeExternalVehicleDraftFixture } from '@hd/contracts/fixtures';
import { VehicleDraftInputSchema } from '@hd/contracts/admin';
import { formForExternal, sourceForKind } from './vehicle-editor-helpers';
import { formToDraft } from './draft-form';

describe('external listing form', () => {
  it('records every required source field without manufacturing a collection time', () => {
    const form = { ...draftToForm(emptyDraft()), sourcePlatformId: 'test-market', sourcePlatformName: '测试平台', sourceListingUrl: 'https://example.invalid/listing/observed-1', sourceExternalId: 'observed-1', sourceCollectedAt: '2026-11-08T08:00:00Z' };
    expect(sourceForKind('external', form)).toEqual({ kind: 'external', platform: { id: 'test-market', name: '测试平台' }, listingUrl: 'https://example.invalid/listing/observed-1', externalId: 'observed-1', collectedAt: '2026-11-08T08:00:00Z', sourceUpdatedAt: null });
    expect(sourceForKind('external', draftToForm(emptyDraft()))).toMatchObject({ collectedAt: '', sourceUpdatedAt: null });
    expect(VehicleDraftInputSchema.safeParse({ ...emptyDraft(), source: sourceForKind('external', draftToForm(emptyDraft())) }).success).toBe(false);
  });
  it('converts our asking price to source reference while preserving observed physical facts', () => {
    const form = { ...draftToForm(emptyDraft()), priceKind: 'asking' as const, amount: '12345.67', mileageKm: '0', country: 'KR', manufacturedAt: '2024-01' };
    expect(formForExternal(form)).toMatchObject({ priceKind: 'reference', amount: '12345.67', mileageKm: '0', country: 'KR', manufacturedAt: '2024-01' });
    expect(form.priceKind).toBe('asking');
  });
  it('keeps source identity byte-for-byte when editing an unrelated field', () => {
    const draft = makeExternalVehicleDraftFixture();
    if (draft.source.kind !== 'external') throw new Error('Expected external fixture');
    draft.source.externalId = ' observed identity ';
    draft.source.platform.name = ' 平台原始名称 ';
    const form = { ...draftToForm(draft), notes: 'Updated private note' };
    const source = sourceForKind('external', form, draft.source);
    const result = formToDraft({ ...draft, source }, form);
    expect(result.source).toEqual(draft.source);
    expect(result.facts).toEqual(draft.facts);
    expect(result.content).toEqual(draft.content);
    expect(result.internal.notes).toBe('Updated private note');
  });
  it('updates optional source timing honestly and excludes metadata from other source kinds', () => {
    const draft = makeExternalVehicleDraftFixture();
    const form = { ...draftToForm(draft), sourceUpdatedAt: '2026-11-08T07:00:00Z' };
    expect(formToDraft(draft, form).source).toMatchObject({ kind: 'external', sourceUpdatedAt: '2026-11-08T07:00:00Z' });
    expect(sourceForKind('manual', form)).toEqual({ kind: 'manual' });
    expect(sourceForKind('demo', form)).toEqual({ kind: 'demo' });
  });
});
