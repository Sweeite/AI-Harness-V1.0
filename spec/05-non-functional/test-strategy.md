# NFR — Test Strategy & the feasibility de-risking schedule  (`NFR-TEST`)

> **Context manifest.** Depends on: the whole `feasibility-register.md` (`AF-*`), every component's
> `AC-*`, the seven other Phase-5 domain files, and the RP-1 launch-gating decision (session 45).
> This is the **keystone** of Phase 5: it proves every other file's claims are *testable* and turns
> every paper-not-proven `AF-*` into a de-risking schedule with an owner and a go/no-go gate.
>
> **The honesty contract (restated from `CLAUDE.md`).** A spec proves the design is *coherent*, not
> that it *works*. This file is where we say, out loud and in one place, **which properties are
> proven-on-paper and which need a running system to confirm** — and what the plan is to confirm
> each. No `NFR-*` anywhere in Phase 5 claims a property is *proven*; every one that rests on a
> testable assumption names the `AF-*` that will prove it. This file is the index of those proofs.

---

## 1 — The test-layer taxonomy (how an `AC-*` becomes `Verified`)

Every acceptance criterion in the spec (`AC-*` and `AC-NFR-*`) is a Given/When/Then — i.e. it is
*already written as a test*. A criterion reaches `Verified` (the last status in the FR lifecycle)
when a test at the right layer passes against the built system. The layers:

| Layer | Proves | Typical `AC` shape | Runs |
|---|---|---|---|
| **Unit** | a single function/branch behaves | pure logic, validators, classifiers, state machines | CI on every push |
| **Integration** | two components agree at a seam | FR↔FR seams (C5↔C6 gate, C2 sole-writer, C7 sinks) | CI |
| **RLS-policy test** | a table's row-security denies/permits correctly | every `AC-*.RLS.*`, clearance-before-display, aal2 | CI (a policy harness per table) |
| **E2E** | a whole user/agent journey works end-to-end | login→2FA, webhook→task, approval→execute, offboarding | CI (nightly) + pre-release |
| **LOAD** | a property holds *at scale* (≤~20 users/silo envelope) | latency, recall-under-RLS, dump-window, queue throughput | pre-release + the LOAD spikes |
| **EVAL** | a probabilistic/quality signal is good enough | retrieval relevance, anomaly accuracy, routing, injection-lib | offline eval harness on a labelled corpus |
| **Red-team** | an adversary cannot exceed the containment boundary | the seven hard limits, injection, webhook forgery, brute-force | pre-release, adversarial |

**The `AC → Verified` rule:** an `AC` is `Verified` when a test at its layer passes **and**, where the
`AC` is held by an `AF-*`, that `AF-*`'s gate has cleared. A criterion whose only proof is a
paper-not-proven `AF-*` is `Ready`, **not** `Verified` — the gap is explicit, never hidden.

---

## 2 — Two senses of "blocking" (reconciling the domain files)

The domain files mark launch gates in two different ways. This distinction is deliberate and is the
single most important thing in this file:

- **Launch-gating spike (the six).** A *paper-not-proven* assumption so load-bearing that we will
  **not go live until the spike PASSES**. If it fails, launch slips or the design changes. Per RP-1
  (session 45): **AF-068** (injection containment red-team, #2), **AF-069** (restore actually works,
  #1), **AF-001** (cost viability, or the business model breaks), **AF-067** (RLS hot-path latency,
  or the product is unusable), **AF-078** (webhook forgery/replay, #2), **AF-077** (brute-force
  defense, #2). These six are the go/no-go set.
- **Blocking-by-posture mechanism.** A safety mechanism (isolation, audit-sink immutability, the
  freeze gate, RLS coverage, expand-contract migrations, the #3 observability watchdogs) that is a
  **locked ADR/FR requirement already in the build** — it must be *present and wired* at launch, not
  "proven by a spike." Its associated `AF-*` (e.g. AF-065, AF-135, AF-076/079, AF-118–120) is a
  **build-time verification** that the mechanism works, not a go/no-go research question. The
  mechanism ships regardless; the AF confirms it.

So "is it blocking?" has two answers: *the six spikes gate the launch date; the posture mechanisms
gate the definition of done of their build issue.* Both are non-negotiable; only the six are
"prove-it-before-we-ship" research risks.

---

## 3 — The AF de-risking schedule (the spine)

Every paper-not-proven `AF-*` that holds a Phase-5 `NFR-*` or a Phase-1 `AC-*`, with its method,
what it holds, its owner-at-build, and its gate. **Launch** column: `SPIKE-GATE` = one of the six
go/no-go spikes · `POSTURE` = blocking-by-posture mechanism, AF is build-time proof · `FAST-FOLLOW`
= ships behind an already-safe posture (shadow-retain / flag-only / human-in-loop / fails-safe) ·
`DOCS` = documentary/legal confirmation, no code spike.

| AF | Method | Holds (NFR / property) | Domain | Launch |
|---|---|---|---|---|
| **AF-068** | Red-team SPIKE | The seven hard limits + containment injection posture (NFR-SEC.004/006) — no authorized-but-dangerous autonomous path | SEC | **SPIKE-GATE** |
| **AF-069** | Restore SPIKE | Backup actually restores complete + queryable (NFR-DR.003) | DR | **SPIKE-GATE** |
| **AF-001** | Cost SPIKE+EVAL | Healthy deployment runs ≤~$20/day (NFR-COST.006) | COST | **SPIKE-GATE** |
| **AF-067** | LOAD+SPIKE | RLS `(select…)` initPlan hot-path latency + clearance-before-rank composes in budget (NFR-PERF.001) | PERF | **SPIKE-GATE** |
| **AF-078** | E2E adversarial | Webhook forgery + replay rejected (NFR-SEC.008) | SEC | **SPIKE-GATE** |
| **AF-077** | Attack sim | Brute-force defense stops an automated attack (NFR-SEC.009) | SEC | **SPIKE-GATE** |
| AF-076 | Table audit + RLS-policy tests | aal2 enforced deployment-wide (NFR-SEC.010) | SEC | POSTURE |
| AF-079 | CI lint gate | Every table has an RLS policy — add-table-without-policy fails CI (NFR-SEC.010) | SEC | POSTURE |
| AF-073 | SPIKE | HttpOnly forced without breaking client reads (C0 auth) | SEC | POSTURE |
| AF-080/081 | Integration + audit | Harness↔RLS non-drift; agent-path audit completeness (NFR-SEC.011/012) | SEC | FAST-FOLLOW |
| AF-065 | Migration SPIKE | Expand-contract keeps a mixed-version fleet safe (NFR-INF.002/003) | INF | POSTURE |
| AF-135 | SPIKE | Deployment-freeze propagation — every dispatch path honours it (NFR-INF.012) | INF | POSTURE |
| AF-004 | Provisioning SPIKE | ADR-005 §5 end-to-end provisioning green (NFR-INF.006) | INF | POSTURE (near-launch — provisioning must work to onboard) |
| AF-064 | DOCS+SPIKE | Railway canary/release-train + build-history rollback (NFR-INF.001) | INF | FAST-FOLLOW |
| AF-066 | EVAL | Synthetic canary corpus catches regressions (NFR-INF.008) | INF | FAST-FOLLOW |
| AF-013 | DOCS | Google production verification lead-time — a scheduling/lead-time risk, not yet cleared (NFR-INF.007) | INF | FAST-FOLLOW |
| AF-020/021 | DOCS+SPIKE | Railway auto-deploy + operator↔client-Supabase connection — DOCS-sharpened, build-time smoke checks still pending (NFR-INF.006) | INF | POSTURE (build-time) |
| AF-132 | SPIKE | Offboarding deprovision completeness (NFR-INF.013 / NFR-CMP.008) | INF/CMP | FAST-FOLLOW |
| AF-112 / AF-063 | LOAD/SPIKE | Loop catch-up idempotency + no post-outage stampede (AF-112); Inngest per-key concurrency serialises same-entity steps (AF-063) — both hold NFR-INF.014 | INF | POSTURE (idempotency keys present) |
| AF-113 | LOAD/EVAL | Parallel-DAG safety — no irreversible side effect outruns a pending approval (FR-5.OPT.001/OD-056; no dedicated NFR row) | PERF | POSTURE |
| AF-114/115 | SPIKE | Compression fidelity; originals-store retention (NFR-PERF.008) | PERF | POSTURE |
| AF-019 | LOAD | pgvector HNSW recall under the RLS predicate (NFR-PERF.002) | PERF | FAST-FOLLOW |
| AF-002 | SPIKE+EVAL | Retrieval surfaces the right memories; re-rank/HyDE earn cost (NFR-PERF.003 / NFR-COST.010) | PERF/COST | FAST-FOLLOW |
| AF-082 | EVAL | Entity-resolution accuracy at scale — the fragmentation risk (NFR-PERF.004) | PERF | FAST-FOLLOW |
| AF-125 | SPIKE/EVAL | Scope-aware cache invalidation prevents stale reuse (NFR-PERF.012) | PERF | FAST-FOLLOW |
| AF-118 | Fault-inject SPIKE | Absence-of-signal liveness — the watchdog/detector can't itself stall (NFR-OBS.001/004) | OBS | POSTURE |
| AF-119 | Induce-DB-failure SPIKE | Out-of-band log path reachable when Postgres is down (NFR-OBS.002) | OBS | POSTURE |
| AF-120 | DOCS/SPIKE | Clock-sync / escalation-window math anchored receiver-side (NFR-OBS.006/007) | OBS | POSTURE |
| AF-116 | EVAL | Anomaly-check accuracy — FR-6.ANM.002/003/004/005 (no dedicated NFR row) | OBS | FAST-FOLLOW |
| AF-117 | EVAL | Injection pattern/embedding library coverage (NFR-SEC.006) | SEC | FAST-FOLLOW |
| AF-124 | EVAL | Dead-agent/drift detection reliable (NFR-OBS.005, flag-only) | OBS | FAST-FOLLOW |
| AF-121–123, 126–131 | EVAL/SPIKE | Routing accuracy, confidence calibration, proactive signal/ranking/ETA/tag accuracy | (C8/C9 quality) | FAST-FOLLOW |
| AF-042 | Reconcile vs bill | Cost estimate stays biased-above the real invoice (NFR-OBS.013 / NFR-COST.005) | OBS/COST | FAST-FOLLOW |
| AF-040/041 | EVAL/tune | Cost-ladder thresholds are realistic — soft/throttle/hard-kill fire at the right daily spend (NFR-COST.001/006) | COST | FAST-FOLLOW (operator-editable per client) |
| AF-043/035 | EVAL | Memory-write Haiku gate quality; two-model split earns its keep (NFR-COST.008/009) | COST | FAST-FOLLOW (shadow-retain) |
| AF-070 | SPIKE | Supabase Management API exposes backup-health fields (NFR-DR.006) | DR | POSTURE (build-time) |
| AF-072 | LOAD | Hourly off-platform dump fits the hour at scale (NFR-DR.001) | DR | POSTURE — **gates the default cadence** (back off / upsell PITR if it fails) |
| AF-071 | DOCS | Backup region / `ap-southeast-2` residency (NFR-CMP.001 / NFR-DR.002) | CMP/DR | DOCS |
| AF-133 | SPIKE | Export integrity + readability at scale (NFR-CMP.008/009) | CMP | POSTURE (build-time) |
| AF-134 | EVAL | Individual-erasure name-match recall — no false-neg un-erased PII (NFR-CMP.005) | CMP | FAST-FOLLOW |
| AF-136 | Legal review | Jurisdiction lawful-retention minimums (NFR-CMP.004/011) | CMP | DOCS/LEGAL (gates HR-content enablement) |
| AF-137 | SPIKE | Erasure completeness verified before audit-done (NFR-CMP.005) | CMP | POSTURE (build-time) |
| **AF-138** | SPIKE/LOAD | **Mobile web-push background delivery of a "critical, immediate, always" alert** (surface-12) | OBS/mobile | FAST-FOLLOW — *new this session; fails safe to the persisted in-app notification centre; no FR rests on delivery* |

*(AF-003 vendor-claims DOCS pass is already done — see the ADR-line in README; AF-010/011/012/014
resolved there. The priority spikes AF-001/002/004 need a runnable prototype — deferred until
build, per the parallel-feasibility track.)*

## 4 — The launch go/no-go gate (the six, expanded)

Before a deployment goes live, these six must show a **PASS** with evidence logged in the
feasibility register:

1. **AF-068 — injection containment red-team.** A documented adversarial battery drives the running
   system and fails to achieve any of the seven hard-limited effects without an authorized human
   step. *(Upholds #2. If this fails, the system can do something it shouldn't — non-negotiable.)*
2. **AF-069 — restore rehearsal.** A backup is restored into a throwaway project; DB + pgvector +
   auth rows verified complete + queryable; result logged. *(Upholds #1. A backup that can't restore
   is a false safety net.)*
3. **AF-001 — cost viability.** A representative deployment's measured daily cost is at/under the
   ~$20/day target (ceiling $100). *(Viability. If false, the retainer model breaks.)*
4. **AF-067 — RLS hot-path latency.** Live data-driven RLS + clearance-before-rank retrieval meets
   the paper target (< ~2 s p95 end-to-end, < ~50 ms/statement predicate overhead) under the
   ≤~20-user load. *(Usability. If false, every query is slow.)*
5. **AF-078 — webhook forgery/replay.** An end-to-end test proves forged and replayed webhooks are
   rejected. *(Upholds #2. A forged event must not drive the system.)* **— MECHANICS PASS 2026-07-04
   (ISSUE-006, MODE-M harness, 17/17: raw-body-before-parse + constant-time compare + replay proven;
   Slack symmetric = real proof; GHL signing DOCS-resolved, AF-090). The live per-connector vendor
   confirmation is re-gated from launch-blocking to per-connector ONBOARDING (OD-172) — proven on
   ISSUE-017/039/040/041 before each connector ships. For go/no-go, mechanics + AF-090 DOCS satisfy
   this gate; the live checks are tracked residuals.**
6. **AF-077 — brute-force defense.** A scripted attack against the Super-Admin login is stopped by
   lockout/backoff. *(Upholds #2. The one password path must resist automated attack.)*

A **fast-follow** AF may ship un-proven **only because** its `NFR-*`/`FR` already ships behind a
safe posture that contains the risk: shadow-retain (nothing lost while a gate is unproven),
flag-only (a detector never auto-acts), human-in-loop (a human approves the consequential step), or
fails-safe (a dropped mobile push falls back to the persisted in-app record). The posture is what
makes fast-follow safe; `test-strategy` records the posture next to each fast-follow AF so the
safety is auditable, not assumed.

## 5 — Verification-gate lineage (Phase 1–4 → build-time tests)

The spec's own verification gates (the independent zero-context re-extraction run after each
component, surface, and the data model) are the **paper** proof that the spec is internally
coherent. They do not prove the system works — that is what the `AF-*` schedule above adds. The
lineage a builder inherits:

- **Phase 1–3 verification gates** (orphan/contradiction + quality passes) → became the `AC-*` a
  builder turns into unit/integration/RLS/E2E tests.
- **Phase 4 verification gate + the post-sign-off re-audit** (which caught the audit-sink
  immutability hole → the `enforce_audit_append_only()` trigger) → became the DB-constraint and
  immutability-trigger tests (NFR-CMP.006).
- **Phase 5 (this phase)** → the `AF-*` de-risking schedule: the spikes/LOAD/EVAL/red-team that
  prove the properties the paper gates could only assert.

## 6 — The confidence story (paper vs proven, stated plainly)

**What the spec proves today (paper):** the design is internally coherent — every design line maps
to an FR, every FR is atomic + testable + citation-backed, every data reference resolves to a typed
table, every surface is fully specified, every safety property has a named owner, and no locked
decision contradicts another. That is a real, checked result — but it is coherence, not correctness.

**What only a running system can prove (the AF schedule):** that containment actually contains
(AF-068), that a backup actually restores (AF-069), that the economics actually work (AF-001), that
the hot path is actually fast enough (AF-067), that forged events are actually rejected (AF-078,
AF-077), and — behind their safe postures — that retrieval is relevant, anomaly detection is
accurate, routing is good, and the cost estimator is honest.

**The bar for launch:** the six spike-gates PASS with logged evidence; every blocking-by-posture
mechanism is built + its build-time AF green; every fast-follow AF has its safe posture verified
present. Anything short of that is surfaced as an open risk on the Super-Admin view and in the
feasibility register — **never** presented as done.

---

*Drafted session 45 (2026-07-01). The keystone of Phase 5 — indexes every other domain file's
proofs. New this session: AF-138 (mobile web-push delivery) logged as a gap-sweep item; the six
launch-gating spikes fixed per RP-1.*
