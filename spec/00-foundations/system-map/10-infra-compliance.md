# Zoom-in: C10 Infrastructure & Compliance — "how it is deployed, deprovisioned, and lawfully deleted"

This opens up the **deployment / management-plane / lawful-deletion layer**: how a client deployment is
**provisioned**, how a core update **reaches the fleet safely** (canary + release-train), how the operator **sees the
fleet** (the management plane), and how data is **lawfully retained, erased, and offboarded**. It reflects the C10
resolutions (OD-089…OD-096) + the verification-gate hardening (H1 frozen-vs-dark, H2 verify-fails-closed, M1 erasure
verify-before-done, M2…M4, L1, AF-132…137). **The final Phase-1 component.** Where this map and a requirement
disagree, the requirement wins.

**Scope (what C10 owns):** the **intentional-retention** principle + retention configs · the **individual
right-to-erasure** workflow (wraps C2) · the **client offboarding** workflow (export → freeze → deprovision →
meta-record) · **provisioning** orchestration (Railway link, secrets, `internal_token`, `client_registry` insert,
seed trigger) · the **release model** (auto-deploy, canary/release-train promotion gate, rollback, version-skew alert,
plugins-out-of-train) · **schema-migration propagation** + per-deployment failure isolation · the **management plane**
(`client_registry` + the ingest endpoint) · **isolation** (`client_slug` deletion) + **residency**.
**Seams out (what C10 does NOT own):** **memory erasure mechanics** → **C2** FR-2.MNT.017 (C10 calls it) · **log
redaction-tombstone** → **C7** AC-7.LOG.006.3/007.4 · **credential/OAuth-token lifecycle + revocation runtime** →
**C3** FR-3.TOK.* · **first-boot seed** → **C0/C1** · the **health-reporter push + dashboards + staleness detector**
→ **C7** FR-7.MGM.* · **backup/DR** (snapshot, restore-rehearsal) → **Phase 5** + ADR-008 · all **rendering** (the
offboarding wizard, deletion queue, fleet grid) → **Phase 3**.

## Two — and only two — hard-delete paths (RET.001, the #1 invariant)

```
Routine operation NEVER hard-deletes — decay/supersede/archive keep the record (C2).
The ONLY hard-delete paths, each authorised + audited:
   ① individual right-to-erasure  (one person — DEL.*)
   ② client offboarding           (a whole client — OFF.*)
Enforcement consumer: the C2 sole-writer + tombstone (ADR-004) — a hard-delete whose
tombstone has no DEL/OFF authorisation behind it is the detectable violation.  (RET.001.3, gate L1)
```

## Path ① — Individual right-to-erasure (DEL.*, design §10 Scenario 2)

```
 Admin deletion-request QUEUE (documented; escalates if un-actioned)        (DEL.001)
        │
   Step 1  IDENTIFY affected records                                        (DEL.002)
        │     (a) deterministic — entity_id ∈ entity_ids[]  → auto-action
        │     (b) probabilistic — name/identifier in content → HUMAN CONFIRM (never auto)  [AF-134]
        ▼
   Step 2-3  entity_id removal → empty? hard-delete (via C2 FR-2.MNT.017) :  (DEL.003)
        │      keep + audit-note ;  delete the entity record + entity-only data
        │      VERIFY C2 returned complete BEFORE the audit-done record       (DEL.003.4, gate M1) [AF-137]
        ▼
   Step 4  CONTENT SCRUB [REDACTED] (human-confirmed) — also triggers         (DEL.004)
        │      C7 log redaction on event_log/guardrail_log (C2 AC-2.MNT.017.4, OD-074)
        ▼
   Step 5  permanent DELETION AUDIT LOG (who/when/counts; 7y; no PII)         (DEL.005)
        │      audit-write failure → erasure FAILS CLOSED (never silently done)  (DEL.005.3)
        ▼
   Step 6  CONNECTOR-NOTIFY flag (tracked till acked; harness never deletes SoR) (DEL.006)
           + two-person auth for Restricted/Personal (distinct authoriser)      (DEL.006, OD-093)
           config-unreadable / detection-error → FAIL CLOSED                     (DEL.006.4, gate M2)
```

## Path ② — Client offboarding (OFF.*, design §10 Scenario 3)

```
   Step 1  Super-Admin TRIGGER (request or contract-end) → status=offboarding  (OFF.001)
        ▼
   Step 2  full EXPORT (memories+entities+logs+queue; JSON+CSV) — VERIFIED      (OFF.002)
        │      complete (checksum); verify-itself-errors → FAIL CLOSED          (OFF.002.4, gate H2)
        ▼
        │  encrypted, time-limited link → CLIENT RECEIPT SIGN-OFF               (OFF.003)
        │      ack-write-fail ≠ slow-client (escalate the defect)               (OFF.003.4, gate M2)
        ▼
   Step 3  RETENTION WINDOW + FREEZE (default 90d)  status=frozen               (OFF.004)
        │      C5 dispatch gate blocks every trigger/agent/loop + FAILS CLOSED   (AC-5.TRG.001.3, OD-091) [AF-135]
        │      frozen ≠ dead: C7 staleness reads status (expected-quiet, not     (OFF.004.4, gate H1)
        │      a dead-alert) WHILE Supabase project-health still monitored
        │      reactivation within window → unfreeze, data intact
        ▼
   Step 4  HARD DELETE + DEPROVISION  (after window)                            (OFF.005)
        │      revoke internal_token FIRST (no live cred for a dead deploy)      (OFF.005.5, gate M4)
        │      truncate/drop → deprovision Supabase → Railway → creds → revoke   (OFF.005.1)
        │         OAuth tokens (C3); each idempotent + recorded
        │      sub-step fails → status=deletion_failed + escalate; NEVER         (OFF.005.2, OD-089)
        │         "complete" on partial; NO auto-rollback (fix forward, OD-010)  [AF-132]
        │      progress + meta-record on the MANAGEMENT PLANE (resumable)        (OFF.005.4, gate M3)
        ▼
   Step 5  offboarding META-RECORD (mgmt plane; no client data; proof)          (OFF.006)
           physical isolation = airtight deletion evidence (ADR-001)            (ISO.002)
```

## The fleet: provisioning · release model · management plane

```
 PROVISIONING (operator-side, scripted — ADR-005 §5)                          (PRV.001)
   Railway link → DEPLOYMENT_CONFIG + secrets → mint internal_token (dual-store)
   → insert client_registry row → first deploy → C0/C1 seed → status=initialising
   operator-side registration ONLY (no self-register); loud on partial   [AF-004]
   + per-client OAuth apps in the client's accounts (Google verify lead) (PRV.002) [AF-013]
   + canary = seeded synthetic client (smoke battery = promotion gate)   (PRV.003) [AF-066]

 RELEASE MODEL (ADR-005 §1-4,7)
   Railway per-project auto-deploy; GH Actions = test gate only          (DEP.001) [AF-020]
   feature → release (CANARY) → promote (tests+migration+smoke+soak) → main (FLEET)  (DEP.002) [AF-064]
   rollback = code-redeploy prior build; schema rolls FORWARD (no down-migration) (DEP.003) [AF-065]
   version-skew alert: >3 versions / >14 days stale (config)             (DEP.004, OD-095)
   plugins OUT of the train; version-reported (auto-distribution → OOS-033) (DEP.005)

 MIGRATION PROPAGATION (L1138-1160)
   each deployment migrates its OWN Supabase on release                  (MIG.001)
   failure HALTS only that client (prior version live) + ALERTS; never silent, (MIG.002)
   never touches another client (Silo isolation)

 MANAGEMENT PLANE (ADR-001 §7) — push-only, operational-metadata-only
   client_registry = the ONLY home of client identity (status lifecycle) (MGT.001)
   ingest endpoint: deployment authenticates with internal_token         (MGT.002)
   PUSH not pull (no /api/internal/status); map, not warehouse           (MGT.003)
   internal_token: mint→dual-store→rotate→revoke-on-offboard             (MGT.004)
   [C7 owns the reporter that pushes + the dashboards + the staleness detector]
```

## Isolation & residency (ISO.*)

```
 client_slug DELETED from all application tables (ADR-001 §3)                  (ISO.001, OD-096)
   — survives ONLY in management-plane client_registry
   — prior "label, not RLS key" reconciliation carried to the ADR terminus (delete); not load-bearing
 physical isolation = provable deletion evidence at offboarding                (ISO.002)
 residency: v1 region lock Sydney ap-southeast-2; recorded in registry;        (ISO.003)
   v2 region-selectable at creation                                            [AF-071 → Phase 5]
 LEGAL review required before regulated personal data (AU/UK/EU/US)            (LEG.001) [AF-136]
```

## Where the decisions / config / feasibility live

- **Decisions (this component):** OD-089 (partial-deprovision fail handling) · OD-090 (export-verified gate) · OD-091
  (freeze enforcement via C5) · OD-092 (erasure human-confirm) · OD-093 (no self-second-auth) · OD-094 (manual
  promotion v1) · OD-095 (skew defaults) · OD-096 (`client_slug` delete). **Carry-in cleared:** OD-068 (C6 cost-ladder
  FR-6.RTL.004) · OD-074 (C2 log-redaction AC-2.MNT.017.4).
- **Config (Phase 2):** `client_offboarding_retention_days` (90) · `individual_deletion_audit_years` (7) ·
  `data_export_link_expiry_hours` (72) · `deletion_two_person_auth_required` (true) · `canary_soak_minutes` ·
  `deploy_max_version_skew` (3) · `deploy_max_skew_days` (14) · `deployment_region` (v2).
- **Feasibility (block U, build-time):** AF-132 (deprovision completeness) · AF-133 (export integrity) · AF-134
  (erasure recall) · AF-135 (freeze propagation) · AF-136 (legal minimums) · AF-137 (erasure completeness verify).
  Carried-in: AF-004/013/020/064/065/066/071.
- **Surfaces (Phase 3):** the Super-Admin offboarding wizard · the Admin deletion queue · the fleet version/skew grid ·
  the region/plugin-drift views. C10 owns the workflow + state contract; Phase 3 renders.
```
