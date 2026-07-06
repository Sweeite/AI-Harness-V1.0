-- ISSUE-049 (C5 GRP) — proposed ADDITIVE migration (task-graphs).
-- ⚠️ PROPOSED — NOT applied here. The orchestrator integrates this into app/silo/migrations as the next
-- tag AFTER the task_queue tag (0008) and any ISSUE-050 task_history work, applied SERIALLY after the
-- Stage-4 fan-out. It is idempotent (create-or-replace / if-not-exists / guarded) so it composes safely.
--
-- This migration does NOT create task_graph_versions, task_history, OR idempotency_ledger — ALL THREE exist
-- in the 0001 baseline (task_graph_versions L419-429 / task_history L432-439 / idempotency_ledger L350-355,
-- the last net-new for FR-3.CONN.004, write-once-guarded by 0008). It adds only the ADDITIVE deltas ISSUE-049
-- owes:
--   (A) append-only enforcement on task_graph_versions (trigger + REVOKE) — versioned-asset discipline (#1)
--   (B) two additive event_type enum values for the config-error audit writes (§5) — expand-only
-- The idempotency ledger is REUSED, not re-created: task-graph keys ride the existing baseline
-- `idempotency_ledger` under a stable sentinel `connector` ('harness:task-graph'), with the reserved-vs-
-- completed distinction on the `result` column (SQL-NULL = reserved; a jsonb value = completed). See
-- results/proposed-shared-spec.md §2 (verify-present) for the full rationale.
--
-- The three non-negotiables:
--   #1 never lose knowledge — a prior graph version is IMMUTABLE (trigger blocks update/delete); the reused
--                             ledger records a key once (result NULL→value, write-once by 0008) and never
--                             re-fires it.
--   #2 never do what it shouldn't — the idempotency key is committed BEFORE the side effect (reserve), so a
--                             retry/crash-window cannot double-fire (AC-5.GRP.003.2).
--   #3 never fail silently — a graph edit that tries to overwrite a prior version RAISES (loud), never a
--                             silent in-place mutation; a config error is written to event_log under an
--                             admitted event_type (added below), never dropped on an enum-reject.

-- ── (A) task_graph_versions: append-only by version (FR-5.GRP.002 / AC-5.GRP.002.1) ─────────────────────
create or replace function task_graph_versions_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception
    'task_graph_versions is append-only by version — % on an existing version is forbidden; '
    'insert a NEW version instead (FR-5.GRP.002 / change-control)', tg_op;
end $$;

drop trigger if exists trg_task_graph_versions_no_update on task_graph_versions;
create trigger trg_task_graph_versions_no_update
  before update or delete on task_graph_versions
  for each row execute function task_graph_versions_block_mutation();

revoke update, delete on task_graph_versions from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke update, delete on task_graph_versions from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke update, delete on task_graph_versions from anon';
  end if;
end $$;

comment on table task_graph_versions is
  'Versioned task graphs (FR-5.GRP.001/002). APPEND-ONLY by version: an edit inserts a NEW version row '
  '(version = prior+1, previous_version_id = prior.id); prior versions are retained and immutable '
  '(trigger trg_task_graph_versions_no_update). change_reason is mandatory (NOT NULL + app-layer non-empty).';

-- ── (B) event_type enum values for the config-error audit writes (FR-5.GRP.001 / NFR-PERF.007) ───────────
-- The config-error sink (SupabaseConfigErrorSink) INSERTs a graph-less-type / over-limit event onto event_log
-- with one of these two event_type values. Neither is in the baseline enum (0001_baseline.sql L60) nor added
-- by 0007, so a live INSERT would throw `invalid input value for enum event_type` and the loud audit write
-- (AC-5.GRP.001.2 / AC-NFR-PERF.007.1 — a #3 signal) would be LOST. Additive / expand-contract-safe, same
-- change-control class as OD-170 / 0007. (transactional:false when integrated, like 0007 — `alter type ...
-- add value` under autocommit; IF NOT EXISTS makes each idempotent + resumable. No semicolons in comments.)
alter type event_type add value if not exists 'task_graph_missing';
alter type event_type add value if not exists 'task_graph_chain_depth_over_limit';

-- ── idempotency ledger: REUSED, not created ──────────────────────────────────────────────────────────────
-- The baseline `idempotency_ledger` (0001_baseline.sql L350-355: idempotency_key / connector / result /
-- created_at, write-once-guarded by 0008) already provides everything the task-graph key ledger needs. Task-
-- graph keys are inserted under the sentinel connector 'harness:task-graph' with result NULL=reserved; the
-- 0008 write-once trigger permits the single NULL→value fill on complete() and blocks any re-write/delete.
-- NO create-table, NO trigger, NO migration is needed here — see proposed-shared-spec.md §2 (verify-present).
--
-- NOTE (retention): the baseline idempotency_ledger + task_history share the resume/audit retention envelope.
-- Any prune job MUST NOT delete a ledger row while the task chain it belongs to is still resumable (AF-115) —
-- else a resumed step could re-fire a side effect whose key was pruned (#1/#2). Prune posture is owed at the
-- Stage-4 checkpoint alongside the AF-115 retention confirmation.
