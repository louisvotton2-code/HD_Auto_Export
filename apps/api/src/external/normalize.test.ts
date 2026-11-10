import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeExternalCandidateFixture } from '@hd/contracts/fixtures';
import { buildProjection, emptyOverrides } from './normalize.js';

test('source free text containing a VIN or formatted international phone stays in private source data', () => {
  const source = makeExternalCandidateFixture(1);
  const privateText = ['VIN: 1hgcm82633a004352', 'Contact: +44 7700 900123', 'Call +1 (202) 555-0142'];
  source.copy.title!.original.text = privateText[0]!;
  source.copy.description!.original.text = privateText[1]!;
  source.images[0]!.alt = { text: privateText[2]!, contentLocale: 'en' };
  source.specifications[0]!.value.text = privateText[0]!;
  source.inspection!.entries[0]!.value.text = privateText[1]!;
  const publicFields = buildProjection(source, emptyOverrides(), 'Synthetic Market');
  for (const text of privateText) assert.ok(!JSON.stringify(publicFields).includes(text));
  assert.deepEqual(publicFields.details.original, { title: null, model: source.copy.model!.original, description: null });
  assert.equal(source.copy.title!.original.text, privateText[0]);
});

test('unresolved disputes suppress source copy and alt text that could repeat the claims', () => {
  const source = makeExternalCandidateFixture(3);
  source.images[0]!.alt = { text: '2024 hybrid vehicle', contentLocale: 'en' };
  const publicFields = buildProjection(source, emptyOverrides(), 'Synthetic Market');
  assert.equal(publicFields.facts.modelYear, null);
  assert.equal(publicFields.facts.powertrain, 'unknown');
  assert.equal(publicFields.images[0]!.alt, null);
  assert.equal(publicFields.localized.en.title.kind, 'catalog');
  assert.equal(publicFields.details.original.title, null);
});
