import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateDatabase } from './migrate.js';
import type { Database } from './index.js';

test('migration connection failure retains its cause and destroys the borrowed connection even if unlock fails', async () => {
  const original = new Error('connection lost during lock');
  let calls = 0;
  let discarded: boolean | undefined;
  const db = {pool:{connect:async()=>({
    query:async()=>{throw ++calls === 1 ? original : new Error('unlock failed');},
    release:(destroy:boolean)=>{discarded=destroy;},
  })}} as unknown as Database;
  await assert.rejects(migrateDatabase(db), error => error === original);
  assert.equal(calls, 2);
  assert.equal(discarded, true);
});
