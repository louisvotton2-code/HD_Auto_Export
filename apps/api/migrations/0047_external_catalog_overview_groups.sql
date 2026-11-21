-- These groups cover the supplier overview queries with a known powertrain and
-- model year. The original filter rows remain authoritative for other queries.
SET LOCAL search_path = pg_catalog, public;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5s';
--> statement-breakpoint
CREATE TABLE public.external_catalog_overview_groups (
  powertrain text NOT NULL CHECK (powertrain <> 'unknown'),
  locale_mask smallint NOT NULL CHECK (locale_mask BETWEEN 1 AND 7),
  model_year integer NOT NULL,
  make_id text,
  drivetrain text,
  row_count integer NOT NULL CHECK (row_count >= 0),
  trim_count integer NOT NULL CHECK (trim_count BETWEEN 0 AND row_count),
  generation_count integer NOT NULL CHECK (generation_count BETWEEN 0 AND row_count),
  label_order text COLLATE "C",
  CONSTRAINT external_catalog_overview_groups_key UNIQUE NULLS NOT DISTINCT
    (powertrain, locale_mask, model_year, make_id, drivetrain),
  CHECK ((label_order IS NOT NULL) = (make_id IS NOT NULL AND row_count > 0))
);
--> statement-breakpoint
CREATE FUNCTION public.sync_external_catalog_overview_groups() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  projection constant text := $projection$
    SELECT f.listing_id, f.powertrain, f.locale_mask, f.model_year, f.make_id, f.drivetrain,
      f.make_id IS NOT NULL AND f.model_id IS NOT NULL AND f.trim_id IS NOT NULL AS has_trim,
      f.make_id IS NOT NULL AND f.model_id IS NOT NULL AND f.generation_id IS NOT NULL AS has_generation,
      CASE WHEN f.make_id IS NOT NULL THEN f.label_order COLLATE "C" END AS label_order
    FROM %s AS f
    WHERE f.active AND f.locale_mask <> 0 AND f.powertrain IS NOT NULL
      AND f.powertrain <> 'unknown' AND f.model_year IS NOT NULL
  $projection$;
  empty_source constant text := '(SELECT * FROM public.external_catalog_filter WHERE false)';
  bucket record;
  stored public.external_catalog_overview_groups%ROWTYPE;
  reselect public.external_catalog_overview_groups[] := ARRAY[]::public.external_catalog_overview_groups[];
  next_rows integer;
  next_trims integer;
  next_generations integer;
  next_label text;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    DELETE FROM public.external_catalog_overview_groups;
    RETURN NULL;
  END IF;

  -- Only trigger-owned transition relations or a typed empty relation appear
  -- here. The difference ignores updates to price, fetch time and other fields
  -- which leave a row's contribution unchanged.
  FOR bucket IN EXECUTE format($buckets$
    WITH prior AS MATERIALIZED (%s), incoming AS MATERIALIZED (%s),
    removed AS (SELECT * FROM prior EXCEPT SELECT * FROM incoming),
    added AS (SELECT * FROM incoming EXCEPT SELECT * FROM prior),
    changes AS (SELECT *, -1 AS delta FROM removed UNION ALL SELECT *, 1 FROM added),
    totals AS (
      SELECT powertrain, locale_mask, model_year, make_id, drivetrain,
        sum(delta)::integer AS rows_delta,
        coalesce(sum(delta) FILTER (WHERE has_trim), 0)::integer AS trims_delta,
        coalesce(sum(delta) FILTER (WHERE has_generation), 0)::integer AS generations_delta,
        count(*) FILTER (WHERE delta = -1) AS removed_rows,
        min(label_order COLLATE "C") FILTER (WHERE delta = -1) AS removed_label,
        min(label_order COLLATE "C") FILTER (WHERE delta = 1) AS added_label
      FROM changes GROUP BY powertrain, locale_mask, model_year, make_id, drivetrain
    ) SELECT * FROM totals
    WHERE rows_delta <> 0 OR trims_delta <> 0 OR generations_delta <> 0
      OR removed_label IS DISTINCT FROM added_label
    ORDER BY powertrain COLLATE "C", locale_mask, model_year,
      make_id COLLATE "C" NULLS FIRST, drivetrain COLLATE "C" NULLS FIRST
  $buckets$,
    format(projection, CASE WHEN TG_OP = 'INSERT' THEN empty_source ELSE 'old_rows' END),
    format(projection, CASE WHEN TG_OP = 'DELETE' THEN empty_source ELSE 'new_rows' END))
  LOOP
    -- Only additions may create a missing bucket. Lock the actual row before
    -- applying deltas so concurrent writers accumulate rather than overwrite.
    SELECT g.* INTO stored FROM public.external_catalog_overview_groups g
    WHERE g.powertrain = bucket.powertrain AND g.locale_mask = bucket.locale_mask
      AND g.model_year = bucket.model_year AND g.make_id IS NOT DISTINCT FROM bucket.make_id
      AND g.drivetrain IS NOT DISTINCT FROM bucket.drivetrain FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      IF bucket.removed_rows <> 0 OR bucket.rows_delta <= 0 THEN
        RAISE EXCEPTION 'External catalog overview group is missing';
      END IF;
      INSERT INTO public.external_catalog_overview_groups
        (powertrain, locale_mask, model_year, make_id, drivetrain, row_count, trim_count, generation_count)
      VALUES (bucket.powertrain, bucket.locale_mask, bucket.model_year, bucket.make_id, bucket.drivetrain, 0, 0, 0)
      ON CONFLICT ON CONSTRAINT external_catalog_overview_groups_key DO NOTHING;
      SELECT g.* INTO STRICT stored FROM public.external_catalog_overview_groups g
      WHERE g.powertrain = bucket.powertrain AND g.locale_mask = bucket.locale_mask
        AND g.model_year = bucket.model_year AND g.make_id IS NOT DISTINCT FROM bucket.make_id
        AND g.drivetrain IS NOT DISTINCT FROM bucket.drivetrain FOR NO KEY UPDATE;
    END IF;

    next_rows := stored.row_count + bucket.rows_delta;
    next_trims := stored.trim_count + bucket.trims_delta;
    next_generations := stored.generation_count + bucket.generations_delta;
    IF bucket.removed_rows > stored.row_count OR next_rows < 0
      OR next_trims NOT BETWEEN 0 AND next_rows OR next_generations NOT BETWEEN 0 AND next_rows THEN
      RAISE EXCEPTION 'External catalog overview group counts are inconsistent';
    END IF;

    IF next_rows = 0 THEN
      DELETE FROM public.external_catalog_overview_groups g
      WHERE g.powertrain = bucket.powertrain AND g.locale_mask = bucket.locale_mask
        AND g.model_year = bucket.model_year AND g.make_id IS NOT DISTINCT FROM bucket.make_id
        AND g.drivetrain IS NOT DISTINCT FROM bucket.drivetrain;
      CONTINUE;
    END IF;

    next_label := stored.label_order;
    IF bucket.added_label IS NOT NULL AND
      (next_label IS NULL OR bucket.added_label COLLATE "C" <= next_label COLLATE "C") THEN
      next_label := bucket.added_label;
    ELSIF bucket.removed_label = next_label THEN
      -- Keep the row locked and stage its new counts. The second pass can
      -- commit the counts and the replacement label in one physical update.
      stored.row_count := next_rows;
      stored.trim_count := next_trims;
      stored.generation_count := next_generations;
      reselect := array_append(reselect, stored);
      CONTINUE;
    END IF;

    UPDATE public.external_catalog_overview_groups g
    SET row_count = next_rows, trim_count = next_trims, generation_count = next_generations,
      label_order = next_label
    WHERE g.powertrain = bucket.powertrain AND g.locale_mask = bucket.locale_mask
      AND g.model_year = bucket.model_year AND g.make_id IS NOT DISTINCT FROM bucket.make_id
      AND g.drivetrain IS NOT DISTINCT FROM bucket.drivetrain
      AND ROW(g.row_count, g.trim_count, g.generation_count, g.label_order)
        IS DISTINCT FROM ROW(next_rows, next_trims, next_generations, next_label);
  END LOOP;

  IF cardinality(reselect) = 0 THEN
    RETURN NULL;
  END IF;

  FOR bucket IN
    WITH requested AS MATERIALIZED (
      SELECT powertrain, locale_mask, model_year, make_id, drivetrain,
        row_count, trim_count, generation_count FROM unnest(reselect)
    ), cohorts AS (
      SELECT DISTINCT powertrain, locale_mask, model_year FROM requested
    ), candidates AS MATERIALIZED (
      SELECT cohort.powertrain, cohort.locale_mask, cohort.model_year,
        candidate.make_id, candidate.drivetrain, candidate.label_order
      FROM cohorts cohort CROSS JOIN LATERAL (
        -- Materialize one narrow, 0045-prefix scan per distinct cohort before
        -- matching bucket keys. OFFSET 0 keeps the scan parameterized by cohort.
        SELECT f.make_id, f.drivetrain, f.label_order FROM public.external_catalog_filter f
        WHERE f.active AND f.locale_mask <> 0 AND f.powertrain IS NOT NULL
          AND f.powertrain = cohort.powertrain AND f.locale_mask = cohort.locale_mask
          AND f.model_year = cohort.model_year AND f.make_id IS NOT NULL
        OFFSET 0
      ) candidate
    )
    SELECT r.powertrain, r.locale_mask, r.model_year, r.make_id, r.drivetrain,
      r.row_count, r.trim_count, r.generation_count,
      min(c.label_order COLLATE "C") AS label_order
    FROM requested r LEFT JOIN candidates c
      ON c.powertrain = r.powertrain AND c.locale_mask = r.locale_mask AND c.model_year = r.model_year
      AND c.make_id = r.make_id AND c.drivetrain IS NOT DISTINCT FROM r.drivetrain
    GROUP BY r.powertrain, r.locale_mask, r.model_year, r.make_id, r.drivetrain,
      r.row_count, r.trim_count, r.generation_count
  LOOP
    IF bucket.label_order IS NULL THEN
      RAISE EXCEPTION 'External catalog overview group has no replacement label';
    END IF;
    UPDATE public.external_catalog_overview_groups g
    SET row_count = bucket.row_count, trim_count = bucket.trim_count,
      generation_count = bucket.generation_count, label_order = bucket.label_order
    WHERE g.powertrain = bucket.powertrain AND g.locale_mask = bucket.locale_mask
      AND g.model_year = bucket.model_year AND g.make_id = bucket.make_id
      AND g.drivetrain IS NOT DISTINCT FROM bucket.drivetrain
      AND ROW(g.row_count, g.trim_count, g.generation_count, g.label_order)
        IS DISTINCT FROM ROW(bucket.row_count, bucket.trim_count, bucket.generation_count, bucket.label_order);
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- Use statement snapshots after waiting for the usual supplier writer. The
-- filter lock blocks concurrent mutations during the initial fill, not reads.
DO $$ BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'External catalog overview groups migration requires read committed';
  END IF;
END $$;
SELECT pg_advisory_xact_lock(78291332);
LOCK TABLE public.external_catalog_filter IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO public.external_catalog_overview_groups
  (powertrain, locale_mask, model_year, make_id, drivetrain, row_count, trim_count, generation_count, label_order)
SELECT f.powertrain, f.locale_mask, f.model_year, f.make_id, f.drivetrain,
  count(*)::integer,
  count(*) FILTER (WHERE f.make_id IS NOT NULL AND f.model_id IS NOT NULL AND f.trim_id IS NOT NULL)::integer,
  count(*) FILTER (WHERE f.make_id IS NOT NULL AND f.model_id IS NOT NULL AND f.generation_id IS NOT NULL)::integer,
  min(f.label_order COLLATE "C") FILTER (WHERE f.make_id IS NOT NULL)
FROM public.external_catalog_filter f
WHERE f.active AND f.locale_mask <> 0 AND f.powertrain IS NOT NULL
  AND f.powertrain <> 'unknown' AND f.model_year IS NOT NULL
GROUP BY f.powertrain, f.locale_mask, f.model_year, f.make_id, f.drivetrain;
--> statement-breakpoint
CREATE TRIGGER external_catalog_overview_groups_insert AFTER INSERT ON public.external_catalog_filter
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.sync_external_catalog_overview_groups();
CREATE TRIGGER external_catalog_overview_groups_update AFTER UPDATE ON public.external_catalog_filter
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.sync_external_catalog_overview_groups();
CREATE TRIGGER external_catalog_overview_groups_delete AFTER DELETE ON public.external_catalog_filter
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.sync_external_catalog_overview_groups();
CREATE TRIGGER external_catalog_overview_groups_truncate AFTER TRUNCATE ON public.external_catalog_filter
  FOR EACH STATEMENT EXECUTE FUNCTION public.sync_external_catalog_overview_groups();
