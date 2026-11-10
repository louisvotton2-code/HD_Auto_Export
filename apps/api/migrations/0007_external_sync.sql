CREATE TABLE external_sync_state (
 id integer PRIMARY KEY CHECK (id = 1),
 enqueued_seq bigint NOT NULL DEFAULT 0 CHECK (enqueued_seq >= 0),
 checkpoint bigint NOT NULL DEFAULT 0 CHECK (checkpoint >= 0 AND checkpoint <= enqueued_seq),
 next_delta_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 next_reconcile_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 retry_at timestamptz NOT NULL DEFAULT '-infinity',
 consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
 lease_owner uuid,
 lease_expires_at timestamptz,
 fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
 CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);
INSERT INTO external_sync_state(id) VALUES (1);
--> statement-breakpoint
CREATE TABLE external_sync_events (
 seq bigint PRIMARY KEY CHECK (seq > 0),
 event_key text NOT NULL UNIQUE,
 lane text NOT NULL CHECK (lane IN ('delta', 'reconcile')),
 candidate jsonb NOT NULL CHECK (jsonb_typeof(candidate) = 'object'),
 is_withdrawal boolean GENERATED ALWAYS AS (coalesce(candidate->>'operation' = 'withdraw', false)) STORED,
 source_hash text NOT NULL,
 queued_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 batch_id uuid REFERENCES external_import_batches(id),
 CHECK ((completed_at IS NULL) = (batch_id IS NULL))
);
CREATE INDEX external_sync_events_pending_lane_idx ON external_sync_events(lane, seq) WHERE completed_at IS NULL AND NOT is_withdrawal;
CREATE INDEX external_sync_events_pending_withdrawal_idx ON external_sync_events(seq) WHERE completed_at IS NULL AND is_withdrawal;
CREATE INDEX external_sync_events_pending_checkpoint_idx ON external_sync_events(seq) WHERE completed_at IS NULL;
--> statement-breakpoint
ALTER TABLE external_media_refresh_requests ADD COLUMN completed_at timestamptz;
ALTER TABLE external_media_refresh_requests ADD COLUMN outcome text CHECK (outcome IN ('refreshed', 'obsolete', 'unsafe_source'));
ALTER TABLE external_media_refresh_requests ADD CONSTRAINT external_media_refresh_result_check
  CHECK ((completed_at IS NULL) = (outcome IS NULL));
CREATE INDEX external_media_refresh_pending_idx ON external_media_refresh_requests(queued_at, media_id, media_revision) WHERE completed_at IS NULL;
--> statement-breakpoint
CREATE TABLE external_sync_heartbeats (
 worker_id uuid PRIMARY KEY,
 seen_at timestamptz NOT NULL,
 status text NOT NULL CHECK (status IN ('ready', 'retrying'))
);
CREATE INDEX external_sync_heartbeats_seen_idx ON external_sync_heartbeats(seen_at);
