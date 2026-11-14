ALTER TABLE external_vehicle_evidence_sets ADD COLUMN overview jsonb NOT NULL DEFAULT '{}';
ALTER TABLE external_vehicle_evidence_sets DROP CONSTRAINT external_vehicle_evidence_sets_status_check;
ALTER TABLE external_vehicle_evidence_sets ADD CONSTRAINT external_vehicle_evidence_sets_status_check CHECK(status IN('available','no_report','unavailable','pending','unknown'));
CREATE INDEX external_inspection_category ON external_vehicle_evidence(listing_id,locale,(data->>'categoryId'),position) WHERE kind='inspection';
