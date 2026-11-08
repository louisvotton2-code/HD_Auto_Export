-- Initial BE-01/02 installation; no earlier deployed media dataset exists.
-- Do not invent permission evidence for a pre-existing upload.
ALTER TABLE media_assets ADD COLUMN rights jsonb NOT NULL;
