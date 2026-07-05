---
id: ISSUE-084
title: Retention configs + isolation (client_slug deleted) + residency + legal-review gate
epic: K — infra & compliance
status: in-progress
github: "#84"
---

# ISSUE-084 — Retention configs + isolation (client_slug deleted) + residency + legal-review gate

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Land the C10 compliance *invariants and knobs* — the intentional-retention principle (hard-delete only via the two sanctioned paths), the four Super-Admin retention-config values with legal-minimum floors, the `client_slug`-deleted-from-app-tables isolation invariant + physical-isolation deletion-evidence + v1 Sydney residency lock, and the mandatory legal-review gate before regulated personal data.

## 2. Scope — in / out
**In:**
- The **intentional-retention** operating principle: no routine operation (decay/supersede/archive/cold-tier) hard-deletes a record, and every hard-delete traces to exactly one of the two sanctioned lawful paths (individual erasure / offboarding), each authorised + audited; the C2 sole-writer + tombstone model is the *detector* of a violation (a tombstone with no DEL/OFF authorisation behind it) — FR-10.RET.001.
- The four retention-policy **config values** homed in the ISSUE-010 config store: `CFG-client_offboarding_retention_days` (90), `CFG-individual_deletion_audit_years` (7), `CFG-data_export_link_expiry_hours` (72), `CFG-deletion_two_person_auth_required` (true) — Super-Admin-gated, legal-minimum-floor-validated on write (reject below floor with the floor surfaced), every change audited — FR-10.RET.002.
- The **isolation invariant**: no `client_slug`/client-identity column in any application table (client identity lives only in management-plane `client_registry`); the Phase-4 schema realises this and the three prior "label" mentions (C5 FR-5.QUE.002, C2, C6 `guardrail_log`) get their clerical reconciliation note (OD-096) — FR-10.ISO.001.
- **Physical-isolation deletion evidence**: the property that deprovisioning a client's Supabase project is airtight proof the data is gone (no shared store could retain a copy) — FR-10.ISO.002.
- **Residency**: v1 region default `ap-southeast-2`, recorded per deployment in `client_registry.region`; v2 selection knob (`CFG-deployment_region`) stubbed — FR-10.ISO.003.
- The **legal-review gate**: a qualified-lawyer review of the retention values + deletion procedures is a *precondition* before a deployment handles a jurisdiction's regulated personal data, and before jurisdiction-sensitive features (e.g. HR content) are enabled — FR-10.LEG.001.

**Out:**
- The **erasure / offboarding hard-delete mechanics** themselves — RET.001 only *constrains* them: the individual right-to-erasure workflow is **ISSUE-082** (FR-10.DEL.*), client offboarding (export/verify/freeze/deprovision/meta-record) is **ISSUE-083** (FR-10.OFF.*), and the C2 transitive delete + tombstone is **ISSUE-029** (FR-2.MNT.017).
- The **config store / secret manifest / config-audit-log immutability** that homes these `CFG-` keys and audits their edits: **ISSUE-010** (built on, not built here — this issue *registers* the four keys + floor-validation logic into it).
- The **migration harness + Phase-4 schema DDL** that authors the no-`client_slug` tables: **ISSUE-008** (this issue owns the *invariant + its lint/assert*, not the base migration machinery).
- The **management-plane `client_registry` schema + status lifecycle + ingest** (`region` column lives there): **ISSUE-012** (C10 MGT); referenced as the home of client identity + region, not built here.
- The **backup / off-platform residency** track (AF-071): Phase-5 backup + **ISSUE-085** (ADR-008); referenced for the residency-of-backups edge, not built here.
- All **rendering** (retention-policy config surface, region-in-mgmt-plane view): Phase 3 — this issue owns the value contract + validation, not the surface.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-10.RET.001, FR-10.RET.002, FR-10.ISO.001, FR-10.ISO.002, FR-10.ISO.003, FR-10.LEG.001 (all Component 10 — Infra & Compliance).
- **NFRs:** NFR-CMP.001 (v1 residency lock), NFR-CMP.003 (hard-delete only via erasure/offboarding), NFR-CMP.004 (retention values with legal floors), NFR-CMP.011 (legal review before regulated data + change-control binds ADR postures), NFR-SEC.001 (physical per-client isolation).
- **Rests on:** ADR-001 §1 (physical isolation), §3 (`client_slug` deleted from all app tables), §4 (RLS never enforces client separation), §Consequences (offboarding-provably-clean + residency-trivially-possible + v1 Sydney); ADR-004 (sole-writer + tombstone as the RET.001 detector); ADR-006 (intra-client-only RLS — no `client_slug` predicate); AF-136 (jurisdiction-specific lawful minimums are legal-review-gated, not spec'd), AF-071 (backup/data residency for AU region — Phase-5 track).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-10.RET.001.1, AC-10.RET.001.2, AC-10.RET.001.3 (FR-10.RET.001 — no routine hard-delete; every hard-delete traces to a sanctioned path; tombstone-without-authorisation is the detectable violation)
- AC-10.RET.002.1, AC-10.RET.002.2, AC-10.RET.002.3 (FR-10.RET.002 — defaults resolve; below-floor rejected + non-Super-Admin rejected; change audited)
- AC-10.ISO.001.1, AC-10.ISO.001.2, AC-10.ISO.001.3 (FR-10.ISO.001 — no `client_slug` column; identity only in registry; OD-096 clerical reconciliation note)
- AC-10.ISO.002.1 (FR-10.ISO.002 — no shared store could retain client data)
- AC-10.ISO.003.1, AC-10.ISO.003.2 (FR-10.ISO.003 — v1 default `ap-southeast-2` recorded; v2 selectable)
- AC-10.LEG.001.1, AC-10.LEG.001.2 (FR-10.LEG.001 — legal review before regulated data; precondition for HR-content enablement)
- AC-NFR-CMP.001.1, AC-NFR-CMP.001.2 (residency recorded not silently defaulted; surfaced under legal review)
- AC-NFR-CMP.003.1, AC-NFR-CMP.003.2 (no incidental delete path; every hard-delete audited)
- AC-NFR-CMP.004.1, AC-NFR-CMP.004.2 (each window Super-Admin-gated + `≥ legal floor`; legal-review-set, not engineering default)
- AC-NFR-CMP.011.1, AC-NFR-CMP.011.2 (legal review before go-live; ADR-posture change goes through change-control)
- AC-NFR-SEC.001.1, AC-NFR-SEC.001.2 (no `client_slug`/tenant column on any app table; every query targets this silo only)
- **Gating spikes (if any):** none. Blocked-by ISSUE-008/ISSUE-010 are **not** spikes (Epic A foundations). The gating AFs here are **build-time legal/DOCS**, not launch-gating: **AF-136** (lawful minimums are legal-review-gated — the floor is a configurable safeguard, satisfied by the FR-10.LEG.001 process, not by an engineering value) and **AF-071** (backup residency — Phase-5 track, referenced not resolved here).

## 5. Touches (complete blast radius, by ID)
- **DATA:** the whole application schema (the *absence* of any `client_slug`/client-identity column — FR-10.ISO.001 / AC-NFR-SEC.001.1); `config_values` (the four `CFG-` retention keys land here); `config_audit_log` (the audit sink for each retention-value edit, via ISSUE-010); `client_registry.region` (management plane — read/set for residency; owned by ISSUE-012); the C2 `DATA-memories` tombstone (the RET.001 violation detector; owned by ISSUE-029/C2).
- **PERM:** `PERM-config.infra` (Super Admin — the only editor of the four retention values + residency).
- **CFG:** `CFG-client_offboarding_retention_days`, `CFG-individual_deletion_audit_years`, `CFG-data_export_link_expiry_hours`, `CFG-deletion_two_person_auth_required`, `CFG-deployment_region` (v2 stub).
- **UI:** none built here (the retention-policy config surface + region-in-mgmt-plane view are Phase 3; the legal-review checklist is an operational doc, not a product surface).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-10-infra-compliance.md — the FR text + ACs (RET.001/002, ISO.001/002/003, LEG.001) and the OD-096 reconciliation note.
- spec/05-non-functional/compliance.md — NFR-CMP.001, NFR-CMP.003, NFR-CMP.004, NFR-CMP.011 (the residency/retention/legal posture + change-control binding).
- spec/05-non-functional/security.md — NFR-SEC.001 (physical per-client isolation; the no-`client_slug` schema assertion).
- spec/04-data-model/schema.md §12 (Config cluster — `config_values`/`secret_manifest` where the four `CFG-` keys live), §13 (Management plane — `client_registry` incl. `region`, the one valid home of `client_slug`), §8 (Observability — `config_audit_log` audit sink); the top-of-file note that `client_slug` is confined to the management deployment.
- spec/00-foundations/adr/ADR-001-isolation-model.md — §1/§3/§4/§Consequences (the isolation + residency spine).
- spec/00-foundations/feasibility-register.md — AF-136 (lawful minimums), AF-071 (backup residency).

## 7. Dependencies
- **Blocked-by:** ISSUE-008 (migration harness + 0001 baseline — the Phase-4 schema that authors the no-`client_slug` application tables is realised on it), ISSUE-010 (config store + secret manifest + config-audit-log immutability — homes the four retention `CFG-` keys and audits their edits). Neither is a spike.
- **Blocks:** none (leaf). *(Consumers reference these invariants but are not gated by this file: ISSUE-082/083 enforce RET.001's two-path constraint; ISSUE-012 owns `client_registry.region`.)*

## 8. Build order within the slice
1. **Retention-config registration** — register the four `CFG-` keys in the ISSUE-010 config store with their defaults (90 / 7 / 72 / true), each behind `PERM-config.infra` (Super Admin) via key-prefix RLS on `config_values` (schema §12) — FR-10.RET.002 → AC-10.RET.002.1.
2. **Floor-validation on write** — add the legal-minimum-floor check so a value set below its floor is rejected with the floor surfaced, and a non-Super-Admin edit is rejected by RBAC; wire the change to `config_audit_log` (schema §8, via ISSUE-010) — FR-10.RET.002 → AC-10.RET.002.2/.3, NFR-CMP.004; the *actual* floor value is set by the legal review, not hard-coded (AF-136).
3. **Isolation invariant + lint** — assert the Phase-4 schema (ISSUE-008) creates **no** `client_slug`/client-identity column on any application table, and add a schema-lint/CI assert that fails the build if one appears; confirm client identity + `region` live only in management-plane `client_registry` (schema §13) — FR-10.ISO.001 → AC-10.ISO.001.1/.2, NFR-SEC.001 → AC-NFR-SEC.001.1/.2.
4. **OD-096 reconciliation note** — carry the clerical "column not created" note to the three prior FRs (C5 FR-5.QUE.002, C2, C6 `guardrail_log`); no behavioural change (the column was never load-bearing for RLS or any filter) — FR-10.ISO.001 → AC-10.ISO.001.3.
5. **Deletion-evidence property** — record the physical-isolation guarantee that deprovisioning a client's Supabase leaves no residue in any shared store (there is none), consumed by offboarding (ISSUE-083) as its completeness proof — FR-10.ISO.002 → AC-10.ISO.002.1.
6. **Residency** — set the v1 provisioning region default `ap-southeast-2` and record it in `client_registry.region` (schema §13); stub the v2 `CFG-deployment_region` selection knob; surface residency under onboarding legal review (AF-071 for backup residency is the Phase-5 edge) — FR-10.ISO.003 → AC-10.ISO.003.1/.2, NFR-CMP.001.
7. **RET.001 principle + detector** — assert the intentional-retention constraint (routine ops never hard-delete; every hard-delete traces to a sanctioned DEL/OFF path); wire the C2 sole-writer + tombstone (ISSUE-029) as the detector so a tombstone with no DEL/OFF authorisation behind it is the flagged violation — FR-10.RET.001 → AC-10.RET.001.1/.2/.3, NFR-CMP.003.
8. **Legal-review gate** — make a qualified-lawyer review of retention values + deletion procedures a precondition (onboarding checklist / go-live gate) before regulated personal data or jurisdiction-sensitive features (HR content) are enabled; bind ADR-posture changes (residency/immutability/retention floor) to change-control — FR-10.LEG.001 → AC-10.LEG.001.1/.2, NFR-CMP.011.
9. Test to each AC in field 4 (config validation, schema-absence lint, residency default, RET.001 detector, legal-gate precondition).

## 9. Verification (how DoD is proven)
- **Schema/lint layer:** per spec/05-non-functional/test-strategy.md — a schema-absence lint over every application table (no `client_slug`/tenant column) proves AC-10.ISO.001.1 / AC-NFR-SEC.001.1; a silo-scoped connection assert proves AC-NFR-SEC.001.2; identity-only-in-registry proves AC-10.ISO.001.2; the OD-096 note-presence check proves AC-10.ISO.001.3.
- **Config layer:** default resolution (90/7/72/true) proves AC-10.RET.002.1; a below-floor write rejected-with-floor + a non-Super-Admin edit rejected proves AC-10.RET.002.2 / AC-NFR-CMP.004.1; the audited change proves AC-10.RET.002.3; residency default recorded (not silently defaulted) proves AC-10.ISO.003.1 / AC-NFR-CMP.001.1, and the v2 selectable path proves AC-10.ISO.003.2.
- **Invariant layer:** an inventory of every hard-delete path showing each is DEL or OFF (no incidental path) proves AC-10.RET.001.1/.2 / AC-NFR-CMP.003.1; a tombstone-without-authorisation flagged as a violation proves AC-10.RET.001.3; each hard-delete emitting an audit record proves AC-NFR-CMP.003.2; deprovision-leaves-no-shared-residue proves AC-10.ISO.002.1.
- **Process/legal gate:** the FR-10.LEG.001 review as a documented go-live precondition proves AC-10.LEG.001.1/.2 / AC-NFR-CMP.004.2 / AC-NFR-CMP.011.1, and the residency-surfaced-under-review path proves AC-NFR-CMP.001.2; an ADR-posture change routed through change-control proves AC-NFR-CMP.011.2. AF-136 (lawful minimums) is satisfied by this legal process, not by an engineering value; AF-071 (backup residency) is carried to the Phase-5 backup track (ISSUE-085), referenced not resolved here.
