-- Legacy events retain unknown stage times. Never backfill success from a queued task.
ALTER TABLE external_full_sync ADD COLUMN timing_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ADD COLUMN last_receive_at timestamptz,
 ADD COLUMN detail_turn bigint NOT NULL DEFAULT 0 CHECK(detail_turn>=0);
-- Existing jobs get the migration statement time as an age floor, without inventing their old enqueue time.
ALTER TABLE external_full_work ADD COLUMN queued_at timestamptz NOT NULL DEFAULT statement_timestamp();
CREATE INDEX external_full_work_age ON external_full_work(kind,queued_at,source,external_id) WHERE attempts<5;
ALTER TABLE external_full_events ADD COLUMN source_type text CHECK(source_type IN('new','price','removed','relisted')),
 ADD COLUMN prior_public_price numeric(16,2), ADD COLUMN was_public boolean,
 ADD COLUMN detail_generation bigint, ADD COLUMN detail_updated_at timestamptz, ADD COLUMN public_effective_at timestamptz,
 ADD COLUMN public_outcome text NOT NULL DEFAULT 'unknown' CHECK(public_outcome IN('unknown','pending','effective','not_public','superseded'));
ALTER TABLE external_full_events ALTER COLUMN public_outcome SET DEFAULT 'pending';
CREATE INDEX external_full_event_generation ON external_full_events(source,external_id,detail_generation) WHERE public_outcome='pending';
CREATE INDEX external_full_event_received ON external_full_events(received_at);

-- At most 2016 five-minute observations for a rolling seven-day diagnostic window.
CREATE TABLE external_full_receive_observations (
 slot_at timestamptz PRIMARY KEY,last_attempt_at timestamptz NOT NULL,last_success_at timestamptz,last_error_code text
);
