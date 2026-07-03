---
id: ISSUE-085
title: Backup & DR — off-platform dump + restore rehearsal + backup-health push
epic: K — infra & compliance
status: blocked
github: "#85"
---

# ISSUE-085 — Backup & DR — off-platform dump + restore rehearsal + backup-health push

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR/NFR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the per-silo backup & disaster-recovery posture of ADR-008 — the hourly client-owned off-platform `pg_dump` (default RPO ~1 hour) + free daily in-project floor, the operator-run tested restore rehearsal (DB + pgvector + `auth` rows, monthly + per-migration), the five backup-health fields on the management-plane push with a loud lapse/stale alert, and the off-platform backup-purge leg of compliance erasure — so "a backup exists" is upgraded to "a restore is *proven*" and no lapse is ever silently assumed-healthy.

## 2. Scope — in / out
**In:**
- The default recovery tier per silo: free daily in-project backups **plus** an hourly off-platform `pg_dump` to a client-owned, encrypted, different-region destination independent of the primary project's billing lifecycle; PITR left off (documented opt-in upsell); any cadence below hourly is a *logged* downgrade, never a silent default (NFR-DR.001, NFR-DR.002).
- The operator-run restore-rehearsal job: restore a recent snapshot into a throwaway project, assert DB + pgvector memory + `auth` user rows come back complete and queryable, log result + timestamp, run **monthly + on every schema-migration release** (NFR-DR.003).
- The ownership split wired into the provisioning runbook + retainer: client owns+pays, operator operates+verifies; the operator's scheduled snapshot + rehearsal jobs exist (NFR-DR.004).
- The stated DR posture — backup-restore-with-downtime, no hot failover, HA/read-replica as per-client upsell — recorded so no one assumes failover that does not exist (NFR-DR.005).
- The five backup-health fields on the management-plane push (recovery tier · last in-project backup + ts · project status active/paused/billing-at-risk · last off-platform snapshot + ts · last rehearsal + result), sourced via the Supabase Management API, and the Super Admin **loud lapse/stale alert** (NFR-DR.006), wired into `deployment_health.backup_health`.
- The Storage-out-of-scope posture (v1 Storage = regenerable exports only; source referenced by `source_ref`, never copied) so the dump backs up only the derived DB layer (NFR-DR.007).
- The audit-sink defense-in-depth *composition* assertion — proven restore ∩ append-only immutability ∩ shadow-retain (NFR-DR.008).
- The off-platform backup-purge leg of compliance erasure: receive + action FR-2.MNT.017's purge flag against pre-erasure off-platform snapshots within one dump-cycle, log completion or a still-open flag (NFR-DR.009).

**Out:**
- The management-plane **ingest endpoint + `client_registry` + health-reporter push machinery** and the staleness sweep itself: **ISSUE-012** owns these; this issue *adds* the backup-health payload fields + alert onto that push.
- The **provisioning script** that creates/connects the off-platform destination and schedules the hourly + rehearsal jobs (FR-10.PRV.001): **ISSUE-007** owns provisioning; this issue supplies the *job definitions + schedules* it wires and asserts they exist per NFR-DR.004.
- The **restore-actually-works spike** (AF-069 end-to-end proof at volume): **ISSUE-004** (SPIKE) proves it; this issue builds the *standing* rehearsal on top of a GREEN AF-069.
- **Individual-erasure workflow** (the DEL request queue, two-person auth, transitive C2 delete) that *raises* the purge flag: **ISSUE-082** (via C2 FR-2.MNT.017 / ISSUE-029); this issue owns only the off-platform-snapshot *processing* leg (NFR-DR.009).
- **Client offboarding's** whole-backup purge flag (FR-10.OFF.005 AC-10.OFF.005.6): **ISSUE-083** raises it; this issue's off-platform pipeline is the consumer it depends on.
- **Cost-ladder / cost-overview** metering on the push: C7 COST (ISSUE-074); only the backup-health fields are added here.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-7.MGM.005 (Component 7 — Observability; backup-health on the mgmt-plane push), FR-10.PRV.001 (Component 10 — Infra & Compliance; provisioning schedules the hourly + rehearsal jobs — *consumed*, owned by ISSUE-007), FR-2.MNT.017 / AC-2.MNT.017.2 (Component 2 — Memory; *raises* the off-platform purge flag — see AC-2.MNT.017.2 for the raise-leg. **The flag's mechanics (payload/delivery/what "flagged for purge" means on the pipeline side) are explicitly seamed by C2 to Phase 5 and are defined here in NFR-DR.009, not in C2 — NFR-DR.009 IS the receive-leg contract**; do not expect a payload shape in component-02).
- **NFRs:** NFR-DR.001, NFR-DR.002, NFR-DR.003, NFR-DR.004, NFR-DR.005, NFR-DR.006, NFR-DR.007, NFR-DR.008, NFR-DR.009. (Security-custody companion NFR-SEC.017 — encrypted/client-held/different-region — is referenced, owned in `security.md`.)
- **Rests on:** ADR-008 (all six Decision parts + DR posture), ADR-001 (hybrid ownership + golden rule + §7 mgmt-plane boundary), ADR-005 (provisioning runbook the split is captured in); AF-069 (SPIKE, blocking), AF-070 (SPIKE, build-time), AF-071 (DOCS), AF-072 (LOAD), AF-137 (SPIKE, transitive-erasure off-platform leg); OOS-013 (Storage out of scope), OOS-014 (HA/read-replica upsell).

## 4. Definition of done (the `AC-*` / `AC-NFR-*` IDs that must pass — text read in the NFR/FR)
- AC-NFR-DR.001.1, AC-NFR-DR.001.2 (default tier + hourly RPO; below-hourly is logged)
- AC-NFR-DR.002.1, AC-NFR-DR.002.2 (off-platform copy client-owned/encrypted/different-region/lifecycle-independent; survives deletion path)
- AC-NFR-DR.003.1, AC-NFR-DR.003.2 (tested restore: DB + pgvector + `auth` complete & queryable; standing cadence logs result, stale/failed → loud alert)
- AC-NFR-DR.004.1 (ownership split recorded in runbook + retainer; operator jobs exist)
- AC-NFR-DR.005.1, AC-NFR-DR.005.2 (restore-with-downtime posture, measured RTO not assumed; HA offered as upsell)
- AC-NFR-DR.006.1, AC-NFR-DR.006.2 (five backup-health fields + zero business data on push; lapse/stale → loud alert, stale reads stale not green)
- AC-NFR-DR.007.1 (Storage holds only regenerable exports; no source-of-truth un-backed-up)
- AC-NFR-DR.008.1 (restore ∩ immutable audit history ∩ shadow-retain each independently preserve knowledge)
- AC-NFR-DR.009.1, AC-NFR-DR.009.2 (purge flag received + snapshots purged within a dump-cycle; still-open flag logged loud at next rehearsal/health-check)
- AC-7.MGM.005.1 (backup-health visible in Super Admin view, sourced from Management API, no business data crosses)
- **Gating spikes:** **AF-069 must be GREEN** before this issue ships — proven by **ISSUE-004** (restore actually works: DB + pgvector + auth complete & queryable, blocking RP-1 spike per OD-157); it is where the real **RTO** number is confirmed. **AF-070** (build-time — Management API exposes the five fields; degrade-loud if a field is missing) and **AF-072** (LOAD — hourly dump completes within the hour at volume; fall back to backed-off cadence or PITR upsell, logged) must be actioned as DoD notes; **AF-071** (DOCS — backup region vs `ap-southeast-2` residency) confirmed for NFR-DR.002; **AF-137** (SPIKE) covers the NFR-DR.009 off-platform purge leg.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-deployment_health (`.backup_health` jsonb — the five-field payload; `.last_push_at` for staleness; management-plane table, schema §13), DATA-client_registry (`.status` read for project active/paused/billing-at-risk framing; `.region`; schema §13). No client-silo business tables are read by the backup-health path (metadata-only, ADR-001 §7). The restore rehearsal exercises the full silo DB (pgvector `memories`/embeddings + `auth` rows) in a *throwaway* project, not production.
- **PERM:** `PERM-config.infra` (Super Admin — recovery-tier / PITR-upsell toggle, backup-health config; node defined in `config-registry.md §M` gate table, `UI-config-admin#infra`, never delegable — that §M header IS its source of truth in the current repo, as no `PERMISSION_NODES.md` catalog file exists yet; minting/cataloguing the management-plane fleet-action nodes is tracked separately under surface-06 OD-125 and is **not** in this slice). The operator's backup job holds a **delegated credential** scoped to backup ops + status reads only, **not** a broad grant — note this scope boundary is **DOCS-posture stated in ADR-008 §Consequences** (custody companion NFR-SEC.017; secrets-custody handling NFR-SEC.003), **not yet a concrete grant/scope spec in the named files**; the buildable credential-scope definition is owned by ISSUE-007's provisioning (which creates the credential) and must land there before wiring — this issue asserts the posture, it does not define the grant.
- **CFG:** `recovery_tier` (the per-silo backup tier key — `config-registry.md §M`, `PERM-config.infra`, `UI-config-admin#infra`; enum incl. hourly-off-platform default vs `daily_in_project` floor vs PITR upsell — any move below hourly off-platform is a change-control-logged downgrade, never a silent default, per ADR-008 §1), plus the restore-rehearsal cadence + off-platform-destination config carried in the provisioning/DEPLOYMENT_CONFIG (owned by ISSUE-007's provisioning; consumed here). Staleness window inherits the mgmt-plane freshness window (OBS-f / FR-7.MGM.002).
- **UI:** UI-dashboard-super-admin (backup-health grid + loud lapse/stale + project-pause/billing-at-risk alert — data contract owned here; rendering is Phase 3 / ISSUE-078).
- **Connectors:** none (Supabase Management API + `pg_dump`/CLI are platform, not a client connector).

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/05-non-functional/backup-dr.md — the NFR-DR.001–009 rows + ACs (this domain IS ADR-008 as operational NFRs); the stated RPO ~1h / RTO posture. **NFR-DR.009 is the receive-leg contract for the purge flag** (what "received + actioned" means on the pipeline side; C2 seams the mechanics here).
- spec/00-foundations/adr/ADR-008-backup-dr.md — the six binding Decision parts + DR posture + the feasibility block (AF-069/070/071/072); **§Consequences carries the delegated-credential posture** (DOCS, not a grant spec — see field 5 PERM).
- spec/01-requirements/component-02-memory.md — **FR-2.MNT.017 + AC-2.MNT.017.2**: the raise-leg the off-platform purge flag originates from. Note C2 explicitly seams the *mechanics* to Phase 5 (AC-2.MNT.017.2 reads "flagged for purge per ADR-008 — mechanics owned by Phase 5"); the pipeline-side contract is NFR-DR.009, not here. Open only for the raise-leg wording + the AC IDs; do not expect a payload/delivery spec.
- spec/01-requirements/component-07-observability.md — FR-7.MGM.005 (backup-health on the push) + its ACs.
- spec/01-requirements/component-10-infra-compliance.md — FR-10.PRV.001 (provisioning schedules the jobs; consumed) + the offboarding backup-purge cross-ref (FR-10.OFF.005 AC-10.OFF.005.6, H30); `PERM-config.infra` usage (line ~187).
- spec/02-config/config-registry.md §M (Infrastructure & compliance — `PERM-config.infra` · `UI-config-admin#infra`) — the **`recovery_tier`** key definition (its class/enum/validation) and the §M gate-table row that defines `PERM-config.infra` (the node's source of truth in-repo; no separate `PERMISSION_NODES.md` catalog exists yet — see field 5).
- spec/04-data-model/schema.md §13 (Management plane) — `deployment_health` (`.backup_health`) + `client_registry` (`.status`).
- spec/05-non-functional/security.md — NFR-SEC.017 (backup security-custody companion) + NFR-SEC.003 (secrets custody — redaction/presence-only; the delegated-credential *scope* is ADR-008 §Consequences posture, not a grant spec here).
- spec/00-foundations/feasibility-register.md — AF-069, AF-070, AF-071, AF-072, AF-137 (verification methods + gate status).

## 7. Dependencies
- **Blocked-by:** ISSUE-012 (management-plane bootstrap — `client_registry` + ingest endpoint + health push this slice adds the backup-health fields/alert onto), ISSUE-004 (**SPIKE** — proves **AF-069** GREEN: restore actually works end-to-end incl. pgvector + `auth`, the blocking RP-1 gate under NFR-DR.003 / ADR-008 part 4).
- **Blocks:** ISSUE-083 (client offboarding — its FR-10.OFF.005 whole-backup purge flag depends on the off-platform snapshot pipeline + purge processing built here).

## 8. Build order within the slice
1. Confirm ISSUE-004 (AF-069) is GREEN and ISSUE-012's health push + `deployment_health` are in place — this slice adds the backup-health payload + rehearsal on top; do not re-build the push or the registry.
2. Define the **hourly off-platform `pg_dump` job**: encrypted logical dump → the client-owned, different-region destination, lifecycle-independent of the primary project; keep the free daily in-project floor; leave PITR off. Emit the below-hourly downgrade path as a *logged* exception, never a silent default (NFR-DR.001/002 → AF-071 residency, AF-072 cadence-at-volume). The provisioning *scheduling* is FR-10.PRV.001 (ISSUE-007); this step supplies the job definition it wires.
3. Define the **restore-rehearsal job**: restore a recent snapshot into a throwaway project; assert DB + pgvector memory + `auth` user rows complete + queryable within acceptable downtime; log result + timestamp; schedule monthly + on every schema-migration release (NFR-DR.003, RP-2). Capture the measured RTO here (NFR-DR.005).
4. Wire the **five backup-health fields** into `deployment_health.backup_health` via the Management API (`GET /v1/projects/{ref}/database/backups` + project status): recovery tier · last in-project backup + ts · project status · last off-platform snapshot + ts · last rehearsal + result (NFR-DR.006 → AF-070 build-time; degrade-loud to what the API *does* expose + a coarser pause alert if a field is missing).
5. Raise the **loud lapse/stale alert** on the Super Admin view: any lapsed/stale field, or a project entering paused/billing-at-risk, alerts; a stale field reads *stale*, never green (staleness inherits the mgmt-plane freshness window; AC-7.MGM.005.1). Data contract only — Phase 3 / ISSUE-078 renders.
6. Wire the **off-platform purge leg** (NFR-DR.009 — this is the receive-leg contract; **build against NFR-DR.009 / AC-NFR-DR.009.1–.2, not against C2**, since C2 seams the mechanics here): receive the compliance-erasure purge flag *raised* by FR-2.MNT.017 (AC-2.MNT.017.2 is the raise-leg; the pipeline-side "received + actioned" semantics — that an erased target's Personal data is purged/expired from pre-erasure off-platform snapshots — are defined in NFR-DR.009); purge/expire within one dump-cycle (≤ hourly cadence) or confirm at the next rehearsal; log completion, and surface a still-open flag as a *logged* exception at the next rehearsal/health-check (→ AF-137). Note the concrete flag payload/delivery is unspecified in C2 by design — treat NFR-DR.009's received-and-actioned semantics as the interface, and coordinate the actual transport with the ISSUE-082 raise-leg it consumes from (field 2 Out).
7. Record the **ownership split** (client owns+pays / operator operates+verifies) into the provisioning runbook + retainer, and the **DR posture** (restore-with-downtime, no hot failover, HA=upsell OOS-014) + the **Storage-out-of-scope** posture (OOS-013) so none is silently assumed (NFR-DR.004/005/007). Assert the audit-sink defense-in-depth composition (NFR-DR.008).
8. Test to each AC in field 4 across: an inspected provisioned silo (tier + destination), a rehearsal pass (throwaway restore), a lapsed/stale field (loud alert), and a planted pre-erasure residue cleared by the purge flag.

## 9. Verification (how DoD is proven)
- **Spike gate (blocking):** AF-069 GREEN via ISSUE-004 is a precondition to shipping NFR-DR.003 — a restore that comes back complete + queryable (DB + pgvector + `auth`) within acceptable downtime; the AC→`Verified` path for the restore ACs runs once AF-069 is GREEN and the RTO number is recorded (per spec/05-non-functional/test-strategy.md).
- **Provisioning/inspection layer:** an inspected provisioned silo shows free-daily + hourly off-platform, PITR off, destination client-owned/encrypted/different-region/lifecycle-independent — AC-NFR-DR.001.1, AC-NFR-DR.002.1; the ownership split recorded + operator jobs exist — AC-NFR-DR.004.1.
- **Rehearsal (integration):** the standing monthly/per-migration rehearsal restores into a throwaway project and logs pass; a forced stale/failed rehearsal raises a loud alert — AC-NFR-DR.003.1/.2, AC-NFR-DR.005.1.
- **Health push (build-time, AF-070):** the push payload carries the five fields + zero business data, sourced from the Management API; a lapsed/stale field or a paused/billing-at-risk project raises a loud alert reading stale-not-green — AC-NFR-DR.006.1/.2, AC-7.MGM.005.1; missing-field degrade-loud proven against the live API.
- **Cadence-at-volume (LOAD, AF-072):** the hourly dump completes within the hour for a large mature brain, else backs off / moves to PITR as a *logged* decision — AC-NFR-DR.001.2.
- **Erasure leg (SPIKE, AF-137):** a planted pre-erasure residue in an off-platform snapshot is cleared by the purge flag within the stated window; a still-open flag surfaces logged — AC-NFR-DR.009.1/.2.
- **Posture assertions (DOCS):** restore-with-downtime + HA-upsell + Storage-out-of-scope + defense-in-depth composition recorded — AC-NFR-DR.005.2, AC-NFR-DR.007.1, AC-NFR-DR.008.1.
