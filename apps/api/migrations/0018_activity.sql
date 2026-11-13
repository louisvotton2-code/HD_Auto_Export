-- Existing rows keep unknown snapshots/diffs; present-day names are not historical evidence.
ALTER TABLE audit_events ADD COLUMN actor_name text, ADD COLUMN changes jsonb;
ALTER TABLE external_override_events ADD COLUMN actor_name text, ADD COLUMN changes jsonb;
ALTER TABLE external_listings ADD COLUMN first_imported_at timestamptz,
 ADD COLUMN first_import_batch_id uuid;
-- The identifier may name a legacy import batch or a formal fixed-scope job.
CREATE INDEX audit_activity_page_idx ON audit_events(vehicle_id,created_at DESC,id DESC);
CREATE INDEX external_activity_page_idx ON external_override_events(listing_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE FUNCTION immutable_activity_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'activity history is append only'; END $$;
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION immutable_activity_event();
CREATE TRIGGER external_override_events_immutable BEFORE UPDATE OR DELETE ON external_override_events FOR EACH ROW EXECUTE FUNCTION immutable_activity_event();
