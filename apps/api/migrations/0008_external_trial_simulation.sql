CREATE TABLE external_translation_simulation_results (
 trial_id uuid NOT NULL,
 call_key text NOT NULL,
 attempt_id uuid NOT NULL,
 result text NOT NULL CHECK (length(result) BETWEEN 1 AND 2100),
 finished_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(trial_id,call_key),
 FOREIGN KEY(trial_id,call_key) REFERENCES external_translation_work(trial_id,call_key),
 FOREIGN KEY(trial_id,attempt_id) REFERENCES external_translation_reservations(trial_id,attempt_id)
);
