-- Fixed-scope, one-shot imports. No scheduler is installed or enabled by this migration.
CREATE TABLE external_ingestion_jobs (
 id uuid PRIMARY KEY, job_key text NOT NULL UNIQUE, manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[a-f0-9]{64}$'),
 manifest jsonb NOT NULL, triggered_by text NOT NULL REFERENCES staff(id),
 state text NOT NULL DEFAULT 'awaiting_snapshot' CHECK(state IN ('awaiting_snapshot','ready','complete','paused')),
 generated_at timestamptz NOT NULL, snapshot_verified_at timestamptz,
 received_seq bigint NOT NULL DEFAULT 0, applied_seq bigint NOT NULL DEFAULT 0,
 receive_cursors jsonb NOT NULL DEFAULT '{}', completed_lanes jsonb NOT NULL DEFAULT '{}',
 recovery_count integer NOT NULL DEFAULT 0 CHECK(recovery_count BETWEEN 0 AND 2),
 lease_owner uuid, fence bigint NOT NULL DEFAULT 0, lease_until timestamptz,
 failures integer NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT '-infinity',
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CHECK(applied_seq<=received_seq)
);
CREATE TABLE external_ingestion_members (
 job_id uuid NOT NULL REFERENCES external_ingestion_jobs(id), provider text NOT NULL, source text NOT NULL, external_id text NOT NULL,
 canonical_id text NOT NULL, verification_pending boolean NOT NULL DEFAULT false, PRIMARY KEY(job_id,provider,source,external_id)
);
CREATE TABLE external_ingestion_events (
 job_id uuid NOT NULL REFERENCES external_ingestion_jobs(id), seq bigint NOT NULL, event_key text NOT NULL,
 payload_hash text NOT NULL, provider text NOT NULL, source text NOT NULL, external_id text NOT NULL,
 operation text NOT NULL CHECK(operation IN ('upsert','withdraw','relist')),
 business_order numeric(30,0) NOT NULL CHECK(business_order>=0), observed_at timestamptz NOT NULL,
 snapshot_hash text, document jsonb NOT NULL, hydrated_document jsonb, hydration_attempts integer NOT NULL DEFAULT 0, hydration_retry_at timestamptz NOT NULL DEFAULT '-infinity', hydration_error text, lane text NOT NULL CHECK(lane IN ('snapshot','delta','detail')),
 completed_at timestamptz, outcome text CHECK(outcome IN ('applied','obsolete')),
 PRIMARY KEY(job_id,seq), UNIQUE(job_id,event_key),
 FOREIGN KEY(job_id,provider,source,external_id) REFERENCES external_ingestion_members(job_id,provider,source,external_id)
);
CREATE INDEX external_ingestion_pending ON external_ingestion_events(job_id,operation,seq) WHERE completed_at IS NULL;
-- Business ordering belongs to source identity, independent of local task IDs and observation hashes.
CREATE TABLE external_ingestion_identity_state (
 provider text NOT NULL, source text NOT NULL, external_id text NOT NULL,
 business_order numeric(30,0) NOT NULL DEFAULT 0, withdrawn boolean NOT NULL DEFAULT false,
 observed_at timestamptz NOT NULL, business_at timestamptz NOT NULL, PRIMARY KEY(provider,source,external_id)
);
CREATE TABLE external_ingestion_pages (
 job_id uuid NOT NULL REFERENCES external_ingestion_jobs(id), lane text NOT NULL, input_cursor text NOT NULL,
 page_hash text NOT NULL, next_cursor text, terminal boolean NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,lane,input_cursor)
);
ALTER TABLE external_ingestion_jobs ADD COLUMN network_requests integer NOT NULL DEFAULT 0;
