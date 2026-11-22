-- Additive and compatible with the previous API. Existing groups start with
-- unresolved labels. The new API falls back to the authority in its snapshot
-- until a bounded backfill or a normal source write initializes the group.
SET LOCAL search_path = pg_catalog, public;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5s';
--> statement-breakpoint
DO $$ BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'External overview winner label DDL requires read committed';
  END IF;
END $$;
-- Acquire the supplier lock before touching any relation, in the same order
-- as source and visibility writers. Manual repairs use this lock as well.
SELECT pg_advisory_xact_lock(78291332);
--> statement-breakpoint
ALTER TABLE public.external_catalog_overview_groups
  ADD COLUMN make_winner_labels text[],
  ADD CONSTRAINT external_catalog_overview_make_winner_labels_check
    CHECK (make_winner_labels IS NULL OR
      coalesce(label_order IS NOT NULL AND array_ndims(make_winner_labels) = 1
       AND array_lower(make_winner_labels, 1) = 1
       AND array_length(make_winner_labels, 1) = 3, false));
CREATE INDEX external_catalog_overview_make_winner_idx
  ON public.external_catalog_overview_groups ((substring(label_order FROM 19 FOR 36)::uuid))
  WHERE label_order IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION public.read_external_overview_make_winner_labels(winner uuid) RETURNS text[]
LANGUAGE sql SET search_path = pg_catalog, public AS $$
  SELECT ARRAY(
    SELECT (
      SELECT CASE
        WHEN alternate.name IS NULL OR alternate.name IS NOT DISTINCT FROM s.make_label
          THEN s.make_label
        WHEN EXISTS (SELECT FROM public.external_listing_overrides o
            WHERE o.listing_id = winner AND o.data->'facts' ? 'make')
          OR EXISTS (SELECT FROM public.external_catalog c WHERE c.listing_id = winner
            AND c.localized->wanted.locale->'display'->'make'->>'provenance' = 'human')
          THEN s.make_label
        ELSE alternate.name END
      FROM public.external_catalog_search s
      LEFT JOIN LATERAL (
        SELECT x.data->'names'->'make'->>'text' AS name
        FROM public.external_vehicle_extras x
        WHERE x.listing_id = winner AND x.locale = wanted.locale
        LIMIT 1
      ) alternate ON true
      WHERE s.listing_id = winner AND s.locale = wanted.locale
    )
    FROM unnest(ARRAY['zh','en','ru']) WITH ORDINALITY AS wanted(locale, position)
    ORDER BY position
  );
$$;
--> statement-breakpoint
CREATE FUNCTION public.set_external_overview_make_winner_labels() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.label_order IS NOT DISTINCT FROM OLD.label_order THEN
    RETURN NEW;
  END IF;
  NEW.make_winner_labels := CASE WHEN NEW.label_order IS NOT NULL THEN
    public.read_external_overview_make_winner_labels(substring(NEW.label_order FROM 19 FOR 36)::uuid)
  END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER external_overview_make_winner_labels
BEFORE INSERT OR UPDATE OF label_order ON public.external_catalog_overview_groups
FOR EACH ROW EXECUTE FUNCTION public.set_external_overview_make_winner_labels();
--> statement-breakpoint
-- A zero source mask is a representation-only fill. Never change an
-- initialized group or expire a public snapshot through that path.
CREATE FUNCTION public.refresh_external_overview_make_winner_labels(winner uuid, source_mask integer) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  visible_change boolean;
BEGIN
  WITH refreshed AS MATERIALIZED (
    SELECT public.read_external_overview_make_winner_labels(winner) AS labels
    WHERE EXISTS (
      SELECT FROM public.external_catalog_overview_groups g
      WHERE g.label_order IS NOT NULL AND substring(g.label_order FROM 19 FOR 36)::uuid = winner
    )
  ), changed AS (
    UPDATE public.external_catalog_overview_groups g SET make_winner_labels = refreshed.labels
    FROM refreshed
    WHERE g.label_order IS NOT NULL AND substring(g.label_order FROM 19 FOR 36)::uuid = winner
      AND (source_mask <> 0 OR g.make_winner_labels IS NULL)
      AND g.make_winner_labels IS DISTINCT FROM refreshed.labels
    RETURNING WITH (OLD AS prior, NEW AS updated)
      CASE WHEN prior.make_winner_labels IS NULL THEN (prior.locale_mask & source_mask) <> 0
      ELSE (
        ((prior.locale_mask & 1) <> 0 AND prior.make_winner_labels[1] IS DISTINCT FROM updated.make_winner_labels[1])
        OR ((prior.locale_mask & 2) <> 0 AND prior.make_winner_labels[2] IS DISTINCT FROM updated.make_winner_labels[2])
        OR ((prior.locale_mask & 4) <> 0 AND prior.make_winner_labels[3] IS DISTINCT FROM updated.make_winner_labels[3])
      ) END AS changed_visible_locale
  )
  SELECT bool_or(changed_visible_locale) INTO visible_change FROM changed;
  IF source_mask <> 0 AND visible_change THEN
    PERFORM public.queue_public_catalog_change();
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_external_overview_make_winner_labels(uuid, integer) FROM PUBLIC;
--> statement-breakpoint
-- A catalog insertion and the later search projection can happen in either
-- trigger order. Refresh after the search row appears, even if the leader was
-- tentatively initialized to a null name before that row was projected.
CREATE FUNCTION public.refresh_external_overview_make_winner_source() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  winner uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.listing_id ELSE NEW.listing_id END;
  locales constant text[] := ARRAY['zh','en','ru'];
  localized_source boolean := TG_TABLE_NAME IN ('external_catalog_search', 'external_vehicle_extras');
  old_mask integer := 0;
  new_mask integer := 0;
BEGIN
  IF localized_source THEN
    IF TG_OP <> 'INSERT' THEN old_mask := 1 << (array_position(locales, OLD.locale) - 1); END IF;
    IF TG_OP <> 'DELETE' THEN new_mask := 1 << (array_position(locales, NEW.locale) - 1); END IF;
  ELSE
    old_mask := 7;
    new_mask := 7;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.listing_id IS DISTINCT FROM NEW.listing_id THEN
    PERFORM public.refresh_external_overview_make_winner_labels(OLD.listing_id, old_mask);
    old_mask := 0;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.listing_id = NEW.listing_id THEN
    -- Search labels are scalar. For the other sources, avoid inspecting wide
    -- JSON columns unless this listing is an actual rollup winner.
    IF TG_TABLE_NAME <> 'external_catalog_search' AND NOT EXISTS (
      SELECT FROM public.external_catalog_overview_groups g
      WHERE g.label_order IS NOT NULL AND substring(g.label_order FROM 19 FOR 36)::uuid = winner
    ) THEN RETURN NULL; END IF;

    CASE TG_TABLE_NAME
      WHEN 'external_catalog_search' THEN
        IF OLD.locale = NEW.locale AND OLD.make_label IS NOT DISTINCT FROM NEW.make_label THEN RETURN NULL; END IF;
      WHEN 'external_catalog' THEN
        SELECT coalesce(bit_or(1 << (position::integer - 1)), 0) INTO new_mask
          FROM unnest(locales) WITH ORDINALITY AS wanted(locale, position)
          WHERE ((OLD.localized->wanted.locale->'display'->'make'->>'provenance' = 'human') IS TRUE)
            IS DISTINCT FROM
            ((NEW.localized->wanted.locale->'display'->'make'->>'provenance' = 'human') IS TRUE);
        IF new_mask = 0 THEN RETURN NULL; END IF;
        old_mask := 0;
      WHEN 'external_vehicle_extras' THEN
        IF OLD.locale = NEW.locale AND (OLD.data->'names'->'make'->>'text')
          IS NOT DISTINCT FROM (NEW.data->'names'->'make'->>'text') THEN RETURN NULL; END IF;
      WHEN 'external_listing_overrides' THEN
        IF coalesce(OLD.data->'facts' ? 'make', false) = coalesce(NEW.data->'facts' ? 'make', false) THEN RETURN NULL; END IF;
    END CASE;
  END IF;
  PERFORM public.refresh_external_overview_make_winner_labels(winner, old_mask | new_mask);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER external_overview_make_winner_search
AFTER INSERT OR UPDATE OF listing_id, locale, make_label OR DELETE ON public.external_catalog_search
FOR EACH ROW EXECUTE FUNCTION public.refresh_external_overview_make_winner_source();
CREATE TRIGGER external_overview_make_winner_catalog
AFTER UPDATE OF listing_id, localized ON public.external_catalog
FOR EACH ROW EXECUTE FUNCTION public.refresh_external_overview_make_winner_source();
CREATE TRIGGER external_overview_make_winner_extra
AFTER INSERT OR UPDATE OF listing_id, locale, data OR DELETE ON public.external_vehicle_extras
FOR EACH ROW EXECUTE FUNCTION public.refresh_external_overview_make_winner_source();
CREATE TRIGGER external_overview_make_winner_override
AFTER INSERT OR UPDATE OF listing_id, data OR DELETE ON public.external_listing_overrides
FOR EACH ROW EXECUTE FUNCTION public.refresh_external_overview_make_winner_source();
--> statement-breakpoint
-- Raw maintenance may clear one source without touching the others. Expire
-- the compact names and let the API resolve them from its current snapshot.
CREATE FUNCTION public.invalidate_external_overview_make_winner_labels() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.external_catalog_overview_groups SET make_winner_labels = NULL
    WHERE make_winner_labels IS NOT NULL;
  IF EXISTS (SELECT FROM public.external_catalog_overview_groups WHERE label_order IS NOT NULL) THEN
    PERFORM public.queue_public_catalog_change();
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER external_overview_make_winner_search_truncate AFTER TRUNCATE ON public.external_catalog_search
FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_external_overview_make_winner_labels();
CREATE TRIGGER external_overview_make_winner_catalog_truncate AFTER TRUNCATE ON public.external_catalog
FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_external_overview_make_winner_labels();
CREATE TRIGGER external_overview_make_winner_extra_truncate AFTER TRUNCATE ON public.external_vehicle_extras
FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_external_overview_make_winner_labels();
CREATE TRIGGER external_overview_make_winner_override_truncate AFTER TRUNCATE ON public.external_listing_overrides
FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_external_overview_make_winner_labels();
--> statement-breakpoint
-- One call per short READ COMMITTED transaction with an outer statement
-- timeout. Zero means complete; 55P03 means another supplier write is active.
CREATE FUNCTION public.fill_external_overview_make_winner_labels(maximum integer DEFAULT 50) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog, public SET lock_timeout = '1s' AS $$
DECLARE
  winner uuid;
  completed integer := 0;
  transaction_id text := pg_current_xact_id()::text;
BEGIN
  IF maximum IS NULL OR maximum NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'External overview winner label fill batch size must be between 1 and 50';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'External overview winner label fill requires read committed';
  END IF;
  IF current_setting('hd.external_overview_label_fill', true) = transaction_id THEN
    RAISE EXCEPTION 'Only one external overview winner label fill is allowed per transaction';
  END IF;
  IF NOT pg_try_advisory_xact_lock(78291332) THEN
    RAISE EXCEPTION USING ERRCODE = '55P03', MESSAGE = 'The supplier writer lock is busy';
  END IF;
  PERFORM set_config('hd.external_overview_label_fill', transaction_id, true);
  FOR winner IN
    SELECT DISTINCT substring(g.label_order FROM 19 FOR 36)::uuid
    FROM public.external_catalog_overview_groups g
    WHERE g.label_order IS NOT NULL AND g.make_winner_labels IS NULL
    ORDER BY 1 LIMIT maximum
  LOOP
    PERFORM public.refresh_external_overview_make_winner_labels(winner, 0);
    completed := completed + 1;
  END LOOP;
  RETURN completed;
END;
$$;
REVOKE ALL ON FUNCTION public.fill_external_overview_make_winner_labels(integer) FROM PUBLIC;
