# ISSUE-049 (task-graphs) — proposed shared-spec deltas

> **Proposal only.** Per the fan-out hard prohibitions, this slice does NOT edit any shared file
> (schema.md, config-registry.md, PERMISSION_NODES.md, migrations, `_journal.json`, or another
> `app/*` package). Everything below is DESCRIBED precisely for the orchestrator to apply serially
> after the fan-out. Items marked **verify-present** already exist in the baseline and need no change.

---

## 1. `task_graph_versions` — additive append-only enforcement (DB delta)

**verify-present (no create):** the table already exists in `app/silo/migrations/0001_baseline.sql`
(L419–429) with the exact columns this slice authors against: `id, task_type_name, version, steps
jsonb, change_reason (NOT NULL), previous_version_id (self-ref), created_at, created_by,
unique(task_type_name, version)`. **Do NOT re-create it.**

**PROPOSED additive delta — append-only trigger + REVOKE (versioned-asset discipline, #1).**
The baseline enforces `change_reason NOT NULL` and `unique(task_type_name, version)`, but nothing yet
stops an in-place `UPDATE`/`DELETE` of a *prior* version row. Change-control
(`standards/change-control.md`) + FR-5.GRP.002 require prior versions to be **retained and never
overwritten**. Add, in a new migration tag under `app/silo/migrations`:

```sql
-- Append-only by version: a task_graph_versions row is immutable once written. A graph EDIT inserts
-- a NEW version row (version = prior+1, previous_version_id = prior.id); prior rows are never mutated
-- or deleted (FR-5.GRP.002 / AC-5.GRP.002.1 / #1). This is the DB backstop to the app-layer gate in
-- app/task-graphs (InMemoryGraphStore / SupabaseGraphStore.putVersion).
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

-- belt to the trigger's suspenders: no role may DELETE/UPDATE prior versions.
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
```

*(service_role bypasses grants, so the trigger — not the REVOKE — is the real correctness boundary;
the REVOKE is the belt to that suspenders, matching the ISSUE-048 task_queue posture.)*

**RLS:** graph edits are Super-Admin/Admin via the config-store change-control path (§5 PERM: "none
net-new"), same posture as the other versioned assets (prompt versions, execution_plans). If the
silo's RLS baseline gates writes to versioned-asset tables by an admin predicate, add
`task_graph_versions` to that same policy set; **no net-new PERM node** is introduced by this slice.

---

## 2. `idempotency_ledger` — verify-present (REUSE the baseline table; NO net-new table, NO migration)

This slice needs a durable, unique-keyed ledger so a step's idempotency key can be **committed no
later than the side effect** (AC-5.GRP.003.2) and a retry of a completed step is a no-op
(AC-5.GRP.003.1). ADR-004 §4 specifies "a **unique constraint** on that key makes a retried step a
no-op insert (`ON CONFLICT DO NOTHING`)".

**verify-present (no create):** the baseline **already defines** `idempotency_ledger` in
`app/silo/migrations/0001_baseline.sql` **L350-355** (net-new for FR-3.CONN.004), with columns
`idempotency_key text primary key, connector text not null, result jsonb, created_at timestamptz`,
and a **write-once immutability trigger** from `0008_connector_runtime_triggers.sql`
(`result` fills SQL-NULL → value exactly once; `idempotency_key`/`connector`/`created_at` immutable;
no DELETE). **The task-graph key ledger REUSES this exact table** — it does **not** create a second
one. (The earlier draft of this doc falsely claimed "the baseline has no standalone ledger table";
that was wrong — the baseline L350 already defines it. A `create table if not exists` in this slice's
migration would have been silently skipped on a live silo, leaving the baseline shape, and the live
adapter would then throw on the absent `key`/`completed`/`output`/`reserved_at`/`completed_at`
columns. Corrected: the slice adapts to the baseline shape and adds no ledger DDL.)

Task-graph idempotency maps onto the baseline shape via a **stable sentinel `connector`**
(`LEDGER_CONNECTOR = 'harness:task-graph'`, satisfying `connector NOT NULL` and never colliding with a
real connector's own FR-3.CONN.004 intent rows), with the reserved-vs-completed distinction riding the
`result` column:

```sql
-- reserve(key)  = insert into idempotency_ledger (idempotency_key, connector, result)
--                 values ($key, 'harness:task-graph', null)
--                 on conflict (idempotency_key) do nothing      -- commit key BEFORE the side effect
--   → result SQL-NULL = reserved-but-not-yet-complete (the crash window; a durable in-flight marker).
-- complete(key) = update idempotency_ledger set result = $output::jsonb
--                 where idempotency_key = $key and result is null   -- write-once NULL→value (0008 permits)
-- get(key)      = select ..., (result is not null) as completed, result   -- result not null ⇒ completed.
```

This preserves the full crash-window semantics (reserve-before-side-effect; a reserved-but-null row =
in-flight) **without** the `reserved_at`/`completed_at` columns the earlier draft assumed: `created_at`
is the reservation instant, and **no §4 AC requires a persisted completion timestamp** (resume keys on
completed-vs-not, never on the *when*). A step that legitimately returns a null output stays
distinguishable from a merely-reserved row because a completed row holds the **jsonb `null` token**
(non-SQL-NULL), not SQL-NULL — `result is not null` is true for `'null'::jsonb`.

**Sensitivity / retention:** the baseline ledger holds a hash key + a step output snapshot; it is
intra-silo, carries **no `client_slug`** (physical isolation, ADR-001 §3 / OD-096), and its retention
must outlive the longest task chain + the audit window — the same retention envelope as `task_history`
(see AF-115 below). The port (`IdempotencyLedger`) is agnostic to the physical table; the live adapter
is now pinned to the baseline shape.

> **No DESIGN FORK arose.** The baseline shape fully expresses task-graph resume semantics (reserve →
> complete, crash-window in-flight marker, dedup by unique key). No §4 AC requires distinguishing a
> `reserved_at` from a `completed_at` as separate persisted timestamps, so no new table / OD is needed.
> Were such a requirement to surface later, it would be a Rule-0 architectural fork logged as an OD —
> not decided here.

---

## 3. `task_history` — read-only here (verify-present)

**verify-present (no change):** baseline L432–439 — `id, task_id (fk task_queue on delete cascade),
step_index, full_output jsonb, created_at, unique(task_id, step_index)`. This slice READS it on
resume (`HistoryStore.getOutput/listOutputs`) to reuse the preserved outputs of completed steps
(AC-5.GRP.004.1). **Writes are owned by ISSUE-050 (C5 ENV)** — this slice never writes it in
production (the in-memory `put()` exists only to seed the reference model for a resume test). No delta.

**PINNED CROSS-ISSUE CONTRACT (step_index ordering seam — ISSUE-050 / ISSUE-052 MUST honour this).**
`GraphExecutor.execute()` reads `task_history.getOutput(taskId, idx)` where **`idx` is the RESOLVED
TOPOLOGICAL-order index** produced by `resolveDependencyOrder`, **not** the graph's `steps[]` array
position. Therefore **the `step_index` that ISSUE-050 (originals write) and ISSUE-052 (Inngest run
driver) persist to `task_history` MUST be that same resolved topological-order index** — they must
order steps via `resolveDependencyOrder` and index by that order. For a strict linear chain array
order and topo order coincide, but for a genuine DAG whose array order ≠ topo order they **diverge**,
and a mismatch would make resume reuse the **wrong step's output — a #1 corruption**. This is a
documented seam, pinned in a code comment at the read site in `app/task-graphs/src/store.ts`
(`GraphExecutor.execute`) and guarded offline by the *"resume indexes task_history by resolved topo
order, not array order"* test in `task-graphs.test.ts`. ISSUE-050/052 must not silently write
array-order indices.

---

## 4. `chain_depth_limit` — config key (CFG)

**Proposed config-registry entry** (§5 CFG): `chain_depth_limit` — **default 6**, **int ≥ 1**,
**class LIVE**. Semantics per NFR-PERF.007: the maximum orchestration chain depth; a graph resolving
to more steps than the limit is **rejected or trimmed-with-logged-outcome at build, never silently
truncated mid-run** (AC-NFR-PERF.007.1 / AC-8.PLAN.003.1). The enforcement point is **shared with
ISSUE-064 (FR-8.PLAN.003, plan-build)**; this slice honours it as a graph property at resolve time
(`GraphExecutor.resolveGraph`). If ISSUE-064 already registers `chain_depth_limit`, mark this
**verify-present** — it is one key, one default, read by both slices.

An UNSET key must read as the documented default (6), **not** 0 — a missing ceiling must never read
as "depth 0 / reject everything" nor "unbounded" (#3). The reference model defaults it in
`DEFAULT_GRAPH_CONFIG`.

---

## 5. `event_log` event types — config-error / over-limit signals (verify/extend)

The graph-less-type and chain-depth-over-limit config errors are RECORDED (never swallowed, #3) via
the `ConfigErrorSink`, whose live adapter INSERTs onto **`event_log`** (ISSUE-011 owns the table).
Two `event_type` values are used: `task_graph_missing` and `task_graph_chain_depth_over_limit`.

**CONFIRMED: `event_type` IS a constrained enum** (`0001_baseline.sql` L60, additively expanded by
`0007_stage3_event_types.sql`), and **neither of these two values is a member yet** — so a live INSERT
of either would throw `invalid input value for enum event_type`, and the loud config-error audit write
required by **AC-5.GRP.001.2 / AC-NFR-PERF.007.1** (a #3 signal) would be **lost**. This slice does not
own `event_log` and authors no migration for it; the two values must be **added by the orchestrator's
migration 0011** (same additive / expand-contract-safe class as OD-170 and 0007, `transactional:false`):

```sql
alter type event_type add value if not exists 'task_graph_missing';
alter type event_type add value if not exists 'task_graph_chain_depth_over_limit';
```

Durable offline guard: the in-memory `EnumCheckingConfigErrorSink` + `eventTypeForKind()` (single
source of truth in `store.ts`) now **reject any event_type not in the admitted set**, so a test fails
offline if a non-admitted value is ever written — this drift can no longer hide behind the
never-instantiated live adapter. The live `SupabaseConfigErrorSink` resolves the same
`eventTypeForKind()`, so the offline mirror and the live INSERT can never diverge.

---

## 6. Residual AFs (owed to live — NOT provable offline)

- **AF-112 (LOAD/EVAL)** — crash-window key-before-side-effect ordering *at scale* + catch-up/overlap
  dedup under a missed-run backlog. **Offline-proven here:** the crash-window unit test
  (AC-5.GRP.003.2 — key committed before the side effect survives a simulated crash; retry does not
  double-fire) and the collision-resistance property sweep (AC-5.GRP.003.3 — 500 distinct keys, 0
  collisions; boundary domain-separation). **Owed to live:** that the ordering + dedup hold under a
  real orchestrator crash and real concurrent catch-up load. Reaches POSTURE offline; full VERIFIED
  needs the LOAD/EVAL spike at the Stage-4 checkpoint.
- **AF-115 (DOCS/SPIKE)** — the durable originals store (`task_history` / Inngest cloud step-state)
  retains uncompressed outputs longer than the longest chain + audit window. **Offline-proven here:**
  the resume path reads originals from a durable `HistoryStore` (not a cache) and reconstructs
  completed-step outputs (AC-5.GRP.004.1). **Owed to live:** confirming `task_history`/Inngest
  retention actually outlives the envelope; if Inngest cloud step-state has a shorter TTL, resume
  MUST read the C5-owned `task_history` (which this slice already does) — so the fail-safe is already
  the durable table, not the engine cache.
- **AF-063 (DOCS/SPIKE)** — Inngest per-key concurrency serialises same-entity steps (backs ADR-004
  §2). Not exercised by this slice's offline tests (it governs the JOB execution engine, ISSUE-052);
  noted as the same-entity serialisation assumption resume relies on. Owed to ISSUE-052's live spike.
- **AF-018 (🟢 VERIFIED)** — Inngest step-level retry/idempotency/onFailure. Carry-in, already verified;
  this slice's resume contract is the harness-side shape ISSUE-052 realises on top of it.

## 7. What this slice does NOT add

- No create-table for `task_graph_versions` / `task_history` (baseline; verify-present).
- No new PERM node (graph edits ride the existing versioned-asset admin path).
- No `client_slug` on any table (physical isolation, ADR-001 / OD-096).
- No edit to any `app/*` sibling — `@harness/task-queue` is consumed read-only for its `TaskType`.
