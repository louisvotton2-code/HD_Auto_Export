-- Operational protection only. It does not change any stored public projection.
CREATE TABLE backup_gc_leases (
 reference text PRIMARY KEY CHECK(reference ~ '^backup:[A-Za-z0-9:_-]{1,180}$'),
 acquired_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
