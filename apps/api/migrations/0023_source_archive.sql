-- Existing JSON remains readable until bounded archive compaction replaces it with hash-verified gzip.
ALTER TABLE external_source_blobs ALTER COLUMN payload DROP NOT NULL;
ALTER TABLE external_source_blobs ADD COLUMN compressed bytea;
ALTER TABLE external_source_blobs ADD COLUMN raw_exact boolean NOT NULL DEFAULT false;
ALTER TABLE external_source_blobs ADD CONSTRAINT source_blob_content CHECK(payload IS NOT NULL OR compressed IS NOT NULL);
CREATE TABLE external_source_blob_refs (
 hash text NOT NULL REFERENCES external_source_blobs(hash),kind text NOT NULL CHECK(kind IN('pending','backup','audit')),reference text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(hash,kind,reference)
);
CREATE INDEX external_source_blob_refs_owner ON external_source_blob_refs(kind,reference);
CREATE TABLE external_source_document_refs (
 document_id uuid NOT NULL REFERENCES external_source_documents(id),kind text NOT NULL CHECK(kind IN('pending','backup','audit')),reference text NOT NULL,
 PRIMARY KEY(document_id,kind,reference)
);
CREATE INDEX external_source_document_refs_owner ON external_source_document_refs(kind,reference);

CREATE TABLE external_vehicle_extras (
 listing_id uuid NOT NULL REFERENCES external_listings(id),locale text NOT NULL CHECK(locale IN('zh','en','ru')),data jsonb NOT NULL,
 export_status text NOT NULL CHECK(export_status IN('eligible','restricted','unknown')),PRIMARY KEY(listing_id,locale)
);
CREATE INDEX external_vehicle_extras_export ON external_vehicle_extras(locale,export_status,listing_id);
CREATE TABLE external_vehicle_evidence_sets (
 listing_id uuid NOT NULL REFERENCES external_listings(id),locale text NOT NULL CHECK(locale IN('zh','en','ru')),
 kind text NOT NULL CHECK(kind IN('inspection','price-history')),source_revision text NOT NULL,total integer NOT NULL CHECK(total>=0),
 status text NOT NULL CHECK(status IN('available','no_report','unavailable','pending')),PRIMARY KEY(listing_id,locale,kind)
);
CREATE TABLE external_vehicle_evidence (
 listing_id uuid NOT NULL,locale text NOT NULL,kind text NOT NULL,position integer NOT NULL CHECK(position>=0),data jsonb NOT NULL,
 PRIMARY KEY(listing_id,locale,kind,position),FOREIGN KEY(listing_id,locale,kind) REFERENCES external_vehicle_evidence_sets(listing_id,locale,kind) ON DELETE CASCADE
);
-- Existing pending fixed-scope jobs retain their raw response evidence through the transition.
INSERT INTO external_source_blob_refs(hash,kind,reference)
 SELECT DISTINCT b.hash,'pending','legacy-ingestion:'||e.job_id::text||':'||e.seq::text
 FROM external_ingestion_events e CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(coalesce(e.hydrated_document,e.document))='array' THEN coalesce(e.hydrated_document,e.document) ELSE '[]'::jsonb END) d(value)
 JOIN external_source_blobs b ON b.hash=(d.value->'rawResponse'->>'hash') WHERE e.completed_at IS NULL ON CONFLICT DO NOTHING;
-- Staff changes preserve the exact current source evidence; retention never rewrites activity history.
CREATE FUNCTION pin_staff_source_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO external_source_document_refs(document_id,kind,reference)
 SELECT d.id,'audit',NEW.id::text FROM external_listings l JOIN external_source_heads h ON h.provider=l.provider AND h.source=l.platform_id AND h.external_id=l.external_id
 JOIN external_source_documents d ON d.id=h.document_id WHERE l.id=NEW.listing_id ON CONFLICT DO NOTHING;
 INSERT INTO external_source_blob_refs(hash,kind,reference)
 SELECT DISTINCT b.hash,'audit',NEW.id::text FROM external_listings l JOIN external_source_heads h ON h.provider=l.provider AND h.source=l.platform_id AND h.external_id=l.external_id
 JOIN external_source_documents d ON d.id=h.document_id JOIN external_source_blobs b ON b.hash=d.hash OR b.hash=d.response_hash
 WHERE l.id=NEW.listing_id ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER external_override_source_evidence AFTER INSERT ON external_override_events FOR EACH ROW EXECUTE FUNCTION pin_staff_source_evidence();
INSERT INTO external_source_document_refs(document_id,kind,reference)
 SELECT d.id,'audit',e.id::text FROM external_override_events e JOIN external_listings l ON l.id=e.listing_id
 JOIN external_source_documents d ON d.provider=l.provider AND d.source=l.platform_id AND d.external_id=l.external_id ON CONFLICT DO NOTHING;
-- Historical audit payloads are immutable: conservatively retain their still-existing source evidence.
INSERT INTO external_source_blob_refs(hash,kind,reference)
 SELECT DISTINCT b.hash,'audit',e.id::text FROM external_override_events e JOIN external_listings l ON l.id=e.listing_id
 JOIN external_source_documents d ON d.provider=l.provider AND d.source=l.platform_id AND d.external_id=l.external_id
 JOIN external_source_blobs b ON b.hash=d.hash OR b.hash=d.response_hash ON CONFLICT DO NOTHING;
CREATE FUNCTION version_public_source_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE listing uuid;
BEGIN
 IF current_setting('hd.public_catalog_pending',true)=pg_current_xact_id()::text THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
 listing:=CASE WHEN TG_OP='DELETE' THEN OLD.listing_id ELSE NEW.listing_id END;
 IF EXISTS(SELECT 1 FROM public.external_catalog c JOIN public.external_listings l ON l.id=c.listing_id WHERE c.listing_id=listing AND l.upstream_state='active') THEN PERFORM public.queue_public_catalog_change(); END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER external_extras_public_version AFTER INSERT OR UPDATE OR DELETE ON external_vehicle_extras FOR EACH ROW EXECUTE FUNCTION version_public_source_evidence();
CREATE TRIGGER external_evidence_public_version AFTER INSERT OR UPDATE OR DELETE ON external_vehicle_evidence_sets FOR EACH ROW EXECUTE FUNCTION version_public_source_evidence();
-- Persistent primary-key sweep avoids rescanning retained/pinned prefixes on every tick.
CREATE TABLE external_source_maintenance (
 id integer PRIMARY KEY CHECK(id=1),phase text NOT NULL DEFAULT 'documents' CHECK(phase IN('documents','responses','trims','blobs')),
 cursor jsonb NOT NULL DEFAULT '{}',due_at timestamptz NOT NULL DEFAULT now(),rounds bigint NOT NULL DEFAULT 0,
 scanned bigint NOT NULL DEFAULT 0,deleted bigint NOT NULL DEFAULT 0,compressed bigint NOT NULL DEFAULT 0,
 last_completed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO external_source_maintenance(id) VALUES(1);
CREATE INDEX external_source_heads_document ON external_source_heads(document_id);
CREATE INDEX external_source_documents_version_order ON external_source_documents(provider,source,external_id,kind,locale,last_observed_at DESC,id DESC);
CREATE INDEX external_source_responses_version_order ON external_source_responses(document_id,observed_at DESC,response_hash DESC);
CREATE INDEX external_trim_documents_version_order ON external_trim_documents(provider,trim_id,locale,last_observed_at DESC,hash DESC);
