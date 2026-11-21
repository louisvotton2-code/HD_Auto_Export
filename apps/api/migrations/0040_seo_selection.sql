-- Controlled first-wave external identity selection. Slot uniqueness imposes a hard total cap, independent of locale.
CREATE TABLE seo_external_selection (
 listing_id uuid PRIMARY KEY REFERENCES external_listings(id) ON DELETE CASCADE,
 slot integer NOT NULL UNIQUE CHECK(slot BETWEEN 1 AND 1000),
 selected_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION version_public_seo_selection() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.queue_public_catalog_change();
 RETURN NULL;
END $$;
CREATE TRIGGER seo_selection_public_version AFTER INSERT OR UPDATE OR DELETE ON seo_external_selection
 FOR EACH STATEMENT EXECUTE FUNCTION version_public_seo_selection();

-- These eligibility bits can change before a projection repair removes the old catalog row.
-- Invalidate selected detail cache even in that interval; ordinary source writes remain on existing triggers.
CREATE FUNCTION version_public_seo_source_flag() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF OLD.formal_primary IS DISTINCT FROM NEW.formal_primary
  AND EXISTS(SELECT FROM public.seo_external_selection WHERE listing_id=NEW.id) THEN
  PERFORM public.queue_public_catalog_metadata_change();
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER seo_source_flag_version AFTER UPDATE OF formal_primary ON external_listings
 FOR EACH ROW EXECUTE FUNCTION version_public_seo_source_flag();
CREATE FUNCTION version_public_seo_hidden() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (OLD.data->>'hidden') IS NOT DISTINCT FROM (NEW.data->>'hidden') THEN RETURN NULL; END IF;
 IF EXISTS(SELECT FROM public.seo_external_selection WHERE listing_id=CASE WHEN TG_OP='DELETE' THEN OLD.listing_id ELSE NEW.listing_id END) THEN
  PERFORM public.queue_public_catalog_metadata_change();
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER seo_hidden_version AFTER INSERT OR UPDATE OR DELETE ON external_listing_overrides
 FOR EACH ROW EXECUTE FUNCTION version_public_seo_hidden();
