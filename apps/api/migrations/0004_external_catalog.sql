CREATE TABLE external_catalog_state (
 id integer PRIMARY KEY CHECK (id = 1),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)
);
INSERT INTO external_catalog_state(id) VALUES (1);
--> statement-breakpoint
CREATE TABLE external_listings (
 id uuid PRIMARY KEY,
 provider text NOT NULL,
 platform_id text NOT NULL,
 external_id text NOT NULL,
 source_revision bigint NOT NULL CHECK (source_revision > 0),
 source_hash text NOT NULL,
 source_data jsonb,
 upstream_state text NOT NULL CHECK (upstream_state IN ('active', 'withdrawn')),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 fetched_at timestamptz NOT NULL,
 source_updated_at timestamptz,
 published_at timestamptz,
 UNIQUE(provider, platform_id, external_id),
 CHECK (upstream_state <> 'active' OR (source_data IS NOT NULL AND published_at IS NOT NULL))
);
CREATE TABLE external_listing_overrides (
 listing_id uuid PRIMARY KEY REFERENCES external_listings(id),
 data jsonb NOT NULL
);
CREATE TABLE external_override_events (
 id uuid PRIMARY KEY,
 listing_id uuid NOT NULL REFERENCES external_listings(id),
 actor_id text NOT NULL REFERENCES staff(id),
 request_id text NOT NULL,
 version integer NOT NULL,
 data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (listing_id, version)
);
--> statement-breakpoint
CREATE TABLE external_catalog (
 listing_id uuid PRIMARY KEY REFERENCES external_listings(id),
 published_at timestamptz NOT NULL,
 platform_name text NOT NULL,
 listing_url text NOT NULL,
 facts jsonb NOT NULL,
 price_cny numeric(16,2) CHECK (price_cny > 0),
 issues jsonb NOT NULL,
 localized jsonb NOT NULL,
 details jsonb NOT NULL
);
CREATE INDEX external_catalog_order_idx ON external_catalog(published_at DESC, listing_id);
CREATE INDEX external_catalog_model_idx ON external_catalog((facts->'make'->>'id'), (facts->'model'->>'id'));
CREATE INDEX external_catalog_powertrain_idx ON external_catalog((facts->>'powertrain'));
CREATE INDEX external_catalog_year_idx ON external_catalog(((facts->>'modelYear')::integer));
CREATE INDEX external_catalog_mileage_idx ON external_catalog(((facts->>'mileageKm')::integer));
CREATE INDEX external_catalog_price_idx ON external_catalog(price_cny);
--> statement-breakpoint
CREATE TABLE external_import_batches (
 id uuid PRIMARY KEY,
 provider text NOT NULL,
 idempotency_key text NOT NULL,
 request_hash text NOT NULL,
 actor_id text NOT NULL REFERENCES staff(id),
 imported_at timestamptz NOT NULL DEFAULT now(),
 counts jsonb NOT NULL,
 UNIQUE(provider, idempotency_key)
);
CREATE INDEX external_import_batches_order_idx ON external_import_batches(imported_at DESC, id);
CREATE TABLE external_import_records (
 batch_id uuid NOT NULL REFERENCES external_import_batches(id),
 row_number integer NOT NULL CHECK (row_number BETWEEN 1 AND 250),
 listing_id uuid REFERENCES external_listings(id),
 operation text CHECK (operation IN ('upsert', 'withdraw')),
 status text NOT NULL CHECK (status IN ('applied', 'unchanged', 'ignored', 'rejected')),
 reason text,
 issues jsonb NOT NULL,
 candidate jsonb,
 raw_encoded text NOT NULL,
 raw_hash text NOT NULL,
 PRIMARY KEY(batch_id, row_number)
);
CREATE INDEX external_import_records_listing_idx ON external_import_records(batch_id, listing_id, row_number DESC);
--> statement-breakpoint
CREATE TABLE external_media (
 id uuid PRIMARY KEY,
 listing_id uuid NOT NULL REFERENCES external_listings(id),
 source_media_id text NOT NULL,
 url text NOT NULL,
 width integer,
 height integer,
 alt jsonb,
 position integer NOT NULL CHECK (position BETWEEN 0 AND 29),
 active boolean NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 refreshed_at timestamptz NOT NULL,
 expires_at timestamptz,
 UNIQUE (listing_id, source_media_id),
 CHECK ((width IS NULL AND height IS NULL) OR (width IS NOT NULL AND height IS NOT NULL AND width > 0 AND height > 0))
);
CREATE INDEX external_media_active_idx ON external_media(listing_id, position) WHERE active;
CREATE INDEX external_media_expiry_idx ON external_media(expires_at) WHERE active AND expires_at IS NOT NULL;
CREATE TABLE external_media_refresh_requests (
 media_id uuid NOT NULL REFERENCES external_media(id),
 media_revision integer NOT NULL CHECK (media_revision > 0),
 queued_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(media_id, media_revision)
);
--> statement-breakpoint
CREATE TABLE external_translation_months (
 month date PRIMARY KEY CHECK (extract(day FROM month) = 1),
 verified_allowance integer NOT NULL DEFAULT 0 CHECK (verified_allowance BETWEEN 0 AND 1000000),
 verified_until timestamptz,
 reserved_characters integer NOT NULL DEFAULT 0 CHECK (reserved_characters >= 0),
 attempted_characters integer NOT NULL DEFAULT 0 CHECK (attempted_characters >= 0),
 CHECK (reserved_characters + attempted_characters <= verified_allowance),
 CHECK (verified_allowance = 0 OR verified_until IS NOT NULL)
);
CREATE TABLE external_translation_trials (
 id uuid PRIMARY KEY,
 batch_id uuid NOT NULL UNIQUE REFERENCES external_import_batches(id),
 actor_id text NOT NULL REFERENCES staff(id),
 month date NOT NULL REFERENCES external_translation_months(month),
 report jsonb NOT NULL,
 reserved_characters integer NOT NULL DEFAULT 0 CHECK (reserved_characters >= 0),
 attempted_characters integer NOT NULL DEFAULT 0 CHECK (attempted_characters >= 0),
 CHECK (reserved_characters + attempted_characters <= 100000)
);
CREATE TABLE external_translation_work (
 trial_id uuid NOT NULL REFERENCES external_translation_trials(id),
 call_key text NOT NULL,
 characters integer NOT NULL CHECK (characters > 0 AND characters <= 2000),
 data jsonb NOT NULL,
 PRIMARY KEY(trial_id, call_key)
);
CREATE TABLE external_translation_reservations (
 trial_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 call_key text NOT NULL,
 characters integer NOT NULL CHECK (characters > 0),
 dispatched_at timestamptz,
 finished_at timestamptz CHECK (finished_at IS NULL OR dispatched_at IS NOT NULL),
 PRIMARY KEY(trial_id, attempt_id),
 FOREIGN KEY(trial_id, call_key) REFERENCES external_translation_work(trial_id, call_key)
);
CREATE UNIQUE INDEX external_translation_inflight_idx ON external_translation_reservations(trial_id,call_key) WHERE finished_at IS NULL;
CREATE TABLE external_translation_cache (
 call_key text PRIMARY KEY,
 result text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
