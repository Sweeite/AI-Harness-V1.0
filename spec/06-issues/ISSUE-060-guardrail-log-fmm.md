---
id: ISSUE-060
title: guardrail_log sink + no-silent-failure invariant + approval/anomaly learning
epic: G — guardrails
status: done
github: "#60"
---

# ISSUE-060 — guardrail_log sink + no-silent-failure invariant + approval/anomaly learning

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the `guardrail_log` — the append-only, five-type security-event store every other C6 slice writes into — with write-completeness that fails closed (the safe action holds even if the row write fails), the cross-component no-silent-failure invariant, and the two admin-confirmed learning loops (approval-tier + anomaly-baseline).

## 2. Scope — in / out
**In:** The C6 LOG + FMM + OPT areas end-to-end — the **foundational guardrail sink** the rest of Epic G depends on:
- The `guardrail_log` table itself (FR-6.LOG.001): the full schema, the `guardrail_type` five-value enum (`hard_limit`/`approval_gate`/`anomaly`/`rate_limit`/`prompt_injection`), the `guardrail_status` enum, `escalated_at`, and the `check (not (hard_limit and approved))` DB constraint (AC-6.LOG.001.2). The `injection_quarantine` shadow-retain table (referenced by INJ, but the table is created here as part of the §7 Guardrails schema group). Bind both to the shared append-only trigger (schema §Global rules).
- Append-only enforcement (FR-6.LOG.002): no delete/content-rewrite of a historical row; only the whitelisted forward status/`reviewed_by`/`reviewed_at` transition, timestamped.
- Write-completeness + the three-sink boundary (FR-6.LOG.003): every guardrail event of all five types produces exactly one `guardrail_log` row; the store is distinct from `access_audit` (C1) and `event_log` (C7). **Fail-closed on a log-write failure** (AC-6.LOG.003.3) — the block/halt is taken regardless of whether the row lands, and the lost row is escalated out-of-band.
- The exportable-content + dedicated-view *requirement* (FR-6.LOG.004): C6 owns the requirement; the export/view mechanism is C7 (see Out).
- The no-silent-failure guardrail invariant + failure-map catalogue scoping (FR-6.FMM.001): every guardrail-class event is detected → recorded → surfaced; the failure-map is a cross-component catalogue (detection at the home component, alert path via C7); and a guardrail check that **itself errors** fails closed — halt + flag + log, never proceed unchecked (AC-6.FMM.001.3).
- The two learning loops (FR-6.OPT.001 approval-pattern, FR-6.OPT.002 anomaly-baseline): surface tier/threshold change candidates; **admin confirms — never silent auto-change**; an un-actioned candidate persists/re-surfaces rather than vanishing (AC-6.OPT.001.2). FR-6.OPT.002 is the reusable baseline mechanism ISSUE-057 consumes.

**Out:** This slice does **not** produce guardrail events itself — it builds the sink + invariant + learning framework that other slices write into. The `hard_limit` rows are written by **ISSUE-055** (HRD); `approval_gate` rows + the escalate-don't-abandon `flagged` workflow by **ISSUE-056** (APR/ESC); `anomaly` rows + the five detectors that feed FR-6.OPT.002 by **ISSUE-057** (ANM); `prompt_injection` rows + the `injection_quarantine` *write path* by **ISSUE-059** (INJ) — this slice creates the `injection_quarantine` table, ISSUE-059 owns the quarantine pipeline that fills it. The `event_log` sink, the silent-failure detector, and the `event_log ⋈ guardrail_log` cross-sink reconciliation are **ISSUE-011** (this slice's `guardrail_log` is the other half of that reconciliation, but the reconciler is ISSUE-011). The dedicated dashboard *view*, retention, tamper-evidence, and export *mechanism* (FR-7.LOG.007) are C7 / **ISSUE-077** — this slice asserts only the exportable-content requirement (FR-6.LOG.004). Failure-map detection at each home component (C2 memory health, C3 connector, C5 loops/DLQ/envelope, C8 orchestrator) stays with those components; this slice does not re-implement any of it (AC-6.FMM.001.2).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-6.LOG.001, FR-6.LOG.002, FR-6.LOG.003, FR-6.LOG.004, FR-6.FMM.001, FR-6.OPT.001, FR-6.OPT.002 (all component-06 Guardrails)
- **NFRs:** NFR-OBS.003 (cross-sink reconciliation — the `guardrail_log` half), NFR-OBS.016 (every guardrail-hit logged independent of delivery), NFR-DR.008 (append-only audit sinks as a knowledge-durability layer)
- **Rests on:** ADR-007 (containment-first; #3 never-silent, part 4 loud logging), ADR-001 §3/§4 (`client_slug` label-only isolation), OD-065 (`guardrail_log` vs `access_audit` vs `event_log` boundary + C6-owns-completeness / C7-owns-view), OD-061 (failure-map is a cross-component catalogue), OD-096 / FR-10.ISO.001 (Phase-4 reconciliation: `client_slug` column DELETED, not label-only)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-6.LOG.001.1
- AC-6.LOG.001.2
- AC-6.LOG.001.3
- AC-6.LOG.002.1
- AC-6.LOG.003.1
- AC-6.LOG.003.2
- AC-6.LOG.003.3
- AC-6.LOG.004.1
- AC-6.FMM.001.1
- AC-6.FMM.001.2
- AC-6.FMM.001.3
- AC-6.OPT.001.1
- AC-6.OPT.001.2
- AC-6.OPT.002.1
- **Gating spikes (if any):** none. No launch-gating spike (ISSUE-001..006) gates this slice, and no build-time AF is attached to LOG/FMM/OPT (the C6 Block-Q AFs — AF-068/116/117 — gate HRD/ANM/INJ, owned by ISSUE-055/057/059, not this slice). Verification is by test layer only (see §9).

## 5. Touches (complete blast radius, by ID)
- **DATA:** `guardrail_log` (schema §7 Guardrails — **created here**, incl. the `guardrail_type`/`guardrail_status` enums in §Types, `escalated_at`, and the `hard_limit`≠`approved` check constraint); `injection_quarantine` (schema §7 — table created here; write path is ISSUE-059); bound to `enforce_audit_append_only()` (schema §Global rules — the shared append-only trigger, dependency order after ISSUE-011's trigger definition). Phase-4 note: `client_slug` is DELETED per OD-096/FR-10.ISO.001 (exists only in mgmt-plane `client_registry`) — do not add it as a table column.
- **PERM:** none new — admin confirmation of a tier/baseline change (FR-6.OPT.001/002) reuses the C1 RBAC admin gate; no OPT-specific node
- **CFG:** approval-pattern-learning enable/disable knob; anomaly baseline-learning enable/disable knob (both per schema §12 Config cluster; the anomaly *thresholds* themselves are owned by ISSUE-057)
- **UI:** the tier-change-candidate + baseline-candidate surfacing lists (rendered under C7 observability views / ISSUE-077 — this slice owns the candidate data + the "persists/re-surfaces" requirement, not the dashboard component); the dedicated `guardrail_log` view + export are C7/ISSUE-077
- **Connectors:** none

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-06-guardrails.md — §LOG (FR-6.LOG.001–004), §FMM (FR-6.FMM.001), §OPT (FR-6.OPT.001–002) + their ACs; the C6 Context manifest header for the ADR-007 / OD-065 / OD-061 framing and reconciliation #1 (`client_slug` label-only)
- spec/04-data-model/schema.md §7 Guardrails (C6) — the `guardrail_log` + `injection_quarantine` tables and the `check (not (hard_limit and approved))` constraint
- spec/04-data-model/schema.md §Types — the `guardrail_type`, `guardrail_status`, `quarantine_decision` enums
- spec/04-data-model/schema.md §Global rules — `enforce_audit_append_only()` and the audit-sink append-only trigger (the whitelisted forward status transition)
- spec/04-data-model/schema.md §12 Config cluster — the learning enable/disable knobs
- spec/05-non-functional/observability.md — NFR-OBS.003 (cross-sink reconciliation), NFR-OBS.016 (guardrail-hit logged independent of delivery)
- spec/05-non-functional/backup-dr.md — NFR-DR.008 (append-only audit sinks as a durability layer)
- spec/00-foundations/adr/ADR-007-*.md — containment-first / #3 never-silent / part-4 loud-logging posture

## 7. Dependencies
- **Blocked-by:** ISSUE-011 (observability skeleton — defines the shared `enforce_audit_append_only()` trigger this table binds to, and owns the `event_log ⋈ guardrail_log` cross-sink reconciler NFR-OBS.003 depends on)
- **Blocks:** none (leaf). *(Note: ISSUE-055/056/057/059 each say "the `guardrail_log` schema table + append-only trigger are stood up by the LOG slice" and write into it; they are not formally blocked-by this issue in the backlog roster — all four and this slice sit in Tier 3 — so this table must land no later than they do. Build it first within the tier; ISSUE-057 additionally consumes the FR-6.OPT.002 baseline mechanism from this slice.)*

## 8. Build order within the slice
1. **Enums first** (schema §Types): `guardrail_type` (five values), `guardrail_status`, `quarantine_decision` — these are referenced by the table DDL and by every writing slice.
2. **The `guardrail_log` table** (FR-6.LOG.001, schema §7): full column set + the `check (not (guardrail_type='hard_limit' and status='approved'))` constraint (AC-6.LOG.001.2 — the DB-level no-override guard that ISSUE-055 relies on). No `client_slug` column (OD-096/FR-10.ISO.001).
3. **The `injection_quarantine` table** (schema §7): the shadow-retain store, FK to `guardrail_log(id)` — table only; ISSUE-059 owns the write path.
4. **Bind the append-only trigger** (FR-6.LOG.002, schema §Global rules): attach `enforce_audit_append_only()` (defined by ISSUE-011) to both tables; permit only the whitelisted forward `status`/`reviewed_by`/`reviewed_at` transition, reject deletes/content rewrites (AC-6.LOG.002.1).
5. **The write-completeness contract + fail-closed helper** (FR-6.LOG.003): a single guarded write path all producer slices call, such that a block/flag/quarantine writes exactly one row (AC-6.LOG.003.1) into the correct sink (AC-6.LOG.003.2), and — critically — the safe action holds even if the row write fails, escalating the lost row out-of-band (AC-6.LOG.003.3, reusing the AC-5.JOB.006.2 surfacing pattern). This is the seam every other Epic-G slice writes through.
6. **The no-silent-failure invariant + fail-closed-on-check-error** (FR-6.FMM.001): assert the detected→recorded→surfaced chain for every guardrail-class event (AC-6.FMM.001.1); document the failure-map as a cross-component catalogue that references home owners + the C7 alert path without re-implementing detection (AC-6.FMM.001.2); and make a guardrail check that *itself errors* halt + flag + log rather than proceed unchecked (AC-6.FMM.001.3) — a generic fail-closed wrapper the ANM/INJ/RTL checks run inside.
7. **The two learning loops** (FR-6.OPT.001 approval-pattern, FR-6.OPT.002 anomaly-baseline): surface tier/threshold change candidates from history; apply only after explicit admin confirmation (never silent auto-change, AC-6.OPT.001.1); an un-actioned candidate persists/re-surfaces (AC-6.OPT.001.2). Expose FR-6.OPT.002 as the reusable baseline mechanism ISSUE-057 consumes.
8. **Exportable-content requirement** (FR-6.LOG.004): guarantee the row content is complete enough for a client-trust export covering all five types with no gaps (AC-6.LOG.004.1); the export/view *mechanism* is C7/ISSUE-077.
9. Tests to each AC in §4.

**Integration note (spans the bundled FRs):** LOG.001/002/003 are one contract — the *shape* (001), the *immutability* (002), and the *completeness + fail-closed* (003) of the single sink that HRD/APR/ANM/INJ/RTL all write into; FMM.001 is the invariant *over* that sink (nothing guardrail-class is ever swallowed, and a check that errors fails closed), so FMM depends on the LOG write path existing. OPT.001/002 are the read-side learning loops *over* the accumulated log, and both share the same rule as FR-6.ANM.005: a change that would alter a *gate* (not merely a signal) is admin-confirmed, never silent. The whole slice is deliberately event-producer-free — it is the foundation the other five C6 slices stand on, which is why it must land first within Tier 3.

## 9. Verification (how DoD is proven)
- Unit/integration tests per `spec/05-non-functional/test-strategy.md`: a row of each of the five types writes with the full schema and a valid `guardrail_type` (AC-6.LOG.001.1); a `status→approved` on a `hard_limit` row is rejected at both the DB check and the app (AC-6.LOG.001.2); `pending` covers all unresolved states disambiguated by type (AC-6.LOG.001.3); a delete/content-rewrite of a historical row is rejected and only the forward resolution transition is permitted, timestamped/attributed (AC-6.LOG.002.1); every block/flag/quarantine path writes exactly one row into exactly one sink (AC-6.LOG.003.1/2); a simulated `guardrail_log` write failure does **not** roll the block back and escalates the lost row out-of-band (AC-6.LOG.003.3); an export contains all five types with no gaps (AC-6.LOG.004.1); a guardrail-class failure always produces a record + surface (AC-6.FMM.001.1); a home-owned failure-map row references its owner + C7 path and is not re-detected here (AC-6.FMM.001.2); a guardrail check that throws halts + flags + logs rather than proceeding (AC-6.FMM.001.3); a learning candidate applies only after admin confirmation (AC-6.OPT.001.1) and an un-actioned one persists/re-surfaces (AC-6.OPT.001.2, AC-6.OPT.002.1).
- **AC-NFR postures that must hold:** NFR-OBS.003 (a one-sided `guardrail_log`/`event_log` row is flagged by the ISSUE-011 reconciler — this slice provides the `guardrail_log` half); NFR-OBS.016 (a guardrail-hit row is written + retained even when alert delivery fails — the fail-closed write path); NFR-DR.008 (the append-only sink + shadow-retain stand as an independent knowledge-durability layer). The AC→`Verified` path: each `guardrail_log` write is covered by the append-only immutability test and the cross-sink reconciliation assertion.
