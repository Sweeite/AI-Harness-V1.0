# ADR-008 — Backup & Disaster Recovery

- **Status:** Accepted
- **Date decided:** 2026-06-23
- **Resolves:** OD-009
- **Affects:** non-negotiable #1 (never lose or corrupt knowledge), ADR-001 (ownership boundary +
  golden rule on systems of record), ADR-003 (per-silo cost), ADR-005 (provisioning script + runbook),
  component 10 (offboarding), Super Admin management plane, NFR-SEC (secrets / data custody), data model

> **Revision — 2026-06-23 (same session, pre-build):** the default recovery mechanism was changed from
> *PITR-on-by-default* to **hourly off-platform snapshots as the default, with PITR as a documented opt-in
> upsell**. Operator's call: ~$100/mo PITR per silo is over-engineering at ADR-001 scale (≤~20 users)
> when memory is only *pointers + enrichment* over systems of record that survive any incident (the
> **golden rule**, design `L1634`) — so recent loss is re-derivable by re-ingesting, and an ~1-hour RPO is
> acceptable. Transparent amendment per `change-control.md` (Accepted ADR, but ink-wet and operator-decided,
> nothing built on it yet). The off-platform copy — the real defense against the catastrophic loss path —
> is unchanged; only the in-project RPO tier changed.

## Context

Nothing in the design doc or the prior seven ADRs addresses **data loss or corruption** of a
client's Supabase. For a "business brain" whose entire job is remembering, losing the memory layer
is the worst possible failure — it is exactly **non-negotiable #1**. OD-009 was elevated to top-bar
for this reason.

ADR-001 makes it thornier: **the client owns and pays for the Supabase project** (on their own card).
So the operator may be responsible for the integrity of a system whose backups they don't own and
can't unilaterally verify. The question OD-009 poses: backup cadence + retention, point-in-time
recovery, a *tested* restore, **who owns and who verifies** backups under client-owned Supabase, and
whether backup-health is part of the management-plane push.

**Two facts make the problem smaller than it first looks:**

- **The golden rule on systems of record (`L1634`).** The brain stores **pointers + enrichment**, never
  copies of source data: "GHL owns contact data. Google Drive owns documents. Slack owns messages. Your
  memory layer stores pointers and enrichment." A memory row carries a `source_ref` (`L1447`, `L1657`).
  So the canonical files/records live in the client's *other* systems, which have their own lifecycle and
  survive a Supabase incident. What we must protect is the **derived** layer (extracted text → embeddings,
  relationships, confidence) — which is ordinary Postgres + pgvector data, and is **re-derivable by
  re-ingestion** if recent writes are lost. This is why an RPO measured in hours is tolerable here.

**Primary-source vendor research (2026-06-23, see feasibility block I) reframed the rest.** Load-bearing
findings:

1. **The biggest loss path is the client's credit card, not a crash.** Because the project is on the
   client's account: a billing lapse / downgrade → **project pauses after ~7 days** → **restorable for
   90 days** → then **the project *and its backups in S3* are permanently, irreversibly deleted.** All
   in-project backups (daily *and* PITR) die with the project. *No in-project mechanism defends this — only
   an independent off-platform copy does.*
2. **Free daily backups** (Pro = 7-day / Team = 14-day retention) can lose up to ~24h. **PITR** gives a
   **~2-minute RPO** (continuous WAL archiving) but is a **paid add-on (~$100+/mo per project + a required
   compute add-on)**, billed to the client, and *replaces* daily backups when on. **Continuous-ness is the
   cost** — you cannot buy a 2-minute window cheaply.
3. **Backups cover the Postgres database only** (incl. pgvector memory + `auth` user rows). **Supabase
   Storage buckets are NOT backed up.** In v1, Storage is used for exactly one thing —
   `Supabase Storage for file exports (offboarding)` (`L97`) — a transient, regenerable output. (And per the
   golden rule, ingested files are never copied into Storage at all — only referenced.)
4. **The Supabase Management API can read backup status** (`GET /v1/projects/{ref}/database/backups`,
   plus project status), so an operator can monitor backup health **remotely without touching any
   business data** — a clean fit for the ADR-001 management-plane boundary.
5. **Supabase makes no backup-verification claim.** "A backup exists" ≠ "a restore works"; there is no
   platform-side restore rehearsal. We must own that.
6. **No automatic failover on Pro/Team** (Enterprise only). DR for a silo is backup-restore-with-downtime,
   not hot failover — acceptable at the ≤~20-user / ≤~20-client scale (ADR-001), but stated, not assumed.

## Options considered

**Axis 1 — recovery point (RPO) per silo, and what it costs the client.**
- *A1 — Free daily backups only.* No extra cost; but a restore can lose up to a day of memory writes, and
  the cadence is fixed at daily (not configurable).
- *A2 — PITR on by default.* ~2-min RPO; ~$100+/mo per silo on the client's card. Strongest RPO, but
  over-engineered as a *default* at ADR-001 scale given re-derivability — and continuous-ness is the cost.
- *A3 — Hourly off-platform snapshots default + free daily; PITR as an opt-in upsell.* The off-platform
  dump job (Axis 2) runs **hourly**, giving an ~1-hour RPO at near-zero marginal cost, *and* doubles as the
  deletion-path defense. Free daily in-project backups stay for fast in-place restore. PITR is documented,
  off by default, sold to any client who needs minute-level RPO or whose brain has grown too large for an
  hourly logical dump (AF-072). **Chosen** — best cost/safety fit; downgrading a client *below* hourly, or
  the daily-only floor, is a logged exception, never a silent default.

**Axis 2 — independent off-platform copy, and where it lives.**
- *B1 — None (rely on in-project backups + monitoring).* Simplest, but every in-project backup dies with
  the project on the deletion path, so a single non-payment event is still total loss. Fails #1.
- *B2 — Off-platform copy to a **client-owned** destination.* A scheduled logical dump (`pg_dump`) to a
  second location the client owns, in a different region, independent of the primary project's billing
  lifecycle. Survives a paused/deleted project. Keeps the operator **out of client-business-data custody**
  → preserves the ADR-001 boundary. **Chosen** (and it is the thing run hourly per Axis 1/A3).
- *B3 — Off-platform copy to an **operator-controlled** store.* Easiest for the operator to guarantee, but
  the operator would then **hold client business data**, erasing ADR-001's "no client business data crosses
  to the operator" line and importing data-processor liability. Rejected as default; kept as a documented
  per-client exception only where a client cannot provide a second destination (explicit, logged, with its
  own data-handling terms).

**Axis 3 — who owns / who verifies.** Client owns the project + pays (it's their card, their plan, the
off-platform destination, the optional PITR add-on). Operator **operates and verifies** (schedules the
snapshot job, runs restore rehearsals, monitors health). The only split consistent with ADR-001's hybrid.

## Decision

**Defense-in-depth backup & DR per silo: hourly off-platform snapshots (default) + free daily in-project
backups + operator-run verification + backup-health on the management-plane push, with PITR as an opt-in
upsell.** Six binding parts:

1. **Default recovery tier = free daily in-project backups + an hourly off-platform snapshot** (the Axis-2
   copy, run hourly). Target RPO ~1 hour, **bounded by AF-072** (a logical dump's duration grows with the
   corpus; if hourly can't keep up for a large brain, that client is moved to the PITR upsell or a backed-off
   cadence — a logged decision). **PITR is a documented opt-in upsell**, off by default, billed to the client
   (~$100+/mo), for clients needing minute-level RPO. Running *below* hourly (e.g. daily-only) is a **logged
   downgrade exception** per `change-control.md`, never a silent default — it weakens non-negotiable #1.

2. **An independent off-platform logical backup to a client-owned destination.** A scheduled `pg_dump`
   (via CLI / Management-API-driven job) writes an **encrypted** copy to a **second location the client owns**
   (their own object store / account), **in a different region** where practical, **hourly** (part 1). This
   copy is **independent of the primary project's lifecycle** — it survives a paused or deleted project,
   which is the *only* defense against the billing-lapse → pause → deletion path. The operator orchestrates
   and monitors it but **never holds it** (preserves the ADR-001 data-custody boundary). Operator-held copies
   are a per-client exception only (Axis 2 / B3), logged with terms.

3. **Ownership split (ADR-001 hybrid, made explicit for backups):** **Client owns + pays** (project, plan,
   the off-platform destination, the optional PITR add-on). **Operator operates + verifies** (schedules the
   snapshot job, runs restore rehearsals, watches health). Captured in the provisioning runbook (ADR-005)
   and the retainer scope. Neither side may assume the other is doing it — it is named here.

4. **A tested restore is the only restore that counts.** The operator runs a **periodic restore rehearsal**:
   restore a recent snapshot into a **throwaway project**, confirm the database — including **pgvector
   memory** and **`auth` rows** — comes back complete and queryable, and **log the result + timestamp**.
   Supabase verifies nothing; we do. ⚠️ AF-069.

5. **Backup-health joins the management-plane health push (ADR-001 §7).** Each deployment reports, as
   **operational metadata only** (no business data ever crosses): the recovery tier (daily+hourly, or PITR),
   last in-project backup timestamp, **project status (active / paused / billing-at-risk)**, last successful
   off-platform snapshot + timestamp, and last restore-rehearsal date + result. Read via the **Supabase
   Management API** (⚠️ AF-070). The Super Admin dashboard surfaces a **loud alert if any of these lapse or go
   stale** — so a client's lapsing backups (or an approaching pause → 90-day deletion window) are *seen* by
   the operator long before deletion. Protects non-negotiable #1 (catch the loss path early) and #3 (never
   fail silently).

6. **The golden rule governs what we even have to back up — and Storage buckets are out of scope** (→ OOS-013).
   Per `L1634`, source files/records live in their **system of record** (Drive/GHL/Slack) and are
   **referenced by `source_ref`, never copied into Supabase**; the brain backs up only the derived layer
   (in the DB). v1 uses Storage solely for **regenerable offboarding export files** (`L97`), not
   source-of-truth knowledge. If a future component ever stores **non-regenerable** files in Storage, that
   re-opens this as its own decision (bucket-copy must then join the off-platform job) — but the default
   posture is *don't put source files in Storage in the first place*. A conscious exclusion, not a silent gap.

**Disaster-recovery posture (stated, not assumed):** a silo's DR is **backup-restore with downtime**, not
hot failover (Supabase auto-failover is Enterprise-only). Acceptable at ADR-001 scale. Read replicas / HA
failover are a per-client upsell, not a v1 default (see OOS-014).

## Consequences

**Becomes required (new requirements to write):**
- Provisioning (ADR-005) **must**: create/connect the client-owned off-platform destination; schedule the
  **hourly** `pg_dump` job + the restore-rehearsal job; register backup-health fields in the deployment's
  health reporter. PITR is **not** provisioned by default — it is a per-client upsell toggle.
- The health-reporter job (ADR-001 §7) gains the **backup-health fields** in part 5; the management-plane
  ingest + Super Admin dashboard gain the **lapse/stale alerts** and a **project-pause / billing-at-risk**
  warning driven by Management-API project status.
- NFR-SEC: the off-platform dump is **encrypted**; the operator's job holds a **delegated credential**
  scoped to backup operations + status reads — not a broad grant.
- Data model / runbook: the restore-rehearsal procedure (throwaway project, what to assert, cadence).
- A surfaced **PITR upsell** affordance (docs + an operator/dashboard toggle) so the upgrade path is real,
  not folklore.

**Ruled out / deferred:**
- PITR-on-by-default (A2) — over-engineered as a default at this scale; demoted to opt-in upsell.
- Relying on in-project backups alone (B1) — the deletion path makes it a total-loss risk.
- Operator-controlled off-platform store as the default (B3) — breaks the ADR-001 data-custody boundary;
  logged per-client exception only.
- Storage-bucket backup in v1 (OOS-013); HA / read-replica failover as a default (OOS-014).

**Feeds other ADRs:**
- **ADR-003 (cost):** the default tier adds **near-zero** marginal cost (free daily + a logical dump to
  client storage). **No mandatory PITR line.** PITR appears only when a client opts in (~$100+/mo, on their
  card — not operator P&L per ADR-001), shown in the cost dashboard for that client.
- **ADR-005 (provisioning):** the provisioning additions above; default sets up the hourly snapshot + the
  second destination, not PITR.
- **Component 10 (offboarding):** the off-platform copy + clean Supabase deprovision strengthen the
  "airtight deletion evidence" story (ADR-001) — deprovision destroys the project and, per the client's
  instruction, the off-platform copy.

**Spawns:** the **golden rule on systems of record** is lifted into the glossary as a binding principle
(it governs the data model + ingestion, not just backup) so no future component drifts into copying source
files into Supabase.

**Must be tested (feasibility block I):**
- **AF-069 (SPIKE)** — a restore actually works end-to-end (DB + pgvector + auth rows come back complete and
  queryable within acceptable downtime). Part 4 rests on this.
- **AF-070 (SPIKE)** — the Supabase Management API exposes the backup-health fields part 5 needs (last-backup
  timestamp, project status). Endpoint existence is verified; the exact payload is not.
- **AF-071 (DOCS / vendor confirmation)** — backup + off-platform region locality satisfies AU data
  residency (ap-southeast-2). Supabase primary docs do **not** pin where backups physically live.
- **AF-072 (LOAD)** — the **hourly** off-platform `pg_dump` completes within the hour, and restore time
  scales acceptably, for a large mature brain. This now directly gates the *default* cadence (part 1): if it
  fails at hourly, the fallback is a backed-off cadence or the PITR upsell.
