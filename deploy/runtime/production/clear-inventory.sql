-- Executed only by the approved release maintenance procedure against its newly restored logical DB.
-- psql variables are validated again here; never run against hd_auto or a serving database.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT set_config('hd.release_target_database', :'target_database', true);
SELECT set_config('hd.release_main_sha', :'main_sha', true);
SELECT set_config('hd.release_expected_ledger', :'expected_ledger', true);
SELECT pg_advisory_xact_lock(78290303);
DO $$
DECLARE actual text;
BEGIN
 IF current_database() !~ '^hd_release_[a-f0-9]{12,40}$'
    OR current_database() IS DISTINCT FROM current_setting('hd.release_target_database',true)
    OR coalesce(current_setting('hd.release_main_sha',true),'') !~ '^[a-f0-9]{40}$' THEN
  RAISE EXCEPTION 'A new explicitly approved release database is required';
 END IF;
 SELECT string_agg(hash,',' ORDER BY id) INTO actual FROM drizzle.__drizzle_migrations;
 IF actual IS DISTINCT FROM current_setting('hd.release_expected_ledger',true)
    OR cardinality(string_to_array(coalesce(actual,''),','))<18 THEN
  RAISE EXCEPTION 'The exact reviewed migration ledger must be applied first';
 END IF;
 IF EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend') THEN
  RAISE EXCEPTION 'New release database still has clients';
 END IF;
 -- This initial release comes from legacy schema4. Never erase paid plans or imported histories.
 IF EXISTS(SELECT FROM translation_plans) OR EXISTS(SELECT FROM translation_plan_segments)
    OR EXISTS(SELECT FROM external_listings) OR EXISTS(SELECT FROM external_import_batches) THEN
  RAISE EXCEPTION 'Nonempty billing/import histories require a separately reviewed inventory reset';
 END IF;
 IF EXISTS(SELECT FROM home_config WHERE jsonb_typeof(sections)<>'array') THEN
  RAISE EXCEPTION 'Unexpected home configuration shape';
 END IF;
END $$;

CREATE SCHEMA hd_release_archive AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA hd_release_archive FROM PUBLIC;
CREATE TABLE hd_release_archive.inventory_reset (
 main_sha text NOT NULL, database_name text NOT NULL, reset_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 previous_vehicles bigint NOT NULL, previous_media bigint NOT NULL
);
CREATE TABLE hd_release_archive.audit_vehicle_links AS
 SELECT id AS audit_id,vehicle_id FROM public.audit_events WHERE vehicle_id IS NOT NULL;
ALTER TABLE hd_release_archive.audit_vehicle_links ADD PRIMARY KEY(audit_id);
INSERT INTO hd_release_archive.inventory_reset(main_sha,database_name,previous_vehicles,previous_media)
 SELECT current_setting('hd.release_main_sha'),current_database(),(SELECT count(*) FROM vehicles),(SELECT count(*) FROM media_assets);

-- Preserve every table outside this explicit non-financial inventory/display set.
CREATE TEMP TABLE kept_table_fingerprints(name text PRIMARY KEY,digest text,rows bigint) ON COMMIT DROP;
DO $$
DECLARE item record; fingerprint text; n bigint;
BEGIN
 FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN
  ('vehicles','vehicle_drafts','vehicle_publications','vehicle_localizations','publication_localizations',
   'media_assets','publication_media','publication_preview_confirmations','home_config','audit_events',
   'public_catalog_state','public_catalog_pending') ORDER BY tablename LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')),count(*) FROM public.%I t',item.tablename) INTO fingerprint,n;
  INSERT INTO kept_table_fingerprints VALUES(item.tablename,fingerprint,n);
 END LOOP;
END $$;
CREATE TEMP TABLE kept_audit AS SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-'vehicle_id' ORDER BY id)::text,'[]')) AS digest,count(*) AS rows FROM audit_events t;
CREATE TEMP TABLE kept_home AS SELECT id,(SELECT coalesce(jsonb_agg(value-'vehicleIds' ORDER BY ordinality),'[]') FROM jsonb_array_elements(sections) WITH ORDINALITY) AS skeleton FROM home_config;

-- Only named immutable-snapshot guards are suspended, inside this one transaction.
-- Public-version triggers stay enabled; no TRUNCATE/CASCADE touches fees, auth or audit.
ALTER TABLE vehicle_publications DISABLE TRIGGER publications_immutable;
ALTER TABLE publication_localizations DISABLE TRIGGER publication_localizations_immutable;
LOCK TABLE home_config IN ACCESS EXCLUSIVE MODE;
UPDATE home_config SET sections=(SELECT coalesce(jsonb_agg(value||jsonb_build_object('vehicleIds','[]'::jsonb) ORDER BY ordinality),'[]') FROM jsonb_array_elements(sections) WITH ORDINALITY),version=version+1;
UPDATE vehicles SET published_revision_id=NULL,publication_state='archived',published_at=NULL;
DELETE FROM publication_preview_confirmations;
DELETE FROM publication_media;
DELETE FROM publication_localizations;
DELETE FROM vehicle_publications;
DELETE FROM vehicle_localizations;
DELETE FROM vehicle_drafts;
DELETE FROM media_assets;
UPDATE audit_events SET vehicle_id=NULL WHERE vehicle_id IS NOT NULL;
DELETE FROM vehicles;
ALTER TABLE vehicle_publications ENABLE TRIGGER publications_immutable;
ALTER TABLE publication_localizations ENABLE TRIGGER publication_localizations_immutable;
UPDATE public_catalog_state SET epoch=gen_random_uuid(),revision=revision+1 WHERE id=1;

DO $$
DECLARE item record; fingerprint text; n bigint; audit_digest text; audit_rows bigint;
BEGIN
 FOR item IN SELECT * FROM kept_table_fingerprints LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')),count(*) FROM public.%I t',item.name) INTO fingerprint,n;
  IF fingerprint IS DISTINCT FROM item.digest OR n<>item.rows THEN RAISE EXCEPTION 'Retained table changed: %',item.name;END IF;
 END LOOP;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-'vehicle_id' ORDER BY id)::text,'[]')),count(*) INTO audit_digest,audit_rows FROM audit_events t;
 IF NOT EXISTS(SELECT FROM kept_audit WHERE digest=audit_digest AND rows=audit_rows) THEN RAISE EXCEPTION 'Audit history changed';END IF;
 IF EXISTS(SELECT FROM kept_home k FULL JOIN home_config h USING(id) WHERE k.id IS NULL OR h.id IS NULL OR k.skeleton IS DISTINCT FROM (SELECT coalesce(jsonb_agg(value-'vehicleIds' ORDER BY ordinality),'[]') FROM jsonb_array_elements(h.sections) WITH ORDINALITY)) THEN RAISE EXCEPTION 'Home configuration changed beyond vehicle references';END IF;
 IF EXISTS(SELECT FROM vehicles) OR EXISTS(SELECT FROM media_assets) OR EXISTS(SELECT FROM vehicle_publications)
    OR EXISTS(SELECT FROM home_config h,jsonb_array_elements(h.sections) section WHERE section->'vehicleIds'<>'[]'::jsonb) THEN
  RAISE EXCEPTION 'Inventory/display reset did not reach empty';
 END IF;
END $$;
COMMIT;
