-- Match powertrain and model-year filters without requiring an advertised price.
SET LOCAL search_path = pg_catalog, public;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
DO $$
DECLARE
 index_oid oid := to_regclass('public.external_catalog_filter_power_year_facets_idx');
 expected_definition constant text := 'CREATE INDEX external_catalog_filter_power_year_facets_idx ON public.external_catalog_filter USING btree (powertrain, locale_mask, model_year) INCLUDE (make_id, model_id, trim_id, generation_id, drivetrain, label_order) WHERE (active AND (locale_mask <> 0) AND (powertrain IS NOT NULL))';
BEGIN
 IF index_oid IS NULL THEN
  IF EXISTS (SELECT 1 FROM public.external_catalog_filter OFFSET 10000 LIMIT 1) THEN
   RAISE EXCEPTION 'Prebuild external_catalog_filter_power_year_facets_idx concurrently before migration 0045';
  END IF;
  CREATE INDEX external_catalog_filter_power_year_facets_idx ON public.external_catalog_filter
   (powertrain, locale_mask, model_year)
   INCLUDE (make_id, model_id, trim_id, generation_id, drivetrain, label_order)
   WHERE active AND locale_mask<>0 AND powertrain IS NOT NULL;
  index_oid := 'public.external_catalog_filter_power_year_facets_idx'::regclass;
 END IF;

 IF NOT EXISTS (
  SELECT 1 FROM pg_index i
  WHERE i.indexrelid=index_oid AND i.indrelid='public.external_catalog_filter'::regclass
    AND i.indisvalid AND i.indisready AND i.indislive AND pg_get_indexdef(i.indexrelid)=expected_definition
 ) THEN
  RAISE EXCEPTION 'Power and year facet index definition or state does not match migration 0045';
 END IF;
END $$;
