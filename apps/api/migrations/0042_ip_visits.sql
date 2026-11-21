SET LOCAL search_path = public, pg_catalog;
--> statement-breakpoint
CREATE TABLE analytics_ip_visit_keys (
  digest bytea PRIMARY KEY CHECK (octet_length(digest) = 32),
  accepted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at = accepted_at + interval '62 minutes')
);
--> statement-breakpoint
CREATE INDEX analytics_ip_visit_keys_expires_idx ON analytics_ip_visit_keys(expires_at);
--> statement-breakpoint
CREATE TABLE analytics_ip_visit_hourly (
  hour timestamptz PRIMARY KEY CHECK (hour = date_trunc('hour', hour, 'Asia/Shanghai')),
  visits bigint NOT NULL CHECK (visits > 0)
);
--> statement-breakpoint
CREATE TABLE analytics_ip_visit_coverage (
  hour timestamptz PRIMARY KEY CHECK (hour = date_trunc('hour', hour, 'Asia/Shanghai')),
  status text NOT NULL CHECK (status IN ('complete', 'partial'))
);
