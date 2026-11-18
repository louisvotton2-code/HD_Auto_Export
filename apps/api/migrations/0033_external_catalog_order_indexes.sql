-- Match the public scalar sort order, including missing values and UUID ties.
-- Ordinary reads remain available during index creation. Fail if a writer
-- prevents acquisition so the release can retry within its migration window.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
--> statement-breakpoint
CREATE INDEX external_catalog_filter_locale_count_idx ON external_catalog_filter(locale_mask)
 WHERE active AND locale_mask<>0;
--> statement-breakpoint
CREATE INDEX external_catalog_filter_price_asc_order_idx ON external_catalog_filter(price_cny ASC NULLS LAST,listing_id)
 INCLUDE (locale_mask) WHERE active AND locale_mask<>0;
--> statement-breakpoint
CREATE INDEX external_catalog_filter_price_desc_order_idx ON external_catalog_filter(price_cny DESC NULLS LAST,listing_id)
 INCLUDE (locale_mask) WHERE active AND locale_mask<>0;
--> statement-breakpoint
CREATE INDEX external_catalog_filter_mileage_order_idx ON external_catalog_filter(mileage_km ASC NULLS LAST,listing_id)
 INCLUDE (locale_mask) WHERE active AND locale_mask<>0;
--> statement-breakpoint
CREATE INDEX external_catalog_filter_year_order_idx ON external_catalog_filter(model_year DESC NULLS LAST,listing_id)
 INCLUDE (locale_mask) WHERE active AND locale_mask<>0;
--> statement-breakpoint
ANALYZE external_catalog_filter;
