/** Runs the browser against the real API and an exclusively owned disposable local DB. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(adminRoot, '../..');
const translationProvider = process.env.ADMIN_LIVE_TRANSLATION_PROVIDER ?? 'disabled';
const aliyunCase = '(?:^| )real Aliyun international Chinese suggestion persistence$';
const playwrightArgs = process.argv.slice(2);
if (!['disabled', 'libretranslate', 'aliyun'].includes(translationProvider)) throw new Error('Unsupported isolated translation test mode.');
let localTranslationUrl;
if (translationProvider === 'libretranslate') {
  const endpoint = new URL(process.env.LIBRETRANSLATE_URL ?? 'http://127.0.0.1:3340');
  if (!['http:', 'https:'].includes(endpoint.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.port !== '3340' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('Live machine translation requires a loopback-only service on port 3340 without credentials, a path, or query parameters.');
  }
  if (!process.env.LIBRETRANSLATE_ENGINE_VERSION) throw new Error('Record the actual local model version before running live machine translation.');
  localTranslationUrl = endpoint.toString();
}
if (translationProvider === 'aliyun') {
  // This is the only paid-provider mode. All gates run before temporary data or a server is created.
  if (process.env.ADMIN_LIVE_ALIYUN_CONFIRM !== 'synthetic-only') throw new Error('Aliyun tests require the explicit synthetic-only confirmation.');
  if (process.env.ALI_MT_REGION !== 'ap-southeast-1') throw new Error('Aliyun tests require the explicitly selected Singapore region.');
  if (!process.env.ALI_MT_ACCESS_KEY_ID?.trim() || !process.env.ALI_MT_ACCESS_KEY_SECRET?.trim()) throw new Error('Aliyun test credentials must already be configured privately.');
  if (playwrightArgs.length !== 2 || playwrightArgs[0] !== '--grep' || playwrightArgs[1] !== aliyunCase) throw new Error('Aliyun mode permits exactly the single approved synthetic test.');
}
const maintenanceUrl = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if (!['localhost', '127.0.0.1'].includes(maintenanceUrl.hostname) || maintenanceUrl.pathname !== '/postgres') {
  throw new Error('Live browser tests require a local /postgres maintenance database.');
}
const databaseName = `hd_admin_test_${randomBytes(8).toString('hex')}`;
const databaseUrl = new URL(maintenanceUrl);
databaseUrl.pathname = `/${databaseName}`;
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'hd-admin-browser-'));
const origin = 'http://127.0.0.1:3319';
const env = {
  ...process.env, ADMIN_LIVE_ORIGIN: '', ADMIN_TEST_EMAIL: 'browser-test@example.invalid', NODE_ENV: 'test', DATABASE_URL: databaseUrl.toString(),
  API_TEST_DATABASE_URL: maintenanceUrl.toString(), ADMIN_TEST_DB_NAME: databaseName,
  AUTH_SECRET: randomBytes(32).toString('hex'), AUTH_BASE_URL: origin, TRUSTED_ORIGINS: origin,
  HOST: '127.0.0.1', PORT: '3322', MEDIA_ROOT: path.join(temporaryRoot, 'media'),
  ADMIN_API_TARGET: 'http://127.0.0.1:3322', ADMIN_LIVE_TEST: '1', TRANSLATION_PROVIDER: translationProvider,
  ADMIN_LIVE_TRANSLATION_PROVIDER: translationProvider,
  ADMIN_TEST_PASSWORD: randomBytes(24).toString('base64url'),
};
// Generic credential aliases and local-service API keys never enter a test child process.
for (const key of ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN', 'LIBRETRANSLATE_API_KEY']) delete env[key];
if (translationProvider !== 'aliyun') {
  for (const key of ['ALI_MT_ACCESS_KEY_ID', 'ALI_MT_ACCESS_KEY_SECRET', 'ALI_MT_SECURITY_TOKEN']) delete env[key];
} else {
  // The provider owns its fixed official endpoint; this runner adds no host/URL option.
  env.ALI_MT_REGION = 'ap-southeast-1';
  env.ALI_MT_CONFIG_VERSION = process.env.ALI_MT_CONFIG_VERSION?.trim() || '1';
  env.TRANSLATION_MAX_CHARACTERS_PER_HOUR = '500';
  if (!env.ALI_MT_SECURITY_TOKEN?.trim()) delete env.ALI_MT_SECURITY_TOKEN;
}
if (translationProvider === 'libretranslate') env.LIBRETRANSLATE_URL = localTranslationUrl;
else { delete env.LIBRETRANSLATE_URL; delete env.LIBRETRANSLATE_ENGINE_VERSION; }
let api;
let created = false;

async function requireFreePort(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}

function command(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, { cwd: repositoryRoot, env, stdio: ['pipe', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Test prerequisite exited with status ${code}`)));
    child.stdin.end(input ?? '');
  });
}

// Execute database tooling inside the API package, which owns the pg dependency.
// Admin application/test code never imports another application's source.
async function database(operation) {
  await command(['--filter', '@hd/api', 'exec', 'node', '--input-type=module', '--eval', `
    import pg from 'pg';
    const name = process.env.ADMIN_TEST_DB_NAME;
    if (!/^hd_admin_test_[a-f0-9]{16}$/.test(name)) throw new Error('Invalid isolated database name');
    const client = new pg.Client({ connectionString: process.env.API_TEST_DATABASE_URL });
    await client.connect();
    try { await client.query('${operation === 'create' ? 'CREATE DATABASE' : 'DROP DATABASE IF EXISTS'} "' + name + '"${operation === 'drop' ? ' WITH (FORCE)' : ''}'); }
    finally { await client.end(); }
  `]);
}

try {
  await requireFreePort(3322);
  await requireFreePort(3319);
  await database('create');
  created = true;
  await command(['--filter', '@hd/api', 'db:migrate']);
  await command(['--filter', '@hd/api', 'staff', 'create', 'browser-test@example.invalid', '浏览器测试员工', 'editor'], env.ADMIN_TEST_PASSWORD);
  api = spawn('pnpm', ['--filter', '@hd/api', 'exec', 'node', 'dist/main.js'], {
    cwd: repositoryRoot, env, stdio: 'inherit', detached: process.platform !== 'win32',
  });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (api.exitCode !== null) throw new Error('Isolated API exited before becoming ready');
    try { ready = (await fetch(`${env.ADMIN_API_TARGET}/health/ready`)).ok; } catch { /* still starting */ }
    if (ready) break;
    await delay(250);
  }
  if (!ready) throw new Error('Isolated API did not become ready');
  await command(['--filter', '@hd/admin', 'exec', 'playwright', 'test', ...playwrightArgs,
    ...(translationProvider === 'aliyun' ? ['--workers=1', '--retries=0', '--repeat-each=1', '--max-failures=1'] : []),
  ]);
} finally {
  if (api && api.exitCode === null) {
    if (process.platform !== 'win32') process.kill(-api.pid, 'SIGTERM');
    else api.kill('SIGTERM');
    await Promise.race([new Promise(resolve => api.once('exit', resolve)), delay(3000)]);
  }
  if (created) await database('drop');
  await rm(temporaryRoot, { recursive: true, force: true });
}
