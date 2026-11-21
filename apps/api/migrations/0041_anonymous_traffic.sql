SET LOCAL search_path = public, pg_catalog;
--> statement-breakpoint
CREATE TABLE analytics_document_snapshots (
  hour timestamptz PRIMARY KEY CHECK (hour=date_trunc('hour',hour,'UTC')),
  status text NOT NULL CHECK (status IN ('complete','partial')),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
--> statement-breakpoint
CREATE TABLE analytics_document_hourly (
  hour timestamptz NOT NULL REFERENCES analytics_document_snapshots(hour) ON DELETE CASCADE,
  locale text NOT NULL CHECK (locale IN ('zh','en','ru')),
  page_type text NOT NULL CHECK (page_type IN ('home','catalog','vehicle','calculator','parts','guide','about','other')),
  requests bigint NOT NULL CHECK (requests BETWEEN 0 AND 100000000),
  PRIMARY KEY (hour,locale,page_type)
);
--> statement-breakpoint
CREATE TABLE analytics_contact_collection (
  id smallint PRIMARY KEY CHECK (id=1),
  started_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE analytics_contact_hourly (
  hour timestamptz NOT NULL CHECK (hour=date_trunc('hour',hour,'UTC')),
  vehicle_id uuid NOT NULL,
  supplier boolean NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp','telegram')),
  clicks bigint NOT NULL CHECK (clicks>0),
  PRIMARY KEY (hour,vehicle_id,supplier,channel)
);
