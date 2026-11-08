import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { normalizeContent, sourceHash } from './content.js';

test('source changes preserve human text but invalidate its review; unchanged stale drafts can be saved',()=>{
  const original=normalizeContent(makeVehicleDraftFixture());const next=structuredClone(original);
  next.content.title.sourceText='新的原文';
  const updated=normalizeContent(next,original);
  assert.equal(updated.content.title.sourceVersion,2);
  assert.equal(updated.content.title.translations.ru!.text,original.content.title.translations.ru!.text);
  assert.equal(updated.content.title.translations.ru!.reviewStatus,'stale');
  assert.equal(updated.content.title.translations.zh!.reviewStatus,'stale');
  assert.deepEqual(normalizeContent(updated,updated),updated);
  const reviewed=structuredClone(updated);
  reviewed.content.title.translations.ru!.sourceVersion=2;reviewed.content.title.translations.ru!.reviewStatus='approved';
  assert.equal(normalizeContent(reviewed,updated).content.title.translations.ru!.reviewStatus,'approved');
});
test('stale source and stale human edits are rejected; price changes do not alter text source revision',()=>{
  const original=normalizeContent(makeVehicleDraftFixture());const next=structuredClone(original);
  next.price={kind:'on_request',money:null,includes:[]};
  assert.equal(sourceHash(next.content.title),sourceHash(original.content.title));
  assert.deepEqual(normalizeContent(next,original).content,original.content);
  next.content.title.translations.ru!.humanEditVersion=0;
  assert.throws(()=>normalizeContent(next,original),/Reload/);
  next.content.title.sourceVersion=50;assert.throws(()=>normalizeContent(next,original),/Reload/);
});
test('a wrong original-language designation cannot become an approved public text',()=>{
  const draft=makeVehicleDraftFixture();draft.content.title.translations.ru!.kind='original';
  assert.equal(normalizeContent(draft).content.title.translations.ru!.reviewStatus,'pending');
});
test('regional source tags retain approval only for matching original text and base language',()=>{
  const draft=makeVehicleDraftFixture();draft.content.title.sourceLanguage='zh-CN';
  const normalized=normalizeContent(draft);
  assert.equal(normalized.content.title.translations.zh!.reviewStatus,'approved');
  assert.deepEqual(normalizeContent(normalized,normalized),normalized);
  draft.content.title.translations.zh!.text='A different text';
  assert.equal(normalizeContent(draft).content.title.translations.zh!.reviewStatus,'pending');
  draft.content.title.translations.zh!.text=draft.content.title.sourceText!;
  draft.content.title.sourceLanguage='en-GB';
  assert.equal(normalizeContent(draft).content.title.translations.zh!.reviewStatus,'pending');
});
