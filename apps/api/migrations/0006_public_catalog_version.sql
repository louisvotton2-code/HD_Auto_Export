-- A fresh epoch also separates an initial installation from any former cache namespace.
-- Restoring a backup preserves its epoch: the restore procedure must rotate it explicitly.
CREATE TABLE public_catalog_state (
 id integer PRIMARY KEY CHECK (id = 1),
 epoch uuid NOT NULL DEFAULT gen_random_uuid(),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)
);
INSERT INTO public_catalog_state(id) VALUES (1);

-- One private row per changing transaction, removed by its deferred trigger at commit.
-- Do not lock the shared state row while a business transaction still needs home,
-- vehicle or external-source locks. No process-local cache participates in this protocol.
CREATE TABLE public_catalog_pending (
 transaction_id xid8 PRIMARY KEY
);

CREATE FUNCTION queue_public_catalog_change() RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE transaction_id text := pg_current_xact_id()::text;
BEGIN
 IF current_setting('hd.public_catalog_pending', true) = transaction_id THEN RETURN; END IF;
 INSERT INTO public.public_catalog_pending VALUES (transaction_id::xid8);
 PERFORM set_config('hd.public_catalog_pending', transaction_id, true);
END $$;

CREATE FUNCTION commit_public_catalog_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 DELETE FROM public.public_catalog_pending WHERE transaction_id = NEW.transaction_id;
 IF FOUND THEN
  UPDATE public.public_catalog_state SET revision = revision + 1 WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public catalog state is missing'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER public_catalog_commit
 AFTER INSERT ON public_catalog_pending DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION commit_public_catalog_change();
--> statement-breakpoint

-- Detail pages remain public for sold vehicles, so visibility here intentionally
-- includes all published, non-deleted vehicles with a selected immutable snapshot.
CREATE FUNCTION version_public_vehicles() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE changed boolean;
BEGIN
 IF current_setting('hd.public_catalog_pending', true) = pg_current_xact_id()::text THEN RETURN NULL; END IF;
 IF TG_OP = 'INSERT' THEN
  SELECT EXISTS (SELECT FROM new_rows n WHERE n.publication_state = 'published'
   AND n.deleted_at IS NULL AND n.published_revision_id IS NOT NULL) INTO changed;
 ELSIF TG_OP = 'DELETE' THEN
  SELECT EXISTS (SELECT FROM old_rows o WHERE o.publication_state = 'published'
   AND o.deleted_at IS NULL AND o.published_revision_id IS NOT NULL) INTO changed;
 ELSE
  SELECT EXISTS (SELECT FROM old_rows o FULL JOIN new_rows n USING (id)
   WHERE ((o.publication_state = 'published' AND o.deleted_at IS NULL AND o.published_revision_id IS NOT NULL)
       OR (n.publication_state = 'published' AND n.deleted_at IS NULL AND n.published_revision_id IS NOT NULL))
    AND ROW(o.id,o.stock_number,o.publication_state,o.published_revision_id,o.published_at,o.deleted_at,
            o.availability,o.availability_checked_at)
     IS DISTINCT FROM ROW(n.id,n.stock_number,n.publication_state,n.published_revision_id,n.published_at,n.deleted_at,
                          n.availability,n.availability_checked_at)) INTO changed;
 END IF;
 IF changed THEN PERFORM public.queue_public_catalog_change(); END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION version_public_home() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE changed boolean;
BEGIN
 IF current_setting('hd.public_catalog_pending', true) = pg_current_xact_id()::text THEN RETURN NULL; END IF;
 IF TG_OP = 'INSERT' THEN SELECT EXISTS (SELECT FROM new_rows) INTO changed;
 ELSIF TG_OP = 'DELETE' THEN SELECT EXISTS (SELECT FROM old_rows) INTO changed;
 ELSE SELECT EXISTS (SELECT FROM old_rows o FULL JOIN new_rows n USING (id)
  WHERE o.sections IS DISTINCT FROM n.sections) INTO changed;
 END IF;
 IF changed THEN PERFORM public.queue_public_catalog_change(); END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION version_public_external_catalog() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE changed boolean;
BEGIN
 IF current_setting('hd.public_catalog_pending', true) = pg_current_xact_id()::text THEN RETURN NULL; END IF;
 IF TG_OP = 'INSERT' THEN
  SELECT EXISTS (SELECT FROM new_rows n JOIN public.external_listings l ON l.id=n.listing_id
   WHERE l.upstream_state='active') INTO changed;
 ELSIF TG_OP = 'DELETE' THEN
  SELECT EXISTS (SELECT FROM old_rows o JOIN public.external_listings l ON l.id=o.listing_id
   WHERE l.upstream_state='active') INTO changed;
 ELSE
  SELECT EXISTS (SELECT FROM old_rows o FULL JOIN new_rows n USING (listing_id)
   JOIN public.external_listings l ON l.id=coalesce(n.listing_id,o.listing_id)
   WHERE l.upstream_state='active'
    AND ROW(o.published_at,o.platform_name,o.listing_url,o.facts,o.price_cny,o.issues,o.localized,o.details)
     IS DISTINCT FROM ROW(n.published_at,n.platform_name,n.listing_url,n.facts,n.price_cny,n.issues,n.localized,n.details)) INTO changed;
 END IF;
 IF changed THEN PERFORM public.queue_public_catalog_change(); END IF;
 RETURN NULL;
END $$;

-- Source versions, raw payloads and employee overrides are not themselves public.
-- Their public consequences are observed on external_catalog. Provenance times and
-- source visibility are additionally read directly from external_listings.
CREATE FUNCTION version_public_external_metadata() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF current_setting('hd.public_catalog_pending', true) = pg_current_xact_id()::text THEN RETURN NULL; END IF;
 IF EXISTS (SELECT FROM old_rows o FULL JOIN new_rows n USING (id)
   WHERE (o.upstream_state='active' OR n.upstream_state='active')
    AND EXISTS (SELECT FROM public.external_catalog c WHERE c.listing_id IN (o.id,n.id))
    AND ROW(o.id,o.platform_id,o.upstream_state,o.fetched_at,o.source_updated_at)
     IS DISTINCT FROM ROW(n.id,n.platform_id,n.upstream_state,n.fetched_at,n.source_updated_at)) THEN
  PERFORM public.queue_public_catalog_change();
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION version_public_external_media() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE changed boolean;
BEGIN
 IF current_setting('hd.public_catalog_pending', true) = pg_current_xact_id()::text THEN RETURN NULL; END IF;
 IF TG_OP = 'INSERT' THEN
  SELECT EXISTS (SELECT FROM new_rows n JOIN public.external_catalog c ON c.listing_id=n.listing_id
   JOIN public.external_listings l ON l.id=c.listing_id WHERE n.active AND l.upstream_state='active') INTO changed;
 ELSIF TG_OP = 'DELETE' THEN
  SELECT EXISTS (SELECT FROM old_rows o JOIN public.external_catalog c ON c.listing_id=o.listing_id
   JOIN public.external_listings l ON l.id=c.listing_id WHERE o.active AND l.upstream_state='active') INTO changed;
 ELSE
  -- Expired active rows still contribute the public `images: expired` issue. Their
  -- private URL/refresh changes do not matter until they become visible again.
  WITH old_visible AS (
   SELECT o.id, CASE WHEN o.expires_at <= statement_timestamp() THEN jsonb_build_array(o.listing_id,'expired')
    ELSE jsonb_build_array(o.id,o.listing_id,o.url,o.width,o.height,o.alt,o.position,o.revision,o.refreshed_at,o.expires_at) END AS value
   FROM old_rows o JOIN public.external_catalog c ON c.listing_id=o.listing_id
   JOIN public.external_listings l ON l.id=c.listing_id WHERE o.active AND l.upstream_state='active'
  ), new_visible AS (
   SELECT n.id, CASE WHEN n.expires_at <= statement_timestamp() THEN jsonb_build_array(n.listing_id,'expired')
    ELSE jsonb_build_array(n.id,n.listing_id,n.url,n.width,n.height,n.alt,n.position,n.revision,n.refreshed_at,n.expires_at) END AS value
   FROM new_rows n JOIN public.external_catalog c ON c.listing_id=n.listing_id
   JOIN public.external_listings l ON l.id=c.listing_id WHERE n.active AND l.upstream_state='active'
  ) SELECT EXISTS (SELECT FROM old_visible o FULL JOIN new_visible n USING (id)
    WHERE o.value IS DISTINCT FROM n.value) INTO changed;
 END IF;
 IF changed THEN PERFORM public.queue_public_catalog_change(); END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint

CREATE FUNCTION version_public_staff_media() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE changed boolean;
BEGIN
 IF current_setting('hd.public_catalog_pending', true) = pg_current_xact_id()::text THEN RETURN NULL; END IF;
 IF TG_OP = 'INSERT' THEN
  SELECT EXISTS (SELECT FROM new_rows n JOIN public.publication_media pm ON pm.media_id=n.id
   JOIN public.vehicles v ON v.published_revision_id=pm.publication_id
   WHERE n.state='ready' AND v.publication_state='published' AND v.deleted_at IS NULL) INTO changed;
 ELSIF TG_OP = 'DELETE' THEN
  SELECT EXISTS (SELECT FROM old_rows o JOIN public.publication_media pm ON pm.media_id=o.id
   JOIN public.vehicles v ON v.published_revision_id=pm.publication_id
   WHERE o.state='ready' AND v.publication_state='published' AND v.deleted_at IS NULL) INTO changed;
 ELSE
  SELECT EXISTS (SELECT FROM old_rows o FULL JOIN new_rows n USING (id)
   WHERE coalesce(o.state='ready',false) IS DISTINCT FROM coalesce(n.state='ready',false)
    AND EXISTS (SELECT FROM public.publication_media pm JOIN public.vehicles v ON v.published_revision_id=pm.publication_id
     WHERE pm.media_id IN (o.id,n.id) AND v.publication_state='published' AND v.deleted_at IS NULL)) INTO changed;
 END IF;
 IF changed THEN PERFORM public.queue_public_catalog_change(); END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION version_public_media_references() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE changed boolean;
BEGIN
 IF current_setting('hd.public_catalog_pending', true) = pg_current_xact_id()::text THEN RETURN NULL; END IF;
 IF TG_OP = 'INSERT' THEN
  SELECT EXISTS (SELECT FROM new_rows n JOIN public.media_assets m ON m.id=n.media_id
   JOIN public.vehicles v ON v.published_revision_id=n.publication_id
   WHERE m.state='ready' AND v.publication_state='published' AND v.deleted_at IS NULL) INTO changed;
 ELSIF TG_OP = 'DELETE' THEN
  SELECT EXISTS (SELECT FROM old_rows o JOIN public.media_assets m ON m.id=o.media_id
   JOIN public.vehicles v ON v.published_revision_id=o.publication_id
   WHERE m.state='ready' AND v.publication_state='published' AND v.deleted_at IS NULL) INTO changed;
 ELSE
  WITH old_visible AS (
   SELECT o.* FROM old_rows o JOIN public.media_assets m ON m.id=o.media_id
   JOIN public.vehicles v ON v.published_revision_id=o.publication_id
   WHERE m.state='ready' AND v.publication_state='published' AND v.deleted_at IS NULL
  ), new_visible AS (
   SELECT n.* FROM new_rows n JOIN public.media_assets m ON m.id=n.media_id
   JOIN public.vehicles v ON v.published_revision_id=n.publication_id
   WHERE m.state='ready' AND v.publication_state='published' AND v.deleted_at IS NULL
  ) SELECT EXISTS (SELECT FROM old_visible o FULL JOIN new_visible n USING (publication_id,media_id)
    WHERE o.media_id IS NULL OR n.media_id IS NULL) INTO changed;
 END IF;
 IF changed THEN PERFORM public.queue_public_catalog_change(); END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION version_public_localizations() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF current_setting('hd.public_catalog_pending', true) = pg_current_xact_id()::text THEN RETURN NULL; END IF;
 IF EXISTS (SELECT FROM new_rows n JOIN public.vehicles v ON v.published_revision_id=n.publication_id
   WHERE v.publication_state='published' AND v.deleted_at IS NULL) THEN
  PERFORM public.queue_public_catalog_change();
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint

-- Transition tables avoid per-record triggers and repeated singleton locks during
-- bulk imports. Every test below the trigger is a set-based EXISTS comparison.
DO $$
DECLARE target record; event text; transition text;
BEGIN
 FOR target IN SELECT * FROM (VALUES
  ('vehicles','version_public_vehicles'),
  ('home_config','version_public_home'),
  ('external_catalog','version_public_external_catalog'),
  ('external_media','version_public_external_media'),
  ('media_assets','version_public_staff_media'),
  ('publication_media','version_public_media_references')
 ) AS targets(table_name,function_name) LOOP
  FOREACH event IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
   transition := CASE event WHEN 'INSERT' THEN 'NEW TABLE AS new_rows'
    WHEN 'DELETE' THEN 'OLD TABLE AS old_rows' ELSE 'OLD TABLE AS old_rows NEW TABLE AS new_rows' END;
   EXECUTE format('CREATE TRIGGER %I AFTER %s ON public.%I REFERENCING %s FOR EACH STATEMENT EXECUTE FUNCTION public.%I()',
    target.table_name || '_public_version_' || lower(event), event, target.table_name, transition, target.function_name);
  END LOOP;
 END LOOP;
END $$;
CREATE TRIGGER external_listings_public_version_update
 AFTER UPDATE ON external_listings REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
 FOR EACH STATEMENT EXECUTE FUNCTION version_public_external_metadata();
CREATE TRIGGER publication_localizations_public_version_insert
 AFTER INSERT ON publication_localizations REFERENCING NEW TABLE AS new_rows
 FOR EACH STATEMENT EXECUTE FUNCTION version_public_localizations();

-- Normal writes use READ COMMITTED and leave constraints deferred. An explicit
-- SET CONSTRAINTS ... IMMEDIATE can flush the state lock earlier; do not use it in
-- business writers. Future deferred business triggers need a fresh lock-order review.
-- Wall-clock media expiry requires cache TTL clamping; no SQL mutation occurs then.
