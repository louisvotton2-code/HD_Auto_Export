-- Additive state: existing drafts and immutable publications are not rewritten.
-- This revision tracks changes to the next publication, independently of both
-- vehicles.version (which includes private edits) and public_catalog_state.
ALTER TABLE vehicles ADD COLUMN public_content_revision integer NOT NULL DEFAULT 1
 CHECK (public_content_revision > 0);

CREATE TABLE publication_preview_confirmations (
 vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
 actor_id text NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
 public_revision integer NOT NULL CHECK (public_revision > 0),
 fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
 locale text NOT NULL CHECK (locale IN ('zh', 'en', 'ru')),
 confirmed_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
 PRIMARY KEY (vehicle_id, actor_id),
 CHECK (expires_at > confirmed_at AND expires_at <= confirmed_at + interval '10 minutes')
);

-- Keep the existing writer lock order: home (when needed) -> vehicles in ID
-- order -> drafts/localizations/media -> confirmations. API media operations,
-- cleanup and publication already acquire the vehicle lock before media locks.
-- Direct maintenance SQL must do the same, or run with application writes
-- paused: a child-row trigger cannot reorder a lock acquired by its caller.
-- Never lock home or the public catalog singleton from these triggers.
CREATE FUNCTION version_vehicle_public_document() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE before_data jsonb; after_data jsonb; affected_ids uuid[]; vehicle_id uuid;
BEGIN
 IF TG_OP <> 'INSERT' THEN
  before_data := CASE WHEN TG_TABLE_NAME = 'vehicle_drafts' THEN OLD.data - 'internal' ELSE OLD.data END;
 END IF;
 IF TG_OP <> 'DELETE' THEN
  after_data := CASE WHEN TG_TABLE_NAME = 'vehicle_drafts' THEN NEW.data - 'internal' ELSE NEW.data END;
 END IF;
 IF TG_OP = 'UPDATE' THEN
  IF OLD.vehicle_id = NEW.vehicle_id AND before_data IS NOT DISTINCT FROM after_data THEN RETURN NULL; END IF;
  affected_ids := ARRAY[OLD.vehicle_id, NEW.vehicle_id];
 ELSIF TG_OP = 'INSERT' THEN affected_ids := ARRAY[NEW.vehicle_id];
 ELSE affected_ids := ARRAY[OLD.vehicle_id];
 END IF;
 FOR vehicle_id IN SELECT DISTINCT id FROM unnest(affected_ids) AS ids(id) ORDER BY id LOOP
  UPDATE public.vehicles SET public_content_revision = public_content_revision + 1 WHERE id = vehicle_id;
 END LOOP;
 RETURN NULL;
END $$;

CREATE TRIGGER vehicle_drafts_content_revision
 AFTER INSERT OR UPDATE OR DELETE ON vehicle_drafts
 FOR EACH ROW EXECUTE FUNCTION version_vehicle_public_document();
CREATE TRIGGER vehicle_localizations_content_revision
 AFTER INSERT OR UPDATE OR DELETE ON vehicle_localizations
 FOR EACH ROW EXECUTE FUNCTION version_vehicle_public_document();
--> statement-breakpoint

-- Live inventory, deletion and withdrawal to archived/draft revoke confirmation.
-- Moving to published does not: the publication just consumed that confirmation.
-- Publication pointers/timestamps, generic versions and updated_at do not affect
-- this revision. One BEFORE trigger combines simultaneous changes into one bump.
CREATE FUNCTION version_vehicle_public_inventory() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF NEW.public_content_revision < OLD.public_content_revision THEN
  RAISE EXCEPTION 'Public content revision cannot decrease'
   USING ERRCODE = '23514', CONSTRAINT = 'vehicles_public_content_revision_monotonic';
 END IF;
 IF ROW(OLD.availability, OLD.availability_checked_at, OLD.deleted_at)
  IS DISTINCT FROM ROW(NEW.availability, NEW.availability_checked_at, NEW.deleted_at)
  OR (NEW.publication_state IS DISTINCT FROM OLD.publication_state
      AND NEW.publication_state IN ('archived', 'draft')) THEN
  NEW.public_content_revision := greatest(NEW.public_content_revision, OLD.public_content_revision + 1);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vehicles_content_revision
 BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION version_vehicle_public_inventory();

-- Order, cover, alt and reference changes are tracked by the draft trigger.
-- Only media currently referenced by a draft affect its confirmation. Expiry
-- refreshes and orphan uploads/cleanup do not change the public draft revision.
CREATE FUNCTION version_vehicle_public_media() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE affected_ids uuid[]; media_ids uuid[]; vehicle_id uuid;
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF ROW(OLD.id, OLD.vehicle_id, OLD.version, OLD.state, OLD.content_type,
         OLD.width, OLD.height, OLD.byte_size, OLD.expected_size, OLD.rights)
   IS NOT DISTINCT FROM ROW(NEW.id, NEW.vehicle_id, NEW.version, NEW.state, NEW.content_type,
                            NEW.width, NEW.height, NEW.byte_size, NEW.expected_size, NEW.rights) THEN RETURN NULL; END IF;
  affected_ids := ARRAY[OLD.vehicle_id, NEW.vehicle_id]; media_ids := ARRAY[OLD.id, NEW.id];
 ELSIF TG_OP = 'INSERT' THEN affected_ids := ARRAY[NEW.vehicle_id]; media_ids := ARRAY[NEW.id];
 ELSE affected_ids := ARRAY[OLD.vehicle_id]; media_ids := ARRAY[OLD.id];
 END IF;
 FOR vehicle_id IN
  SELECT d.vehicle_id FROM public.vehicle_drafts d
  WHERE d.vehicle_id = ANY(affected_ids)
   AND EXISTS (SELECT FROM jsonb_array_elements(d.data->'media') AS items(item)
    WHERE lower(item->>'id') IN (SELECT id::text FROM unnest(media_ids) AS ids(id)))
  ORDER BY d.vehicle_id
 LOOP
  UPDATE public.vehicles SET public_content_revision = public_content_revision + 1 WHERE id = vehicle_id;
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER media_assets_content_revision
 AFTER INSERT OR UPDATE OR DELETE ON media_assets
 FOR EACH ROW EXECUTE FUNCTION version_vehicle_public_media();

-- Confirmation upserts and expiry cleanup never write back to vehicles. The
-- publisher checks actor, current revision, fingerprint and expiry while holding
-- the vehicle lock; an A -> B -> A edit cannot make an old confirmation current.
