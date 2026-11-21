import { parseArgs } from 'node:util';
import { createDatabase } from '../db/index.js';
import { readDatabaseEnvironment } from '../local-secrets.js';
import { reprojectStoredSearch, SearchReprojectOptions } from './search-reproject.js';

async function run() {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean' }, database: { type: 'string' }, after: { type: 'string' }, limit: { type: 'string', default: '25' },
  }, allowPositionals: false });
  const options = SearchReprojectOptions.parse({ after: values.after, limit: Number(values.limit) });
  const env = readDatabaseEnvironment();
  const address = new URL(env.DATABASE_URL ?? '');
  if (!values.apply || !values.database || !['postgres:', 'postgresql:'].includes(address.protocol) ||
    decodeURIComponent(address.pathname.slice(1)) !== values.database ||
    env.NODE_ENV === 'production' && !/^(?:[a-f0-9]{40,64}|sha256:[a-f0-9]{64})$/.test(env.HD_RELEASE_ID ?? '')) {
    throw new Error('Explicit database and apply confirmation required.');
  }
  const db = createDatabase(address.toString(), 1);
  try {
    if ((await db.pool.query('SELECT current_database() AS name')).rows[0]?.name !== values.database) {
      throw new Error('Database target mismatch.');
    }
    console.log(JSON.stringify(await reprojectStoredSearch(db, options)));
  } finally {
    await db.close();
  }
}

void run().catch(() => {
  console.error('Supplier search reprojection failed. Verify the database, release and cursor before retrying the same batch.');
  process.exitCode = 1;
});
