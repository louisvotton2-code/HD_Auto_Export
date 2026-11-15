-- Formal identities are admitted once. A withdrawal retains the same slot, as
-- do aliases across platforms. Synthetic catalogs have a separate provider.
SELECT pg_advisory_xact_lock(78291332);
LOCK TABLE external_full_members, external_listings IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TABLE external_formal_admissions (
  source text NOT NULL,
  external_id text NOT NULL,
  PRIMARY KEY(source, external_id)
);
INSERT INTO external_formal_admissions(source, external_id)
SELECT platform_id, external_id FROM external_listings
WHERE provider='chinacarapi' AND (upstream_state<>'withdrawn' OR source_data IS NOT NULL OR published_at IS NOT NULL)
UNION
SELECT source, external_id FROM external_full_members WHERE state<>'withdrawn' OR last_detail_at IS NOT NULL;
-- Keep withdrawn placeholders and their ordering evidence without allocating a
-- listing slot. Already synchronized records remain admitted after withdrawal.
WITH tombstones AS (
  SELECT source,external_id,event_order AS business_order,business_at FROM external_full_members WHERE state='withdrawn'
  UNION ALL
  SELECT platform_id,external_id,0,coalesce(source_updated_at,fetched_at) FROM external_listings
    WHERE provider='chinacarapi' AND upstream_state='withdrawn'
), latest AS (
  SELECT DISTINCT ON (source,external_id) t.*
  FROM tombstones t
  WHERE NOT EXISTS (SELECT 1 FROM external_formal_admissions a WHERE a.source=t.source AND a.external_id=t.external_id)
  ORDER BY source,external_id,business_order DESC,business_at DESC
)
INSERT INTO external_ingestion_identity_state(provider,source,external_id,business_order,withdrawn,observed_at,business_at)
SELECT 'chinacarapi',source,external_id,business_order,true,business_at,business_at FROM latest
ON CONFLICT(provider,source,external_id) DO UPDATE SET
 business_order=excluded.business_order,withdrawn=true,observed_at=excluded.observed_at,business_at=excluded.business_at
WHERE external_ingestion_identity_state.business_order<=excluded.business_order
 AND external_ingestion_identity_state.business_at<=excluded.business_at;
CREATE TABLE external_formal_admission_state (
  id integer PRIMARY KEY CHECK(id=1),
  admitted_count bigint NOT NULL CHECK(admitted_count>=0)
);
-- Preserve installations that were already above the new ceiling. They can
-- refresh existing identities and cannot grow.
INSERT INTO external_formal_admission_state SELECT 1, count(*) FROM external_formal_admissions;
--> statement-breakpoint
CREATE FUNCTION reserve_external_formal_listing(listing_source text, listing_id text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM external_formal_admissions WHERE source=listing_source AND external_id=listing_id) THEN
    RETURN true;
  END IF;
  -- Serialize new admissions across CSV reservations, both delta workers and
  -- direct listing/member inserts. Recheck identity after waiting for the lock.
  PERFORM 1 FROM external_formal_admission_state WHERE id=1 FOR UPDATE;
  IF EXISTS (SELECT 1 FROM external_formal_admissions WHERE source=listing_source AND external_id=listing_id) THEN
    RETURN true;
  END IF;
  UPDATE external_formal_admission_state SET admitted_count=admitted_count+1 WHERE id=1 AND admitted_count<100000;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO external_formal_admissions(source, external_id) VALUES(listing_source, listing_id);
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION require_external_formal_reservation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE listing_source text;
BEGIN
  IF TG_TABLE_NAME='external_listings' THEN
    IF NEW.provider<>'chinacarapi' THEN RETURN NEW; END IF;
    listing_source:=NEW.platform_id;
  ELSE
    listing_source:=NEW.source;
  END IF;
  IF NOT reserve_external_formal_listing(listing_source, NEW.external_id) THEN
    RAISE check_violation USING MESSAGE='Formal source listing admission limit reached.',
      CONSTRAINT='external_formal_listing_limit';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER external_listings_require_formal_reservation
BEFORE INSERT OR UPDATE OF provider, platform_id, external_id ON external_listings
FOR EACH ROW EXECUTE FUNCTION require_external_formal_reservation();
CREATE TRIGGER external_full_members_require_formal_reservation
BEFORE INSERT OR UPDATE OF source, external_id ON external_full_members
FOR EACH ROW EXECUTE FUNCTION require_external_formal_reservation();
--> statement-breakpoint
ALTER TABLE external_full_snapshots ADD COLUMN target_rows bigint CHECK(target_rows>=0);
ALTER TABLE external_ingestion_events DROP CONSTRAINT external_ingestion_events_outcome_check;
ALTER TABLE external_ingestion_events ADD CONSTRAINT external_ingestion_events_outcome_check
  CHECK(outcome IN ('applied','obsolete','excluded_limit'));
