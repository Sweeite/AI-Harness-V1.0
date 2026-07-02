# NFR — Backup & Disaster Recovery  (`NFR-DR`)

> **Context manifest.** Depends on: ADR-008 (the whole ADR — this domain IS ADR-008 turned into
> operational NFRs), ADR-001 (ownership boundary + golden rule on systems of record), FR-7.MGM.005
> (backup-health on the mgmt-plane push), and the feasibility gates AF-069 / AF-070 / AF-071 / AF-072.
> **Reference-don't-re-spec:** each `NFR-DR` row names the ADR §/FR that *owns* it and adds only the
> recovery posture, the RPO/RTO number, the ownership split, or the verification method. The
> backup *security-custody* view (encrypted, client-held, different region) lives in `security.md`
> NFR-SEC.017; this file is the *recovery-side* companion — what must come back, how it is proven,
> and how a lapse is made loud.
>
> **Upholds primarily #1 (never lose or corrupt knowledge)** — a *proven* restore + an off-platform
> copy that survives the billing-lapse→deletion path — **with #3 (never fail silently)** alongside:
> a backup lapse or a stale rehearsal is a loud alert, never a silently-assumed-healthy state
> ("backup exists ≠ restore works").

---

### The RPO / RTO numbers (stated, not assumed)

- **RPO ~1 hour** — bounded by the hourly off-platform `pg_dump` (ADR-008 §1). Recent loss is further
  softened by the golden rule: the brain stores pointers + enrichment over systems of record, so
  writes lost inside the window are re-derivable by re-ingestion (ADR-008 Context).
- **RTO = restore-with-downtime** — **minutes-to-hours depending on DB size, NOT instant.** There is
  **no hot failover** (Supabase auto-failover is Enterprise-only, ADR-008 §Context). A real RTO
  number can only be confirmed by the AF-069 restore rehearsal at volume — **to be confirmed by
  AF-069** (and AF-072 for how restore time scales with the corpus).

---

### NFR-DR.001 — Default recovery tier + RPO ~1 hour

- **Requirement:** The system shall provision, per silo, a default recovery tier of **free daily in-project backups + an hourly off-platform `pg_dump`**, targeting **RPO ~1 hour**; **PITR is a documented opt-in upsell** (~$100+/mo on the client's card), off by default; running *below* hourly (e.g. daily-only) is a **logged downgrade exception**, never a silent default.
- **Type:** posture + threshold.
- **Upholds:** #1 (an ~1-hour recovery point on the derived layer, re-derivable beyond that via the golden rule) + #3 (a downgrade below hourly is logged, not silent).
- **Implemented by:** ADR-008 §1 (Decision part 1) · FR-10.PRV.* (provisioning schedules the hourly job) · config `recovery_tier`.
- **Target / threshold:** RPO ~1 hour (hourly off-platform dump); free daily in-project floor; PITR ~2-min RPO only when the client opts in.
- **Verification:** **LOAD (AF-072)** — confirm the hourly dump completes within the hour and restore time scales acceptably for a large mature brain.
- **Launch gate:** **blocking-ish → gates the default cadence** (AF-072). AF-072 is build-time verification of the *default*: if hourly can't keep up, **back off the cadence (logged) or move the client to the PITR upsell** — the product still ships, but that client's default RPO is re-set as a logged decision.
- **Acceptance criteria:**
  - AC-NFR-DR.001.1 — Given a provisioned silo, When its recovery tier is inspected, Then it has free daily in-project backups **and** an hourly off-platform dump scheduled, with PITR off unless explicitly opted in.
  - AC-NFR-DR.001.2 — Given the hourly dump under a large-corpus load (AF-072), When it cannot complete within the hour, Then the cadence is backed off or PITR is enabled as a **logged** decision — the silo is never left silently below its stated RPO.
- **Notes / OD:** ⚠️ **FEASIBILITY: AF-072** — the hourly cadence is the *default RPO mechanism*, so this AF directly gates the default (ADR-008 §1).

### NFR-DR.002 — Off-platform copy is the only defense against billing-lapse→deletion

- **Requirement:** The system shall write an **independent off-platform logical backup** (`pg_dump`) to a destination that is **encrypted, client-owned, in a different region, and independent of the primary project's billing lifecycle** — because a client-billing lapse pauses the project (~7 days), holds it restorable for ~90 days, then **permanently deletes the project *and its in-project backups*.** The off-platform copy is the **only** thing that survives that path.
- **Type:** posture.
- **Upholds:** #1 (survives the catastrophic total-loss path that every in-project backup dies to).
- **Implemented by:** ADR-008 §2 (Decision part 2) · FR-10.PRV.* (provisioning creates/connects the destination + schedules the job). **Security-custody view:** `security.md` NFR-SEC.017.
- **Target / threshold:** encrypted · client-owned · different region (where practical) · hourly · independent of project lifecycle. Operator orchestrates but **never holds** the copy (an operator-held copy is a logged per-client exception).
- **Verification:** **DOCS** for the residency/region (**AF-071**, shared with `compliance.md`) + build-time check that the job writes to a client-owned destination, not an operator store.
- **Launch gate:** blocking (custody + existence of the copy is in place at launch); the *restore proof* on this copy is NFR-DR.003 (blocking there).
- **Acceptance criteria:**
  - AC-NFR-DR.002.1 — Given the off-platform backup, When its destination is inspected, Then it is client-owned, encrypted, in a different region, and independent of the primary project's lifecycle; any operator-held copy is a logged exception.
  - AC-NFR-DR.002.2 — Given a client-billing lapse → project pause/deletion, When the in-project backups are gone, Then the off-platform copy still exists and is restorable (NFR-DR.003).
- **Notes / OD:** ⚠️ **FEASIBILITY: AF-071** (DOCS — vendor confirmation of backup/off-platform region locality vs AU residency `ap-southeast-2`; shared with `compliance.md` CMP-a).

### NFR-DR.003 — Tested restore (the only restore that counts)

- **Requirement:** The system shall run a **periodic operator restore rehearsal** — restore a recent snapshot into a **throwaway project** and confirm the database, **including pgvector memory and `auth` user rows, comes back complete and queryable** — and **log the result + timestamp**. Supabase verifies nothing; the operator does. "A backup exists" ≠ "a restore works."
- **Type:** verification (the #1 keystone of this domain).
- **Upholds:** #1 (the restore guarantee is *proven*, not assumed) + #3 (a stale/failed rehearsal is surfaced loud, never assumed-green).
- **Implemented by:** ADR-008 §4 (Decision part 4) · FR-7.MGM.005 (the rehearsal result rides the mgmt-plane push).
- **Target / threshold:** **MONTHLY automated rehearsal + on EVERY schema-migration release** (RP-2, session 45 — operator-decided cadence). A pass = DB + pgvector + `auth` rows complete and queryable within acceptable downtime.
- **Verification:** **SPIKE (AF-069)** — a restore actually works end-to-end (DB + pgvector + auth complete + queryable) within acceptable downtime, then the standing periodic rehearsal above.
- **Launch gate:** **blocking (RP-1)** — AF-069 is one of the six blocking spikes. A backup that can't restore is a **#1 catastrophe**; the restore must be proven before go-live.
- **Acceptance criteria:**
  - AC-NFR-DR.003.1 — Given a recent snapshot restored into a throwaway project (AF-069), When the restored DB is queried, Then pgvector memory **and** `auth` user rows come back complete and queryable within acceptable downtime.
  - AC-NFR-DR.003.2 — Given the standing cadence, When a month elapses **or** a schema-migration release ships, Then a rehearsal runs and its result + timestamp are logged; a missing/failed/stale rehearsal raises a loud alert (NFR-DR.006).
- **Notes / OD:** ⚠️ **FEASIBILITY: AF-069** (blocking). This is also where the real **RTO** number is confirmed — until AF-069 runs, RTO is "minutes-to-hours, to be confirmed."

### NFR-DR.004 — Ownership split (client owns + pays / operator operates + verifies)

- **Requirement:** The system shall hold the backup responsibility as the ADR-001 hybrid made explicit: the **client owns + pays** (the project, the plan, the off-platform destination, the optional PITR add-on) and the **operator operates + verifies** (schedules the snapshot job, runs the restore rehearsals, watches health). **Neither side may assume the other is doing it.**
- **Type:** posture + duty.
- **Upholds:** #1 (no gap where each party assumes the other backs up) — preserves the ADR-001 data-custody boundary (the operator never holds the client's business data).
- **Implemented by:** ADR-008 §3 (Decision part 3) · ADR-001 (hybrid ownership) · captured in the provisioning runbook (ADR-005) + the retainer scope.
- **Target / threshold:** N/A (governance split; named, not assumed).
- **Verification:** DOCS (the split is written into the provisioning runbook + retainer scope; the operator-run jobs exist per NFR-DR.001/003).
- **Launch gate:** blocking (the split must be named + wired before a client is live, or backups fall between the two parties).
- **Acceptance criteria:**
  - AC-NFR-DR.004.1 — Given a provisioned client, When the backup responsibility is inspected, Then the client-owns-pays / operator-operates-verifies split is recorded in the runbook + retainer, and the operator's scheduled snapshot + rehearsal jobs exist.
- **Notes / OD:** the only split consistent with ADR-001's hybrid; the operator holds only a delegated credential scoped to backup ops + status reads (see NFR-SEC.003 / ADR-008 §Consequences), not a broad grant.

### NFR-DR.005 — DR posture: backup-restore-with-downtime, not hot failover

- **Requirement:** The system shall treat a silo's disaster recovery as **backup-restore with downtime, not hot failover** — explicitly acceptable at ADR-001's **≤~20-user / ≤~20-client** scale — and shall treat **read-replicas / HA failover as a per-client upsell, not a v1 default** (OOS-014).
- **Type:** posture.
- **Upholds:** #1 (recovery is real, if not instant) — with an honest, stated RTO rather than an implied-but-absent hot-failover promise.
- **Implemented by:** ADR-008 §Disaster-recovery posture · OOS-014.
- **Target / threshold:** RTO = restore-with-downtime (minutes-to-hours by DB size, **to be confirmed by AF-069**); no auto-failover (Enterprise-only on Supabase); HA = per-client upsell.
- **Verification:** DOCS (the posture is stated + the RTO is measured at the AF-069 rehearsal, not claimed as instant).
- **Launch gate:** blocking (the posture must be stated at launch so no one assumes hot failover that does not exist).
- **Acceptance criteria:**
  - AC-NFR-DR.005.1 — Given a silo-level disaster, When recovery runs, Then it is a backup-restore with bounded downtime (not instant failover), and the expected RTO is a measured AF-069 number, not an assumed one.
  - AC-NFR-DR.005.2 — Given a client needing sub-restore-window RTO / contractual HA, When they request it, Then read-replicas / HA are offered as a per-client upsell (OOS-014), not silently assumed present.
- **Notes / OD:** OOS-014 logs HA/read-replica as the per-client upsell; the scale envelope is ADR-001 (also PERF-e).

### NFR-DR.006 — Backup-health on the management-plane push (loud lapse alert)

- **Requirement:** The system shall include **backup-health as operational metadata only** on the management-plane push — **recovery tier · last in-project backup + timestamp · project status (active / paused / billing-at-risk) · last off-platform snapshot + timestamp · last restore-rehearsal date + result** — read via the **Supabase Management API** (no business data crosses), and the Super Admin dashboard shall raise a **loud alert if any of these lapse or go stale**, catching an approaching pause → 90-day deletion window long before deletion.
- **Type:** duty + verification.
- **Upholds:** #3 (a backup lapse or stale rehearsal is *seen*, never silently assumed-healthy) + #1 (the deletion path is caught early).
- **Implemented by:** FR-7.MGM.005 · ADR-008 §5 (Decision part 5) · ADR-001 §7 (mgmt-plane boundary).
- **Target / threshold:** all five backup-health fields present on the push; loud alert on lapse/stale (staleness inherits the mgmt-plane freshness window — a stale snapshot reads stale, never green; cf. OBS-f).
- **Verification:** **SPIKE (AF-070)** — confirm the Supabase Management API's `GET /v1/projects/{ref}/database/backups` (+ project status) actually returns last-backup timestamp, recovery tier, and project status; **build-time** wiring of the fields + alert. AF-070 is build-time verification that the API exposes the fields the push needs; if a field is missing, the monitor degrades to what *is* exposed + a coarser pause alert (never a silent gap).
- **Launch gate:** **blocking-ish → build-time** (AF-070). Not one of the six RP-1 spikes, but the lapse alert is a #3 duty that must be wired at launch; a missing API field degrades loud, never silent.
- **Acceptance criteria:**
  - AC-NFR-DR.006.1 — Given the mgmt-plane push, When its payload is inspected, Then it carries the five backup-health fields (recovery tier, last in-project backup + ts, project status, last off-platform snapshot + ts, last rehearsal + result) and zero business data.
  - AC-NFR-DR.006.2 — Given a lapsed/stale backup or rehearsal (or a project entering paused / billing-at-risk), When the health push is evaluated, Then the Super Admin dashboard raises a loud alert; a stale field reads stale, never green.
- **Notes / OD:** ⚠️ **FEASIBILITY: AF-070** (build-time — exact Management-API payload confirmed against the live API).

### NFR-DR.007 — Storage buckets out of scope for v1 backup (regenerable only)

- **Requirement:** The system shall treat **Supabase Storage buckets as out of scope for v1 backup** — v1 uses Storage solely for **regenerable offboarding export files**, and per the golden rule source files/records are **referenced by `source_ref`, never copied into Supabase** — so the off-platform job backs up only the derived DB layer; a future component storing **non-regenerable** files in Storage re-opens this decision (OOS-013).
- **Type:** posture.
- **Upholds:** #1 (a conscious exclusion — nothing knowledge-bearing lives un-backed-up in Storage; the golden rule keeps source-of-truth out of Storage in the first place).
- **Implemented by:** ADR-008 §6 (Decision part 6) · OOS-013 · ADR-001 golden rule.
- **Target / threshold:** N/A (scoping posture); re-opens the moment a component puts non-regenerable files in Storage.
- **Verification:** DOCS (Storage holds only regenerable exports; no source files copied in).
- **Launch gate:** fast-follow (a scoping posture, not a runtime guarantee; the DB backup — the knowledge-bearing layer — is fully covered by NFR-DR.001–003).
- **Acceptance criteria:**
  - AC-NFR-DR.007.1 — Given v1 Storage usage, When its contents are inspected, Then they are only regenerable offboarding exports; no source-of-truth or non-regenerable knowledge lives in a bucket outside the backup scope.
- **Notes / OD:** OOS-013 logs the exclusion + the re-open trigger; the golden rule is the standing guard (lifted to the glossary per ADR-008 §Spawns).

### NFR-DR.008 — Append-only audit sinks as a knowledge-durability layer

- **Requirement:** The system shall treat its **append-only, tamper-evident audit sinks** (`event_log` / `guardrail_log` / `config_audit_log` / `access_audit`) as a **knowledge-durability layer in their own right** — the history survives even when a restore is needed — such that **backup + audit-sink immutability + shadow-retain together form the #1 defense-in-depth**, no single layer being the sole guarantor.
- **Type:** posture (cross-cutting; ties CMP-f).
- **Upholds:** #1 (durability is layered — a restore, an immutable append-only history, and shadow-retain each independently preserve knowledge).
- **Implemented by:** the audit-sink immutability owner is `compliance.md` NFR-CMP.* (CMP-f) + the Phase-4 `enforce_audit_append_only()` trigger; this row only names the DR-side durability role. **Cross-ref:** `compliance.md`.
- **Target / threshold:** N/A (defense-in-depth posture).
- **Verification:** DOCS (the three layers exist and are independent) — the immutability *enforcement* is verified in `compliance.md`; the restore layer in NFR-DR.003.
- **Launch gate:** fast-follow (the constituent guarantees — restore NFR-DR.003, immutability CMP-f — are gated in their own domains; this row asserts they compose).
- **Acceptance criteria:**
  - AC-NFR-DR.008.1 — Given a recovery scenario, When the durability layers are inspected, Then a proven restore, an append-only tamper-evident audit history, and shadow-retain each independently preserve knowledge; no single-layer failure is total loss.
- **Notes / OD:** the audit-sink immutability spec lives in `compliance.md` (CMP-f) — see there for the trigger + tamper-evidence detail.

### NFR-DR.009 — Off-platform backup-purge flag: the compliance-erasure leg this domain owns

- **Requirement:** The system shall receive and process the compliance-erasure purge flag raised by FR-2.MNT.017 (AC-2.MNT.017.2) — an erased target's Personal data present in **pre-erasure off-platform snapshots** shall be **purged/expired within the snapshot's normal retention rotation, bounded to the next scheduled off-platform dump cycle (≤ the NFR-DR.001 hourly cadence) or the next restore rehearsal (NFR-DR.003), whichever confirms clearance first** — and the purge's completion (or a still-pending flag) shall be **logged**, never silently dropped.
- **Type:** duty + verification.
- **Upholds:** #1 (erased data does not silently persist/reappear in a restored off-platform snapshot) + #3 (a still-pending purge is logged loud, not silently carried forward).
- **Implemented by:** FR-2.MNT.017 (AC-2.MNT.017.2, the flag's origin) · ADR-008 (this file's owning ADR; mechanics homed here per OD-038) · AF-137 (transitive-erasure completeness verification, which names the off-platform backup-purge flag as one of the legs it spikes).
- **Target / threshold:** flagged snapshots purged/expired within one dump-cycle rotation of the erasure completing (≤ 1 hour, NFR-DR.001 cadence); clearance confirmed at the next scheduled restore rehearsal (NFR-DR.003, monthly/per-migration cadence); a flag still open past that checkpoint is a logged exception, not a silent gap.
- **Verification:** **SPIKE (AF-137)** — the transitive-erasure spike plants a residue in a pre-erasure off-platform snapshot and asserts the purge flag clears it within the stated window; build-time wiring confirms the flag is received + actioned, not just raised.
- **Launch gate:** blocking (the same #1/#2 legal-erasure guarantee as FR-2.MNT.017 — an erasure that doesn't reach the off-platform copy is not a completed erasure).
- **Acceptance criteria:**
  - AC-NFR-DR.009.1 — Given FR-2.MNT.017's off-platform purge flag, When it is raised, Then this domain's snapshot pipeline receives it and purges/expires the target's Personal data from pre-erasure off-platform snapshots within the next scheduled dump cycle.
  - AC-NFR-DR.009.2 — Given a purge flag still open past its dump-cycle window, When the next restore rehearsal (NFR-DR.003) or backup-health check (NFR-DR.006) runs, Then the open flag is surfaced as a logged exception, never silently carried forward or reported clear.
- **Notes / OD:** closes **H46** — FR-2.MNT.017 (AC-2.MNT.017.2) names this leg as "mechanics owned by Phase 5"; this row is that ownership. **AC-2.MNT.017.5's completeness check should be extended to explicitly include this leg** (flagged here for the C2-side AC edit; not yet applied in this file, tracked separately).

---

*Drafted session 45 (2026-07-01). This domain IS ADR-008 turned into operational NFRs. RPO ~1 hour
(hourly off-platform dump); RTO = restore-with-downtime (minutes-to-hours by DB size — **to be
confirmed by AF-069**, no hot failover). Restore-rehearsal cadence = **monthly + on every
schema-migration release** (RP-2). Blocking gate: **AF-069** (restore actually works — a backup that
can't restore is a #1 catastrophe, RP-1). AF-072 gates the default cadence (back off / upsell PITR if
it fails); AF-070 is build-time; AF-071 is DOCS, shared with `compliance.md`. Cites verified against
ADR-008, component-07 (FR-7.MGM.005), the feasibility register (AF-069/070/071/072), and out-of-scope
(OOS-013/014) at draft.*
