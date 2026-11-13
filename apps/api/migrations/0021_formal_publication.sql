ALTER TABLE external_listings ADD COLUMN formal_primary boolean NOT NULL DEFAULT true;
ALTER TABLE external_listings ADD COLUMN formal_canonical_id text;
CREATE UNIQUE INDEX external_formal_canonical_primary ON external_listings(provider,formal_canonical_id)
  WHERE formal_primary AND formal_canonical_id IS NOT NULL;
CREATE TABLE external_canonical_bindings (
 provider text NOT NULL, canonical_id text NOT NULL, source text NOT NULL, external_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider,canonical_id), UNIQUE(provider,source,external_id)
);
