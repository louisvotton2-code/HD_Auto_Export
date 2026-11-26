-- Metadata-only migration. First admissions are recorded prospectively.
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='8s';
CREATE TABLE public.external_formal_expansion_operations (
  id uuid PRIMARY KEY,
  rollback_of uuid UNIQUE REFERENCES public.external_formal_expansion_operations(id),
  snapshot_id uuid NOT NULL REFERENCES public.external_full_snapshots(id),
  csv_sha256 text NOT NULL CHECK (csv_sha256 ~ '^[a-f0-9]{64}$'),
  requested_by text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  capacity_receipt text CHECK (capacity_receipt ~ '^[a-f0-9]{64}$'),
  prior_limit bigint NOT NULL CHECK (prior_limit BETWEEN 150000 AND 1000000),
  target_limit bigint NOT NULL CHECK (target_limit BETWEEN 150000 AND 1000000),
  admitted_count bigint NOT NULL CHECK (admitted_count BETWEEN 0 AND target_limit),
  worker_fence bigint NOT NULL CHECK (worker_fence>=0),
  receive_cursor numeric(30,0),
  apply_cursor bigint NOT NULL CHECK (apply_cursor>=0),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  CHECK ((rollback_of IS NULL AND capacity_receipt IS NOT NULL AND target_limit=1000000 AND target_limit>prior_limit) OR
         (rollback_of IS NOT NULL AND target_limit<prior_limit AND closed_at IS NULL))
);
CREATE UNIQUE INDEX external_formal_expansion_active
  ON public.external_formal_expansion_operations ((true)) WHERE rollback_of IS NULL AND closed_at IS NULL;

CREATE TABLE public.external_formal_expansion_admissions (
  reservation_id uuid NOT NULL REFERENCES public.external_formal_expansion_operations(id),
  snapshot_id uuid NOT NULL REFERENCES public.external_full_snapshots(id),
  csv_sha256 text NOT NULL CHECK (csv_sha256 ~ '^[a-f0-9]{64}$'),
  entry_id bigint GENERATED ALWAYS AS IDENTITY,
  source text NOT NULL,
  external_id text NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  basis text NOT NULL CHECK (basis IN ('csv','incremental','replay')),
  event_id numeric(30,0),
  replay_id uuid,
  PRIMARY KEY (reservation_id,snapshot_id,entry_id),
  CHECK ((basis='csv' AND event_id IS NULL AND replay_id IS NULL) OR
         (basis='incremental' AND event_id IS NOT NULL AND replay_id IS NULL) OR
         (basis='replay' AND event_id IS NOT NULL AND replay_id IS NOT NULL))
);
--> statement-breakpoint
CREATE FUNCTION public.change_external_formal_expansion(
  operation_id uuid, previous_operation_id uuid, selected_snapshot_id uuid, selected_csv_sha256 text,
  expected_count bigint, expected_limit bigint, requested_limit bigint, operator_id text,
  operation_hash text, native_capacity_receipt text, expected_worker_fence bigint
)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  prior external_formal_expansion_operations%ROWTYPE;
  saved external_formal_expansion_operations%ROWTYPE;
  snapshot external_full_snapshots%ROWTYPE;
  admission external_formal_admission_state%ROWTYPE;
  sync external_full_sync%ROWTYPE;
  receipt jsonb;
BEGIN
  IF operation_id IS NULL OR selected_snapshot_id IS NULL OR operator_id IS NULL
     OR expected_count IS NULL OR expected_count NOT BETWEEN 0 AND 1000000
     OR expected_limit IS NULL OR expected_limit NOT BETWEEN 150000 AND 1000000
     OR requested_limit IS NULL OR requested_limit NOT BETWEEN 150000 AND 1000000
     OR (previous_operation_id IS NULL AND requested_limit<>1000000)
     OR expected_worker_fence IS NULL OR expected_worker_fence<0
     OR selected_csv_sha256 IS NULL OR selected_csv_sha256 !~ '^[a-f0-9]{64}$'
     OR operation_hash IS NULL OR operation_hash !~ '^[a-f0-9]{64}$'
     OR (native_capacity_receipt IS NULL AND previous_operation_id IS NULL)
     OR native_capacity_receipt !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='HD551', MESSAGE='Invalid formal expansion operation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM staff WHERE id=operator_id AND role='admin' AND NOT banned FOR SHARE) THEN
    RAISE EXCEPTION USING ERRCODE='HD552', MESSAGE='An active administrator is required for formal expansion';
  END IF;

  -- Retrieving an already committed operation does not require stopping a worker.
  FOR lookup_attempt IN 1..2 LOOP
    SELECT * INTO saved FROM external_formal_expansion_operations WHERE id=operation_id;
    IF FOUND THEN
      IF saved.request_hash<>operation_hash OR saved.requested_by<>operator_id
         OR saved.rollback_of IS DISTINCT FROM previous_operation_id
         OR saved.snapshot_id<>selected_snapshot_id OR saved.csv_sha256<>selected_csv_sha256
         OR saved.admitted_count<>expected_count OR saved.prior_limit<>expected_limit
         OR saved.target_limit<>requested_limit OR saved.capacity_receipt IS DISTINCT FROM native_capacity_receipt
         OR saved.worker_fence<>expected_worker_fence THEN
        RAISE EXCEPTION USING ERRCODE='HD553', MESSAGE='Formal expansion operation ID conflicts with its original request';
      END IF;
      RETURN saved.result;
    END IF;
    IF lookup_attempt=1 THEN
      IF NOT pg_try_advisory_xact_lock(78291333) THEN
        RAISE EXCEPTION USING ERRCODE='HD554', MESSAGE='The full-sync worker must stop before changing its reservation';
      END IF;
      PERFORM pg_advisory_xact_lock(78291332);
    END IF;
  END LOOP;
  IF NOT pg_try_advisory_xact_lock_shared(78291335) OR EXISTS (SELECT FROM backup_gc_leases) THEN
    RAISE EXCEPTION USING ERRCODE='HD555', MESSAGE='An active backup lease prevents changing the reservation';
  END IF;
  SELECT * INTO sync FROM external_full_sync WHERE id=1 FOR UPDATE;
  IF NOT FOUND OR sync.worker_fence<>expected_worker_fence
     OR (previous_operation_id IS NULL AND (NOT sync.enabled OR sync.last_capacity_sample<=0 OR sync.disk_paused)) THEN
    RAISE EXCEPTION USING ERRCODE='HD556', MESSAGE='The full-sync worker or measured capacity has changed';
  END IF;
  SELECT * INTO admission FROM external_formal_admission_state WHERE id=1 FOR UPDATE;
  IF NOT FOUND OR admission.admitted_count<>expected_count OR admission.admission_limit<>expected_limit THEN
    RAISE EXCEPTION USING ERRCODE='HD557', MESSAGE='The formal admission count or ceiling has changed';
  END IF;
  SELECT * INTO snapshot FROM external_full_snapshots
    WHERE state<>'failed' ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR snapshot.id<>selected_snapshot_id
     OR snapshot.sha256 IS DISTINCT FROM selected_csv_sha256
     OR snapshot.state NOT IN ('verified','applying','complete')
     OR snapshot.archive_pruned_at IS NOT NULL OR snapshot.rows<=0 OR snapshot.staged<>snapshot.rows
     OR snapshot.bytes IS NULL OR snapshot.bytes<=0
     OR snapshot.apply_cursor<0 OR snapshot.apply_cursor>snapshot.rows
     OR (previous_operation_id IS NULL AND (snapshot.state<>'verified' OR snapshot.apply_cursor<>0))
     OR (snapshot.state='complete' AND snapshot.apply_cursor<>snapshot.rows)
     OR EXISTS (SELECT FROM external_full_snapshots WHERE id<>snapshot.id
       AND state IN ('downloading','staging','verified','applying'))
     OR NOT EXISTS (SELECT FROM external_full_stage WHERE snapshot_id=snapshot.id AND row_number=1)
     OR NOT EXISTS (SELECT FROM external_full_stage WHERE snapshot_id=snapshot.id AND row_number=snapshot.rows)
     OR EXISTS (SELECT FROM external_full_stage WHERE snapshot_id=snapshot.id AND row_number<1)
     OR EXISTS (SELECT FROM external_full_stage WHERE snapshot_id=snapshot.id AND row_number>snapshot.rows) THEN
    RAISE EXCEPTION USING ERRCODE='HD558', MESSAGE='The unchanged newest retained verified export is required';
  END IF;
  IF EXISTS (SELECT FROM external_full_admission_replays WHERE state IN ('pending','scheduled')) THEN
    RAISE EXCEPTION USING ERRCODE='HD559', MESSAGE='An active replay plan prevents changing the reservation';
  END IF;

  SELECT * INTO prior FROM external_formal_expansion_operations
    WHERE rollback_of IS NULL AND closed_at IS NULL FOR UPDATE;
  IF previous_operation_id IS NULL THEN
    IF FOUND OR requested_limit<=GREATEST(expected_limit,expected_count) THEN
      RAISE EXCEPTION USING ERRCODE='HD55A', MESSAGE='A higher ceiling with no active reservation is required';
    END IF;
  ELSIF NOT FOUND OR prior.id<>previous_operation_id OR prior.target_limit<>expected_limit
    OR prior.prior_limit<>requested_limit OR requested_limit<expected_count THEN
    RAISE EXCEPTION USING ERRCODE='HD55B', MESSAGE='The prior ceiling cannot be safely restored';
  END IF;

  receipt:=jsonb_build_object(
    'id',operation_id,'rollbackOf',previous_operation_id,'snapshotId',snapshot.id,'csvSha256',snapshot.sha256,
    'priorLimit',expected_limit,'targetRows',requested_limit,'admitted',expected_count,
    'receiveCursor',sync.receive_cursor::text,'applyCursor',snapshot.apply_cursor,'workerFence',sync.worker_fence::text,
    'capacityReceipt',native_capacity_receipt);
  INSERT INTO external_formal_expansion_operations
    (id,rollback_of,snapshot_id,csv_sha256,requested_by,request_hash,capacity_receipt,prior_limit,target_limit,
     admitted_count,worker_fence,receive_cursor,apply_cursor,result)
    VALUES(operation_id,previous_operation_id,snapshot.id,snapshot.sha256,operator_id,operation_hash,
      native_capacity_receipt,expected_limit,requested_limit,expected_count,sync.worker_fence,
      sync.receive_cursor,snapshot.apply_cursor,receipt);
  IF previous_operation_id IS NOT NULL THEN
    UPDATE external_formal_expansion_operations SET closed_at=clock_timestamp() WHERE id=previous_operation_id;
  END IF;
  UPDATE external_formal_admission_state SET admission_limit=requested_limit WHERE id=1;
  UPDATE external_full_snapshots SET target_rows=requested_limit WHERE id=snapshot.id;
  -- A live allow must be freshly read by the worker after the target change.
  UPDATE external_full_sync SET capacity_pending=true WHERE id=1;
  RETURN receipt;
END;
$$;
REVOKE ALL ON FUNCTION public.change_external_formal_expansion(uuid,uuid,uuid,text,bigint,bigint,bigint,text,text,text,bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reserve_external_formal_listing(listing_source text, listing_id text)
RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  reserved_slots bigint;
  active_reservation_id uuid;
  active_reservation_limit bigint;
  snapshot external_full_snapshots%ROWTYPE;
  context jsonb;
  context_basis text;
  context_event numeric(30,0);
  context_replay uuid;
BEGIN
  IF EXISTS (SELECT FROM external_formal_admissions WHERE source=listing_source AND external_id=listing_id) THEN
    RETURN true;
  END IF;
  PERFORM 1 FROM external_formal_admission_state WHERE id=1 FOR UPDATE;
  IF EXISTS (SELECT FROM external_formal_admissions WHERE source=listing_source AND external_id=listing_id) THEN
    RETURN true;
  END IF;
  SELECT id,target_limit INTO active_reservation_id,active_reservation_limit
   FROM external_formal_expansion_operations WHERE rollback_of IS NULL AND closed_at IS NULL;
  IF active_reservation_id IS NOT NULL THEN
    -- A mixed-version or indirect writer may still refresh an admitted identity.
    -- It cannot allocate a new slot without verifiable evidence for the actual batch.
    context:=NULLIF(current_setting('hd.external_formal_admission_context',true),'')::jsonb;
    context_basis:=context->>'basis';
    IF context_basis IS NULL OR context_basis NOT IN ('csv','incremental','replay') THEN RETURN false; END IF;
    SELECT * INTO snapshot FROM external_full_snapshots WHERE state<>'failed'
      ORDER BY created_at DESC,id DESC LIMIT 1;
    IF NOT FOUND OR snapshot.target_rows IS DISTINCT FROM active_reservation_limit
       OR snapshot.archive_pruned_at IS NOT NULL OR snapshot.sha256 IS NULL OR snapshot.sha256 !~ '^[a-f0-9]{64}$'
       OR snapshot.staged<>snapshot.rows OR snapshot.rows<=0 OR snapshot.bytes IS NULL OR snapshot.bytes<=0 THEN
      RETURN false;
    END IF;
    IF context_basis='csv' THEN
      IF snapshot.id::text IS DISTINCT FROM context->>'snapshotId' OR snapshot.state NOT IN ('verified','applying')
        OR NOT EXISTS (SELECT FROM external_full_stage s WHERE s.snapshot_id=snapshot.id
          AND s.source=listing_source AND s.external_id=listing_id) THEN RETURN false; END IF;
    ELSE
      IF snapshot.state<>'complete' OR snapshot.apply_cursor<>snapshot.rows
         OR (context->>'eventId' ~ '^[1-9][0-9]{0,29}$') IS NOT TRUE THEN RETURN false; END IF;
      context_event:=(context->>'eventId')::numeric;
      IF context_basis='incremental' THEN
        IF NOT EXISTS (SELECT FROM external_full_events e WHERE e.event_id=context_event
          AND e.source=listing_source AND e.external_id=listing_id AND e.applied_at IS NULL
          AND e.operation IN ('upsert','relist')) THEN RETURN false; END IF;
      ELSE
        IF context->>'replayId' IS DISTINCT FROM current_setting('hd.external_full_admission_replay',true)
          OR NOT EXISTS (SELECT FROM external_full_admission_replay_reservations r
            JOIN external_full_admission_replay_items i USING(replay_id,event_id)
            WHERE r.replay_id::text=context->>'replayId' AND r.source=listing_source AND r.external_id=listing_id
              AND r.event_id=context_event AND i.state='scheduled') THEN RETURN false; END IF;
        context_replay:=(context->>'replayId')::uuid;
      END IF;
    END IF;
  END IF;
  SELECT count(*) INTO reserved_slots FROM external_full_admission_replay_reservations r
   WHERE NOT (r.source=listing_source AND r.external_id=listing_id
     AND (r.replay_id::text=current_setting('hd.external_full_admission_replay',true)) IS TRUE);
  UPDATE external_formal_admission_state
  SET admitted_count=admitted_count+1
  WHERE id=1 AND admitted_count<admission_limit-reserved_slots
    AND (active_reservation_id IS NULL OR admission_limit=active_reservation_limit)
    AND (admitted_count<100000 OR NOT EXISTS (
      SELECT 1 FROM external_full_sync
      WHERE id=1 AND enabled AND (paused OR disk_paused OR capacity_pending)
    ))
    AND ((active_reservation_id IS NULL AND admitted_count<150000)
      OR (current_setting('hd.external_full_sync_admission',true)='on' AND EXISTS (
      SELECT 1 FROM external_full_sync
      WHERE id=1 AND enabled AND last_capacity_sample>0 AND NOT (paused OR disk_paused OR capacity_pending)
        AND admission_limit=(
          SELECT s.target_rows FROM external_full_snapshots s
          WHERE s.state IN ('verified','applying','complete')
          ORDER BY s.created_at DESC,s.id DESC LIMIT 1
        )
    )));
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO external_formal_admissions(source,external_id) VALUES(listing_source,listing_id);
  IF active_reservation_id IS NOT NULL THEN
    INSERT INTO external_formal_expansion_admissions
      (reservation_id,snapshot_id,csv_sha256,source,external_id,basis,event_id,replay_id)
      VALUES(active_reservation_id,snapshot.id,snapshot.sha256,listing_source,listing_id,context_basis,context_event,context_replay);
  END IF;
  RETURN true;
END;
$$;
