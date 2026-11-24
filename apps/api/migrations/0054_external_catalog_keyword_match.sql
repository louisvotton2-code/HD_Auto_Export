-- The compact projection starts empty. A bounded backfill publishes readiness later.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
SELECT pg_catalog.pg_advisory_xact_lock(78291332);

CREATE TABLE public.external_catalog_keyword_match (
  locale text NOT NULL,
  listing_id uuid NOT NULL,
  search_document text NOT NULL,
  published_at timestamptz NOT NULL,
  make_id text,
  model_id text,
  trim_id text,
  generation_id text,
  model_year integer,
  drivetrain text,
  powertrain text,
  label_order text NOT NULL,
  PRIMARY KEY (locale, listing_id)
) PARTITION BY LIST (locale);
CREATE TABLE public.external_catalog_keyword_match_en PARTITION OF public.external_catalog_keyword_match FOR VALUES IN ('en');
CREATE TABLE public.external_catalog_keyword_match_ru PARTITION OF public.external_catalog_keyword_match FOR VALUES IN ('ru');
CREATE INDEX external_catalog_keyword_match_trgm_idx ON public.external_catalog_keyword_match USING gin (search_document public.gin_trgm_ops);

CREATE TABLE public.external_catalog_keyword_match_state (
  id integer PRIMARY KEY CHECK (id=1),
  maintaining boolean NOT NULL DEFAULT false,
  ready boolean NOT NULL DEFAULT false,
  last_listing_id uuid,
  scan_complete boolean NOT NULL DEFAULT false,
  last_verified_listing_id uuid,
  verification_complete boolean NOT NULL DEFAULT false,
  CHECK (NOT scan_complete OR maintaining),
  CHECK (NOT verification_complete OR scan_complete),
  CHECK (NOT ready OR verification_complete)
);
INSERT INTO public.external_catalog_keyword_match_state (id) VALUES (1);

CREATE VIEW public.external_catalog_keyword_match_source_ordered AS
  SELECT s.locale,f.listing_id,s.search_document,f.published_at,f.make_id,f.model_id,f.trim_id,
         f.generation_id,f.model_year,f.drivetrain,f.powertrain,f.label_order,
         lower(s.make_text) AS make_order,lower(s.model_text) AS model_order
  FROM public.external_catalog_filter f
  JOIN public.external_catalog_search s USING (listing_id)
  WHERE f.active
    AND ((s.locale='en' AND (f.locale_mask & 2)<>0) OR (s.locale='ru' AND (f.locale_mask & 4)<>0));
CREATE VIEW public.external_catalog_keyword_match_source AS
  SELECT locale,listing_id,search_document,published_at,make_id,model_id,trim_id,generation_id,
         model_year,drivetrain,powertrain,label_order
  FROM public.external_catalog_keyword_match_source_ordered;
--> statement-breakpoint
-- Callers that read a backfill page take the existing supplier writer guard
-- before reading its IDs. The triggers also reuse it for direct source edits.
CREATE FUNCTION public.refresh_external_catalog_keyword_match(ids uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- An older repeatable-read snapshot can miss a search row added just before
  -- the guard was acquired. Refuse material writes through that snapshot.
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'Keyword match maintenance requires read committed writes' USING ERRCODE='0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(78291332);
  WITH expected AS MATERIALIZED (
    SELECT * FROM public.external_catalog_keyword_match_source_ordered WHERE listing_id=ANY(ids)
  ), removed AS (
    DELETE FROM public.external_catalog_keyword_match old_match
    WHERE old_match.locale IN ('en','ru') AND old_match.listing_id=ANY(ids)
      AND NOT EXISTS (SELECT FROM expected e WHERE (e.locale,e.listing_id)=(old_match.locale,old_match.listing_id))
  )
  INSERT INTO public.external_catalog_keyword_match AS old_match
    (locale,listing_id,search_document,published_at,make_id,model_id,trim_id,generation_id,model_year,drivetrain,powertrain,label_order)
  SELECT e.locale,e.listing_id,e.search_document,e.published_at,e.make_id,e.model_id,e.trim_id,e.generation_id,
         e.model_year,e.drivetrain,e.powertrain,e.label_order
  FROM expected e
  LEFT JOIN public.external_catalog_keyword_match current_match USING (locale,listing_id)
  WHERE current_match.listing_id IS NULL OR
    ROW(current_match.search_document,current_match.published_at,current_match.make_id,current_match.model_id,current_match.trim_id,
        current_match.generation_id,current_match.model_year,current_match.drivetrain,current_match.powertrain,current_match.label_order)
    IS DISTINCT FROM ROW(e.search_document,e.published_at,e.make_id,e.model_id,e.trim_id,
                         e.generation_id,e.model_year,e.drivetrain,e.powertrain,e.label_order)
  ORDER BY e.locale,e.make_order,e.model_order,e.listing_id
  ON CONFLICT (locale,listing_id) DO UPDATE SET
    search_document=excluded.search_document,published_at=excluded.published_at,make_id=excluded.make_id,
    model_id=excluded.model_id,trim_id=excluded.trim_id,generation_id=excluded.generation_id,model_year=excluded.model_year,
    drivetrain=excluded.drivetrain,powertrain=excluded.powertrain,label_order=excluded.label_order;
END;
$$;

CREATE FUNCTION public.lock_external_catalog_keyword_match_sources() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP='TRUNCATE' THEN
    -- PostgreSQL already holds the table lock here. Never wait for a
    -- writer that may need this table, and require a separate read cutover.
    IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
      RAISE EXCEPTION 'Keyword match maintenance requires read committed writes' USING ERRCODE='0A000';
    END IF;
    IF NOT pg_try_advisory_xact_lock(78291332) THEN
      RAISE EXCEPTION 'Keyword match writer is active' USING ERRCODE='55P03';
    END IF;
    IF EXISTS (SELECT FROM public.external_catalog_keyword_match_state WHERE ready) THEN
      RAISE EXCEPTION 'Disable keyword match and drain readers before truncating' USING ERRCODE='55000';
    END IF;
    RETURN NULL;
  END IF;
  -- The top-level source write takes the guard before row locks. Nested
  -- projection triggers inherit it and cannot impose a second lock order.
  IF pg_trigger_depth()=1 THEN PERFORM pg_advisory_xact_lock(78291332); END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.sync_external_catalog_keyword_match() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- Reading an old disabled flag must not bypass a newly started projection.
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'Keyword match maintenance requires read committed writes' USING ERRCODE='0A000';
  END IF;
  IF NOT EXISTS (SELECT FROM public.external_catalog_keyword_match_state WHERE maintaining) THEN RETURN NULL; END IF;
  IF TG_OP='DELETE' THEN
    PERFORM public.refresh_external_catalog_keyword_match(ARRAY[OLD.listing_id]);
  ELSIF TG_OP='UPDATE' AND NEW.listing_id IS DISTINCT FROM OLD.listing_id THEN
    PERFORM public.refresh_external_catalog_keyword_match(ARRAY[OLD.listing_id,NEW.listing_id]);
  ELSE
    PERFORM public.refresh_external_catalog_keyword_match(ARRAY[NEW.listing_id]);
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.reset_external_catalog_keyword_match() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME IN ('external_catalog_filter','external_catalog_search') THEN
    TRUNCATE public.external_catalog_keyword_match;
  END IF;
  UPDATE public.external_catalog_keyword_match_state
    SET maintaining=false,ready=false,last_listing_id=NULL,scan_complete=false,last_verified_listing_id=NULL,verification_complete=false
    WHERE id=1 AND (maintaining OR ready OR last_listing_id IS NOT NULL OR scan_complete OR last_verified_listing_id IS NOT NULL OR verification_complete);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- Acquire the guard on the outer writes as well as direct projection writes,
-- before row-level projections can take locks in a different order.
CREATE TRIGGER external_keyword_match_listing_guard
BEFORE INSERT OR UPDATE OF id,upstream_state OR DELETE OR TRUNCATE ON public.external_listings
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_external_catalog_keyword_match_sources();
CREATE TRIGGER external_keyword_match_catalog_guard
BEFORE INSERT OR UPDATE OF listing_id,published_at,facts,localized OR DELETE OR TRUNCATE ON public.external_catalog
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_external_catalog_keyword_match_sources();
CREATE TRIGGER external_keyword_match_filter_guard
BEFORE INSERT OR UPDATE OF listing_id,active,locale_mask,published_at,make_id,model_id,trim_id,generation_id,
                           model_year,drivetrain,powertrain OR DELETE OR TRUNCATE ON public.external_catalog_filter
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_external_catalog_keyword_match_sources();
CREATE TRIGGER external_keyword_match_search_guard
BEFORE INSERT OR UPDATE OF listing_id,locale,stock_text,make_text,model_text,title_text OR DELETE OR TRUNCATE ON public.external_catalog_search
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_external_catalog_keyword_match_sources();
CREATE TRIGGER external_keyword_match_truncate_guard BEFORE TRUNCATE ON public.external_catalog_keyword_match
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_external_catalog_keyword_match_sources();
CREATE TRIGGER external_keyword_match_en_truncate_guard BEFORE TRUNCATE ON public.external_catalog_keyword_match_en
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_external_catalog_keyword_match_sources();
CREATE TRIGGER external_keyword_match_ru_truncate_guard BEFORE TRUNCATE ON public.external_catalog_keyword_match_ru
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_external_catalog_keyword_match_sources();

CREATE TRIGGER external_keyword_match_filter_insert AFTER INSERT ON public.external_catalog_filter
FOR EACH ROW WHEN (NEW.active AND (NEW.locale_mask & 6)<>0) EXECUTE FUNCTION public.sync_external_catalog_keyword_match();
CREATE TRIGGER external_keyword_match_filter_delete AFTER DELETE ON public.external_catalog_filter
FOR EACH ROW WHEN (OLD.active AND (OLD.locale_mask & 6)<>0) EXECUTE FUNCTION public.sync_external_catalog_keyword_match();
CREATE TRIGGER external_keyword_match_filter_update AFTER UPDATE ON public.external_catalog_filter
FOR EACH ROW WHEN (
  ((OLD.active AND (OLD.locale_mask & 6)<>0) OR (NEW.active AND (NEW.locale_mask & 6)<>0))
  AND ROW(OLD.listing_id,OLD.active,OLD.locale_mask & 6,OLD.published_at,OLD.make_id,OLD.model_id,OLD.trim_id,
          OLD.generation_id,OLD.model_year,OLD.drivetrain,OLD.powertrain,OLD.label_order)
      IS DISTINCT FROM ROW(NEW.listing_id,NEW.active,NEW.locale_mask & 6,NEW.published_at,NEW.make_id,NEW.model_id,NEW.trim_id,
                           NEW.generation_id,NEW.model_year,NEW.drivetrain,NEW.powertrain,NEW.label_order)
) EXECUTE FUNCTION public.sync_external_catalog_keyword_match();

CREATE TRIGGER external_keyword_match_search_insert AFTER INSERT ON public.external_catalog_search
FOR EACH ROW WHEN (NEW.locale IN ('en','ru')) EXECUTE FUNCTION public.sync_external_catalog_keyword_match();
CREATE TRIGGER external_keyword_match_search_delete AFTER DELETE ON public.external_catalog_search
FOR EACH ROW WHEN (OLD.locale IN ('en','ru')) EXECUTE FUNCTION public.sync_external_catalog_keyword_match();
CREATE TRIGGER external_keyword_match_search_update AFTER UPDATE ON public.external_catalog_search
FOR EACH ROW WHEN (
  (OLD.locale IN ('en','ru') OR NEW.locale IN ('en','ru'))
  AND ROW(OLD.listing_id,OLD.locale,OLD.search_document) IS DISTINCT FROM ROW(NEW.listing_id,NEW.locale,NEW.search_document)
) EXECUTE FUNCTION public.sync_external_catalog_keyword_match();

CREATE TRIGGER external_keyword_match_filter_truncate AFTER TRUNCATE ON public.external_catalog_filter
FOR EACH STATEMENT EXECUTE FUNCTION public.reset_external_catalog_keyword_match();
CREATE TRIGGER external_keyword_match_search_truncate AFTER TRUNCATE ON public.external_catalog_search
FOR EACH STATEMENT EXECUTE FUNCTION public.reset_external_catalog_keyword_match();
CREATE TRIGGER external_keyword_match_truncate AFTER TRUNCATE ON public.external_catalog_keyword_match
FOR EACH STATEMENT EXECUTE FUNCTION public.reset_external_catalog_keyword_match();
CREATE TRIGGER external_keyword_match_en_truncate AFTER TRUNCATE ON public.external_catalog_keyword_match_en
FOR EACH STATEMENT EXECUTE FUNCTION public.reset_external_catalog_keyword_match();
CREATE TRIGGER external_keyword_match_ru_truncate AFTER TRUNCATE ON public.external_catalog_keyword_match_ru
FOR EACH STATEMENT EXECUTE FUNCTION public.reset_external_catalog_keyword_match();
