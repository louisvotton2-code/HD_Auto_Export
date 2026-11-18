import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { InjectOptions } from 'fastify';
import {
  AdminVehicleListSchema, AdminVehicleResponseSchema, ApiErrorSchema, StaffDirectoryResponseSchema,
  StaffMeResponseSchema, StaffMutationResponseSchema, StaffRecordResponseSchema, StaffUploadStatsResponseSchema,
  staffLoginEmail, type ErrorCode,
} from '@hd/contracts/admin';
import { makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createStaff, setStaffEnabled } from '../src/staff-cli.js';

const baseUrl = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if (!['postgres:', 'postgresql:'].includes(baseUrl.protocol) || baseUrl.hostname !== '127.0.0.1' || baseUrl.pathname !== '/postgres' || baseUrl.search || baseUrl.hash) {
  throw new Error('Staff management tests require an isolated local PostgreSQL maintenance database.');
}
const databaseName = `hd_staff_test_${randomBytes(8).toString('hex')}`;
const origin = 'http://127.0.0.1:3318';
const adminPath = '/api/v1/admin';
const staffPath = `${adminPath}/staff`;
const vehiclesPath = `${adminPath}/vehicles`;
const mePath = `${adminPath}/me`;
const initialPassword = 'Synthetic-initial-staff-test!';
const replacementPassword = 'Synthetic-reset-staff-test!';
const adminLogin = 'staff-test-admin@example.invalid';
const editorLogin = 'staff-test-editor@example.invalid';
const uploadLogin = 'staff-uploader';
const createPayload = { login: ' STAFF-UPLOADER ', name: ' Synthetic uploader ', password: initialPassword };
let maintenance: ReturnType<typeof createDatabase>;
let runtime: Awaited<ReturnType<typeof buildApp>>;
let createdDatabase = false;
let mediaRoot: string;
let requestNumber = 0;
let adminId: string;
let editorId: string;
let adminCookie: string;
let editorCookie: string;

const headers = (cookie: string) => ({ origin, cookie });
const call = (options: InjectOptions) => runtime.app.inject({ ...options, remoteAddress: `192.0.2.${++requestNumber}` });
type Response = Awaited<ReturnType<typeof call>>;

function readEnvelope<T>(result: Response, status: number, schema: { parse(value: unknown): { data: T; meta: { requestId: string } } }) {
  assert.equal(result.statusCode, status, result.body);
  assert.equal(result.headers['cache-control'], 'no-store');
  const envelope = schema.parse(result.json());
  assert.equal(envelope.meta.requestId, result.headers['x-request-id']);
  return envelope.data;
}

function assertError(result: Response, status: number, code: ErrorCode) {
  assert.equal(result.statusCode, status, result.body);
  assert.equal(result.headers['cache-control'], 'no-store');
  const envelope = ApiErrorSchema.parse(result.json());
  assert.equal(envelope.error.code, code);
  assert.equal(envelope.meta.requestId, result.headers['x-request-id']);
}

function signIn(login: string, password: string) {
  return call({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin }, payload: { email: staffLoginEmail(login), password } });
}

async function sessionCookie(login: string, password = initialPassword) {
  const result = await signIn(login, password);
  assert.equal(result.statusCode, 200, result.body);
  const cookie = result.cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
  assert.ok(cookie);
  return cookie;
}

before(async () => {
  mediaRoot = await mkdtemp(path.join(tmpdir(), 'hd-staff-test-'));
  maintenance = createDatabase(baseUrl.toString(), 2);
  await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`);
  createdDatabase = true;
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  const config = readConfig({
    NODE_ENV: 'test', DATABASE_URL: url.toString(), AUTH_SECRET: randomBytes(32).toString('hex'),
    MEDIA_ROOT: mediaRoot, AUTH_BASE_URL: origin, TRUSTED_ORIGINS: origin,
  });
  runtime = await buildApp(config);
  await migrateDatabase(runtime.db);
  adminId = (await createStaff(runtime.auth, { email: adminLogin, name: 'Synthetic admin', role: 'admin', password: initialPassword })).user.id;
  editorId = (await createStaff(runtime.auth, { email: editorLogin, name: 'Synthetic editor', role: 'editor', password: initialPassword })).user.id;
  adminCookie = await sessionCookie(adminLogin);
  editorCookie = await sessionCookie(editorLogin);
});

after(async () => {
  if (runtime) await runtime.app.close();
  if (createdDatabase) await maintenance.pool.query(`DROP DATABASE "${databaseName}"`);
  if (maintenance) await maintenance.close();
  if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
});

test('staff directory and mutations require an administrator, and writes require a trusted Origin', async () => {
  const mutations: InjectOptions[] = [
    { method: 'POST', url: staffPath, payload: createPayload },
    { method: 'POST', url: `${staffPath}/${editorId}/password`, payload: { password: replacementPassword } },
    { method: 'DELETE', url: `${staffPath}/${editorId}` },
  ];
  for (const request of [{ url: staffPath }, ...mutations]) {
    assertError(await call({ ...request, headers: { origin } }), 401, 'UNAUTHENTICATED');
    assertError(await call({ ...request, headers: headers(editorCookie) }), 403, 'FORBIDDEN');
  }
  for (const request of mutations) {
    assertError(await call({ ...request, headers: { cookie: adminCookie } }), 403, 'FORBIDDEN');
    assertError(await call({ ...request, headers: { cookie: adminCookie, origin: 'https://untrusted.example.invalid' } }), 403, 'FORBIDDEN');
  }
  for (const payload of [
    { ...createPayload, login: '/invalid' }, { ...createPayload, name: '  ' },
    { ...createPayload, password: 'too-short' }, { ...createPayload, role: 'admin' },
  ]) {
    assertError(await call({ method: 'POST', url: staffPath, headers: headers(adminCookie), payload }), 400, 'INVALID_REQUEST');
  }
  assertError(await call({ ...mutations[1]!, headers: headers(adminCookie), payload: { password: 'too-short' } }), 400, 'INVALID_REQUEST');
  assertError(await call({ method: 'POST', url: `${staffPath}/${adminId}/password`, headers: headers(adminCookie), payload: { password: replacementPassword } }), 403, 'FORBIDDEN');
  assertError(await call({ method: 'DELETE', url: `${staffPath}/${adminId}`, headers: headers(adminCookie) }), 403, 'FORBIDDEN');
  assertError(await call({ method: 'DELETE', url: `${staffPath}/missing-staff-member`, headers: headers(adminCookie) }), 404, 'NOT_FOUND');

  const disabledLogin = 'staff-test-disabled@example.invalid';
  await createStaff(runtime.auth, { email: disabledLogin, name: 'Synthetic disabled editor', role: 'editor', password: initialPassword });
  await setStaffEnabled(runtime.db, disabledLogin, false);
  await runtime.db.pool.query(`INSERT INTO staff(id,name,email,role,banned)
    VALUES($1,'Synthetic supplier import service','staff-test-worker@example.invalid','editor',true)`, ['staff-test-worker']);
  const directory = readEnvelope(await call({ url: staffPath, headers: { cookie: adminCookie } }), 200, StaffDirectoryResponseSchema);
  assert.deepEqual(directory.items.map(({ login, role, disabled }) => ({ login, role, disabled })).sort((a, b) => a.login.localeCompare(b.login)), [
    { login: adminLogin, role: 'admin', disabled: false }, { login: disabledLogin, role: 'editor', disabled: true },
    { login: editorLogin, role: 'editor', disabled: false },
  ]);
  assert.equal((await call({ url: mePath, headers: headers(editorCookie) })).statusCode, 200);
});

async function createVehicle(cookie: string) {
  const draft = makeVehicleDraftFixture();
  draft.media = [];
  draft.facts.trim = { id: 'staff_fixture_trim', name: 'Synthetic trim' };
  draft.facts.location = { country: 'CN', city: '隔离样例城市', displayName: null };
  return readEnvelope(await call({
    method: 'POST', url: vehiclesPath, headers: { ...headers(cookie), 'idempotency-key': randomUUID() }, payload: { draft },
  }), 201, AdminVehicleResponseSchema);
}

async function assertVehiclePage(cookie: string, query: string, page: number, total: number, idsAndLogins: [string, string][]) {
  const data = readEnvelope(await call({ url: `${vehiclesPath}?${query}&pageSize=1&page=${page}`, headers: headers(cookie) }), 200, AdminVehicleListSchema);
  assert.deepEqual({ ...data, items: data.items.map(({ id, uploaderLogin }) => [id, uploaderLogin]) }, {
    items: idsAndLogins, page, pageSize: 1, total, hasMore: page < total,
  });
}

test('staff account lifecycle rotates sessions and preserves paginated vehicle attribution and upload counts', async () => {
  const created = readEnvelope(await call({ method: 'POST', url: staffPath, headers: headers(adminCookie), payload: createPayload }), 201, StaffRecordResponseSchema);
  assert.deepEqual(created, {
    id: created.id, login: uploadLogin, name: 'Synthetic uploader', role: 'editor', disabled: false,
    createdAt: created.createdAt, updatedAt: created.updatedAt, uploads: { today: 0, total: 0 },
  });
  const { id: uploaderId } = created;
  assertError(await call({
    method: 'POST', url: staffPath, headers: headers(adminCookie),
    payload: { ...createPayload, login: 'Staff-Uploader@staff.hd-auto.invalid' },
  }), 409, 'STAFF_LOGIN_CONFLICT');

  const uploadCookie = await sessionCookie(uploadLogin);
  const secondOldCookie = await sessionCookie(uploadLogin);
  const older = await createVehicle(uploadCookie);
  const otherEditorVehicle = await createVehicle(editorCookie);
  const newer = await createVehicle(uploadCookie);
  const recycled = await createVehicle(uploadCookie);
  const staffAdminVehicle = await createVehicle(adminCookie);
  const removed = readEnvelope(await call({
    method: 'DELETE', url: `${vehiclesPath}/${recycled.id}`,
    headers: { ...headers(adminCookie), 'idempotency-key': randomUUID() }, payload: { version: recycled.version },
  }), 200, AdminVehicleResponseSchema);
  assert.ok(removed.deletedAt);

  // Earlier events establish both sides of Shanghai midnight. A later event cannot reassign the upload.
  await runtime.db.pool.query(`WITH beijing AS (
    SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai' AS start_at
  ) INSERT INTO audit_events(id,actor_id,operation,vehicle_id,new_version,request_id,created_at)
  SELECT $1::uuid,$2::text,'vehicle.create',$3::uuid,1,$1::uuid::text,start_at-interval '1 second' FROM beijing
  UNION ALL SELECT $4::uuid,$2::text,'vehicle.create',$5::uuid,1,$4::uuid::text,start_at FROM beijing
  UNION ALL SELECT $6::uuid,$7::text,'vehicle.create',$5::uuid,1,$6::uuid::text,clock_timestamp()`,
  [randomUUID(), uploaderId, older.id, randomUUID(), newer.id, randomUUID(), editorId]);

  await assertVehiclePage(uploadCookie, 'mine=true', 1, 2, [[newer.id, uploadLogin]]);
  await assertVehiclePage(uploadCookie, 'mine=true', 2, 2, [[older.id, uploadLogin]]);
  await assertVehiclePage(editorCookie, 'mine=true', 1, 1, [[otherEditorVehicle.id, editorLogin]]);
  await assertVehiclePage(uploadCookie, 'mine=false&includeUploader=true', 1, 4, [[staffAdminVehicle.id, adminLogin]]);
  const legacyPage = readEnvelope(await call({ url: vehiclesPath, headers: headers(uploadCookie) }), 200, AdminVehicleListSchema);
  assert.equal(legacyPage.items.some(vehicle => Object.hasOwn(vehicle, 'uploaderLogin')), false);
  await assertVehiclePage(adminCookie, `uploader=${uploaderId}`, 2, 2, [[older.id, uploadLogin]]);
  assertError(await call({ url: `${vehiclesPath}?uploader=${uploaderId}`, headers: headers(uploadCookie) }), 403, 'FORBIDDEN');
  assertError(await call({ url: `${vehiclesPath}?mine=true&uploader=${uploaderId}`, headers: headers(adminCookie) }), 400, 'INVALID_REQUEST');
  assertError(await call({ url: `${mePath}/upload-stats?staffId=${uploaderId}`, headers: { origin } }), 401, 'UNAUTHENTICATED');

  const stats = async (cookie: string, query = '') => readEnvelope(await call({ url: `${mePath}/upload-stats${query}`, headers: headers(cookie) }), 200, StaffUploadStatsResponseSchema);
  assert.deepEqual(await stats(uploadCookie), { staffId: uploaderId, today: 2, total: 3 });
  assert.deepEqual(await stats(editorCookie, `?staffId=${uploaderId}`), { staffId: editorId, today: 1, total: 1 });
  const directory = async () => readEnvelope(await call({ url: staffPath, headers: headers(adminCookie) }), 200, StaffDirectoryResponseSchema);
  assert.deepEqual((await directory()).items.find(({ id }) => id === uploaderId), { ...created, uploads: { today: 2, total: 3 } });

  const reset = await call({ method: 'POST', url: `${staffPath}/${uploaderId}/password`, headers: headers(adminCookie), payload: { password: replacementPassword } });
  assert.deepEqual(readEnvelope(reset, 200, StaffMutationResponseSchema), { id: uploaderId });
  for (const cookie of [uploadCookie, secondOldCookie]) {
    assertError(await call({ url: mePath, headers: headers(cookie) }), 401, 'UNAUTHENTICATED');
  }
  const oldLogin = await signIn(uploadLogin, initialPassword);
  assert.equal(oldLogin.statusCode, 401, oldLogin.body);
  assert.equal(oldLogin.headers['set-cookie'], undefined);
  const resetCookie = await sessionCookie(uploadLogin, replacementPassword);
  const me = readEnvelope(await call({ url: mePath, headers: headers(resetCookie) }), 200, StaffMeResponseSchema);
  assert.equal(me.id, uploaderId);
  assert.equal(me.role, 'editor');
  await assertVehiclePage(resetCookie, 'mine=true', 1, 2, [[newer.id, uploadLogin]]);

  const revoke = await call({ method: 'DELETE', url: `${staffPath}/${uploaderId}`, headers: headers(adminCookie) });
  assert.deepEqual(readEnvelope(revoke, 200, StaffMutationResponseSchema), { id: uploaderId });
  assertError(await call({ url: mePath, headers: headers(resetCookie) }), 401, 'UNAUTHENTICATED');
  const revokedLogin = await signIn(uploadLogin, replacementPassword);
  assert.equal(revokedLogin.statusCode, 403, revokedLogin.body);
  assert.equal(revokedLogin.headers['set-cookie'], undefined);
  assert.ok(!(await directory()).items.some(({ id }) => id === uploaderId));
  await assertVehiclePage(adminCookie, `uploader=${uploaderId}`, 1, 2, [[newer.id, uploadLogin]]);
  await assertVehiclePage(adminCookie, `uploader=${uploaderId}&deleted=only`, 1, 1, [[recycled.id, uploadLogin]]);
});

test('a sign-in that verified the previous credential cannot return a session after a reset', async t => {
  const login = 'staff-race-editor';
  const { user } = await createStaff(runtime.auth, { email: login, name: 'Synthetic race editor', role: 'editor', password: initialPassword });
  const password = (await runtime.auth.$context).password;
  const verify = password.verify.bind(password);
  let oldCredentialVerified = false;
  let freshCookie = '';
  const verifier = t.mock.method(password, 'verify', async (input: Parameters<typeof verify>[0]) => {
    const verified = await verify(input);
    if (verified && input.password === initialPassword && !oldCredentialVerified) {
      oldCredentialVerified = true;
      const reset = await call({
        method: 'POST', url: `${staffPath}/${user.id}/password`, headers: headers(adminCookie), payload: { password: replacementPassword },
      });
      assert.deepEqual(readEnvelope(reset, 200, StaffMutationResponseSchema), { id: user.id });
      freshCookie = await sessionCookie(login, replacementPassword);
    }
    return verified;
  });
  const stale = await signIn(login, initialPassword);
  verifier.mock.restore();
  assert.ok(oldCredentialVerified);
  assertError(stale, 401, 'UNAUTHENTICATED');
  assert.equal(stale.headers['set-cookie'], undefined);

  const { rows } = await runtime.db.pool.query('SELECT id FROM staff_sessions WHERE user_id=$1', [user.id]);
  assert.equal(rows.length, 1);
  const me = readEnvelope(await call({ url: mePath, headers: headers(freshCookie) }), 200, StaffMeResponseSchema);
  assert.equal(me.id, user.id);
});
