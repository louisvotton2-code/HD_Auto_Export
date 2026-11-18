-- Take the locks in the same order as a writer running the deferred commit trigger.
ALTER TABLE public_catalog_pending ADD COLUMN affects_filters boolean NOT NULL DEFAULT true;
ALTER TABLE public_catalog_state ADD COLUMN filter_revision bigint NOT NULL DEFAULT 1 CHECK (filter_revision > 0);
UPDATE public_catalog_state SET filter_revision=revision WHERE id=1;
--> statement-breakpoint

-- The existing transaction marker means a full invalidation is already queued.
-- Metadata-only updates must leave that marker available to later business writes.
CREATE OR REPLACE FUNCTION queue_public_catalog_change() RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE pending_id text := pg_current_xact_id()::text;
BEGIN
 IF current_setting('hd.public_catalog_pending',true)=pending_id THEN RETURN; END IF;
 INSERT INTO public.public_catalog_pending(transaction_id,affects_filters) VALUES (pending_id::xid8,true)
 ON CONFLICT (transaction_id) DO UPDATE SET affects_filters=true WHERE NOT public_catalog_pending.affects_filters;
 PERFORM set_config('hd.public_catalog_pending',pending_id,true);
END $$;

CREATE FUNCTION queue_public_catalog_metadata_change() RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE pending_id text := pg_current_xact_id()::text;
BEGIN
 IF current_setting('hd.public_catalog_pending',true)=pending_id
    OR current_setting('hd.public_catalog_metadata_pending',true)=pending_id THEN RETURN; END IF;
 INSERT INTO public.public_catalog_pending(transaction_id,affects_filters) VALUES (pending_id::xid8,false)
 ON CONFLICT (transaction_id) DO NOTHING;
 PERFORM set_config('hd.public_catalog_metadata_pending',pending_id,true);
END $$;

CREATE OR REPLACE FUNCTION commit_public_catalog_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE filters_changed boolean;
BEGIN
 -- A later statement can upgrade the pending row after this INSERT queued NEW.
 DELETE FROM public.public_catalog_pending WHERE transaction_id=NEW.transaction_id
 RETURNING affects_filters INTO filters_changed;
 IF FOUND THEN
  UPDATE public.public_catalog_state SET revision=revision+1,
   filter_revision=filter_revision+CASE WHEN filters_changed THEN 1 ELSE 0 END WHERE id=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public catalog state is missing'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION version_public_external_metadata() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE visible_changed boolean; filters_changed boolean;
BEGIN
 IF current_setting('hd.public_catalog_pending',true)=pg_current_xact_id()::text THEN RETURN NULL; END IF;
 SELECT count(*)>0, coalesce(bool_or(ROW(o.id,o.platform_id,o.upstream_state)
   IS DISTINCT FROM ROW(n.id,n.platform_id,n.upstream_state)),false)
 INTO visible_changed,filters_changed
 FROM old_rows o FULL JOIN new_rows n USING (id)
 WHERE (o.upstream_state='active' OR n.upstream_state='active')
  AND EXISTS (SELECT FROM public.external_catalog c WHERE c.listing_id IN (o.id,n.id))
  AND ROW(o.id,o.platform_id,o.upstream_state,o.fetched_at,o.source_updated_at)
   IS DISTINCT FROM ROW(n.id,n.platform_id,n.upstream_state,n.fetched_at,n.source_updated_at);
 IF filters_changed THEN PERFORM public.queue_public_catalog_change();
 ELSIF visible_changed THEN PERFORM public.queue_public_catalog_metadata_change(); END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION sync_external_catalog_filter_source() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE visible_changed boolean; filters_changed boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.external_catalog_filter AS current_filter(listing_id,active)
  SELECT n.id,n.upstream_state='active' FROM source_rows n
  ON CONFLICT(listing_id) DO UPDATE SET active=excluded.active
  WHERE current_filter.active IS DISTINCT FROM excluded.active;
 ELSE
  -- Keep the tuple write even when active is unchanged. It serializes source
  -- metadata and visibility with a concurrent projection publication.
  WITH changed AS (
   UPDATE public.external_catalog_filter f SET active=(n.upstream_state='active')
   FROM source_rows n JOIN prior_source_rows o USING(id)
   WHERE f.listing_id=n.id AND (o.upstream_state='active' OR n.upstream_state='active')
     AND ROW(o.platform_id,o.upstream_state,o.fetched_at,o.source_updated_at)
      IS DISTINCT FROM ROW(n.platform_id,n.upstream_state,n.fetched_at,n.source_updated_at)
   RETURNING f.locale_mask, ROW(o.platform_id,o.upstream_state)
    IS DISTINCT FROM ROW(n.platform_id,n.upstream_state) AS changed_filter
  )
  SELECT count(*)>0,coalesce(bool_or(changed_filter),false) INTO visible_changed,filters_changed
  FROM changed WHERE locale_mask<>0;
  IF filters_changed THEN PERFORM public.queue_public_catalog_change();
  ELSIF visible_changed THEN PERFORM public.queue_public_catalog_metadata_change(); END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION version_public_external_media() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE visible_changed boolean; filters_changed boolean;
BEGIN
 IF current_setting('hd.public_catalog_pending',true)=pg_current_xact_id()::text THEN RETURN NULL; END IF;
 IF TG_OP='INSERT' THEN
  SELECT EXISTS (SELECT FROM new_rows n JOIN public.external_catalog c ON c.listing_id=n.listing_id
   JOIN public.external_listings l ON l.id=c.listing_id WHERE n.active AND l.upstream_state='active') INTO filters_changed;
 ELSIF TG_OP='DELETE' THEN
  SELECT EXISTS (SELECT FROM old_rows o JOIN public.external_catalog c ON c.listing_id=o.listing_id
   JOIN public.external_listings l ON l.id=c.listing_id WHERE o.active AND l.upstream_state='active') INTO filters_changed;
 ELSE
  -- A fresh observation of the same cover updates the image DTO timestamp,
  -- but cover eligibility and the matching filter options are unchanged.
  WITH old_visible AS (
   SELECT o.id, CASE WHEN o.expires_at<=statement_timestamp() THEN jsonb_build_array(o.listing_id,'expired')
    ELSE jsonb_build_array(o.id,o.listing_id,o.url,o.width,o.height,o.alt,o.position,o.revision,o.expires_at) END AS value,
    CASE WHEN o.expires_at<=statement_timestamp() THEN NULL ELSE o.refreshed_at END AS refreshed_at
   FROM old_rows o JOIN public.external_catalog c ON c.listing_id=o.listing_id
   JOIN public.external_listings l ON l.id=c.listing_id WHERE o.active AND l.upstream_state='active'
  ), new_visible AS (
   SELECT n.id, CASE WHEN n.expires_at<=statement_timestamp() THEN jsonb_build_array(n.listing_id,'expired')
    ELSE jsonb_build_array(n.id,n.listing_id,n.url,n.width,n.height,n.alt,n.position,n.revision,n.expires_at) END AS value,
    CASE WHEN n.expires_at<=statement_timestamp() THEN NULL ELSE n.refreshed_at END AS refreshed_at
   FROM new_rows n JOIN public.external_catalog c ON c.listing_id=n.listing_id
   JOIN public.external_listings l ON l.id=c.listing_id WHERE n.active AND l.upstream_state='active'
  ) SELECT count(*)>0,coalesce(bool_or(o.value IS DISTINCT FROM n.value),false)
   INTO visible_changed,filters_changed FROM old_visible o FULL JOIN new_visible n USING (id)
   WHERE ROW(o.value,o.refreshed_at) IS DISTINCT FROM ROW(n.value,n.refreshed_at);
 END IF;
 IF filters_changed THEN PERFORM public.queue_public_catalog_change();
 ELSIF visible_changed THEN PERFORM public.queue_public_catalog_metadata_change(); END IF;
 RETURN NULL;
END $$;
