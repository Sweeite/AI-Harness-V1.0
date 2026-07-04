# Build Schedule — the safe order to build, batch, and test

> **What this is.** A *followable* operational schedule derived from the dependency graph in
> `_backlog.md` and each issue's §7 `Blocked-by` edges. It groups the 86 issues into **11 stages**
> (strict dependency waves), tells you **what to build in parallel**, **what to build one-by-one**,
> and **where the test checkpoints are**.
>
> **This document invents nothing.** It defines no new IDs and makes no decisions — it re-expresses
> the already-documented build order (`_backlog.md` tiers + critical path + DAG) at a finer grain so
> the batches are *provably* parallel-safe. If this file and a per-issue §7 ever disagree, **the
> issue file wins** (Rule 0). Acceptance-criteria text is never copied here — read it in the FR.
>
> Visual companion: the build-timeline artifact (spine + fans + checkpoints).

---

## Why following this order cannot produce a broken system

Three properties make the schedule safe. If you hold to the safety contract below, they hold:

1. **Dependency order guarantees inputs exist *and* are tested.** Stages are topological waves — an
   issue only appears in a stage after *everything it depends on* sits in an earlier stage. Build
   stages in order and every dependency of every issue was built **and passed its checkpoint** before
   you touch it. You never build on unverified ground.
2. **Same-stage issues are provably independent.** Two issues in the same stage have *no dependency
   path between them* (that's what equal dependency-depth means). So building them together — in any
   order — cannot create a hidden coupling. That's *why* a stage is batch-safe.
3. **Checkpoints stop errors from propagating.** A silent bug in a foundation issue is caught at its
   own checkpoint, before the next stage builds on it. This is the whole reason the wave boundaries
   exist — it's non-negotiable #3 (never fail silently) applied to the build itself.

---

## The safety contract (the rules that keep this from messing up)

- [ ] **R1 — Never open a stage until the previous checkpoint is fully GREEN.** The spine
  (`007→008→009→018→019→022→023→025→045→053→072`) threads through every checkpoint; skipping one means
  building on unverified foundation. This is the single most important rule.
- [ ] **R2 — Spikes before dependents (Stage 0).** All six launch-gating spikes must flip their `AF`
  GREEN before anything that names them builds. A **red spike is not a bug to code around — it's a
  design fork** (e.g. `002` fail → RLS falls back to JWT-cache, OOS-012). Stop and resolve it as an OD;
  do not build the dependents.
- [ ] **R3 — Test the gate (spine) issue of each stage hardest, and first.** Everything above the
  stage rests on it. Prove *its* `AC-*` before you lean on it.
- [ ] **R4 — A checkpoint closes only when *every* issue in the stage passes its `AC-*`.** One failing
  batch member holds the checkpoint. Don't advance a stage that's "mostly" green.
- [ ] **R5 — Reorder freely *within* a stage; never *across* stages.** Inside a stage, build in any
  order (they're independent). Never pull an issue forward from a later stage — its inputs aren't ready.
- [ ] **R6 — Run both test levels.** *Per-issue:* each issue's own `AC-*` (quick, as you finish it).
  *Per-stage:* the integration test at the checkpoint (do the pieces work *together*). Both, every stage.
- [ ] **R7 — Re-check the three non-negotiables at every checkpoint.** (#1) nothing loses or corrupts
  knowledge; (#2) nothing does what it shouldn't; (#3) nothing fails silently. If a trade-off pits one
  of these against speed, the invariant wins — log an OD, don't take the cheap path.
- [ ] **R8 — Be present for the human-in-the-loop stages.** Stage 0 (provisioning + spikes) needs your
  accounts, credentials, and funded API keys — it is not a hands-off build. Schedule it for when you're
  at the machine.
- [ ] **R9 — If a gate fails, stop.** Do not proceed up the spine on a failed gate. Fix it, or if it's
  a design fork, log an OD and resolve it before continuing.

**The rhythm this produces:** *spine slow, fans fast* — build each stage's batch in parallel, prove
each piece against its `AC-*`, integration-test at the checkpoint, then climb to the next stage.

---

## Legend

- 🟠 **GATE** — the stage's critical-path (spine) issue. Build + test this one first and hardest (R3).
- 🟢 **BATCH** — build these in parallel, in any order (R5). Each still proves its own `AC-*` (R6).
- ◇ **CHECKPOINT** — the stage integration test. Must be GREEN before the next stage (R1, R4).
- 🔴 **high-care** — touches a non-negotiable directly (knowledge integrity / authorization / silent
  failure). Test with extra rigor.
- 🧑 **you present** — needs credentials / accounts / a funded key / a human decision (R8).
- ✅ **done**.

---

## The schedule

### Stage 0 — Roots & spikes  🧑 you present
Gate everything. Not hands-off.

- [x] ✅ **GATE — `007` Provisioning + per-client Supabase bootstrap** 🧑 — root of the critical path; two-party. **`done` (Sessions 58–61).** AF-004 🟢 (session 60 — live provisioning on real Railway+Supabase, evidence `app/provisioning/results/af-004-evidence.2026-07-04.md`); session 61 landed the §10 remainder: **canary live seed** (`SupabaseSeed`, real OpenAI embeddings + idempotent live upsert — evidence `app/canary/results/live-seed-evidence.2026-07-04.md`) and **`RailwayInfra` codification** (`app/provisioning/src/infra.ts`). Login-OAuth re-gated to onboarding (OD-175); C0/C1 seed is §2-Out. GitHub #7 closed.
- 🟢 BATCH (spikes — each ends in a PASS/FAIL AF flip):
  - [x] `001` SPIKE cost viability ✅ (AF-001 🟢, $2.09/day)
  - [x] `002` SPIKE RLS hot-path latency ✅ (AF-067 🟢 — initPlan 1.06 ms/stmt once-per-stmt, lint PASS, retrieval p95 0.9 ms; ⚠️ surfaced AF-019 planner-seqscan cliff → ISSUE-023)  🔴
  - [x] `003` SPIKE injection containment red-team ✅ (AF-068 🟢 — 12/12 attacks contained, 8 evasion payloads reached the model yet blocked by the code gate, 4/4 negative controls pass, mutation-tested; `enforce()` takes no prompt/content param)  🔴
  - [x] `004` SPIKE restore actually works ✅ (AF-069 🟢 Path B 2026-07-04 — you-present; real off-platform pg_dump→pg_restore into a throwaway Supabase project: 5000/5000 memories + embeddings intact + 25/25 auth.users restored, RTO 19.4s. ⚠️ Path A in-project/PITR restore not exercised — residual before go-live)  🔴
  - [x] `005` SPIKE brute-force / credential defense ✅ (AF-077 🟢 2026-07-04 — you-present; app-layer per-account soft-lock halts scripted single + simulated multi-IP attack before any session mints, CAPTCHA/Turnstile observed live, 2FA soft-lock, leaked-pw enforceable on Pro)  🔴
  - [x] `006` SPIKE webhook forgery / replay ✅ (AF-078 🟡 mechanics 2026-07-04 — MODE-M 17/17: raw-body-before-parse + constant-time + replay proven; Slack symmetric = real proof; Google OIDC mechanics; GHL signing DOCS-resolved AF-090. Live per-connector vendor confirmation deferred to onboarding — OD-172, operator has no GHL account; owed on ISSUE-017/039/040/041)  🔴
- [x] ✅ **CHECKPOINT 0 — CLOSED 2026-07-04 (session 61).** Every Stage-0 spike AF is GREEN/mechanics-cleared with
  dated evidence in `feasibility-register.md` (AF-001/067/068/069/077 🟢 · AF-078 🟡 mechanics+OD-172), and **`007` is
  `status: done`** — it stood up a real silo, proved live provisioning (AF-004 🟢), seeded the canary corpus live, and
  codified `RailwayInfra`. **Stage 1 (`008`) may now open (R1).** *(Historical guard, session 60: AF-004 🟢 alone did
  NOT close this — closure waited on ISSUE-007 `done`, per the canary-seed + `RailwayInfra` remainder. That remainder
  landed in session 61.)* **Residuals carried forward (non-blocking, tracked at their own gates):** AF-066 (canary
  representativeness, fast-follow) · AF-142/AF-143 (Workspace-token scripted-provisioning re-run) · ISSUE-009 RLS on the
  silo before real client data · login-OAuth per-deployment (OD-175) · AF-069 Path A (PITR restore) before go-live.

### Stage 1 — Bootstrap  *(OPEN since 2026-07-04 — Checkpoint 0 CLOSED)*
- [x] ✅ **GATE — `008` Migration harness (expand-contract) + 0001 baseline** — **`done`** (session 62, 2026-07-04) 🔴 — `app/silo/` built + applied LIVE to the canary silo (44 tables · 43 CONCURRENTLY indexes · RLS-enable/default-deny · idempotent seed); runner proven idempotent + fail-loud + resumable; **AC-2.VEC.002.1 live**, discipline CI gate (AC-NFR-INF.002.1), and **AF-065 🟢** (AC-NFR-INF.002.2 mixed-fleet spike, live). Evidence `app/silo/results/live-capstone-evidence.2026-07-04.md`. GitHub #8 closed.
- 🟢 BATCH: `017` Webhook auth (per-vendor) — **`ready`** (blocker 006 done) · `080` Release model (canary/release-train) — **`ready`** (blocker 007 done). Neither is blocked-by `008`, so both are parallel-safe with the gate; gate still tested hardest/first (R3).
- ◇ **CHECKPOINT 1:** `008` migrations apply *and roll back* cleanly on the provisioned silo; `017`
  rejects forged/replayed webhooks; `080` deploys through the canary gate.

### Stage 2 — Shared scaffold
- 🟠 **GATE — `009` RLS scaffold (helpers, default-deny, 100% coverage CI gate)**  🔴 — one uncovered table = a silent bypass (#2).
- 🟢 BATCH: `010` Config store + audit-immutability · `011` Observability skeleton (event_log + silent-failure detector) 🔴 · `042` Prompt store (version-never-overwrite) · `081` Migration propagation + per-deployment isolation
- ◇ **CHECKPOINT 2:** `009` default-deny holds and the coverage gate is GREEN; `011` event_log is
  append-only and the silent-failure detector actually fires; `010` audit rows are immutable.

### Stage 3 — Core models & safety  *(largest batch — 17 in parallel)*
- 🟠 **GATE — `018` Role model + permission matrix + `can()` gate** — the authorization spine.
- 🟢 BATCH: `012` mgmt-plane bootstrap · `013` OAuth login + session · `014` Super-Admin pw + 2FA + brute-force 🧑 · `032` Connector contract + runtime · `043` Layer-1 identity/principles/limits · `044` Layer-2/4 context + templates · `046` Prompt optimisation · `047` Triggers + freeze gate · `048` task_queue + status machine · `055` Seven hard limits 🔴 · `057` Five pre-step anomaly checks · `059` Injection sanitization + quarantine 🔴 · `060` guardrail_log + no-silent-failure 🔴 · `074` Cost meter + ladder signal · `075` Alerting (seven rules) · `076` Real-time/polling contract · `084` Retention + isolation + residency
- ◇ **CHECKPOINT 3:** `018` `can()` enforces and last-Super-Admin protection holds; then verify the
  batch as a group — auth flow, connector runtime, prompt layers, guardrail sinks fire loudly (#3), cost/alerts.

### Stage 4 — Behaviour on the models  *(14 in parallel)*
- 🟠 **GATE — `019` Clearance + Restricted model** — every memory tag & RLS predicate above reads this.
- 🟢 BATCH: `015` Invite + seed · `016` Support-request recovery · `033` OAuth token lifecycle · `034` Rate limiting + tiers · `035` Write tools + connector hard limits · `036` Tool optimisation · `037` Trigger infra + liveness · `049` Task graphs + idempotency + resume · `050` Context envelope + compression · `051` Three loops + failure heartbeat · `056` Approval tiers + escalation · `061` Orchestrator + 7-step routing · `077` Log retention/export + mgmt views · `085` Backup & DR (hourly dump + rehearsal) 🔴
- ◇ **CHECKPOINT 4:** `019` clearance scoping + every Restricted grant logs who/when/why (#2). Batch:
  token lifecycle, rate-limit ladder, task graphs resume idempotently, approvals route, orchestrator skeleton.

### Stage 5 — Integration & specialists  *(16 in parallel)*
- 🟠 **GATE — `022` Memory + entity model + sensitivity/visibility tagging**  🔴 — get the entity model wrong and knowledge fragments (#1).
- 🟢 BATCH: `020` RLS enforcement (visibility/sensitivity/Restricted/aal2 + service_role) 🔴 · `021` User mgmt + RBAC audit · `038` Disconnection + recovery · `039` GHL connector · `040` Google connector · `041` Slack connector · `052` Inngest engine + retry + DLQ · `058` Rate-limit + cost-ladder enforcement · `062` Eight specialists + per-agent hard limits · `064` Execution plans + failure-mode · `065` Agent health / dead-agent · `068` Proactivity modes + autonomy matrix · `078` Ops dashboards · `079` Mobile surface · `083` Client offboarding · `086` Config admin surface
- ◇ **CHECKPOINT 5:** `022` entity resolution *links, not fragments*; tags apply. `020` RLS enforcement
  proven end-to-end incl. the service_role mid-task revocation path (#2). Then the batch as a group.

### Stage 6 — Embeddings
- 🟠 **GATE — `023` Embeddings + HNSW vector search**  🔴 — clearance-filtered ANN search must return under the AF-067 budget.
- 🟢 BATCH: `024` Memory write / sole-writer path (validate-commit) 🔴 · `030` Maturity + cold-start signal · `054` Execution optimisation (parallel DAG) · `067` Agent builder surface
- ◇ **CHECKPOINT 6:** `023` clearance-filtered search returns within budget; `024` the sole-writer
  commit path closes the TOCTOU window and never loses a write (#1).

### Stage 7 — Retrieval
- 🟠 **GATE — `025` Retrieval + ranking + clearance-before-ranking + answer modes**  🔴 — clearance MUST filter *before* ranking, or it's a #2 leak.
- 🟢 BATCH: `026` Ingestion filters + human queue · `027` Maintenance lifecycle (decay/merge/supersede/expiry) · `028` Conflict quarantine + consolidation · `029` Compliance erasure walk · `066` Orchestrator learning + cache · `082` Right-to-erasure (two-person auth)
- ◇ **CHECKPOINT 7:** `025` clearance filters *before* ranking; answer modes (Cited/Inferred/Unknown)
  render honestly. Batch: ingestion queue, maintenance jobs, conflict quarantine retains-don't-drop (#1).

### Stage 8 — Injection scoping
- 🟠 **GATE — `045` Layer-3 memory injection scoping + clearance filter + volume bounds** — what memory actually reaches the model per task.
- 🟢 BATCH: `031` Memory navigation surface · `063` Per-agent memory scoping · `069` Seven proactive generators
- ◇ **CHECKPOINT 8:** `045` injected memory respects clearance + per-task volume bounds; `063` per-agent
  scope is fail-closed.

### Stage 9 — The keystone
- 🟠 **GATE — `053` Run pipeline (prompt-stack assembly + gates + injection + completion)**  🔴 — highest fan-in (7 blockers); everything converges here. Resource and test it hardest.
- 🟢 BATCH: `070` Suggestion lifecycle · `071` Cold-start phase ladder + suppression
- ◇ **CHECKPOINT 9:** `053` runs a task end-to-end: prompt assembly → RBAC/approval/anomaly gates →
  memory injection → answer-mode → dual-record completion. **This is the big integration test.**

### Stage 10 — Leaves
- 🟠 **GATE — `072` Command dispatch + node-gating + custom commands** — end of the critical path.
- 🟢 BATCH: `073` User + agency dashboards + notification centre
- ◇ **CHECKPOINT 10:** `072` commands dispatch with permission-node gating; `073` dashboards render.
  Critical path complete — full-system integration test.

---

## What "test" means at each level (R6)

- **Per-issue (build-time):** the issue's §4 Definition of done — its `AC-*` IDs (text read in the FR),
  proven by the test layer named in the issue's §9 Verification, per `spec/05-non-functional/test-strategy.md`.
- **Per-stage (checkpoint):** do the stage's issues work *together*, and does the gate issue hold under
  the load the next stage will put on it — plus the three-non-negotiables re-check (R7).

## Sources (authority order)
1. Each `ISSUE-<nnn>.md` §7 `Blocked-by` / §4 `AC-*` — ground truth (Rule 0).
2. `_backlog.md` — tiers, critical path, DAG, coverage ledger.
3. This file — the derived, finer-grained wave schedule. Regenerate it if the DAG changes.
