-- A concurrent prebuild can be adopted without taking the table's build lock.
-- Fresh databases can build the same index in this transaction.
SET LOCAL search_path = pg_catalog, public;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
--> statement-breakpoint
DO $$
DECLARE
 index_oid oid := to_regclass('public.external_catalog_search_zh_trgm_idx');
 expected_definition constant text := 'CREATE INDEX external_catalog_search_zh_trgm_idx ON public.external_catalog_search USING gin (search_document gin_trgm_ops) WHERE (locale = ''zh''::text)';
BEGIN
 IF index_oid IS NULL THEN
  IF current_setting('hd.require_prebuilt_search_zh_index',true)='on' THEN
   RAISE EXCEPTION 'Chinese search index must be prebuilt concurrently before migration 0037';
  END IF;
  CREATE INDEX external_catalog_search_zh_trgm_idx
   ON public.external_catalog_search USING gin(search_document gin_trgm_ops) WHERE locale='zh';
  index_oid := 'public.external_catalog_search_zh_trgm_idx'::regclass;
 END IF;

 IF NOT EXISTS (
  SELECT 1 FROM pg_index i
  WHERE i.indexrelid=index_oid AND i.indrelid='public.external_catalog_search'::regclass
    AND i.indisvalid AND i.indisready AND i.indislive
    AND pg_get_indexdef(i.indexrelid)=expected_definition
 ) THEN
  RAISE EXCEPTION 'Chinese search index definition or state does not match migration 0037';
 END IF;
END $$;
