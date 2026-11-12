CREATE TABLE translation_budget_state (
 id integer PRIMARY KEY CHECK (id=1),
 last_reserved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO translation_budget_state(id) VALUES(1);
CREATE TABLE translation_budget_reservations (
 id uuid PRIMARY KEY,
 characters integer NOT NULL CHECK (characters BETWEEN 1 AND 10000),
 reserved_at timestamptz NOT NULL
);
CREATE INDEX translation_budget_reservations_time ON translation_budget_reservations(reserved_at);

-- Stop the old writer before migration. Legacy segments had no durable quota ledger:
-- reserve their maximum size for one hour rather than granting a restart reset.
-- Cache hits may be conservatively overcounted; no historical receipt is rewritten.
INSERT INTO translation_budget_reservations(id,characters,reserved_at)
 SELECT gen_random_uuid(),5000,clock_timestamp() FROM translation_plan_segments
 WHERE updated_at>clock_timestamp()-interval '1 hour'
   AND (failure_code IS NULL OR failure_code NOT IN ('budget_exceeded','not_attempted'));
