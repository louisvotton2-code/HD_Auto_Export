-- Exact facet atoms group correlated attributes such as make, model, trim and
-- generation. Joint distinct counts help PostgreSQL size that aggregate from
-- the observed combinations instead of overestimating independent columns.
CREATE STATISTICS external_catalog_filter_facet_atoms_ndistinct (ndistinct)
 ON make_id,model_id,trim_id,generation_id,powertrain,drivetrain,model_year,(price_cny IS NOT NULL)
 FROM external_catalog_filter;
--> statement-breakpoint
ANALYZE external_catalog_filter;
