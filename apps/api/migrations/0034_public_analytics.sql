CREATE TABLE analytics_event_receipts (
  event_id uuid PRIMARY KEY,
  received_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX analytics_event_receipts_expiry_idx ON analytics_event_receipts(received_at, event_id);
--> statement-breakpoint
CREATE TABLE analytics_collection_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  started_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE analytics_daily (
  day date PRIMARY KEY,
  page_views bigint NOT NULL CHECK (page_views >= 0),
  detail_views bigint NOT NULL CHECK (detail_views >= 0),
  vehicle_clicks bigint NOT NULL CHECK (vehicle_clicks >= 0),
  contact_clicks bigint NOT NULL CHECK (contact_clicks >= 0)
);
--> statement-breakpoint
CREATE TABLE analytics_vehicle_daily (
  day date NOT NULL,
  vehicle_id uuid NOT NULL,
  supplier boolean NOT NULL,
  detail_views bigint NOT NULL CHECK (detail_views >= 0),
  vehicle_clicks bigint NOT NULL CHECK (vehicle_clicks >= 0),
  contact_clicks bigint NOT NULL CHECK (contact_clicks >= 0),
  PRIMARY KEY (day, vehicle_id, supplier)
);
