-- Offline evidence is private, separately bound to the exact source version and URL.
-- No supplier assertion, source URL or hasReport flag becomes verification evidence.
CREATE TABLE external_report_evidence (
 listing_id uuid PRIMARY KEY REFERENCES external_listings(id),
 binding jsonb NOT NULL CHECK (jsonb_typeof(binding)='object' AND (binding->>'listingId') IS NOT DISTINCT FROM listing_id::text),
 observation jsonb NOT NULL CHECK (jsonb_typeof(observation)='object' AND (observation->>'listingId') IS NOT DISTINCT FROM listing_id::text),
 observation_hash text NOT NULL CHECK (observation_hash ~ '^[0-9a-f]{64}$'),
 manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
 checked_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK (expires_at > checked_at AND expires_at <= checked_at + interval '24 hours'),
 imported_by text NOT NULL REFERENCES staff(id),
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE external_inspection_enrichment (
 listing_id uuid PRIMARY KEY REFERENCES external_listings(id),
 binding jsonb NOT NULL CHECK (jsonb_typeof(binding)='object' AND (binding->>'listingId') IS NOT DISTINCT FROM listing_id::text),
 content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
 archive_batch_id uuid NOT NULL,
 archive_row integer NOT NULL,
 raw_hash text NOT NULL CHECK (raw_hash ~ '^[0-9a-f]{64}$'),
 imported_by text NOT NULL REFERENCES staff(id),
 imported_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(archive_batch_id,archive_row) REFERENCES external_import_records(batch_id,row_number)
);
--> statement-breakpoint
-- A provider row can also supply a staff-curated publication. Use published source identity, never its draft.
CREATE FUNCTION report_source_has_public_reference(source_id uuid, platform text, external_identity text, listing_url text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS (SELECT FROM public.external_catalog WHERE listing_id=source_id)
 OR EXISTS (SELECT FROM public.vehicles v JOIN public.vehicle_publications p ON p.id=v.published_revision_id
   WHERE v.publication_state='published' AND v.deleted_at IS NULL AND p.data->'source'->>'kind'='external'
   AND p.data->'source'->'platform'->>'id'=platform AND p.data->'source'->>'externalId'=external_identity
   AND p.data->'source'->>'listingUrl'=listing_url)
$$;
CREATE FUNCTION version_public_report_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(OLD.binding,OLD.observation,OLD.observation_hash,OLD.checked_at,OLD.expires_at)
   IS NOT DISTINCT FROM ROW(NEW.binding,NEW.observation,NEW.observation_hash,NEW.checked_at,NEW.expires_at) THEN RETURN NULL; END IF;
 IF EXISTS (SELECT FROM public.external_listings l
   WHERE l.id=CASE WHEN TG_OP='DELETE' THEN OLD.listing_id ELSE NEW.listing_id END
   AND public.report_source_has_public_reference(l.id,l.platform_id,l.external_id,l.source_data->>'listingUrl')) THEN
  PERFORM public.queue_public_catalog_change();
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER external_report_evidence_public_version AFTER INSERT OR UPDATE OR DELETE ON external_report_evidence
 FOR EACH ROW EXECUTE FUNCTION version_public_report_evidence();

CREATE FUNCTION version_public_inspection_enrichment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(OLD.binding,OLD.content) IS NOT DISTINCT FROM ROW(NEW.binding,NEW.content) THEN RETURN NULL; END IF;
 IF EXISTS (SELECT FROM public.external_listings l
   WHERE l.id=CASE WHEN TG_OP='DELETE' THEN OLD.listing_id ELSE NEW.listing_id END
   AND public.report_source_has_public_reference(l.id,l.platform_id,l.external_id,l.source_data->>'listingUrl')) THEN
  PERFORM public.queue_public_catalog_change();
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER external_inspection_enrichment_public_version AFTER INSERT OR UPDATE OR DELETE ON external_inspection_enrichment
 FOR EACH ROW EXECUTE FUNCTION version_public_inspection_enrichment();

-- Presence/unique staff association may change even when all older public projection fields are identical.
CREATE FUNCTION version_public_report_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(OLD.provider,OLD.platform_id,OLD.external_id,OLD.source_revision,OLD.source_hash,OLD.source_data)
   IS NOT DISTINCT FROM ROW(NEW.provider,NEW.platform_id,NEW.external_id,NEW.source_revision,NEW.source_hash,NEW.source_data) THEN RETURN NULL; END IF;
 IF (TG_OP<>'INSERT' AND public.report_source_has_public_reference(OLD.id,OLD.platform_id,OLD.external_id,OLD.source_data->>'listingUrl'))
   OR (TG_OP<>'DELETE' AND public.report_source_has_public_reference(NEW.id,NEW.platform_id,NEW.external_id,NEW.source_data->>'listingUrl')) THEN
  PERFORM public.queue_public_catalog_change();
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER external_listings_report_binding_version AFTER INSERT OR UPDATE OR DELETE ON external_listings
 FOR EACH ROW EXECUTE FUNCTION version_public_report_binding();
