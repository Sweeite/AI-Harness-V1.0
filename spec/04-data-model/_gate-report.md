# Phase 4 — Independent Verification Gate Report

> **⚠️ ADDENDUM (post-sign-off re-audit, 2026-07-01):** a **second** independent adversarial audit found
> **3 defects this gate missed** — most notably **HIGH-1**: the audit sinks' append-only guarantee was
> checked here for *wording*, not a *mechanism*, and was in fact enforced only by RLS (which the `service_role`
> writer bypasses). All 3 (HIGH-1 audit-sink immutability trigger · MED-1 NULL-safe two-person CHECK · MED-2
> broadcast-notification RLS) are now **fixed**. See the SESSION-LOG Session-44 "POST-SIGN-OFF RE-AUDIT" entry.
> Lesson: a gate that greps for an invariant's *description* can pass a schema that never *enforces* it.


**Date:** 2026-07-01 · **Scope:** `schema.md`, `rls-policies.md`, `indexes.md`, `migrations.md`
against `_data-inventory.md` and spot-checks of `spec/01-requirements/*` + `spec/03-surfaces/*` +
`spec/02-config/config-registry.md`. **Method:** zero-context re-read of the four Phase-4 outputs,
enum/table extraction from `schema.md`, cross-file name-drift grep, and a source-verification
subagent (10 load-bearing claims). Findings ranked HIGH / MED / LOW.

## Verdict

**GATE: CLEAN-WITH-FIXES — 0 HIGH, 2 MED, 4 LOW.**

No #1/#2/#3 non-negotiable is left open at the HIGH level, coverage is complete, and the critical
`client_slug` rule holds. Two MED items are constraint/traceability tightenings; four LOW items are
cosmetic or documentation nits. The spec is sound to sign off once the MEDs are addressed (or
explicitly deferred with a note).

---

## (a) COVERAGE — every referenced table is defined; no orphans

**PASS.** All 21 authoritative `DATA-*` ids map to a defined table (or a design-sanctioned
split/rename/runtime form). 45 `create table` statements in `schema.md`; every one also appears in
`rls-policies.md`. No table is defined-but-never-referenced.

| DATA-* id | schema.md table | note |
|---|---|---|
| memories, entities, ingestion_queue, tools, rate_limit_tracker, prompt_layers, agents, task_queue, task_graph_versions, guardrail_log, event_log, notifications, client_registry, proactive_suggestions, signal_weights, access_audit | present 1:1 | — |
| `credentials` | **split** → `webhook_secrets` + `connector_credentials` | OD-P4-02 (recommended split, applied) |
| `dynamic_field_store` | `dynamic_field_values` | id→table naming variance (see LOW-1) |
| `context_envelope` | runtime (Inngest) + `task_history` durable tail | OD-P4-04 / AF-115 — by design, not a dropped table |

No orphan (referenced-but-undefined) and no dead table found.

## (b) NET-NEW COMPLETENESS — all 16 Phase-3 owed stores/fields present

**PASS.** Every one of the 16 net-new items is in `schema.md`:

1. `memory_conflicts` (was `hard_conflict_quarantine`) ✓ · 2. `consolidation_approvals` ✓ ·
3. `idempotency_ledger` ✓ · 4. `task_history` (envelope originals) ✓ ·
5. `task_queue.originating_user_id` ✓ (L387) · 6. `guardrail_log.escalated_at` ✓ (L434) ·
7. `injection_quarantine` ✓ · 8. `notifications` + escalation_state/escalated_at/actioned_at ✓
(L479–481) · 9. `push_subscriptions` ✓ · 10. `agent_health_metrics` ✓ · 11. `execution_plans` ✓ ·
12. `commands` ✓ · 13. `signal_weights` ✓ · 14. two-person auth on `deletion_requests`
(`second_authoriser_id`) ✓ (L713) — but see **MED-1** · 15. `conversations` + `messages` ✓ ·
16. `config_audit_log` governance ✓.

Source re-check confirmed the owing FRs are real: FR-6.INJ.006 (component-06 L733), FR-7.VIEW.003
(surface-12 L134), FR-9.CMD.006 (surface-10 L4), FR-9.SUG.005 (component-09 L622), FR-7.LOG.008
(component-07 L384), OD-135 chat (surface-12 L133).

## (c) TYPES — enums defined vs used

**PASS (with 2 defined-but-unused, LOW).** Every column typed with an enum has that enum defined in
`## Types`. Spot-checks all confirmed against source:

- `task_status` includes `'flagged'` ✓ (source component-05 L120–123 / component-06 L607, OD-054).
- `guardrail_type` = 5 values (hard_limit, approval_gate, anomaly, rate_limit, prompt_injection) ✓
  (component-06 L762).
- `event_type` = 8 values ✓ (component-07 L296–297).
- `sensitivity_tier` = 4 incl. `restricted` ✓ · `memory_type` = 3 ✓.

Two enums are **defined but never used as a column type** (LOW-2):
- `config_edit_class` — taxonomy documentation only; not stored on `config_values`.
- `step_failure_mode` — referenced only in §9 prose; step failure-mode lives inside
  `execution_plans.plan_body` / `task_graph_versions.steps` jsonb, not a typed column.

No column is typed with an undefined enum.

## (d) RLS / client_slug — CRITICAL

**PASS — CLEAN.** `grep client_slug schema.md` returns 7 hits: the global-rule statement (L15–16),
one explanatory comment on `agents` (L526, "NO client_slug"), the §13 management-plane header (L654),
and the three management tables only — `client_registry.client_slug` (natural key, L659),
`deployment_health.client_slug` (FK, L672), `offboarding_records.client_slug` (FK, L690). **No
application table carries `client_slug`.** `rls-policies.md` correctly states human-path RLS keyed to
`auth.uid()` + PERM/clearances vs agent-path `service_role` (bypasses RLS), isolation is physical, and
"No policy references `client_slug`" (L7–8, L82–85). Confirmed clean.

## (e) #1/#2/#3 SWEEP

**PASS with one MED constraint gap.**

- **Append-only sinks** (`event_log`, `guardrail_log`, `access_audit`, `config_audit_log`): all four
  documented append-only with no UPDATE/DELETE policy except the logged redaction-tombstone
  (rls L51/L64/L66/L68, L89–90). ✓ (#1)
- **memories sole-writer**: `service_role` write only, no human write policy (rls L52; ADR-004
  confirmed component-02 L528). ✓ (#2)
- **guardrail_log CHECK** `not (guardrail_type='hard_limit' and status='approved')` present
  (schema L436; source AC-6.LOG.001.2 component-06 L769). ✓ (#3 — a hard-limit override cannot be
  silently recorded as approved)
- **deletion two-person auth**: CHECK enforces `second_authoriser_id <> authorized_by` (L718). See
  **MED-1** — the executor-distinctness half of AC-10.DEL.006.2 is not constrained.

## (f) MIGRATIONS — expand-contract discipline

**PASS.** `migrations.md` respects every hard constraint:
- No DROP/RENAME in the same migration as its replacement (L64–65); drops are a separate contract
  migration; worked examples (system_prompt drop, embedding_model swap) written as ≥2 releases (L55–58).
- Vector/heavy indexes `CONCURRENTLY`, explicitly outside a txn block (0001b / `--no-transaction`,
  L41–43, L66); `indexes.md` uses `create index concurrently` throughout.
- Idempotent, first-boot-only seed (L38, L68).
- Per-deployment failure isolation: a failed migration halts only that deployment, fires a
  version-skew/migration-failure alert, and is safe to re-run (L69–71).
- Rollback = roll-forward, never destructive down-migration (L15, L77). AF-065 correctly flagged
  paper-until-tested.

## Internal consistency (name drift across the four files)

**PASS.** `hard_conflict_quarantine` → `memory_conflicts` rename is applied consistently across
`schema.md`, `rls-policies.md`, and `indexes.md` (each uses `memory_conflicts`, zero leaks of the old
name). The old name survives only in `_data-inventory.md` (the harvest ledger) — expected as the
audit trail, but see **MED-2**. All 45 schema tables are named identically in the RLS summary table.

---

## Findings

### MED-1 — deletion_requests CHECK under-enforces executor-distinctness (#2 hole)
`schema.md` L718 constrains only `second_authoriser_id <> authorized_by`. But the inline comment
(L713 "≠ authorized_by, ≠ executor") and `_data-inventory.md` L147 ("executor ≠ authoriser") — and
the **source** (component-10 L386–387, AC-10.DEL.006.2: "the **executor** cannot be their own second
authoriser") — assert the *executor* must also be distinct. There is no CHECK for
`executor_id <> authorized_by` or `executor_id <> second_authoriser_id`. The comment claims more than
the constraint enforces; the no-self-execution guarantee currently rests on unstated app logic. This
is a #2 (do-something-it-shouldn't) gap for two-person erasure auth.
**Fix:** add `check (executor_id is null or executor_id <> authorized_by)` (and consider
`executor_id <> second_authoriser_id`), or explicitly note in the schema that executor-distinctness
is app-enforced and why the DB can't (e.g. null-at-request-time ordering).

### MED-2 — inventory ledger still names `hard_conflict_quarantine`; rename not recorded as change-control
`schema.md`/`rls`/`indexes` use `memory_conflicts`, but `_data-inventory.md` (§C, and the net-new
table row) still says `hard_conflict_quarantine`, with no reconciliation note capturing the rename.
Per Rule 0 / change-control, a rename of a net-new store owed back to C2 (FR-2.WRT.002) should be a
recorded clerical amendment, not a silent drift between the ledger and the schema. A zero-context
reader diffing the two files sees an apparent mismatch.
**Fix:** add a one-line reconciliation (like R1) in `_data-inventory.md`:
"`hard_conflict_quarantine` → `memory_conflicts` (schema name; same store, FR-2.WRT.002)."

### LOW-1 — `DATA-dynamic_field_store` id vs `dynamic_field_values` table name
The matrix id is `dynamic_field_store`; the table is `dynamic_field_values`. Correct store, but the
id→table mapping is undocumented. Add a note in the coverage crosswalk so traceability is explicit.

### LOW-2 — two enums defined-but-unused (`config_edit_class`, `step_failure_mode`)
Neither is used as a column type (see (c)). Harmless, but either use them, drop them, or add a
one-line "documentation enum, not a column" comment to avoid a future reader assuming a missing column.

### LOW-3 — `event_log.answer_mode` / `messages.answer_mode` stored-vs-derived (OD-P4-05) resolved by fiat
`schema.md` stores `answer_mode` on `event_log` (L466) and `messages` (L624) and derives cost. This
is the recommended OD-P4-05 resolution, but OD-P4-05 is listed as user-delegated/for-sign-off in
`_data-inventory.md` L202. Ensure the sign-off actually records acceptance of the 7 OD-P4-0x
resolutions (they are currently "resolved per recommended option" pending the user's confirmation).

### LOW-4 — `notifications.severity` / `tools.risk_level` typed as free `text`
Both are conceptually enumerable (severity levels, risk levels) but left as `text`. Not a
correctness issue; a CHECK or enum would harden them. Flag only if the source defines a fixed set.

---

## What was verified against source (subagent, 10/10 VERIFIED, no contradictions)
task_status `flagged` (component-05 L120 / component-06 L607) · guardrail_type 5 values
(component-06 L762) · event_type 8 values (component-07 L296) · AC-6.LOG.001.2 hard_limit≠approved
(component-06 L769) · two-person executor-distinct (component-10 L386, AC-10.DEL.006.2) · memories
sole-writer (component-02 L528, ADR-004) · originating_user_id no-self-approval (surface-04 L45/L90) ·
OD-135 chat persistence (surface-12 L133, surface-08 L6) · injection_quarantine/push_subscriptions/
commands/signal_weights net-new (component-06 L733 / surface-12 L134 / surface-10 L4 / component-09
L622) · FR-7.LOG.008 config_audit_log (component-07 L384).
