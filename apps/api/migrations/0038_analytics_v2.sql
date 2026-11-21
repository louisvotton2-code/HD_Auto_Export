SET LOCAL search_path = public, pg_catalog;
--> statement-breakpoint
CREATE TABLE analytics_v2_collection (
  id smallint PRIMARY KEY CHECK (id=1), started_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE analytics_v2_heartbeats (slot timestamptz PRIMARY KEY);
--> statement-breakpoint
CREATE TABLE analytics_activity_hourly (
  hour timestamptz NOT NULL, country text NOT NULL, locale text NOT NULL, device text NOT NULL,
  entry text NOT NULL, source text NOT NULL, campaign text NOT NULL, channel text NOT NULL,
  event_type text NOT NULL, page_type text NOT NULL, total bigint NOT NULL CHECK (total>0),
  PRIMARY KEY (hour,country,locale,device,entry,source,campaign,channel,event_type,page_type)
);
--> statement-breakpoint
CREATE TABLE analytics_activity_minutes (
  minute timestamptz NOT NULL, source text NOT NULL, event_type text NOT NULL, page_type text NOT NULL,
  locale text NOT NULL DEFAULT 'zh', country text NOT NULL DEFAULT 'ZZ',
  device text NOT NULL DEFAULT 'unknown', entry text NOT NULL DEFAULT 'unknown',
  total bigint NOT NULL CHECK (total>0), PRIMARY KEY (minute,source,locale,country,device,entry,event_type,page_type)
);
--> statement-breakpoint
CREATE TABLE analytics_vehicle_activity_hourly (
  hour timestamptz NOT NULL, source text NOT NULL, vehicle_id uuid NOT NULL, supplier boolean NOT NULL,
  locale text NOT NULL DEFAULT 'zh', country text NOT NULL DEFAULT 'ZZ',
  device text NOT NULL DEFAULT 'unknown', entry text NOT NULL DEFAULT 'unknown',
  detail_views bigint NOT NULL, vehicle_clicks bigint NOT NULL, contact_clicks bigint NOT NULL,
  whatsapp_clicks bigint NOT NULL DEFAULT 0, telegram_clicks bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (hour,source,locale,country,device,entry,vehicle_id,supplier)
);
--> statement-breakpoint
CREATE TABLE analytics_ingest_quality (
  hour timestamptz PRIMARY KEY, received bigint NOT NULL, accepted bigint NOT NULL,
  duplicates bigint NOT NULL, dropped bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE analytics_daily_ips (day date PRIMARY KEY, unique_ips bigint NOT NULL);
--> statement-breakpoint
CREATE TABLE analytics_ip_keys (day date NOT NULL, digest bytea NOT NULL, PRIMARY KEY (day,digest));
--> statement-breakpoint
CREATE TABLE analytics_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL, last_at timestamptz NOT NULL, source text NOT NULL,
  entry text NOT NULL, locale text NOT NULL, device text NOT NULL, country text NOT NULL,
  catalog_stage smallint NOT NULL DEFAULT 0 CHECK (catalog_stage BETWEEN 0 AND 4),
  direct_stage smallint NOT NULL DEFAULT 0 CHECK (direct_stage BETWEEN 0 AND 2)
);
--> statement-breakpoint
CREATE INDEX analytics_sessions_start_idx ON analytics_sessions(started_at,id);
--> statement-breakpoint
CREATE TABLE analytics_session_keys (
  digest bytea PRIMARY KEY, session_id bigint NOT NULL UNIQUE REFERENCES analytics_sessions(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX analytics_session_keys_expiry_idx ON analytics_session_keys(started_at,digest);
--> statement-breakpoint
CREATE TABLE analytics_session_events (
  session_id bigint NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
  ordinal bigint GENERATED ALWAYS AS IDENTITY, sequence integer NOT NULL, received_at timestamptz NOT NULL, occurred_at timestamptz NOT NULL,
  event_type text NOT NULL, page_type text NOT NULL, locale text NOT NULL, country text NOT NULL,
  device text NOT NULL, source text NOT NULL, vehicle_id uuid, supplier boolean NOT NULL,
  PRIMARY KEY (session_id,sequence,ordinal)
);
--> statement-breakpoint
CREATE INDEX analytics_session_events_expiry_idx ON analytics_session_events(received_at,ordinal);
--> statement-breakpoint
CREATE TABLE analytics_session_vehicles (
  session_id bigint NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL, supplier boolean NOT NULL, detail boolean NOT NULL, contact_after_detail boolean NOT NULL,
  PRIMARY KEY (session_id,vehicle_id,supplier)
);
