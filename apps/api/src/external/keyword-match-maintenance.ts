import { statfs } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createDatabase, type Database } from '../db/index.js';
import { readDatabaseEnvironment } from '../local-secrets.js';

const actions = ['start', 'backfill', 'verify', 'activate', 'disable', 'pause'] as const;
type Action = typeof actions[number];
type Progress = {
  maintaining: boolean;
  ready: boolean;
  scan_complete: boolean;
  verification_complete: boolean;
  last_listing_id: string | null;
  last_verified_listing_id: string | null;
};

const sourcePage = `SELECT listing_id FROM external_catalog_filter
  WHERE active AND locale_mask<>0 AND ($1::uuid IS NULL OR listing_id>$1::uuid)
  ORDER BY listing_id LIMIT $2`;
const verificationPage = `WITH source AS MATERIALIZED (${sourcePage}),
  english AS MATERIALIZED (
    SELECT listing_id FROM external_catalog_keyword_match
    WHERE locale='en' AND ($1::uuid IS NULL OR listing_id>$1::uuid)
    ORDER BY listing_id LIMIT $2
  ), russian AS MATERIALIZED (
    SELECT listing_id FROM external_catalog_keyword_match
    WHERE locale='ru' AND ($1::uuid IS NULL OR listing_id>$1::uuid)
    ORDER BY listing_id LIMIT $2
  )
  SELECT listing_id FROM (
    SELECT listing_id FROM source UNION SELECT listing_id FROM english UNION SELECT listing_id FROM russian
  ) ids ORDER BY listing_id LIMIT $2`;

export async function advanceKeywordMatch(db: Database, action: Action, batchSize: number) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('Batch size must be between 1 and 500.');
  return db.transaction(async tx => {
    await tx.query(`SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
      SET LOCAL lock_timeout='200ms'; SET LOCAL statement_timeout='1200ms';
      SET LOCAL transaction_timeout='3s'; SET LOCAL jit=off; SET LOCAL max_parallel_workers_per_gather=0`);
    const guard = await tx.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock(78291332) AS locked');
    if (!guard.rows[0]?.locked) return { status: 'busy' } as const;
    let { rows: [progress] } = await tx.query<Progress>('SELECT * FROM external_catalog_keyword_match_state WHERE id=1 FOR UPDATE');
    if (!progress) {
      // The first-party restore excludes the derived state and projection.
      if (action === 'disable' || action === 'pause') return { status: 'disabled' } as const;
      ({ rows: [progress] } = await tx.query<Progress>('INSERT INTO external_catalog_keyword_match_state(id) VALUES(1) RETURNING *'));
    }
    if (!progress) throw new Error('Keyword match state could not be initialized.');
    if (action === 'pause') {
      await tx.query(`UPDATE external_catalog_keyword_match_state SET maintaining=false,ready=false,
        last_listing_id=NULL,scan_complete=false,last_verified_listing_id=NULL,verification_complete=false
        WHERE id=1 AND maintaining`);
      return { status: 'paused' } as const;
    }
    if (action === 'disable') {
      await tx.query('UPDATE external_catalog_keyword_match_state SET ready=false WHERE id=1 AND ready');
      return { status: 'disabled' } as const;
    }
    if (action === 'start') {
      if (progress.maintaining) return { status: 'maintaining' } as const;
      const { rows: [state] } = await tx.query<{ has_rows: boolean }>(
        'SELECT EXISTS (SELECT FROM external_catalog_keyword_match) AS has_rows');
      if (state?.has_rows !== false) throw new Error('Drain readers and clear the paused projection before restarting.');
      await tx.query('UPDATE external_catalog_keyword_match_state SET maintaining=true WHERE id=1');
      return { status: 'maintaining' } as const;
    }
    if (action === 'activate') {
      if (!progress.scan_complete || !progress.verification_complete) throw new Error('Complete and verify the backfill before activation.');
      await tx.query('UPDATE external_catalog_keyword_match_state SET ready=true WHERE id=1 AND NOT ready');
      return { status: 'active' } as const;
    }
    if (progress.ready) return { status: 'active' } as const;
    if (!progress.maintaining) throw new Error('Start keyword match maintenance before backfill or verification.');
    if (action === 'verify' && !progress.scan_complete) throw new Error('Complete the backfill before verification.');

    const verifying = action === 'verify';
    if (verifying ? progress.verification_complete : progress.scan_complete) return { status: 'complete', rows: 0 } as const;
    const cursor = verifying ? progress.last_verified_listing_id : progress.last_listing_id;
    const { rows } = await tx.query<{ listing_id: string }>(verifying ? verificationPage : sourcePage, [cursor, batchSize]);
    const ids = rows.map(row => row.listing_id);
    const done = ids.length < batchSize;
    const next = ids.at(-1) ?? cursor;
    if (verifying) {
      if (ids.length) {
        const difference = await tx.query<{ differs: boolean }>(`WITH expected AS MATERIALIZED (
            SELECT * FROM external_catalog_keyword_match_source WHERE listing_id=ANY($1::uuid[])
          ), actual AS MATERIALIZED (
            SELECT * FROM external_catalog_keyword_match WHERE listing_id=ANY($1::uuid[])
          )
          SELECT EXISTS((SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
            UNION ALL (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)) AS differs`, [ids]);
        if (difference.rows[0]?.differs !== false) throw new Error('Keyword match verification found a difference.');
      }
      await tx.query(`UPDATE external_catalog_keyword_match_state
        SET last_verified_listing_id=$1,verification_complete=$2 WHERE id=1`, [next, done]);
    } else {
      if (ids.length) await tx.query('SELECT public.refresh_external_catalog_keyword_match($1::uuid[])', [ids]);
      await tx.query(`UPDATE external_catalog_keyword_match_state
        SET last_listing_id=$1,scan_complete=$2 WHERE id=1`, [next, done]);
    }
    return { status: done ? 'complete' : 'advanced', rows: ids.length } as const;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { 'batch-size': { type: 'string', default: '100' }, 'data-dir': { type: 'string', default: '' } },
  });
  const action = actions.find(value => value === positionals[0]);
  if (!action || positionals.length !== 1) throw new Error('Expected one action: start, backfill, verify, activate, disable or pause.');
  if (action !== 'disable' && action !== 'pause') {
    const dataDirectory = values['data-dir']!;
    if (!isAbsolute(dataDirectory)) throw new Error('An absolute PostgreSQL data filesystem path is required.');
    const disk = await statfs(dataDirectory, { bigint: true });
    if (disk.blocks <= 0n || (disk.blocks - disk.bavail) * 10n >= disk.blocks * 7n) throw new Error('Keyword match disk limit reached.');
  }
  const url = readDatabaseEnvironment().DATABASE_URL;
  if (!url) throw new Error('A database URL is required.');
  const db = createDatabase(url, 1);
  try {
    console.log(JSON.stringify(await advanceKeywordMatch(db, action, Number(values['batch-size']))));
  } finally { await db.close(); }
}
