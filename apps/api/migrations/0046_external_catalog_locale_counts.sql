-- Count current public supplier membership by the same locale masks used by
-- list queries. The existing state row defaults to an empty supplier catalog
-- when a first-party-only backup restores that row's id.
SET LOCAL search_path = pg_catalog, public;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
CREATE FUNCTION public.sync_external_catalog_locale_counts() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  empty_counts constant bigint[] := ARRAY[0,0,0,0,0,0,0]::bigint[];
  deltas bigint[] := empty_counts;
  bucket record;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    UPDATE public.external_catalog_state SET locale_counts = empty_counts
    WHERE id = 1 AND locale_counts <> empty_counts;
    IF FOUND THEN
      PERFORM public.queue_public_catalog_change();
    ELSIF NOT EXISTS (SELECT 1 FROM public.external_catalog_state WHERE id = 1) THEN
      RAISE EXCEPTION 'External catalog state is missing';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    FOR bucket IN SELECT locale_mask, count(*) AS total FROM old_rows
      WHERE active AND locale_mask <> 0 GROUP BY locale_mask
    LOOP
      deltas[bucket.locale_mask] := deltas[bucket.locale_mask] - bucket.total;
    END LOOP;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    FOR bucket IN SELECT locale_mask, count(*) AS total FROM new_rows
      WHERE active AND locale_mask <> 0 GROUP BY locale_mask
    LOOP
      deltas[bucket.locale_mask] := deltas[bucket.locale_mask] + bucket.total;
    END LOOP;
  END IF;

  IF deltas <> empty_counts THEN
    -- One row lock for all masks. Compute against the current locked row, so
    -- concurrent transactions cannot overwrite each other's count changes.
    UPDATE public.external_catalog_state AS state SET locale_counts = ARRAY(
      SELECT state.locale_counts[mask] + deltas[mask] FROM generate_series(1, 7) AS buckets(mask) ORDER BY mask
    ) WHERE state.id = 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'External catalog state is missing';
    END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- Match the supplier writer order, then fence filter writes while leaving
-- ordinary SELECTs available. Failed lock acquisition, backfill, or DDL
-- rolls back the whole migration before any of it becomes visible.
DO $$ BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'External catalog locale counts migration requires read committed';
  END IF;
END $$;
SELECT pg_advisory_xact_lock(78291332);
LOCK TABLE public.external_catalog_filter IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TRIGGER external_catalog_locale_counts_insert AFTER INSERT ON public.external_catalog_filter
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.sync_external_catalog_locale_counts();
CREATE TRIGGER external_catalog_locale_counts_update AFTER UPDATE ON public.external_catalog_filter
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.sync_external_catalog_locale_counts();
CREATE TRIGGER external_catalog_locale_counts_delete AFTER DELETE ON public.external_catalog_filter
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.sync_external_catalog_locale_counts();
CREATE TRIGGER external_catalog_locale_counts_truncate AFTER TRUNCATE ON public.external_catalog_filter
  FOR EACH STATEMENT EXECUTE FUNCTION public.sync_external_catalog_locale_counts();
--> statement-breakpoint
DO $$
DECLARE
  initial_counts bigint[];
BEGIN
  SELECT ARRAY(
    SELECT coalesce(counts.total, 0)
    FROM generate_series(1, 7) AS buckets(mask)
    LEFT JOIN (
      SELECT locale_mask, count(*) AS total FROM public.external_catalog_filter
      WHERE active AND locale_mask <> 0 GROUP BY locale_mask
    ) counts ON counts.locale_mask = mask
    ORDER BY mask
  ) INTO initial_counts;

  -- Acquire the state DDL lock after backfill so it is held briefly.
  ALTER TABLE public.external_catalog_state ADD COLUMN locale_counts bigint[] NOT NULL
    DEFAULT ARRAY[0,0,0,0,0,0,0]::bigint[],
    ADD CONSTRAINT external_catalog_state_locale_counts_check CHECK (
      CASE WHEN array_ndims(locale_counts) = 1 AND array_lower(locale_counts, 1) = 1
        AND array_upper(locale_counts, 1) = 7
      THEN array_position(locale_counts, NULL::bigint) IS NULL AND 0::bigint <= ALL (locale_counts)
      ELSE false END
    );

  UPDATE public.external_catalog_state SET locale_counts = initial_counts WHERE id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'External catalog state is missing';
  END IF;
END $$;
