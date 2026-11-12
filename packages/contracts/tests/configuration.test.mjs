import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  VehicleConfigurationSchema, parseVehicleConfigurationJson, vehicleConfigurationExample,
  vehicleConfigurationItemId, vehicleConfigurationJsonSchema, VEHICLE_CONFIGURATION_LIMITS,
} from '../dist/configuration.js';

const config = (items = [{ name: '排量(cc)', value: '1989' }]) => ({ version: 1, items });
const invalid = (value) => assert.equal(VehicleConfigurationSchema.safeParse(value).success, false);
function failsAt(fn, path, message) {
  assert.throws(fn, error => error instanceof z.ZodError && error.issues.some(issue =>
    JSON.stringify(issue.path) === JSON.stringify(path) && (!message || message.test(issue.message))));
}

test('configuration preserves source names, units, string values, unknowns and item order', () => {
  const source = config([
    { name: '排量(cc)', value: '1989' }, { name: 'Power (kW)', value: '00120.0' },
    { name: 'Расход (л/100 км)', value: 'unknown' }, { name: 'Option', value: 'false' },
    { name: 'Code', value: '0' }, { name: 'Line note', value: 'line 1\nline 2' },
  ]);
  const text = JSON.stringify(source);
  assert.deepEqual(VehicleConfigurationSchema.parse(source), source);
  assert.deepEqual(parseVehicleConfigurationJson(`\n ${text}\t`), source);
  assert.equal(JSON.stringify(source), text);
  assert.deepEqual(parseVehicleConfigurationJson(JSON.stringify(vehicleConfigurationExample)), vehicleConfigurationExample);
});

test('configuration rejects unknown properties, versions, nesting and non-string values', () => {
  for (const source of [
    null, '', [], {}, { ...config(), version: 2 }, { ...config(), version: '1' },
    { ...config(), extra: true }, { items: config().items }, { version: 1 },
    config([{ name: 'x', value: '1', unit: 'cc' }]), config([{ name: 'x' }]),
  ]) invalid(source);
  for (const value of [null, undefined, 0, 1989, false, [], { text: '1989' }]) {
    invalid(config([{ name: 'x', value }]));
    invalid(config([{ name: value, value: 'x' }]));
  }
});

test('configuration has exact text and item bounds without trimming', () => {
  for (const text of ['', ' ', '\t\n', ' x', 'x ', 'x\n', 'x\r\n', '\u00a0x', 'x\u3000', '\ufeffx']) {
    invalid(config([{ name: text, value: 'x' }]));
    invalid(config([{ name: 'x', value: text }]));
  }
  assert.equal(VehicleConfigurationSchema.safeParse(config([{ name: 'n'.repeat(100), value: 'v'.repeat(500) }])).success, true);
  invalid(config([{ name: 'n'.repeat(101), value: 'v' }]));
  invalid(config([{ name: 'n', value: 'v'.repeat(501) }]));
  invalid(config([]));
  const twoHundred = Array.from({ length: 200 }, (_, index) => ({ name: `item ${index}`, value: 'x' }));
  assert.deepEqual(VehicleConfigurationSchema.parse(config(twoHundred)), config(twoHundred));
  assert.deepEqual(parseVehicleConfigurationJson(JSON.stringify(config(twoHundred))), config(twoHundred));
  invalid(config([...twoHundred, { name: 'item 200', value: 'x' }]));
});

test('duplicate names compare NFKC, trim and lowercase without rewriting source identity', () => {
  for (const names of [['Power', 'Power'], ['Power', 'power'], ['Power', 'Ｐｏｗｅｒ'], ['Å', 'A\u030a']]) {
    failsAt(() => VehicleConfigurationSchema.parse(config(names.map(name => ({ name, value: '1' })))), ['items', 1, 'name']);
  }
  const source = config([{ name: 'Ｐｏｗｅｒ', value: '123' }]);
  assert.deepEqual(VehicleConfigurationSchema.parse(source), source);
});

test('combined name and value length allows 16000 and rejects 16001', () => {
  const items = Array.from({ length: 40 }, (_, index) => ({ name: `n${String(index).padStart(2, '0')}`, value: 'v'.repeat(397) }));
  assert.equal(items.reduce((sum, item) => sum + item.name.length + item.value.length, 0), 16000);
  assert.deepEqual(VehicleConfigurationSchema.parse(config(items)).items, items);
  items[0].value += 'v';
  failsAt(() => VehicleConfigurationSchema.parse(config(items)), ['items'], /16000/);
});

test('raw JSON rejects duplicate properties, including escaped aliases at each relevant depth', () => {
  for (const raw of [
    '{"version":1,"version":1,"items":[{"name":"x","value":"1"}]}',
    '{"version":1,"\\u0076ersion":1,"items":[{"name":"x","value":"1"}]}',
  ]) failsAt(() => parseVehicleConfigurationJson(raw), ['version'], /Duplicate JSON property/);
  failsAt(() => parseVehicleConfigurationJson('{"version":1,"items":[],"items":[{"name":"x","value":"1"}]}'), ['items']);
  for (const raw of [
    '{"version":1,"items":[{"name":"x","name":"y","value":"1"}]}',
    '{"version":1,"items":[{"name":"x","\\u006eame":"y","value":"1"}]}',
  ]) failsAt(() => parseVehicleConfigurationJson(raw), ['items', 0, 'name'], /Duplicate JSON property/);
  failsAt(() => parseVehicleConfigurationJson('{"version":1,"items":[{"name":"x","value":"1","value":"2"}]}'), ['items', 0, 'value']);
  failsAt(() => parseVehicleConfigurationJson('{"version":1,"items":[{"name":"x","value":"1"}],"extra":{"x":1,"x":2}}'), ['extra', 'x']);
});

test('raw parser handles escaped punctuation and repeated property names in separate items', () => {
  const source = config([
    { name: 'Quotes " and slash \\', value: '{"name":"not an object","name":"still text"}' },
    { name: 'Bracket [ ]', value: 'é 😃 \t inline' },
  ]);
  assert.deepEqual(parseVehicleConfigurationJson(JSON.stringify(source)), source);
});

test('raw parser rejects empty, fenced, malformed, commented and trailing explanation inputs', () => {
  const text = JSON.stringify(config());
  for (const raw of [
    '', ' \n ', 'null', '[]', '```json\n' + text + '\n```', text + '\nLooks good',
    'Here is JSON: ' + text, text + text, '{"version":1,}', '{version:1}',
    '{"version":NaN}', '{"version":1/*comment*/}', '{"version":1,// comment\n"items":[]}',
    '{"version":1,"items":[{"name":"x","value":"bad\nstring"}]}',
  ]) assert.throws(() => parseVehicleConfigurationJson(raw), z.ZodError);
  for (const value of [null, undefined, {}, 1]) failsAt(() => parseVehicleConfigurationJson(value), []);
  failsAt(() => parseVehicleConfigurationJson('{"version":1,"items":[{"name":"x","value":3}]}'), ['items', 0, 'value']);
});

test('raw parser bounds UTF-8 byte length, nesting and value count', () => {
  const text = JSON.stringify(config());
  assert.deepEqual(parseVehicleConfigurationJson(text + ' '.repeat(65536 - Buffer.byteLength(text))), config());
  failsAt(() => parseVehicleConfigurationJson(text + ' '.repeat(65537 - Buffer.byteLength(text))), [], /65536/);
  const oversizedUnicode = JSON.stringify(config([{ name: 'x', value: '车'.repeat(22000) }]));
  assert.ok(oversizedUnicode.length < 65536);
  failsAt(() => parseVehicleConfigurationJson(oversizedUnicode), [], /UTF-8/);
  assert.throws(() => parseVehicleConfigurationJson('['.repeat(10) + '0' + ']'.repeat(10)), error => error.issues?.some(issue => /nested too deeply/.test(issue.message)));
  assert.throws(() => parseVehicleConfigurationJson(JSON.stringify(Array(2049).fill(0))), error => error.issues?.some(issue => /too many values/.test(issue.message)));
});

test('stable item IDs encode exact names without hashing, ordering or value dependence', () => {
  assert.equal(vehicleConfigurationItemId('A'), 'cfg-0041');
  assert.equal(vehicleConfigurationItemId('排量(cc)'), 'cfg-639291cf0028006300630029');
  assert.equal(vehicleConfigurationItemId('😃'), 'cfg-d83dde03');
  assert.equal(vehicleConfigurationItemId('n'.repeat(100)).length, 404);
  for (const [left, right] of [['A', 'a'], ['A', 'Ａ'], ['Å', 'A\u030a'], ['ab', 'a-b']]) {
    assert.notEqual(vehicleConfigurationItemId(left), vehicleConfigurationItemId(right));
  }
  const original = config([{ name: 'Power', value: '120' }, { name: 'Range', value: 'unknown' }]);
  const changed = config([{ name: 'Range', value: '450 km' }, { name: 'Power', value: '121' }]);
  assert.equal(vehicleConfigurationItemId(original.items[0].name), vehicleConfigurationItemId(changed.items[1].name));
  for (const name of ['', ' x', 'x ', 'x'.repeat(101)]) assert.throws(() => vehicleConfigurationItemId(name), z.ZodError);
});

test('configuration refuses text that PostgreSQL JSONB cannot persist without rejecting emoji', () => {
  for (const name of ['\u0000', '\ud800', '\udfff']) for (const key of ['name', 'value']) {
    const value = config([{ name: 'Name', value: 'Value', [key]: name }]);
    assert.equal(VehicleConfigurationSchema.safeParse(value).success, false);
    assert.throws(() => parseVehicleConfigurationJson(JSON.stringify(value)), z.ZodError);
  }
  assert.equal(VehicleConfigurationSchema.safeParse(config([{ name: '配置😃', value: '数值😀' }])).success, true);
});

test('JSON Schema export is serializable and documents the exact structural contract', () => {
  assert.deepEqual(VEHICLE_CONFIGURATION_LIMITS, { items: 200, nameUtf16: 100, valueUtf16: 500, totalUtf16: 16000, jsonBytes: 65536, jsonDepth: 8, jsonNodes: 2048 });
  assert.equal(Object.isFrozen(VEHICLE_CONFIGURATION_LIMITS), true);
  const schema = JSON.parse(JSON.stringify(vehicleConfigurationJsonSchema));
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['version', 'items']);
  assert.equal(schema.properties.version.const, 1);
  assert.equal(schema.properties.items.minItems, 1);
  assert.equal(schema.properties.items.maxItems, 200);
  const item = schema.properties.items.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required, ['name', 'value']);
  assert.equal(item.properties.name.type, 'string');
  assert.equal(item.properties.name.maxLength, 100);
  assert.equal(item.properties.value.type, 'string');
  assert.equal(item.properties.value.maxLength, 500);
  assert.deepEqual(VehicleConfigurationSchema.parse(vehicleConfigurationExample), vehicleConfigurationExample);
});
