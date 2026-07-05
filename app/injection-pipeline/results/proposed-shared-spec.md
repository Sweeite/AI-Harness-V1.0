# ISSUE-059 — proposed shared-spec deltas (offline package; do NOT edit shared files)

This package (`@harness/injection-pipeline`) is authored offline in a fan-out worktree. It edits **no**
shared file (no migration, no schema.md, no config-registry.md). Everything the integrator must fold into
the shared spec is recorded here.

## 1. Migration — NONE authored by this slice

Per the issue build order (§8.1), the `injection_quarantine` table is **not** owned here — it **lands in
the ISSUE-060 migration `0009_guardrails`**, alongside `guardrail_log` (the two share the FK
`injection_quarantine.guardrail_log_id → guardrail_log(id)`). This package authored **no** migration and
touched **no** `app/silo/migrations/*`.

### `injection_quarantine` DDL this adapter is authored to (must exist in 0009_guardrails, ISSUE-060)

Matches `spec/04-data-model/schema.md` §7 Guardrails exactly (the columns `supabase-store.ts` reads/writes):

```sql
create table injection_quarantine (                       -- net-new; shadow-retain (ADR-007 pt4)
  id               uuid primary key default gen_random_uuid(),
  guardrail_log_id uuid not null references guardrail_log(id),
  quarantined_content text not null,                      -- never machine-discarded (#1)
  source_tool      text not null,
  source_record_id text,
  human_decision   quarantine_decision,                   -- null = pending
  reviewed_by      uuid references profiles(id),
  reviewed_at      timestamptz,
  escalated_at     timestamptz,
  created_at       timestamptz not null default now()
);
```

Depends on enums that already exist in schema.md §Types (confirmed present, this slice adds none):
- `quarantine_decision as enum ('discard','approved_safe')` — null = pending.
- `guardrail_type as enum (…, 'prompt_injection')` — the `guardrail_log.guardrail_type` value this slice writes.

**Append-only note for the integrator:** the `injection_quarantine` review/escalation columns
(`human_decision`, `reviewed_by`, `reviewed_at`, `escalated_at`) are the ONLY columns this adapter UPDATEs.
`quarantined_content` is **never** UPDATEd or DELETEd (the #1 retain invariant). If ISSUE-060 puts an
append-only/immutability trigger on the guardrail sinks, it must **permit** these review-column updates while
**rejecting** any `quarantined_content` mutation or row delete — the same shape as the config-store audit
trigger's redaction whitelist.

## 2. Config keys — already in the registry; proposed defaults/constraints CONFIRMED (no edit needed)

All four keys already exist in `spec/02-config/config-registry.md` with the exact defaults/constraints this
package enforces. Listed here for the integrator to confirm parity (no shared-file edit is proposed):

| key | default | constraint enforced in this package |
|---|---|---|
| `injection_semantic_detection_enabled` | **false at boot** | must be `false` in `bootConfig()` (ADR-007 §3) |
| `injection_semantic_threshold` | 0.85 | float in [0,1]; **≤ `injection_quarantine_threshold`** |
| `injection_quarantine_threshold` | 0.95 | float in [0,1]; **≥ `injection_semantic_threshold`** |
| `approval_escalation_timeout` | 4 h | reused for quarantine-review staleness (shared with ISSUE-056); duration ≥ 1 min |

The `semantic ≤ quarantine` constraint is validated in `src/config.ts::validateConfig` and proven by
`AC-NFR-SEC.006.3`. The thresholds are documented (ADR-007 §6) as **signal-tuning knobs, not safety dials**.

## 3. Schema deltas — none beyond the `injection_quarantine` table above

This slice writes `prompt_injection` rows to `guardrail_log` (table + append-only invariant owned by
ISSUE-060) and sets `task_queue.status = 'flagged'` (owned by ISSUE-056 via FR-6.ESC.001). No new column on
either table is required by this slice.

## 4. Live proof owed (NOT provable offline)

The in-memory fake is the proven reference model (14/14 AC tests pass offline). The live pg adapter
(`supabase-store.ts`) is authored to the DDL but **NOT run live**. The following are owed to the C6
integration checkpoint AFTER `0009_guardrails` (ISSUE-060) applies the `injection_quarantine` table:

- The `injection_quarantine.guardrail_log_id → guardrail_log(id)` FK actually binding a quarantine row to
  its log row (referential integrity of the retain path).
- The guardrail-sink append-only trigger permitting the review-column UPDATEs while rejecting a
  `quarantined_content` mutation/delete (the #1 retain-not-discard invariant at the DB layer).
- The `task_queue.status → 'flagged'` flip actually pausing the run (FR-6.ESC.001, ISSUE-056 seam).

**Red-team gate (AF-068):** NFR-SEC.006 is launch-blocking via AF-068, **already 🟢 PASS (2026-07-04,
ISSUE-003)** per the security.md register — containment holds independent of detection. This slice's
`AC-NFR-SEC.006.1` (a quarantined injection is held out of the task by code) is proven against the reference
model offline; the end-to-end containment proof is ISSUE-003's red-team battery (green) + this shipped code
at the checkpoint.
