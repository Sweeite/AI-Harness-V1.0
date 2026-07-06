# ISSUE-035 (write-tools) — proposed shared-spec deltas

**Summary: NONE.** This slice authors no schema migration, no config key, and no schema.md doc change.
It reads existing tables and composes two sibling packages + an injected C6 queue seam. All shared
objects it relies on already exist in `app/silo/migrations/0001_baseline.sql`. Items below are
**verify-present** assertions only — nothing to apply.

## DB — verify-present (no delta owed)
- **`tools` table** — read `category`, `risk_level`, `requires_approval` to drive the write path + gate
  decision. Present: `0001_baseline.sql` L304–320 (`category tool_category`, `risk_level text`,
  `requires_approval boolean not null default false`). Owned by ISSUE-032. **No new table.**
- **`guardrail_log` table** — this slice's write path REACHES the C6 gate that writes the
  `guardrail_type='hard_limit'` row (that INSERT is owned by ISSUE-055, not here). The live
  ApprovalQueue adapter (`supabase-store.ts`) additionally writes a
  `guardrail_type='approval_gate', action_blocked=false, status='pending'` row for a routed write.
  Present: L454–466, incl. the `check (not (guardrail_type='hard_limit' and status='approved'))`
  no-override constraint this slice relies on for the "no approve affordance" posture (AC-NFR-SEC.004.1).
  **No delta.**
- **`guardrail_type` enum** — uses the existing `'hard_limit'` and `'approval_gate'` members.
  Present: L55. **No delta.**
- **`task_status` enum** — the live adapter maps a routed write onto a task in `'awaiting_approval'`.
  Present: L52. **No delta.**
- **`idempotency_ledger` table** — a gated-then-approved write executes idempotently via ISSUE-032's
  `ToolRuntime.invokeWrite` → `commitIntent`/`recordResult`. Present: L350. Owned by ISSUE-032.
  **No delta.**

## CFG — verify-present (no delta owed)
- Per-tool `requires_approval` is a `tools`-row field (FR-3.REG.001), **not** a global config key. The
  write path reads it from the row. The seven hard limits are **by definition not config-overridable**
  (FR-3.ACT.002) — this slice asserts no config value relaxes them (test AC-3.ACT.002.2). **No new
  global CFG key.**

## PERM — verify-present (no delta owed)
- Tool *invocation* runs on the agent path as `service_role` (ADR-006 — no per-write RBAC gate); the
  seven hard limits bind **above** RBAC. Approval *authority* over a routed write is C6/RBAC
  (`PERM-approval.*`, homed in C1, consumed via ISSUE-056) — not defined here. Registry edits that set a
  tool's `risk_level`/`requires_approval` are `PERM-tool.manage` (homed in C1, consumed via ISSUE-032).
  **No new permission node.**

## Seam handoffs (owned elsewhere; NOT built here)
- **ApprovalQueue** — this slice defines the port + fake + a live adapter authored to the baseline DDL,
  but the queue itself (three-tier classification, soft/hard tiers, escalation, the surface) is
  **C6 APR/ESC → ISSUE-056**. This slice only routes a proposed write into the queue and reads back a
  decision.
- **The un-overridable hard-limit code gate + `guardrail_log(type='hard_limit')` INSERT + the
  registry-save rejection (AC-NFR-SEC.004.2) + the red-team (AC-NFR-SEC.004.3)** — **C6 → ISSUE-055**
  (imported here as `@harness/hard-limits`).
- **Per-connector write tools** (draft-to-approval for email/calendar, GHL/Slack/Drive mutations) —
  **ISSUE-039/040/041**.

## Residual AF (owed-to-live)
- **AF-068** (containment red-team — the enforceability claim that no authorized-but-dangerous autonomous
  path reaches a consequential side effect without hitting a content-ignoring code gate). It is **GREEN**
  via ISSUE-003/ISSUE-055's live red-team battery against the running system (per the issue build note:
  "AF-068 containment red-team is GREEN — reuse its gate, do not re-run live"). This slice proves the
  **offline connector-grain portion** (the write path classifies every autonomous write through the
  hard-limit gate BEFORE any external effect; a hit is blocked/logged/alerted with no C3 approve path)
  and **reuses** the GREEN AF-068 gate rather than re-running the live spike. The hard-limit ACs
  (AC-3.ACT.002.*, AC-NFR-SEC.004.1) move to `Verified` on the strength of the offline proof here + the
  already-GREEN AF-068; the write-contract ACs (AC-3.ACT.001.*) carry no spike gate.
