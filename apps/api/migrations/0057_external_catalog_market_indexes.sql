-- Large databases must prebuild these two covering indexes, serially and
-- concurrently. The explicit release mode verifies them without scanning data.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';
--> statement-breakpoint
DO $market$
DECLARE
  previous_path text := current_setting('search_path');
  domestic_index oid;
  formal_index oid;
  expected_domestic constant text := $definition$CREATE INDEX external_catalog_market_domestic_idx ON public.external_catalog USING btree (listing_id) INCLUDE (price_cny) WHERE (COALESCE((facts #>> '{location,country}'::text[]), 'CN'::text) = 'CN'::text)$definition$;
  expected_formal constant text := $definition$CREATE INDEX external_listings_market_formal_idx ON public.external_listings USING btree (id) WHERE ((provider = 'chinacarapi'::text) AND (platform_id = ANY (ARRAY['che168'::text, 'dongchedi'::text])) AND (external_id ~ '^[0-9]{1,100}$'::text) AND (upstream_state = 'active'::text) AND (formal_canonical_id IS NOT NULL) AND formal_primary)$definition$;
  require_prebuilt boolean := current_setting('hd.require_prebuilt_market_indexes',true)='on';
BEGIN
  PERFORM set_config('search_path','pg_catalog',true);
  domestic_index := to_regclass('public.external_catalog_market_domestic_idx');
  formal_index := to_regclass('public.external_listings_market_formal_idx');
  IF domestic_index IS NULL AND (require_prebuilt OR EXISTS (SELECT FROM public.external_catalog OFFSET 10000 LIMIT 1))
     OR formal_index IS NULL AND (require_prebuilt OR EXISTS (SELECT FROM public.external_listings OFFSET 10000 LIMIT 1)) THEN
    RAISE EXCEPTION 'Market quote indexes must be prebuilt concurrently before migration 0057';
  END IF;
  IF domestic_index IS NULL THEN
    CREATE INDEX external_catalog_market_domestic_idx ON public.external_catalog (listing_id) INCLUDE (price_cny)
      WHERE coalesce(facts#>>'{location,country}','CN')='CN';
    domestic_index := 'public.external_catalog_market_domestic_idx'::regclass;
  END IF;
  IF formal_index IS NULL THEN
    CREATE INDEX external_listings_market_formal_idx ON public.external_listings (id)
      WHERE provider='chinacarapi' AND platform_id IN ('che168','dongchedi')
        AND external_id ~ '^[0-9]{1,100}$' AND upstream_state='active' AND formal_canonical_id IS NOT NULL AND formal_primary;
    formal_index := 'public.external_listings_market_formal_idx'::regclass;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_index WHERE indexrelid=domestic_index AND indrelid='public.external_catalog'::regclass
      AND indisvalid AND indisready AND indislive AND pg_get_indexdef(indexrelid)=expected_domestic)
     OR NOT EXISTS (SELECT FROM pg_index WHERE indexrelid=formal_index AND indrelid='public.external_listings'::regclass
      AND indisvalid AND indisready AND indislive AND pg_get_indexdef(indexrelid)=expected_formal) THEN
    RAISE EXCEPTION 'Market quote index definitions do not match migration 0057';
  END IF;
  PERFORM set_config('search_path',previous_path,true);
END
$market$;
