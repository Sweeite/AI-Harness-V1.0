# NFR — Infrastructure & Deployment  (`NFR-INF`)

> **Context manifest.** Depends on: ADR-005 (deploy + provisioning: canary/release-train,
> expand-contract migrations, rollback-by-redeploy, scripted two-party provisioning §5, per-client
> OAuth + Google verification §6, synthetic canary corpus + smoke battery §C2), ADR-001 §7 (mgmt-plane
> boundary — health push, `internal_token` ingest), and the enforcement FRs in C10 (deploy / migrate /
> provision / offboard) · C5 (jobs / triggers / groups / loops) · C7 (management / health reporter) ·
> C0 (seed). **Reference-don't-re-spec:** each `NFR-INF` row names the FR/ADR that *implements* it and
> adds only the infrastructure posture, the fleet-safety invariant, or the verification method. The
> deployment/provisioning machinery is specified in those components; this file states the property
> that must hold across a mixed-version fleet and how it is proven.
>
> **Upholds primarily #2 (never do something it shouldn't)** — provisioning least-privilege, freeze
> fails-closed, per-client OAuth in the client's own accounts — **and #3 (never fail silently)** —
> version-skew, migration-failure, freeze propagation, and partial-provisioning are all surfaced, never
> swallowed — with **#1 (never lose knowledge)** upheld by idempotent seed + crash-window resume.

*The `NFR-*` row shape is defined once in `security.md` (the exemplar). Fields: Requirement / Type /
Upholds / Implemented by / Target / Verification / **Launch gate** / Acceptance criteria / Notes.*

---

### NFR-INF.001 — Canary + operator-promoted release train

- **Requirement:** The system shall ship every core change through a **release train** — `feature → release (canary) → operator-promoted → main (fleet)` — such that a new build reaches the canary first, is proven there, and reaches the client fleet **only** on an explicit operator promotion; no change auto-propagates to all silos.
- **Type:** posture.
- **Upholds:** #2 (a bad build cannot reach the fleet without a human gate) + #3 (a failing canary is surfaced before promotion, never silently rolled forward).
- **Implemented by:** FR-10.DEP.001/002 · ADR-005 (release-train).
- **Target / threshold:** promotion gated on tests + migration success + smoke battery + **soak** (`canary_soak_minutes=60`).
- **Verification:** DOCS (train topology + the gated promotion step) + a canary spike that a promotion is refused on any red gate (AF-064, fast-follow).
- **Launch gate:** blocking (foundational — the train topology is a locked ADR-005 posture); the canary-behaviour spike (AF-064) is fast-follow.
- **Acceptance criteria:**
  - AC-NFR-INF.001.1 — Given a new core build, When it is released, Then it lands on the canary and reaches no client silo until an operator explicitly promotes it.
  - AC-NFR-INF.001.2 — Given a canary with a red test/migration/smoke gate or an incomplete `canary_soak_minutes` soak, When promotion is attempted, Then it is refused and the failing gate is surfaced.
- **Notes / OD:** the promotion gate consumes the smoke battery of INF.008 (`FR-10.PRV.003`).

### NFR-INF.002 — Expand-contract migrations (mixed fleet stays safe)

- **Requirement:** The system shall make every schema change **expand-contract** — no destructive change in a single migration; the sequence is add → backfill → (a later release) remove — so that both `vN` and `vN-1` of the core run correctly against the schema at all times during a rollout.
- **Type:** posture (the keystone of a mixed-version fleet).
- **Upholds:** #1 (a half-migrated silo never loses or orphans data) + #3 (a rollout can be paused mid-fleet without a broken silo).
- **Implemented by:** FR-10.MIG.001 · ADR-005 (migration discipline).
- **Target / threshold:** binary — no `DROP`/destructive-rename in the same migration that a running prior build depends on.
- **Verification:** **SPIKE — expand-contract keeps a mixed fleet safe** (AF-065): run `vN` and `vN-1` concurrently against the migrated schema and confirm both operate.
- **Launch gate:** **blocking** (RP-1 posture) — the mixed-fleet safety property must hold before a fleet-wide rollout is trusted (AF-065).
- **Acceptance criteria:**
  - AC-NFR-INF.002.1 — Given a schema migration, When it is authored, Then it contains no destructive change relied upon by the currently-deployed prior build (add-then-later-remove only).
  - AC-NFR-INF.002.2 — Given a fleet mid-rollout, When `vN` and `vN-1` silos both run against the migrated schema (AF-065), Then both operate correctly with no data loss or errored path.
- **Notes / OD:** this is what makes INF.003 (rollback-by-redeploy) safe — the schema never has to roll back.

### NFR-INF.003 — Rollback = redeploy prior build; schema rolls forward only

- **Requirement:** The system shall perform rollback as a **code redeploy of the prior build**, never as a down-migration; the schema **rolls forward only**. Expand-contract (INF.002) guarantees the prior build still runs against the current schema.
- **Type:** posture.
- **Upholds:** #1 (no down-migration means no destructive reverse step that could lose data) + #3 (rollback is a known, tested path, not an improvised one).
- **Implemented by:** FR-10.DEP.003 · ADR-005 (rollback).
- **Target / threshold:** binary — zero down-migrations; rollback artifact is the prior code build.
- **Verification:** DOCS (rollback runbook = redeploy) + covered by the AF-065 mixed-fleet spike (prior build runs on current schema).
- **Launch gate:** blocking (foundational; rests on the AF-065 property).
- **Acceptance criteria:**
  - AC-NFR-INF.003.1 — Given a bad promotion, When the operator rolls back, Then the prior code build is redeployed and it runs correctly against the unchanged (forward-only) schema.
  - AC-NFR-INF.003.2 — Given any schema change, When it is applied, Then no down-migration script exists as its reverse path.
- **Notes / OD:** —

### NFR-INF.004 — Version-skew bounded and monitored

- **Requirement:** The system shall have each deployment **report its `core_version` + last-migrated marker** to the management plane, and shall **alert** when a silo drifts beyond bound — more than `deploy_max_version_skew=3` versions behind the fleet, or `deploy_max_skew_days=14` days stale — so fleet drift is never invisible.
- **Type:** threshold + duty.
- **Upholds:** #3 (an un-updated silo surfaces as an alert, never a silent stale deployment).
- **Implemented by:** FR-10.DEP.004.
- **Target / threshold:** alert if skew `> deploy_max_version_skew=3` versions **or** `> deploy_max_skew_days=14` days.
- **Verification:** DOCS (skew computation + alert rule) + a build-time test that a synthetic over-skew silo raises the alert.
- **Launch gate:** blocking (the skew signal is the #3 guard on drift).
- **Acceptance criteria:**
  - AC-NFR-INF.004.1 — Given each deployment, When it pushes health, Then the payload carries `core_version` + last-migrated marker.
  - AC-NFR-INF.004.2 — Given a silo more than `deploy_max_version_skew=3` versions behind or `deploy_max_skew_days=14` days stale, When skew is evaluated, Then a drift alert is raised to the operator.
- **Notes / OD:** consumed by the mgmt-plane fleet view; `frozen ≠ stale` — a freeze (INF.012) is a distinct status, not skew.

### NFR-INF.005 — Per-deployment migration-failure isolation

- **Requirement:** The system shall **isolate a migration failure to the single deployment** it occurs in — halt that silo's migration, log, and alert — such that one client's migration failure **never cascades** to another silo or the fleet.
- **Type:** posture.
- **Upholds:** #2 (one client's fault cannot reach another's silo — the isolation invariant applied to deploys) + #3 (the failure halts loud, never limps forward half-migrated).
- **Implemented by:** FR-10.MIG.002.
- **Target / threshold:** binary — failure is contained to the failing deployment; no fleet-wide abort.
- **Verification:** DOCS (per-deployment migration boundary) + a build-time test that a forced failure in one silo halts+alerts that silo only.
- **Launch gate:** blocking (foundational — falls out of the ADR-001 physical-isolation model applied to the deploy path).
- **Acceptance criteria:**
  - AC-NFR-INF.005.1 — Given a migration that fails in one deployment, When it fails, Then that silo halts its migration, logs, and alerts — and no other silo's migration is affected.
- **Notes / OD:** the isolation is structural (separate projects, ADR-001), not a coordination convention.

### NFR-INF.006 — Scripted, idempotent, two-party provisioning that fails loud on partial

- **Requirement:** The system shall provision a new client via a **scripted, idempotent, two-party** procedure — the **client** owns the accounts, card, and OAuth apps; the **operator** provisions the Railway link, env, `internal_token`, and the `client_registry` row + seed — and shall **fail loud on any partial setup**, never leave a half-provisioned silo in a silently-broken state.
- **Type:** posture + duty.
- **Upholds:** #2 (least-privilege two-party split — the operator never holds the client's accounts) + #3 (a partial provision surfaces as a loud failure, never a silent half-silo).
- **Implemented by:** FR-10.PRV.001 · ADR-005 §5.
- **Target / threshold:** idempotent (re-run converges, never duplicates); atomic-or-loud on partial completion.
- **Verification:** **SPIKE / end-to-end — provisioning runs clean and fails loud on partial** (AF-004) + provisioning smoke checks (AF-020/021, build-time).
- **Launch gate:** **blocking** (RP-1) — provisioning end-to-end (AF-004) must be proven before go-live; the provisioning smoke assertions (AF-020/021) are build-time.
- **Acceptance criteria:**
  - AC-NFR-INF.006.1 — Given the provisioning script, When it is re-run after a partial failure, Then it converges idempotently without duplicating resources.
  - AC-NFR-INF.006.2 — Given a provision that completes only partially, When it stops, Then it fails loud (logged + surfaced to the operator), leaving no silently-broken silo.
  - AC-NFR-INF.006.3 — Given the two-party split, When provisioning runs, Then the client's accounts/card/OAuth are client-held and the operator provisions only the Railway link / env / `internal_token` / registry row + seed.
- **Notes / OD:** the seed step is idempotent per INF.014 (`FR-5.GRP.003` / `FR-0.SEED.003`).

### NFR-INF.007 — Per-client OAuth apps + Google verification lead-time

- **Requirement:** The system shall register **per-client OAuth apps in the client's own accounts** (not shared operator apps), and shall treat **Google production verification** as an explicit **provisioning schedule dependency** with lead-time — never a launch-day surprise.
- **Type:** posture + duty.
- **Upholds:** #2 (each client's OAuth grants live in that client's own account — least privilege, no shared-app blast radius).
- **Implemented by:** FR-10.PRV.002 · ADR-005 §6.
- **Target / threshold:** OAuth apps per-client; Google verification scheduled with lead-time before the client's go-live.
- **Verification:** DOCS (Google verification lead-time captured in the provisioning schedule) — AF-013 (verification-timeline risk, fast-follow).
- **Launch gate:** fast-follow (AF-013 is a scheduling/lead-time risk, not a launch-blocking correctness property; the per-client-app posture itself is a locked ADR-005 §6 decision).
- **Acceptance criteria:**
  - AC-NFR-INF.007.1 — Given a client provision, When OAuth apps are created, Then they live in the client's own accounts, not a shared operator app.
  - AC-NFR-INF.007.2 — Given a client requiring Google production scopes, When the provisioning schedule is built, Then Google verification lead-time is an explicit scheduled dependency (AF-013).
- **Notes / OD:** connector-specific vendor facts are governed by the per-tool research dossiers, not this file.

### NFR-INF.008 — Synthetic canary corpus + smoke battery as promotion gate

- **Requirement:** The system shall maintain a **synthetic canary corpus + smoke battery** — boot, migration, connector wiring, and behavioral checks (retrieval / contradiction / routing) — and shall make a **green battery the promotion gate** out of the canary; a red battery blocks promotion to the fleet.
- **Type:** verification + duty.
- **Upholds:** #3 (a broken build is caught by the battery before it can be promoted, never silently shipped) + #2 (behavioral checks confirm the safety wiring survived the change).
- **Implemented by:** FR-10.PRV.003 · ADR-005 §C2.
- **Target / threshold:** binary — promotion requires an all-green battery; synthetic corpus (no client data).
- **Verification:** **SPIKE / EVAL — the battery meaningfully gates** (AF-066, fast-follow); the gate wiring itself is DOCS + build-time.
- **Launch gate:** fast-follow (the battery's *coverage adequacy* is AF-066, fast-follow; the gate being wired into promotion is a locked ADR-005 §C2 posture, in place at launch).
- **Acceptance criteria:**
  - AC-NFR-INF.008.1 — Given a canary build, When the smoke battery runs, Then it exercises boot + migration + connector wiring + retrieval/contradiction/routing behavioral checks against the synthetic corpus.
  - AC-NFR-INF.008.2 — Given a red battery result, When promotion is attempted, Then promotion is blocked.
- **Notes / OD:** feeds the promotion gate of INF.001; the corpus is synthetic so it never touches client data.

### NFR-INF.009 — Plugins out of the release train

- **Requirement:** The system shall keep **plugins out of the core release train** — plugins are per-deployment, manually updated, and **version-reported** so their drift is observable — such that a plugin change never rides the fleet promotion and plugin version drift is never invisible.
- **Type:** posture.
- **Upholds:** #3 (plugin drift is reported and observable, never a silent divergence) + #2 (a plugin update is a deliberate per-deployment act, not an auto-propagated fleet change).
- **Implemented by:** FR-10.DEP.005 · OOS-033 (plugin auto-update deferred).
- **Target / threshold:** binary — plugins version-reported per deployment; not carried by the core train.
- **Verification:** DOCS (plugin lifecycle out-of-train) + the mgmt-plane push carries plugin versions.
- **Launch gate:** blocking (foundational; the out-of-train posture is decided).
- **Acceptance criteria:**
  - AC-NFR-INF.009.1 — Given a core promotion, When it runs, Then no plugin is updated as part of it.
  - AC-NFR-INF.009.2 — Given a deployment, When it pushes health, Then its plugin versions are reported so drift is observable.
- **Notes / OD:** plugin auto-update / plugin train is OOS-033 (v-future).

### NFR-INF.010 — Health reporter push + `internal_token`-authed ingest

- **Requirement:** The system shall have **each deployment push operational-metadata snapshots** to the management plane on interval **and** on significant events, and shall accept them only through an ingest **authenticated per-deployment with `internal_token`**, rejecting, logging, and alerting any unauthenticated push. The flow is push-only and carries operational metadata only (never client business data).
- **Type:** posture + duty.
- **Upholds:** #2 (a compromised or forged push cannot inject into the mgmt plane; only operational metadata crosses the boundary) + #3 (a silo that stops pushing surfaces as staleness).
- **Implemented by:** FR-7.MGM.001 · FR-10.MGT.002/004 · ADR-001 §7.
- **Target / threshold:** interval + event-driven push; per-deployment `internal_token` on ingest.
- **Verification:** DOCS (push cadence + auth) + a build-time test that an ingest without a valid `internal_token` is rejected + logged + alerted.
- **Launch gate:** blocking (the mgmt-plane boundary is a #2 keystone, shared with NFR-SEC.002).
- **Acceptance criteria:**
  - AC-NFR-INF.010.1 — Given a deployment, When an interval elapses or a significant event occurs, Then it pushes an operational-metadata snapshot to the mgmt plane.
  - AC-NFR-INF.010.2 — Given an ingest request without a valid per-deployment `internal_token`, When it arrives, Then it is rejected, logged, and alerted.
- **Notes / OD:** the payload allow-list + business-data exclusion is specified in NFR-SEC.002; this row owns the reporter/ingest infrastructure duty.

### NFR-INF.011 — Inngest single retry/DLQ authority; cloud-hosted v1

- **Requirement:** The system shall make **Inngest the single retry/DLQ authority** — `task_queue` is the **audit projection** of job state, never a second retry engine (no dual-retry) — and shall run Inngest **cloud-hosted in v1**, with self-hosting deferred.
- **Type:** posture.
- **Upholds:** #1 (a single retry authority means a job is never double-executed or silently dropped between two competing engines) + #3 (job state has one source of truth, projected for audit).
- **Implemented by:** FR-5.JOB.004 (single authority) · FR-5.JOB.007 (cloud-hosted v1) · OOS-028 (self-host deferred).
- **Target / threshold:** binary — exactly one retry/DLQ engine; `task_queue` is read-only projection for audit.
- **Verification:** DOCS (Inngest = sole authority; `task_queue` as projection) + a build-time test that a retry is never issued by the `task_queue` path.
- **Launch gate:** blocking (foundational — the no-dual-retry invariant is a locked C5 decision).
- **Acceptance criteria:**
  - AC-NFR-INF.011.1 — Given a job failure, When it is retried or dead-lettered, Then Inngest is the sole actor; `task_queue` only records the resulting state for audit.
  - AC-NFR-INF.011.2 — Given v1, When jobs run, Then Inngest is cloud-hosted (self-hosting is OOS-028).
- **Notes / OD:** the crash-window resume behaviour is INF.014; this row owns the retry-authority topology.

### NFR-INF.012 — Deployment freeze gate fails closed at the dispatch boundary

- **Requirement:** The system shall enforce a **deployment freeze** — a silo in retention-freeze (`client_registry.status = frozen`) shall have **all trigger/dispatch blocked, failing closed** — and shall enforce it **at the dispatch boundary, not merely at the status label**, so a frozen silo cannot dispatch work even if a status check is bypassed.
- **Type:** posture.
- **Upholds:** #2 (a frozen silo must do nothing — the freeze is a hard stop, not an advisory flag) + #3 (the freeze is enforced where work is dispatched, so a bypassed label cannot silently let work through).
- **Implemented by:** FR-5.TRG.001 · AC-5.TRG.001.3 (dispatch-boundary enforcement) · FR-10.OFF.004 (retention-freeze) · OD-091.
- **Target / threshold:** binary — `status = frozen` ⇒ zero trigger/dispatch; fail-closed on any status-resolution ambiguity.
- **Verification:** **SPIKE — freeze propagation reaches the dispatch boundary** (AF-135): confirm a frozen silo dispatches nothing, and that enforcement is at dispatch, not just the label.
- **Launch gate:** **blocking** (RP-1) — freeze propagation (AF-135) is launch-critical: a frozen silo doing work during offboarding is a #2 breach.
- **Acceptance criteria:**
  - AC-NFR-INF.012.1 — Given a silo with `client_registry.status = frozen`, When any trigger fires or dispatch is attempted, Then it is blocked (fails closed) at the dispatch boundary.
  - AC-NFR-INF.012.2 — Given a status-resolution failure or ambiguity, When dispatch is evaluated, Then it fails closed (no dispatch), never open.
- **Notes / OD:** `frozen ≠ dead` on the mgmt-plane view (distinct from staleness, INF.004).

### NFR-INF.013 — Deprovision completeness: atomic-or-escalate, never partial-silent

- **Requirement:** The system shall make offboarding **hard-delete actually complete** — deleting/revoking the Supabase project, the Railway resources, credentials, and tokens — as an **atomic-or-escalate** operation: on any partial completion it **escalates loud**, never leaving a partially-deprovisioned silo silently behind.
- **Type:** posture + duty.
- **Upholds:** #2 (a client's resources and credentials are fully revoked — no lingering access after offboarding) + #3 (a partial deprovision escalates, never fails silent).
- **Implemented by:** FR-10.OFF.005.
- **Target / threshold:** binary — all four (Supabase / Railway / credentials / tokens) revoked, or an escalation is raised.
- **Verification:** **end-to-end — deprovision completeness** (AF-132, fast-follow): confirm all resources/credentials/tokens are actually gone, and that a forced partial escalates.
- **Launch gate:** fast-follow (AF-132) — deprovision runs at end-of-relationship, not go-live; the atomic-or-escalate posture is decided, the end-to-end proof is fast-follow.
- **Acceptance criteria:**
  - AC-NFR-INF.013.1 — Given an offboarding hard-delete, When it completes, Then the Supabase project, Railway resources, credentials, and tokens are all deleted/revoked.
  - AC-NFR-INF.013.2 — Given a deprovision that completes only partially, When it stops, Then it escalates loud (operator alert), leaving no silently-partial silo.
- **Notes / OD:** the compliance/export-before-delete sequencing is owned in `compliance.md` (CMP-h); this row owns the completeness invariant.

### NFR-INF.014 — Idempotent seed + crash-window resume + no backfill stampede

- **Requirement:** The system shall make the seed/task-graph **idempotent and crash-window-resilient** — the task graph **resumes from the first incomplete step** with prior outputs reused, **idempotency keys prevent retry-duplication**, and a missed loop run gets a **single catch-up, never a backfill stampede** of accumulated runs.
- **Type:** posture + duty.
- **Upholds:** #1 (a crash mid-seed loses no completed output — the graph resumes, prior work reused) + #3 (retry-duplication and backfill stampede are prevented, never silently multiplying work/cost).
- **Implemented by:** FR-5.GRP.003 (resume-from-incomplete, reuse) · FR-5.GRP.004 (idempotency keys) · FR-5.LOP.004 (single catch-up) · FR-0.SEED.003 (idempotent seed).
- **Target / threshold:** resume from first incomplete step; exactly-once via idempotency keys; ≤ 1 catch-up per missed loop window.
- **Verification:** build-time tests (crash mid-graph → resume reuses prior outputs; replayed step → no duplicate; missed loop window → single catch-up) — AF-063 (Inngest per-key concurrency serializes same-entity steps) + AF-112 (catch-up / no stampede).
- **Launch gate:** blocking (foundational — the #1 crash-window and no-stampede properties rest on locked C5/C0 FRs); the AF-112/063 confirmations are build-time.
- **Acceptance criteria:**
  - AC-NFR-INF.014.1 — Given a crash mid-seed, When the graph resumes, Then it restarts from the first incomplete step and reuses prior completed outputs (no re-run of done work).
  - AC-NFR-INF.014.2 — Given a retried step, When it re-executes, Then its idempotency key prevents a duplicate effect.
  - AC-NFR-INF.014.3 — Given one or more missed loop runs, When the loop next fires, Then it performs a single catch-up, not a backfill stampede of every missed window.
- **Notes / OD:** the seed here is the same idempotent seed invoked by provisioning (INF.006).

---

*Drafted session 45 (2026-07-01). Follows the `NFR-*` row shape established by `security.md`. Cites
verified against the C10 / C5 / C7 / C0 components, ADR-005, ADR-001 §7, and the config registry at
draft (canary_soak_minutes=60 · deploy_max_version_skew=3 · deploy_max_skew_days=14); AF ids
(AF-004/013/020/021/063/064/065/066/112/132/135) confirmed against the feasibility register. Launch-gate
postures: AF-004 (provisioning end-to-end), AF-065 (expand-contract mixed
fleet), AF-135 (freeze propagation) are blocking-by-posture (locked-ADR/FR mechanisms built regardless, not
one of the RP-1 six); AF-064/066 (canary), AF-013 (Google verification), AF-020/021
(provisioning smoke), AF-132 (deprovision) are fast-follow / build-time.*
