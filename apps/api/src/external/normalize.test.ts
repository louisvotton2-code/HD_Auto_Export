import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeExternalCandidateFixture } from '@hd/contracts/fixtures';
import { buildProjection, emptyOverrides, isPublicText } from './normalize.js';
import {publicLink,chinaCarProfile} from './profiles.js';

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


test('known signed media supports both supplier key variants without expanding host or query permissions',()=>{
 const url='https://p3-dcd-sign.byteimg.com/photo.jpg?psm=1.2&rk3s=abc123&x-expires=1900000000&x-signature=abcdefghijklmnop';
 assert.equal(publicLink(url,'media',chinaCarProfile),url);
 const legacy=url.replace('rk3s','lk3s');assert.equal(publicLink(legacy,'media',chinaCarProfile),legacy);
 for(const invalid of [url+'&extra=secret',url+'&lk3s=abc',url.replace('p3-dcd-sign.byteimg.com','evil.invalid'),url+'&rk3s=duplicate'])assert.equal(publicLink(invalid,'media',chinaCarProfile),null);
});


test('safe supplier translations apply without inferred script or numeric checks', () => {
  const source=makeExternalCandidateFixture(1);
  const title=source.copy.title!;
  title.original={text:'车型 85 kW',contentLocale:'zh'};
  title.translations.en={text:'Выставка 100 кВт',contentLocale:'ru'};
  title.translations.ru={text:'Contact: +44 7700 900123',contentLocale:'ru'};
  const projection=buildProjection(source,emptyOverrides(),'Synthetic Market');
  assert.equal(projection.localized.en.title.text,'Выставка 100 кВт');
  assert.equal(projection.localized.en.title.contentLocale,'ru');
  assert.equal(projection.localized.en.title.kind,'supplier');
  assert.equal(projection.localized.ru.title.text,'车型 85 kW');
});

test('source display excludes labeled internal costs and seller contacts in all supported languages', () => {
  for (const text of ['内部采购成本 CNY 73421','Seller contact (202) 555-0142','Dealer cost: CNY 73421','Phone','Contact details',
    'Закупочная цена 73 421','Контакт продавца (202) 555-0142']) {
    assert.equal(isPublicText(text), false, text);
  }
  for (const text of ['参考价 CNY 73421','Asking price: CNY 73421','Мощность 85 кВт']) {
    assert.equal(isPublicText(text), true, text);
  }
  const source=makeExternalCandidateFixture(1);
  source.copy.description!.original.text='内部采购成本 CNY 73421';
  source.copy.title!.translations.en={text:'Seller contact (202) 555-0142',contentLocale:'en'};
  const projection=buildProjection(source,emptyOverrides(),'Synthetic Market');
  assert.equal(projection.localized.zh.description,null);
  assert.equal(projection.details.original.description,null);
  assert.equal(projection.localized.en.title.text,source.copy.title!.original.text);
  assert.equal(source.copy.description!.original.text,'内部采购成本 CNY 73421');
});
