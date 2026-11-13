import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verificationPlan } from './verification-plan.mjs';

const ownPath = fileURLToPath(import.meta.url);
const version = 1;
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const zeroPattern = /^(?:0{40}|0{64})$/;
const fixedEnvironment = {
  CI: 'true',
  NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3100',
  SITE_INDEXABLE: 'false',
  NEXT_TELEMETRY_DISABLED: '1',
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(message); };

function git(repo, args, allowFailure = false) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) fail(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result;
}

export function repository(cwd) {
  const root = fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).stdout.trim());
  const common = fs.realpathSync(path.resolve(root, git(root, ['rev-parse', '--git-common-dir']).stdout.trim()));
  return { root, common, evidence: path.join(common, 'hd-auto-evidence'), hooks: path.join(common, 'hd-auto-hooks') };
}

function commit(repo, sha) {
  if (!oidPattern.test(sha ?? '')) fail('Use a full lowercase commit SHA (not a branch, tag, or abbreviated SHA).');
  const result = git(repo, ['cat-file', '-t', sha], true);
  if (result.status !== 0 || result.stdout.trim() !== 'commit') fail(`Commit is unavailable or is not a commit: ${sha}. Fetch the required history first.`);
  return sha;
}

function ancestor(repo, base, head) {
  const result = git(repo, ['merge-base', '--is-ancestor', base, head], true);
  if (result.status !== 0 && result.status !== 1) fail(`Cannot inspect ancestry: ${result.stderr.trim()}`);
  return result.status === 0;
}

function range(repo, base, head) {
  commit(repo, base);
  commit(repo, head);
  if (base === head || !ancestor(repo, base, head)) fail('The base must be a strict ancestor of the reviewed/verified commit.');
}

function tree(repo, sha) { return git(repo, ['rev-parse', `${sha}^{tree}`]).stdout.trim(); }
function headOf(repo) { return git(repo, ['rev-parse', 'HEAD']).stdout.trim(); }

function cleanSnapshot(repo) {
  const tracked = git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=no']).stdout;
  const untracked = git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).stdout
    .split('\0').filter((name) => name && !name.startsWith('.vscode/'));
  if (tracked || untracked.length) {
    fail(`Verification requires a clean index and tracked worktree, with no untracked files except local .vscode/: ${untracked.join(', ') || 'tracked/index changes'}`);
  }
  return { head: headOf(repo), tree: tree(repo, 'HEAD') };
}

function changedFiles(repo, base, head) {
  return git(repo, ['diff', '--name-only', '--no-renames', '-z', base, head]).stdout.split('\0').filter(Boolean);
}

export function planFor(repo, base, head, { full = false } = {}) {
  const files = changedFiles(repo, base, head);
  // Read the actual pushed commit, including non-HEAD refs; never trust an uncommitted policy.
  const readStage = (sha) => {
    const result = git(repo, ['show', `${sha}:.github/verification-policy.json`], true);
    try { return JSON.parse(result.stdout).stage; } catch { return 'production'; }
  };
  const stage = [readStage(base), readStage(head)].every((value) => value === 'development')
    ? 'development' : 'production';
  const plan = verificationPlan(files, { stage, full });
  return plan.mode === 'docs'
    ? { mode: 'docs', commands: [['git', 'diff', '--check', base, head], ['internal:markdown-links-and-fences']] }
    : plan;
}

/** CI uses the same selection as the local gate, without generating local review receipts. */
export async function verifyCI(cwd, { base, full, runner = runCommand } = {}) {
  if (!['true', 'false'].includes(full)) fail('CI --full must be true or false.');
  const info = repository(cwd);
  const head = headOf(info.root);
  if (!oidPattern.test(base ?? '')) fail('CI base must be a full commit SHA.');
  git(info.root, ['cat-file', '-e', `${base}^{commit}`]);
  git(info.root, ['merge-base', '--is-ancestor', base, head]);
  const plan = planFor(info.root, base, head, { full: full === 'true' });
  console.log(`Verification scope: ${plan.mode}`);
  for (const command of plan.commands) {
    if (command[0] === 'internal:markdown-links-and-fences') {
      checkDocumentation(info.root, base, head);
      continue;
    }
    // Browser download is needed only for a full run, not daily scoped checks.
    if (command.join(' ') === 'pnpm test:e2e') {
      const browser = await runner(['pnpm', '--filter', '@hd/web', 'exec', 'playwright', 'install', '--with-deps', 'chrome'], { cwd: info.root, env: process.env });
      if (browser.code !== 0 || browser.signal) fail('CI browser installation failed.');
    }
    console.log(command.join(' '));
    const result = await runner(command, { cwd: info.root, env: process.env });
    if (result.code !== 0 || result.signal) fail(`CI verification failed: ${command.join(' ')}`);
  }
  return plan;
}

/** Fixed application inputs; inherited service URLs, secrets and runner flags are excluded. */
export function verificationEnvironment(source = process.env) {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM'];
  return { ...Object.fromEntries(allowed.filter((name) => source[name]).map((name) => [name, source[name]])), ...fixedEnvironment };
}

function runCommand(argv, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

function atomicJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, filename);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

const evidencePath = (info, sha, kind) => path.join(info.evidence, sha, `${kind}.json`);
function writeReceipt(filename, payload) {
  atomicJson(filename, { payload, digest: hash(JSON.stringify(payload)) });
}

function readReceipt(filename) {
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch { fail(`Evidence is missing or unreadable: ${filename}`); }
  if (!receipt.payload || receipt.digest !== hash(JSON.stringify(receipt.payload))) fail(`Evidence checksum mismatch: ${filename}`);
  if (receipt.payload.version !== version) fail(`Evidence version is unsupported: ${filename}`);
  return receipt.payload;
}

/** Check changed Markdown, ignoring fenced examples and external/fragment links. */
export function checkDocumentation(repo, base, head) {
  const issues = [];
  const checked = [];
  const changed = changedFiles(repo, base, head);
  for (const name of changed) {
    if (!name.endsWith('.md')) fail(`Non-Markdown file cannot use documentation verification: ${name}`);
  }
  const deleted = changed.filter((name) => git(repo, ['cat-file', '-e', `${head}:${name}`], true).status !== 0);
  const candidates = deleted.length
    ? git(repo, ['ls-tree', '-rz', '--name-only', head]).stdout.split('\0').filter((name) => name.endsWith('.md'))
    : changed;
  for (const name of candidates) {
    const result = git(repo, ['show', `${head}:${name}`], true);
    if (result.status !== 0) continue; // Deleted Markdown has no content to inspect.
    checked.push(name);
    let fence = null;
    const prose = [];
    for (const [index, line] of result.stdout.split('\n').entries()) {
      const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (marker && !fence) fence = { character: marker[1][0], length: marker[1].length, line: index + 1 };
      else if (marker && marker[1][0] === fence?.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      else if (!fence) prose.push(line);
    }
    if (fence && changed.includes(name)) issues.push(`${name}:${fence.line}: unclosed Markdown fence`);
    const text = prose.join('\n');
    const targets = [
      ...text.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*["'])?\s*\)/g),
      ...text.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm),
    ];
    for (const match of targets) {
      const raw = match[1].replace(/^<|>$/g, '');
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(raw)) continue;
      let target;
      try { target = decodeURIComponent(raw.split(/[?#]/, 1)[0]); }
      catch { issues.push(`${name}: malformed local URL ${raw}`); continue; }
      if (!target) continue;
      const resolved = path.resolve(path.dirname(path.join(repo, name)), target);
      const relative = path.relative(repo, resolved).split(path.sep).join('/');
      // On deletion/move also inspect incoming links in unchanged documents;
      // unrelated legacy broken links do not turn this into an archive rewrite.
      if (!changed.includes(name) && !deleted.some((item) => item === relative || item.startsWith(`${relative}/`))) continue;
      if (relative.startsWith('../') || path.isAbsolute(relative) ||
        git(repo, ['cat-file', '-e', `${head}:${relative}`], true).status !== 0) {
        issues.push(`${name}: missing committed local link ${raw}`);
      }
    }
  }
  if (issues.length) fail(`Documentation verification failed:\n${issues.join('\n')}`);
  return checked;
}

/** runner injection exists for isolated fixture tests only; the CLI always uses runCommand. */
export async function verifyPush(cwd, { base, runner = runCommand } = {}) {
  const info = repository(cwd);
  fs.mkdirSync(info.evidence, { recursive: true, mode: 0o700 });
  const lock = path.join(info.evidence, 'verify.lock');
  try { fs.mkdirSync(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    fail(`Verification is already running or was interrupted. Inspect ${lock} and its owner.json; only remove a stale lock after confirming that no validator is running.`);
  }
  try {
    atomicJson(path.join(lock, 'owner.json'), { pid: process.pid, worktree: info.root, startedAt: new Date().toISOString() });
    return await verifyLocked(info, { base, runner });
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

async function verifyLocked(info, { base, runner }) {
  const head = headOf(info.root);
  const receiptPath = evidencePath(info, head, 'tests');
  // Never let a failed, interrupted or dirty rerun retain the old green receipt.
  fs.rmSync(receiptPath, { force: true });
  const snapshot = cleanSnapshot(info.root);
  if (snapshot.head !== head) fail('HEAD changed at verification start; no passing receipt was saved.');
  range(info.root, base, head);
  const plan = planFor(info.root, base, head);
  const environment = verificationEnvironment();
  const results = [];
  for (const command of plan.commands) {
    const started = Date.now();
    let result;
    if (command[0] === 'internal:markdown-links-and-fences') {
      checkDocumentation(info.root, base, head);
      result = { code: 0, signal: null };
    } else if (plan.mode === 'docs') {
      const output = git(info.root, command.slice(1), true);
      result = { code: output.status, signal: output.signal };
      if (output.stdout) process.stdout.write(output.stdout);
      if (output.stderr) process.stderr.write(output.stderr);
    } else {
      console.log(`Verifying ${head}: ${command.join(' ')}`);
      result = await runner(command, { cwd: info.root, env: environment });
    }
    if (result.code !== 0 || result.signal) {
      fail(`Verification failed/interrupted: ${command.join(' ')} (exit ${result.code}, signal ${result.signal ?? 'none'}). No passing receipt was saved. Port 3100 must be free; do not reuse or terminate another preview.`);
    }
    results.push({ command, exitCode: 0, elapsedMs: Date.now() - started });
    const current = cleanSnapshot(info.root);
    if (current.head !== snapshot.head || current.tree !== snapshot.tree) fail('HEAD/tree changed during verification; no passing receipt was saved.');
  }
  const payload = {
    version, kind: 'tests', base, head, tree: snapshot.tree, mode: plan.mode,
    environment: fixedEnvironment, runtime: { node: process.version, platform: process.platform, arch: process.arch },
    results, completedAt: new Date().toISOString(),
  };
  writeReceipt(receiptPath, payload);
  return { path: receiptPath, ...payload };
}

function reportContents(filename, { base, sha, reviewer }) {
  let contents;
  let report;
  try { contents = fs.readFileSync(filename, 'utf8'); report = JSON.parse(contents); }
  catch { fail('Independent review report must be an existing, readable JSON file.'); }
  if (!reviewer?.trim() || report.reviewer !== reviewer || report.base !== base || report.sha !== sha ||
    report.verdict !== 'pass' || report.unresolvedP0 !== 0 || report.unresolvedP1 !== 0 ||
    typeof report.summary !== 'string' || !report.summary.trim()) {
    fail('Review report must match exact base, sha, reviewer, verdict="pass", unresolvedP0=0, unresolvedP1=0 and a nonempty summary.');
  }
  return { sha256: hash(contents), conclusion: report };
}

export function recordReview(cwd, { base, sha, reviewer, report: reportPath } = {}) {
  const info = repository(cwd);
  commit(info.root, sha);
  const filename = evidencePath(info, sha, 'review');
  fs.rmSync(filename, { force: true });
  range(info.root, base, sha);
  if (!reportPath) fail('An independent review report path is required.');
  const report = fs.realpathSync(path.resolve(info.root, reportPath));
  const checked = reportContents(report, { base, sha, reviewer });
  const payload = {
    version, kind: 'review', base, head: sha, tree: tree(info.root, sha),
    reviewer, report, ...checked, recordedAt: new Date().toISOString(),
  };
  writeReceipt(filename, payload);
  return { path: filename, ...payload };
}

function validateEvidence(info, sha, old, remote, remoteURL) {
  const tests = readReceipt(evidencePath(info, sha, 'tests'));
  const review = readReceipt(evidencePath(info, sha, 'review'));
  for (const [kind, receipt] of [['tests', tests], ['review', review]]) {
    if (receipt.kind !== kind || receipt.head !== sha || receipt.tree !== tree(info.root, sha)) fail(`Evidence does not match the exact pushed SHA/tree: ${sha}`);
    range(info.root, receipt.base, sha);
    if (!zeroPattern.test(old) && !ancestor(info.root, receipt.base, old)) fail(`Remote old SHA is before/outside the verified range. Reverify and review from a base at or before ${old}.`);
  }
  if (tests.base !== review.base) fail('Test and independent review evidence must use the same base.');
  if (zeroPattern.test(old)) {
    const remotes = git(info.root, ['remote']).stdout.trim().split('\n');
    const fetchURLs = remotes.includes(remote)
      ? git(info.root, ['remote', 'get-url', '--all', remote]).stdout.trim().split('\n') : [];
    const pushURLs = remotes.includes(remote)
      ? git(info.root, ['remote', 'get-url', '--push', '--all', remote]).stdout.trim().split('\n') : [];
    if (fetchURLs.length !== 1 || pushURLs.length !== 1 || fetchURLs[0] !== pushURLs[0] ||
      (remoteURL !== undefined && remoteURL !== fetchURLs[0])) {
      fail('New branch target URL is not the single fetched remote URL. Configure and fetch a dedicated named remote for the actual push destination.');
    }
    const publicTips = remotes.includes(remote)
      ? git(info.root, ['for-each-ref', '--format=%(objectname)', `refs/remotes/${remote}/`]).stdout.trim().split('\n').filter(Boolean)
      : [];
    if (!publicTips.some((tip) => ancestor(info.root, tests.base, tip))) {
      fail(`New branch base is not known in target remote ${remote}. Fetch that named remote and choose a published base covering all new commits; the hook does not fetch automatically.`);
    }
  }
  const plan = planFor(info.root, tests.base, sha);
  if (tests.mode !== plan.mode || JSON.stringify(tests.environment) !== JSON.stringify(fixedEnvironment) ||
    !Array.isArray(tests.results) || tests.results.length !== plan.commands.length ||
    tests.results.some((result, index) => result.exitCode !== 0 || JSON.stringify(result.command) !== JSON.stringify(plan.commands[index]))) {
    fail('Test receipt does not contain the required fixed checks/environment. Run verify:push again.');
  }
  const checked = reportContents(review.report, { base: review.base, sha, reviewer: review.reviewer });
  if (checked.sha256 !== review.sha256 || JSON.stringify(checked.conclusion) !== JSON.stringify(review.conclusion)) fail('Independent review report changed after recording; review and record again.');
}

export function checkPush(cwd, input, { remote = 'origin', remoteURL } = {}) {
  const info = repository(cwd);
  const checked = [];
  for (const line of input.split(/\r?\n/).filter((line) => line.trim())) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 4 || !oidPattern.test(parts[1]) || !oidPattern.test(parts[3])) fail('Malformed pre-push ref input.');
    const [localRef, sha, remoteRef, old] = parts;
    if (sha === old) continue;
    if (fs.existsSync(path.join(info.evidence, 'verify.lock'))) fail('Verification is active or interrupted; resolve its lock before pushing.');
    if (remoteRef === 'refs/heads/main') fail('Direct pushes to main are blocked. Push a topic branch and use a pull request.');
    if (zeroPattern.test(sha)) fail(`Ref deletion is blocked: ${remoteRef}`);
    if (!remoteRef.startsWith('refs/heads/')) fail(`Only branch commits can be pushed; tags/non-branch refs are blocked: ${remoteRef}`);
    commit(info.root, sha);
    if (!zeroPattern.test(old)) {
      commit(info.root, old);
      if (!ancestor(info.root, old, sha)) fail(`Non-fast-forward push is blocked: ${remoteRef}`);
    }
    validateEvidence(info, sha, old, remote, remoteURL);
    checked.push({ localRef, sha, remoteRef });
  }
  return checked;
}

function loaderSource(info) { return fs.readFileSync(path.join(info.root, '.githooks/pre-push'), 'utf8'); }
function effectiveHookPath(info) {
  const result = git(info.root, ['config', '--path', '--get', 'core.hooksPath'], true);
  if (result.status !== 0 && result.status !== 1) fail('Cannot inspect core.hooksPath.');
  return result.status === 0 ? path.resolve(info.root, result.stdout.trim()) : null;
}

export function installHooks(cwd) {
  const info = repository(cwd);
  const configured = effectiveHookPath(info);
  if (configured && configured !== info.hooks) fail(`Existing custom core.hooksPath is preserved: ${configured}. Integrate it explicitly before installing HD Auto hooks.`);
  if (!configured) {
    const defaults = path.join(info.common, 'hooks');
    const custom = fs.existsSync(defaults) && fs.readdirSync(defaults).filter((name) => !name.endsWith('.sample'));
    if (custom?.length) fail(`Existing default hooks are preserved: ${custom.join(', ')}. Integrate them explicitly before installing HD Auto hooks.`);
  }
  const loader = path.join(info.hooks, 'pre-push');
  const marker = path.join(info.hooks, 'managed.json');
  if (fs.existsSync(info.hooks)) {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch { fail('Existing hd-auto-hooks directory is not managed; refusing to overwrite it.'); }
    if (saved.owner !== 'hd-auto-export' || !fs.existsSync(loader) || hash(fs.readFileSync(loader)) !== saved.loaderHash) {
      fail('Installed loader was customized or damaged; refusing to overwrite it.');
    }
  }
  const source = loaderSource(info);
  fs.mkdirSync(info.hooks, { recursive: true, mode: 0o700 });
  fs.writeFileSync(loader, source, { mode: 0o755 });
  fs.chmodSync(loader, 0o755);
  atomicJson(marker, { owner: 'hd-auto-export', loaderHash: hash(source) });
  git(info.root, ['config', '--local', 'core.hooksPath', info.hooks]);
  return checkHooks(info.root);
}

export function checkHooks(cwd) {
  const info = repository(cwd);
  if (effectiveHookPath(info) !== info.hooks || git(info.root, ['config', '--get', 'core.hooksPath'], true).stdout.trim() !== info.hooks) {
    fail('Persistent pre-push hook is not installed/effective with an absolute common-directory path. Run pnpm hooks:install.');
  }
  const loader = path.join(info.hooks, 'pre-push');
  if (!fs.existsSync(loader) || !(fs.statSync(loader).mode & 0o111) || fs.readFileSync(loader, 'utf8') !== loaderSource(info)) {
    fail('Persistent pre-push loader is missing, not executable or outdated. Run pnpm hooks:install.');
  }
  const result = spawnSync('git', ['-C', info.root, 'hook', 'run', 'pre-push', '--', 'hd-hooks-check', ''], { input: '', encoding: 'utf8' });
  if (result.error || result.status !== 0) fail(`The configured pre-push hook did not execute successfully: ${result.stderr || result.error}`);
  return { hooksPath: info.hooks, loader };
}

function options(args, required) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]?.replace(/^--/, '');
    if (args[index] !== `--${name}` || !required.includes(name) || Object.hasOwn(result, name) || !args[index + 1]) fail(`Unexpected/missing argument: ${args[index]}`);
    result[name] = args[index + 1];
  }
  for (const name of required) if (!result[name]) fail(`Required argument: --${name}`);
  return result;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const cwd = process.cwd();
  if (command === 'ci') console.log(JSON.stringify(await verifyCI(cwd, options(args, ['base', 'full'])), null, 2));
  else if (command === 'verify') console.log(JSON.stringify(await verifyPush(cwd, options(args, ['base'])), null, 2));
  else if (command === 'review-record') {
    console.log(JSON.stringify(recordReview(cwd, options(args, ['base', 'sha', 'reviewer', 'report'])), null, 2));
    console.log('Recorded local workflow evidence only; this does not authenticate reviewer identity.');
  } else if (command === 'pre-push') {
    if (args.length !== 2) fail('pre-push expects Git remote name and URL arguments.');
    const refs = checkPush(cwd, fs.readFileSync(0, 'utf8'), { remote: args[0], remoteURL: args[1] });
    console.log(`Pre-push evidence accepted for ${refs.length} changed branch ref(s).`);
  } else if (['hooks-install', 'hooks-check', 'prepare'].includes(command)) {
    if (args.length) fail('Hook commands take no arguments.');
    if (command === 'prepare' && process.env.CI) console.log('CI: automatic hook installation skipped; local clones use pnpm hooks:install.');
    else console.log(JSON.stringify(command === 'hooks-check' ? checkHooks(cwd) : installHooks(cwd), null, 2));
  } else fail('Commands: hooks-install | hooks-check | verify --base SHA | review-record --base SHA --sha SHA --reviewer ID --report FILE');
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  main().catch((error) => { console.error(`Git workflow: ${error.message}`); process.exitCode = 1; });
}
