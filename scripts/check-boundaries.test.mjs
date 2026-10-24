import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBoundaries } from './check-boundaries.mjs';

const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-calculator-boundaries-'));
  temporaryRoots.push(root);
  for (const [name, contents] of Object.entries(files)) {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, contents);
  }
  return root;
}
const entry = 'src/modules/calculator/index.ts';
const calculate = 'src/modules/calculator/core/calculate.ts';

test('follows the real runtime closure and permits a pure facade and explicit facts', () => {
  const root = fixture({
    [entry]:
      "export { calculate } from './core/calculate'; export type { Fact } from './core/types';",
    [calculate]:
      "import Decimal from 'decimal.js'; export function calculate(date: string) { return new Decimal(1).toString() + date; }",
    'src/modules/calculator/core/types.ts': 'export type Fact = string;',
    'src/modules/vehicles/quote.ts': "import { calculate, type Fact } from '@/modules/calculator';",
  });
  const result = checkBoundaries(root);
  assert.deepEqual(result.issues, []);
  assert.equal(result.files.length, 2);
});

test('rejects framework, network, clock and translation dependencies in the public closure', () => {
  const root = fixture({
    [entry]: "export { calculate } from './core/calculate';",
    [calculate]:
      "import React from 'react'; import { labels } from '../policies/ru/method-messages'; export function calculate() { fetch('/'); return Date.now() + Math.random(); }",
    'src/modules/calculator/policies/ru/method-messages.ts':
      "export const labels = { zh: 'text' };",
  });
  const issues = checkBoundaries(root).issues.join('\n');
  for (const expected of ['react', 'method-messages', 'fetch', 'Date', 'randomness'])
    assert.ok(issues.includes(expected), expected);
});

test('rejects future business modules reaching into calculator internals, including types', () => {
  const root = fixture({
    [entry]: 'export const calculate = () => 1;',
    'src/modules/calculator/core/types.ts': 'export type Fact = string;',
    'src/modules/vehicles/quote.ts': "import type { Fact } from '../calculator/core/types';",
    'src/modules/parts/example.ts':
      "export { calculate } from '@/modules/calculator/core/calculate';",
  });
  const issues = checkBoundaries(root).issues;
  assert.equal(issues.length, 2);
  assert.ok(issues.every((issue) => issue.includes('public entry')));
});

test('permits app and i18n composition while rejecting computed imports in pure code', () => {
  const root = fixture({
    [entry]: 'export function calculate() { return import(moduleName); }',
    'src/app/page.tsx': "import { Widget } from '@/modules/calculator/ui/widget';",
    'src/i18n/request.ts': "import { messages } from '@/modules/calculator/application/messages';",
  });
  const issues = checkBoundaries(root).issues;
  assert.equal(issues.length, 1);
  assert.match(issues[0], /computed import/);
});

test('rejects JSX even when the compiler would inject the UI runtime implicitly', () => {
  const root = fixture({
    [entry]: "export { calculate } from './core/calculate';",
    'src/modules/calculator/core/calculate.tsx': 'export const calculate = () => <div />;',
  });
  assert.match(checkBoundaries(root).issues.join('\n'), /implicit UI runtime/);
});
