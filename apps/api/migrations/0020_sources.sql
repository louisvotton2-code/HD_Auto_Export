-- Original supplier evidence is private. No public route reads these payloads.
CREATE TABLE external_source_blobs (hash text PRIMARY KEY CHECK(hash ~ '^[a-f0-9]{64}$'),payload jsonb NOT NULL,raw_text text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE external_source_documents (
  id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider='chinacarapi'),
  source text NOT NULL CHECK (source IN ('che168','dongchedi')),
  external_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('csv','detail','specs','report','event')),
  locale text NOT NULL CHECK (locale IN ('zh','en','ru','und')),
  hash text NOT NULL REFERENCES external_source_blobs(hash),
  presence text[] NOT NULL,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  source_updated_at timestamptz,
  event_sequence numeric(30,0),
  response_hash text REFERENCES external_source_blobs(hash),
  UNIQUE(provider,source,external_id,kind,locale,hash)
);
CREATE INDEX external_source_documents_history ON external_source_documents(provider,source,external_id,kind,locale,last_observed_at DESC);
CREATE TABLE external_source_responses (
  document_id uuid NOT NULL REFERENCES external_source_documents(id) ON DELETE CASCADE,
  response_hash text NOT NULL REFERENCES external_source_blobs(hash),observed_at timestamptz NOT NULL,
  PRIMARY KEY(document_id,response_hash)
);
CREATE INDEX external_source_responses_blob ON external_source_responses(response_hash);
CREATE TABLE external_source_heads (
  provider text NOT NULL,source text NOT NULL,external_id text NOT NULL,kind text NOT NULL,locale text NOT NULL,
  document_id uuid NOT NULL REFERENCES external_source_documents(id), observed_at timestamptz NOT NULL,merged_payload jsonb NOT NULL,
  PRIMARY KEY(provider,source,external_id,kind,locale)
);
CREATE TABLE external_trim_documents (
  provider text NOT NULL CHECK(provider='chinacarapi'),trim_id text NOT NULL,locale text NOT NULL,
  hash text NOT NULL REFERENCES external_source_blobs(hash),last_observed_at timestamptz NOT NULL,
  PRIMARY KEY(provider,trim_id,locale,hash)
);
CREATE TABLE external_source_segment_sets (
  listing_id uuid NOT NULL REFERENCES external_listings(id),locale text NOT NULL CHECK(locale IN ('zh','en','ru')),
  kind text NOT NULL CHECK(kind IN ('photos','configuration')),revision text NOT NULL CHECK(revision ~ '^[a-f0-9]{64}$'),
  total integer NOT NULL CHECK(total>=0), PRIMARY KEY(listing_id,locale,kind)
);
CREATE TABLE external_source_segments (
  listing_id uuid NOT NULL,locale text NOT NULL,kind text NOT NULL,position integer NOT NULL CHECK(position>=0),data jsonb NOT NULL,
  PRIMARY KEY(listing_id,locale,kind,position),
  FOREIGN KEY(listing_id,locale,kind) REFERENCES external_source_segment_sets(listing_id,locale,kind) ON DELETE CASCADE
);
ALTER TABLE external_media DROP CONSTRAINT external_media_position_check;
ALTER TABLE external_media ADD CONSTRAINT external_media_position_check CHECK(position>=0);

CREATE INDEX external_source_documents_blob ON external_source_documents(hash);
CREATE INDEX external_trim_documents_blob ON external_trim_documents(hash);

CREATE INDEX external_source_documents_response ON external_source_documents(response_hash);
