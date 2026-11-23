-- Prebuild this index concurrently on an existing event ledger:
-- CREATE INDEX CONCURRENTLY external_full_event_identity_latest ON public.external_full_events (source, external_id, event_id DESC);
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '8s';
DO $migration$
DECLARE
  previous_path text := current_setting('search_path');
  index_oid oid;
  expected text := 'CREATE INDEX external_full_event_identity_latest ON public.external_full_events USING btree (source, external_id, event_id DESC)';
BEGIN
  PERFORM set_config('search_path','pg_catalog',true);
  index_oid := to_regclass('public.external_full_event_identity_latest');
  IF index_oid IS NULL THEN
    IF current_setting('hd.require_prebuilt_full_event_identity_latest',true)='on'
      OR EXISTS (SELECT 1 FROM public.external_full_events OFFSET 10000 LIMIT 1) THEN
      RAISE EXCEPTION 'Full-sync event identity index must be prebuilt concurrently before migration 0053';
    END IF;
    CREATE INDEX external_full_event_identity_latest ON public.external_full_events (source, external_id, event_id DESC);
    index_oid := 'public.external_full_event_identity_latest'::regclass;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid=index_oid AND indrelid='public.external_full_events'::regclass
      AND indisvalid AND indisready AND indislive AND pg_get_indexdef(indexrelid)=expected
  ) THEN RAISE EXCEPTION 'Full-sync event identity index differs from migration 0053'; END IF;
  PERFORM set_config('search_path',previous_path,true);
END
$migration$;
--> statement-breakpoint
CREATE TABLE public.external_full_admission_replays (
  id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES public.external_full_snapshots(id),
  csv_sha256 text NOT NULL CHECK (csv_sha256 ~ '^[a-f0-9]{64}$'),
  capacity_receipt text NOT NULL CHECK (capacity_receipt ~ '^[a-f0-9]{64}$'),
  requested_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  target_rows bigint NOT NULL CHECK (target_rows BETWEEN 1 AND 1000000),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  coverage jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','scheduled','finished','superseded'))
);
CREATE UNIQUE INDEX external_full_admission_replay_active ON public.external_full_admission_replays ((true))
  WHERE state IN ('pending','scheduled');
CREATE TABLE public.external_full_admission_replay_items (
  replay_id uuid NOT NULL REFERENCES public.external_full_admission_replays(id),
  event_id numeric(30,0) NOT NULL REFERENCES public.external_full_events(event_id),
  source text NOT NULL,
  external_id text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending','scheduled','already_admitted','superseded','verified_active','verified_withdrawn',
    'unresolved_not_found','unresolved_unverified','retry_limit','unresolved_no_work'
  )),
  detail_generation bigint CHECK (detail_generation>0),
  placeholder_created boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  PRIMARY KEY (replay_id, event_id),
  UNIQUE (replay_id, source, external_id)
);
CREATE UNIQUE INDEX external_full_admission_replay_detail ON public.external_full_admission_replay_items
  (source, external_id, detail_generation) WHERE state='scheduled' AND detail_generation IS NOT NULL;
--> statement-breakpoint
-- Bound temporary headroom to the latest complete CSV; stale plans reserve zero.
CREATE VIEW public.external_full_admission_replay_reservations AS
WITH latest AS MATERIALIZED (
  SELECT id,state,sha256,target_rows,archive_pruned_at
  FROM public.external_full_snapshots WHERE state<>'failed' ORDER BY created_at DESC,id DESC LIMIT 1
)
SELECT i.replay_id,i.event_id,i.source,i.external_id
FROM public.external_full_admission_replays r JOIN latest s ON s.id=r.snapshot_id
JOIN public.external_formal_admission_state cap ON cap.id=1 AND cap.admission_limit=r.target_rows
JOIN public.external_full_admission_replay_items i ON i.replay_id=r.id
JOIN public.external_full_events denial ON denial.event_id=i.event_id
WHERE r.state IN ('pending','scheduled') AND s.state='complete' AND s.archive_pruned_at IS NULL
  AND s.sha256=r.csv_sha256 AND s.target_rows=r.target_rows
  AND i.state IN ('pending','scheduled')
  AND NOT EXISTS (SELECT 1 FROM public.external_formal_admissions a WHERE a.source=i.source AND a.external_id=i.external_id)
  AND NOT EXISTS (SELECT 1 FROM public.external_full_events newer WHERE newer.source=i.source
     AND newer.external_id=i.external_id AND newer.event_id>i.event_id)
  AND NOT EXISTS (SELECT 1 FROM public.external_ingestion_identity_state w
    WHERE w.provider='chinacarapi' AND w.source=i.source AND w.external_id=i.external_id AND w.withdrawn
      AND NOT (denial.operation='relist' AND denial.event_id>w.business_order AND denial.business_at>=w.business_at))
  AND (i.state='pending' OR EXISTS (
    SELECT 1 FROM public.external_full_work w JOIN public.external_full_members m USING(source,external_id)
    WHERE w.source=i.source AND w.external_id=i.external_id AND w.kind='detail'
      AND w.generation=i.detail_generation AND w.attempts<5 AND m.desired_generation=i.detail_generation
      AND (m.state<>'withdrawn' OR (denial.operation='relist'
        AND denial.event_id>m.event_order AND denial.business_at>=m.business_at))));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reserve_external_formal_listing(listing_source text, listing_id text)
RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  reserved_slots bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM external_formal_admissions WHERE source=listing_source AND external_id=listing_id) THEN
    RETURN true;
  END IF;
  PERFORM 1 FROM external_formal_admission_state WHERE id=1 FOR UPDATE;
  IF EXISTS (SELECT 1 FROM external_formal_admissions WHERE source=listing_source AND external_id=listing_id) THEN
    RETURN true;
  END IF;
  SELECT count(*) INTO reserved_slots FROM external_full_admission_replay_reservations r
   WHERE NOT (r.source=listing_source AND r.external_id=listing_id
     AND (r.replay_id::text=current_setting('hd.external_full_admission_replay',true)) IS TRUE);
  UPDATE external_formal_admission_state
  SET admitted_count=admitted_count+1
  WHERE id=1 AND admitted_count<admission_limit-reserved_slots AND (
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
CREATE OR REPLACE FUNCTION public.require_external_formal_reservation()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE listing_source text;
BEGIN
  IF TG_TABLE_NAME='external_listings' THEN
    IF NEW.provider<>'chinacarapi' THEN RETURN NEW; END IF;
    listing_source:=NEW.platform_id;
  ELSE
    listing_source:=NEW.source;
    -- A replay may provision only its exact empty detail-work member, without ledger or listing admission.
    IF TG_OP='INSERT' AND NEW.state='pending' AND NEW.applied_generation=0 AND NEW.event_order=0
      AND current_setting('hd.external_full_admission_replay',true) IS NOT NULL
      AND EXISTS (SELECT 1 FROM external_full_admission_replay_items item
        JOIN external_full_admission_replays plan ON plan.id=item.replay_id
        WHERE item.replay_id::text=current_setting('hd.external_full_admission_replay',true)
          AND item.source=NEW.source AND item.external_id=NEW.external_id
          AND item.detail_generation=NEW.desired_generation AND item.state='scheduled'
          AND item.placeholder_created AND plan.state='pending') THEN RETURN NEW; END IF;
  END IF;
  IF NOT reserve_external_formal_listing(listing_source, NEW.external_id) THEN
    RAISE check_violation USING MESSAGE='Formal source listing admission limit reached.',
      CONSTRAINT='external_formal_listing_limit';
  END IF;
  RETURN NEW;
END;
$$;
