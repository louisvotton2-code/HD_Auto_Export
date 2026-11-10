ALTER TABLE vehicles ADD COLUMN deleted_at timestamptz;
ALTER TABLE vehicles ADD COLUMN deleted_by text REFERENCES staff(id);
ALTER TABLE vehicles ADD CONSTRAINT vehicles_deletion_actor_check
 CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));
CREATE INDEX vehicles_deleted_idx ON vehicles(deleted_at DESC,id) WHERE deleted_at IS NOT NULL;

-- A manually captured listing has one stable platform identity, including in the recycle bin.
-- Publication snapshots retain their source metadata independently from subsequent draft edits.
CREATE UNIQUE INDEX vehicle_external_identity_idx ON vehicle_drafts
 ((data->'source'->'platform'->>'id'), (data->'source'->>'externalId'))
 WHERE data->'source'->>'kind'='external';
