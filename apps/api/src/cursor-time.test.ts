import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCursorTime } from './cursor-time.js';

test('database cursors preserve microseconds but reject nonexistent calendar dates', () => {
  for (const time of ['2024-02-29T23:59:59.999999Z', '0001-01-01T00:00:00.000001Z']) assert.equal(isCursorTime(time), true);
  for (const time of ['0000-01-01T00:00:00.000000Z', '2026-02-30T00:00:00.000000Z', '2026-02-29T00:00:00.000000Z', '2026-04-31T00:00:00.000000Z', '2026-01-01T24:00:00.000000Z', '2026-01-01T00:00:00.000000+00:00', null]) assert.equal(isCursorTime(time), false);
});
