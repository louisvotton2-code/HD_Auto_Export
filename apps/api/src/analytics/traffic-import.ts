import { createHash } from 'node:crypto';
import { AnalyticsDocumentSnapshotSchema } from '@hd/contracts/analytics';
import type { Database } from '../db/index.js';

type ImportErrorCode = 'INVALID_SNAPSHOT' | 'HOUR_OUT_OF_RANGE' | 'HOUR_CONFLICT' | 'DATABASE_MISMATCH';

export class AnalyticsDocumentImportError extends Error {
  constructor(readonly code: ImportErrorCode) {
    super(code);
    this.name = 'AnalyticsDocumentImportError';
  }
}

/** Insert the whole finalized hour exactly once. A different snapshot for that hour cannot overwrite it. */
export async function importAnalyticsDocumentSnapshot(db: Database, input: unknown, expectedDatabase: string) {
  const parsed = AnalyticsDocumentSnapshotSchema.safeParse(input);
  if (!parsed.success) throw new AnalyticsDocumentImportError('INVALID_SNAPSHOT');
  const { hour, status, rows } = parsed.data;
  const utcHour = new Date(hour).toISOString();
  const ordered = rows.map(({ locale, pageType, requests }) => ({ locale, pageType, requests }))
    .sort((a, b) => a.locale.localeCompare(b.locale, 'en') || a.pageType.localeCompare(b.pageType, 'en'));
  const digest = createHash('sha256').update(JSON.stringify({ version: 1, hour: utcHour, status, rows: ordered })).digest('hex');

  return db.transaction(async tx => {
    await tx.query("SET LOCAL statement_timeout='2s'; SET LOCAL lock_timeout='1s'");
    const { rows: [context] } = await tx.query<{ name: string; finalized: boolean; retained: boolean }>(`
      SELECT current_database() AS name,
        $1::timestamptz < date_trunc('hour', transaction_timestamp(), 'Asia/Shanghai') AS finalized,
        $1::timestamptz >= (((transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')::date - 89)::timestamp
          AT TIME ZONE 'Asia/Shanghai') AS retained`, [utcHour]);
    if (!expectedDatabase || context?.name !== expectedDatabase) throw new AnalyticsDocumentImportError('DATABASE_MISMATCH');
    if (!context.finalized || !context.retained) throw new AnalyticsDocumentImportError('HOUR_OUT_OF_RANGE');

    const inserted = await tx.query(`INSERT INTO analytics_document_snapshots (hour, status, digest, imported_at)
      VALUES ($1, $2, $3, statement_timestamp()) ON CONFLICT (hour) DO NOTHING`, [utcHour, status, digest]);
    if (inserted.rowCount === 0) {
      const { rows: [existing] } = await tx.query<{ digest: string }>(
        'SELECT digest FROM analytics_document_snapshots WHERE hour=$1', [utcHour]);
      if (existing?.digest !== digest) throw new AnalyticsDocumentImportError('HOUR_CONFLICT');
      return { outcome: 'duplicate' as const, hour: utcHour, status, rows: ordered.length };
    }
    if (ordered.length) {
      await tx.query(`INSERT INTO analytics_document_hourly (hour, locale, page_type, requests)
        SELECT $1, data.locale, data."pageType", data.requests
        FROM jsonb_to_recordset($2::jsonb) AS data(locale text, "pageType" text, requests bigint)`,
      [utcHour, JSON.stringify(ordered)]);
    }
    return { outcome: 'imported' as const, hour: utcHour, status, rows: ordered.length };
  });
}
