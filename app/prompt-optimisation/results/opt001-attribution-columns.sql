-- ISSUE-046 (C4 OPT) — PROPOSAL, not a migration this slice ships.
-- ================================================================================================
-- FR-4.OPT.001 version-to-outcome attribution requires that the prompt version(s) in force at a task's
-- assembly be captured against that task's completed outcome. C4 owns *what must be captured and that the
-- identity is never lost*; the actual persistence lands in C5 (ISSUE-053, FR-5.ASM.002 pin point +
-- FR-5.ASM.009 completion dual-record), keyed to task_queue(id). This slice therefore ships NO migration
-- (per the issue's MIGRATION: NO migration directive) — it proposes the attribution shape here for the
-- orchestrator / C5 to fold into a C5-owned migration.
--
-- The reference model (src/store.ts InMemoryPromptOptimisationStore) and the live adapter
-- (src/supabase-store.ts) are authored to THIS proposed shape so the seam is real and typechecks.
-- One row per (task, resolved slot) so distinct versions never conflate and the version-bucketed roll-up
-- (outcomesByVersion) is a plain GROUP BY.
-- ================================================================================================

-- One row per (task, prompt slot in force at assembly). Captured ONCE, at assembly (FR-4.STO.006 / OD-050);
-- immutable thereafter (the version identity is never lost — #1). Belongs in a C5-owned migration keyed to
-- task_queue(id).
create table if not exists prompt_version_attribution (
  task_id     uuid    not null,                              -- → task_queue(id) (C5, ISSUE-053)
  slot        text    not null check (slot in ('core','business','memory','task')),
  version_id  uuid    not null references prompt_layers(id), -- the stable identity (ISSUE-042 §5)
  version     int     not null check (version >= 1),         -- prompt_layers.version at assembly
  captured_at timestamptz not null default now(),
  primary key (task_id, slot)                                -- captured once per slot; a re-capture violates this
);

-- Query rejects any UPDATE/DELETE via a C5 append-only trigger (mirrors the config_audit_log posture) so a
-- captured attribution can never be silently overwritten — the version-in-force is tamper-evident (#1/#3).
-- (Trigger authored in the C5 migration, alongside the outcome-record path.)

-- The version-bucketed roll-up the AF-111 EVAL + C7 version-performance dashboards read joins to C5's
-- outcome record (task_queue.status/completed_at + C7 event_log, or a dedicated task_outcome view). The
-- adapter's outcomesByVersion() is authored to a `task_outcome(task_id, outcome, cost)` join shape — C5
-- owns whether that is a table or a view over task_queue/event_log.
