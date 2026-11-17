-- Keep the deployed ceiling at 150,000 until OPS prepares a verified expansion.
ALTER TABLE external_formal_admission_state
  ADD COLUMN admission_limit bigint NOT NULL DEFAULT 150000
  CHECK (admission_limit BETWEEN 150000 AND 1000000);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reserve_external_formal_listing(listing_source text, listing_id text)
RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM external_formal_admissions WHERE source=listing_source AND external_id=listing_id) THEN
    RETURN true;
  END IF;
  -- Recheck after serializing all new identities, including direct trigger writes.
  PERFORM 1 FROM external_formal_admission_state WHERE id=1 FOR UPDATE;
  IF EXISTS (SELECT 1 FROM external_formal_admissions WHERE source=listing_source AND external_id=listing_id) THEN
    RETURN true;
  END IF;
  UPDATE external_formal_admission_state
  SET admitted_count=admitted_count+1
  WHERE id=1 AND admitted_count<admission_limit AND (
    admitted_count<100000 OR NOT EXISTS (
      SELECT 1 FROM external_full_sync
      WHERE id=1 AND enabled AND (paused OR disk_paused OR capacity_pending)
    )
  ) AND (
    admitted_count<150000 OR (current_setting('hd.external_full_sync_admission',true)='on' AND EXISTS (
      SELECT 1 FROM external_full_sync
      WHERE id=1 AND enabled AND last_capacity_sample>0 AND NOT (paused OR disk_paused OR capacity_pending)
        AND admission_limit=(
          SELECT s.target_rows FROM external_full_snapshots s
          WHERE s.state IN ('verified','applying','complete')
          ORDER BY s.created_at DESC,s.id DESC LIMIT 1
        )
    ))
  );
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO external_formal_admissions(source, external_id) VALUES(listing_source, listing_id);
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION prepare_external_formal_expansion(selected_snapshot_id uuid, requested_limit bigint)
RETURNS bigint
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  snapshot external_full_snapshots%ROWTYPE;
  admission external_formal_admission_state%ROWTYPE;
  eligible bigint;
  stage_complete boolean;
BEGIN
  IF selected_snapshot_id IS NULL OR requested_limit IS NULL OR requested_limit NOT BETWEEN 150001 AND 1000000 THEN
    RAISE EXCEPTION 'A snapshot ID and a finite expansion limit above 150000 are required';
  END IF;
  IF NOT pg_try_advisory_xact_lock(78291333) THEN
    RAISE EXCEPTION 'The full-sync worker must stop before preparing an expansion';
  END IF;
  PERFORM pg_advisory_xact_lock(78291332);
  -- Match physicalCleanupAllowed() and exclude backup acquisition until commit.
  IF NOT pg_try_advisory_xact_lock_shared(78291335) THEN
    RAISE EXCEPTION 'An active backup lease prevents preparing an expansion';
  END IF;
  IF EXISTS (SELECT 1 FROM backup_gc_leases) THEN
    RAISE EXCEPTION 'An active backup lease prevents preparing an expansion';
  END IF;
  PERFORM 1 FROM external_full_sync WHERE id=1 AND enabled AND last_capacity_sample>0 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An enabled full-sync with a measured cohort is required';
  END IF;
  SELECT * INTO admission FROM external_formal_admission_state WHERE id=1 FOR UPDATE;
  IF NOT FOUND OR requested_limit<=greatest(admission.admission_limit,admission.admitted_count) THEN
    RAISE EXCEPTION 'The expansion limit must exceed the current ceiling and admitted count';
  END IF;
  SELECT * INTO snapshot FROM external_full_snapshots
  WHERE state<>'failed' ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR snapshot.id<>selected_snapshot_id
     OR snapshot.state NOT IN ('verified','applying','complete')
     OR snapshot.archive_pruned_at IS NOT NULL
     OR snapshot.rows<=0 OR snapshot.staged<>snapshot.rows
     OR snapshot.sha256 IS NULL OR snapshot.sha256 !~ '^[a-f0-9]{64}$'
     OR snapshot.bytes IS NULL OR snapshot.bytes<=0
     OR EXISTS (
       SELECT 1 FROM external_full_snapshots s
       WHERE s.id<>snapshot.id AND s.state IN ('downloading','staging','verified','applying')
     ) THEN
    RAISE EXCEPTION 'The newest retained verified export is required to prepare an expansion';
  END IF;
  -- Unique row numbers and identity keys make completeness and distinct counts exact.
  SELECT count(*)=snapshot.rows AND min(s.row_number)=1 AND max(s.row_number)=snapshot.rows,
    count(*) FILTER (WHERE admitted.source IS NULL AND withdrawn.source IS NULL)
  INTO stage_complete,eligible
  FROM external_full_stage s
  LEFT JOIN external_formal_admissions admitted ON (admitted.source,admitted.external_id)=(s.source,s.external_id)
  LEFT JOIN external_ingestion_identity_state withdrawn
    ON (withdrawn.source,withdrawn.external_id)=(s.source,s.external_id)
    AND withdrawn.provider='chinacarapi' AND withdrawn.withdrawn AND withdrawn.business_at>=snapshot.generated_at
  WHERE s.snapshot_id=snapshot.id;
  IF stage_complete IS DISTINCT FROM true OR requested_limit>admission.admitted_count+eligible THEN
    RAISE EXCEPTION 'Complete staged rows covering the requested expansion are required';
  END IF;
  UPDATE external_formal_admission_state SET admission_limit=requested_limit WHERE id=1;
  UPDATE external_full_snapshots
  SET target_rows=requested_limit,state='verified',apply_cursor=0,completed_at=NULL
  WHERE id=snapshot.id;
  UPDATE external_full_sync SET capacity_pending=true WHERE id=1;
  RETURN requested_limit;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION prepare_external_formal_expansion(uuid,bigint) FROM PUBLIC;
