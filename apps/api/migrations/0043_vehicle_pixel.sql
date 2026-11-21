CREATE TABLE vehicle_pixel_settings (
  vehicle_id uuid PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  pixel_enabled boolean NOT NULL,
  version integer NOT NULL CHECK (version >= 2)
);
--> statement-breakpoint
CREATE TABLE external_listing_pixel_settings (
  listing_id uuid PRIMARY KEY REFERENCES external_listings(id) ON DELETE CASCADE,
  pixel_enabled boolean NOT NULL,
  version integer NOT NULL CHECK (version >= 2)
);
