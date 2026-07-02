# NFR — Compliance & Data Governance  (`NFR-CMP`)

> **Context manifest.** Depends on: ADR-008 (golden rule / systems of record), ADR-001 (isolation
> boundary — residency is trivially per-client because the client owns the Supabase project), the
> compliance/offboarding/retention FRs in C10 (`component-10-infra-compliance.md`), the erasure rule
> in C2 (`FR-2.MNT.017`), the audit-sink governance + immutability FRs in C7
> (`component-07-observability.md`), the Phase-4 immutability trigger in `schema.md` §Immutability
> enforcement + `rls-policies.md`, the retention/region/HR config keys in `config-registry.md`, and
> `change-control.md`. **Reference-don't-re-spec:** each `NFR-CMP` row names the FR/ADR/schema object
> that *implements* it and adds only the compliance posture, the governance floor, or the verification
> method (the `AF-*` that proves it). The mechanism is specified in those components; this file states
> the property that must hold and how it is proven.
>
> **Upholds primarily #1 (never lose or corrupt knowledge — the audit trail survives even an
> erasure)** — with #2 (residency lock, two-person deletion, legal-gated HR content) and #3 (exports
> never silently truncate) alongside.

---

### NFR-CMP.001 — Data residency: v1 region lock (Sydney `ap-southeast-2`)

- **Requirement:** The system shall pin every v1 client deployment to the Sydney region `ap-southeast-2`, record the region per deployment (never silently assumed), and surface region selection to the client at onboarding under legal review; v2 makes the region selectable.
- **Type:** posture (hard v1 invariant).
- **Upholds:** #2 (client data cannot come to rest in an unauthorised jurisdiction) + #1 (residency is a property of the client-owned Supabase project, so it survives operator turnover).
- **Implemented by:** FR-10.ISO.003 · config `deployment_region` (default `ap-southeast-2`, BOOT, enum v1-locked).
- **Target / threshold:** `deployment_region = ap-southeast-2` for all v1 deployments; recorded in the mgmt-plane registry per deployment.
- **Verification:** DOCS (vendor confirmation) — **⚠️ FEASIBILITY: AF-071**: Supabase docs do not pin backup-storage region relative to the project; residency guarantee must be confirmed via Supabase support/SLA before it is asserted (shared with `backup-dr.md`).
- **Launch gate:** **blocking** (a #2 posture — data must not rest off-jurisdiction at go-live; the region lock is a locked-FR/config posture that must be in place at launch, per RP-1).
- **Acceptance criteria:**
  - AC-NFR-CMP.001.1 — Given any v1 deployment, When its region is inspected, Then `deployment_region = ap-southeast-2` and the value is recorded per deployment (not defaulted-silently).
  - AC-NFR-CMP.001.2 — Given onboarding, When residency is set, Then it is surfaced to the client under the FR-10.LEG.001 legal review, not silently assumed.
- **Notes / OD:** AF-071 is a DOCS gate (vendor confirmation), not a code spike; it is *not* one of the six globally launch-blocking spikes, but the residency *posture* itself is launch-blocking.

### NFR-CMP.002 — The golden rule: pointers + enrichment, never copies

- **Requirement:** The system shall store only **pointers + enrichment** over systems of record, **never copies** of the source data; every memory row shall carry a `source_ref` to its system of record, and source files shall be referenced, never copied into the brain.
- **Type:** posture (the governing data-model invariant).
- **Upholds:** #1 (the brain's blast radius excludes source-of-record data; recent loss is re-derivable by re-ingesting) + #2 (the system holds no more of the client's regulated data than pointers + derived enrichment).
- **Implemented by:** ADR-008 Context (design `L1634`) · FR-2.* (memory model) · schema.md `memories.source_ref` / `entities.external_refs`.
- **Target / threshold:** binary — every memory/entity row carries a `source_ref`; ingested files are referenced, never copied into Storage (ADR-008 §6, OOS-013).
- **Verification:** DOCS (schema — `source_ref` present on memory rows; the ingestion path stores pointers) + build-time test (no source-file copy path into the brain).
- **Launch gate:** blocking (foundational data-model invariant governing what is even stored/backed up).
- **Acceptance criteria:**
  - AC-NFR-CMP.002.1 — Given any stored memory, When its row is inspected, Then it carries a `source_ref` pointer and does not contain a verbatim copy of the source-of-record file.
  - AC-NFR-CMP.002.2 — Given an ingested source file, When ingestion completes, Then the file is referenced (`source_ref`), never copied into Supabase Storage.
- **Notes / OD:** the golden rule is lifted into the glossary as a binding principle (ADR-008); it governs data model, ingestion scope, and backup scope.

### NFR-CMP.003 — Intentional retention: hard-delete only via erasure or offboarding

- **Requirement:** The system shall hard-delete client data **only** through the individual right-to-erasure workflow or client offboarding — **never incidentally**; every hard-delete shall be a deliberate, audited action.
- **Type:** posture + duty.
- **Upholds:** #1 (data is never lost by accident; deletion is always deliberate) + #3 (every hard-delete leaves an audit record — a deletion never happens silently).
- **Implemented by:** FR-10.RET.001 · every hard-delete → an audit record (FR-10.DEL.005 / FR-10.OFF.006).
- **Target / threshold:** binary — no code path hard-deletes client data outside the erasure (FR-10.DEL.*) or offboarding (FR-10.OFF.*) sequences.
- **Verification:** DOCS (delete-path inventory — only erasure/offboarding paths hard-delete) + build-time test (no incidental DELETE of client data).
- **Launch gate:** blocking (a #1 posture — the retention floor of "no accidental loss").
- **Acceptance criteria:**
  - AC-NFR-CMP.003.1 — Given the deployed system, When every hard-delete path is inventoried, Then each is the erasure workflow or the offboarding sequence — no incidental deletion path exists.
  - AC-NFR-CMP.003.2 — Given any hard-delete, When it runs, Then a corresponding audit record (FR-10.DEL.005 / FR-10.OFF.006) is written.
- **Notes / OD:** decay never deletes — retention here concerns *hard* deletion (the derived-memory decay lever is a confidence/relevance mechanism, not a delete).

### NFR-CMP.004 — Retention values with legal-minimum floors

- **Requirement:** The system shall keep audit/history/export data for configurable windows that are **≥ the applicable legal minimum**, Super-Admin-gated, with the floor set per jurisdiction by legal review — not by an engineer's default.
- **Type:** threshold + duty.
- **Upholds:** #1 (history is kept long enough to be legally sufficient) + #2 (the floor is a legal minimum, not a convenience-chosen number).
- **Implemented by:** FR-10.RET.002 · config `event_log_retention_window=365d` · `client_offboarding_retention_days=90` · `individual_deletion_audit_years=7` · `data_export_link_expiry_hours=72`.
- **Target / threshold:** the four config knobs above (all BOOT except `data_export_link_expiry_hours` which is LIVE); each constrained `≥ legal/audit floor`.
- **Verification:** DOCS / legal — **⚠️ FEASIBILITY: AF-136**: the actual per-jurisdiction lawful retention minimums are a legal-review question (DOCS/legal), *not* a code spike; the config values are *configurable safeguards* set per the review, not legal advice.
- **Launch gate:** fast-follow / legal-gated (the *mechanism* — the configurable knobs — is in place; the *values* are set by the FR-10.LEG.001 legal review before regulated data flows; AF-136 is legal-review-gated, not launch-blocking code).
- **Acceptance criteria:**
  - AC-NFR-CMP.004.1 — Given the retention config, When it is inspected, Then each retention window is a configurable, Super-Admin-gated value validated `≥ legal floor`.
  - AC-NFR-CMP.004.2 — Given a jurisdiction with a stated legal minimum, When the deployment handles its regulated data, Then the retention values were set (or confirmed) by the FR-10.LEG.001 legal review (AF-136), not by an engineering default.
- **Notes / OD:** the design's defaults (365d / 90 / 7y / 72h) are *safeguards*; the binding value is the legal-review output.

### NFR-CMP.005 — Individual right-to-erasure: two-class ID, transitive delete, verify-before-done

- **Requirement:** The system shall satisfy an individual erasure request by (a) identifying affected records via **two classes** — deterministic `entity_id` matches (auto-actioned) and probabilistic name-in-content matches (**human-confirmed**, never auto-deleted on a fuzzy match); (b) removing the entity-id and **transitively hard-deleting** across the derived memory layers (a multi-entity memory is retained; else it cascades via C2); (c) content-scrubbing to `[REDACTED]` on human confirmation; and (d) **verifying erasure is complete before writing the "done" audit record** — a partial/failed/indeterminate result blocks completion (fail-closed).
- **Type:** duty (workflow correctness).
- **Upholds:** #1 (a multi-entity memory is never over-deleted; nothing is destroyed on a fuzzy false-positive) + #2 (regulated personal data is actually gone — no un-erased PII left by a false-negative) + #3 (erasure is never marked done unless proven complete).
- **Implemented by:** FR-10.DEL.002 (identify) · FR-10.DEL.003 (entity-id removal + transitive delete via C2) · FR-10.DEL.004 (content scrubbing) · FR-2.MNT.017 (the C2 transitive erasure mechanism) · AC-10.DEL.003.4 (verify-C2-returned-complete before the DEL.005 "done" audit).
- **Target / threshold:** deterministic matches auto-actioned; probabilistic matches 100% human-confirmed before redaction; verify-complete is a hard gate on the "done" audit.
- **Verification:** **EVAL** — **⚠️ FEASIBILITY: AF-134** (erasure recall / name-identifier matching — that the sweep *finds* the affected data) + **⚠️ FEASIBILITY: AF-137** (transitive-erasure completeness verification — that the erasure *finished* across the derived layers, gating AC-10.DEL.003.4).
- **Launch gate:** fast-follow / build-time (the workflow + fail-closed verify-before-done posture is a locked-FR posture in place at launch; the accuracy EVALs AF-134/AF-137 are build-time, not among the six globally launch-blocking spikes).
- **Acceptance criteria:**
  - AC-NFR-CMP.005.1 — Given an erasure request, When records are identified, Then deterministic `entity_id` matches are auto-actioned and name-in-content matches are surfaced for human confirmation — never auto-deleted/redacted on a fuzzy match.
  - AC-NFR-CMP.005.2 — Given entity-id removal, When a memory names only the erased entity, Then it cascades to hard-delete via C2; When it is multi-entity, Then the memory is retained and passed through content scrubbing (AF-137).
  - AC-NFR-CMP.005.3 — Given the workflow completes the C2 erasure, When the "done" audit would be written, Then it is written only after a verified-complete result; a partial/failed/indeterminate C2 return blocks it (AC-10.DEL.003.4, AF-137).
- **Notes / OD:** OD-092 (fuzzy match → human-confirmed) and OD-093 (distinct second authoriser) are the governing resolutions; two-person authorisation for the erasure itself is `NFR-CMP.008` / `NFR-SEC.015`.

### NFR-CMP.006 — Audit-sink immutability (fires regardless of role)

- **Requirement:** The system shall make the audit sinks (`event_log`, `guardrail_log`, `config_audit_log`, `access_audit`) **append-only + tamper-evident**, enforced by a database `BEFORE UPDATE OR DELETE` trigger (`enforce_audit_append_only()`) that fires **regardless of role** — so the `service_role` writer (which is RLS-exempt) **cannot rewrite or delete history**; RLS alone is insufficient because service_role bypasses it.
- **Type:** posture (a #1 keystone — a buggy or compromised writer must not be able to rewrite the past).
- **Upholds:** #1 (the audit history can never be silently corrupted or deleted) + #3 (tamper-evidence means a rewrite attempt is loud, not silent).
- **Implemented by:** FR-7.LOG.001/007/008 · schema.md §Immutability enforcement (`enforce_audit_append_only()` + the four `t_append_only` triggers on `event_log` / `guardrail_log` / `access_audit` / `config_audit_log`) · rls-policies.md §#1 (the RLS-is-insufficient-for-service_role rationale).
- **Target / threshold:** binary — DELETE forbidden on every audit sink; in-place UPDATE forbidden (only a forward status transition on `guardrail_log` is permitted); enforced at the DB layer, not RLS.
- **Verification:** DOCS (the trigger exists on all four sinks and fires before UPDATE/DELETE) + build-time test (a `service_role` UPDATE/DELETE against a sink is rejected by the trigger).
- **Launch gate:** **blocking** (RP-1 — a #1 property rests on it; the Phase-4 post-sign-off re-audit found the sinks were RLS-only, which service_role bypasses, and added this DB trigger precisely so the guarantee holds against the RLS-exempt writer — it must be in place at go-live).
- **Acceptance criteria:**
  - AC-NFR-CMP.006.1 — Given a `service_role` connection, When it attempts a DELETE on any audit sink, Then the `enforce_audit_append_only()` trigger raises and the row is not deleted — regardless of role.
  - AC-NFR-CMP.006.2 — Given a `service_role` connection, When it attempts an in-place UPDATE on an audit-sink row (other than a permitted forward status transition on `guardrail_log`), Then the trigger rejects it.
  - AC-NFR-CMP.006.3 — Given the deployed schema, When the four audit sinks are inspected, Then each carries a `BEFORE UPDATE OR DELETE` trigger bound to `enforce_audit_append_only()`.
- **Notes / OD:** this is the containment against the one credential that bypasses RLS; the redaction-tombstone (`NFR-CMP.007`) is the *only* sanctioned in-place mutation and is itself append-only-in-spirit + logged.

### NFR-CMP.007 — Redaction-tombstone on erasure (PII scrubbed, row + audit retained)

- **Requirement:** The system shall, on a compliance erasure of a person, apply a **redaction-tombstone** across the log sinks — PII fields scrubbed in place while the row's existence + audit metadata are retained — walking `event_log`, `guardrail_log`, and `config_audit_log`; the tombstone shall be tamper-evident and shall not break the sink's integrity check.
- **Type:** duty.
- **Upholds:** #1 (the audit trail survives the erasure — the fact that events happened is not lost) + #2 (regulated personal data does not survive in a log sink either).
- **Implemented by:** AC-7.LOG.006.3 (event_log) · AC-7.LOG.007.4 (guardrail_log) · AC-7.LOG.008.4 (config_audit_log) · FR-2.MNT.017 / AC-2.MNT.017.4 (the C2 erasure caller that triggers the C7 tombstone) · OD-074.
- **Target / threshold:** binary — erasure scrubs the PII fields in the matching log rows and retains the row + audit metadata; the tombstone is itself a tamper-evident, logged operation.
- **Verification:** build-time test (erasure of a user redacts their PII in `event_log`/`guardrail_log`/`config_audit_log` rows while the rows + audit metadata remain, and the integrity check still passes).
- **Launch gate:** fast-follow / build-time (the tombstone mechanism is a locked-FR posture; erasure completeness across sinks is the AF-137 build-time EVAL of `NFR-CMP.005`).
- **Acceptance criteria:**
  - AC-NFR-CMP.007.1 — Given a compliance erasure of a person, When it runs, Then matching rows in `event_log`, `guardrail_log`, and `config_audit_log` have their PII fields scrubbed while the row + audit metadata are retained.
  - AC-NFR-CMP.007.2 — Given a redaction-tombstone, When the sink's tamper-evidence check runs afterward, Then the check still passes (the tombstone is the sanctioned, logged mutation — see `NFR-CMP.006`).
- **Notes / OD:** OD-074 homed the tombstone; the C10 individual-erasure workflow (FR-10.DEL.004) is the caller, C7 owns the log-side mechanism, C2 (FR-2.MNT.017) wires the walk.

### NFR-CMP.008 — Client offboarding: export-verified-before-delete → sign-off → freeze → hard-delete → meta-record

- **Requirement:** The system shall offboard a client in a fixed, fail-closed sequence: (1) a full data export **verified-complete** (row-count/checksum reconciliation) **before any deletion**; (2) encrypted, time-limited delivery + **client sign-off**; (3) a retention-freeze window (frozen but intact); (4) hard-deletion + deprovision (atomic-or-escalate, never partial-silent); (5) an offboarding **compliance meta-record** written to the management plane only (no client data). A second authoriser is required for the sensitive deletion (`NFR-SEC.015`).
- **Type:** posture + duty (workflow ordering).
- **Upholds:** #1 (data is never destroyed before a verified, acknowledged export exists — no knowledge loss on a corrupt export) + #2 (a distinct second authoriser; the compliance record holds no client data) + #3 (a partial deprovision escalates, never silently marks complete).
- **Implemented by:** FR-10.OFF.002 (export verified-complete before deletion) · FR-10.OFF.003 (encrypted, time-limited delivery + client receipt sign-off) · FR-10.OFF.004 (retention-freeze; frozen ≠ dead) · FR-10.OFF.005 (hard-delete + deprovision, atomic-or-escalate) · FR-10.OFF.006 (mgmt-plane compliance meta-record).
- **Target / threshold:** destruction cannot run without both a verified export **and** `export_acknowledged_at`; delivery link expiry = `data_export_link_expiry_hours` (72h default); freeze window = `client_offboarding_retention_days` (90 default).
- **Verification:** **SPIKE (build-time)** — **⚠️ FEASIBILITY: AF-133** (offboarding export integrity + readability at scale) + **⚠️ FEASIBILITY: AF-132** (deprovision completeness end-to-end across Supabase + Railway + credentials + tokens).
- **Launch gate:** **blocking** for the export-verified-before-delete gate (RP-1 — a #1 property rests on it: destroying data after a corrupt export is knowledge loss; the ordered fail-closed workflow must be in place at launch). The scale EVAL (AF-133) and deprovision-completeness spike (AF-132) are build-time / fast-follow.
- **Acceptance criteria:**
  - AC-NFR-CMP.008.1 — Given an offboarding, When any deletion would run, Then it is blocked until the export is verified-complete (row-count/checksum) **and** `export_acknowledged_at` is set — both are a hard gate (OD-090).
  - AC-NFR-CMP.008.2 — Given a frozen deployment, When the retention window is active, Then the silo is intact but no agents/loops run (frozen ≠ dead; enforced at the C5 dispatch boundary, OD-091).
  - AC-NFR-CMP.008.3 — Given hard-deletion + deprovision, When a sub-step (Supabase/Railway/credential/token) fails, Then the offboarding holds in `deletion_failed` with per-system status + escalation — never marked complete on a partial deprovision (AF-132, OD-089).
  - AC-NFR-CMP.008.4 — Given completion, When the compliance meta-record is written, Then it lives in the management plane and contains no client business data.
- **Notes / OD:** OD-089 (partial-failure holds + escalates, no auto-rollback), OD-090 (export before destruction), OD-091 (freeze enforcement consumer in C5) are the governing resolutions.

### NFR-CMP.009 — Export integrity: all-or-nothing, no silent truncation

- **Requirement:** The system shall make every compliance / config-audit / event-log / offboarding export **all-or-nothing** — it shall never silently truncate; an incomplete export fails loud rather than delivering a partial file that looks complete.
- **Type:** duty.
- **Upholds:** #3 (an export never silently drops rows — a partial result is detectable, not disguised as complete) + #1 (a downstream consumer never destroys data trusting a truncated export).
- **Implemented by:** AC-7.LOG.008.1 (config_audit_log export over a range + key-prefix scope is complete-or-fails) · FR-10.OFF.002 (offboarding export verified-complete via row-count/checksum).
- **Target / threshold:** binary — export completeness is reconciled (row-count/checksum); on shortfall the export fails, it does not truncate.
- **Verification:** build-time test (a forced shortfall in an export path fails loud; no partial file is emitted as complete) + the offboarding-scale check is AF-133 (see `NFR-CMP.008`).
- **Launch gate:** blocking (a #3 property — a silently-truncated compliance export is exactly the "fail silently" failure the invariants forbid).
- **Acceptance criteria:**
  - AC-NFR-CMP.009.1 — Given any compliance/audit/offboarding export, When the produced row set is smaller than the reconciled expectation, Then the export fails loud (error + no "complete" claim), never delivering a silently-truncated file.
- **Notes / OD:** shares the reconciliation mechanism with FR-10.OFF.002's verified-complete gate.

### NFR-CMP.010 — HR content disabled by default, legal-review-gated

- **Requirement:** The system shall keep HR-related content **out of memory by default** and shall allow it only after a legal-review gate clears it — `hr_content_enabled=false` unless legally cleared.
- **Type:** posture.
- **Upholds:** #2 (the system does not ingest a high-sensitivity, regulated data class until a human legal step permits it — fail-safe to off).
- **Implemented by:** FR-10.LEG.001 · config `hr_content_enabled` (default `false`, BOOT, bool; legal review gate).
- **Target / threshold:** `hr_content_enabled=false` at boot; flips to true only via the FR-10.LEG.001 legal-review gate.
- **Verification:** DOCS (config default) — the enablement is gated by the FR-10.LEG.001 legal review (**⚠️ FEASIBILITY: AF-136**, legal-review-gated, not a code spike).
- **Launch gate:** blocking (the default-off posture is a #2 governance posture that must be in place at launch; the legal-review clearance to *enable* is per-client and legal-gated).
- **Acceptance criteria:**
  - AC-NFR-CMP.010.1 — Given a fresh deployment, When it boots, Then `hr_content_enabled=false` and no HR-related content enters memory.
  - AC-NFR-CMP.010.2 — Given HR content is enabled, When the change is made, Then it is the output of the FR-10.LEG.001 legal-review gate, not an engineering default.
- **Notes / OD:** —

### NFR-CMP.011 — Mandatory legal review before regulated personal data; change-control binds ADR postures

- **Requirement:** The system shall require a **legal review before handling regulated personal data** — the review sets/confirms the retention values (FR-10.RET.002) and deletion procedures by jurisdiction — and any change to a locked ADR posture that these NFRs rest on shall go through **change-control**, never a silent edit.
- **Type:** duty + posture (governance).
- **Upholds:** #2 (regulated personal data is not handled until a human legal step approves the posture) + #1 (the locked postures — residency, immutability, retention floors — cannot be silently weakened).
- **Implemented by:** FR-10.LEG.001 · change-control.md (supersede-ADR / open-OD for any change to a locked posture).
- **Target / threshold:** N/A (governance posture) — legal review is a precondition to handling regulated data; ADR changes require change-control.
- **Verification:** DOCS — **⚠️ FEASIBILITY: AF-136** (the per-jurisdiction lawful minimums are a legal/DOCS question) + change-control review of any posture change.
- **Launch gate:** fast-follow / legal-gated (the change-control governance is in place; the legal review is a per-client, legal-gated precondition — AF-136 is not among the six globally launch-blocking spikes).
- **Acceptance criteria:**
  - AC-NFR-CMP.011.1 — Given a deployment about to handle regulated personal data, When it goes live for that client, Then a legal review has set/confirmed the retention values + deletion procedures for the jurisdiction (FR-10.LEG.001, AF-136).
  - AC-NFR-CMP.011.2 — Given a proposed change to a locked ADR posture underpinning an `NFR-CMP` row (residency, immutability, retention floor), When it is made, Then it passes change-control (supersede/OD) — not a silent edit.
- **Notes / OD:** binds ADR-001 (residency/isolation), ADR-008 (golden rule / backup scope), and the C7/schema immutability posture to change-control.

---

*Drafted session 45 (2026-07-01). Cites verified against `component-10-infra-compliance.md`,
`component-02-memory.md` (FR-2.MNT.017 / AC-2.MNT.017.4), `component-07-observability.md`
(FR-7.LOG.001/007/008, AC-7.LOG.006.3/007.4/008.1/008.4), `schema.md` §Immutability enforcement
(`enforce_audit_append_only()` + the four `t_append_only` triggers), `rls-policies.md` §#1,
`config-registry.md` (`deployment_region` · `event_log_retention_window` ·
`client_offboarding_retention_days` · `individual_deletion_audit_years` ·
`data_export_link_expiry_hours` · `hr_content_enabled`), `ADR-008-backup-dr.md` (golden rule, L1634),
and the feasibility register (AF-071/132/133/134/136/137) at draft. Re-checked by the Phase-5
verification gate.*
