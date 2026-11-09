-- Filter columns stay independent of wide localized/details JSON documents.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE external_catalog
 ADD COLUMN make_id text GENERATED ALWAYS AS (facts->'make'->>'id') STORED,
 ADD COLUMN model_id text GENERATED ALWAYS AS (facts->'model'->>'id') STORED,
 ADD COLUMN trim_id text GENERATED ALWAYS AS (facts->'trim'->>'id') STORED,
 ADD COLUMN generation_id text GENERATED ALWAYS AS (facts->'generation'->>'id') STORED,
 ADD COLUMN powertrain text GENERATED ALWAYS AS (facts->>'powertrain') STORED,
 ADD COLUMN drivetrain text GENERATED ALWAYS AS (facts->>'drivetrain') STORED,
 ADD COLUMN model_year integer GENERATED ALWAYS AS ((facts->>'modelYear')::integer) STORED,
 ADD COLUMN mileage_km integer GENERATED ALWAYS AS ((facts->>'mileageKm')::integer) STORED;
CREATE INDEX external_catalog_make_order_idx ON external_catalog(make_id,model_id,published_at DESC,listing_id);
CREATE INDEX external_catalog_power_order_idx ON external_catalog(powertrain,published_at DESC,listing_id);
CREATE INDEX external_catalog_trim_idx ON external_catalog(make_id,model_id,trim_id);
CREATE INDEX external_catalog_generation_idx ON external_catalog(make_id,model_id,generation_id);
CREATE INDEX external_catalog_drive_idx ON external_catalog(drivetrain);
CREATE INDEX external_catalog_model_year_idx ON external_catalog(model_year);
CREATE INDEX external_catalog_mileage_km_idx ON external_catalog(mileage_km);
CREATE INDEX external_listings_active_idx ON external_listings(id) WHERE upstream_state='active';
--> statement-breakpoint
CREATE TABLE external_catalog_search (
 listing_id uuid NOT NULL REFERENCES external_catalog(listing_id) ON DELETE CASCADE,
 locale text NOT NULL CHECK (locale IN ('zh','en','ru')),
 make_label text,
 model_label text,
 trim_label text,
 generation_label text,
 stock_text text NOT NULL,
 make_text text NOT NULL,
 model_text text NOT NULL,
 title_text text NOT NULL,
 search_document text GENERATED ALWAYS AS (lower(stock_text || E'\n' || make_text || E'\n' || model_text || E'\n' || title_text)) STORED,
 PRIMARY KEY (listing_id,locale)
);
CREATE INDEX external_catalog_search_locale_idx ON external_catalog_search(locale,listing_id);
CREATE INDEX external_catalog_search_trgm_idx ON external_catalog_search USING gin(search_document gin_trgm_ops);
--> statement-breakpoint
CREATE FUNCTION sync_external_catalog_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM external_catalog_search WHERE listing_id=NEW.listing_id AND NOT (NEW.localized ? locale);
 INSERT INTO external_catalog_search(listing_id,locale,make_label,model_label,trim_label,generation_label,stock_text,make_text,model_text,title_text)
 SELECT NEW.listing_id,key,
   coalesce(value->'display'->'make'->>'text',NEW.facts->'make'->>'name'),
   coalesce(value->'display'->'model'->>'text',NEW.facts->'model'->>'name'),
   coalesce(value->'display'->'trim'->>'text',NEW.facts->'trim'->>'name'),
   coalesce(value->'display'->'generation'->>'text',NEW.facts->'generation'->>'name'),
   'EXT-' || upper(NEW.listing_id::text),coalesce(value->'display'->'make'->>'text',''),
   coalesce(value->'display'->'model'->>'text',''),coalesce(value->'title'->>'text','')
 FROM jsonb_each(NEW.localized) WHERE key IN ('zh','en','ru')
 ON CONFLICT(listing_id,locale) DO UPDATE SET make_label=excluded.make_label,model_label=excluded.model_label,
   trim_label=excluded.trim_label,generation_label=excluded.generation_label,stock_text=excluded.stock_text,
   make_text=excluded.make_text,model_text=excluded.model_text,title_text=excluded.title_text;
 RETURN NEW;
END $$;
CREATE TRIGGER external_catalog_search_sync AFTER INSERT OR UPDATE OF facts,localized ON external_catalog
 FOR EACH ROW EXECUTE FUNCTION sync_external_catalog_search();
INSERT INTO external_catalog_search(listing_id,locale,make_label,model_label,trim_label,generation_label,stock_text,make_text,model_text,title_text)
 SELECT c.listing_id,j.key,
   coalesce(j.value->'display'->'make'->>'text',c.facts->'make'->>'name'),
   coalesce(j.value->'display'->'model'->>'text',c.facts->'model'->>'name'),
   coalesce(j.value->'display'->'trim'->>'text',c.facts->'trim'->>'name'),
   coalesce(j.value->'display'->'generation'->>'text',c.facts->'generation'->>'name'),
   'EXT-' || upper(c.listing_id::text),coalesce(j.value->'display'->'make'->>'text',''),
   coalesce(j.value->'display'->'model'->>'text',''),coalesce(j.value->'title'->>'text','')
 FROM external_catalog c CROSS JOIN LATERAL jsonb_each(c.localized) j WHERE j.key IN ('zh','en','ru');
