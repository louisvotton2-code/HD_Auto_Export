-- Scope: unfiltered overview / overview-models. The original filter table
-- remains authoritative for selected dimensions and for current label winners.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '8s';
SET LOCAL search_path = pg_catalog, public;
--> statement-breakpoint
DO $verify$
DECLARE
 lookup_index oid := to_regclass('public.external_catalog_filter_model_winner_idx');
 previous_path text := current_setting('search_path');
 expected constant text := 'CREATE INDEX external_catalog_filter_model_winner_idx ON public.external_catalog_filter USING btree (make_id, model_id, locale_mask, published_at DESC, listing_id) WHERE (active AND (locale_mask <> 0) AND (make_id IS NOT NULL) AND (model_id IS NOT NULL))';
BEGIN
 PERFORM set_config('search_path','pg_catalog',true);
 IF lookup_index IS NULL THEN
  IF current_setting('hd.require_prebuilt_global_facet_index',true)='on'
    OR EXISTS (SELECT 1 FROM public.external_catalog_filter OFFSET 10000 LIMIT 1) THEN
   RAISE EXCEPTION 'Global facet model winner index must be prebuilt concurrently before migration 0051';
  END IF;
  CREATE INDEX external_catalog_filter_model_winner_idx ON public.external_catalog_filter
    (make_id, model_id, locale_mask, published_at DESC, listing_id)
    WHERE active AND locale_mask<>0 AND make_id IS NOT NULL AND model_id IS NOT NULL;
  lookup_index := 'public.external_catalog_filter_model_winner_idx'::regclass;
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_index WHERE indexrelid=lookup_index AND indrelid='public.external_catalog_filter'::regclass
   AND indisvalid AND indisready AND indislive AND pg_get_indexdef(indexrelid)=expected
 ) THEN RAISE EXCEPTION 'Global facet model winner index does not match migration 0051'; END IF;
 PERFORM set_config('search_path',previous_path,true);
END
$verify$;
--> statement-breakpoint
-- Array elements retain SQL nulls; array equality considers equal null
-- elements equal, so the primary key supports nullable facet dimensions.
CREATE TABLE public.external_catalog_global_facets (
 locale_mask smallint NOT NULL CHECK (locale_mask BETWEEN 1 AND 7),
 dimensions text[] NOT NULL CHECK (cardinality(dimensions)=5),
 has_trim boolean NOT NULL,
 has_generation boolean NOT NULL,
 row_count integer NOT NULL CHECK (row_count>=0),
 PRIMARY KEY (locale_mask,dimensions,has_trim,has_generation)
);

CREATE FUNCTION public.sync_external_catalog_global_facets() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
 bucket record;
 remaining integer;
 projection constant text := $projection$
  SELECT f.locale_mask,ARRAY[f.make_id,f.model_id,f.powertrain,f.drivetrain,f.model_year::text] AS dimensions,
    f.make_id IS NOT NULL AND f.model_id IS NOT NULL AND f.trim_id IS NOT NULL AS has_trim,
    f.make_id IS NOT NULL AND f.model_id IS NOT NULL AND f.generation_id IS NOT NULL AS has_generation
  FROM %s AS f WHERE f.active AND f.locale_mask<>0
 $projection$;
 empty_source constant text := '(SELECT * FROM public.external_catalog_filter WHERE false)';
BEGIN
 IF TG_OP='TRUNCATE' THEN
  DELETE FROM public.external_catalog_global_facets;
  RETURN NULL;
 END IF;

 FOR bucket IN EXECUTE format($buckets$
  WITH changes AS (
    SELECT prior.*, -1 AS delta FROM (%s) prior
    UNION ALL
    SELECT incoming.*, 1 AS delta FROM (%s) incoming
  )
  SELECT locale_mask,dimensions,has_trim,has_generation,sum(delta)::integer AS delta
  FROM changes GROUP BY locale_mask,dimensions,has_trim,has_generation HAVING sum(delta)<>0
  ORDER BY locale_mask,dimensions,has_trim,has_generation
 $buckets$,
 format(projection,CASE WHEN TG_OP='INSERT' THEN empty_source ELSE 'old_rows' END),
 format(projection,CASE WHEN TG_OP='DELETE' THEN empty_source ELSE 'new_rows' END))
 LOOP
  IF bucket.delta>0 THEN
   INSERT INTO public.external_catalog_global_facets AS g (locale_mask,dimensions,has_trim,has_generation,row_count)
   VALUES (bucket.locale_mask,bucket.dimensions,bucket.has_trim,bucket.has_generation,bucket.delta)
   ON CONFLICT (locale_mask,dimensions,has_trim,has_generation) DO UPDATE SET row_count=g.row_count+excluded.row_count;
  ELSE
   UPDATE public.external_catalog_global_facets g SET row_count=g.row_count+bucket.delta
   WHERE g.locale_mask=bucket.locale_mask AND g.dimensions=bucket.dimensions
     AND g.has_trim=bucket.has_trim AND g.has_generation=bucket.has_generation
   RETURNING g.row_count INTO remaining;
   IF NOT FOUND THEN RAISE EXCEPTION 'Global facet group is missing'; END IF;
   IF remaining=0 THEN
    DELETE FROM public.external_catalog_global_facets g
    WHERE g.locale_mask=bucket.locale_mask AND g.dimensions=bucket.dimensions
      AND g.has_trim=bucket.has_trim AND g.has_generation=bucket.has_generation;
   END IF;
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Global facet migration requires read committed';
 END IF;
END $$;
SELECT pg_advisory_xact_lock(78291332);
LOCK TABLE public.external_catalog_filter IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO public.external_catalog_global_facets (locale_mask,dimensions,has_trim,has_generation,row_count)
SELECT f.locale_mask,ARRAY[f.make_id,f.model_id,f.powertrain,f.drivetrain,f.model_year::text],
 f.make_id IS NOT NULL AND f.model_id IS NOT NULL AND f.trim_id IS NOT NULL,
 f.make_id IS NOT NULL AND f.model_id IS NOT NULL AND f.generation_id IS NOT NULL,
 count(*)::integer
FROM public.external_catalog_filter f WHERE f.active AND f.locale_mask<>0 GROUP BY 1,2,3,4;
--> statement-breakpoint
CREATE TRIGGER external_catalog_global_facets_insert AFTER INSERT ON public.external_catalog_filter
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.sync_external_catalog_global_facets();
CREATE TRIGGER external_catalog_global_facets_update AFTER UPDATE ON public.external_catalog_filter
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
 EXECUTE FUNCTION public.sync_external_catalog_global_facets();
CREATE TRIGGER external_catalog_global_facets_delete AFTER DELETE ON public.external_catalog_filter
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.sync_external_catalog_global_facets();
CREATE TRIGGER external_catalog_global_facets_truncate AFTER TRUNCATE ON public.external_catalog_filter
 FOR EACH STATEMENT EXECUTE FUNCTION public.sync_external_catalog_global_facets();
