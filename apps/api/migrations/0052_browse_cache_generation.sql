-- Anonymous browse data retains its original deadline during ordinary catalog
-- updates. Only explicit staff hides invalidate that cache generation.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';
--> statement-breakpoint
ALTER TABLE public.public_catalog_pending ADD COLUMN affects_browse boolean NOT NULL DEFAULT false;
ALTER TABLE public.public_catalog_state ADD COLUMN browse_generation bigint NOT NULL DEFAULT 1 CHECK (browse_generation > 0);
--> statement-breakpoint
CREATE FUNCTION public.queue_public_browse_invalidation() RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE pending_id text := pg_current_xact_id()::text;
BEGIN
 IF current_setting('hd.public_browse_pending',true)=pending_id THEN RETURN; END IF;
 -- Upgrade a metadata-only or ordinary change already queued in this transaction.
 -- State stays unlocked until the existing deferred commit trigger runs.
 INSERT INTO public.public_catalog_pending(transaction_id,affects_filters,affects_browse)
 VALUES (pending_id::xid8,true,true)
 ON CONFLICT (transaction_id) DO UPDATE SET affects_filters=true,affects_browse=true;
 PERFORM set_config('hd.public_browse_pending',pending_id,true);
 PERFORM set_config('hd.public_catalog_pending',pending_id,true);
END $$;

CREATE OR REPLACE FUNCTION public.commit_public_catalog_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE filters_changed boolean; browse_hidden boolean;
BEGIN
 -- A later statement can upgrade the pending row after this INSERT queued NEW.
 DELETE FROM public.public_catalog_pending WHERE transaction_id=NEW.transaction_id
 RETURNING affects_filters,affects_browse INTO filters_changed,browse_hidden;
 IF FOUND THEN
  UPDATE public.public_catalog_state SET revision=revision+1,
   filter_revision=filter_revision+CASE WHEN filters_changed THEN 1 ELSE 0 END,
   browse_generation=browse_generation+CASE WHEN browse_hidden THEN 1 ELSE 0 END
  WHERE id=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public catalog state is missing'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.version_staff_browse_hide() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE changed boolean;
BEGIN
 IF TG_OP='DELETE' THEN
  SELECT EXISTS (
   SELECT FROM old_rows o WHERE o.publication_state='published'
    AND o.deleted_at IS NULL AND o.published_revision_id IS NOT NULL
  ) INTO changed;
 ELSE
  SELECT EXISTS (
   SELECT FROM old_rows o LEFT JOIN new_rows n USING (id)
   WHERE o.publication_state='published' AND o.deleted_at IS NULL AND o.published_revision_id IS NOT NULL
    AND (n.publication_state IS DISTINCT FROM 'published' OR n.deleted_at IS NOT NULL OR n.published_revision_id IS NULL)
  ) INTO changed;
 END IF;
 IF changed THEN PERFORM public.queue_public_browse_invalidation(); END IF;
 RETURN NULL;
END $$;

CREATE TRIGGER vehicles_browse_hide_update
 AFTER UPDATE ON public.vehicles REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
 FOR EACH STATEMENT EXECUTE FUNCTION public.version_staff_browse_hide();
CREATE TRIGGER vehicles_browse_hide_delete
 AFTER DELETE ON public.vehicles REFERENCING OLD TABLE AS old_rows
 FOR EACH STATEMENT EXECUTE FUNCTION public.version_staff_browse_hide();
--> statement-breakpoint
CREATE FUNCTION public.version_external_browse_hide() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP='INSERT' OR (OLD.data->'hidden') IS DISTINCT FROM 'true'::jsonb
  OR OLD.listing_id<>NEW.listing_id THEN
  PERFORM public.queue_public_browse_invalidation();
 END IF;
 RETURN NULL;
END $$;

CREATE TRIGGER external_listing_overrides_browse_hide
 AFTER INSERT OR UPDATE OF data,listing_id ON public.external_listing_overrides
 FOR EACH ROW WHEN ((NEW.data->'hidden')='true'::jsonb)
 EXECUTE FUNCTION public.version_external_browse_hide();
