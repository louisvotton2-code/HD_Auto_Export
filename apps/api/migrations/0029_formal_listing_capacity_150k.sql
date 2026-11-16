-- Rebind the existing verified export before the new worker can admit more
-- identities. New installations still enter the normal first-sample flow.
DO $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(78291333) THEN
    RAISE EXCEPTION 'The current full-sync worker must stop before changing its admission ceiling';
  END IF;
END;
$$;
--> statement-breakpoint
SELECT pg_advisory_xact_lock(78291332);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reserve_external_formal_listing(listing_source text, listing_id text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM external_formal_admissions WHERE source=listing_source AND external_id=listing_id) THEN
    RETURN true;
  END IF;
  -- Serialize new admissions across CSV reservations, both delta workers and
  -- direct listing/member inserts. Recheck identity after waiting for the lock.
  PERFORM 1 FROM external_formal_admission_state WHERE id=1 FOR UPDATE;
  IF EXISTS (SELECT 1 FROM external_formal_admissions WHERE source=listing_source AND external_id=listing_id) THEN
    RETURN true;
  END IF;
  UPDATE external_formal_admission_state SET admitted_count=admitted_count+1
    WHERE id=1 AND admitted_count<150000 AND (
      admitted_count<100000 OR NOT EXISTS (
        SELECT 1 FROM external_full_sync
        WHERE id=1 AND enabled AND (paused OR disk_paused OR capacity_pending)
      )
    );
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO external_formal_admissions(source, external_id) VALUES(listing_source, listing_id);
  RETURN true;
END;
$$;
--> statement-breakpoint
WITH latest AS MATERIALIZED (
  SELECT id,generated_at
  FROM external_full_snapshots
  WHERE state<>'failed'
  ORDER BY created_at DESC,id DESC LIMIT 1
), rebudget AS MATERIALIZED (
  SELECT s.id,a.admitted_count+(
    SELECT count(*) FROM (
      SELECT 1 FROM external_full_stage st
      WHERE st.snapshot_id=s.id
        AND NOT EXISTS (
          SELECT 1 FROM external_formal_admissions a
          WHERE a.source=st.source AND a.external_id=st.external_id
        ) AND NOT EXISTS (
          SELECT 1 FROM external_ingestion_identity_state i
          WHERE i.provider='chinacarapi' AND i.source=st.source AND i.external_id=st.external_id
            AND i.withdrawn AND i.business_at>=s.generated_at
        )
      ORDER BY st.row_number
      LIMIT greatest(0,150000-a.admitted_count)
    ) remaining
  ) AS target
  FROM latest s CROSS JOIN external_formal_admission_state a
  WHERE a.id=1
), reopened AS (
  UPDATE external_full_snapshots s
  SET target_rows=r.target, state='verified', apply_cursor=0, completed_at=NULL
  FROM rebudget r
  WHERE s.id=r.id AND r.target=150000
    AND s.state IN ('verified','applying','complete') AND s.archive_pruned_at IS NULL
    AND EXISTS (SELECT 1 FROM external_full_sync WHERE id=1 AND enabled AND last_capacity_sample>0)
  RETURNING s.id
)
UPDATE external_full_sync
SET capacity_pending=true
WHERE id=1 AND enabled AND last_capacity_sample>0 AND EXISTS(SELECT 1 FROM reopened);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM external_full_sync WHERE id=1 AND enabled AND last_capacity_sample>0)
     AND NOT EXISTS (
       SELECT 1 FROM external_full_sync f CROSS JOIN LATERAL (
         SELECT state,target_rows,apply_cursor,archive_pruned_at
         FROM external_full_snapshots WHERE state<>'failed'
         ORDER BY created_at DESC,id DESC LIMIT 1
       ) s
       WHERE f.id=1 AND f.capacity_pending AND s.state='verified'
         AND s.target_rows=150000 AND s.apply_cursor=0 AND s.archive_pruned_at IS NULL
     ) THEN
    RAISE EXCEPTION 'A retained verified export covering 150000 identities is required before expanding the enabled worker';
  END IF;
END;
$$;
