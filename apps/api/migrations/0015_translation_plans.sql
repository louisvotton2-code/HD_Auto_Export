-- Employee-confirmed translation only; these tables never publish or edit drafts.
CREATE TABLE translation_plans (
 id uuid PRIMARY KEY,
 vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
 actor_id text NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
 plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
 source_input jsonb NOT NULL CHECK (jsonb_typeof(source_input) = 'object'),
 state text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready','running','interrupted','finished')),
 generation_key text CHECK (length(generation_key) BETWEEN 1 AND 200),
 request_hash text CHECK (request_hash ~ '^[0-9a-f]{64}$'),
 run_token uuid,
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 started_at timestamptz,
 lease_until timestamptz,
 finished_at timestamptz,
 result jsonb,
 CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
 CHECK ((state = 'ready') = (generation_key IS NULL)),
 CHECK ((generation_key IS NULL) = (request_hash IS NULL)),
 CHECK ((generation_key IS NULL) = (run_token IS NULL)),
 CHECK ((generation_key IS NULL) = (started_at IS NULL)),
 CHECK ((started_at IS NULL) = (lease_until IS NULL)),
 CHECK (lease_until > started_at AND lease_until <= started_at + interval '150 seconds'),
 CHECK ((state = 'finished') = (result IS NOT NULL)),
 CHECK ((state = 'finished') = (finished_at IS NOT NULL))
);
CREATE INDEX translation_plans_owner ON translation_plans(actor_id, vehicle_id, created_at);

CREATE TABLE translation_plan_segments (
 plan_id uuid NOT NULL REFERENCES translation_plans(id) ON DELETE CASCADE,
 field_ref text NOT NULL CHECK (length(field_ref) BETWEEN 1 AND 512),
 target_locale text NOT NULL CHECK (target_locale IN ('en','ru')),
 segment_index integer NOT NULL CHECK (segment_index BETWEEN 0 AND 10),
 cache_key text NOT NULL CHECK (cache_key ~ '^[0-9a-f]{64}$'),
 cache_valid boolean NOT NULL DEFAULT true,
 state text NOT NULL CHECK (state IN ('running','succeeded','failed','outcome_unknown')),
 translated_text text,
 failure_code text CHECK (failure_code IN ('upstream_failed','outcome_unknown','budget_exceeded','invalid_result','not_attempted')),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (plan_id, field_ref, target_locale, segment_index),
 CHECK ((state = 'succeeded') = (translated_text IS NOT NULL)),
 CHECK (translated_text IS NULL OR length(translated_text) BETWEEN 1 AND 10000),
 CHECK ((state IN ('failed','outcome_unknown')) = (failure_code IS NOT NULL)),
 CHECK (state <> 'outcome_unknown' OR failure_code = 'outcome_unknown')
);
CREATE INDEX translation_plan_segments_success_cache
 ON translation_plan_segments(cache_key, updated_at DESC) WHERE state = 'succeeded' AND cache_valid;

-- Writers lock staff -> vehicle -> plan -> segment. No transaction remains open
-- during provider work. A persisted running segment has an uncertain outcome
-- after interruption and is never automatically sent again for the same plan.
