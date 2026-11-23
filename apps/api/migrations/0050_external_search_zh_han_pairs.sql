-- The first block can also run by itself before an online GIN index build.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
DO $migration$
DECLARE
 previous_path text := pg_catalog.current_setting('search_path');
 function_oid oid;
 definition constant text := $function$
 SELECT coalesce(array_agg(DISTINCT substr(run, char_index, 2)), ARRAY[]::text[])
 FROM regexp_split_to_table(document COLLATE pg_catalog."C", '[^㐀-䶿一-鿿]+') AS runs(run)
 CROSS JOIN LATERAL generate_series(1, char_length(run)-1) AS positions(char_index)
 $function$;
BEGIN
 PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
 function_oid := to_regprocedure('public.external_catalog_han_pairs(text)');
 IF function_oid IS NULL THEN
  EXECUTE format('CREATE FUNCTION public.external_catalog_han_pairs(document text) RETURNS text[] LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog AS %L', definition);
 ELSE
  -- A function used by an existing expression index cannot be replaced in place.
  IF NOT EXISTS (
   SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=function_oid AND l.lanname='sql' AND p.prosrc=definition
     AND p.prorettype='text[]'::regtype AND p.proargnames=ARRAY['document']::text[]
     AND p.provolatile='i' AND p.proisstrict AND p.proparallel='s'
     AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
  ) THEN RAISE EXCEPTION 'Han pair function does not match migration 0050'; END IF;
 END IF;
 PERFORM pg_catalog.set_config('search_path',previous_path,true);
END
$migration$;
--> statement-breakpoint
DO $migration$
DECLARE
 previous_path text := pg_catalog.current_setting('search_path');
 index_oid oid;
 expected_definition constant text := 'CREATE INDEX external_catalog_search_zh_han_pairs_idx ON public.external_catalog_search USING gin (public.external_catalog_han_pairs(search_document)) WHERE (locale = ''zh''::text)';
BEGIN
 PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
 index_oid := to_regclass('public.external_catalog_search_zh_han_pairs_idx');
 IF index_oid IS NULL THEN
  IF current_setting('hd.require_prebuilt_search_zh_han_pairs_index',true)='on'
    OR EXISTS (SELECT 1 FROM public.external_catalog_search WHERE locale='zh' OFFSET 10000 LIMIT 1) THEN
   RAISE EXCEPTION 'Chinese Han pair search index must be prebuilt concurrently before migration 0050';
  END IF;
  CREATE INDEX external_catalog_search_zh_han_pairs_idx ON public.external_catalog_search
    USING gin (public.external_catalog_han_pairs(search_document)) WHERE locale='zh';
  index_oid := 'public.external_catalog_search_zh_han_pairs_idx'::regclass;
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_index i WHERE i.indexrelid=index_oid AND i.indrelid='public.external_catalog_search'::regclass
    AND i.indisvalid AND i.indisready AND i.indislive AND pg_get_indexdef(i.indexrelid)=expected_definition
 ) THEN RAISE EXCEPTION 'Chinese Han pair index definition or state does not match migration 0050'; END IF;
 PERFORM pg_catalog.set_config('search_path',previous_path,true);
END
$migration$;
