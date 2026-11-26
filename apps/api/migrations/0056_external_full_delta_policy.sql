-- Opt-in supplier policy. An empty table preserves both existing worker modes.
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='8s';
CREATE TABLE public.external_full_delta_policy (
  id integer PRIMARY KEY CHECK (id=1),
  phase text NOT NULL CHECK (phase IN ('draining','ready','delta','recovery','blocked')),
  snapshot_id uuid REFERENCES public.external_full_snapshots(id),
  retained_snapshot_id uuid REFERENCES public.external_full_snapshots(id),
  high_water numeric(30,0) CHECK (high_water>=0),
  last_terminal_cursor numeric(30,0) CHECK (last_terminal_cursor>=0),
  last_terminal_at timestamptz,
  audit_cursor bigint NOT NULL DEFAULT 0 CHECK (audit_cursor>=0),
  event_audit_cursor numeric(30,0) NOT NULL DEFAULT 0 CHECK (event_audit_cursor>=0),
  audit_missing bigint NOT NULL DEFAULT 0 CHECK (audit_missing>=0),
  audit_capacity_excluded bigint NOT NULL DEFAULT 0 CHECK (audit_capacity_excluded>=0),
  cursor_invalid boolean NOT NULL DEFAULT false,
  reason text CHECK (reason IN ('cursor_expired','confirmed_gap','audit_gap','recovery_limit')),
  recovery_since_at timestamptz,
  next_recovery_at timestamptz NOT NULL DEFAULT '-infinity',
  recovery_anchor_cursor numeric(30,0) CHECK (recovery_anchor_cursor>=0),
  recovery_previous_cursor numeric(30,0) CHECK (recovery_previous_cursor>=0),
  recovery_pending_receive boolean NOT NULL DEFAULT false,
  recovery_attempts smallint NOT NULL DEFAULT 0 CHECK (recovery_attempts BETWEEN 0 AND 12),
  requested_by text NOT NULL,
  evidence text CHECK (evidence ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transitioned_at timestamptz,
  CHECK (snapshot_id IS NOT NULL OR phase IN ('recovery','blocked')),
  CHECK ((last_terminal_cursor IS NULL)=(last_terminal_at IS NULL)),
  CHECK (phase NOT IN ('ready','delta') OR (high_water IS NOT NULL AND event_audit_cursor=high_water AND
    audit_missing=0 AND NOT cursor_invalid)),
  CHECK (phase<>'delta' OR transitioned_at IS NOT NULL),
  CHECK (NOT recovery_pending_receive OR (recovery_since_at IS NOT NULL AND
    recovery_anchor_cursor IS NOT NULL AND recovery_previous_cursor IS NOT NULL AND
    recovery_anchor_cursor<=recovery_previous_cursor))
);
