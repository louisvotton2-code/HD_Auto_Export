import type { Pool, PoolClient } from 'pg';

export const DEFAULT_FORMAL_LISTING_LIMIT = 150_000;
export const FORMAL_LISTING_LIMIT_CODE = 'SYNC_LISTING_LIMIT';

export async function admitFormalListing(tx: PoolClient, source: string, externalId: string): Promise<boolean> {
  const result = await tx.query<{ admitted: boolean }>(
    'SELECT reserve_external_formal_listing($1,$2) AS admitted', [source, externalId],
  );
  return result.rows[0]!.admitted;
}

type FullSyncAdmissionEvidence =
  | { basis: 'csv'; snapshotId: string }
  | { basis: 'incremental'; eventId: string }
  | { basis: 'replay'; eventId: string; replayId: string };

/** Only the full worker reaches this after its live disk and capacity checks. */
export async function permitFullSyncAdmission(tx: PoolClient, evidence?: FullSyncAdmissionEvidence) {
  if (evidence) {
    await tx.query(`SELECT set_config('hd.external_full_sync_admission','on',true),
      set_config('hd.external_formal_admission_context',$1,true)`,[JSON.stringify(evidence)]);
  } else {
    await tx.query("SET LOCAL hd.external_full_sync_admission = 'on'");
  }
}

export async function isFormalListingAdmitted(tx: PoolClient, source: string, externalId: string): Promise<boolean> {
  return (await tx.query('SELECT 1 FROM external_formal_admissions WHERE source=$1 AND external_id=$2', [source,externalId])).rowCount === 1;
}

export async function formalWithdrawal(tx: PoolClient, source: string, externalId: string) {
  return (await tx.query<{business_order:string;business_at:Date}>(`SELECT business_order,business_at
    FROM external_ingestion_identity_state WHERE provider='chinacarapi' AND source=$1 AND external_id=$2 AND withdrawn`,
  [source,externalId])).rows[0];
}

export async function rememberFormalWithdrawal(tx: PoolClient, source: string, externalId: string, order: string, at: Date) {
  await tx.query(`INSERT INTO external_ingestion_identity_state(provider,source,external_id,business_order,withdrawn,observed_at,business_at)
    VALUES('chinacarapi',$1,$2,$3,true,$4,$4) ON CONFLICT(provider,source,external_id) DO UPDATE SET
    business_order=excluded.business_order,withdrawn=true,observed_at=excluded.observed_at,business_at=excluded.business_at
    WHERE external_ingestion_identity_state.business_order<=excluded.business_order
      AND external_ingestion_identity_state.business_at<=excluded.business_at`, [source,externalId,order,at]);
}

export async function clearFormalWithdrawal(tx: PoolClient, source: string, externalId: string, at: Date, order?: string) {
  await tx.query(`UPDATE external_ingestion_identity_state SET withdrawn=false,observed_at=$3,business_at=$3,
    business_order=coalesce($4,business_order) WHERE provider='chinacarapi' AND source=$1 AND external_id=$2 AND withdrawn
    AND business_at<=$3 AND ($4::numeric IS NULL OR business_order<$4)`, [source,externalId,at,order ?? null]);
}

/** Formal CLI preflight, before enabling a writer or starting supplier work. */
export async function formalAdmissionInstalled(client: Pool | PoolClient): Promise<boolean> {
  const result = await client.query<{ installed: boolean }>(`SELECT
    to_regclass('external_formal_admissions') IS NOT NULL
    AND to_regclass('external_formal_admission_state') IS NOT NULL
    AND to_regprocedure('reserve_external_formal_listing(text,text)') IS NOT NULL
    AND to_regprocedure('prepare_external_formal_expansion(uuid,bigint)') IS NOT NULL
    AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('external_formal_admission_state')
      AND attname='admission_limit' AND NOT attisdropped)
    AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('external_full_snapshots')
      AND attname='target_rows' AND NOT attisdropped) AS installed`);
  return result.rows[0]!.installed;
}
