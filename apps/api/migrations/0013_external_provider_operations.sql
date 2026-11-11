-- Keep management search independent of the public projection, which excludes
-- hidden and withdrawn records. Search only identity and title/model fields.
SET LOCAL statement_timeout = '10min';
--> statement-breakpoint
CREATE FUNCTION external_listing_admin_source_terms(listing_id uuid, external_id text, source jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
 SELECT ARRAY[
  'ext-'||listing_id::text, external_id, source->>'listingUrl',
  source#>>'{facts,model,name}',
  source#>>'{copy,title,original,text}', source#>>'{copy,title,translations,zh,text}',
  source#>>'{copy,title,translations,en,text}', source#>>'{copy,title,translations,ru,text}',
  source#>>'{copy,model,original,text}', source#>>'{copy,model,translations,zh,text}',
  source#>>'{copy,model,translations,en,text}', source#>>'{copy,model,translations,ru,text}'
 ]
$$;

CREATE FUNCTION external_listing_admin_override_terms(overrides jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
 SELECT ARRAY[overrides#>>'{facts,model,name}'] || ARRAY(
  SELECT entry->>'text' FROM jsonb_array_elements(
   CASE WHEN jsonb_typeof(overrides->'text')='array' THEN overrides->'text' ELSE '[]'::jsonb END
  ) AS edits(entry)
  WHERE entry->>'field' IN ('title','model')
 )
$$;

CREATE FUNCTION external_listing_admin_search_document(terms text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT lower(array_to_string(terms, E'\n'))
$$;

CREATE INDEX external_listings_admin_source_trgm_idx ON external_listings USING gin (
 external_listing_admin_search_document(external_listing_admin_source_terms(id,external_id,source_data)) gin_trgm_ops
);
CREATE INDEX external_listing_overrides_admin_trgm_idx ON external_listing_overrides USING gin (
 external_listing_admin_search_document(external_listing_admin_override_terms(data)) gin_trgm_ops
);

CREATE INDEX external_listings_admin_order_idx ON external_listings(fetched_at DESC,id);
CREATE INDEX external_listings_admin_platform_order_idx ON external_listings(platform_id,fetched_at DESC,id);
CREATE INDEX external_listings_provider_fetched_idx ON external_listings(provider,fetched_at DESC);
CREATE INDEX external_listings_provider_source_updated_idx ON external_listings(provider,source_updated_at DESC NULLS LAST);
CREATE INDEX external_import_batches_provider_imported_idx ON external_import_batches(provider,imported_at DESC,id);
--> statement-breakpoint
ALTER TABLE external_listing_overrides ADD COLUMN text_source_identities jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
-- Recover each saved text's make/model binding from the current or a previously
-- applied archived source. The existing hash commits to this exact JSON array.
WITH edited AS (
 SELECT o.listing_id, item.entry->>'field' AS field, item.entry->>'sourceHash' AS source_hash
 FROM external_listing_overrides o
 CROSS JOIN LATERAL jsonb_array_elements(o.data->'text') AS item(entry)
), sources AS (
 SELECT l.id AS listing_id, l.source_data AS source FROM external_listings l
 WHERE EXISTS(SELECT 1 FROM edited e WHERE e.listing_id=l.id)
 UNION ALL
 SELECT r.listing_id, r.candidate FROM external_import_records r
 WHERE r.status='applied' AND r.operation='upsert'
   AND EXISTS(SELECT 1 FROM edited e WHERE e.listing_id=r.listing_id)
), matched AS (
 SELECT DISTINCT e.listing_id,e.source_hash,jsonb_build_array(
   s.source#>>'{facts,make,id}',s.source#>>'{facts,model,id}'
 ) AS identity
 FROM edited e JOIN sources s ON s.listing_id=e.listing_id
 CROSS JOIN LATERAL (SELECT s.source->'copy'->e.field->'original' AS value) original
 WHERE jsonb_typeof(original.value)='object'
   AND e.source_hash=encode(sha256(convert_to(
     '[[' || to_jsonb(s.source->>'platformId')::text || ',' || to_jsonb(s.source->>'externalId')::text || ','
     || coalesce(to_jsonb(s.source#>>'{facts,make,id}')::text,'null') || ','
     || coalesce(to_jsonb(s.source#>>'{facts,model,id}')::text,'null') || '],'
     || to_jsonb(e.field)::text || ',{"contentLocale":' || to_jsonb(original.value->>'contentLocale')::text
     || ',"text":' || to_jsonb(original.value->>'text')::text || '}]', 'UTF8')), 'hex')
), bindings AS (
 SELECT listing_id,jsonb_object_agg(source_hash,identity) AS identities FROM matched GROUP BY listing_id
)
UPDATE external_listing_overrides o SET text_source_identities=o.text_source_identities || b.identities
FROM bindings b WHERE b.listing_id=o.listing_id AND o.text_source_identities IS DISTINCT FROM o.text_source_identities || b.identities;
--> statement-breakpoint
-- Apply saved staff text to older public projections where that source field
-- still passes the existing publication checks. The projection's original
-- fields already represent those checks, including disputes and unsafe text.
WITH applicable AS (
 SELECT c.listing_id, entry->>'locale' AS locale,
   jsonb_object_agg(entry->>'field',entry->>'text') AS edits
 FROM external_listing_overrides o
 JOIN external_catalog c ON c.listing_id=o.listing_id
 JOIN external_listings l ON l.id=c.listing_id AND l.upstream_state='active'
 CROSS JOIN LATERAL jsonb_array_elements(o.data->'text') AS item(entry)
 WHERE (o.data->'hidden') IS DISTINCT FROM 'true'::jsonb
   AND jsonb_typeof(c.details->'original'->(entry->>'field'))='object'
   AND o.text_source_identities->(entry->>'sourceHash')=jsonb_build_array(
     l.source_data#>>'{facts,make,id}',l.source_data#>>'{facts,model,id}')
 GROUP BY c.listing_id,entry->>'locale'
), projections AS (
 SELECT c.listing_id, jsonb_object_agg(language.locale, language.data
   || CASE WHEN a.edits ? 'title' THEN jsonb_build_object('title',jsonb_build_object(
       'text',a.edits->'title','contentLocale',language.locale,'requestedLocale',language.locale,'kind','human','reviewed',false)) ELSE '{}'::jsonb END
   || CASE WHEN a.edits ? 'description' THEN jsonb_build_object('description',jsonb_build_object(
       'text',a.edits->'description','contentLocale',language.locale,'requestedLocale',language.locale,'kind','human','reviewed',false)) ELSE '{}'::jsonb END
   || CASE WHEN a.edits ? 'model' THEN jsonb_build_object('display',(language.data->'display') || jsonb_build_object('model',jsonb_build_object(
       'text',a.edits->'model','contentLocale',language.locale,'requestedLocale',language.locale,'status','ready','provenance','human','reviewed',false))) ELSE '{}'::jsonb END
 ) AS localized
 FROM (SELECT DISTINCT listing_id FROM applicable) changed
 JOIN external_catalog c ON c.listing_id=changed.listing_id
 CROSS JOIN LATERAL jsonb_each(c.localized) AS language(locale,data)
 LEFT JOIN applicable a ON a.listing_id=c.listing_id AND a.locale=language.locale
 GROUP BY c.listing_id
), updated AS (
 UPDATE external_catalog c SET localized=p.localized
 FROM projections p
 WHERE c.listing_id=p.listing_id AND c.localized IS DISTINCT FROM p.localized
 RETURNING c.listing_id
)
UPDATE external_catalog_state SET revision=revision+1
WHERE id=1 AND EXISTS(SELECT 1 FROM updated);
