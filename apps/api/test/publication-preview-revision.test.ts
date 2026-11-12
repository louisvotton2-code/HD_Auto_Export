import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import pg, { type PoolClient } from 'pg';

// Only a random empty database is owned by this suite. No application env file,
// HTTP server, provider, translation service or existing business database is used.
function maintenanceAddress() {
  const url = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
      url.pathname !== '/postgres' || url.search || url.hash) {
    throw new Error('Preview revision tests require a local PostgreSQL maintenance URL without options.');
  }
  return url;
}

async function localTransport(url: URL): Promise<string> {
  const socket = process.env.API_TEST_DATABASE_SOCKET;
  if (socket === undefined) return url.toString();
  if (!path.isAbsolute(socket) || !(await stat(path.join(socket, `.s.PGSQL.${url.port || '5432'}`))).isSocket()) {
    throw new Error('API_TEST_DATABASE_SOCKET must name an existing local PostgreSQL socket directory.');
  }
  const transport = new URL(url);
  transport.searchParams.set('host', socket);
  return transport.toString();
}

test('publication confirmation migration preserves history and versions every public draft change', async t => {
  const address = maintenanceAddress();
  const databaseName = `hd_api_test_preview_revision_${randomBytes(8).toString('hex')}`;
  const testAddress = new URL(address);
  testAddress.pathname = `/${databaseName}`;
  const maintenance = new pg.Pool({ connectionString: await localTransport(address), max: 1, connectionTimeoutMillis: 5000 });
  const db = new pg.Pool({ connectionString: await localTransport(testAddress), max: 4,
    connectionTimeoutMillis: 5000, statement_timeout: 10_000, idle_in_transaction_session_timeout: 15_000 });
  let created = false;
  const actor = randomUUID(), vehicle = randomUUID(), publication = randomUUID();
  const draft = { source: { kind: 'manual' }, facts: { mileageKm: 0 },
    price: { kind: 'asking', money: { amount: '100000', currency: 'CNY' } },
    content: { title: { sourceText: 'Synthetic migration fixture' } }, media: [],
    internal: { notes: 'Private fixture', purchaseCost: { amount: '80000', currency: 'CNY' } } };
  const snapshot = { facts: draft.facts, price: draft.price, images: [] };
  const receipt = { id: vehicle, version: 1, publicationState: 'published' };
  const revision = async (query: pg.Pool | PoolClient = db) =>
    (await query.query<{ public_content_revision: number }>('SELECT public_content_revision FROM vehicles WHERE id=$1', [vehicle])).rows[0]!.public_content_revision;
  const catalogRevision = async () => (await db.query<{ revision: string }>('SELECT revision FROM public_catalog_state WHERE id=1')).rows[0]!.revision;
  async function locked<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE', [vehicle]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function delta(amount: number, work: (client: PoolClient) => Promise<unknown>) {
    const before = await revision();
    await locked(work);
    assert.equal(await revision(), before + amount);
  }
  try {
    await maintenance.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const journal = JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    const migration = journal.entries.find(entry => entry.idx === 14);
    assert.equal(migration?.tag, '0014_publication_preview_confirmation');
    for (const entry of journal.entries.filter(entry => entry.idx < 14)) {
      await db.query(await readFile(new URL(`../migrations/${entry.tag}.sql`, import.meta.url), 'utf8'));
    }
    await db.query("INSERT INTO staff(id,name,email) VALUES($1,'Preview migration fixture','preview-migration@example.invalid')", [actor]);
    await db.query('INSERT INTO vehicles(id) VALUES($1)', [vehicle]);
    await db.query('INSERT INTO vehicle_drafts(vehicle_id,data) VALUES($1,$2)', [vehicle, draft]);
    await db.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)', [publication, vehicle, snapshot]);
    await db.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now(),availability='available',availability_checked_at=now() WHERE id=$1", [vehicle, publication]);
    await db.query("INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,response,expires_at) VALUES($1,$2,'migration-receipt','existing-request',$3,now()+interval '24 hours')", [actor, `vehicle.publish:${vehicle}`, receipt]);
    const catalogBeforeMigration = await catalogRevision();
    await db.query(await readFile(new URL(`../migrations/${migration!.tag}.sql`, import.meta.url), 'utf8'));

    await t.test('existing published snapshots and idempotency receipts remain unchanged', async () => {
      assert.equal(await revision(), 1);
      assert.equal(await catalogRevision(), catalogBeforeMigration);
      assert.deepEqual((await db.query('SELECT data FROM vehicle_publications WHERE id=$1', [publication])).rows[0].data, snapshot);
      assert.deepEqual((await db.query('SELECT response FROM idempotency_keys WHERE actor_id=$1', [actor])).rows[0].response, receipt);
      assert.equal((await db.query('SELECT publication_state FROM vehicles WHERE id=$1', [vehicle])).rows[0].publication_state, 'published');
      await assert.rejects(db.query("UPDATE vehicle_publications SET data='{}' WHERE id=$1", [publication]), { code: 'P0001' });
    });

    await t.test('private notes, purchase cost and generic vehicle versions keep confirmations current', async () => {
      const catalog = await catalogRevision();
      await delta(0, async client => {
        await client.query("UPDATE vehicle_drafts SET data=jsonb_set(data,'{internal}',$2::jsonb) WHERE vehicle_id=$1", [vehicle,
          { notes: 'Another private note', purchaseCost: { amount: '75000', currency: 'USD' } }]);
        await client.query('UPDATE vehicles SET version=version+1,updated_at=now() WHERE id=$1', [vehicle]);
      });
      assert.equal(await catalogRevision(), catalog);
    });

    await t.test('public A to B to A changes permanently stale an earlier confirmation', async () => {
      const before = await revision(), fingerprint = 'a'.repeat(64), catalog = await catalogRevision();
      await db.query('INSERT INTO publication_preview_confirmations(vehicle_id,actor_id,public_revision,fingerprint,locale) VALUES($1,$2,$3,$4,\'en\')', [vehicle, actor, before, fingerprint]);
      await delta(1, client => client.query("UPDATE vehicle_drafts SET data=jsonb_set(data,'{price,money,amount}','\"110000\"') WHERE vehicle_id=$1", [vehicle]));
      await delta(1, client => client.query("UPDATE vehicle_drafts SET data=jsonb_set(data,'{price,money,amount}','\"100000\"') WHERE vehicle_id=$1", [vehicle]));
      const confirmation = (await db.query('SELECT public_revision,fingerprint FROM publication_preview_confirmations WHERE vehicle_id=$1 AND actor_id=$2', [vehicle, actor])).rows[0];
      assert.equal(confirmation.public_revision, before);
      assert.equal(confirmation.fingerprint, fingerprint);
      assert.notEqual(confirmation.public_revision, await revision());
      assert.equal(await catalogRevision(), catalog);
      await assert.rejects(db.query('UPDATE vehicles SET public_content_revision=1 WHERE id=$1', [vehicle]), { code: '23514' });
    });

    await t.test('sidecar content and review state invalidate while bookkeeping does not', async () => {
      const data = { facts: { generation: null, drivetrain: null }, fields: [{ ref: 'model', sourceText: 'Fixture',
        sourceVersion: 1, translations: { en: { text: 'Fixture', reviewStatus: 'pending' } } }] };
      await delta(1, client => client.query("INSERT INTO vehicle_localizations(vehicle_id,revision,data,bindings) VALUES($1,1,$2,'{}')", [vehicle, data]));
      await delta(0, client => client.query("UPDATE vehicle_localizations SET revision=revision+1,retired_fields='[{\"retired\":true}]',bindings='{\"model\":\"binding\"}' WHERE vehicle_id=$1", [vehicle]));
      await delta(1, client => client.query("UPDATE vehicle_localizations SET data=jsonb_set(data,'{fields,0,translations,en,reviewStatus}','\"approved\"') WHERE vehicle_id=$1", [vehicle]));
      await delta(0, client => client.query('UPDATE vehicle_localizations SET data=data WHERE vehicle_id=$1', [vehicle]));
      await delta(1, client => client.query('DELETE FROM vehicle_localizations WHERE vehicle_id=$1', [vehicle]));
    });

    await t.test('only referenced media changes, including order and cover, invalidate', async () => {
      const photo = randomUUID(), orphan = randomUUID();
      await delta(0, async client => {
        for (const id of [photo, orphan]) await client.query("INSERT INTO media_assets(id,vehicle_id,content_type,expected_size,rights,expires_at) VALUES($1,$2,'image/png',100,'{\"basis\":\"owned\"}',now()+interval '1 hour')", [id, vehicle]);
      });
      await delta(1, client => client.query("UPDATE vehicle_drafts SET data=jsonb_set(data,'{media}',$2::jsonb) WHERE vehicle_id=$1", [vehicle,
        JSON.stringify([{ id: photo.toUpperCase(), alt: 'Fixture', sortOrder: 0, isCover: true }])]));
      await delta(1, client => client.query("UPDATE media_assets SET state='ready',width=10,height=8,byte_size=100,version=version+1 WHERE id=$1", [photo]));
      await delta(0, client => client.query("UPDATE media_assets SET state='ready',expires_at=now()+interval '1 day' WHERE id=$1", [orphan]));
      await delta(0, client => client.query("UPDATE media_assets SET expires_at=now()+interval '1 day' WHERE id=$1", [photo]));
      await delta(1, client => client.query("UPDATE media_assets SET rights='{\"basis\":\"licensed\"}' WHERE id=$1", [photo]));
      await delta(1, client => client.query("UPDATE vehicle_drafts SET data=jsonb_set(data,'{media}',$2::jsonb) WHERE vehicle_id=$1", [vehicle,
        JSON.stringify([{ id: photo.toUpperCase(), alt: 'Fixture', sortOrder: 1, isCover: false }])]));
      await delta(1, client => client.query("UPDATE media_assets SET state='failed',version=version+1 WHERE id=$1", [photo]));
      await delta(1, client => client.query("UPDATE media_assets SET state='ready',version=version+1 WHERE id=$1", [photo]));
      await delta(1, client => client.query('DELETE FROM media_assets WHERE id=$1', [photo]));
      await delta(0, client => client.query('DELETE FROM media_assets WHERE id=$1', [orphan]));
    });

    await t.test('inventory, deletion and withdrawal invalidate; publishing and same-state writes do not', async () => {
      await delta(1, client => client.query("UPDATE vehicles SET availability='reserved',availability_checked_at=now(),version=version+1 WHERE id=$1", [vehicle]));
      await delta(1, client => client.query("UPDATE vehicles SET availability_checked_at=availability_checked_at+interval '1 second' WHERE id=$1", [vehicle]));
      await delta(0, client => client.query('UPDATE vehicles SET availability=availability,availability_checked_at=availability_checked_at WHERE id=$1', [vehicle]));
      await delta(0, async client => {
        const next = randomUUID();
        await client.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)', [next, vehicle, snapshot]);
        await client.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now(),version=version+1 WHERE id=$1", [vehicle, next]);
      });
      await delta(1, client => client.query('UPDATE vehicles SET deleted_at=now(),deleted_by=$2 WHERE id=$1', [vehicle, actor]));
      await delta(1, client => client.query('UPDATE vehicles SET deleted_at=null,deleted_by=null WHERE id=$1', [vehicle]));
      const confirmedRevision = await revision();
      await db.query('UPDATE publication_preview_confirmations SET public_revision=$2 WHERE vehicle_id=$1', [vehicle, confirmedRevision]);
      await delta(1, client => client.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1", [vehicle]));
      assert.equal((await db.query('SELECT public_revision FROM publication_preview_confirmations WHERE vehicle_id=$1', [vehicle])).rows[0].public_revision, confirmedRevision);
      assert.notEqual(await revision(), confirmedRevision);
      await delta(0, client => client.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1", [vehicle]));
      await delta(1, client => client.query("UPDATE vehicles SET publication_state='draft' WHERE id=$1", [vehicle]));
      await delta(0, client => client.query("UPDATE vehicles SET publication_state='draft' WHERE id=$1", [vehicle]));
      await delta(0, client => client.query("UPDATE vehicles SET publication_state='published' WHERE id=$1", [vehicle]));
      // Withdrawal, inventory and deletion in the same UPDATE invalidate once.
      await delta(1, client => client.query("UPDATE vehicles SET publication_state='archived',availability='sold',availability_checked_at=now(),deleted_at=now(),deleted_by=$2 WHERE id=$1", [vehicle, actor]));
      await delta(1, client => client.query("UPDATE vehicles SET publication_state='draft',availability='unknown',availability_checked_at=null,deleted_at=null,deleted_by=null WHERE id=$1", [vehicle]));
      await delta(0, client => client.query("UPDATE vehicles SET publication_state='published' WHERE id=$1", [vehicle]));
      const beforeRollback = await revision();
      await assert.rejects(locked(async client => {
        await client.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1", [vehicle]);
        assert.equal(await revision(client), beforeRollback + 1);
        throw new Error('Intentional withdrawal rollback');
      }), /Intentional withdrawal rollback/);
      assert.equal(await revision(), beforeRollback);
      assert.equal((await db.query('SELECT publication_state FROM vehicles WHERE id=$1', [vehicle])).rows[0].publication_state, 'published');
    });

    await t.test('failed transactions roll back content and revision together', async () => {
      const before = await revision();
      await assert.rejects(locked(async client => {
        await client.query("UPDATE vehicle_drafts SET data=jsonb_set(data,'{facts,mileageKm}','1000') WHERE vehicle_id=$1", [vehicle]);
        assert.equal(await revision(client), before + 1);
        throw new Error('Intentional rollback');
      }), /Intentional rollback/);
      assert.equal(await revision(), before);
      assert.equal((await db.query("SELECT data->'facts'->>'mileageKm' AS mileage FROM vehicle_drafts WHERE vehicle_id=$1", [vehicle])).rows[0].mileage, '0');
    });

    await t.test('vehicle-first media writers serialize without reversing the publication lock order', async () => {
      const photo = randomUUID();
      await locked(async client => {
        await client.query("INSERT INTO media_assets(id,vehicle_id,content_type,expected_size,rights,expires_at) VALUES($1,$2,'image/png',100,'{\"basis\":\"owned\"}',now()+interval '1 hour')", [photo, vehicle]);
        await client.query("UPDATE vehicle_drafts SET data=jsonb_set(data,'{media}',$2::jsonb) WHERE vehicle_id=$1", [vehicle,
          JSON.stringify([{ id: photo, alt: '', sortOrder: 0, isCover: true }])]);
      });
      const before = await revision();
      const first = await db.connect(), second = await db.connect();
      let secondWork: Promise<{ error?: unknown }> | undefined;
      try {
        await first.query('BEGIN');
        await first.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE', [vehicle]);
        await first.query('SELECT id FROM media_assets WHERE id=$1 FOR UPDATE', [photo]);
        const firstPid = (await first.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        const secondPid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        secondWork = (async () => {
          try {
            await second.query('BEGIN');
            await second.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE', [vehicle]);
            await second.query("UPDATE media_assets SET state='ready',version=version+1 WHERE id=$1", [photo]);
            await second.query('COMMIT');
            return {};
          } catch (error) { await second.query('ROLLBACK'); return { error }; }
        })();
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const blockers = (await db.query<{ blockers: number[] }>('SELECT pg_blocking_pids($1) AS blockers', [secondPid])).rows[0]!.blockers;
          if (blockers.includes(firstPid)) { waiting = true; break; }
          await delay(10);
        }
        assert.ok(waiting, 'The second writer must wait for the first vehicle lock, before touching media.');
        await first.query("UPDATE media_assets SET state='uploaded',version=version+1 WHERE id=$1", [photo]);
        await first.query('COMMIT');
        const result = await secondWork;
        if (result.error) throw result.error;
        assert.equal(await revision(), before + 2);
      } finally {
        await first.query('ROLLBACK');
        await secondWork;
        first.release(); second.release();
      }
    });

    await t.test('confirmation rows require valid bindings and a maximum ten minute lifetime', async () => {
      await assert.rejects(db.query("UPDATE publication_preview_confirmations SET expires_at=confirmed_at+interval '11 minutes' WHERE vehicle_id=$1", [vehicle]), { code: '23514' });
      await assert.rejects(db.query("UPDATE publication_preview_confirmations SET fingerprint='not-a-digest' WHERE vehicle_id=$1", [vehicle]), { code: '23514' });
      await assert.rejects(db.query("UPDATE publication_preview_confirmations SET locale='fr' WHERE vehicle_id=$1", [vehicle]), { code: '23514' });
      await assert.rejects(db.query("INSERT INTO publication_preview_confirmations(vehicle_id,actor_id,public_revision,fingerprint,locale) VALUES($1,$2,1,$3,'en')", [vehicle, actor, 'a'.repeat(64)]), { code: '23505' });
      const before = await revision();
      await db.query('DELETE FROM publication_preview_confirmations WHERE vehicle_id=$1', [vehicle]);
      assert.equal(await revision(), before);
    });
  } finally {
    await db.end();
    try { if (created) await maintenance.query(`DROP DATABASE "${databaseName}"`); }
    finally { await maintenance.end(); }
  }
});
