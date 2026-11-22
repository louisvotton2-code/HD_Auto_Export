CREATE TABLE public.media_content_versions (
 media_id uuid PRIMARY KEY REFERENCES public.media_assets(id) ON DELETE CASCADE,
 original_sha256 text NOT NULL CHECK (original_sha256 ~ '^[0-9a-f]{64}$'),
 thumb_sha256 text NOT NULL CHECK (thumb_sha256 ~ '^[0-9a-f]{64}$'),
 card_sha256 text NOT NULL CHECK (card_sha256 ~ '^[0-9a-f]{64}$')
);
