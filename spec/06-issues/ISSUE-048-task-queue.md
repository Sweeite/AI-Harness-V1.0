---
id: ISSUE-048
title: task_queue permanent record + status machine + approval-block + priority
epic: F — harness
status: blocked
github: "#48"
---

# ISSUE-048 — task_queue permanent record + status machine + approval-block + priority

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up `task_queue` as the permanent, never-deleted audit record of every task — with its typed
row schema, a fixed status state machine (including the C6-owned `flagged`/quarantine state),
configurable priority dequeue ordering, an approval-blocking state, and full per-attempt error
history — as the substrate every other C5 execution area writes onto.

## 2. Scope — in / out
**In:** The `task_queue` table and its lifecycle behaviour — the QUE area only:
- The permanent-audit-record invariant (no delete path; survives every retention/cleanup job).
- The full task-record schema (all typed columns) exactly as defined in the schema group, incl.
  the net-new `originating_user_id` and `action_payload` columns owed to this slice.
- The status state machine over the `task_status` enum, including the `flagged` state that C5
  **defines in the schema** but C6 **sets** — kept distinct from `awaiting_approval`; no undefined
  status ever persisted; held tasks retain their completed-step outputs + envelope.
- Priority dequeue ordering (lower number = higher priority), config-tunable.
- The approval-blocking state transition (`requires_approval` → `awaiting_approval`, record
  `approved_by`/`approved_at` on approval), plus the awaiting-approval **staleness escalation**
  (alert + badge, never auto-approve, never silently abandon).
- Full per-attempt error history in `error` (never collapsed to a single last-error).

**Out:**
- **Approval *tier policy* + routing** (which tier, who approves) — C6, owned by **ISSUE-056**.
  This slice only provides the blocking *state + record* the policy drives.
- **Setting** the `flagged` value on a guardrail hit + the flagged-item reviewer workflow — C6,
  owned by **ISSUE-056** (this slice only *defines* the state in the schema/state machine).
- **Triggers** that create rows (four trigger types, freeze gate, at-least-once ingest) — C5 TRG,
  owned by **ISSUE-047**.
- **Task graphs / idempotency / resume** (GRP) — **ISSUE-049**; **context envelope + `task_history`
  originals store** (ENV) — **ISSUE-050**; **Inngest engine, step retry, DLQ, the attempts/next_retry
  projection sync** (JOB) — **ISSUE-052**. This slice defines the `attempts`/`next_retry_at` *columns*
  as the audit projection target but does **not** wire the Inngest sync (OD-058 authority lives in JOB).
- **Alert delivery + dashboard/queue UI + badge rendering** for the staleness escalation — C7,
  owned by **ISSUE-075** / **ISSUE-076** (this slice *emits* the escalation signal at the seam).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-5.QUE.001, FR-5.QUE.002, FR-5.QUE.003, FR-5.QUE.004, FR-5.QUE.005, FR-5.QUE.006
  (all Component 5 — Agent Harness).
- **NFRs:** none named directly (this slice is the audit-record substrate; no-silent-failure /
  never-lose-knowledge posture is carried by the ACs below, tying to the three non-negotiables
  #1/#3).
- **Rests on:** ADR-006 (`service_role` agent/background path — authorization is harness-enforced,
  not RLS), ADR-001 (physical cross-client isolation; `client_slug` is a management-plane concern,
  not an RLS key on this table). Reconciliations: **OD-054** (status enum ↔ `flagged`/quarantine
  state), **OD-058** (Inngest is the single retry/DLQ authority; `attempts`/`next_retry_at` are an
  audit projection), **OD-096 / FR-10.ISO.001** (`client_slug` column deleted from client-side
  tables — it exists only in the management-plane `client_registry`), **OD-028 / OD-032**
  (escalate-don't-auto-act staleness pattern reused by AC-5.QUE.005.2).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-5.QUE.001.1
- AC-5.QUE.002.1
- AC-5.QUE.003.1
- AC-5.QUE.003.2
- AC-5.QUE.004.1
- AC-5.QUE.005.1
- AC-5.QUE.005.2
- AC-5.QUE.006.1
- **Gating spikes (if any):** none. No launch-gating spike (ISSUE-001–006) and no build-time AF
  gates any QUE FR — the C5 feasibility block P (AF-112/113/114/115) attaches to GRP/ENV/LOP/OPT,
  not to QUE. This slice is pure schema + state-machine machinery.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `task_queue` (schema §6, all columns: `id`, `type`, `task_name`, `payload`, `status`,
  `priority`, `requires_approval`, `approved_by`, `approved_at`, `originating_user_id`,
  `action_payload`, `attempts`, `next_retry_at`, `error`, `completed_at`, `created_at`); types
  `task_type` + `task_status` (§Types). **Note:** per OD-096/FR-10.ISO.001 there is **no**
  `client_slug` column on this table — do not add one (it was label-only in the FR prose, then
  deleted in the Phase-4 schema reconciliation).
- **PERM:** none introduced by this slice (the `service_role` background path is authorization-by-
  harness per ADR-006; approval-actor RBAC — no-self-approval via `originating_user_id` — is enforced
  by C6/C1 in ISSUE-056, not here).
- **CFG:** priority scheme (dequeue ordering, config-tunable — FR-5.QUE.004); awaiting-approval
  staleness escalation threshold (FR-5.QUE.005 / AC-5.QUE.005.2). *(Config-key homing is Phase-2
  registry §12 of the schema; this slice consumes the keys, does not define the registry.)*
- **UI:** none built here. The task-queue + approval dashboard and the staleness alert/badge are
  C7 surfaces (ISSUE-075/076); this slice only emits the escalation event at the seam.
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-05-harness.md` — the QUE FR text + all AC-5.QUE.* acceptance
  criteria; the doc-reconciliation notes (#1 `client_slug`, #3 `flagged`) and the QUE seam rows.
- `spec/04-data-model/schema.md` §6 (Execution / Harness — the `task_queue` table) and §Types
  (`task_type`, `task_status` enums); §Global rules (the OD-096/FR-10.ISO.001 `client_slug`
  deletion rule).
- `spec/00-foundations/adr/ADR-006-*.md` — the `service_role` / harness-enforced-authorization path
  this table's background writes run under.
- `spec/00-foundations/adr/ADR-001-*.md` — physical isolation; why `client_slug` is not an RLS key
  (and is deleted client-side).

## 7. Dependencies
- **Blocked-by:** ISSUE-011 (observability skeleton — `event_log` append-only + silent-failure
  detector + alert-engine watchdog; the staleness-escalation signal AC-5.QUE.005.2 emits and the
  no-silent-abandon invariant land on that sink). Not a spike — no AF gate to turn GREEN.
- **Blocks:** ISSUE-049 (task graphs), ISSUE-050 (context envelope), ISSUE-051 (loops),
  ISSUE-053 (run pipeline), ISSUE-056 (approval tiers — sets `flagged`, drives the approval state),
  ISSUE-061 (orchestrator/routing).

## 8. Build order within the slice
1. **Types** — ensure `task_type` and `task_status` enums exist in §Types (both already canonical
   in the schema; `task_status` **must** include `flagged`). If ISSUE-011's baseline migration did
   not create them, create them here as the first migration step.
2. **Migration (schema §6)** — create `task_queue` with the full column set exactly per §6,
   including net-new `originating_user_id` (FK → `profiles`) and `action_payload`. `status` default
   `pending`, `priority` default `100`. Add the CHECK/comment recording that `flagged` is set only by
   C6 and that no `client_slug` column exists (OD-096). No delete path / no cascade that could remove
   a row (FR-5.QUE.001 — permanent audit record).
3. **Status state machine** — implement the allowed transitions over `task_status`
   (`pending → running → awaiting_approval → completed | failed`, plus `flagged` as a C5-defined,
   C6-set state distinct from `awaiting_approval`); reject any write that would persist a null/unknown
   status; a hold into `flagged` must retain the row's completed-step outputs + envelope reference
   (FR-5.QUE.003 / AC-5.QUE.003.2 — coordinates with ISSUE-050's envelope, but the *retention on hold*
   invariant is enforced here).
4. **Priority dequeue** — dequeue ordering by `priority` ascending (lower = higher), with the ordering
   rule sourced from the config priority-scheme key (FR-5.QUE.004).
5. **Approval-block transition** — `requires_approval = true` → `awaiting_approval`, block execution;
   on human approve record `approved_by` + `approved_at` and release; on reject record the outcome and
   do not execute (FR-5.QUE.005). *(Tier/routing is ISSUE-056 — this slice only gates on the flag and
   records the decision.)*
6. **Staleness escalation** — a task in `awaiting_approval` past the configurable threshold emits an
   escalation event to the C7 sink (alert + badge) and stays visibly pending; never auto-approves,
   never drops (AC-5.QUE.005.2, reusing the OD-028/OD-032 pattern). Emit on ISSUE-011's `event_log`.
7. **Error history** — `error` (jsonb) accumulates every attempt's error text across retries; never
   overwrite to a single last-error (FR-5.QUE.006). *(The `attempts`/`next_retry_at` values are the
   OD-058 audit projection written by JOB/ISSUE-052 — this slice provides the columns + the
   append-not-collapse discipline on `error`.)*
8. **Tests to the ACs** — one test per AC-5.QUE.* listed in §4.

## 9. Verification (how DoD is proven)
- Per `spec/05-non-functional/test-strategy.md`: **migration/schema tests** (columns + types present,
  no `client_slug`, no delete path) prove AC-5.QUE.001.1 / AC-5.QUE.002.1; **unit/state-machine tests**
  over the transition table prove AC-5.QUE.003.1/.2 and AC-5.QUE.005.1; **integration tests** against
  ISSUE-011's `event_log` prove the AC-5.QUE.005.2 staleness escalation fires (and never auto-approves);
  ordering test proves AC-5.QUE.004.1; multi-attempt error-accumulation test proves AC-5.QUE.006.1.
- Posture that must hold: the no-silent-failure / never-lose-knowledge invariants (#1/#3) — a held
  (`flagged`) or stale (`awaiting_approval`) task is always in a defined, recorded, surfaced state and
  its work-in-progress is retained; no `task_queue` row is ever deletable. The AC→`Verified` path is
  the per-AC tests above passing green under the QUE FRs in `component-05-harness.md`.
