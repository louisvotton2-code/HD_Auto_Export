CREATE TABLE staff (
 id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, email_verified boolean NOT NULL DEFAULT false,
 image text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 role text NOT NULL DEFAULT 'editor' CHECK(role IN ('admin','editor')), banned boolean NOT NULL DEFAULT false,
 ban_reason text, ban_expires timestamptz
);
CREATE TABLE staff_sessions (
 id text PRIMARY KEY, expires_at timestamptz NOT NULL, token text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 ip_address text, user_agent text, user_id text NOT NULL REFERENCES staff(id) ON DELETE CASCADE, impersonated_by text
);
CREATE INDEX staff_sessions_user_idx ON staff_sessions(user_id);
CREATE TABLE staff_accounts (
 id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
 access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
 scope text, password text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider_id,account_id)
);
CREATE INDEX staff_accounts_user_idx ON staff_accounts(user_id);
CREATE TABLE staff_verifications (
 id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_verifications_identifier_idx ON staff_verifications(identifier);
CREATE SEQUENCE vehicle_stock_number;
CREATE TABLE vehicles (
 id uuid PRIMARY KEY, stock_number bigint NOT NULL UNIQUE DEFAULT nextval('vehicle_stock_number'),
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 publication_state text NOT NULL DEFAULT 'draft' CHECK(publication_state IN ('draft','published','archived')),
 availability text NOT NULL DEFAULT 'unknown' CHECK(availability IN ('available','reserved','sold','unknown')),
 availability_checked_at timestamptz, published_revision_id uuid, published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((availability IN ('available','reserved','sold') AND availability_checked_at IS NOT NULL) OR availability = 'unknown')
);
CREATE TABLE vehicle_drafts (vehicle_id uuid PRIMARY KEY REFERENCES vehicles(id), data jsonb NOT NULL);
CREATE TABLE vehicle_publications (
 id uuid PRIMARY KEY, vehicle_id uuid NOT NULL REFERENCES vehicles(id), data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(vehicle_id,id)
);
ALTER TABLE vehicles ADD CONSTRAINT vehicles_publication_fk FOREIGN KEY(id,published_revision_id) REFERENCES vehicle_publications(vehicle_id,id);
CREATE FUNCTION reject_publication_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Published snapshots are immutable'; END $$;
CREATE TRIGGER publications_immutable BEFORE UPDATE OR DELETE ON vehicle_publications FOR EACH ROW EXECUTE FUNCTION reject_publication_change();
CREATE INDEX vehicles_public_idx ON vehicles(published_at DESC,id) WHERE publication_state='published';
CREATE TABLE media_assets (
 id uuid PRIMARY KEY, vehicle_id uuid NOT NULL REFERENCES vehicles(id), version integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','uploaded','ready','failed','deleted')),
 content_type text NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp')),
 width integer, height integer, byte_size integer, expected_size integer NOT NULL CHECK(expected_size BETWEEN 1 AND 10485760), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(version > 0)
);
CREATE INDEX media_assets_vehicle_idx ON media_assets(vehicle_id);
CREATE TABLE publication_media (
 publication_id uuid NOT NULL REFERENCES vehicle_publications(id), media_id uuid NOT NULL REFERENCES media_assets(id),
 PRIMARY KEY(publication_id,media_id)
);
CREATE INDEX publication_media_asset_idx ON publication_media(media_id);
CREATE TABLE home_config (id integer PRIMARY KEY CHECK(id=1), version integer NOT NULL DEFAULT 1, sections jsonb NOT NULL);
INSERT INTO home_config(id,sections) VALUES(1,'[{"id":"featured","title":{"zh":"精选车源","en":"Featured vehicles","ru":"Избранные автомобили"},"vehicleIds":[]},{"id":"recent","title":{"zh":"最新车源","en":"Latest vehicles","ru":"Новые поступления"},"vehicleIds":[]}]');
CREATE TABLE audit_events (
 id uuid PRIMARY KEY, actor_id text NOT NULL REFERENCES staff(id), operation text NOT NULL, vehicle_id uuid REFERENCES vehicles(id),
 old_version integer, new_version integer, request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_vehicle_idx ON audit_events(vehicle_id,created_at DESC);
CREATE TABLE idempotency_keys (
 actor_id text NOT NULL REFERENCES staff(id), operation text NOT NULL, key text NOT NULL, request_hash text NOT NULL,
 response jsonb NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY(actor_id,operation,key)
);
