-- Additive sidecars keep old strict draft/publication JSON readable by prior APIs.
CREATE TABLE vehicle_localizations (
 vehicle_id uuid PRIMARY KEY REFERENCES vehicles(id),
 revision integer NOT NULL CHECK(revision > 0),
 data jsonb NOT NULL,
 bindings jsonb NOT NULL,
 retired_fields jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE publication_localizations (
 publication_id uuid PRIMARY KEY REFERENCES vehicle_publications(id),
 data jsonb NOT NULL,
 bindings jsonb NOT NULL,
 projections jsonb NOT NULL
);
CREATE TRIGGER publication_localizations_immutable BEFORE UPDATE OR DELETE ON publication_localizations
 FOR EACH ROW EXECUTE FUNCTION reject_publication_change();
-- Operational DTO additions are kept outside historical vehicle receipts.
CREATE TABLE idempotency_vehicle_metadata (
 actor_id text NOT NULL,
 operation text NOT NULL,
 key text NOT NULL,
 has_unpublished_changes boolean,
 receipt_hash text NOT NULL,
 PRIMARY KEY(actor_id,operation,key),
 FOREIGN KEY(actor_id,operation,key) REFERENCES idempotency_keys(actor_id,operation,key) ON DELETE CASCADE
);
-- Preserve existing new-version response metadata while restoring the old DTO body.
-- No receipt is deleted, expired or recalculated from current vehicle state.
INSERT INTO idempotency_vehicle_metadata(actor_id,operation,key,has_unpublished_changes,receipt_hash)
 SELECT actor_id,operation,key,(response->>'hasUnpublishedChanges')::boolean,md5((response-'hasUnpublishedChanges')::text)
 FROM idempotency_keys WHERE response ? 'hasUnpublishedChanges'
 AND (operation='vehicle.create' OR operation LIKE 'vehicle.publish:%' OR operation LIKE 'vehicle.delete:%' OR operation LIKE 'vehicle.restore:%');
UPDATE idempotency_keys SET response=response-'hasUnpublishedChanges'
 WHERE response ? 'hasUnpublishedChanges'
 AND (operation='vehicle.create' OR operation LIKE 'vehicle.publish:%' OR operation LIKE 'vehicle.delete:%' OR operation LIKE 'vehicle.restore:%');
