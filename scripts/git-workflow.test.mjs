import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  checkDocumentation, checkHooks, checkPush, installHooks, recordReview,
  repository, verificationEnvironment, verifyPush,
} from './git-workflow.mjs';

// Fixtures must not read or alter the developer's Git identity/global hook config.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`;
const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const zero = '0'.repeat(40);
const successful = async () => ({ code: 0, signal: null });

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function write(root, filename, text) {
  const target = path.join(root, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}
function save(root, message) {
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', message);
  return git(root, 'rev-parse', 'HEAD');
}
function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-git-flow-'));
  t.after(() => fs.rmSync(temporary, { force: true, recursive: true }));
  const root = path.join(temporary, 'repo with spaces');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture Developer');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  write(root, 'README.md', '# Fixture\n');
  const old = save(root, 'before workflow exists');
  for (const filename of ['scripts/git-workflow.mjs', '.githooks/pre-push']) {
    write(root, filename, fs.readFileSync(path.join(sourceRoot, filename), 'utf8'));
  }
  write(root, '.gitignore', 'artifacts/\n');
  write(root, 'app.ts', 'export const value = 1;\n');
  const base = save(root, 'workflow baseline');
  git(root, 'remote', 'add', 'origin', path.join(temporary, 'remote.git'));
  git(root, 'update-ref', 'refs/remotes/origin/main', base);
  git(root, 'checkout', '-qb', 'codex/fixture');
  write(root, 'app.ts', 'export const value = 2;\n');
  const head = save(root, 'change application');
  return { root, temporary, old, base, head };
}
const refLine = (sha, old = zero, remote = 'refs/heads/codex/fixture') => `refs/heads/codex/fixture ${sha} ${remote} ${old}\n`;

function review(f, base = f.base, head = f.head, overrides = {}) {
  const filename = path.join(f.temporary, `review-${head}.json`);
  const report = {
    base, sha: head, reviewer: 'independent-fixture-agent', verdict: 'pass',
    unresolvedP0: 0, unresolvedP1: 0, summary: 'Reviewed application diff; P2 none; production not covered.',
    ...overrides,
  };
  fs.writeFileSync(filename, JSON.stringify(report));
  return { filename, args: { base, sha: head, reviewer: 'independent-fixture-agent', report: filename } };
}
async function approve(f, base = f.base, head = f.head) {
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), head);
  await verifyPush(f.root, { base, runner: successful });
  const report = review(f, base, head);
  recordReview(f.root, report.args);
  return report;
}
function receiptPath(f, kind = 'tests', sha = f.head) {
  return path.join(repository(f.root).evidence, sha, `${kind}.json`);
}

test('fixed verification creates exact commit/tree receipts and accepts a normal fast-forward', async (t) => {
  const f = fixture(t);
  const commands = [];
  const receipt = await verifyPush(f.root, { base: f.base, runner: async (command, options) => {
    commands.push(command);
    assert.equal(options.env.CI, 'true');
    assert.equal(options.env.E2E_BASE_URL, undefined);
    assert.equal(options.cwd, fs.realpathSync(f.root));
    return successful();
  } });
  assert.deepEqual(commands, [['pnpm', 'check'], ['pnpm', 'build'], ['pnpm', 'test:e2e']]);
  assert.equal(receipt.head, f.head);
  assert.equal(receipt.tree, git(f.root, 'rev-parse', 'HEAD^{tree}'));
  recordReview(f.root, review(f).args);
  assert.equal(checkPush(f.root, refLine(f.head, f.base)).length, 1);
});

test('sanitizes service URLs, secrets, loader flags and skip-test variables', () => {
  const env = verificationEnvironment({
    PATH: '/fixture/bin', HOME: '/fixture', CI: 'false', E2E_BASE_URL: 'http://old:3317',
    NODE_OPTIONS: '--import malicious.mjs', SKIP_TESTS: '1', DATABASE_URL: 'secret',
    NEXT_PUBLIC_SITE_URL: 'https://production.invalid', SITE_INDEXABLE: 'true',
  });
  assert.equal(env.PATH, '/fixture/bin');
  assert.equal(env.CI, 'true');
  assert.equal(env.NEXT_PUBLIC_SITE_URL, 'http://127.0.0.1:3100');
  assert.equal(env.SITE_INDEXABLE, 'false');
  for (const name of ['E2E_BASE_URL', 'NODE_OPTIONS', 'SKIP_TESTS', 'DATABASE_URL']) assert.equal(env[name], undefined);
});

test('validates every stdin ref using its actual SHA, including an approved non-HEAD commit', async (t) => {
  const f = fixture(t);
  await approve(f);
  write(f.root, 'app.ts', 'export const value = 3;\n');
  const next = save(f.root, 'unverified HEAD');
  assert.equal(checkPush(f.root, refLine(f.head, f.base)).length, 1);
  assert.equal(checkPush(f.root, refLine(f.head, f.base) + refLine(f.head, zero, 'refs/heads/codex/other')).length, 2);
  assert.throws(() => checkPush(f.root, refLine(f.head, f.base) + refLine(next, f.head, 'refs/heads/codex/other')), /missing or unreadable/);
});

test('empty stdin and equal OIDs are no-ops, but malformed refs fail', (t) => {
  const f = fixture(t);
  assert.deepEqual(checkPush(f.root, ''), []);
  assert.deepEqual(checkPush(f.root, refLine(f.head, f.head, 'refs/heads/main')), []);
  assert.throws(() => checkPush(f.root, 'bad input'), /Malformed/);
});

for (const [name, input, message] of [
  ['main', (f) => refLine(f.head, f.base, 'refs/heads/main'), /main are blocked/],
  ['deletion', (f) => refLine(zero, f.head), /deletion is blocked/],
  ['tag destination', (f) => refLine(f.head, zero, 'refs/tags/v1'), /tags\/non-branch/],
  ['unknown remote old', (f) => refLine(f.head, '1'.repeat(40)), /Fetch the required history/],
]) {
  test(`rejects ${name}`, (t) => {
    const f = fixture(t);
    assert.throws(() => checkPush(f.root, input(f)), message);
  });
}

test('rejects annotated tags and tree objects even when targeting a branch', (t) => {
  const f = fixture(t);
  git(f.root, 'tag', '-a', 'v1', '-m', 'tag');
  assert.throws(() => checkPush(f.root, refLine(git(f.root, 'rev-parse', 'v1'))), /not a commit/);
  assert.throws(() => checkPush(f.root, refLine(git(f.root, 'rev-parse', 'HEAD^{tree}'))), /not a commit/);
});

test('rejects non-fast-forward updates and remote bases outside the reviewed range', async (t) => {
  const f = fixture(t);
  await approve(f);
  assert.throws(() => checkPush(f.root, refLine(f.head, f.old)), /before\/outside/);
  git(f.root, 'checkout', '-qb', 'codex/diverged', f.base);
  write(f.root, 'app.ts', 'export const alternate = true;\n');
  const diverged = save(f.root, 'diverged');
  assert.throws(() => checkPush(f.root, refLine(f.head, diverged)), /Non-fast-forward/);
});

test('new branch must cover all unpublished commits from a known target-remote base', async (t) => {
  const f = fixture(t);
  await approve(f);
  assert.equal(checkPush(f.root, refLine(f.head)).length, 1);
  write(f.root, 'app.ts', 'export const value = 3;\n');
  const next = save(f.root, 'second unpublished change');
  await approve(f, f.head, next);
  assert.throws(() => checkPush(f.root, refLine(next)), /New branch base is not known/);
  assert.throws(() => checkPush(f.root, refLine(f.head), { remote: 'unknown' }), /fetch a dedicated named remote/);
  git(f.root, 'update-ref', 'refs/remotes/origin/published', f.head);
  assert.equal(checkPush(f.root, refLine(next)).length, 1);
});

test('new branch cannot borrow history from a different push URL or multiple push targets', async (t) => {
  const f = fixture(t);
  await approve(f);
  const fetched = git(f.root, 'remote', 'get-url', 'origin');
  assert.equal(checkPush(f.root, refLine(f.head), { remote: 'origin', remoteURL: fetched }).length, 1);
  assert.throws(() => checkPush(f.root, refLine(f.head), { remote: 'origin', remoteURL: '/different/repo.git' }), /target URL/);
  git(f.root, 'config', 'remote.origin.pushurl', '/different/repo.git');
  assert.throws(() => checkPush(f.root, refLine(f.head)), /target URL/);
  git(f.root, 'config', 'remote.origin.pushurl', fetched);
  git(f.root, 'config', '--add', 'remote.origin.pushurl', '/second/repo.git');
  assert.throws(() => checkPush(f.root, refLine(f.head)), /target URL/);
});

test('same tree with a different commit SHA cannot reuse evidence', async (t) => {
  const f = fixture(t);
  await approve(f);
  git(f.root, 'commit', '--allow-empty', '-qm', 'same tree new commit');
  const head = git(f.root, 'rev-parse', 'HEAD');
  assert.equal(git(f.root, 'rev-parse', `${f.head}^{tree}`), git(f.root, 'rev-parse', `${head}^{tree}`));
  const target = receiptPath(f, 'tests', head);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(receiptPath(f), target);
  fs.copyFileSync(receiptPath(f, 'review'), receiptPath(f, 'review', head));
  assert.throws(() => checkPush(f.root, refLine(head, f.base)), /exact pushed SHA\/tree/);
});

test('missing review, changed reports and removed reports cannot pass', async (t) => {
  const f = fixture(t);
  await verifyPush(f.root, { base: f.base, runner: successful });
  assert.throws(() => checkPush(f.root, refLine(f.head, f.base)), /missing or unreadable/);
  const report = review(f);
  recordReview(f.root, report.args);
  fs.appendFileSync(report.filename, '\n');
  assert.throws(() => checkPush(f.root, refLine(f.head, f.base)), /report changed/);
  recordReview(f.root, report.args);
  fs.rmSync(report.filename);
  assert.throws(() => checkPush(f.root, refLine(f.head, f.base)), /existing, readable JSON/);
});

test('rejects receipt mutation and recomputed checksums with incomplete command results', async (t) => {
  const f = fixture(t);
  await approve(f);
  const filename = receiptPath(f);
  const receipt = JSON.parse(fs.readFileSync(filename, 'utf8'));
  receipt.payload.results.pop();
  fs.writeFileSync(filename, JSON.stringify(receipt));
  assert.throws(() => checkPush(f.root, refLine(f.head, f.base)), /checksum mismatch/);
  receipt.digest = createHash('sha256').update(JSON.stringify(receipt.payload)).digest('hex');
  fs.writeFileSync(filename, JSON.stringify(receipt));
  assert.throws(() => checkPush(f.root, refLine(f.head, f.base)), /required fixed checks/);
});

test('review requires exact range, reviewer identity fields and no unresolved P0/P1', (t) => {
  const f = fixture(t);
  for (const overrides of [
    { base: f.old }, { sha: f.base }, { reviewer: 'different-agent' },
    { verdict: 'fail' }, { unresolvedP0: 1 }, { unresolvedP1: 1 }, { summary: '' },
  ]) {
    assert.throws(() => recordReview(f.root, review(f, f.base, f.head, overrides).args), /Review report must match/);
  }
});

test('test and review ranges must match even when both independently cover remote old', async (t) => {
  const f = fixture(t);
  await approve(f);
  recordReview(f.root, review(f, f.old).args);
  assert.throws(() => checkPush(f.root, refLine(f.head, f.base)), /same base/);
});

for (const result of [{ code: 1, signal: null }, { code: null, signal: 'SIGTERM' }]) {
  test(`failed/interrupted verification removes an old pass (${result.code ?? result.signal})`, async (t) => {
    const f = fixture(t);
    await approve(f);
    await assert.rejects(verifyPush(f.root, { base: f.base, runner: async () => result }), /failed\/interrupted/);
    assert.equal(fs.existsSync(receiptPath(f)), false);
  });
}

test('source, index or HEAD changes during checks prevent a passing receipt', async (t) => {
  for (const change of ['source', 'index', 'HEAD']) {
    const f = fixture(t);
    await assert.rejects(verifyPush(f.root, { base: f.base, runner: async () => {
      if (change === 'HEAD') git(f.root, 'commit', '--allow-empty', '-qm', 'moved during verification');
      else {
        write(f.root, 'app.ts', 'export const changed = true;\n');
        if (change === 'index') git(f.root, 'add', 'app.ts');
      }
      return successful();
    } }), /clean index|HEAD\/tree changed/);
    assert.equal(fs.existsSync(receiptPath(f)), false);
  }
});

test('concurrent verifiers cannot overlap or leave another run green after failure', async (t) => {
  const f = fixture(t);
  await approve(f);
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const first = verifyPush(f.root, { base: f.base, runner: () => blocked });
  await assert.rejects(verifyPush(f.root, { base: f.base, runner: successful }), /already running or was interrupted/);
  assert.throws(() => checkPush(f.root, refLine(f.head)), /active or interrupted/);
  release({ code: 1, signal: null });
  await assert.rejects(first, /failed\/interrupted/);
  assert.equal(fs.existsSync(receiptPath(f)), false);
  assert.equal(fs.existsSync(path.join(repository(f.root).evidence, 'verify.lock')), false);
});

test('rejects tracked and untracked dirt before running, allowing only untracked local settings', async (t) => {
  const f = fixture(t);
  await approve(f);
  write(f.root, 'untracked.txt', 'unfinished\n');
  await assert.rejects(verifyPush(f.root, { base: f.base, runner: successful }), /no untracked files/);
  assert.equal(fs.existsSync(receiptPath(f)), false);
  fs.rmSync(path.join(f.root, 'untracked.txt'));
  write(f.root, '.vscode/settings.json', '{}');
  write(f.root, 'artifacts/ignored.txt', 'ignored');
  await verifyPush(f.root, { base: f.base, runner: successful });
  git(f.root, 'add', '.vscode/settings.json');
  save(f.root, 'track settings');
  write(f.root, '.vscode/settings.json', '{"changed":true}');
  await assert.rejects(verifyPush(f.root, { base: f.base, runner: successful }), /clean index/);
});

test('documentation-only verification actually checks links, fences and whitespace', async (t) => {
  const f = fixture(t);
  const base = f.head;
  write(f.root, 'README.md', '# Fixture\n\n[Source](app.ts)\n\n```ts\nconst demo = true;\n```\n');
  const head = save(f.root, 'documentation only');
  const receipt = await verifyPush(f.root, { base, runner: async () => assert.fail('documentation must run its real checks') });
  assert.equal(receipt.mode, 'docs');
  recordReview(f.root, review(f, base, head).args);
  assert.equal(checkPush(f.root, refLine(head, base)).length, 1);
  write(f.root, 'README.md', '# Broken\n\n[Missing](missing.md)\n\n```js\nunclosed\n');
  const broken = save(f.root, 'broken documentation');
  assert.throws(() => checkDocumentation(f.root, head, broken), /unclosed.*\n.*missing committed/s);
  await assert.rejects(verifyPush(f.root, { base: head }), /Documentation verification failed/);
  write(f.root, 'README.md', '# Trailing spaces  \n');
  save(f.root, 'whitespace');
  await assert.rejects(verifyPush(f.root, { base: head }), /failed\/interrupted/);
});

test('a mixed or empty-tree code range cannot downgrade to documentation verification', async (t) => {
  const f = fixture(t);
  write(f.root, 'README.md', '# Documentation plus code\n');
  const head = save(f.root, 'mixed change');
  const receipt = await verifyPush(f.root, { base: f.base, runner: successful });
  assert.equal(receipt.mode, 'web');
  git(f.root, 'commit', '--allow-empty', '-qm', 'empty tree');
  assert.equal((await verifyPush(f.root, { base: head, runner: successful })).mode, 'web');
  await assert.rejects(verifyPush(f.root, { base: git(f.root, 'rev-parse', 'HEAD'), runner: successful }), /strict ancestor/);
});

for (const operation of ['delete', 'move']) {
  test(`documentation ${operation} checks incoming references from unchanged files`, async (t) => {
    const f = fixture(t);
    write(f.root, 'docs/target.md', '# Target\n');
    write(f.root, 'README.md', '# Fixture\n\n[Target](docs/target.md)\n');
    const base = save(f.root, 'linked document');
    if (operation === 'delete') fs.rmSync(path.join(f.root, 'docs/target.md'));
    else fs.renameSync(path.join(f.root, 'docs/target.md'), path.join(f.root, 'docs/moved.md'));
    save(f.root, `${operation} target without updating its caller`);
    await assert.rejects(verifyPush(f.root, { base }), /README.md: missing committed local link docs\/target.md/);
  });
}

test('install is persistent, executable, effective and idempotent with space-containing paths', (t) => {
  const f = fixture(t);
  const installed = installHooks(f.root);
  assert.ok(path.isAbsolute(git(f.root, 'config', '--get', 'core.hooksPath')));
  assert.ok(fs.statSync(installed.loader).mode & 0o111);
  assert.deepEqual(installHooks(f.root), installed);
  assert.deepEqual(checkHooks(f.root), installed);
});

test('new clone requires explicit installation and never inherits local evidence/config', async (t) => {
  const f = fixture(t);
  await approve(f);
  installHooks(f.root);
  const clone = path.join(f.temporary, 'fresh clone');
  git(f.temporary, 'clone', '-q', f.root, clone);
  assert.throws(() => checkHooks(clone), /not installed\/effective/);
  installHooks(clone);
  assert.throws(() => checkPush(clone, refLine(f.head, f.base)), /missing or unreadable/);
});

test('linked worktree uses common hooks/evidence and missing-guard old branches fail closed', async (t) => {
  const f = fixture(t);
  await approve(f);
  const installed = installHooks(f.root);
  const linked = path.join(f.temporary, 'linked worktree with spaces');
  git(f.root, 'worktree', 'add', '-q', '--detach', linked, f.head);
  assert.equal(repository(linked).common, repository(f.root).common);
  assert.deepEqual(checkHooks(linked), installed);
  // `git hook run` does not forward its stdin. Execute the real installed loader
  // with Git's four-field protocol so this tests actual ref validation as well.
  const invoke = (input) => spawnSync(installed.loader, ['origin', git(f.root, 'remote', 'get-url', 'origin')], {
    cwd: linked, input, encoding: 'utf8',
  });
  const pushed = invoke(refLine(f.head, f.base));
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.match(pushed.stdout, /accepted for 1 changed branch ref/);
  const main = invoke(refLine(f.head, f.base, 'refs/heads/main'));
  assert.notEqual(main.status, 0);
  assert.match(main.stderr, /Direct pushes to main are blocked/);
  git(linked, 'commit', '--allow-empty', '-qm', 'unverified linked worktree commit');
  const unverified = invoke(refLine(git(linked, 'rev-parse', 'HEAD'), f.head));
  assert.notEqual(unverified.status, 0);
  assert.match(unverified.stderr, /Evidence is missing or unreadable/);
  git(linked, 'checkout', '-q', f.old);
  const result = invoke('');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /this worktree has no scripts\/git-workflow/);
});

test('install preserves existing custom hooks and refuses unmanaged/damaged loaders', (t) => {
  const f = fixture(t);
  const custom = path.join(f.temporary, 'custom hooks');
  git(f.root, 'config', 'core.hooksPath', custom);
  assert.throws(() => installHooks(f.root), /Existing custom core.hooksPath is preserved/);
  assert.equal(git(f.root, 'config', 'core.hooksPath'), custom);
  git(f.root, 'config', '--unset', 'core.hooksPath');
  const defaultHook = path.join(repository(f.root).common, 'hooks/pre-commit');
  fs.writeFileSync(defaultHook, '#!/bin/sh\nexit 0\n');
  assert.throws(() => installHooks(f.root), /Existing default hooks are preserved/);
  fs.rmSync(defaultHook);
  const installed = installHooks(f.root);
  fs.appendFileSync(installed.loader, '# custom\n');
  assert.throws(() => installHooks(f.root), /customized or damaged/);
  assert.throws(() => checkHooks(f.root), /outdated/);
});

test('CLI rejects skip arguments and CI prepare does not install hooks', (t) => {
  const f = fixture(t);
  const script = path.join(f.root, 'scripts/git-workflow.mjs');
  const result = spawnSync(process.execPath, [script, 'verify', '--base', f.base, '--skip-tests', 'true'], { cwd: f.root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected\/missing argument/);
  const prepare = spawnSync(process.execPath, [script, 'prepare'], { cwd: f.root, env: { ...process.env, CI: 'true' }, encoding: 'utf8' });
  assert.equal(prepare.status, 0, prepare.stderr);
  assert.match(prepare.stdout, /installation skipped/);
  assert.throws(() => checkHooks(f.root), /not installed\/effective/);
});
