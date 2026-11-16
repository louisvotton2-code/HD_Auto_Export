-- v1.0.4 strictly parses localization JSON and replaces it on save.
-- Keep the new facts in nullable columns outside the legacy payload.
ALTER TABLE vehicle_localizations ADD COLUMN verified_technical jsonb;
--> statement-breakpoint
ALTER TABLE publication_localizations ADD COLUMN verified_technical jsonb;
--> statement-breakpoint
CREATE FUNCTION capture_publication_technical_facts() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  SELECT l.verified_technical INTO NEW.verified_technical
  FROM vehicle_publications p JOIN vehicle_localizations l USING(vehicle_id)
  WHERE p.id = NEW.publication_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Both API versions insert the publication under the vehicle lock. Capture the
-- draft facts in that transaction so a rollback publication retains its own snapshot.
CREATE TRIGGER capture_publication_technical_facts
BEFORE INSERT ON publication_localizations
FOR EACH ROW EXECUTE FUNCTION capture_publication_technical_facts();
