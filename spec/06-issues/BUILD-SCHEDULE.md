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
- [ ] **R10 — A checkpoint does not close on the offline sweep alone; every package with a live adapter
  (`src/supabase-store.ts`) needs a live-adapter smoke against the real DB before its issue flips `done`.**
  The Stage-4 review and the Checkpoint-3 retroactive review (sessions 71/72) both found real, shippable
  BLOCKER/MAJOR bugs (a missing column, a wrong table, an un-run RLS grant, a stale enum assumption) that
  100%-green offline suites + per-issue adversarial verify + the checkpoint's own DB-invariant capstone all
  missed — because none of them ever executed the live adapter's actual SQL against the real schema. Follow
  `spec/00-foundations/standards/live-adapter-hygiene-sweep.md` (Part A is the standing per-stage gate; Part
  B is the one-time Stage 0–3 backfill this rule retroactively requires).

**The rhythm this produces:** *spine slow, fans fast* — build each stage's batch in parallel, prove
each piece against its `AC-*`, integration-test at the checkpoint, then climb to the next stage.

---

## Legend

- 🟠 **GATE** — the stage's critical-path (spine) issue. Build + test this one first and hardest (R3).
- 🟢 **BATCH** — build these in parallel, in any order (R5). Each still proves its own `AC-*` (R6).
- ◇ **CHECKPOINT** — the stage integration test. Must be GREEN before the next stage (R1, R4) — including
  the live-adapter smoke for every package in the stage with a `supabase-store.ts` (R10).
- 🔴 **high-care** — touches a non-negotiable directly (knowledge integrity / authorization / silent
  failure). Test with extra rigor.
- 🧑 **you present** — needs credentials / accounts / a funded key / a human decision (R8).
- 📱 **phone-safe** — can be built **and closed** from a cloud/phone session (code + offline/unit/
  self-contained tests; no live infra in its `§9`). Author, `npm test`/`check`, commit, PR — from anywhere.
- 💻 **Mac-needed to close** — its `§9` runs against **live infra** (the client silo, Railway, a real
  vendor account, or an `AF-*` live spike). **Author it on your phone; the *close* needs your Mac (or
  Remote Control).** See `spec/00-foundations/build-environments.md`.
- ✅ **done**.

---

## Where to run each issue — 📱 phone vs 💻 Mac (plan your build location)

**The rule (self-applying, always correct):** *author anywhere* — every issue's code + spec can be written
and unit-tested in a cloud/phone session. An issue needs your **Mac to CLOSE** iff its **`§9` Verification**
runs against **live infra** — the client silo, Railway, a real vendor, or an `AF-*` live spike. If `§9` is
unit/offline/self-contained tests only, the issue is **📱 phone-safe end to end**. **Stage checkpoints** are
**💻** whenever the integration test exercises the silo or Railway. **When unsure, open the issue's `§9` and
run `scripts/build-preflight.sh` — never start a 💻 step in a 🌩️ cloud session (that is the half-baked risk).**

| Stage | Gate | 💻 Mac-to-close members (everything else in the stage = 📱 author+unit-test) | Checkpoint |
|---|---|---|---|
| 1 | `008` ✅💻 | `080` (the push→Railway auto-deploy+migrate proof). **`017` = 📱** — its security battery is self-contained; the live per-vendor check is deferred to onboarding (OD-172). | 💻 silo + Railway |
| 2 | `009` — 📱 coverage-CI gate; 💻 to prove RLS behaviour on the silo | `081` (live per-deployment migrate-on-release) | 💻 silo |
| 3 | `018` 📱 (`can()` + matrix, pure logic) | `012` · `013` · `014`🧑 (auth/2FA/brute-force, live) | 💻 auth flow live |
| 4 | `019` 📱 (clearance model) | `033` · `037` · `085`🧑 (backup & DR) | 💻 |
| 5 | `022` — 📱 model; 💻 to prove entity resolution on the silo | `020` (RLS enforcement) · `038` · `039`/`040`/`041` (connectors, live OAuth/webhook) · `083` | 💻 silo |
| 6 | `023` 💻 (HNSW/pgvector on the silo) | `024` (sole-writer path) | 💻 silo |
| 7 | `025` 💻 (retrieval on the silo) | `082` (erasure) | 💻 silo |
| 8 | `045` 💻 (memory injection on the silo) | — | 💻/mixed |
| 9 | `053` 💻 (run pipeline end-to-end) | — | 💻 big integration |
| 10 | `072` 📱 (command dispatch logic) | — | 💻 full-system |

**Bottom line for planning:** the **logic** stages (much of 3, 4, and the model/guardrail/agent/prompt/
proactive/command issues) are largely **📱** — knock out authoring + unit tests + PRs from your phone. The
**infra** touchpoints (anything on the silo, Railway, connectors, embeddings/HNSW, RLS *enforcement*, the
big run pipeline) are **💻** — save those for the Mac (or Remote Control). Typical flow: phone authors → PR →
pull to the Mac → run the 💻 close. *(This table is stage-accurate; the per-issue definitive signal is that
issue's `§9` + the preflight — a batch member is 💻 only if its own `§9` names a live step.)*

---

## Fan-out / workflow guidance — where parallel agents safely speed the build

**This invents nothing** — it re-expresses the batch/DAG structure already defined below (R2/R5) as an
execution strategy. Same-stage issues have **no dependency path between them**, so building them **in
parallel cannot create hidden coupling** — that is *why* a stage's **batch** is a fan-out target (one
worktree-isolated agent per `ready` issue, each building to its §4 DoD + running its own AC battery).

**Three things stay serial — always. Never fan these out:**
- the **spine / gate** issue — everything above the stage rests on it; build + prove its `AC-*` **first**, alone (R3);
- the **verification gate + the checkpoint** — fanning these out is exactly how silent drift slips in (#3);
- every **💻 live / 🧑 you-present** step — serialized on the operator + real infra, not on compute; **no agent count helps** (batch them into ONE concentrated live session instead of interleaving author↔live).

**The pattern (one workflow per open stage):** (1) build the gate serial + prove it (R3) → (2) **fan out the
offline (📱) batch members** in parallel worktrees → (3) **adversarial verify** pass (independent agent per
issue — kept rigorous, not fanned to death) → (4) **one live session** closes all the 💻/🧑 members together →
(5) run the checkpoint → tick → next stage. Every issue still follows the **sync ritual** (frontmatter +
BUILD-SCHEDULE box + `_backlog` + GitHub in lockstep) as it lands.

**The one real collision risk — shared spec files.** DAG-independent ≠ same-file-independent. Several batch
members still edit the shared **`schema.md`**, **`config-registry.md`**, or the **one shared migration chain**
— parallel worktree agents WILL conflict there. Serialize those edits (a single "shared-spec" pass up front,
or assign each shared file to exactly one agent).

**Migration-chain lane (durable — Rule 0, don't leave this in chat).** `app/silo/migrations/` + its
**`_journal.json`** are a single shared chain; **two worktree agents must never each pick the next tag** —
they'd both grab `0003` and collide on `_journal.json`. **Applied-LIVE head: `0033_push_subscriptions_owner_rls` (session 77, ISSUE-079).
Next free silo tag is `0034`.** *(Session-76 added `0031_rls_enforcement` [ISSUE-020] + `0032_profiles_authenticated_grant` [ISSUE-013 fix]; session-77 added `0033_push_subscriptions_owner_rls` [ISSUE-079, owner-scoped + aal2] — all applied LIVE.)* *(Session-74 added `0027_profiles_invite_lifecycle` [OD-192 invite lifecycle] + `0028_task_queue_awaiting_approval_at`
[logic-sweep staleness-clock fix], both applied LIVE. Session-75 added `0029_entities_internal_org_singleton` [ISSUE-022 — the entities
Internal-Org partial-unique singleton guard, `transactional:false`] + `0030_entity_types_config_seed` [ISSUE-022 — CFG-entity_types → config_values],
both applied LIVE; R10 memory live-smoke green.)* **ALL of `0011–0026` are APPLIED LIVE to the silo + verified** — `0021–0023` (Checkpoint-3 review,
session 72) + `0024_webhook_event_types` / `0025_agents_version_chain_unique` / `0026_version_chain_lost_update_backstops` (session-73
Part-B adapter sweep; see `spec/00-foundations/standards/live-adapter-backfill-findings.2026-07-07.md`). The **mgmt-plane chain**
(hand-applied, no journal) is at **`0003_backup_dr`** (ISSUE-085 — 4 enums + 5 operator-side backup tables, APPLIED LIVE to the mgmt DB). Highlights: 16/16 Stage-4
`event_type` + 1 `alert_type` value (`0011`), 9 trigger `event_type` values (`0018`), `rate_limit_deferred`+RLS (`0012`), `guardrail_log.redacted_at` +
redaction-tombstone branch (`0015`, carries BOTH the redaction AND the OD-182 escalation branch), the task_graph/agents append-only triggers
(`0013`/`0016`), the 5 trigger-state tables ([[OD-190]] own-tables rework, `0019`/`0020`). **⚠️ the `0011` semicolon-in-comment splitter trap was caught
LIVE + fixed** (same class as the 0007 session-69 bug — a `;` inside a comment fragments a `transactional:false` statement; keep comments
semicolon-free). *(Stage-4 authored `0011_stage4_event_types` [016 event_type + 1 alert_type value, `transactional:false`; 015/016/034/036/049],
`0012_rate_limit_deferred` [034 persisted 95% queue + default_deny RLS], `0013_task_graph_versions_append_only` [049 append-only-by-version trigger],
`0014_support_requests_rls` [016 public-insert/view/resolve policies], `0015_guardrail_redacted_at` [077 redacted_at column + redaction-tombstone branch (c),
[[OD-074]] change-control on the LIVE append-only trigger — preserves the OD-182 escalation branch byte-for-byte], `0016_agents_version_discipline`
[061 agents version-lineage trigger], `0017_stage4_indexes` [034+016 CONCURRENTLY indexes, `transactional:false`], `0018_trigger_event_types`
[037 9 trigger event_type values, `transactional:false`], `0019_connector_trigger_state` + `0020_connector_trigger_indexes` [037/[[OD-190]] — 5 trigger
runtime-state tables + default-deny RLS + CONCURRENTLY indexes]. **All applied LIVE + verified (session 71).)** Verify-present (NOT re-authored): 056's escalation-stamp branch [already done by OD-182/0009], the hard-limit no-override
CHECK [baseline L465], all six "new" tables, 051's event_type values. Deferred to the Checkpoint-4/onboarding config pass: 034's 5 rate CFG keys +
051's 6 loop CFG keys [OD-181 keygroup coupling; packages fail-closed on unregistered]. Open forks: [[OD-188]] (056 Hold live-persistence column) +
[[OD-189]] (061 awaiting_clarification task_status) — both deferred, no offline blocker.)*
**Previous head note (Stage-3):** `0010_guardrail_escalation_nullfix`. *(Stage-3 authored `0006_profiles_owner_rls` [013], `0007_stage3_event_types` [013+047, 9 additive
`event_type` values, `transactional:false`], `0008_connector_runtime_triggers` [032], `0009_guardrails_append_only`
[060+059, [[OD-182]] — widens the LIVE append-only trigger for a monotonic escalation stamp + binds `injection_quarantine`].
**Authored + discipline-gate clean; NOT yet applied to the silo — the live apply is Phase D, operator-present.** Lesson
re-learned: `0001_baseline` already stands up all 44 tables, so migration authors must add only deltas [RLS/enums/triggers],
never `create table`; and COMMIT the integration before any dependent fan-out [both session-69 fan-outs branched from a stale
base and couldn't see the uncommitted packages].)* Previous head was `0005_retention_prune_whitelist`. *(Stage-2 landed: `0003_config_values_rls` [ISSUE-010], `0004_prompt_version_discipline`
[ISSUE-042], `0005_retention_prune_whitelist` [OD-180 — retention-prune whitelist on the shared audit-immutability
trigger + the latent guardrail_log field-access bugfix]. All applied LIVE + capstone-proven, session 66. The
fan-out worked as designed — parallel logic in worktrees, migrations/journal serialized by the orchestrator — with
one lesson: worktrees branched from a stale base, so integration was by copy-onto-current-main, not git-merge.)*
For the **Stage-2 fan-out specifically:** ISSUE-008's `0001_baseline` already created **all 44
tables + all 29 enums + the `t_append_only` trigger on all four audit sinks** (config_audit_log incl.), so
`010`/`011`/`042` do **NOT** author `create table`/`create type` migrations — they *verify present* (an
absence is an 008 gap) and add only **additive logic**: `010` = `config_values` key-prefix RLS policies (a
migration, composes on the `009` default_deny baseline); `042` = a version-discipline trigger + `prompt_layers`
RLS policy (a migration); `011` = mostly **app-code** (the silent-failure detector query), likely no migration.
**Rule for the fan-out:** parallel agents author their slice *logic + tests* in worktrees, but the **migration
files + `_journal.json` entries are authored in ONE serialized pass** (assign `0003`, `0004`, … at merge time,
or have the orchestrator write the migrations serially after the parallel logic lands). Each issue's §8 now
carries a "verify-present, not re-create" boundary note pointing here.

**Cost — say it out loud:** fan-out trades **tokens for wall-clock** (N agents ≈ N× the compute of one-by-one).
Worth it on the big batches; wasteful on a 1–2-issue stage.

| Stage | Batch | Fan-out payoff | How to run it |
|---|---|---|---|
| 2 | 4 | **Medium** — `010`/`011`/`042` are 📱; `081` is 💻 (live migrate-on-release) | fan out `010`/`011`/`042`; close `081` in the live session alongside the `009` gate. Good **trial** of the pattern on a small stage. |
| 3 | **17** | **HUGE — the marquee fan-out** — mostly offline logic; only `013`/`014`🧑 live | one agent per offline issue → verify pass → batch `012`/`013`/`014` live |
| 4 | 14 | **High** — mostly offline; `033`/`037`/`085`🧑 live | fan out the ~11 offline; batch the 3 live |
| 5 | 16 | **High but connector-heavy** — `020`/`038`/`039`/`040`/`041`/`083` are 💻 | fan out the offline model/specialist issues; batch connectors + RLS-enforcement live |
| 6 | 4 | Low–Med — silo-bound (`023` gate 💻, `024` sole-writer) | small; gate is live |
| 7 | 6 | Medium — `025` gate 💻; batch has offline maintenance logic | fan out `026`/`027`/`028`/`029`/`066`; `082` is two-person live |
| 8 | 3 | Low | small batch |
| 9 | 2 | Low — `053` is the keystone; **resource it, don't split** | serial |
| 10 | 1 | n/a | serial |

**Payoff curve peaks at Stage 3 (17) → 5 (16) → 4 (14).** Those are where a workflow earns its token cost;
the spine, the checkpoints, and the live steps are the floor no parallelism removes (*"spine slow, fans fast"*).

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
- 🟢 BATCH: [x] ✅ **`017` Webhook auth (per-vendor)** — **`done`** (session 63, 2026-07-05) — `app/webhook-auth/` built + verified (18/18 AC battery + typecheck; independent zero-context pass, no offline BLOCKER); dual-accept rotation + alert/throttle + accept-rate limit + obscurity token on the AF-078 spike verifiers. Live per-connector confirmation owed at onboarding (OD-172); `event_type` enum extended additively (OD-179). GitHub #17 closed. · [x] ✅ **`080` Release model (canary/release-train)** — **`done`** (session 64, 2026-07-05) — `app/release/` built + verified (18/18 AC battery + typecheck + `check` gate; independent zero-context pass, no BLOCKER) + repo-root `.github/workflows/ci.yml` (merge gate) + `plugins/`. **LIVE capstone (operator-present):** OD-173 Wait-for-CI spike PASS → **AF-064 🟢** (green push auto-deploys the canary; red own-suite BLOCKS it); operator promote `release`→`main` → production/fleet auto-deployed. Migrate-on-release mechanics = ISSUE-081 (§2-Out). Evidence `app/release/results/od-173-wait-for-ci-spike.2026-07-05.md`. GitHub #80 closed.
- [x] ◇ ✅ **CHECKPOINT 1 — CLOSED 2026-07-05 (session 64)** (💻 Mac — silo + Railway integration): `008` migrations apply *and roll back* cleanly on the provisioned silo (✅ done, session 62); `017`
  rejects forged/replayed webhooks (✅ 18/18 offline battery; live per-vendor = OD-172 onboarding); `080` deploys through the canary gate (✅ LIVE — green→deploys, red→blocked, promote→fleet). **Stage 2 (`009` gate + `010`/`011`/`042`/`081`) may now open (R1).**

### Stage 2 — Shared scaffold  *(OPEN since 2026-07-05 — Checkpoint 1 CLOSED; all 5 issues `ready`)*
- ✅ **GATE — `009` RLS scaffold (helpers, default-deny, 100% coverage CI gate)**  🟢 **DONE (session 65, 2026-07-05)** — 4 helpers + `default_deny` on all 44 tables + the `auth_rls_initplan`/coverage lints (`app/silo`); offline 55/55 + LIVE capstone on the silo (service_role bypass · grant/revoke instant · InitPlan · `lint:rls` coverage green). **AF-079 🔴→🟢.** The gate is real — it caught `_migrations` as RLS-on-no-policy on first live run (fixed, no carve-out). Evidence `app/silo/results/issue-009-rls-capstone-evidence.2026-07-05.md`.
- 🟢 BATCH: [x] ✅ **`010`** Config store + audit-immutability — **done** (session 66; 14/14 + LIVE capstone 7/7; #2 key-map BLOCKER fixed → [[OD-181]]; GitHub #10) · [x] ✅ **`011`** Observability skeleton 🔴 — **done** (session 66; 27/27 + LIVE 5/5; AF-118/120 🟢, AF-119 🟡 seam; retention BLOCKER → [[OD-180]]; GitHub #11) · [x] ✅ **`042`** Prompt store (version-never-overwrite) — **done** (session 66; 14/14 + LIVE 7/7; GitHub #42) · [x] ✅ **`081`** Migration propagation + per-deployment isolation — **done** (session 67; `app/release/propagation.ts`+`corpus.ts`, 27/27 incl. 9 propagation ACs + independent verify SAFE; fleet orchestration + failure isolation + no-fork + fail-loud proven offline; **AF-065 🟢 / AF-020 🟢** carry the mixed-fleet + Pre-Deploy-halt proof; the live `preDeployCommand` wiring on `app/service` is **onboarding-owed** (ISSUE-012 era, needs Railway credit) — §10 scope-honesty; GitHub #81)
- [x] ◇ **CHECKPOINT 2 — ✅ CLOSED (session 67, 2026-07-05).** All four batch members `done`: `009` default-deny + coverage gate GREEN ✅; `011` event_log append-only + silent-failure detector fires ✅ (LIVE); `010` audit rows immutable ✅ (LIVE); `042` version-discipline ✅ (LIVE); `081` fleet propagation + per-deployment failure isolation + fail-loud signal ✅ (offline 27/27 + verify SAFE; live migrate mechanism pre-proven ISSUE-008 + AF-065/AF-020 🟢). Integration re-run: whole-repo offline sweep green (9 packages, 0 fail); Stage-2 live substrate unchanged by `081` (no new migration). Live evidence: `app/silo/results/stage2-checkpoint-evidence.2026-07-05.md`. **Stage 3 (gate `018` + 16-issue batch) may now open (R1).**

### Stage 3 — Core models & safety  *(largest batch — 17 in parallel)*
- ✅ **GATE — `018` Role model + permission matrix + `can()` gate** — the authorization spine — **🟢 DONE (session 68, 2026-07-05)** — `app/rbac/` built + verified: **24/24 AC battery** (one per DoD AC + AF-080 differential incl. a deactivated-assignment teeth case) + typecheck + `check` gate (CATALOG ≡ `PERMISSION_NODES.md`, 55 nodes · 13 categories · 4 C0 stubs · fail-closed). **Independent zero-context verification caught 2 MAJORs — both fixed + re-proven LIVE:** the live last-Super-Admin guard now takes an ADR-004 `pg_advisory_xact_lock` (write-skew lockout was possible without it), and the AF-080 differential now uses two genuinely independent readers. **LIVE capstone (operator-present):** rolled-back txn proved the seed target state + `user_perms` helper parity (AF-080 part-a) + guard logic; a **two-session concurrency spike** proved AC-1.ROLE.005.2 under real race (one demotion won, invariant held). **AF-080 🔴→🟡** (part-a proven; the runtime divergence signal FR-1.RLS.008 is ISSUE-020). No new migration (§5 — seed is app-provisioning code, matrix TS-only). Evidence `app/rbac/results/issue-018-capstone-evidence.2026-07-05.md`. GitHub #18 closed. **Checkpoint 3 stays OPEN — the 16-issue batch is next (R4).**
- [x] 🟢 BATCH — **ALL 17 `done` (session 69, 2026-07-05/06)** via the marquee fan-out (15 offline authors → adversarial verify → 7-package fix fan-out + orchestrator hand-fixes; `012`/`014` built serial with the operator). Whole-batch offline sweep **260 tests, 0 fail**. Migrations `0006–0010` applied LIVE to the silo. Members: `012` mgmt-plane (32/32 + **LIVE mgmt-DB proof** — server `last_push_at`/AF-120 · dedup · token revoke · FK cascade) · `013` OAuth login+session (19/19; real-OAuth-flow owed [[OD-175]]) · `014` Super-Admin pw+2FA+brute-force 🧑 (15/15; IP-independent soft-lock + 2FA-lock-beats-valid-code; live attack-sim owed onboarding, **AF-077 🟢**) · `032` connector runtime (20/20; migration `0008` triggers LIVE; AC-3.CONN.005.2 → [[OD-183]]) · `043` (12/12) · `044` (9/9) · `046` (3/3) · `047` triggers+freeze 🔴 (11/11; **AF-135 live spike deferred [[OD-185]]**) · `048` task_queue (8/8) · `055` seven hard limits 🔴 (13/13; **hard-limit no-override proven LIVE**) · `057` anomaly checks (9/9) · `059` injection pipeline 🔴 (17/17) · `060` guardrail_log 🔴 (17/17; **fail-closed + append-only proven LIVE**) · `074` cost meter (12/12) · `075` alerting (28/28; fail-closed routing) · `076` realtime (13/13; key-name fix [[OD-184]]) · `084` retention (22/22; legal gate owed onboarding). The adversarial verify caught a class of **fake-passes-offline / live-adapter-throws-on-real-DDL** drift + fail-closed gaps — all fixed. **[[OD-182]]** widened the LIVE audit trigger for a monotonic escalation stamp (proven live). 
- [x] ◇ **CHECKPOINT 3 — ✅ CLOSED (session 69, 2026-07-06).** `018` `can()` enforces + last-Super-Admin holds ✅ (LIVE, session 68); the 17-batch works as a group ✅ (offline sweep 260/0); migrations `0006–0010` applied + verified LIVE; **the three non-negotiables re-checked LIVE (R7):** #1 injection_quarantine content-retain + task_queue no-delete ✅; #2 `can()` default-deny + hard-limit no-override CHECK ✅; #3 guardrail monotonic escalation stamp + append-only + fail-closed wrapper ✅ (all via the [[OD-182]] capstone + the hard-limit probe). `012` mgmt-plane **live-proven** on the mgmt Supabase. **Live-owed residuals (onboarding/pre-go-live, tracked — NOT Stage-4 blockers):** `014` live attack-sim + AF-075 (AF-077 🟢 carries) · `047` AF-135 freeze spike ([[OD-185]]) · `013` real OAuth ([[OD-175]]) + AF-073 · `084` legal-review gate. Evidence: `app/silo/results/od-182-capstone.sql` · `app/management/results/issue-012-live-capstone.sql`. **Stage 4 (gate `019` + the 14-issue batch) may now open (R1).** **Retroactive full review (session 72, 2026-07-07, mirroring the Stage-4 full-review pattern):** re-ran the live-adapter-vs-real-schema check across all 18 Checkpoint-3 packages (per-issue adversarial verify at close had missed the fake-passes-offline/live-diverges class) — found **7 BLOCKER + 11 MAJOR**, all fixed and live-verified; migrations `0021–0023` applied LIVE (task_queue no-delete actually enforced for `service_role`, `dynamic_field_values` RLS grant, `supabase_realtime` publication). `046`/`047`/`014` residuals carried forward (disclosed, owned elsewhere, not re-opened). Does not reopen this checkpoint or block Stage 4/5. Evidence: `app/silo/results/checkpoint3-review-evidence.2026-07-07.md`.

### Stage 4 — Behaviour on the models  *(OPEN since 2026-07-06 — Checkpoint 3 CLOSED; gate `019` DONE)*  *(14 in parallel; session 71: 11 offline members built + verified + integrated offline → `in-progress`; 3 live/🧑 members + Checkpoint 4 remain)*
- [x] ✅ **GATE — `019` Clearance + Restricted model** **DONE (session 70, 2026-07-06)** — `app/rbac/src/clearance.ts` on the `018` `can()` gate: four-tier model, OD-186 per-role default seed (HR→Team Member, AM→Client, Finance→{Invoice, Contract/Retainer, Financial Period, Deal}, fail-loud on a missing scope token), clearance grant/revoke, review cadence (both branches non-silent), Restricted grant/revoke (per-individual, mandatory reason, instant), never-auto-inject + control-before-gate rules. **45 tests + typecheck + `check` (clearance-model-integrity gate)** + **LIVE capstone** (exactly-one-subject CHECK, mandatory-reason NOT NULL, hard/soft revoke, **access_audit append-only UPDATE+DELETE rejected** — #1). **Independent adversarial verification caught 2 real defects — both fixed + pinned:** BLOCKER (sweep would hard-delete role-default clearances fleet-wide under fail_closed → **OD-187** scopes the cadence to user grants) + MAJOR (live adapter mislabelled the scheduler `actor_type='user'` → threaded `actor_type`, sweep audits `'system'`). No new migration (head `0010`). Decisions: **OD-186**, **OD-187**. GitHub #19 closed. **Build serial + hardest first (R3) — done.** The 14-issue batch (already `ready`) may now fan out.
- 🟢 BATCH *(session 71 offline fan-out — 11 members `in-progress`: built + adversarially verified + integrated onto main; migrations `0011–0017` authored discipline-clean; **`done` awaits the Checkpoint-4 live apply + the 3 live members)*:
  **Offline-built (`in-progress`):** ~~`015`~~ Invite + seed (31/31; live activation SQL + AF-074 live-owed) · ~~`016`~~ Support-request recovery (20/20) · ~~`034`~~ Rate limiting + tiers (23/23) · ~~`035`~~ Write tools + connector hard limits (7/7; AF-068 🟢 reused) · ~~`036`~~ Tool optimisation (7/7) · ~~`049`~~ Task graphs + idempotency + resume (13/13; AF-112/115 live-owed) · ~~`050`~~ Context envelope + compression (6/6; AF-114/115 live-owed) · ~~`051`~~ Three loops + failure heartbeat (14/14; AF-112 live-owed) · ~~`056`~~ Approval tiers + escalation (26/26; [[OD-188]] Hold live-persist) · ~~`061`~~ Orchestrator + 7-step routing (35/35; [[OD-189]] awaiting_clarification; AF-121/122/126 EVAL) · ~~`077`~~ Log retention/export + mgmt views (38/38; guardrail redaction live via 0015).
  **Live/🧑 — offline-built + adversarially verified (session 71 cont.), now `in-progress`; live-close batches into the Checkpoint-4 operator session:** ~~`033`~~ OAuth token lifecycle 🧑 (25/25; verify caught a stubbed cap-surfacing AC → fixed; AF-089 GHL rotation-race + concrete vendor OAuth live-owed to 039/040/041) · ~~`037`~~ Trigger infra + liveness (28/28; verify caught a fake-`audit`-table drift → fixed to real `access_audit`; per-vendor arms AF-090/084/083 held & live-owed; **migration `0018`** = 9 trigger `event_type` values) · ~~`085`~~ Backup & DR 🔴 (16/16, verify PASS; AF-069 Path B 🟢 reused; live rehearsal run + AF-072 LOAD + AF-069 Path A live-owed; **mgmt migration `0003_backup_dr`** = operator-side backup log, hand-applied to the mgmt DB).
- [x] ◇ **CHECKPOINT 4 — ✅ CLOSED (session 71, 2026-07-07).** All 14 batch members `done` (offline ACs proven,
  290/0 sweep) **+ a full live-adapter review**: a correctness pass + a per-package `results/live-smoke.sql` that
  replays each adapter's real write path rolled-back against the silo — **14/14 pass live**. The review caught +
  fixed **3 BLOCKERs** (015 `profiles→auth.users` FK · 056 `access_audit` `actor_type='human'` invalid enum · 037
  trigger state in the version-locked `tools.config`) **+ 3 MAJORs** (056 swallowed compensation · 061 dropped
  `__domain` routing tag · 037 non-atomic lost-update) that the offline suites + adversarial verify all missed.
  Migrations `0011–0020` applied LIVE (head `0020`); **R7 three-non-negotiables re-checked LIVE** (`app/silo/results/stage4-checkpoint-capstone.sql`
  — #1 task_graph/agents append-only + guardrail redaction; #2 hard-limit no-override + clearance; #3 loud events +
  escalation stamp). `019` gate live (session 70). **Live-owed residuals (onboarding/connector, tracked — NOT blockers):**
  AF-089 (033 GHL race) · per-vendor arms AF-090/084/083 (037→039/040/041) · AF-069 Path A + AF-072 LOAD + the standing
  live rehearsal (085). **Stage 5 (gate `022` + batch) may now open (R1).**

### Stage 5 — Integration & specialists  *(OPEN since 2026-07-07 — Checkpoint 4 CLOSED; gate `022` + `021`/`038`/`039`/`040`/`041`/`078`/`079`/`083`/`086` `ready`; `020`/`052`/`058`/`062`/`065`/`068` flipped `ready` session 74; only `064` `blocked`, on `052`)*  *(16 in parallel)*

> ✅ **DRIFT RESOLVED (session 74):** the 6 issues (`020`/`052`/`058`/`062`/`065`/`068`) whose §7 blockers are all `done` were flipped `blocked → ready` per the written rule (verified each blocker `done` first-hand; no "hold until gate `022`" convention exists — 9 sibling batch members were already `ready` alongside the gate). Only `064` remains correctly `blocked` (its sole §7 blocker `052` is `ready`, not `done`). Ship-gating spikes (058→AF-001, 062→AF-068/121, 065→AF-118, 068→AF-068/131) are ship-gates, not build-blockers. Gate-first discipline (R3) still governs build *order* within the stage — `ready` ≠ "build before the gate".
- [x] 🟠 ✅ **GATE — `022` Memory + entity model + sensitivity/visibility tagging**  🔴 — get the entity model wrong and knowledge fragments (#1). **DONE (session 75, 2026-07-08).** `app/memory/` (port + fake + live adapter): deterministic entity resolution (external_refs → name/type → create; ambiguity flagged, **never** guessed — OD-033/FR-2.ENT.005), the Internal-Org singleton, the two orthogonal tag axes (visibility most-restrictive-default + never-auto-Restricted). **Delta-only migrations `0029` (Internal-Org partial-unique singleton guard) + `0030` (entity_types config seed) applied LIVE (head 0028→0030)** — the `entities`/`memories` tables + enums + watermark index already shipped in 0001. **18/18 offline** (17 AC + AF-082 EVAL: **false-merge=0**, ambiguity flagged) + **R10 live-smoke green** (caught + fixed one fake-vs-DB confidence-CHECK divergence). AF-082 🔴→🟡 (seed-EVAL proven; at-scale EVAL = onboarding fast-follow). Dependents `023`+`030` flipped `blocked → ready` (`024` was still blocked on `020` here — flipped `ready` in session 76 once `020` landed). Committed `ab6e415`; **GitHub #22 CLOSED**. **Checkpoint 5 stays OPEN — the batch (`020`/`038`/connectors/…) may now fan out (R3: gate built).**
- 🟢 BATCH: [x] ✅ **`020` RLS enforcement (visibility/sensitivity/Restricted/aal2 + service_role) 🔴 — DONE (session 76, 2026-07-08).** Migration `0031` (applied LIVE, head 0030→0031): `user_visibility` helper + `roles.visibility_tiers` role-attribute (OD-168), the memories clearance predicate (visibility∩sensitivity∩Restricted, entity-type-scoped, NO client_slug), the entities Internal-Org wall, RBAC-self read policies + `grant select … to authenticated`, and the universal aal2 retrofit (ALTER POLICY) + CI aal2-coverage lint. New `app/rls-enforcement/` package: the FR-1.RLS.007 mid-task authz re-check (halt+quarantine before a consequential side effect on deactivation/revocation; expiry≠revocation; fail-closed) + the FR-1.RLS.008 divergence signal. **silo 76/76 + rls-enforcement 12/12 offline · R10 live capstone GREEN** (aal1→0 rows · under-cleared→only global/standard · instant grant · entity-type scope · Restricted grant/revoke · Internal-Org wall · service_role bypass — caught+fixed 2 real bugs pre-commit). AF-076/079/080 realized in code. Dependent `024` flipped `blocked → ready`. GitHub #20 CLOSED. · `021` User mgmt + RBAC audit · `038` Disconnection + recovery · `039` GHL connector · `040` Google connector · `041` Slack connector · `052` Inngest engine + retry + DLQ · `058` Rate-limit + cost-ladder enforcement · `062` Eight specialists + per-agent hard limits · `064` Execution plans + failure-mode · `065` Agent health / dead-agent · `068` Proactivity modes + autonomy matrix · `078` Ops dashboards · `079` Mobile surface · `083` Client offboarding · `086` Config admin surface
- [x] 🟢 **BATCH (session 77, 2026-07-08) — 6 offline members CLOSED + 3 surfaces logic-built:** the 9 offline members built via a worktree-free fan-out (disjoint `app/<slug>` packages) → independent adversarial verify (caught **2 BLOCKER + 7 MAJOR + 19 MINOR** — all the fake-passes-offline / fail-open / audit-atomicity class) → fix pass (regression-test-first, fail-safe) → **live R10 smokes GREEN** vs the silo. **DONE:** `021` user-mgmt+RBAC-audit (BLOCKER: last-SA guard was fail-open under READ COMMITTED → advisory-lock; **+ cross-package fix: user-mgmt now shares `@harness/rbac`'s SA-guard lock key**) · `052` Inngest+DLQ · `058` rate+cost-ladder · `062` specialists (fail-CLOSED untagged-write guard) · `065` agent-health · `068` proactivity (txn audit+uuid FK). **Migration `0033_push_subscriptions_owner_rls` applied LIVE (head 0032→0033; the silo aal2-lint caught+fixed a missing aal2 clause).** **Surfaces `078`/`079`/`086` → `in-progress` (logic built + offline-green + `078`/`079` R10-smoke-green; render-pending per [[OD-197]] — the frontend track).** `064` flipped `blocked → ready` (`052` done). Forks in [[OD-198]] (all fail-safe-shipped; notable: human-path RLS gap on task_queue/notifications/event_log owed to producer issues). Committed. GitHub #21/#52/#58/#62/#65/#68 CLOSED.
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

## Frontend track (parallel lane — [[OD-197]], added session 77)

**Why a separate track.** The 11 dependency waves above are the **backend** build order. The plan specced all 13
surfaces (`spec/03-surfaces/`) and locked the UI stack (Next.js + Tailwind + shadcn/ui) but **never scheduled the app
that renders them** — every `app/*` package built so far is headless. [[OD-197]] resolves this: the frontend is a
**second lane that grows alongside the backend**, not a big-bang at the end (which would leave the system
untestable-by-a-human for months). A pile of headless packages can't be clicked; screens are how the operator tests it.

**The track's own dependency rule (mirrors R1).** The render layer is *orthogonal* to the backend waves: **a surface's
React render only needs (a) the substrate `087` `done`, and (b) its own backend signal `done`.** It does NOT wait for
later stages. So screens land as their backends land.

- [x] 🟢 **SUBSTRATE GATE — [[ISSUE-087]] — DONE (Session 78, 2026-07-08)** (the UI analog of `008`): `web/` npm workspace =
  `web/shared` (skin-swappable design system: tokens-as-CSS-vars + semantic components + the RBAC-nav gate + honest-state
  logic + the data-access seam; **11/11** offline tests green reusing the real `@harness/rbac`) + `web/rbac-bridge` (the one
  seam into `app/rbac`) + **two Next.js apps `web/client` (:3100) + `web/admin` (:3200)** (ADR-001 §7) — both boot + typecheck
  clean. Verified live: auth gate (unauth→login), RBAC nav absent-not-empty (SA=13 / Standard=1 / Admin-fleet=0, UI≡`can()`),
  aal2 step-up (no leak), honest-state never-false-healthy, the seam rendering **55** live nodes, a11y landmarks, light+dark
  (a pure token swap = OD-197 reskin-not-rebuild), screenshots both themes. **Residual:** the real `@supabase/ssr` session
  path is wired but live-auth-verified in ISSUE-013 (OD-175) / deploy in 080/081 — the substrate ships no new live DB adapter,
  so **R10 is N/A**. GitHub #87 → CLOSED.
- 🟢 **WALKING SKELETON** (right after `087`): the first clickable, testable path — **auth (surface-00) → Ops dashboard
  (surface-05) on real data → User Management (surface-02)**. Their backends (`013`/`078`-logic/`021`-logic + `011`/`075`/`076`/`077`)
  are built or landing in Stage 5. This is the "see it" milestone the operator asked for. *(A clickable surface-05
  prototype was shared session 77 as the design proof.)*
- 🟢 **PER-SURFACE RENDER** (each gated on its own backend signal `done`): surface-01/01b (`086`), surface-03 (`026`),
  surface-04 (`056`), surface-06 (`078`), surface-07/08 + notif centre (`073`), surface-09 (`067`), surface-10 (`072`),
  surface-11 (`031`), surface-12 mobile (`079`). **Owed (Rule 0, [[OD-197]]):** a `to-issues` pass reframes each surface
  issue to carry a **render** sub-deliverable (or mints render issues) once `087` lands. Until then, Stage-5 surface
  members (`021`/`078`/`079`/`086`) close as **logic-done, render-pending**, not full screens.

> **Fan-out note.** The substrate is serial (gate). Per-surface renders are batch-safe *once their backend is done* —
> same collision rule as the backend batches (shared design-system/token files serialized; each surface's screen is a
> disjoint path). *(Cost: the frontend is real net-new work the 86-issue backlog under-scoped — say it out loud.)*

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
