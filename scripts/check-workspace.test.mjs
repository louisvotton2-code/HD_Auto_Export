import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkWorkspace } from './check-workspace.mjs';

const manifest = (name, extra = {}) => JSON.stringify({ name, private: true, ...extra });
const reserved = (name) => manifest(name, { description: 'Reserved workspace boundary; implementation pending.' });

test('contracts cannot pull server libraries, environment secrets or network effects into browser consumers', (t) => {
  const root = fixture(t, {
    'packages/contracts/src/index.ts': 'export { value } from "./hidden";',
    'packages/contracts/src/hidden.ts': 'import pg from "pg"; import fs from "node:fs"; export const value = process.env.SECRET; fetch("https://example.invalid");',
  });
  const result = checkWorkspace(root);
  assert.ok(result.issues.some(issue => issue.includes('only its own source and zod: pg')));
  assert.ok(result.issues.some(issue => issue.includes('only its own source and zod: node:fs')));
  assert.ok(result.issues.some(issue => issue.includes('side-effect free: process')));
  assert.ok(result.issues.some(issue => issue.includes('side-effect free: fetch')));
});

function fixture(t, additions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-workspace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'apps/web/package.json': manifest('@hd/web'),
    'apps/web/tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
    'apps/web/src/index.ts': 'export const web = true;',
    'apps/admin/package.json': reserved('@hd/admin'),
    'apps/api/package.json': reserved('@hd/api'),
    'packages/contracts/package.json': reserved('@hd/contracts'),
    'packages/calculator-core/package.json': reserved('@hd/calculator-core'),
    ...additions,
  };
  for (const [filename, content] of Object.entries(files)) {
    if (content === null) continue;
    const fullPath = path.join(root, filename);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return root;
}

test('scans real web files and distinguishes four reserved packages from implemented apps', (t) => {
  const result = checkWorkspace(fixture(t, {
    'apps/web/src/value.ts': 'export const value = 1;',
    'apps/web/src/index.ts': 'export { value } from "@/value";',
    'apps/web/README.md': 'import "@hd/admin";',
    'docs/candidate.ts': 'import "@hd/admin";',
    'apps/web/.next/generated.ts': 'import "@hd/admin";',
    'apps/web/out/entry.js': 'import "@hd/admin";',
    'apps/web/node_modules/external/index.js': 'import "@hd/admin";',
  }));
  assert.deepEqual(result.issues, []);
  assert.equal(result.files.length, 2);
  assert.equal(result.configFiles.length, 1);
  assert.equal(result.workspaces.filter((unit) => unit.status === 'reserved').length, 4);
  assert.equal(result.workspaces.find((unit) => unit.name === '@hd/web').sourceFiles, 2);
});

test('allows cross-package public exports and app-local aliases with type imports', (t) => {
  const result = checkWorkspace(fixture(t, {
    'apps/web/package.json': manifest('@hd/web', { dependencies: { '@hd/contracts': 'workspace:*' } }),
    'packages/contracts/package.json': manifest('@hd/contracts', {
      exports: { '.': { types: './src/index.ts', default: './src/index.ts' }, './vehicle': './src/vehicle.ts' },
    }),
    'packages/contracts/src/index.ts': 'export type Vehicle = { id: string };',
    'packages/contracts/src/vehicle.ts': 'export type Vehicle = { id: string };',
    'apps/web/src/index.ts': 'import type { Vehicle } from "@hd/contracts"; export type { Vehicle } from "@hd/contracts/vehicle";',
  }));
  assert.deepEqual(result.issues, []);
});

for (const statement of [
  'import type { Secret } from "../../admin/src/secret";',
  'export type { Secret } from "@hd/admin";',
  'type Secret = import("@hd/admin/internal").Secret;',
  'const admin = import("@hd/admin");',
  'const admin = require("../../admin/src/secret");',
  'import admin = require("@hd/admin");',
  'const admin = require.resolve("@hd/admin");',
]) {
  test(`rejects cross-app edge: ${statement}`, (t) => {
    const result = checkWorkspace(fixture(t, { 'apps/web/src/index.ts': statement }));
    assert.ok(result.issues.some((issue) => issue.includes('apps must not depend on another app')), result.issues.join('\n'));
  });
}

test('rejects packages importing apps, including type-only exports and dynamic imports', (t) => {
  const result = checkWorkspace(fixture(t, {
    'packages/contracts/src/index.ts': 'export type { Web } from "@hd/web"; const web = import("../../../apps/web/src/index");',
  }));
  assert.equal(result.issues.filter((issue) => issue.includes('packages must not depend on apps')).length, 2);
});

for (const consumer of ['apps/web', 'packages/contracts']) {
  test(`rejects ${consumer} importing an app through a root bridge`, (t) => {
    const result = checkWorkspace(fixture(t, {
      [`${consumer}/src/index.ts`]: 'import "../../../bridge";',
      'bridge.ts': 'export { admin } from "./apps/admin/src/index";',
      'apps/admin/src/index.ts': 'export const admin = true;',
    }));
    assert.ok(result.issues.some((issue) => issue.startsWith(`${consumer}/src/index.ts:`) &&
      issue.includes('filesystem imports must stay inside')), result.issues.join('\n'));
  });
}

test('allows root tooling orchestration and app-local scripts using external packages', (t) => {
  const result = checkWorkspace(fixture(t, {
    'apps/web/tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler' } }),
    'scripts/inspect.ts': 'import "../apps/web/src/index";',
    'apps/web/scripts/task.mjs': 'import fs from "node:fs"; import "external"; import "../src/index";',
    'node_modules/external/package.json': JSON.stringify({ name: 'external', main: './index.js' }),
    'node_modules/external/index.js': 'exports.external = true;',
    'node_modules/external/index.d.ts': 'export const external: boolean;',
  }));
  assert.deepEqual(result.issues, []);
});

for (const version of [null, '*']) {
  test(`rejects shared package imports without workspace protocol (${version ?? 'undeclared'})`, (t) => {
    const result = checkWorkspace(fixture(t, {
      'apps/web/package.json': manifest('@hd/web', version ? { dependencies: { '@hd/contracts': version } } : {}),
      'packages/contracts/package.json': manifest('@hd/contracts', { exports: { '.': './src/index.ts' } }),
      'packages/contracts/src/index.ts': 'export type Contract = string;',
      'apps/web/src/index.ts': 'import type { Contract } from "@hd/contracts";',
    }));
    assert.ok(result.issues.some((issue) => issue.includes('explicit workspace: dependency on @hd/contracts')),
      result.issues.join('\n'));
  });
}

test('shared packages also require a workspace declaration when consuming another package', (t) => {
  const result = checkWorkspace(fixture(t, {
    'packages/contracts/package.json': manifest('@hd/contracts', { exports: './src/index.ts' }),
    'packages/contracts/src/index.ts': 'export type Contract = string;',
    'packages/calculator-core/src/index.ts': 'export type { Contract } from "@hd/contracts";',
  }));
  assert.ok(result.issues.some((issue) => issue.startsWith('packages/calculator-core/src/index.ts:') &&
    issue.includes('explicit workspace: dependency on @hd/contracts')), result.issues.join('\n'));
});

test('checks dependency declarations even when the package has no source', (t) => {
  const result = checkWorkspace(fixture(t, {
    'apps/admin/package.json': JSON.stringify({ ...JSON.parse(reserved('@hd/admin')), devDependencies: { '@hd/web': 'workspace:*' } }),
    'packages/contracts/package.json': JSON.stringify({
      ...JSON.parse(reserved('@hd/contracts')),
      dependencies: { '@hd/api': 'workspace:*' },
      optionalDependencies: { apiAlias: 'workspace:@hd/api@*' },
      peerDependencies: { localWeb: 'file:../../apps/web' },
    }),
  }));
  assert.equal(result.issues.filter((issue) => /must not depend/.test(issue)).length, 4);
});

test('rejects absolute file and link dependencies on another app', (t) => {
  const root = fixture(t, {});
  fs.writeFileSync(path.join(root, 'apps/web/package.json'), manifest('@hd/web', {
    dependencies: { admin: `file:${path.join(root, 'apps/admin')}` },
  }));
  fs.writeFileSync(path.join(root, 'packages/contracts/package.json'), JSON.stringify({
    ...JSON.parse(reserved('@hd/contracts')),
    devDependencies: { admin: `link:${path.join(root, 'apps/admin')}` },
  }));
  const result = checkWorkspace(root);
  assert.equal(result.issues.filter((issue) => issue.includes('apps must not depend on another app')).length, 1);
  assert.equal(result.issues.filter((issue) => issue.includes('packages must not depend on apps')).length, 1);
});

test('rejects package deep paths, missing exports, and relative package access', (t) => {
  const result = checkWorkspace(fixture(t, {
    'packages/contracts/package.json': manifest('@hd/contracts', { exports: { '.': './src/index.ts' } }),
    'packages/contracts/src/index.ts': 'export const contract = true;',
    'apps/web/src/index.ts': [
      'import "@hd/contracts/src/index";',
      'import "@hd/calculator-core";',
      'import "../../../packages/contracts/src/index";',
    ].join('\n'),
  }));
  assert.equal(result.issues.filter((issue) => issue.includes('not exposed')).length, 2);
  assert.ok(result.issues.some((issue) => issue.includes('through package exports')));
});

test('honors specific null exports before broad wildcard exports', (t) => {
  const result = checkWorkspace(fixture(t, {
    'apps/web/package.json': manifest('@hd/web', { dependencies: { '@hd/contracts': 'workspace:*' } }),
    'packages/contracts/package.json': manifest('@hd/contracts', {
      exports: { './*': './src/*.ts', './private/*': null, './disabled': null },
    }),
    'packages/contracts/src/index.ts': 'export const contract = true;',
    'apps/web/src/index.ts': 'import "@hd/contracts/vehicle"; import "@hd/contracts/private/secret"; import "@hd/contracts/disabled";',
  }));
  assert.equal(result.issues.filter((issue) => issue.includes('not exposed')).length, 2);
  assert.ok(!result.issues.some((issue) => issue.endsWith('@hd/contracts/vehicle')));
});

test('rejects unused tsconfig aliases that escape the app or bypass shared exports', (t) => {
  const result = checkWorkspace(fixture(t, {
    'apps/web/tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: {
        '@/*': ['./src/*'],
        '@admin/*': ['../admin/src/*'],
        '@contracts/*': ['../../packages/contracts/src/*'],
        '@anything/*': ['../../*'],
      } },
    }),
  }));
  assert.equal(result.issues.filter((issue) => issue.includes('tsconfig paths must stay inside')).length, 3);
});

test('catches inherited tsconfig paths relative to the declaring config', (t) => {
  const result = checkWorkspace(fixture(t, {
    'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: { '@admin/*': ['./apps/admin/src/*'] } } }),
    'apps/web/tsconfig.json': JSON.stringify({ extends: '../../tsconfig.base.json' }),
  }));
  assert.ok(result.issues.some((issue) => issue.startsWith('apps/web/tsconfig.json:') && issue.includes('tsconfig paths must stay inside')), result.issues.join('\n'));
});

test('rejects baseUrl imports resolved to another app', (t) => {
  const result = checkWorkspace(fixture(t, {
    'apps/web/tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '../..' } }),
    'apps/admin/src/secret.ts': 'export const secret = true;',
    'apps/web/src/index.ts': 'import "apps/admin/src/secret";',
  }));
  assert.ok(result.issues.some((issue) => issue.includes('apps must not depend on another app')));
});

test('also scans workspace scripts, tests, and code config files', (t) => {
  const result = checkWorkspace(fixture(t, {
    'apps/web/scripts/task.mjs': 'import "@hd/api";',
    'apps/web/tests/smoke.ts': 'import "@hd/admin";',
    'apps/web/vitest.config.ts': 'import "@hd/api";',
  }));
  assert.equal(result.issues.filter((issue) => issue.includes('apps must not depend on another app')).length, 3);
});

test('reports computed import limits while rejecting obvious cross-app template prefixes', (t) => {
  const result = checkWorkspace(fixture(t, {
    'apps/web/src/index.ts': 'import(`../messages/${locale}.json`); import(target); import(`../../admin/${name}`);',
  }));
  assert.equal(result.computedImports.length, 3);
  assert.equal(result.issues.filter((issue) => issue.includes('apps must not depend on another app')).length, 1);
  assert.equal(result.issues.filter((issue) => issue.includes('computed import requires')).length, 2);
});

test('missing web manifest or source cannot silently pass an empty scan', (t) => {
  const missingManifest = checkWorkspace(fixture(t, { 'apps/web/package.json': null }));
  assert.ok(missingManifest.issues.some((issue) => issue.includes('required @hd/web workspace manifest')));
  const missingSource = checkWorkspace(fixture(t, { 'apps/web/src/index.ts': null }));
  assert.ok(missingSource.issues.some((issue) => issue.includes('required web source tree')));
});

test('a new empty workspace needs an explicit reserved marker and no scripts', (t) => {
  const result = checkWorkspace(fixture(t, {
    'packages/uninitialized/package.json': manifest('@hd/uninitialized'),
    'apps/api/package.json': JSON.stringify({ ...JSON.parse(reserved('@hd/api')), scripts: { test: 'echo ok' } }),
  }));
  assert.equal(result.issues.filter((issue) => issue.includes('workspace has no source files')).length, 2);
});
