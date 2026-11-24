import { fileURLToPath, pathToFileURL } from 'node:url';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PoolClient } from 'pg';
import { createDatabase, type Database } from './index.js';
import { readDatabaseEnvironment } from '../local-secrets.js';

const migrationsFolder = fileURLToPath(new URL('../../migrations/', import.meta.url));
const hanPairMigrationAt = 1794182400050; // 0050
const replayMigrationAt = 1794182400053; // 0053
type HanPairMigrationMode = '--defer-han-pair-index' | '--complete-han-pair-index';

async function applyHanPairMigrationMode(db: Database, mode: HanPairMigrationMode) {
  const release = readMigrationFiles({ migrationsFolder }).filter(entry => entry.folderMillis <= replayMigrationAt);
  const hanPair = release.find(entry => entry.folderMillis === hanPairMigrationAt);
  const before = release.filter(entry => entry.folderMillis < hanPairMigrationAt);
  const later = release.filter(entry => entry.folderMillis > hanPairMigrationAt);
  if (!hanPair || before.length !== 50 || later.length !== 3 || later.at(-1)?.folderMillis !== replayMigrationAt) {
    throw new Error('Expected the signed migration sequence through 0053.');
  }
  const pending = [...before, ...later];
  await db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(78291331)');
    const ledger = await tx.query<{ created_at: string; hash: string }>(
      'SELECT created_at::text, hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id');
    const matches = (expected: readonly MigrationMeta[]) => ledger.rows.length === expected.length &&
      expected.every((entry, index) => ledger.rows[index]?.created_at === String(entry.folderMillis) &&
        ledger.rows[index]?.hash === entry.hash);

    if (mode === '--defer-han-pair-index') {
      const at0049 = matches(before);
      if (!at0049 && !matches(pending)) throw new Error('Expected the exact 0049 ledger or the single pending 0050 entry.');
      const index = await tx.query<{ exists: boolean }>(
        "SELECT to_regclass('public.external_catalog_search_zh_han_pairs_idx') IS NOT NULL AS exists");
      if (index.rows[0]?.exists) throw new Error('0050 deferral requires the Han pair index to be absent.');
      await tx.query("SET LOCAL hd.require_prebuilt_global_facet_index='on'; SET LOCAL hd.require_prebuilt_full_event_identity_latest='on'");
      if (at0049) {
        for (const entry of later) await applyLedgerEntry(tx, entry);
      } else {
        // Reuse the signed index checks even when the three migrations are already recorded.
        for (const statement of later[0]!.sql.slice(0, 2)) await tx.query(statement);
        await tx.query(later[2]!.sql[0]!);
      }
      return;
    }

    const isPending = matches(pending);
    if (!isPending && !matches(release)) throw new Error('Expected the exact pending or completed 0050 ledger.');
    await tx.query("SET LOCAL hd.require_prebuilt_search_zh_han_pairs_index='on'");
    if (isPending) await applyLedgerEntry(tx, hanPair);
    else for (const statement of hanPair.sql) await tx.query(statement);
  });
}

async function applyLedgerEntry(tx: PoolClient, entry: MigrationMeta) {
  for (const statement of entry.sql) await tx.query(statement);
  await tx.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
    [entry.hash, entry.folderMillis]);
}

export async function migrateDatabase(db: Database, mode?: HanPairMigrationMode) {
  // Migrations are an explicit release step, never a side effect of app construction.
  if (mode) return applyHanPairMigrationMode(db, mode);
  const client = await db.pool.connect();
  let migrationFailed = false;
  let discardConnection = false;
  try {
    await client.query('SELECT pg_advisory_lock(78291331)');
    const ledger = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists");
    if (ledger.rows[0]?.exists) {
      const gap = await client.query<{ pending: boolean }>(`SELECT
        coalesce(max(created_at) > $1, false) AND count(*) FILTER (WHERE created_at=$1)=0 AS pending
        FROM drizzle.__drizzle_migrations`, [hanPairMigrationAt]);
      if (gap.rows[0]?.pending) throw new Error('Migration 0050 is pending. Prebuild the index and run --complete-han-pair-index first.');
    }
    // Reuse the locked connection so concurrent migrators cannot exhaust the pool.
    await migrate(drizzle(client), { migrationsFolder });
  } catch (error) {
    migrationFailed = true;
    throw error;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(78291331)'); }
    catch (error) {
      discardConnection = true;
      if (!migrationFailed) throw error;
    } finally { client.release(discardConnection); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || (mode !== undefined && mode !== '--defer-han-pair-index' && mode !== '--complete-han-pair-index')) {
    throw new Error('Expected at most one migration mode.');
  }
  const url = readDatabaseEnvironment().DATABASE_URL;
  if (!url) throw new Error('A database URL is required');
  const db = createDatabase(url, 2);
  try {
    await migrateDatabase(db, mode);
    console.log(mode === '--defer-han-pair-index' ? 'Database migrations applied through 0053. Migration 0050 remains pending.' :
      'Database migrations applied.');
  } finally { await db.close(); }
}
