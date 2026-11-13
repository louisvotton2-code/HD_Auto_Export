CREATE TABLE external_full_sync (
 id integer PRIMARY KEY CHECK(id=1), version integer NOT NULL DEFAULT 1,
 worker_fence bigint NOT NULL DEFAULT 0, enabled boolean NOT NULL DEFAULT false, paused boolean NOT NULL DEFAULT true, disk_paused boolean NOT NULL DEFAULT false,
 mode text NOT NULL DEFAULT 'full' CHECK(mode IN('full','continuous')),
 since_at timestamptz, receive_cursor numeric(30,0), received_events bigint NOT NULL DEFAULT 0, applied_events bigint NOT NULL DEFAULT 0,
 next_delta_at timestamptz NOT NULL DEFAULT now(), next_snapshot_at timestamptz NOT NULL DEFAULT now(),
 next_maintenance_at timestamptz NOT NULL DEFAULT now(), last_success_at timestamptz,
 last_error_code text, last_error_at timestamptz, request_after timestamptz NOT NULL DEFAULT '-infinity',
 recovery_count integer NOT NULL DEFAULT 0, triggered_by text, last_capacity_sample bigint NOT NULL DEFAULT 0,capacity_pending boolean NOT NULL DEFAULT false,capacity_estimate jsonb,capacity_baseline jsonb, account jsonb, bulk_day date, bulk_ids integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO external_full_sync(id) VALUES(1);
CREATE TABLE external_full_controls(actor_id text NOT NULL,key uuid NOT NULL,request_hash text NOT NULL,response jsonb NOT NULL,PRIMARY KEY(actor_id,key));
CREATE TABLE external_full_snapshots (
 id uuid PRIMARY KEY, generated_at timestamptz NOT NULL, state text NOT NULL CHECK(state IN('downloading','staging','verified','applying','complete','failed')),
 path text NOT NULL, sha256 text, bytes bigint, rows bigint NOT NULL DEFAULT 0, staged bigint NOT NULL DEFAULT 0, apply_cursor bigint NOT NULL DEFAULT 0,
 source_counts jsonb, error_code text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,archive_pruned_at timestamptz
);
CREATE UNIQUE INDEX external_full_snapshot_single ON external_full_snapshots((true)) WHERE state IN('downloading','staging','verified','applying');
CREATE TABLE external_full_stage(snapshot_id uuid NOT NULL REFERENCES external_full_snapshots(id),row_number bigint NOT NULL,source text NOT NULL,external_id text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(snapshot_id,row_number),UNIQUE(snapshot_id,source,external_id));
CREATE TABLE external_full_members (
 source text NOT NULL,external_id text NOT NULL,canonical_id text NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','active','withdrawn')),
 event_order numeric(30,0) NOT NULL DEFAULT 0,business_at timestamptz NOT NULL DEFAULT 'epoch',
 desired_generation bigint NOT NULL DEFAULT 1,applied_generation bigint NOT NULL DEFAULT 0,
 last_snapshot uuid,csv_hash text,verification_pending boolean NOT NULL DEFAULT false,has_report boolean NOT NULL DEFAULT false,sampled boolean NOT NULL DEFAULT false,report_state text NOT NULL DEFAULT 'unknown' CHECK(report_state IN('unknown','pending','available','unavailable','no_report')),
 last_detail_at timestamptz,report_checked_at timestamptz,last_accessed_at timestamptz,photo_expires_at timestamptz,
 locales text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(source,external_id)
);
CREATE INDEX external_full_rotation ON external_full_members(last_detail_at,source,external_id) WHERE state<>'withdrawn';
CREATE INDEX external_full_canonical ON external_full_members(canonical_id,state);
CREATE TABLE external_full_aliases(source text NOT NULL,external_id text NOT NULL,target_source text NOT NULL,target_id text NOT NULL,observed_at timestamptz NOT NULL,PRIMARY KEY(source,external_id));
CREATE TABLE external_full_events (
 event_id numeric(30,0) PRIMARY KEY,payload_hash text NOT NULL,source text NOT NULL,external_id text NOT NULL,operation text NOT NULL CHECK(operation IN('upsert','withdraw','relist')),
 business_at timestamptz NOT NULL,document_refs jsonb NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),applied_at timestamptz,error_code text
);
CREATE INDEX external_full_event_pending ON external_full_events((operation='withdraw') DESC,event_id) WHERE applied_at IS NULL;
CREATE TABLE external_full_work (
 source text NOT NULL,external_id text NOT NULL,kind text NOT NULL CHECK(kind IN('detail','report')),generation bigint NOT NULL,
 priority integer NOT NULL DEFAULT 0,document_refs jsonb NOT NULL DEFAULT '[]',locales text[] NOT NULL DEFAULT '{}',
 attempts integer NOT NULL DEFAULT 0,due_at timestamptz NOT NULL DEFAULT now(),last_error_code text,
 PRIMARY KEY(source,external_id,kind),FOREIGN KEY(source,external_id) REFERENCES external_full_members(source,external_id)
);
CREATE INDEX external_full_work_due ON external_full_work(kind,priority DESC,due_at);
CREATE TABLE external_full_receipts(cursor_key text PRIMARY KEY,next_cursor numeric(30,0) NOT NULL,event_count integer NOT NULL,complete boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE external_full_daily(kind text NOT NULL,day date NOT NULL,response_hash text NOT NULL,PRIMARY KEY(kind,day));

CREATE TABLE external_full_archive_pins(snapshot_id uuid NOT NULL REFERENCES external_full_snapshots(id),reference text NOT NULL,PRIMARY KEY(snapshot_id,reference));
