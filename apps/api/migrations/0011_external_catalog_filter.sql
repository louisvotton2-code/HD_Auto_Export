-- Keep exact public scans off the large localized/details and source documents.
-- Drizzle runs this backfill and index build in a transaction.
SET LOCAL statement_timeout = '10min';
--> statement-breakpoint
LOCK TABLE external_listings, external_catalog IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE external_catalog_filter (
 listing_id uuid PRIMARY KEY REFERENCES external_listings(id) ON DELETE CASCADE,
 active boolean NOT NULL,
 locale_mask smallint NOT NULL DEFAULT 0 CHECK (locale_mask BETWEEN 0 AND 7),
 published_at timestamptz,
 label_order text GENERATED ALWAYS AS (
  lpad((253402300799999999-floor(extract(epoch FROM (published_at AT TIME ZONE 'UTC'))*1000000))::text,18,'0')||listing_id::text
 ) STORED,
 make_id text,
 model_id text,
 trim_id text,
 generation_id text,
 powertrain text,
 drivetrain text,
 model_year integer,
 mileage_km integer,
 price_cny numeric(16,2),
 CHECK (locale_mask=0 OR published_at IS NOT NULL)
);

CREATE FUNCTION external_catalog_locale_mask(localized jsonb) RETURNS smallint
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT ((CASE WHEN localized ? 'zh' THEN 1 ELSE 0 END) +
         (CASE WHEN localized ? 'en' THEN 2 ELSE 0 END) +
         (CASE WHEN localized ? 'ru' THEN 4 ELSE 0 END))::smallint
$$;
--> statement-breakpoint
-- Keep one row even before publication or after hiding. Source and catalogue
-- writes own different columns of this same MVCC row, including at RR isolation.
CREATE FUNCTION sync_external_catalog_filter_source() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE visible_changed boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.external_catalog_filter AS current_filter(listing_id,active)
  SELECT n.id,n.upstream_state='active' FROM source_rows n
  ON CONFLICT(listing_id) DO UPDATE SET active=excluded.active
  WHERE current_filter.active IS DISTINCT FROM excluded.active;
 ELSE
  -- A source metadata change must serialize with publication even when
  -- active stays the same. The updated tuple carries both writers' state.
  WITH changed AS (
   UPDATE public.external_catalog_filter f SET active=(n.upstream_state='active')
   FROM source_rows n JOIN prior_source_rows o USING(id)
   WHERE f.listing_id=n.id AND (o.upstream_state='active' OR n.upstream_state='active')
     AND ROW(o.platform_id,o.upstream_state,o.fetched_at,o.source_updated_at)
      IS DISTINCT FROM ROW(n.platform_id,n.upstream_state,n.fetched_at,n.source_updated_at)
   RETURNING f.locale_mask
  )
  SELECT EXISTS (SELECT FROM changed WHERE locale_mask<>0) INTO visible_changed;
  IF visible_changed THEN PERFORM public.queue_public_catalog_change(); END IF;
 END IF;
 RETURN NULL;
END $$;

CREATE TRIGGER external_listings_filter_insert AFTER INSERT ON external_listings
 REFERENCING NEW TABLE AS source_rows FOR EACH STATEMENT EXECUTE FUNCTION sync_external_catalog_filter_source();
CREATE TRIGGER external_listings_filter_update AFTER UPDATE ON external_listings
 REFERENCING OLD TABLE AS prior_source_rows NEW TABLE AS source_rows
 FOR EACH STATEMENT EXECUTE FUNCTION sync_external_catalog_filter_source();

CREATE FUNCTION sync_external_catalog_filter() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  UPDATE public.external_catalog_filter f SET
   locale_mask=0,published_at=NULL,make_id=NULL,model_id=NULL,trim_id=NULL,generation_id=NULL,
   powertrain=NULL,drivetrain=NULL,model_year=NULL,mileage_km=NULL,price_cny=NULL
  FROM prior_catalog_rows o WHERE f.listing_id=o.listing_id;
 ELSE
  IF TG_OP='UPDATE' THEN
   -- Body/label changes must serialize with source visibility even when the
   -- filter's scalars are identical. A row lock avoids rewriting that tuple.
   PERFORM f.listing_id FROM catalog_rows n JOIN prior_catalog_rows o USING(listing_id)
   JOIN public.external_catalog_filter f USING(listing_id)
   WHERE ROW(n.published_at,n.platform_name,n.listing_url,n.facts,n.price_cny,n.issues,n.localized,n.details)
      IS DISTINCT FROM ROW(o.published_at,o.platform_name,o.listing_url,o.facts,o.price_cny,o.issues,o.localized,o.details)
   ORDER BY f.listing_id FOR NO KEY UPDATE OF f;
  END IF;
  WITH projected AS (
   SELECT n.*,public.external_catalog_locale_mask(n.localized) AS locale_mask FROM catalog_rows n
  )
  UPDATE public.external_catalog_filter f SET
   locale_mask=n.locale_mask,published_at=n.published_at,make_id=n.make_id,model_id=n.model_id,trim_id=n.trim_id,
   generation_id=n.generation_id,powertrain=n.powertrain,drivetrain=n.drivetrain,
   model_year=n.model_year,mileage_km=n.mileage_km,price_cny=n.price_cny
  FROM projected n WHERE f.listing_id=n.listing_id
   AND ROW(f.locale_mask,f.published_at,f.make_id,f.model_id,f.trim_id,f.generation_id,
           f.powertrain,f.drivetrain,f.model_year,f.mileage_km,f.price_cny)
       IS DISTINCT FROM
       ROW(n.locale_mask,n.published_at,n.make_id,n.model_id,n.trim_id,n.generation_id,
           n.powertrain,n.drivetrain,n.model_year,n.mileage_km,n.price_cny);
 END IF;
 RETURN NULL;
END $$;

CREATE TRIGGER external_catalog_filter_insert AFTER INSERT ON external_catalog
 REFERENCING NEW TABLE AS catalog_rows FOR EACH STATEMENT EXECUTE FUNCTION sync_external_catalog_filter();
CREATE TRIGGER external_catalog_filter_update AFTER UPDATE ON external_catalog
 REFERENCING OLD TABLE AS prior_catalog_rows NEW TABLE AS catalog_rows
 FOR EACH STATEMENT EXECUTE FUNCTION sync_external_catalog_filter();
CREATE TRIGGER external_catalog_filter_delete AFTER DELETE ON external_catalog
 REFERENCING OLD TABLE AS prior_catalog_rows FOR EACH STATEMENT EXECUTE FUNCTION sync_external_catalog_filter();
--> statement-breakpoint
INSERT INTO external_catalog_filter
 (listing_id,active,locale_mask,published_at,make_id,model_id,trim_id,generation_id,powertrain,drivetrain,model_year,mileage_km,price_cny)
SELECT l.id,l.upstream_state='active',coalesce(external_catalog_locale_mask(c.localized),0),c.published_at,
       c.make_id,c.model_id,c.trim_id,c.generation_id,c.powertrain,c.drivetrain,c.model_year,c.mileage_km,c.price_cny
FROM external_listings l LEFT JOIN external_catalog c ON c.listing_id=l.id;

CREATE INDEX external_catalog_filter_make_price_idx ON external_catalog_filter(make_id,price_cny)
 INCLUDE (locale_mask) WHERE active AND locale_mask<>0;
CREATE INDEX external_catalog_filter_make_price_facets_idx ON external_catalog_filter(make_id,price_cny)
 INCLUDE (locale_mask,label_order,model_id,trim_id,generation_id,powertrain,drivetrain,model_year,mileage_km)
 WHERE active AND locale_mask<>0;
CREATE INDEX external_catalog_filter_make_order_idx ON external_catalog_filter(make_id,published_at DESC,listing_id)
 INCLUDE (locale_mask) WHERE active AND locale_mask<>0;
CREATE INDEX external_catalog_filter_order_idx ON external_catalog_filter(published_at DESC,listing_id)
 INCLUDE (locale_mask) WHERE active AND locale_mask<>0;
CREATE INDEX external_catalog_filter_price_idx ON external_catalog_filter(price_cny)
 INCLUDE (listing_id,locale_mask) WHERE active AND locale_mask<>0 AND price_cny IS NOT NULL;

ANALYZE external_catalog_filter;
