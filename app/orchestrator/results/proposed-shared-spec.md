# ISSUE-061 (orchestrator) — proposed shared-spec deltas

The orchestrator slice authored its port + fakes + live adapter + tests against the **existing baseline DDL**
(`app/silo/migrations/0001_baseline.sql`). Below are the additive, serially-applied deltas it depends on. The
in-worktree fakes are the proven reference model; each delta is what the live path additionally needs. Nothing
here creates a table that already exists — all are **verify-present** or **additive** items.

## A. Tables — VERIFY-PRESENT (already in baseline; this slice does NOT re-create them)
- **`agents`** (0001_baseline.sql L358) — present with the exact §9 shape this slice targets: `description text
  NOT NULL`, `memory_scope jsonb NOT NULL`, `tools_allowed uuid[] NOT NULL default '{}'`, `enabled boolean NOT
  NULL default true`, `version int NOT NULL default 1`, `previous_version_id uuid references agents(id)` (self-FK),
  `change_reason text NOT NULL`, and **no `system_prompt` / no `model` / no `client_slug`** column
  (AC-8.REG.001.1/.3, OD-075/ADR-001 §3). The `check` gate (`npm run check`) asserts all of this against the
  migration corpus. **No action needed.**
- **`execution_plans`** (0001_baseline.sql L442) — present: `plan_body jsonb NOT NULL`, `previous_version_id
  uuid references execution_plans(id)` (version chain), `unique (task_type_name, version)`. **CO-OWNED with
  ISSUE-064 (Stage 5)** per the issue's §5 blast radius: created by whichever of {061,064} lands first via the
  shared migration — it is already in the baseline, so both slices treat it as present. 061 writes plan
  *versions* (ORC.007); **064 owns `plan_body`'s step / per-step `failure_mode` / deps / parallel structure and
  the outcome model.** No schema change is proposed by 061; flagging the co-ownership so 064 does not duplicate.
- **`prompt_layers`** (0001_baseline.sql L375) — present with `agent_id uuid references agents(id)` and
  `check (layer <> 'core' or agent_id is not null)`. This slice READS Layer-1 by `agent_id`/`layer='core'`
  (REG.002 / ORC.008.1); the store itself is ISSUE-042. **No action needed.**
- **`event_log`** (0001_baseline.sql L483) — present; `summary text NOT NULL`. The routing observability sink.
  **No action needed.**
- **`task_queue`** (0001_baseline.sql L399) — present. Read at step 1; the awaiting-clarification status is set
  via C5's status machine. See item C below on the status enum.

## B. Agent-domain routing key — ADDITIVE DELTA NEEDED (decide with ISSUE-063/064)
The `candidates(domain?)` read (ORC.003) and the sole-agent-for-domain warning (REG.005.3) need a **per-agent
domain** discriminator. The baseline `agents` table has **no `domain` column**. Options, for the orchestrator
(serial-apply) or the schema owner to pick:
- **(preferred) store the domain inside `memory_scope` jsonb** as a reserved key (the live adapter already writes
  `memory_scope->>'__domain'` and filters on it — see `supabase-store.ts`). **No DDL change**; purely a seed +
  read convention. This is the lowest-risk path and keeps the slice inside its isolation boundary.
- **(alternative) add `agents.domain text`** (nullable; CHECK against the 8-domain enum) via an additive migration.
  Cleaner for indexing/routing at scale but is a schema.md + migration change **outside this slice's write
  boundary** — must be authored by the schema owner if chosen. If taken, add:
  `alter table agents add column domain text;` + a `check (domain in ('client','campaign','comms','ops','finance',
  'insight','research','memory'))` and a partial index `create index on agents(domain) where enabled;`.
Recommend the jsonb-key path unless ISSUE-063 (which reads `memory_scope`) or 064 wants a first-class column.

## C. `task_queue.status` awaiting-clarification state — VERIFY / ADDITIVE (owned by C5/ISSUE-048)
ORC.006 sets the task to an **awaiting-clarification** state (OD-077). The C5 `task_status` enum (ISSUE-048,
`schema.md §6`) currently enumerates `pending|running|awaiting_approval|completed|failed|flagged`. Confirm whether
awaiting-clarification reuses `awaiting_approval` semantics or needs a **distinct `awaiting_clarification` enum
value**. This is a **C5-owned** enum (not this slice's to alter). If a distinct value is wanted, C5 adds it via
`alter type task_status add value 'awaiting_clarification';` — flag for ISSUE-048/050 reconciliation. The
orchestrator fake models it as a distinct status; the live `QueueGate` adapter must map to whatever C5 lands.

## D. `agents` append-only-by-version enforcement — ADDITIVE DELTA NEEDED (mirrors 0004 for prompt_layers)
REG.004 requires the version chain be **append-only** (never UPDATE/DELETE a prior version; #1). The live adapter
only ever INSERTs (never UPDATEs `agents`), but defense-in-depth wants a DB-level guard mirroring
`0004_prompt_version_discipline.sql` (which does exactly this for `prompt_layers`). Proposed additive migration
(schema owner to place, e.g. `00NN_agents_version_discipline.sql`):
- a `BEFORE UPDATE OR DELETE ON agents` trigger that **rejects** in-place mutation of a versioned row (raise), and
- an RLS policy on `agents` composing on the 0002 default-deny floor, gating writes to the **OD-080 authority
  split** — `PERM-agents.edit_capability` (Super Admin only) for `memory_scope`/`tools_allowed`/`enabled`;
  `PERM-agents.edit_description` (SA + Admin) for `description`/`max_tokens`. Every helper/auth call must be
  `(select fn(…))`-wrapped (AF-067 initplan discipline), exactly as the 0004 lint checks. **App-side the gate is
  already enforced** (`registry.ts` / `supabase-store.ts` via the injected `PermChecker` + denial audit); this
  migration is the belt-and-suspenders DB floor for the `service_role` bypass path (M5 note in FR-8.ORC.008).

## E. One-time `system_prompt` fold migration — VERIFY-PRESENT / N/A here (REG.002 / OD-048/075)
FR-8.REG.002 calls for a one-time migration folding any residual `agents.system_prompt` into `prompt_layers`
then dropping the column. **The baseline `agents` table already has NO `system_prompt` column** (verified by the
`check` gate), so in this build there is **nothing to fold** — the single-source-of-truth end state already holds.
No migration is owed unless a prior silo carried the legacy column (greenfield: N/A).

## F. PERM nodes — VERIFY-PRESENT (already catalogued; this slice does NOT mint)
`PERM-agents.view` / `PERM-agents.edit_description` / `PERM-agents.edit_capability` are already in
`PERMISSION_NODES.md` (Asset Management family, OD-137, minted 2026-07-01). This slice consumes them via the
injected `PermChecker`. **No action needed.**

## G. Config keys — VERIFY-PRESENT (config-registry.md §K)
`orchestrator_confidence_threshold` (0.75, LIVE), `chain_depth_limit` (6, LIVE), `routing_weights` (object, sum
= 1.0; domain_match 0.35 / complexity_fit 0.25 / memory_scope_fit 0.20 / tool_scope_fit 0.20),
`parallel_execution_enabled` (false, BOOT), `clarification_escalation` (24h, LIVE) — all present in §K. The engine
reads them fresh each `route()` so a change takes effect next task (ORC.004.2). **No action needed.**

---
### Residual AFs (owed to live / EVAL — NOT proven by these offline ACs)
- **AF-121** — description-driven routing *accuracy* (ORC.001–004). Offline proves the weighting + recording +
  candidate-read *contract* deterministically; the live routing is a Sonnet call whose accuracy is EVAL-class.
- **AF-122** — confidence *calibration* (ORC.006): that the 0.75 threshold meaningfully separates good/bad routing.
  Offline proves the threshold *gate* (below ⇒ clarification, never auto-proceed); calibration is EVAL-class.
- **AF-126** — outcome tracking measurably *improves* routing (ORC.007). Offline proves the outcome-record +
  secondary-sink *contract*; the improvement claim is EVAL-class, owed to a live outcome-feedback eval.
