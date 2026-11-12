import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { normalizeContent, sourceHash } from './content.js';

test('source changes refresh Chinese original and preserve stale foreign human text; unchanged drafts can be saved',()=>{
  const original=normalizeContent(makeVehicleDraftFixture());const next=structuredClone(original);
  next.content.title.sourceText='新的原文';
  const updated=normalizeContent(next,original);
  assert.equal(updated.content.title.sourceVersion,2);
  for(const locale of ['en','ru'] as const) {
    assert.equal(updated.content.title.translations[locale]!.text,original.content.title.translations[locale]!.text);
    assert.equal(updated.content.title.translations[locale]!.reviewStatus,'stale');
    assert.equal(updated.content.title.translations[locale]!.sourceVersion,original.content.title.sourceVersion);
    assert.equal(updated.content.title.translations[locale]!.humanEditVersion,original.content.title.translations[locale]!.humanEditVersion);
  }
  assert.deepEqual(updated.content.title.translations.zh, {text:'新的原文',kind:'original',reviewStatus:'pending',sourceVersion:2,
    humanEditVersion:original.content.title.translations.zh!.humanEditVersion+1,engineVersion:null});
  assert.deepEqual(normalizeContent(updated,updated),updated);
  const reviewed=structuredClone(updated);
  reviewed.content.title.translations.ru!.sourceVersion=2;reviewed.content.title.translations.ru!.reviewStatus='approved';
  assert.equal(normalizeContent(reviewed,updated).content.title.translations.ru!.reviewStatus,'approved');
});
test('Chinese text derives from the saved source and never from model names or an independent translation edit',()=>{
  const original=normalizeContent(makeVehicleDraftFixture()),next=structuredClone(original);
  next.facts.model={id:'another-model',name:'另一个车型名称'};
  Object.assign(next.content.title.translations.zh!,{text:'独立改写的中文译文',kind:'human',engineVersion:null});
  const updated=normalizeContent(next,original);
  assert.equal(updated.content.title.sourceText,original.content.title.sourceText);
  assert.deepEqual(updated.content.title.translations.zh,{text:original.content.title.sourceText,kind:'original',reviewStatus:'pending',
    sourceVersion:original.content.title.sourceVersion,humanEditVersion:original.content.title.translations.zh!.humanEditVersion+1,engineVersion:null});
  for(const locale of ['en','ru'] as const)assert.deepEqual(updated.content.title.translations[locale],original.content.title.translations[locale]);
  assert.deepEqual(normalizeContent(updated,updated),updated);
  const missing=makeVehicleDraftFixture();missing.content.title.translations.zh=null;
  const derived=normalizeContent(missing);
  assert.equal(derived.content.title.translations.zh!.text,missing.content.title.sourceText);
  assert.equal(derived.content.title.translations.zh!.reviewStatus,'pending');
  assert.equal(derived.content.title.translations.zh!.humanEditVersion,0);
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
  assert.equal(normalized.content.title.sourceLanguage,'zh-CN');
  assert.equal(normalized.content.title.translations.zh!.reviewStatus,'approved');
  assert.deepEqual(normalizeContent(normalized,normalized),normalized);
  draft.content.title.translations.zh!.text='A different text';
  assert.equal(normalizeContent(draft).content.title.translations.zh!.reviewStatus,'pending');
  draft.content.title.translations.zh!.text=draft.content.title.sourceText!;
  draft.content.title.sourceLanguage='en-GB';
  assert.equal(normalizeContent(draft).content.title.translations.zh!.reviewStatus,'pending');
});
