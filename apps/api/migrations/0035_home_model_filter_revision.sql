-- Inspection and price history affect vehicle detail, but not eligibility,
-- facet labels or counts. Preserve the global revision for detail consumers.
CREATE OR REPLACE FUNCTION version_public_source_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE listing uuid;
BEGIN
 IF current_setting('hd.public_catalog_pending',true)=pg_current_xact_id()::text THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
 listing:=CASE WHEN TG_OP='DELETE' THEN OLD.listing_id ELSE NEW.listing_id END;
 IF EXISTS (SELECT FROM public.external_catalog c JOIN public.external_listings l ON l.id=c.listing_id
   WHERE c.listing_id=listing AND l.upstream_state='active') THEN
  IF TG_TABLE_NAME='external_vehicle_evidence_sets' THEN
   PERFORM public.queue_public_catalog_metadata_change();
  ELSE
   PERFORM public.queue_public_catalog_change();
  END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION version_public_external_catalog() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE changed boolean; tx_id text := pg_current_xact_id()::text;
BEGIN
 IF current_setting('hd.public_catalog_pending',true)=tx_id THEN RETURN NULL; END IF;
 IF TG_OP='INSERT' THEN
  SELECT EXISTS (SELECT FROM new_rows n JOIN public.external_listings l ON l.id=n.listing_id
   WHERE l.upstream_state='active') INTO changed;
 ELSIF TG_OP='DELETE' THEN
  SELECT EXISTS (SELECT FROM old_rows o JOIN public.external_listings l ON l.id=o.listing_id
   WHERE l.upstream_state='active') INTO changed;
 ELSE
  -- A mixed batch only needs one facet-relevant row to invalidate the filter.
  SELECT EXISTS (SELECT FROM old_rows o FULL JOIN new_rows n USING (listing_id)
   JOIN public.external_listings l ON l.id=coalesce(n.listing_id,o.listing_id)
   WHERE l.upstream_state='active' AND (
    ROW(o.listing_id,o.published_at,o.platform_name,o.listing_url,o.facts,o.price_cny,o.localized)
     IS DISTINCT FROM ROW(n.listing_id,n.published_at,n.platform_name,n.listing_url,n.facts,n.price_cny,n.localized)
    OR CASE
     WHEN o.details IS NOT DISTINCT FROM n.details THEN false
     WHEN jsonb_typeof(o.details)='object' AND jsonb_typeof(n.details)='object'
      THEN (o.details - 'inspection') IS DISTINCT FROM (n.details - 'inspection')
     ELSE true
    END)) INTO changed;
  IF NOT changed AND current_setting('hd.public_catalog_metadata_pending',true) IS DISTINCT FROM tx_id THEN
   IF EXISTS (SELECT FROM old_rows o FULL JOIN new_rows n USING (listing_id)
    JOIN public.external_listings l ON l.id=coalesce(n.listing_id,o.listing_id)
    WHERE l.upstream_state='active' AND (
     o.issues IS DISTINCT FROM n.issues OR o.details IS DISTINCT FROM n.details)) THEN
    PERFORM public.queue_public_catalog_metadata_change();
   END IF;
  END IF;
 END IF;
 IF changed THEN PERFORM public.queue_public_catalog_change(); END IF;
 RETURN NULL;
END $$;
