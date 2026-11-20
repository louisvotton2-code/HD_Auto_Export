CREATE OR REPLACE FUNCTION sync_external_catalog_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  -- Publication upserts may set both columns again even when only the price changed.
  IF ROW(OLD.listing_id,OLD.facts,OLD.localized) IS NOT DISTINCT FROM ROW(NEW.listing_id,NEW.facts,NEW.localized) THEN
   RETURN NEW;
  END IF;
 END IF;
 DELETE FROM external_catalog_search WHERE listing_id=NEW.listing_id AND NOT (NEW.localized ? locale);
 INSERT INTO external_catalog_search AS current_search(listing_id,locale,make_label,model_label,trim_label,generation_label,stock_text,make_text,model_text,title_text)
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
   make_text=excluded.make_text,model_text=excluded.model_text,title_text=excluded.title_text
 WHERE ROW(current_search.make_label,current_search.model_label,current_search.trim_label,current_search.generation_label,
           current_search.stock_text,current_search.make_text,current_search.model_text,current_search.title_text)
    IS DISTINCT FROM ROW(excluded.make_label,excluded.model_label,excluded.trim_label,excluded.generation_label,
                        excluded.stock_text,excluded.make_text,excluded.model_text,excluded.title_text);
 RETURN NEW;
END $$;
