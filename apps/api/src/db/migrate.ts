import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, type Database } from './index.js';

export async function migrateDatabase(db: Database) {
  // Migrations are an explicit release step, never a side effect of app construction.
  const client = await db.pool.connect();
  let migrationFailed = false;
  let discardConnection = false;
  try {
    await client.query('SELECT pg_advisory_lock(78291331)');
    await migrate(db.orm, { migrationsFolder: fileURLToPath(new URL('../../migrations/', import.meta.url)) });
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
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = createDatabase(process.env.DATABASE_URL, 2);
  try { await migrateDatabase(db); console.log('Database migrations applied.'); } finally { await db.close(); }
}
