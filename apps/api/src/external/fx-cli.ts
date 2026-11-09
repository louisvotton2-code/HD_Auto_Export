import { createDatabase } from '../db/index.js';
import { readDatabaseEnvironment } from '../local-secrets.js';
import { assertFxRefreshAuthorization, readFxHealth, refreshFxQuote, seedSyntheticFx } from './fx.js';

async function run() {
  const [action, fixture, ...rest] = process.argv.slice(2);
  if (rest.length || !['--health', '--refresh', '--seed'].includes(action ?? '') ||
      (action === '--seed' ? !['a', 'b', 'expired'].includes(fixture ?? '') : fixture !== undefined)) throw new Error('Invalid FX command.');
  const env = readDatabaseEnvironment();
  const databaseUrl = env.DATABASE_URL ?? '';
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error('Invalid FX configuration.'); }
  const mode = env.EXTERNAL_CATALOG_MODE;
  const scale = mode === 'synthetic-scale' && /^\/hd_ext_scale_[a-z0-9_]+$/.test(url.pathname) &&
    (url.hostname === '127.0.0.1' || (url.hostname === 'postgres-scale' && url.port === '5432'));
  const preview = mode === 'synthetic' && /^\/hd_ext_fx_preview_[a-z0-9_]+$/.test(url.pathname) && url.hostname === '127.0.0.1';
  if (env.NODE_ENV !== 'test' || !['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash ||
      !(scale || preview) || (action === '--seed' && !scale)) throw new Error('FX scope rejected.');
  const auth = { networkEnabled: env.EXTERNAL_FX_NETWORK === 'enabled', mode: mode!, nodeEnv: env.NODE_ENV!, databaseUrl };
  if (action === '--refresh') assertFxRefreshAuthorization(auth);
  const db = createDatabase(databaseUrl, 2);
  try {
    if (action === '--seed') {
      const { changed } = await seedSyntheticFx(db, fixture as 'a' | 'b' | 'expired');
      console.log(JSON.stringify({ changed, health: await readFxHealth(db.pool) }));
    } else if (action === '--refresh') {
      const result = await refreshFxQuote(db, auth);
      console.log(JSON.stringify(result));
      if (result.attempted && result.health.lastOutcome === 'failed') process.exitCode = 1;
    } else console.log(JSON.stringify(await readFxHealth(db.pool)));
  } finally { await db.close(); }
}
void run().catch(() => { console.error('FX command failed; check the isolated target, migration, and explicit network gate.'); process.exitCode = 1; });
