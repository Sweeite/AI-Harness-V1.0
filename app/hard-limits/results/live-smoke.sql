-- ============================================================================
-- app/hard-limits — LIVE-ADAPTER SMOKE (ISSUE-055, R10 hygiene sweep)
-- ----------------------------------------------------------------------------
-- Proves the REAL write paths of src/supabase-store.ts (SupabaseHardLimitGate)
-- against the live silo DDL (guardrail_log, migration head 0025), replaying:
--
--   1. enforce()  -> INSERT guardrail_log (task_id, guardrail_type='hard_limit',
--                    description, action_blocked=true, status='pending')
--                    RETURNING id            [supabase-store.ts L69-75]
--   2. setStatus() -> the pending->rejected forward transition UPDATE
--                    (status=$2, reviewed_at=now())  [supabase-store.ts L110-115]
--                    — must SURVIVE the enforce_audit_append_only() trigger
--                      branch (a) (0015 / live).
--   3. the NO-OVERRIDE guard: a hard_limit row can NEVER become 'approved'.
--                    The DB table CHECK guardrail_log_check
--                    ( not (guardrail_type='hard_limit' and status='approved') )
--                    is the backstop the adapter relies on [supabase-store.ts
--                    L96-107, comment L2-6]. Proven to REJECT here.
--   4. Enum admittance: 'hard_limit' (guardrail_type) + 'pending'/'rejected'
--                    (guardrail_status) are real enum members.
--
-- CONNECTS AS: postgres (rolbypassrls=t) via SILO_DB_URL — RLS is BYPASSED on
--   this path (OD-193; adapter comments say service_role but the pool is the
--   owner). This smoke therefore does NOT assert RLS visibility; it asserts the
--   trigger + CHECK + enum + column contract, which bind regardless of role.
--
-- SAFETY: single txn, ROLLBACK at end — nothing persists. task_id is left NULL
--   (nullable FK to task_queue) so no parent row is needed. reviewed_by is not
--   written by the adapter, so no profiles parent row is needed either.
--   DO NOT RUN inline — the orchestrator runs live writes serially.
-- ============================================================================

BEGIN;

-- ── 1. enforce(): the real INSERT path ──────────────────────────────────────
WITH ins AS (
  INSERT INTO guardrail_log (task_id, guardrail_type, description, action_blocked, status)
  VALUES (NULL, 'hard_limit', 'SMOKE: comms-send blocked (hard limit no.1)', true, 'pending')
  RETURNING id, guardrail_type, status, action_blocked, description
)
SELECT id AS smoke_row_id FROM ins \gset

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM guardrail_log WHERE id = :'smoke_row_id';
  IF r.id IS NULL THEN RAISE EXCEPTION 'enforce INSERT: row not found after insert'; END IF;
  IF r.guardrail_type <> 'hard_limit'  THEN RAISE EXCEPTION 'enforce INSERT: guardrail_type=% (want hard_limit)', r.guardrail_type; END IF;
  IF r.status         <> 'pending'     THEN RAISE EXCEPTION 'enforce INSERT: status=% (want pending)', r.status; END IF;
  IF r.action_blocked <> true          THEN RAISE EXCEPTION 'enforce INSERT: action_blocked=% (want true)', r.action_blocked; END IF;
  IF r.created_at IS NULL              THEN RAISE EXCEPTION 'enforce INSERT: created_at not defaulted'; END IF;
  RAISE NOTICE 'PASS 1: enforce() INSERT landed hard_limit/pending/blocked row %', r.id;
END $$;

-- ── 2. setStatus(pending->rejected): the forward-transition UPDATE ───────────
--     Mirrors L110-115 exactly (status=$2, reviewed_at=now()). Must pass the
--     append-only trigger branch (a): old.status='pending', new.status in
--     (approved,rejected,modified), description + task_id unchanged.
UPDATE guardrail_log SET status = 'rejected', reviewed_at = now()
WHERE id = :'smoke_row_id';

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM guardrail_log WHERE id = :'smoke_row_id';
  IF r.status <> 'rejected'   THEN RAISE EXCEPTION 'setStatus: status=% (want rejected)', r.status; END IF;
  IF r.reviewed_at IS NULL    THEN RAISE EXCEPTION 'setStatus: reviewed_at not stamped'; END IF;
  RAISE NOTICE 'PASS 2: setStatus() pending->rejected survived append-only trigger; reviewed_at stamped';
END $$;

-- ── 3. NO-OVERRIDE: a hard_limit row can NEVER be approved (the DB CHECK) ────
--     The adapter refuses this in app code (L105-106); this proves the DB
--     backstop CHECK guardrail_log_check rejects it even if app code were
--     bypassed. We insert a fresh pending hard_limit row and try to approve it.
DO $$
DECLARE new_id uuid; ok boolean := false;
BEGIN
  INSERT INTO guardrail_log (task_id, guardrail_type, description, action_blocked, status)
  VALUES (NULL, 'hard_limit', 'SMOKE: no-override backstop probe', true, 'pending')
  RETURNING id INTO new_id;
  BEGIN
    UPDATE guardrail_log SET status = 'approved', reviewed_at = now() WHERE id = new_id;
  EXCEPTION WHEN check_violation THEN
    ok := true;  -- the table CHECK rejected the approve (expected)
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'NO-OVERRIDE FAIL: a hard_limit row was allowed to reach status=approved (#2 breach)';
  END IF;
  RAISE NOTICE 'PASS 3: DB CHECK rejected hard_limit -> approved (no-override backstop holds)';
END $$;

-- ── 4. Enum membership sanity (the literals the adapter emits) ───────────────
DO $$
BEGIN
  PERFORM 'hard_limit'::guardrail_type;
  PERFORM 'pending'::guardrail_status;
  PERFORM 'rejected'::guardrail_status;
  PERFORM 'approved'::guardrail_status;
  RAISE NOTICE 'PASS 4: all adapter enum literals are admitted';
END $$;

-- Nothing persists.
ROLLBACK;
