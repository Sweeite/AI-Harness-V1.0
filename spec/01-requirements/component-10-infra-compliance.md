# Component 10 — Infrastructure & Compliance (how it is deployed, deprovisioned, and lawfully deleted)

- **Status:** 🟢 **Approved 2026-06-27 (session 27)** — user-authorized ("i approve"; OD-089…096 delegated to
  recommendation). Verification gate run + reconciled. **34 FRs `Approved`.** **The FINAL Phase-1 component — Phase 1
  COMPLETE.** Area codes: RET ×2 · DEL ×7 · OFF ×6 · PRV ×4 ·
  MGT ×4 · DEP ×5 · MIG ×2 · ISO ×3 · LEG ×1 (**34 FRs**).
- **Verification gate (2 zero-context subagents, 2026-06-27):** **Orphan/contradiction pass CLEAN** — zero orphans
  (every intent L3919–4112 + the infra cross-cut sources L15–36/L1138–1160/L1164–1240 maps to an FR / seam / OOS;
  cold storage → OOS-016, backup/DR → Phase 5, dashboards → Phase 3), **all 6 traps PASS** (`client_slug` deleted
  from app tables + OD-096 reconciled · backup/DR seamed not owned · management plane push-only + metadata-only ·
  erasure mechanics delegated to C2 · deletion deliberate-never-partial-silent · 10/10 citations sound), all 3
  in-session change-control edits (C6 FR-6.RTL.004, C2 AC-2.MNT.017.4, C5 AC-5.TRG.001.3) consistent. **Quality pass
  — 9 findings (2 HIGH, 4 MED, 3 LOW), ALL reconciled in-file:** **H1** frozen-vs-dark deployment seam → +AC-10.OFF.004.4
  (status server-authoritative, consumed by C7 staleness — frozen = expected-quiet not dead-alert, but project-health
  independently monitored). **H2** export-verification could fail open → +AC-10.OFF.002.4 (verification fails closed —
  only an affirmative verified-complete result advances). **M1** the C2 erasure C10 calls had no verify-complete /
  fail-closed guarantee → +AC-10.DEL.003.4 (verify C2 returned complete before the DEL.005 "done" audit) + C2
  AC-2.MNT.017.5 (erasure verified-complete-or-fails-loud) + **AF-137**. **M2** fail-open in two-person-config /
  connector-flag-raise / ack-write → +AC-10.DEL.006.4 + AC-10.OFF.003.4. **M3** offboarding progress + meta-record
  must be management-plane-resumable → +AC-10.OFF.005.4. **M4** token revoke could orphan a live credential →
  +AC-10.OFF.005.5 (revoke first / independently re-driven). **L1** RET.001 had no enforcement consumer →
  +AC-10.RET.001.3 (C2 sole-writer + tombstone is the detector). **L2** header count fixed (34). **L3** neighbouring
  stale notes cleaned (C5 header, C7 carry-forward).
  C10 is the **deployment / management-plane / lawful-deletion layer** — how a client deployment is *provisioned*,
  how core updates *reach the fleet safely*, how the operator *sees the fleet* (management plane), and how data is
  *lawfully retained, erased, and offboarded*.
- **Scope decision (entry, operator-confirmed):** **functional infra + compliance in C10; backup/DR seams to
  Phase 5.** The design doc's literal `## 10.` section (L3919–4112) is *only* compliance (retention / individual
  erasure / client offboarding). The **infrastructure** half of "Infrastructure & Compliance" is decided in the
  ADRs (001 / 005) and lives in orphaned design lines (the deployment model L15–36, schema-migration propagation
  L1138–1160, the management plane / `client_registry` L1164–1240) that **no component C0–C9 has claimed**. Since
  "every design line → ≥1 FR, no orphans" is the definition of done and C10 is the final Phase-1 component, C10
  closes those orphans as **functional** FRs (provisioning orchestration, release model, management-plane ingest +
  registry, migration-failure isolation, the `client_slug` app-table removal, region/residency). **Backup/DR
  scheduling + restore-rehearsal (ADR-008) seams to Phase 5** — already routed there (C2 AC-2.MNT.017.2, README
  Phase-5 row), and design §10 never mentions backups; C10 only *references* it.
- **What C10 owns:**
  - **Lawful retention + deletion** — the intentional-retention principle + the configurable retention values; the
    **individual right-to-erasure workflow** (intake queue, identify-affected, conditional entity-id-removal /
    hard-delete, content redaction, deletion audit log, connector-notify flag, two-person auth) **wrapping** C2's
    erasure mechanics; the **client offboarding workflow** (trigger → export → retention-freeze → hard-delete /
    deprovision → compliance meta-record).
  - **Provisioning** — the operator-side provisioning script (Railway link, `DEPLOYMENT_CONFIG` + secrets,
    `internal_token` mint + dual-store, `client_registry` insert, first-deploy → seed) + per-client OAuth-app
    registration; operator-side registration only (no deployment self-registration).
  - **The release model** — Railway per-project auto-deploy; the canary + release-train promotion gate;
    rollback-by-code-redeploy (no destructive down-migration); per-deployment version reporting + the max-skew alert;
    plugins out of the train.
  - **Schema migration propagation** — per-deployment migrate-on-release with **per-client failure isolation +
    alert** (one client's migration failure never touches another).
  - **The management plane** — the `client_registry` schema + status lifecycle; the **ingest endpoint** each
    deployment authenticates *to* with its `internal_token`; push-only (no pull).
  - **Isolation + residency** — the `client_slug` removal from all application tables (ADR-001 §3); physical
    isolation as offboarding deletion-evidence; the v1 region lock (Sydney `ap-southeast-2`) + region documented in
    the management plane + v2 region selection.
- **What C10 is NOT (seams):**
  - **Memory erasure mechanics** → **C2 FR-2.MNT.017** (transitive hard-delete across the supersede chain +
    derived/merged rows + embeddings + tombstone). C10 owns the *request workflow + authorisation + audit + connector
    flag*; it **calls** C2's mechanism, never re-implements it.
  - **Log redaction-tombstone** for `event_log` / `guardrail_log` on erasure → **C7 AC-7.LOG.006.3 / AC-7.LOG.007.4**.
    C10's erasure workflow *triggers* it (see the C2 MNT.017 amendment, OD-074, actioned this session).
  - **Credential / OAuth-token lifecycle + revocation runtime** → **C3 FR-3.TOK.*** (storage in Supabase Vault,
    refresh, the per-connector revocation endpoint). C10's offboarding *invokes* revocation; C3 owns the call.
  - **First-boot seed** (Internal Org + first Super Admin) → **C0 FR-0.SEED.001/002/003** + **C1 FR-1.ROLE.001**.
    C10's provisioning *triggers* the seed; C0/C1 own the seed logic.
  - **The management-plane dashboard surfaces + the outbound health-reporter + payload validation + the staleness
    detector** → **C7 FR-7.MGM.001…005** (push model, operational-metadata-only boundary, deployment health grid,
    backup-health, cost overview). C10 owns the **ingest endpoint + the `client_registry` it writes**; C7 owns the
    **reporter that pushes + the dashboard that reads**.
  - **Backup / DR** — hourly off-platform snapshot, PITR upsell, restore-rehearsal → **Phase 5** + **ADR-008**. C10
    references it — **individual erasure** flags the per-record backup-purge via C2 AC-2.MNT.017.2 (FR-10.DEL.006(a));
    **offboarding** separately flags the client's entire off-platform backup for purge/retention-expiry
    (FR-10.OFF.005 AC-10.OFF.005.6, H30) — it does not own the schedule/restore.
  - **All rendering** — the Super-Admin offboarding wizard, the Admin deletion queue, the fleet version grid →
    **Phase 3**. C10 owns the *workflow + state contract*; Phase 3 renders.
  - **The migration-discipline standard** (`standards/migration-discipline.md`) is a binding cross-component
    constraint C10 *depends on* (expand-contract); each component owns its own migrations.
- **Design-doc source:** `## 10. Infrastructure & Compliance` = **L3919–L4112** (next `## Where the quality
  actually lives` at L4113). Load-bearing blocks: intentional-retention principle **L3923–3947**; cold-storage
  (→ OOS-016) **L3937–3942**; individual erasure flow **L3956–4013** (identify L3959–3965, entity-id removal
  L3967–3976, entity-record delete L3978–3981, content scrub L3983–3989, deletion audit L3991–4003, connector flag
  L4005–4012); who-can-execute + two-person auth **L4015–4017**; client offboarding **L4021–4089** (trigger
  L4028–4032, export L4034–4047, retention freeze L4049–4058, hard deletion L4060–4071, meta-record L4073–4088);
  configurable retention values **L4091–4099**; dashboards **L4101–4105**; legal disclaimer **L4107–4109**.
  **Infra cross-cut sites** (orphans claimed here): deployment model **L15–36**, tech stack **L37–173**, schema-
  migration propagation **L1138–1160**, management deployment + `client_registry` **L1164–1240** (registry schema
  L1222–1239, `internal_token` L1200–1215).

---

## Context manifest (load only these)

- **ADR-001 (Isolation Model)** — Silo (one isolated Supabase + Railway per client); **§3 `client_slug` deleted
  from all application tables** (identity lives *only* in the management-plane `client_registry`); **§5 hybrid
  ownership** (client owns data + cost accounts; operator owns Railway compute); **§6 Railway-native auto-deploy on
  push**; **§7 management plane** — own deployment, holds `client_registry` only, **operational-metadata-only
  boundary** (no business data crosses), **push not pull**. Offboarding-by-deprovision = airtight deletion evidence
  (§Consequences). v1 region = Sydney `ap-southeast-2`.
- **ADR-005 (Deploy / Provisioning)** — 7 binding parts: **§1** Railway per-project auto-deploy, GitHub Actions is a
  test gate only; **§2** canary + release-train (`release`→canary→promote→`main`), promotion gated on tests +
  migration-clean-on-canary + smoke-battery + soak; **§3** version skew is normal + bounded (expand-contract
  migrations), per-deployment `core_version` reported, **max-skew alert** (`deploy_max_version_skew` /
  `deploy_max_skew_days`); **§4** rollback = code-redeploy of prior build, schema rolls **forward** (no destructive
  down-migration); **§5** scripted operator-side provisioning + `internal_token` mint + dual-store +
  `client_registry` insert + first-deploy seed, **operator-side registration only**; **§6** per-client OAuth apps in
  the client's accounts (⚠️ Google production-verification lead time, AF-013) + the canary synthetic client + smoke
  battery; **§7** plugins stay out of the release train (management plane reports plugin version; automated plugin
  distribution **deferred** → OOS-033).
- **ADR-008 (Backup / DR)** — referenced only. Hourly client-owned off-platform snapshot (default) + PITR opt-in
  upsell + operator-verified restore + backup-health on the management-plane push. **Mechanics owned by Phase 5.**
- **C2 FR-2.MNT.017** — compliance erasure: transitive hard-delete across the supersede chain + merged/summarised
  derived rows + episodic evidence + embeddings + an `access_audit` tombstone + a backup-purge flag. **C10's DEL
  workflow invokes this.** Amended this session (OD-074) to also trigger the C7 log redaction.
- **C7 FR-7.MGM.001…005** — the outbound health-reporter push (operational-metadata-only, ADR-001 §7), push
  staleness → stale-not-green, the deployment health grid, cross-deployment alerts + CI/CD status, backup-health +
  cost overview. **C10 owns the ingest endpoint + registry these read; C7 owns the reporter + dashboard.**
- **C7 FR-7.LOG.006 / FR-7.LOG.007** — `event_log` + `guardrail_log` retention + the **redaction-tombstone** on
  compliance erasure (AC-7.LOG.006.3 / AC-7.LOG.007.4). C10's erasure triggers these.
- **C3 FR-3.TOK.*** — credential storage (Supabase Vault), three-layer refresh, the per-connector OAuth revocation
  endpoint. C10's offboarding invokes revocation.
- **C0 FR-0.SEED.001/002/003 + C1 FR-1.ROLE.001** — the idempotent first-boot seed (Internal Org + first Super
  Admin + roles). C10's provisioning triggers it.
- **C5 (harness)** — the trigger / queue / loop layer that must **honour the deployment freeze** during an
  offboarding retention window (OD-091). C1 — the role model gating who can erase/offboard (Admin / Super Admin).

---

# RET — Retention policy

### FR-10.RET.001 — Intentional retention: data is kept for defined reasons, deleted only deliberately
- **Statement:** The system shall operate on a principle of **intentional retention** — memories are retained
  indefinitely while a client is active, decay/supersede/archive **never** hard-delete the underlying record, and a
  hard-delete occurs **only** through one of the two sanctioned lawful paths (individual erasure, FR-10.DEL.*; client
  offboarding, FR-10.OFF.*), each authorised and audited. No routine operation deletes a memory.
- **Source:** design-doc-v4.md L3923–3947; ADR-001 (offboarding-by-deprovision); **C2 FR-2.MNT.002** (decay never
  deletes), **FR-2.MNT.017** (erasure is the deliberate exception).
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (operating principle constraining DEL/OFF + C2).
- **Preconditions:** C2's non-destructive memory model (decay/supersede/archive).
- **Behaviour:**
  - Happy path: in routine operation nothing is hard-deleted; confidence decays, old rows supersede, low-access rows
    may move to cold storage (deferred — OOS-016), but the record persists and stays retrievable.
  - Branches: the **only** two hard-delete paths are the individual erasure workflow (FR-10.DEL.*) and client
    offboarding (FR-10.OFF.*) — both role-gated + audited.
  - Edge / failure: a hard-delete reached through any path *other* than these two — or an erasure that silently
    leaves residue — is the **#1 / #2** failure this principle forbids.
- **Data touched:** none directly (constrains `DATA-memories` lifecycle).
- **Permissions:** N/A (DEL/OFF carry the gates).
- **Config dependencies:** the retention values (FR-10.RET.002).
- **Surfaces:** N/A.
- **Observability:** every hard-delete → an audit record (FR-10.DEL.005 / FR-10.OFF.006).
- **Acceptance criteria:**
  - AC-10.RET.001.1 — Given routine operation (decay, supersede, archive, cold-tiering), When it runs, Then no
    underlying memory record is hard-deleted.
  - AC-10.RET.001.2 — Given a hard-delete occurs, When audited, Then it traces to exactly one of the two sanctioned
    paths (individual erasure or offboarding), each with its authorisation + audit record.
  - AC-10.RET.001.3 — *(Gate L1 — the invariant needs a detector, not just a principle.)* Given the C2 sole-writer +
    tombstone model (ADR-004), When any hard-delete occurs, Then it produces a tombstone, and a hard-delete whose
    tombstone has **no DEL/OFF authorisation behind it** is the detectable violation (the C2 sole-writer is the
    enforcement consumer of this invariant — it is not left to prose).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** This is the C10 expression of the system's #1 invariant (never lose/corrupt knowledge) at the
  retention layer — deletion is deliberate, never incidental.

### FR-10.RET.002 — Configurable retention values (the legal-period knobs)
- **Statement:** The system shall expose the retention/deletion policy values as client-config: `CFG-client_offboarding_retention_days`
  (default 90), `CFG-individual_deletion_audit_years` (default 7), `CFG-data_export_link_expiry_hours` (default 72),
  `CFG-deletion_two_person_auth_required` (default true, for Restricted/Personal). Each is editable only by Super
  Admin, validated against a legal-minimum floor, and a change is audited.
- **Source:** design-doc-v4.md L4091–4099; **C1** (Super-Admin-gated config).
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Super Admin editing retention policy.
- **Preconditions:** the config registry (Phase 2) homes these `CFG-` ids; C1 permission model.
- **Behaviour:**
  - Happy path: the four values resolve from config with the stated defaults; an edit is Super-Admin-gated +
    audited.
  - Branches: `deletion_two_person_auth_required` toggles the two-person gate (FR-10.DEL.006) for Restricted/Personal
    erasures.
  - Edge / failure: a value set **below** a legal minimum (e.g. audit-retention shorter than the lawful period) is
    rejected with the floor stated — the system never silently accepts a non-compliant retention window. **⚠️
    FEASIBILITY: AF-136** (the specific lawful minimums are jurisdiction-dependent — the floor is a *configurable
    safeguard*, the actual legal value requires the legal review of FR-10.LEG.001).
- **Data touched:** `CFG-*` (Phase 2 config registry).
- **Permissions:** `PERM-config.infra` (Super Admin).
- **Config dependencies:** itself (these are the configs).
- **Surfaces:** a retention-policy config surface (Phase 3).
- **Observability:** each change → `event_log` (who/old/new/when).
- **Acceptance criteria:**
  - AC-10.RET.002.1 — Given the four retention values, When unset, Then they resolve to 90 days / 7 years / 72 hours
    / true respectively.
  - AC-10.RET.002.2 — Given a Super Admin sets a value below its legal-minimum floor, When saved, Then it is rejected
    with the floor surfaced; a non-Super-Admin edit is rejected by RBAC.
  - AC-10.RET.002.3 — Given any change, When committed, Then it is written to `event_log` with actor/old/new/time.
- **Open decisions:** —
- **Feasibility assumptions:** AF-136 (lawful-minimum floors are jurisdiction-dependent; the floor is a safeguard,
  not legal advice — gated by FR-10.LEG.001).
- **Notes:** Cold storage (L3937–3942) is **OOS-016** (v2-deferred); referenced, not specced here.

---

# DEL — Individual right-to-erasure workflow

### FR-10.DEL.001 — The individual-deletion request queue (intake, review, authorise, execute)
- **Statement:** The system shall present individual deletion requests in an **Admin queue** (analogous to the
  approval queue) where each request is documented (who requested, on whose behalf), reviewed, authorised by an
  Admin/Super Admin, and executed — with the full audit trail (FR-10.DEL.005) generated automatically. A request is
  never silently dropped; an un-actioned request escalates.
- **Source:** design-doc-v4.md L4105, L4015–4017; **C6** approval-queue pattern; **C5/C1/C2** escalate-don't-abandon.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** An Admin/Super Admin actioning a documented erasure request.
- **Preconditions:** the request is recorded with requester + legal basis; C1 role gate.
- **Behaviour:**
  - Happy path: a request enters the queue → reviewed → authorised → executed (Steps 1–6 below) → the deletion audit
    record is written.
  - Branches: a request for Restricted/Personal data triggers the two-person gate (FR-10.DEL.006).
  - Edge / failure: a request that sits un-actioned past a configurable window **escalates** (it is a legal
    obligation with a statutory clock) — it never expires silently. A request can be rejected (not a valid erasure
    basis), which is itself recorded.
- **Data touched:** a `deletion_requests` queue record; `DATA-access_audit`.
- **Permissions:** `PERM-memory.delete` (Admin / Super Admin; C1).
- **Config dependencies:** an escalation window (config).
- **Surfaces:** the Admin deletion queue (Phase 3).
- **Observability:** request lifecycle (received / authorised / executed / rejected) → `event_log`.
- **Acceptance criteria:**
  - AC-10.DEL.001.1 — Given a documented erasure request, When created, Then it appears in the Admin queue with
    requester, legal basis, and target recorded.
  - AC-10.DEL.001.2 — Given a request sits un-actioned past the configured window, When the window elapses, Then it
    escalates (alert), never silently expiring.
  - AC-10.DEL.001.3 — Given a non-Admin/Super-Admin actor, When they attempt to authorise/execute, Then RBAC rejects
    it.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** The intake wrapper; the deterministic delete mechanics are C2 FR-2.MNT.017 (FR-10.DEL.003).

### FR-10.DEL.002 — Step 1: identify all affected records (deterministic + surfaced-for-confirmation)
- **Statement:** On an authorised erasure, the system shall identify the affected records in two classes: **(a)
  deterministic** — the person's `entity` record and every memory whose `entity_ids[]` contains their `entity_id`;
  and **(b) probabilistic** — memories that reference the person **by name/identifier in the content field** (found
  via keyword + semantic search). Class (a) is auto-actioned (FR-10.DEL.003); class (b) is **surfaced for human
  confirmation** before any redaction (FR-10.DEL.004) — never auto-deleted/redacted on a fuzzy match.
- **Source:** design-doc-v4.md L3959–3965, L3983–3989; **C2** entity model (`entity_ids[]`, FR-2.ENT.*).
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** the erasure execution (post-authorisation).
- **Preconditions:** the target resolves to an `entity_id` (C2 entity resolution).
- **Behaviour:**
  - Happy path: the deterministic set (entity record + `entity_ids[]` matches) is enumerated exactly; the
    probabilistic set (name-in-content) is enumerated and **queued for Admin confirmation**, not actioned.
  - Branches: name variations / aliases widen the probabilistic search (e.g. "John" / "John Smith" / "JSmith");
    known identifiers (email, phone) are included.
  - Edge / failure: a **false negative** in the probabilistic sweep leaves personal data un-erased (#2 compliance) —
    so the sweep is recall-oriented + the result is reviewed; a **false positive** would over-delete (#1) — so class
    (b) is never auto-actioned. **⚠️ FEASIBILITY: AF-134** (name/identifier matching recall).
- **Data touched:** read across `DATA-memories`, `DATA-entities`.
- **Permissions:** erasure context (Admin/Super Admin).
- **Config dependencies:** —
- **Surfaces:** the affected-records confirmation view (Phase 3).
- **Observability:** the identified set (counts per class) recorded against the request.
- **Acceptance criteria:**
  - AC-10.DEL.002.1 — Given an authorised erasure, When Step 1 runs, Then every memory with the target's `entity_id`
    in `entity_ids[]` and the target's entity record are enumerated deterministically.
  - AC-10.DEL.002.2 — Given memories that mention the target only in content (no `entity_id`), When found, Then they
    are surfaced for human confirmation and are **not** auto-redacted/deleted.
  - AC-10.DEL.002.3 — Given the search, When run, Then it includes known identifiers + plausible name variants
    (recall-oriented), and the un-found-risk is acknowledged (AF-134).
- **Open decisions:** OD-092 (name-in-content = human-confirm, not auto) — **resolved** (this FR realises it).
- **Feasibility assumptions:** AF-134 (erasure recall / name-matching accuracy, build-time EVAL).
- **Notes:** The deterministic/probabilistic split is the #1↔#2 balance — auto only what is certain.

### FR-10.DEL.003 — Step 2–3: conditional entity-id removal, hard-delete, and entity-record deletion (via C2)
- **Statement:** For each memory in the deterministic set, the system shall **remove the target's `entity_id` from
  `entity_ids[]`**; if the array becomes **empty**, hard-delete the memory entirely (via C2 FR-2.MNT.017's
  transitive delete — chain + derived rows + evidence + embeddings); if **other entities remain**, retain the memory
  and **note the removal in its audit trail**. It shall then **hard-delete the person's entity record** and any data
  linked **solely** to that entity. All hard-deletes go through the C2 sole-writer + tombstone path.
- **Source:** design-doc-v4.md L3967–3981; **C2 FR-2.MNT.017** (transitive hard-delete), **ADR-004** (sole writer).
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** erasure execution, Step 2–3.
- **Preconditions:** Step 1 identification complete; C2's erasure mechanism available.
- **Behaviour:**
  - Happy path: `entity_id` removed; empty → transitive hard-delete; non-empty → retain + audit-note; entity record
    + entity-only data hard-deleted.
  - Branches: a retained multi-entity memory still passes through content scrubbing (FR-10.DEL.004) if it names the
    person in content.
  - Edge / failure: a memory whose `entity_ids[]` becomes empty but is **not** deleted (orphaned personal record), or
    a transitive residue surviving in a derived/merged row, is the #2 failure — forbidden by C2 AC-2.MNT.017.3.
- **Data touched:** `DATA-memories` (array edit + transitive delete), `DATA-entities` (delete) — all via C2
  sole-writer.
- **Permissions:** erasure gate (Admin/Super Admin) → `service_role` C2 path.
- **Config dependencies:** —
- **Surfaces:** progress in the deletion workflow (Phase 3).
- **Observability:** each affected memory's disposition (id-removed / hard-deleted) recorded for the audit count.
- **Acceptance criteria:**
  - AC-10.DEL.003.1 — Given a memory with the target `entity_id`, When erasure runs, Then the id is removed; if
    `entity_ids[]` is now empty the memory is transitively hard-deleted (C2 FR-2.MNT.017); else it is retained with
    an audit note.
  - AC-10.DEL.003.2 — Given the entity record + entity-only-linked data, When erasure runs, Then they are
    hard-deleted via the C2 sole-writer.
  - AC-10.DEL.003.3 — Given any hard-delete here, When complete, Then no residue survives in the supersede chain or
    derived/merged rows (delegates to C2 AC-2.MNT.017.3).
  - AC-10.DEL.003.4 — *(Gate M1 — verify-before-done across the C10→C2 boundary.)* Given the workflow invokes the C2
    erasure (FR-2.MNT.017), When it returns, Then C10 **verifies the erasure reported complete** (incl. the OD-074
    C7 log redaction) **before** writing the FR-10.DEL.005 "done" audit record; a partial/failed/indeterminate C2
    result blocks the audit-done, holds the request, and escalates (a deletion is never reported done on an
    unverified erasure). Gated by **AF-137** (transitive-erasure completeness verification).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** C10 owns the array-removal/empty-test policy + the workflow; C2 owns the actual transitive delete.

### FR-10.DEL.004 — Step 4: content scrubbing (human-confirmed [REDACTED] of personal data)
- **Statement:** For memories that **remain** after Step 2 but contain the target's name/identifiers in `content`,
  the system shall, **on human confirmation** (FR-10.DEL.002 class b), replace the personal data with `[REDACTED]`
  where legally required — preserving the surrounding non-personal context. Redaction is a judgment call (not all
  mentions are personal data); it is logged per memory and the row is retained (the memory still relates to other
  entities). Redaction of log sinks (`event_log` / `guardrail_log`) delegates to C7's redaction-tombstone.
- **Source:** design-doc-v4.md L3983–3989; **C7 AC-7.LOG.006.3 / AC-7.LOG.007.4** (log redaction-tombstone).
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** erasure execution, Step 4, after human confirmation.
- **Preconditions:** class-(b) memories confirmed by an Admin; the memory is retained (multi-entity).
- **Behaviour:**
  - Happy path: confirmed personal mentions replaced with `[REDACTED]`; context preserved; each redaction logged.
  - Branches: a memory that is **also** in a log sink triggers the C7 redaction-tombstone (event_log/guardrail_log)
    — the C2 MNT.017 amendment (OD-074) wires this.
  - Edge / failure: over-redaction that destroys legitimate context (#1) is guarded by the human-confirm gate;
    under-redaction that leaves personal data (#2) is guarded by the recall-oriented Step-1 sweep + review.
- **Data touched:** `DATA-memories.content` (in-place redaction, via C2 sole-writer); seam to `event_log` /
  `guardrail_log` redaction (C7).
- **Permissions:** erasure gate (Admin/Super Admin).
- **Config dependencies:** —
- **Surfaces:** the redaction confirmation view (Phase 3).
- **Observability:** per-memory redaction logged; counts feed the audit record.
- **Acceptance criteria:**
  - AC-10.DEL.004.1 — Given a confirmed personal mention in a retained memory's content, When scrubbed, Then it is
    replaced with `[REDACTED]` and the surrounding non-personal context is preserved.
  - AC-10.DEL.004.2 — Given a redaction, When committed, Then it goes through the C2 sole-writer and is logged per
    memory.
  - AC-10.DEL.004.3 — Given the erased target also appears in `event_log` / `guardrail_log`, When erasure runs, Then
    the C7 redaction-tombstone is triggered (C2 FR-2.MNT.017 amendment, OD-074).
- **Open decisions:** —
- **Feasibility assumptions:** AF-134 (which mentions are personal data — same recall gate).
- **Notes:** "where legally required… a judgment call" (L3987–3989) is why this is human-confirmed, not automated.

### FR-10.DEL.005 — Step 5: the permanent deletion audit log (proves it happened, not what was deleted)
- **Statement:** Every executed erasure shall create a **permanent, immutable** deletion audit record capturing: who
  requested, who authorised (Admin/Super Admin), who executed, when, how many memory records were affected, and the
  split (hard-deleted vs `entity_id`-removed vs content-redacted). This record is retained for
  `CFG-individual_deletion_audit_years` (default 7) **even though the underlying data is gone** — it proves the
  deletion happened, and contains no erased personal data.
- **Source:** design-doc-v4.md L3991–4003; **C2** `access_audit` tombstone (FR-2.MNT.017); **C7** retention floor.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** erasure completion.
- **Preconditions:** Steps 1–4 executed; counts available.
- **Behaviour:**
  - Happy path: the audit record is written with all eight fields + the three disposition counts; immutable;
    retained for the audit period.
  - Branches: it survives the very data it describes (the underlying memories are gone; the proof remains).
  - Edge / failure: a deletion that completes **without** a written audit record, or an audit record that is mutable
    /prunable before its retention period, is the #3 failure — the audit write is part of the transaction and a
    failure to write it **fails the erasure closed** (does not silently complete the delete).
- **Data touched:** `DATA-access_audit` (immutable deletion record).
- **Permissions:** written by the erasure path; readable per audit-access RBAC.
- **Config dependencies:** `CFG-individual_deletion_audit_years`.
- **Surfaces:** the compliance audit log (Phase 3).
- **Observability:** the record itself is the observability.
- **Acceptance criteria:**
  - AC-10.DEL.005.1 — Given an executed erasure, When complete, Then an immutable audit record with requester /
    authoriser / executor / timestamp / affected-count / (hard-deleted, id-removed, redacted) split is written.
  - AC-10.DEL.005.2 — Given the audit record, When the underlying data is gone, Then the record is retained for
    `individual_deletion_audit_years` and contains no erased personal data.
  - AC-10.DEL.005.3 — Given the audit write fails, When erasure executes, Then the erasure does not silently
    complete — it fails closed / escalates (the deletion is not reported done without its proof).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Mirrors the offboarding meta-record (FR-10.OFF.006) — both are "compliance evidence, no client data."

### FR-10.DEL.006 — Step 6 + authorisation: connector-notify flag + two-person auth for Restricted/Personal
- **Statement:** (a) **Connector flag** — if the person's data also exists in connected systems (GHL/Google/Slack),
  the system shall **flag** that the deletion should be actioned in those systems; the harness **does not** delete
  from systems of record (manual Admin action per system) — the flag ensures it is not forgotten and is tracked
  until acknowledged. (b) **Two-person auth** — when `CFG-deletion_two_person_auth_required` is true, an erasure
  touching **Restricted or Personal** sensitivity requires confirmation by a **second** distinct Admin/Super Admin
  (the executor cannot be their own second authoriser — no self-authorisation, mirroring C6 AC-6.APR.005.3).
- **Source:** design-doc-v4.md L4005–4012, L4015–4017; **C6 AC-6.APR.005.3** (no self-approval); **C3** systems of
  record.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** erasure execution (flag) + authorisation gate (two-person).
- **Preconditions:** connector presence detectable; two distinct Admin/Super-Admin identities for the gate.
- **Behaviour:**
  - Happy path: a connector-present target raises a tracked deletion flag per system; a Restricted/Personal erasure
    requires + records a second distinct authoriser before execution.
  - Branches: the flag is tracked-until-acknowledged (not fire-and-forget); the harness never auto-deletes from a SoR.
  - Edge / failure: the same person being both executor and second authoriser is **rejected** (#2); an un-acknowledged
    connector flag escalates rather than silently closing (#3).
- **Data touched:** `DATA-connector_deletion_flags` (a per-system, tracked-until-acknowledged flag record); the
  authorisation record on the request.
- **Permissions:** Admin / Super Admin ×2 distinct (for Restricted/Personal).
- **Config dependencies:** `CFG-deletion_two_person_auth_required`.
- **Surfaces:** the connector-deletion checklist + the two-person confirm (Phase 3).
- **Observability:** flag raise/acknowledge + both authorisations → `event_log` / audit.
- **Acceptance criteria:**
  - AC-10.DEL.006.1 — Given the target's data exists in a connected system, When erasure runs, Then a per-system
    deletion flag is raised + tracked until an Admin acknowledges it actioned; the harness never deletes from the SoR.
  - AC-10.DEL.006.2 — Given a Restricted/Personal erasure with two-person auth required, When executed, Then a second
    **distinct** Admin/Super Admin must confirm; the executor cannot self-authorise. (Schema: the two-person-auth columns on `deletion_requests` — `authorized_by` / `second_authoriser_id` / `executor_id`, with the executor-distinctness CHECK — consolidated in `spec/04-data-model/schema.md`, Phase 4.)
  - AC-10.DEL.006.3 — Given an un-acknowledged connector flag, When time passes, Then it escalates, never silently
    closing.
  - AC-10.DEL.006.4 — *(Gate M2 — the gate mechanisms fail closed.)* Given `CFG-deletion_two_person_auth_required`
    cannot be resolved, When an erasure runs, Then the two-person gate **fails closed** (treated as required, never
    proceeding single-authorised on a config-read error); **and** given connector-presence detection itself errors,
    Then the erasure **cannot complete** until the connector flag is resolved (a detection error blocks/escalates —
    it never silently produces no flag, the #2 "forgotten connector deletion" path).
- **Open decisions:** OD-093 (two-person auth = no self-second-authorisation) — **resolved** (this FR).
- **Feasibility assumptions:** —
- **Notes:** The flag is the #3 expression — the cross-system gap is surfaced, never silently left.

### FR-10.DEL.007 — Erasure executes only against an un-frozen, in-bounds deployment
- **Statement:** An individual erasure shall execute only against a deployment in a normal operating state; if the
  deployment is in an offboarding **retention freeze** (FR-10.OFF.004), erasure is part of the deletion path that
  retention governs, and a stray write is rejected by the freeze gate (FR-10.OFF.004 / OD-091). Erasure never
  proceeds on a deployment whose state forbids writes without surfacing the conflict.
- **Source:** design-doc-v4.md L4054–4056 (freeze); **OD-091**; **OD-162**.
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** erasure execution under a deployment-state check.
- **Preconditions:** deployment status readable via `deployment_settings.frozen_at` (a local read in the client's
  own Supabase, no cross-deployment query — OD-162; written by FR-10.OFF.004).
- **Behaviour:**
  - Happy path: a normal-state deployment executes erasure as specified.
  - Branches: an `offboarding`/`frozen` deployment routes erasure through the offboarding deletion path, not the
    ad-hoc workflow.
  - Edge / failure: an erasure attempted on a frozen deployment is surfaced + blocked, never silently no-op'd.
- **Data touched:** reads `deployment_settings.frozen_at`.
- **Permissions:** as FR-10.DEL.001.
- **Config dependencies:** —
- **Surfaces:** a state conflict message (Phase 3).
- **Observability:** blocked-on-freeze → `event_log`.
- **Acceptance criteria:**
  - AC-10.DEL.007.1 — Given a frozen/offboarding deployment, When an ad-hoc erasure is attempted, Then it is blocked
    + surfaced, not silently dropped.
- **Open decisions:** OD-091 (freeze enforcement) — consumes its resolution; OD-162 (`deployment_settings.frozen_at`
  as the local freeze read) — consumes its resolution.
- **Feasibility assumptions:** —
- **Notes:** Keeps the two delete paths from racing on a deployment being torn down.

---

# OFF — Client offboarding workflow

### FR-10.OFF.001 — Step 1: offboarding trigger (Super-Admin-initiated, from request or contract-end)
- **Statement:** The system shall let **only a Super Admin** initiate the offboarding flow from the Super Admin
  dashboard, triggered either by a client request or by a tracked contract-end date (if configured). Initiation is a
  deliberate, recorded action that starts the irreversible sequence (FR-10.OFF.002…006).
- **Source:** design-doc-v4.md L4028–4032; **C1** (Super Admin); **ADR-001 §7** (management plane).
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Super Admin initiating offboarding.
- **Preconditions:** Super-Admin auth on the management plane; the deployment exists in `client_registry`.
- **Behaviour:**
  - Happy path: Super Admin initiates → the deployment's `client_registry.status` moves to `offboarding`, recording
    `offboarding_at`.
  - Branches: contract-end auto-surfacing presents a prompt; the human still confirms (no auto-offboard without a
    Super Admin action).
  - Edge / failure: a non-Super-Admin attempt is rejected; an accidental trigger is recoverable only **before** the
    retention window's hard-deletion step (the sequence is "cannot be reversed once started" past Step 4, L4103).
- **Data touched:** `client_registry.status` / `offboarding_at` (management plane).
- **Permissions:** Super Admin only.
- **Config dependencies:** contract-end date (optional, config).
- **Surfaces:** the Super Admin offboarding wizard (Phase 3).
- **Observability:** initiation → management-plane log + `event_log`.
- **Acceptance criteria:**
  - AC-10.OFF.001.1 — Given a Super Admin initiates offboarding, When confirmed, Then `client_registry.status` →
    `offboarding` and `offboarding_at` is set.
  - AC-10.OFF.001.2 — Given a non-Super-Admin, When they attempt to initiate, Then RBAC rejects it.
  - AC-10.OFF.001.3 — Given a contract-end date passes, When tracked, Then it surfaces a prompt but does not
    auto-execute offboarding.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** The dashboard wizard "walks each step, requires confirmation, cannot be skipped/reversed once started"
  (L4103) — Phase 3 renders; C10 owns the state machine.

### FR-10.OFF.002 — Step 2: full data export, verified-complete, before any deletion
- **Statement:** Before **any** deletion, the system shall generate a **complete** export of the client's data —
  all memories (content, type, sensitivity, confidence, `entity_ids`, timestamps), all entity records, all event
  logs, all guardrail logs, all task-queue records — in **both JSON and CSV**. The export is **verified complete**
  (row-count / checksum reconciliation against the live tables) before it is offered for delivery; an incomplete or
  unverifiable export blocks the sequence (destruction never proceeds on an unverified export — #1).
- **Source:** design-doc-v4.md L4034–4047; **OD-090**.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** offboarding Step 2 (post-initiation).
- **Preconditions:** status = `offboarding`; export job infrastructure (Supabase Storage, L97).
- **Behaviour:**
  - Happy path: the export is generated in JSON + CSV, verified against source counts/checksums, and logged with a
    timestamp.
  - Branches: large datasets stream/chunk; the export covers every listed table.
  - Edge / failure: a failed/partial/unverifiable export **halts** offboarding before any destruction — the data is
    still intact, and the failure escalates. **⚠️ FEASIBILITY: AF-133** (export integrity + the export is readable
    /re-importable at scale).
- **Data touched:** reads all client tables → an encrypted export artefact (Storage).
- **Permissions:** Super Admin (offboarding context).
- **Config dependencies:** —
- **Surfaces:** export progress in the wizard (Phase 3).
- **Observability:** export generation + verification result + timestamp → log.
- **Acceptance criteria:**
  - AC-10.OFF.002.1 — Given offboarding Step 2, When the export runs, Then all listed tables are exported in both
    JSON and CSV.
  - AC-10.OFF.002.2 — Given the export completes, When verified, Then row-counts/checksums reconcile against the live
    tables; a mismatch blocks the sequence and escalates (no destruction on an unverified export).
  - AC-10.OFF.002.3 — Given export generation, When done, Then it is logged with a timestamp.
  - AC-10.OFF.002.4 — *(Gate H2 — the verification gate itself fails closed.)* Given the verification step does **not**
    return a definitive PASS (it errors, times out, or is indeterminate), When the sequence evaluates whether to
    advance, Then it is **blocked and escalated** — only an affirmative verified-complete result advances to
    destruction (the #1 guard fails closed, mirroring the FR-10.OFF.005 `deletion_failed` posture on the
    pre-destruction side).
- **Open decisions:** OD-090 (export-verified before destruction) — **resolved** (this FR + FR-10.OFF.005 gate).
- **Feasibility assumptions:** AF-133 (export integrity / readability at scale, build-time).
- **Notes:** This is the #1 guard — the client's data leaves intact and proven before anything is destroyed.

### FR-10.OFF.003 — Step 2 (cont.): encrypted, time-limited delivery + client receipt sign-off
- **Statement:** The verified export shall be **encrypted** and delivered to the client via a **time-limited secure
  download link** (expiry = `CFG-data_export_link_expiry_hours`, default 72). The **client signs off receipt**
  (`export_acknowledged_at`) **before** the retention window begins; an unused/expired link is surfaced (not
  silently abandoned) and can be regenerated. No client acknowledgement → the sequence does not advance to
  destruction.
- **Source:** design-doc-v4.md L4043–4047, L4096; **OD-090**.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** delivery + client receipt.
- **Preconditions:** a verified export (FR-10.OFF.002); a secure-link mechanism (Storage signed URL).
- **Behaviour:**
  - Happy path: encrypted export → time-limited link → client downloads + acknowledges receipt → `export_acknowledged_at`
    set → retention window starts.
  - Branches: link expiry is configurable; a fresh link can be reissued.
  - Edge / failure: an expired-unused link is surfaced for reissue (never silently dead); **no acknowledgement** holds
    the offboarding (it cannot reach the retention/destruction steps) and escalates — the client must have their data.
- **Data touched:** the export artefact + delivery metadata; `export_delivered_at` / `export_acknowledged_at`
  (meta-record).
- **Permissions:** Super Admin; client-side receipt.
- **Config dependencies:** `CFG-data_export_link_expiry_hours`.
- **Surfaces:** delivery + acknowledgement step (Phase 3).
- **Observability:** delivery + download + acknowledgement → log.
- **Acceptance criteria:**
  - AC-10.OFF.003.1 — Given a verified export, When delivered, Then it is encrypted behind a link that expires after
    `data_export_link_expiry_hours`.
  - AC-10.OFF.003.2 — Given the link expires unused, When checked, Then it is surfaced for reissue, not silently dead.
  - AC-10.OFF.003.3 — Given no client receipt sign-off, When the sequence tries to advance, Then it is held at this
    step (cannot reach destruction) and escalates.
  - AC-10.OFF.003.4 — *(Gate M2 — distinguish a broken ack mechanism from a slow client.)* Given the client
    acknowledges receipt but the **acknowledgement write fails**, When it does, Then it is surfaced as a **defect +
    escalated** (not silently treated as "not yet acknowledged") — both still hold the sequence safely, but the
    mechanism failure is not masked as client latency.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Receipt sign-off is the trust gate before the retention clock — "the client must know their data is
  gone" (L4023) starts with proof they received it.

### FR-10.OFF.004 — Step 3: the retention window + deployment freeze (frozen but intact)
- **Statement:** After export sign-off, the deployment's data shall be **retained, frozen, for a configurable
  period** (`CFG-client_offboarding_retention_days`, default 90) for disputes / legal holds / reactivation. During
  the freeze the deployment status is `offboarding`/`frozen` and the harness **writes no new data, runs no agents,
  executes no loops** — enforced by a freeze gate the trigger/queue layer (C5) checks before any dispatch (OD-091).
  Setting `client_registry.status = frozen` in the management plane **also writes `deployment_settings.frozen_at`**
  directly into the client's own Supabase project, using the client's custodied `service_role` key (the same
  provisioning credential path ADR-001 §7 already establishes) — this local, client-side row is what the C5 dispatch
  gate actually reads (OD-162), never a cross-deployment query. The deployment shows `offboarding` in the Super
  Admin dashboard.
- **Source:** design-doc-v4.md L4049–4058; **OD-091**; **OD-162**; **C5** trigger/queue layer.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** the post-export retention window.
- **Preconditions:** export acknowledged (FR-10.OFF.003); the C5 dispatch path reads `deployment_settings.frozen_at`
  locally in the client's own Supabase (OD-162).
- **Behaviour:**
  - Happy path: status `frozen`; `deployment_settings.frozen_at` is set in the client's Supabase; no
    writes/agents/loops run; data intact + retrievable for reactivation; the clock counts down
    `client_offboarding_retention_days`.
  - Branches: reactivation **within** the window unfreezes (status → active) — data was never destroyed.
  - Edge / failure: an agent/loop/trigger that **runs anyway** during a freeze (no enforcement consumer) is the
    #2/#3 failure — so the freeze is an **enforced gate** (C5 checks `deployment_settings.frozen_at` before dispatch,
    fails closed), not a dashboard label. **⚠️ FEASIBILITY: AF-135** (freeze propagates to every dispatch path —
    Inngest, triggers, loops, manual actions).
- **Data touched:** `client_registry.status` (management plane); `deployment_settings.frozen_at` (the client's own
  Supabase, written via the custodied `service_role` key — the local freeze flag the C5 dispatch gate reads,
  OD-162).
- **Permissions:** Super Admin to freeze/unfreeze.
- **Config dependencies:** `CFG-client_offboarding_retention_days`.
- **Surfaces:** the `offboarding` deployment state (Phase 3).
- **Observability:** freeze entry/exit + any blocked-by-freeze dispatch → log.
- **Acceptance criteria:**
  - AC-10.OFF.004.1 — Given export sign-off, When the retention window starts, Then status → `frozen` for
    `client_offboarding_retention_days`, `deployment_settings.frozen_at` is written into the client's own Supabase,
    and the data remains intact + retrievable.
  - AC-10.OFF.004.2 — Given a frozen deployment, When any trigger/agent/loop dispatch is attempted, Then the C5
    freeze gate reads `deployment_settings.frozen_at` (a local read, no cross-deployment query) and blocks it (fails
    closed) — no new data is written.
  - AC-10.OFF.004.3 — Given a reactivation request within the window, When approved, Then the deployment unfreezes
    with all data intact, using the same write path in reverse to clear `deployment_settings.frozen_at`.
  - AC-10.OFF.004.4 — *(Gate H1 — frozen ≠ dead; the C10↔C7 staleness seam.)* Given a frozen deployment stops
    pushing health snapshots (no agents/loops run, FR-10.OFF.004), When C7's staleness path (FR-7.MGM.002) evaluates
    it, Then it reads the **server-authoritative `client_registry.status`** and shows the deployment as
    **expected-quiet / frozen** — **not** green, **not** a dead-deployment alert (no false alarm) — **while** its
    underlying Supabase **project status** (ADR-008 §5: active / paused / billing-at-risk) is still **independently
    monitored**, so a frozen deployment that actually dies (e.g. Supabase paused for billing — a #1 silent-deletion
    path) is **still surfaced loudly**. `status` is added to the deployment card the staleness path reads. *(C10
    owns the `status` source-of-truth + this requirement; C7 owns the staleness-path consumption — a small C10↔C7
    seam to wire at the C7/Phase-3 surface pass.)*
  - AC-10.OFF.004.5 — *(OD-162 self-review gap, 2026-07-02 — the freeze write is two systems, not one.)* Given
    `client_registry.status` is set to `frozen` in the management plane, When the follow-on cross-project write of
    `deployment_settings.frozen_at` into the client's own Supabase fails or cannot be confirmed (client project
    unreachable, stale/rotated `service_role` key), Then the deployment holds in a **`freeze_pending`** sub-state
    (never silently reported as `frozen`), the write retries with backoff, and an unresolved `freeze_pending` past a
    bounded window escalates to the operator — mirroring OD-089's "never marked complete on a partial" discipline.
    The management plane's own status must never outrun what the client deployment can actually enforce (#1/#3).
- **Open decisions:** OD-091 (freeze enforcement + the C5 consumer) — **resolved** (this FR + the C5 change-control
  AC, mirroring the C8 OD-081 memory-scope wiring); OD-162 (the "local mirror" defined as
  `deployment_settings.frozen_at`, written via the custodied `service_role` key) — **resolved** (this FR + AC.5).
- **Feasibility assumptions:** AF-135 (freeze propagation completeness, build-time).
- **Notes:** Without an enforcement consumer the freeze is a label; the C5 dispatch gate is what makes "no agents
  run" true.

### FR-10.OFF.005 — Step 4: hard deletion + deprovision (atomic-or-escalate, never partial-silent)
- **Statement:** After the retention window expires, the system shall **permanently delete + deprovision** in a
  tracked sequence: truncate + drop all tables in the client's Supabase, **deprovision the Supabase project**,
  **deprovision the Railway service**, **hard-delete credentials** from the credentials table, **revoke all
  connector OAuth tokens** via each connector's revocation endpoint (C3), and **flag the client's off-platform
  backup** (ADR-008's hourly, client-owned off-platform snapshot — engineered to **survive** the Supabase project
  deletion above) **for purge / retention-expiry**. This backup-purge flag is distinct from, and in addition to, the
  individual-erasure backup-purge flag (C2 AC-2.MNT.017.2, raised per-erasure by the DEL workflow) — offboarding
  purges the client's **entire** off-platform backup, not a per-record flag. Each sub-step is **idempotent + its
  result recorded**; a sub-step failure holds the offboarding in a `deletion_failed` state with escalation — the
  offboarding is **never marked complete on a partial deprovision**, and deprovision steps are **not auto-rolled-back**
  (you cannot un-delete; you fix forward).
- **Source:** design-doc-v4.md L4060–4071; **ADR-008 §2** (off-platform backup survives project deletion); **C3
  FR-3.TOK.*** (revocation); **OD-089**; **OD-010** (no auto-rollback).
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** offboarding Step 4 (post-retention).
- **Preconditions:** retention window expired; export acknowledged (FR-10.OFF.003); Super-Admin confirmation.
- **Behaviour:**
  - Happy path: each sub-step (DB truncate/drop → Supabase deprovision → Railway deprovision → credential delete →
    token revoke → **off-platform backup flagged for purge**) runs, records success, and the meta-record
    (FR-10.OFF.006) lists each system as deprovisioned.
  - Branches: a connector whose revocation endpoint is unreachable retries; an already-deprovisioned resource is a
    no-op (idempotent); the backup-purge flag is tracked until the off-platform destination confirms purge (mechanics
    owned by Phase 5 / ADR-008), mirroring FR-10.DEL.006(a)'s tracked-until-acknowledged pattern.
  - Edge / failure: a sub-step that fails leaves the offboarding in `deletion_failed` — **not** "done" — with the
    per-system status recorded + escalation, so a half-deprovisioned client (orphaned Supabase, live OAuth token,
    **an un-purged off-platform backup that outlives the "airtight deletion" claim**) is surfaced, never silently
    left (#2/#3). **⚠️ FEASIBILITY: AF-132** (the end-to-end deprovision actually completes on every system —
    Supabase + Railway + connector revocation + off-platform backup purge).
- **Data touched:** the client's entire Supabase (truncate/drop/deprovision); Railway service; `credentials`; OAuth
  tokens (via C3); the off-platform backup-purge flag (Phase 5 / ADR-008).
- **Permissions:** Super Admin (final confirmation).
- **Config dependencies:** —
- **Surfaces:** the deletion-execution step + per-system status (Phase 3).
- **Observability:** every sub-step result → the meta-record + management-plane log.
- **Acceptance criteria:**
  - AC-10.OFF.005.1 — Given the retention window expired, When Step 4 runs, Then Supabase (truncate/drop +
    deprovision), Railway, credentials, and all OAuth tokens are deleted/revoked, each result recorded.
  - AC-10.OFF.005.2 — Given any sub-step fails, When it does, Then the offboarding enters `deletion_failed` with
    per-system status + escalation — it is **not** marked complete, and no deprovision is auto-rolled-back.
  - AC-10.OFF.005.3 — Given a re-run after a partial failure, When it executes, Then each sub-step is idempotent
    (already-done is a safe no-op) and the sequence resumes to completion.
  - AC-10.OFF.005.4 — *(Gate M3 — the progress store must survive the deprovision it tracks.)* Given the client
    deployment is being truncated/deprovisioned, When each sub-step runs, Then its per-system status **and** the
    FR-10.OFF.006 meta-record are written to the **management plane** (not the client deployment) and committed
    **before** the next destructive step — so a crash mid-sequence is resumable, and a state where the destructive
    steps finished but the meta-record failed to write is itself a recorded, escalated condition (never a silent
    lost-evidence completion).
  - AC-10.OFF.005.5 — *(Gate M4 — no live credential for a dead deployment.)* Given the deprovision sequence, When it
    runs, Then `internal_token` revocation (FR-10.MGT.004.3) is performed **first / independently re-driven to
    completion**, so even a partial `deletion_failed` state never leaves a torn-down deployment holding a valid
    management-plane push credential (#2).
  - AC-10.OFF.005.6 — *(Gate H30 — the off-platform backup is designed to survive the deprovision above; it must be
    flagged too.)* Given Step 4 runs, When Supabase project deprovision is recorded, Then the sequence **also**
    raises a flag on the client's off-platform backup (ADR-008) for purge/retention-expiry — tracked until the
    off-platform destination confirms purge — and this flag's raise/acknowledge status is recorded in the
    FR-10.OFF.006 meta-record; offboarding is **not** "airtight deletion evidence" (FR-10.ISO.002) while this flag
    is un-raised.
- **Open decisions:** OD-089 (partial-deprovision failure handling) — **resolved** (this FR).
- **Feasibility assumptions:** AF-132 (deprovision completeness, build-time SPIKE).
- **Notes:** Deprovisioning the client's Supabase project = airtight deletion evidence (ADR-001 §Consequences) — the
  isolation model is what makes "their data is gone" provable (FR-10.ISO.002). The off-platform backup-purge flag
  (AC-10.OFF.005.6) is what closes the gap ADR-008 §2 opens — a backup **engineered to survive** the project
  deletion above cannot be left unflagged, or the "airtight" claim is false (H30).

### FR-10.OFF.006 — Step 5: the offboarding compliance meta-record (in the operator's system, no client data)
- **Statement:** On offboarding completion the system shall create a **meta-record in the operator's management
  plane** (not the client's deployment — which no longer exists) confirming: the deployment's `client_registry`
  identity, `offboarding_at`, `export_delivered_at`, `export_acknowledged_at`, `retention_window_end`,
  `deletion_executed_at`, `deletion_executed_by`, `systems_deprovisioned[]`, `tokens_revoked[]`. It is **compliance
  evidence**, retained for the legally required period, containing **no client business data** — only confirmation
  the process completed correctly.
- **Source:** design-doc-v4.md L4073–4088; **ADR-001 §3/§7** (identity lives in `client_registry`, operational
  metadata only).
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** offboarding completion.
- **Preconditions:** Step 4 complete (or the per-system status finalised); the management-plane store.
- **Behaviour:**
  - Happy path: the meta-record is written to the management DB with all nine fields + the deprovisioned/revoked
    lists; retained for the legal period.
  - Branches: it references the `client_registry` row by its **management-plane identity** — `client_slug` is valid
    **here** (it lives only in the management plane, ADR-001 §3/§7), never as an app-table filter.
  - Edge / failure: a completed offboarding with **no** meta-record is the #3 failure (no proof the process ran
    correctly) — the meta-record write is part of completion.
- **Data touched:** the management-plane `offboarding_records` (or `client_registry` archival fields).
- **Permissions:** written by the offboarding path; readable per operator audit RBAC.
- **Config dependencies:** legal-retention period.
- **Surfaces:** a downloadable compliance record at completion (L4103, Phase 3).
- **Observability:** the record is the evidence.
- **Acceptance criteria:**
  - AC-10.OFF.006.1 — Given offboarding completes, When finalised, Then a management-plane meta-record with all nine
    fields + `systems_deprovisioned[]` + `tokens_revoked[]` is written and retained for the legal period.
  - AC-10.OFF.006.2 — Given the meta-record, When inspected, Then it contains no client business data (only process
    confirmation) and references the client by `client_registry` identity (the only valid `client_slug` use).
  - AC-10.OFF.006.3 — Given a completed deletion, When the meta-record fails to write, Then completion is not
    reported — it escalates (no silent "done" without evidence).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** The offboarding analogue of the deletion audit log — proof without payload. This is the **correct**
  surviving use of `client_slug` (management plane only), the trap C7/C8/C9 each caught.

---

# PRV — Provisioning (operator-side)

### FR-10.PRV.001 — The operator-side provisioning script (Railway link → secrets → token → registry → seed)
- **Statement:** The system shall provide a **scripted, operator-run provisioning flow** that, for a new client:
  creates + links the Railway project to the shared repo; sets `DEPLOYMENT_CONFIG` (non-secret JSON) + the env
  secrets; **mints the `internal_token` and dual-stores it** (the deployment's Railway env **and** the management
  DB); **inserts the `client_registry` row**; and **triggers the first deploy**, which runs the idempotent seed
  script (C0/C1) creating the Internal Org + first Super Admin and setting status `initialising`. The script is
  **idempotent + loud on partial failure** (a missing env var fails the deploy visibly, never half-provisions
  silently).
- **Source:** **ADR-005 §5**; design-doc-v4.md L1200–1215, L1222–1239, L1130–1136; **C0 FR-0.SEED.***, **C1
  FR-1.ROLE.001**.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** the operator provisioning a new client.
- **Preconditions:** the client-side runbook done (FR-10.PRV.004 — accounts + card + delegated access); operator
  Railway + management DB access.
- **Behaviour:**
  - Happy path: Railway linked → config + secrets set → `internal_token` minted + dual-stored → `client_registry`
    row inserted → first deploy → seed → status `initialising` → ready.
  - Branches: registration is **operator-side only** — the script inserts the registry row; **no deployment
    self-registration** (avoids the token chicken-and-egg, ADR-005 §5).
  - Edge / failure: a missing/incorrect secret or a failed seed surfaces loudly (the deploy fails / status does not
    reach ready) — never a silently half-provisioned deployment. **⚠️ FEASIBILITY: AF-004** (the end-to-end
    provisioning path actually wires up against a client-owned Supabase).
- **Data touched:** `client_registry` (management DB); Railway env; the new client's seed tables (via C0/C1).
- **Permissions:** operator (Super Admin / ops).
- **Config dependencies:** `DEPLOYMENT_CONFIG` + the env-secret set.
- **Surfaces:** a provisioning runbook + script output (ops).
- **Acceptance criteria:**
  - AC-10.PRV.001.1 — Given a new client, When the provisioning script runs, Then Railway is linked, config +
    secrets are set, the `internal_token` is minted + stored in both Railway and the management DB, the
    `client_registry` row is inserted, and the first deploy triggers the seed.
  - AC-10.PRV.001.2 — Given registration, When it happens, Then the script (operator-side) inserts the registry row;
    the deployment never self-registers.
  - AC-10.PRV.001.3 — Given a missing secret or failed seed, When provisioning runs, Then it fails loudly (deploy
    fails / status not ready), never half-provisioning silently.
- **Open decisions:** —
- **Feasibility assumptions:** AF-004 (provisioning end-to-end, build-time SPIKE).
- **Notes:** C10 owns the provisioning *orchestration*; C0/C1 own the seed; full IaC was ruled out (ADR-005, B2).

### FR-10.PRV.002 — Per-client OAuth app registration (in the client's accounts, Google verification lead-time)
- **Statement:** Provisioning shall register/configure the client's **own** OAuth apps (login provider + connector
  apps — Gmail/Drive/Calendar/GHL/Slack) **in the client's accounts** using delegated access, set the **redirect
  URIs to that deployment's Railway domain**, and drop the resulting `client_id`/`client_secret` into the
  deployment's Railway env — **not** one shared operator app (ADR-001 §5 / ADR-005 §6). Google **production
  verification** is a known multi-day-to-week lead-time dependency surfaced + started early in onboarding.
- **Source:** **ADR-005 §6**; **ADR-001 §5**; design-doc-v4.md L2275–2291, L360–369; **AF-013** (Google verification).
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** the operator registering per-client OAuth apps during onboarding.
- **Preconditions:** delegated access to the client's Google/GHL/Slack accounts.
- **Behaviour:**
  - Happy path: per-client OAuth apps registered in the client's accounts; redirect URIs point at that deployment's
    domain; secrets land in that deployment's env.
  - Branches: Google production verification is initiated early (lead-time gate); other connectors register faster.
  - Edge / failure: a shared operator app across clients is **wrong** (contradicts ADR-001 §5 ownership) and is
    ruled out; a redirect URI pointing anywhere but the deployment domain breaks the OAuth loop. **⚠️ FEASIBILITY:
    AF-013** (Google verification lead-time is a schedule dependency).
- **Data touched:** the client's OAuth app config (their accounts); the deployment's env secrets.
- **Permissions:** operator (delegated client access).
- **Config dependencies:** per-connector `client_id`/`client_secret`.
- **Surfaces:** onboarding runbook (ops).
- **Acceptance criteria:**
  - AC-10.PRV.002.1 — Given a new client, When OAuth apps are registered, Then they live in the client's own
    accounts with redirect URIs to that deployment's Railway domain (not a shared operator app).
  - AC-10.PRV.002.2 — Given Google connectors, When onboarding plans, Then production verification is started early
    as a schedule dependency (AF-013).
- **Open decisions:** —
- **Feasibility assumptions:** AF-013 (Google production-verification lead-time).
- **Notes:** Per-client apps keep the moat (operator's IP never inside a client account) + the ownership model
  clean.

### FR-10.PRV.003 — The canary is a seeded synthetic client (promotion-gate fixture)
- **Statement:** The system shall maintain a **canary deployment** booted from a fixed **synthetic client** (curated
  fake entities, a message/email corpus, seeded memories) against which the smoke-test battery runs as a promotion
  gate (FR-10.DEP.002). C10 owns the **synthetic-corpus provisioning** (fixture + seed); the **smoke-battery
  assertions** (retrieval-of-known-answers, contradiction detection, routing) are owned by their home components
  (C2/C5/C8). The corpus is shared with the AF-001/AF-002 spikes.
- **Source:** **ADR-005 §6**; design-doc-v4.md (canary); **AF-066**.
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** the canary boot + each release promotion.
- **Preconditions:** a fixed synthetic-client fixture; the smoke battery defined.
- **Behaviour:**
  - Happy path: the canary boots the synthetic client deterministically; the smoke battery runs; green is a
    promotion gate.
  - Branches: the corpus doubles as the cost/retrieval spike fixture (AF-001/002).
  - Edge / failure: the canary only catches what its fixtures + assertions cover — a real sense of safety bounded by
    coverage. **⚠️ FEASIBILITY: AF-066** (the synthetic corpus is representative enough to catch behavioural
    regressions).
- **Data touched:** the canary's own Supabase (synthetic data).
- **Permissions:** operator/ops.
- **Config dependencies:** the fixture definition.
- **Surfaces:** canary status in the management plane (Phase 3).
- **Acceptance criteria:**
  - AC-10.PRV.003.1 — Given a release promotion, When evaluated, Then the canary boots the synthetic client and runs
    the smoke battery; green is required to promote.
  - AC-10.PRV.003.2 — Given the smoke assertions, When defined, Then their behavioural checks are owned by C2/C5/C8;
    C10 owns the corpus provisioning.
- **Open decisions:** —
- **Feasibility assumptions:** AF-066 (canary representativeness, build-time EVAL).
- **Notes:** The honest limit (L of part 6): the canary catches only what it covers — stated, not hidden.

### FR-10.PRV.004 — The client-side onboarding runbook (accounts + card + delegated access)
- **Statement:** The system shall define a **client-side onboarding runbook** (a documented, consent-gated process):
  the client creates their Supabase project (default region Sydney `ap-southeast-2`), Anthropic/OpenAI accounts, and
  connector SaaS (GHL/Google/Slack), puts their card on each, and **grants the operator delegated access** (Supabase
  service-role key, OAuth app admin). This is the hybrid-ownership precondition (ADR-001 §5) the provisioning script
  (FR-10.PRV.001) depends on.
- **Source:** **ADR-001 §5**; **ADR-005 §5**; design-doc-v4.md L29–33.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** the client during onboarding (operator-guided).
- **Preconditions:** a signed engagement; the runbook document.
- **Behaviour:**
  - Happy path: client creates accounts + card + grants delegated access → provisioning can proceed.
  - Branches: a client may own compute (Railway) too if they insist — documented as a per-client exception, not the
    default (ADR-001 §5).
  - Edge / failure: missing delegated access blocks provisioning loudly (the script cannot link/seed) — never a
    partial setup.
- **Data touched:** the client's vendor accounts (their ownership).
- **Permissions:** client (account owner) + operator (delegated).
- **Config dependencies:** region default (FR-10.ISO.003).
- **Surfaces:** the runbook (operational doc).
- **Acceptance criteria:**
  - AC-10.PRV.004.1 — Given onboarding, When the runbook is followed, Then the client owns the Supabase + API +
    connector accounts (card on each) and has granted the operator delegated access.
  - AC-10.PRV.004.2 — Given a client insisting on owning compute, When documented, Then it is recorded as a
    per-client exception, not the default.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Keeps cost client-borne (ADR-003) + the data in the client's accounts (the moat + residency story).

---

# MGT — Management plane (ingest + registry)

### FR-10.MGT.001 — The `client_registry` schema + status lifecycle (the single home of client identity)
- **Statement:** The management deployment shall hold a **`client_registry`** table — the **only** place client
  identity exists (ADR-001 §3) — with: `id`, `client_slug`, `client_name`, `railway_url`, `internal_token`
  (encrypted), `core_version`, `region`, `status` (`initialising` | `active` | `offboarding` | `frozen`),
  `created_at`, `offboarding_at`. C10 owns the schema + the **status lifecycle transitions** (provisioning →
  `initialising` → `active`; offboarding → `offboarding`/`frozen`; reactivation → `active`).
- **Source:** **ADR-001 §3/§7**; design-doc-v4.md L1222–1239; **ADR-005 §3** (`core_version`).
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** provisioning / offboarding / status updates.
- **Preconditions:** the management deployment + its own small Supabase.
- **Behaviour:**
  - Happy path: each client is exactly one `client_registry` row; status transitions follow the lifecycle.
  - Branches: `internal_token` is encrypted at rest; `core_version` is updated by the push (C7 FR-7.MGM.001).
  - Edge / failure: client identity appearing in any **application** table (not the registry) is the ADR-001 §3
    violation — caught by FR-10.ISO.001.
- **Data touched:** `client_registry` (management DB).
- **Permissions:** operator (management-plane RBAC).
- **Config dependencies:** —
- **Surfaces:** the Super Admin fleet view (C7 FR-7.MGM.003 reads this).
- **Acceptance criteria:**
  - AC-10.MGT.001.1 — Given a client, When registered, Then exactly one `client_registry` row holds its identity +
    the listed fields; no client identity lives in any application table.
  - AC-10.MGT.001.2 — Given a lifecycle event (provision / activate / offboard / freeze / reactivate), When it
    occurs, Then `status` transitions accordingly and is timestamped.
  - AC-10.MGT.001.3 — Given `internal_token`, When stored, Then it is encrypted at rest.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** This is the surviving home of `client_slug` (management plane only) — the inverse of the ADR-001 §3
  app-table deletion (FR-10.ISO.001).

### FR-10.MGT.002 — The management-plane ingest endpoint (each deployment authenticates *to* it)
- **Statement:** The management plane shall expose an **ingest endpoint** that receives the per-deployment health
  push (C7 FR-7.MGM.001), authenticating each deployment by its **`internal_token`**. The endpoint validates the
  token, accepts only the **operational-metadata payload** (health, queue depth, alert counts, `core_version`,
  connector status, cost-to-date, backup-health — never business data), is idempotent on re-delivery, and updates
  the matching `client_registry` row + the health store.
- **Source:** **ADR-001 §7**; **C7 FR-7.MGM.001** (the push side).
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** a deployment pushing its health snapshot.
- **Preconditions:** the deployment has a provisioned `internal_token`; C7 owns the reporter.
- **Behaviour:**
  - Happy path: a valid-token push with an operational-metadata payload updates `client_registry.core_version` +
    the health store; a stale/absent push is detected by C7's staleness logic (FR-7.MGM.002).
  - Branches: re-delivery is idempotent (same snapshot ≠ double-count).
  - Edge / failure: an invalid/missing token is rejected + logged (no anonymous ingest); a payload containing
    business data is rejected at the boundary (ADR-001 §7 — C7 AC-7.MGM.001 enforces the whitelist on the push side;
    the ingest re-validates). The management plane **never pulls** from a deployment (no `/api/internal/status` —
    that design-doc reference L1170–1190 is stale, superseded by push, ADR-001 §7 / ADR-005).
- **Data touched:** `client_registry` + the management health store.
- **Permissions:** per-deployment `internal_token` (bearer).
- **Config dependencies:** —
- **Surfaces:** none directly (C7 dashboards read the store).
- **Acceptance criteria:**
  - AC-10.MGT.002.1 — Given a deployment push with a valid `internal_token`, When received, Then the
    operational-metadata payload updates `client_registry` + the health store.
  - AC-10.MGT.002.2 — Given an invalid/missing token, When a push arrives, Then it is rejected + logged (no
    anonymous ingest).
  - AC-10.MGT.002.3 — Given the management plane, When it needs deployment status, Then it reads its own store
    (push-fed) and never pulls a client endpoint (the L1170–1190 pull model is stale/superseded).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** C10 owns the **ingest + auth + registry write**; C7 owns the **reporter that pushes + the boundary
  whitelist on the push side + the dashboards**. Two halves of ADR-001 §7.

### FR-10.MGT.003 — Push-only data flow; the management plane is a map, not a warehouse
- **Statement:** The cross-deployment data flow shall be **push-only** and **operational-metadata-only** (ADR-001
  §7): a deployment posts snapshots to the management plane; "looking inside a client" means **clicking through and
  logging into that client's own dashboard** (where their RBAC applies), **never** the management plane reading
  client business data. If the management plane were fully compromised it would reveal operational status and
  nothing about any client's business.
- **Source:** **ADR-001 §7**; **C7 FR-7.MGM.001/002**.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (architectural boundary).
- **Preconditions:** the push model (FR-10.MGT.002) + C7 reporter.
- **Behaviour:**
  - Happy path: operational metadata flows inbound; the Super Admin dashboard reads the management store; deep
    inspection routes the operator into the client deployment under that client's RBAC.
  - Branches: a deployment gone dark shows "last reported X ago" (C7 FR-7.MGM.002 stale-not-green).
  - Edge / failure: any path that copies client business data into the management plane is the ADR-001 §7 breach
    (#2) — forbidden; the boundary is enforced on both push (C7) and ingest (FR-10.MGT.002) sides.
- **Data touched:** management store (operational only).
- **Permissions:** operator (management RBAC) → client RBAC on click-through.
- **Config dependencies:** —
- **Surfaces:** the fleet map (C7 + Phase 3).
- **Acceptance criteria:**
  - AC-10.MGT.003.1 — Given the management plane, When it shows fleet status, Then it sources only operational
    metadata (no memories/entity content/message text/sensitive data).
  - AC-10.MGT.003.2 — Given the operator wants to inspect a client, When they do, Then they click through into that
    client's dashboard under the client's RBAC (the management plane never reads client business data).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** The compromise-blast-radius argument (ADR-001 §7) — the management plane is the #2 boundary, designed
  to leak nothing about a client's business if breached.

### FR-10.MGT.004 — `internal_token` lifecycle (mint, dual-store, rotate, revoke-on-offboard)
- **Statement:** The system shall manage each deployment's `internal_token` lifecycle: **minted** at provisioning
  (FR-10.PRV.001), **dual-stored** (the deployment's Railway env + the management DB, encrypted), usable to
  authenticate the deployment's push (FR-10.MGT.002), **rotatable** (re-mint + dual-update without losing push
  continuity), and **revoked** when the deployment is deprovisioned (FR-10.OFF.005) so a torn-down deployment can no
  longer authenticate.
- **Source:** **ADR-005 §5**; design-doc-v4.md L1200–1215; **ADR-001 §7**.
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** provisioning / rotation / offboarding.
- **Preconditions:** the management DB + Railway env custody (NFR-SEC).
- **Behaviour:**
  - Happy path: token minted + dual-stored at provisioning; used for push auth; rotated on demand; revoked at
    offboarding.
  - Branches: rotation re-mints + updates both stores atomically (a mismatch between Railway + management DB breaks
    push auth — surfaced, not silent).
  - Edge / failure: a token that stays valid after deprovisioning (a live credential for a dead deployment) is the
    #2 failure — revocation is part of FR-10.OFF.005.
- **Data touched:** `client_registry.internal_token` (encrypted) + Railway env.
- **Permissions:** operator/ops.
- **Config dependencies:** —
- **Surfaces:** none (ops).
- **Acceptance criteria:**
  - AC-10.MGT.004.1 — Given provisioning, When the token is minted, Then it is dual-stored (Railway env + management
    DB, encrypted) and authenticates the deployment's push.
  - AC-10.MGT.004.2 — Given a rotation, When it runs, Then both stores update; a partial update is surfaced (push
    auth never silently breaks).
  - AC-10.MGT.004.3 — Given deprovisioning, When complete, Then the token is revoked and can no longer authenticate.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Deep secrets-custody treatment → NFR-SEC (Phase 5); C10 owns the lifecycle states.

---

# DEP — The release model (deploy / canary / rollback / version-skew)

### FR-10.DEP.001 — Railway per-project auto-deploy; GitHub Actions is a test gate only
- **Statement:** Each client's Railway project shall **natively track and auto-deploy** the appropriate branch
  (canary tracks `release`, the fleet tracks `main`) on push, running `drizzle-kit migrate` against that
  deployment's Supabase on release. **GitHub Actions runs the test suite as a merge gate** into the release flow —
  **not** as a deployer. No custom fan-out CI exists (ADR-001 §6 / ADR-005 §1).
- **Source:** **ADR-005 §1**; **ADR-001 §6**; design-doc-v4.md L23, L119–122, L1141–1160.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** a push to `release` / `main`.
- **Preconditions:** each Railway project linked to the shared repo (FR-10.PRV.001); branch model configured.
- **Behaviour:**
  - Happy path: push to `main` → the fleet's Railway projects auto-deploy + migrate independently; push to `release`
    → the canary auto-deploys.
  - Branches: GitHub Actions gates merges with the test suite; it never deploys.
  - Edge / failure: a custom CI pushing code into N accounts is **ruled out** (ADR-001 §6); the Railway-native
    integration replaces it. **⚠️ FEASIBILITY: AF-020** (Railway native per-project auto-deploy + on-release
    migrate behaves as assumed).
- **Data touched:** each deployment's runtime + its Supabase (migration).
- **Permissions:** operator (repo + Railway).
- **Config dependencies:** branch-to-environment mapping.
- **Surfaces:** CI/CD status in the management plane (C7 FR-7.MGM.004).
- **Acceptance criteria:**
  - AC-10.DEP.001.1 — Given a push to `main`, When it lands, Then each fleet Railway project auto-deploys and runs
    its migration independently against its own Supabase.
  - AC-10.DEP.001.2 — Given GitHub Actions, When it runs, Then it gates merges via the test suite and does not
    deploy.
- **Open decisions:** —
- **Feasibility assumptions:** AF-020 (Railway auto-deploy + on-release migrate, build-time DOCS+SPIKE).
- **Notes:** The deploy primitive the whole release train rests on.

### FR-10.DEP.002 — The canary + release-train promotion gate (tests + migration + smoke + soak)
- **Statement:** Blast radius shall be bounded by a **canary + release-train**: feature branches → `release` (the
  canary tracks) → **promote (fast-forward)** → `main` (the fleet tracks). Promotion to `main` is gated on **all of**:
  tests green + migration applied cleanly on the canary + the smoke-test battery green (FR-10.PRV.003) + a soak
  window elapsed (`CFG-canary_soak_minutes`). Promotion is a **deliberate operator action** in v1 (an automated job
  only once trust is established — OD-094); never every dev commit.
- **Source:** **ADR-005 §2**; **OD-094**.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** an operator promoting a release.
- **Preconditions:** the canary deployment + smoke battery; the branch model.
- **Behaviour:**
  - Happy path: `release` → canary deploys + migrates + smoke-passes + soaks → operator promotes (fast-forward to
    `main`) → fleet auto-deploys.
  - Branches: any gate red **blocks** promotion (a failing smoke battery or migration on the canary stops the fleet
    rollout).
  - Edge / failure: instant-global deploy on every `main` push is **ruled out** (ADR-005, A1); promotion without a
    green canary is forbidden. **⚠️ FEASIBILITY: AF-064** (Railway supports the branch-based canary/release-train +
    promotion model).
- **Data touched:** the canary Supabase (migration); branch refs.
- **Permissions:** operator (promotion).
- **Config dependencies:** `CFG-canary_soak_minutes`.
- **Surfaces:** release/promotion status in the management plane (C7 FR-7.MGM.004).
- **Acceptance criteria:**
  - AC-10.DEP.002.1 — Given a candidate release, When promotion is attempted, Then it requires tests green + clean
    canary migration + green smoke battery + elapsed soak window; any failure blocks promotion.
  - AC-10.DEP.002.2 — Given v1, When a release is promoted, Then it is a deliberate operator action (not automatic
    on every commit); automated promotion is deferred (OD-094).
- **Open decisions:** OD-094 (manual operator promotion in v1) — **resolved** (this FR).
- **Feasibility assumptions:** AF-064 (release-train model on Railway, build-time DOCS+SPIKE).
- **Notes:** The canary gate before the fleet is the decision; if Railway's branch model differs, the *mechanism*
  changes but the *gate* stands (ADR-005 §2).

### FR-10.DEP.003 — Rollback = code-redeploy of the prior build; schema rolls forward (no destructive down-migration)
- **Statement:** Rollback shall be **code-redeploy of the previous Railway build** (per-deployment or fleet-wide),
  relying on Railway's retained build history. Migrations are **never auto-un-applied** (un-migration is unsafe); the
  **expand-contract discipline** (`standards/migration-discipline.md`) keeps prior code correct against the newer
  schema. A bad schema change is fixed by **rolling forward** a corrective migration, never a destructive
  down-migration in production.
- **Source:** **ADR-005 §4**; design-doc-v4.md L1106–1136; `standards/migration-discipline.md`.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** the operator rolling back a deployment / the fleet.
- **Preconditions:** Railway build history; expand-contract migrations (the safety premise).
- **Behaviour:**
  - Happy path: roll code back to the prior build; the prior code runs correctly against the newer (additive)
    schema.
  - Branches: a corrective schema fix rolls **forward** as a new migration.
  - Edge / failure: a destructive down-migration in production is **ruled out** (ADR-005 §4) — it is the unsafe path
    expand-contract exists to avoid. **⚠️ FEASIBILITY: AF-065** (expand-contract keeps a mixed-version fleet + the
    rollback premise safe).
- **Data touched:** deployment build (rollback); schema (roll-forward only).
- **Permissions:** operator.
- **Config dependencies:** —
- **Surfaces:** build/version status (C7 FR-7.MGM.003/004).
- **Acceptance criteria:**
  - AC-10.DEP.003.1 — Given a need to roll back, When executed, Then it redeploys the prior Railway build; the
    schema is not un-migrated.
  - AC-10.DEP.003.2 — Given a bad schema change, When fixed, Then it is corrected by a roll-forward migration, never
    a destructive production down-migration.
- **Open decisions:** —
- **Feasibility assumptions:** AF-065 (expand-contract / mixed-version safety, build-time SPIKE).
- **Notes:** Parts 3 + 4 of ADR-005 both rest on AF-065 — the load-bearing migration-safety assumption.

### FR-10.DEP.004 — Version reporting + the max-skew alert (laggards are caught, never silent)
- **Statement:** Each deployment shall report its `core_version` + last-migrated timestamp via the health push
  (FR-10.MGT.002 / C7); the management plane shows the fleet's version spread. A **max-skew alert** fires when a
  deployment is more than `CFG-deploy_max_version_skew` versions behind **or** more than `CFG-deploy_max_skew_days`
  stale (config-tunable, defaults proposed 3 versions / 14 days — OD-095), so a laggard (e.g. a client stuck on a
  failed migration) is caught rather than silently drifting.
- **Source:** **ADR-005 §3**; design-doc-v4.md L1186, L1197–1200, L1218–1232; **OD-095**.
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** the skew evaluation on the management plane.
- **Preconditions:** version reporting (push); the skew thresholds.
- **Behaviour:**
  - Happy path: version spread is visible; within-bounds skew is normal (ADR-005 §3 — version skew is not an error).
  - Branches: thresholds are config-tunable per the operator's fleet tolerance.
  - Edge / failure: a deployment exceeding the skew/staleness bound fires an alert (C7 cross-deployment alerts,
    FR-7.MGM.004) — a stuck-on-failed-migration client is the #3 failure this prevents (silent drift).
- **Data touched:** `client_registry.core_version` + last-migrated; the skew evaluation.
- **Permissions:** operator (alert recipient).
- **Config dependencies:** `CFG-deploy_max_version_skew`, `CFG-deploy_max_skew_days`.
- **Surfaces:** the fleet version grid + skew alert (C7 FR-7.MGM.003/004).
- **Acceptance criteria:**
  - AC-10.DEP.004.1 — Given each deployment, When it pushes, Then `core_version` + last-migrated are reported and
    the fleet spread is visible.
  - AC-10.DEP.004.2 — Given a deployment more than `deploy_max_version_skew` behind or `deploy_max_skew_days` stale,
    When evaluated, Then a max-skew alert fires.
- **Open decisions:** OD-095 (skew-threshold defaults) — **resolved** (3 versions / 14 days, config-tunable).
- **Feasibility assumptions:** —
- **Notes:** Version skew is *normal + bounded* (the expand-contract premise) — the alert catches the *un*bounded
  laggard, not every skew.

### FR-10.DEP.005 — Plugins stay out of the release train (per-deployment, version-reported)
- **Statement:** The `/plugins` folder shall be **per-deployment, manually updated, and never touched by a core
  push** (ADR-005 §7 / design L19–27); plugins are **out of the auto-deploy fan-out**. The management plane reports
  **plugin version per deployment** so the operator sees plugin drift. **Automated plugin distribution is deferred**
  (→ OOS-033).
- **Source:** **ADR-005 §7**; design-doc-v4.md L19–27, L3183–3203.
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** a plugin update (manual, per-deployment) + the version report.
- **Preconditions:** the `/plugins` per-deployment convention; plugin-version reporting in the push.
- **Behaviour:**
  - Happy path: a core push never modifies `/plugins`; plugin version is reported per deployment.
  - Branches: plugin updates are a separate, manual per-deployment action.
  - Edge / failure: a core push that overwrote a deployment's plugins would break the per-client customisation —
    forbidden; automated distribution is explicitly out of scope for v1 (OOS-033).
- **Data touched:** `/plugins` (per-deployment); plugin-version in the push payload.
- **Permissions:** operator/ops.
- **Config dependencies:** —
- **Surfaces:** plugin-drift view in the management plane (Phase 3).
- **Acceptance criteria:**
  - AC-10.DEP.005.1 — Given a core push, When it deploys, Then `/plugins` is untouched.
  - AC-10.DEP.005.2 — Given each deployment, When it pushes, Then its plugin version is reported so drift is visible.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Automated plugin distribution → **OOS-033** (deferred per ADR-005 §7).

---

# MIG — Schema-migration propagation

### FR-10.MIG.001 — Per-deployment migrate-on-release (independent, against its own Supabase)
- **Statement:** On release, each deployment shall run its schema migrations (`drizzle-kit migrate`) **against its
  own Supabase**, independently of every other deployment. Migrations live as files in the one shared repo (no
  per-client schema forks); per-client variation is env config + `/plugins` only (ADR-001 §2).
- **Source:** design-doc-v4.md L1138–1160, L128–133; **ADR-001 §2**; **ADR-005 §1**.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** a release deploy reaching a deployment.
- **Preconditions:** migration files in the repo; the deployment's Supabase reachable.
- **Behaviour:**
  - Happy path: the deployment migrates its own Supabase on release; identical migration files, N independent runs.
  - Branches: a `vN` and a `vN-1` deployment each run correctly against their own schema (expand-contract, AF-065).
  - Edge / failure: a migration failure on one deployment is isolated (FR-10.MIG.002) — it never touches another.
- **Data touched:** each deployment's Supabase schema.
- **Permissions:** the deploy pipeline (per-deployment).
- **Config dependencies:** —
- **Surfaces:** migration status per deployment (C7 FR-7.MGM.004).
- **Acceptance criteria:**
  - AC-10.MIG.001.1 — Given a release, When it reaches a deployment, Then that deployment runs its migrations against
    its own Supabase, independently of others.
  - AC-10.MIG.001.2 — Given the migration files, When deployed, Then they are identical across the fleet (no
    per-client schema fork).
- **Open decisions:** —
- **Feasibility assumptions:** AF-065 (mixed-version safety, shared with FR-10.DEP.003).
- **Notes:** Migration discipline (`standards/migration-discipline.md`) is the binding constraint; each component
  owns its own migrations.

### FR-10.MIG.002 — Per-deployment migration-failure isolation + halt + alert
- **Statement:** A migration failure on one deployment shall **halt only that deployment** — the previous version
  stays live, and an **alert fires** (the client is stuck on the failed migration, surfaced via the skew alert
  FR-10.DEP.004 + C7 cross-deployment alerts). It **never** affects another client's deployment, and it is **never
  silent** — a half-applied or failed migration that left a deployment in an inconsistent, unalerted state is the
  #3 failure this forbids.
- **Source:** design-doc-v4.md L1141–1160; **ADR-005 §2**; **C7 FR-7.MGM.004**.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** a migration failure during a release deploy.
- **Preconditions:** per-deployment migrate (FR-10.MIG.001); the alert path.
- **Behaviour:**
  - Happy path: a clean migration proceeds; a failed one halts that deployment with the prior version live.
  - Branches: the stuck deployment surfaces in the version-skew view (a laggard) + a direct migration-failure alert.
  - Edge / failure: a migration failure that silently leaves a deployment broken (no alert, no halt) is forbidden;
    other clients are unaffected by construction (isolated Supabase).
- **Data touched:** the failed deployment's schema (halted at the failed step).
- **Permissions:** operator (alert recipient).
- **Config dependencies:** —
- **Surfaces:** migration-failure alert (C7 FR-7.MGM.004).
- **Acceptance criteria:**
  - AC-10.MIG.002.1 — Given a migration failure on deployment A, When it fails, Then A halts (prior version live), an
    alert fires, and no other deployment is affected.
  - AC-10.MIG.002.2 — Given the failure, When it occurs, Then it is never silent — the stuck deployment is surfaced
    (alert + skew view).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** The isolation guarantee is the Silo model paying off — one client's bad migration cannot cascade.

---

# ISO — Isolation & residency

### FR-10.ISO.001 — `client_slug` deleted from all application tables (identity only in the registry)
- **Statement:** The data model shall carry **no `client_slug` (or any client-identity column) in any application
  table** — inside a client's database there is exactly one client, so there is nothing to filter against (ADR-001
  §3). Client identity exists in **exactly one place**: the management-plane `client_registry` (FR-10.MGT.001). The
  Phase-4 schema + any migration enforces this; RLS inside a client DB enforces only role/visibility/sensitivity,
  never client separation (ADR-006).
- **Source:** **ADR-001 §3/§4**; **ADR-006**; design-doc-v4.md L14 (+ the stale `client_slug` schema sites, now
  superseded).
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (data-model invariant; Phase 4 authors the DDL).
- **Preconditions:** the Silo model (ADR-001).
- **Behaviour:**
  - Happy path: the Phase-4 schema creates **no `client_slug` column in any application table**. The design-doc
    schema sites that show it (`memory_metadata`, `guardrail_log`, `credential_usage`, `task_queue`, the
    Inngest/Realtime filters, etc.) are **stale** and superseded by ADR-001 §3.
  - Branches: the **only** valid `client_slug` is in the management-plane `client_registry` (FR-10.MGT.001 /
    FR-10.OFF.006).
  - **Reconciliation (OD-096):** prior Approved components reconciled the design's `client_slug` to "**a label, not
    an RLS key**" (C5 FR-5.QUE.002, C2, C6 `guardrail_log`) — a *partial* reconciliation that removed it as an RLS
    mechanism but left a descriptive column. ADR-001 §3 is unambiguous ("deleted from **all** application tables"),
    and the column was **never load-bearing** (no component uses it for RLS or any filter — confirmed by every prior
    gate's "no `client_slug` in a policy predicate" trap). **FR-10.ISO.001 carries the reconciliation to the ADR's
    terminus: the column is not created.** This **reverses no prior decision** (the "not used for RLS" decision
    stands); it removes a now-redundant descriptive column. The prior "label" mentions become moot (a label on a
    non-existent column); Phase-4 schema authoring is where it is realised, and those three FRs get a clerical
    reconciliation note then (carry-forward).
  - Edge / failure: a `client_slug` filter inside a client DB is the ADR-001 §3 contradiction — there is no second
    client to filter against, so such a predicate is meaningless + a Pooled-model leftover.
- **Data touched:** the whole application schema (absence of the column).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** N/A (schema, Phase 4).
- **Acceptance criteria:**
  - AC-10.ISO.001.1 — Given any application table, When the schema is authored (Phase 4), Then it has no
    `client_slug` / client-identity column.
  - AC-10.ISO.001.2 — Given client identity, When stored, Then it lives only in the management-plane
    `client_registry`.
  - AC-10.ISO.001.3 — Given the prior components' "`client_slug` as a label" reconciliation, When Phase 4 authors the
    schema, Then the column is not created (OD-096) and the three affected FRs (C5 FR-5.QUE.002, C2, C6
    `guardrail_log`) get a clerical reconciliation note — no behavioural change (the column was never used for RLS or
    any filter).
- **Open decisions:** OD-096 (client_slug label-vs-delete) — **resolved** (delete per ADR-001 §3; not load-bearing).
- **Feasibility assumptions:** —
- **Notes:** The canonical statement of the trap every prior component caught locally — homed here as a single
  data-model invariant for Phase 4, carried to the ADR-001 §3 terminus (deletion, not just label-demotion).

### FR-10.ISO.002 — Physical isolation = airtight offboarding deletion evidence
- **Statement:** Because each client runs a **physically separate** Supabase project + Railway service (ADR-001 §1),
  offboarding deprovisioning (FR-10.OFF.005) is **provably complete** — deleting the client's Supabase project is
  airtight evidence the data is gone (no shared store could retain a copy). Physical isolation is a hard product
  promise (compliance + sales), not a nice-to-have.
- **Source:** **ADR-001 §1 + §Consequences** ("offboarding becomes provably clean"); design-doc-v4.md L19.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (isolation property; consumed by offboarding).
- **Preconditions:** the Silo model.
- **Behaviour:**
  - Happy path: a client's data lives only in their own Supabase; deprovisioning it leaves no residue in any shared
    store (there is none).
  - Branches: the offboarding meta-record (FR-10.OFF.006) is the operator-side proof; the deprovisioned project is
    the technical proof.
  - Edge / failure: any shared data store holding a client's business data would break this guarantee (and ADR-001
    §1) — forbidden by construction.
- **Data touched:** N/A (architectural property).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** the offboarding compliance record (FR-10.OFF.006).
- **Acceptance criteria:**
  - AC-10.ISO.002.1 — Given offboarding deprovisions a client's Supabase project, When complete, Then there is no
    shared store that could retain that client's business data (isolation guarantees completeness).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** The compliance payoff of the Silo choice — the deletion-evidence story sales + legal both rely on.

### FR-10.ISO.003 — Data residency: v1 region lock (Sydney) + per-deployment region in the registry + v2 selection
- **Statement:** Each deployment's region shall default to **Sydney `ap-southeast-2`** in v1 (the client owns the
  Supabase, so residency follows their project), be **recorded** per deployment in `client_registry.region`
  (FR-10.MGT.001), and be **selectable at deployment creation in v2** (`CFG-deployment_region`). Per-client
  residency is trivially possible because each client owns their own Supabase (ADR-001 §Consequences); v1 ships the
  single-region default.
- **Source:** **ADR-001 §Consequences** (residency); **ADR-005 §5** (default region); design-doc-v4.md L29–33.
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** provisioning (region default) + the v2 selection.
- **Preconditions:** the client's Supabase project (their ownership); `client_registry.region`.
- **Behaviour:**
  - Happy path: v1 deployments default to `ap-southeast-2`; the region is documented in the management plane.
  - Branches: v2 adds region selection at creation (config value); a residency-sensitive client picks their region.
  - Edge / failure: a residency requirement that v1's single-region default cannot meet is a **known v1 limit**
    (region selection deferred to v2) — surfaced in onboarding (FR-10.LEG.001 legal review), not silently assumed.
    **⚠️ FEASIBILITY: AF-071** (backup residency for the AU/region requirement — shared with the Phase-5 backup
    track).
- **Data touched:** `client_registry.region`.
- **Permissions:** operator (set at provisioning).
- **Config dependencies:** `CFG-deployment_region` (v2).
- **Surfaces:** region per deployment in the management plane (Phase 3).
- **Acceptance criteria:**
  - AC-10.ISO.003.1 — Given v1 provisioning, When a deployment is created, Then its region defaults to
    `ap-southeast-2` and is recorded in `client_registry.region`.
  - AC-10.ISO.003.2 — Given v2, When a deployment is created, Then a region is selectable at creation.
- **Open decisions:** —
- **Feasibility assumptions:** AF-071 (backup/data residency, build-time — Phase-5 backup track).
- **Notes:** Residency is "trivially possible later" because of the isolation model — v1 locks one region to keep
  provisioning simple.

---

# LEG — Legal

### FR-10.LEG.001 — Mandatory legal review before handling regulated personal data
- **Statement:** The retention/deletion design reflects **general best practice, not legal advice**; the specific
  lawful retention periods + deletion procedures **vary by jurisdiction (Australia Privacy Act 1988, UK GDPR, EU
  GDPR, US as applicable), client type, and data nature**. The system shall require that a **qualified lawyer
  reviews** the specific retention values (FR-10.RET.002) + deletion procedures **before** the system handles
  regulated personal data from a given jurisdiction; jurisdiction-sensitive features (e.g. enabling HR content,
  L1420) require that review before enablement.
- **Source:** design-doc-v4.md L4107–4109, L1420 (HR opt-in legal review).
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** onboarding a client in a given jurisdiction / enabling a regulated-data feature.
- **Preconditions:** the configurable retention floors (FR-10.RET.002); the legal-review process.
- **Behaviour:**
  - Happy path: before a deployment handles regulated personal data, the retention values + deletion procedures are
    legally reviewed for that jurisdiction; HR-content enablement requires the review (L1420).
  - Branches: the legal-minimum floors (FR-10.RET.002) are *configurable safeguards* set per the review, not
    hard-coded legal values.
  - Edge / failure: shipping a jurisdiction's regulated data on **unreviewed** retention/deletion settings is the
    compliance (#2) risk this requirement forbids being assumed-away. **⚠️ FEASIBILITY: AF-136** (the lawful minimums
    are jurisdiction-specific — the spec cannot assert them; legal review is the gate).
- **Data touched:** N/A (process requirement).
- **Permissions:** operator + the client's legal counsel.
- **Config dependencies:** FR-10.RET.002 (the values set per review).
- **Surfaces:** an onboarding legal-review checklist (operational doc).
- **Acceptance criteria:**
  - AC-10.LEG.001.1 — Given a deployment handling a jurisdiction's regulated personal data, When provisioned, Then
    the retention values + deletion procedures have been legally reviewed for that jurisdiction.
  - AC-10.LEG.001.2 — Given a jurisdiction-sensitive feature (e.g. HR content), When enabled, Then the legal review
    is a precondition (L1420).
- **Open decisions:** —
- **Feasibility assumptions:** AF-136 (jurisdiction-specific lawful minimums — legal review is the gate, not the
  spec).
- **Notes:** The spec is honest that compliance values are *paper until a lawyer signs off* — the legal analogue of
  the paper-vs-proven feasibility discipline.

---

## Open decisions raised by this component (to resolve before sign-off)

| OD | Question | Touches | Recommendation |
|----|----------|---------|----------------|
| **OD-089** | Offboarding hard-deletion (Step 4) partial-failure: a sub-step (Supabase/Railway/credential/token) fails mid-sequence | **#2/#3** | Each sub-step idempotent + result-recorded; a failure holds the offboarding in `deletion_failed` with per-system status + escalation; **never** mark complete on a partial deprovision; **no auto-rollback** of a deprovision (can't un-delete — fix forward). Realised in FR-10.OFF.005. |
| **OD-090** | Export integrity before destruction: destroying data after a corrupt/incomplete export = #1 knowledge loss | **#1** | Export is verified-complete (row-count/checksum reconciliation) **and** client-acknowledged (`export_acknowledged_at`) as a **hard gate** — destruction cannot run without both. Realised in FR-10.OFF.002/003/005. |
| **OD-091** | Deployment freeze enforcement during the retention window — "no agents run, no loops execute" needs an enforcement consumer | **#2/#3** | C10 sets `client_registry.status = frozen`; the **C5 trigger/queue/loop dispatch layer checks it before any dispatch + fails closed** (mirrors the C8 OD-081 memory-scope wiring — applied via change-control to a C5 AC). Realised in FR-10.OFF.004 + the C5 amendment. |
| **OD-092** | Individual erasure name-in-content matching: fuzzy match risks false-neg (un-erased PII, #2) / false-pos (over-delete, #1) | **#1/#2** | Deterministic `entity_id` matches auto-action; **name-in-content matches are surfaced for human confirmation**, never auto-deleted/redacted; the sweep is recall-oriented + reviewed. Realised in FR-10.DEL.002/004 + AF-134. |
| **OD-093** | Two-person authorisation for Restricted/Personal erasure: can the executor be their own second authoriser? | **#2** | No — the second authoriser must be a **distinct** Admin/Super Admin (no self-authorisation, mirrors C6 AC-6.APR.005.3). Realised in FR-10.DEL.006. |
| **OD-094** | Release-train promotion: manual operator action vs automated | (process) | **Manual operator-initiated promotion in v1**; automated promotion deferred until trust is established (config flag later). Realised in FR-10.DEP.002. |
| **OD-095** | Version-skew alert thresholds have no design defaults | (process/#3) | Defaults **3 versions behind / 14 days stale**, config-tunable (`deploy_max_version_skew` / `deploy_max_skew_days`). Realised in FR-10.DEP.004. |

**Carry-in debts actioned this session (change-control):**
- **OD-074** — C2 FR-2.MNT.017 amended to trigger the C7 log redaction-tombstone (`event_log` / `guardrail_log`) on
  erasure (wired by FR-10.DEL.004).
- **OD-068** — the owed **C6 cost-ladder enforcement FR** — actioned as a C6 change-control addition this session
  (the last Phase-1 component is where this debt must clear, or it leaks past Phase 1).

**New feasibility (block U, from AF-132):** AF-132 (offboarding deprovision completeness, SPIKE) · AF-133 (export
integrity/readability at scale) · AF-134 (individual-erasure recall / name-matching, EVAL) · AF-135 (deployment-
freeze propagation completeness) · AF-136 (jurisdiction-specific lawful retention minimums — legal-review-gated).
Carried-in build-time AFs relied on: AF-004 (provisioning), AF-013 (Google verification), AF-020 (Railway
auto-deploy), AF-064 (release-train model), AF-065 (expand-contract mixed-version), AF-066 (canary
representativeness), AF-071 (backup residency — Phase 5).

**New OOS:** OOS-033 (automated plugin distribution — deferred per ADR-005 §7).
