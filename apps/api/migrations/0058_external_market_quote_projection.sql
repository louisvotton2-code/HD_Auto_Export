-- No catalogue backfill or index build on existing relations. Enrolment and
-- verification are separate operations. Do not queue the DDL behind the writer.
SET LOCAL lock_timeout='220ms';
--> statement-breakpoint
CREATE TABLE public.external_market_quote_models (
  make_id text NOT NULL,
  model_id text NOT NULL,
  generation uuid NOT NULL,
  phase text NOT NULL CHECK (phase IN ('preparing','filling','verified','ready','disabled')),
  seed_mask smallint NOT NULL DEFAULT 1 CHECK (seed_mask BETWEEN 1 AND 7),
  seed_published_at timestamptz,
  seed_listing_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((seed_published_at IS NULL) = (seed_listing_id IS NULL)),
  PRIMARY KEY (make_id,model_id)
);

CREATE TABLE public.external_market_quote_pending (
  make_id text NOT NULL,
  model_id text NOT NULL,
  generation uuid NOT NULL,
  listing_id uuid NOT NULL,
  PRIMARY KEY (make_id,model_id,generation,listing_id)
);

CREATE TABLE public.external_market_quote_rows (
  listing_id uuid PRIMARY KEY,
  make_id text NOT NULL,
  model_id text NOT NULL,
  generation uuid NOT NULL,
  locale_mask smallint NOT NULL CHECK (locale_mask BETWEEN 1 AND 7),
  price_cny numeric(16,2) NOT NULL CHECK (price_cny>0),
  trim_id text,
  powertrain text,
  model_year integer,
  mileage_km integer,
  verified_formal boolean NOT NULL
) WITH (fillfactor=90);

CREATE INDEX external_market_quote_rows_model_idx ON public.external_market_quote_rows
  (make_id,model_id,generation,listing_id);
--> statement-breakpoint
-- The formal certificate is valid only for positive, domestic, public rows.
-- Legacy entries are candidates. Mutable successor and language checks remain live.
CREATE FUNCTION public.desired_external_market_quote(target uuid)
RETURNS SETOF public.external_market_quote_rows
LANGUAGE sql STABLE AS $$
  SELECT f.listing_id,f.make_id,f.model_id,m.generation,f.locale_mask,f.price_cny,f.trim_id,
    f.powertrain,f.model_year,f.mileage_km,l.provider='chinacarapi' AND l.formal_canonical_id IS NOT NULL
  FROM public.external_catalog_filter f
  JOIN public.external_market_quote_models m USING (make_id,model_id)
  JOIN public.external_listings l ON l.id=f.listing_id
  WHERE f.listing_id=target AND m.phase<>'disabled' AND f.active AND f.locale_mask<>0 AND f.price_cny>0
    AND l.provider IN ('chinacarapi','chinacarapi-sample')
    AND l.platform_id IN ('che168','dongchedi') AND l.external_id ~ '^[0-9]{1,100}$'
    AND CASE WHEN l.provider='chinacarapi' AND l.formal_canonical_id IS NOT NULL THEN
      l.formal_primary AND l.upstream_state='active'
      -- Constrain both relations by the input ID even when PostgreSQL chooses
      -- to hash an EXISTS subplan. A trigger must never scan the whole catalog.
      AND EXISTS (SELECT FROM public.external_catalog c
        WHERE c.listing_id=target AND c.price_cny=f.price_cny
          AND coalesce(c.facts#>>'{location,country}','CN')='CN')
      AND NOT EXISTS (SELECT FROM public.external_listing_overrides o
        WHERE o.listing_id=target AND o.data->'hidden'='true'::jsonb)
    ELSE true END
$$;

CREATE FUNCTION public.refresh_external_market_quote(target uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public AS $$
DECLARE row_value public.external_market_quote_rows;
BEGIN
  -- Do not test readiness using an older transaction snapshot.
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'Market certification writes require read committed' USING ERRCODE='0A000';
  END IF;
  IF NOT EXISTS (SELECT FROM public.external_market_quote_models WHERE phase<>'disabled') THEN RETURN; END IF;
  -- Only an enrolled new scope or a previously enrolled listing can change this projection.
  IF NOT EXISTS (SELECT FROM public.external_catalog_filter f
    JOIN public.external_market_quote_models m USING (make_id,model_id)
    WHERE f.listing_id=target AND m.phase<>'disabled')
  AND NOT EXISTS (SELECT FROM public.external_market_quote_rows q WHERE q.listing_id=target)
  THEN RETURN; END IF;

  -- Serialize dependency reads on the existing common filter identity. Normal
  -- catalogue writers also take their existing transaction advisory lock.
  PERFORM f.listing_id FROM public.external_catalog_filter f
    WHERE f.listing_id=target FOR NO KEY UPDATE;
  SELECT * INTO row_value FROM public.desired_external_market_quote(target);
  IF NOT FOUND THEN
    DELETE FROM public.external_market_quote_rows WHERE listing_id=target;
    RETURN;
  END IF;
  INSERT INTO public.external_market_quote_rows AS q
  SELECT (row_value).* WHERE NOT EXISTS (
    SELECT FROM public.external_market_quote_rows previous
    WHERE previous.listing_id=target AND previous IS NOT DISTINCT FROM row_value
  )
  ON CONFLICT (listing_id) DO UPDATE SET
    make_id=excluded.make_id,model_id=excluded.model_id,generation=excluded.generation,
    locale_mask=excluded.locale_mask,price_cny=excluded.price_cny,trim_id=excluded.trim_id,
    powertrain=excluded.powertrain,model_year=excluded.model_year,mileage_km=excluded.mileage_km,
    verified_formal=excluded.verified_formal
  WHERE q IS DISTINCT FROM excluded;
END
$$;

CREATE FUNCTION public.verify_external_market_quote_batch(targets uuid[]) RETURNS boolean
LANGUAGE sql VOLATILE AS $$
  SELECT NOT EXISTS (
    SELECT FROM unnest(targets) AS targets(id)
    LEFT JOIN public.external_market_quote_rows q ON q.listing_id=targets.id
    LEFT JOIN LATERAL public.desired_external_market_quote(targets.id) expected ON true
    WHERE q IS DISTINCT FROM expected)
$$;
--> statement-breakpoint
CREATE FUNCTION public.sync_external_market_quote_filter() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    DELETE FROM public.external_market_quote_rows WHERE listing_id=OLD.listing_id;
    RETURN NULL;
  END IF;
  IF TG_OP='UPDATE' AND NEW.listing_id IS DISTINCT FROM OLD.listing_id THEN
    DELETE FROM public.external_market_quote_rows WHERE listing_id=OLD.listing_id;
  END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.listing_id,NEW.active,NEW.locale_mask,NEW.make_id,NEW.model_id,NEW.price_cny,
      NEW.trim_id,NEW.powertrain,NEW.model_year,NEW.mileage_km)
    IS NOT DISTINCT FROM ROW(OLD.listing_id,OLD.active,OLD.locale_mask,OLD.make_id,OLD.model_id,OLD.price_cny,
      OLD.trim_id,OLD.powertrain,OLD.model_year,OLD.mileage_km)
    AND (NEW.published_at IS NOT DISTINCT FROM OLD.published_at OR NOT EXISTS (
      SELECT FROM public.external_market_quote_models m
      WHERE m.make_id=NEW.make_id AND m.model_id=NEW.model_id AND m.phase='preparing'))
  THEN RETURN NULL; END IF;
  IF TG_OP='INSERT' AND (NOT NEW.active OR NEW.locale_mask=0) THEN RETURN NULL; END IF;
  PERFORM public.refresh_external_market_quote(NEW.listing_id);
  RETURN NULL;
END
$$;

CREATE FUNCTION public.sync_external_market_quote_catalog() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE target uuid;
BEGIN
  IF NOT EXISTS (SELECT FROM public.external_market_quote_models WHERE phase<>'disabled') THEN RETURN NULL; END IF;
  -- The existing external_catalog_filter_* statement triggers run first. A
  -- normal price update has already been projected, while a country-only
  -- correction may not touch the filter. Protect that latter case as well.
  IF TG_OP='UPDATE' THEN
    FOR target IN SELECT n.listing_id FROM market_catalog_new n JOIN market_catalog_old o USING(listing_id)
      WHERE ROW(n.price_cny,coalesce(n.facts#>>'{location,country}','CN')='CN')
        IS DISTINCT FROM ROW(o.price_cny,coalesce(o.facts#>>'{location,country}','CN')='CN')
      ORDER BY n.listing_id
    LOOP PERFORM public.refresh_external_market_quote(target); END LOOP;
  ELSIF TG_OP='INSERT' THEN
    FOR target IN SELECT listing_id FROM market_catalog_new ORDER BY listing_id
    LOOP PERFORM public.refresh_external_market_quote(target); END LOOP;
  ELSE
    FOR target IN SELECT listing_id FROM market_catalog_old ORDER BY listing_id
    LOOP PERFORM public.refresh_external_market_quote(target); END LOOP;
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION public.sync_external_market_quote_listing() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF ROW(NEW.provider,NEW.platform_id,NEW.external_id,NEW.upstream_state,NEW.formal_primary,NEW.formal_canonical_id IS NULL)
    IS DISTINCT FROM ROW(OLD.provider,OLD.platform_id,OLD.external_id,OLD.upstream_state,OLD.formal_primary,OLD.formal_canonical_id IS NULL)
  THEN PERFORM public.refresh_external_market_quote(NEW.id); END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION public.sync_external_market_quote_override() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE was_hidden boolean := false; now_hidden boolean := false;
BEGIN
  IF TG_OP<>'INSERT' THEN was_hidden:=coalesce(OLD.data->'hidden'='true'::jsonb,false); END IF;
  IF TG_OP<>'DELETE' THEN now_hidden:=coalesce(NEW.data->'hidden'='true'::jsonb,false); END IF;
  IF TG_OP='UPDATE' AND OLD.listing_id IS DISTINCT FROM NEW.listing_id THEN
    IF was_hidden THEN PERFORM public.refresh_external_market_quote(OLD.listing_id); END IF;
    IF now_hidden THEN PERFORM public.refresh_external_market_quote(NEW.listing_id); END IF;
  ELSIF was_hidden IS DISTINCT FROM now_hidden THEN
    PERFORM public.refresh_external_market_quote(CASE WHEN TG_OP='DELETE' THEN OLD.listing_id ELSE NEW.listing_id END);
  END IF;
  RETURN NULL;
END
$$;

-- 0054 already guards the other catalogue/filter/listing inputs. Hold the
-- same writer slot before row locks. Check isolation on the country and
-- seed-order inputs too, even when they leave the existing filters unchanged.
CREATE FUNCTION public.lock_external_market_quote_inputs() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'Market certification writes require read committed' USING ERRCODE='0A000';
  END IF;
  IF pg_trigger_depth()=1 THEN PERFORM pg_advisory_xact_lock(78291332); END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER external_market_quote_listing_guard
  BEFORE UPDATE OF provider,platform_id,external_id,formal_primary,formal_canonical_id ON public.external_listings
  FOR EACH STATEMENT EXECUTE FUNCTION public.lock_external_market_quote_inputs();
CREATE TRIGGER external_market_quote_catalog_guard
  BEFORE UPDATE OF price_cny,facts ON public.external_catalog
  FOR EACH STATEMENT EXECUTE FUNCTION public.lock_external_market_quote_inputs();
CREATE TRIGGER external_market_quote_filter_guard
  BEFORE UPDATE OF price_cny,mileage_km,published_at OR DELETE ON public.external_catalog_filter
  FOR EACH STATEMENT EXECUTE FUNCTION public.lock_external_market_quote_inputs();
CREATE TRIGGER external_market_quote_override_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.external_listing_overrides
  FOR EACH STATEMENT EXECUTE FUNCTION public.lock_external_market_quote_inputs();

-- A catalogue publication is bound to its source listing. A physical rekey
-- bypasses the original filter's UPDATE join and could certify the old identity.
CREATE FUNCTION public.reject_external_market_catalog_rekey() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'External catalogue listing identity is immutable' USING ERRCODE='55000';
END
$$;
CREATE TRIGGER external_market_quote_catalog_identity_guard
  BEFORE UPDATE OF listing_id ON public.external_catalog
  FOR EACH ROW WHEN (OLD.listing_id IS DISTINCT FROM NEW.listing_id)
  EXECUTE FUNCTION public.reject_external_market_catalog_rekey();

CREATE TRIGGER zz_market_quote_filter AFTER INSERT OR UPDATE OR DELETE ON public.external_catalog_filter
  FOR EACH ROW EXECUTE FUNCTION public.sync_external_market_quote_filter();

CREATE TRIGGER zz_market_quote_catalog_insert AFTER INSERT ON public.external_catalog
  REFERENCING NEW TABLE AS market_catalog_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_external_market_quote_catalog();
CREATE TRIGGER zz_market_quote_catalog_update AFTER UPDATE ON public.external_catalog
  REFERENCING NEW TABLE AS market_catalog_new OLD TABLE AS market_catalog_old
  FOR EACH STATEMENT EXECUTE FUNCTION public.sync_external_market_quote_catalog();
CREATE TRIGGER zz_market_quote_catalog_delete AFTER DELETE ON public.external_catalog
  REFERENCING OLD TABLE AS market_catalog_old FOR EACH STATEMENT EXECUTE FUNCTION public.sync_external_market_quote_catalog();

CREATE TRIGGER zz_market_quote_listing AFTER UPDATE OF provider,platform_id,external_id,upstream_state,formal_primary,formal_canonical_id
  ON public.external_listings FOR EACH ROW EXECUTE FUNCTION public.sync_external_market_quote_listing();

CREATE TRIGGER zz_market_quote_override AFTER INSERT OR UPDATE OR DELETE ON public.external_listing_overrides
  FOR EACH ROW EXECUTE FUNCTION public.sync_external_market_quote_override();
--> statement-breakpoint
CREATE FUNCTION public.invalidate_external_market_quotes() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'Market certification writes require read committed' USING ERRCODE='0A000';
  END IF;
  -- TRUNCATE already holds the relation lock. Refuse rather than wait for a
  -- writer or backfill holding the advisory lock in the opposite order.
  IF NOT pg_try_advisory_xact_lock(78291332) THEN
    RAISE EXCEPTION 'Market quote invalidation requires the catalogue writer slot' USING ERRCODE='55P03';
  END IF;
  UPDATE public.external_market_quote_models SET phase='disabled',updated_at=now() WHERE phase<>'disabled';
  RETURN NULL;
END
$$;

CREATE TRIGGER zz_market_quote_filter_truncate BEFORE TRUNCATE ON public.external_catalog_filter
  FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_external_market_quotes();
CREATE TRIGGER zz_market_quote_catalog_truncate BEFORE TRUNCATE ON public.external_catalog
  FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_external_market_quotes();
CREATE TRIGGER zz_market_quote_listing_truncate BEFORE TRUNCATE ON public.external_listings
  FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_external_market_quotes();
CREATE TRIGGER zz_market_quote_override_truncate BEFORE TRUNCATE ON public.external_listing_overrides
  FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_external_market_quotes();
CREATE TRIGGER zz_market_quote_rows_truncate BEFORE TRUNCATE ON public.external_market_quote_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_external_market_quotes();
CREATE TRIGGER zz_market_quote_pending_truncate BEFORE TRUNCATE ON public.external_market_quote_pending
  FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_external_market_quotes();
--> statement-breakpoint
CREATE FUNCTION public.read_external_market_quote_rows(
  maker text, model text, target_generation uuid, language text,
  selected_trim text, year_min integer, year_max integer, mileage_min integer, mileage_max integer, fuel text,
  listing_ids uuid[] DEFAULT NULL
) RETURNS TABLE (listing_id uuid, price_cny numeric, trim_id text, powertrain text, model_year integer, mileage_km integer)
LANGUAGE sql STABLE AS $$
  WITH scoped AS MATERIALIZED (
    SELECT q.* FROM public.external_market_quote_rows q
    WHERE q.make_id=maker AND q.model_id=model AND q.generation=target_generation
      AND (q.locale_mask & CASE language WHEN 'zh' THEN 1 WHEN 'en' THEN 2 WHEN 'ru' THEN 4 ELSE 0 END)<>0
      AND (selected_trim IS NULL OR q.trim_id=selected_trim) AND (fuel IS NULL OR q.powertrain=fuel)
      AND (year_min IS NULL OR q.model_year>=year_min) AND (year_max IS NULL OR q.model_year<=year_max)
      AND (mileage_min IS NULL OR q.mileage_km>=mileage_min) AND (mileage_max IS NULL OR q.mileage_km<=mileage_max)
      AND (listing_ids IS NULL OR q.listing_id=ANY(listing_ids))
  ), legacy AS MATERIALIZED (
    SELECT * FROM scoped WHERE NOT verified_formal
  )
  SELECT q.listing_id,q.price_cny,q.trim_id,q.powertrain,q.model_year,q.mileage_km
  FROM scoped q WHERE q.verified_formal
  UNION ALL
  SELECT q.listing_id,q.price_cny,q.trim_id,q.powertrain,q.model_year,q.mileage_km
  FROM legacy q CROSS JOIN LATERAL (
    SELECT 1 FROM public.external_listings l JOIN public.external_catalog c ON c.listing_id=l.id
    WHERE l.id=q.listing_id AND l.upstream_state='active'
      AND (l.formal_canonical_id IS NULL OR l.formal_primary)
      AND l.provider IN ('chinacarapi','chinacarapi-sample')
      AND l.platform_id IN ('che168','dongchedi') AND l.external_id ~ '^[0-9]{1,100}$'
      AND coalesce(c.facts#>>'{location,country}','CN')='CN' AND c.price_cny=q.price_cny
      AND NOT EXISTS (SELECT FROM public.external_listing_overrides o
        WHERE o.listing_id=l.id AND o.data->'hidden'='true'::jsonb)
      AND (l.provider='chinacarapi' OR NOT EXISTS (SELECT FROM public.external_listings successor
        WHERE successor.provider='chinacarapi' AND successor.platform_id=l.platform_id AND successor.external_id=l.external_id))
      AND (l.formal_canonical_id IS NOT NULL OR EXISTS (SELECT FROM public.external_catalog_search s
        WHERE s.listing_id=l.id AND s.locale=language))
    LIMIT 1
  ) eligible
$$;
