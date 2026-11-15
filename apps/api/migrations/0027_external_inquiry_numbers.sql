-- Backfill existing listings during the table rewrite. The owned identity sequence
-- assigns future numbers inside PostgreSQL, including unrestricted import writers.
ALTER TABLE external_listings
 ADD COLUMN inquiry_number bigint GENERATED ALWAYS AS IDENTITY,
 ADD CONSTRAINT external_listings_inquiry_number_unique UNIQUE (inquiry_number);
--> statement-breakpoint
-- Legacy <platform>-<external id> lookup also covers non-numeric and older sources.
CREATE INDEX external_listings_legacy_inquiry_code_idx
 ON external_listings (lower(platform_id || '-' || external_id));
