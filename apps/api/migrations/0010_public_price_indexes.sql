-- Guard the numeric expression so malformed historical JSON cannot abort the migration.
-- Public price range queries use this exact expression; no conversion runs on the indexed column.
CREATE INDEX vehicle_publications_currency_amount_idx ON vehicle_publications (
 (data->'price'->'money'->>'currency'),
 (CASE WHEN data->'price'->'money'->>'amount' ~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,2})?$'
  THEN (data->'price'->'money'->>'amount')::numeric END)
);
CREATE INDEX vehicles_current_publication_idx ON vehicles(published_revision_id)
 WHERE deleted_at IS NULL AND publication_state='published';
