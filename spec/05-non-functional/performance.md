# NFR — Performance & Scale  (`NFR-PERF`)

> **Context manifest.** Depends on: ADR-006 (live data-driven RLS on the hot path), ADR-001
> (physical-isolation scale envelope), ADR-003 §4–7 (cost-model levers that double as perf levers),
> and the retrieval/vector/entity FRs in C2 (`component-02-memory.md`), the harness FRs in C5
> (`component-05-harness.md`), the agent FRs in C8 (`component-08-agent-design.md`), the observability
> FRs in C7 (`component-07-observability.md`), plus the config registry (`spec/02-config/config-registry.md`)
> and the feasibility register (`spec/00-foundations/feasibility-register.md`, AF-067/019/002/082/125).
> **Reference-don't-re-spec:** each `NFR-PERF` row names the FR/ADR/config that *implements* it and
> adds only the performance posture, the aspirational target, or the verification method (the `AF-*`
> LOAD/EVAL spike that will prove it).
>
> **Performance-target philosophy (RP-4, session 45) — ASPIRATIONAL, SPIKE-CONFIRMED.** The design
> doc states **no** latency numbers. This file **states concrete aspirational targets** so builders and
> tests have something to aim at — but **every numeric target below is explicitly tagged "to be
> CONFIRMED by AF-067/019/002 — NOT yet proven (paper target)."** Per the anti-hallucination rule,
> **none is a proven or binding SLO**; they are targets to test *against*, gated by the named AF
> LOAD/EVAL spike.
>
> **Upholds primarily `quality` (usefulness)** — a system that retrieves the wrong memories, or is too
> slow to be used, fails its core premise — with **#3** where a performance degrade must be *visible not
> silent* (realtime → polling surfaced) and **#1** where an economy lever must never lose knowledge
> (compression retains originals).

---

### NFR-PERF.001 — RLS on the hot retrieval path

- **Requirement:** The system shall keep the live clearance-predicate RLS overhead on the retrieval hot path within the retrieval latency budget — the permission lookup evaluates **once per statement** (via the `(select …)` initPlan wrapper, over tiny fully-indexed permission tables) and composes with pgvector ranking of a large memory batch **before** results are returned.
- **Type:** threshold.
- **Upholds:** quality (if the clearance predicate blows the latency budget the product is unusable) + #2 (the predicate is not dropped for speed).
- **Implemented by:** FR-1.RLS.* · FR-2.RET.004 (clearance/visibility filter at retrieval) · ADR-006 §D3/Axis-3 (the `(select …)` initPlan binding rule).
- **Target / threshold:** RLS `(select …)` initPlan predicate overhead **< ~50 ms per statement** on the hot path — **✅ CONFIRMED by AF-067 (ISSUE-002, 2026-07-04): measured 1.06 ms/statement, evaluated once per statement (loops = [1,1,0,1], not per row), lint 0003 PASS** on real Supabase (PG 17.6 / pgvector 0.8.2, 50k memories). The per-row cliff (a bare `STABLE` helper re-evaluated per row: Supabase-measured 178,000 ms → 12 ms once wrapped; ISSUE-002 reproduced the direction — bare 2.5× slower on a `count(*)` scan) is an avoided footgun, not an open risk — the `(select …)` wrapper + indexed policy columns + `TO authenticated` scoping + the `auth_rls_initplan` lint (0003) in CI are binding implementation rules (ADR-006, AF-067).
- **Verification:** **LOAD — AF-067 ✅ PASS 2026-07-04** (`spikes/issue-002-rls-latency/` → `results/af-067-evidence.2026-07-04.md`). Fallback (if it had failed at scale): denormalise permissions into JWT claims (the rejected D2), accepting a staleness window → OOS-012 — **NOT triggered**.
- **Launch gate:** **blocking** (RP-1) — AF-067 is one of the six blocking spikes: if RLS blows the latency budget the product is unusable.
- **Acceptance criteria:**
  - AC-NFR-PERF.001.1 — Given a retrieval on a large memory batch under a realistic clearance predicate, When AF-067 measures it, Then the RLS initPlan overhead is within the stated budget and the predicate is evaluated once per statement (not per row).
  - AC-NFR-PERF.001.2 — Given the deployed RLS policies, When CI runs, Then the `auth_rls_initplan` advisor lint passes (every `auth.*`/helper call is wrapped in `(select …)`, every policy-referenced column indexed).
- **Notes / OD:** the 50 ms figure is a builder-facing target to test against, not a measured SLO; AF-067 is the sole authority on whether it holds.

### NFR-PERF.002 — Vector recall under the RLS predicate

- **Requirement:** The system shall return the relevant memories from pgvector HNSW ANN search **with the RLS clearance predicate applied**, without recall starvation — i.e. the ANN-then-filter order (WHERE/RLS applied *after* the ANN scan) shall not silently drop the in-scope results the user should have seen.
- **Type:** threshold.
- **Upholds:** quality (retrieval that misses in-scope memories is a silent usefulness loss) + #1 (a filtered-away relevant memory is knowledge the user never sees).
- **Implemented by:** FR-2.VEC.* (embed-on-write, dimension guard) · `indexes.md` (HNSW config) · the `ef_search` dial (NFR-PERF.009).
- **Target / threshold:** ANN recall @ default `ef_search=40` under the RLS predicate **≥ ~0.9 recall@10** (no recall starvation) — *to be CONFIRMED by AF-019 — NOT yet proven (paper target)*. HNSW support + iterative index scans (pgvector 0.8.x on Supabase) are DOCS-verified; the **perf-under-filter behaviour stays SPIKE/LOAD-open** because WHERE/RLS filters apply *after* the ANN scan (the pgvector-after-ANN cliff `ef_search` tuning must survive).
- **Verification:** **LOAD — AF-019** (HNSW recall with RLS predicates applied; shares the AF-002 corpus).
- **Launch gate:** **fast-follow** — ships behind the safe `ef_search` posture (dial is tunable up if recall is thin) and does not block go-live.
- **Acceptance criteria:**
  - AC-NFR-PERF.002.1 — Given a retrieval query over a realistic memory corpus with an RLS predicate applied, When AF-019 measures recall, Then in-scope relevant memories are returned at or above the target recall@10 without starvation.
  - AC-NFR-PERF.002.2 — Given recall is thin at the default dial, When observed, Then `ef_search` is raised (recall/latency trade-off, NFR-PERF.009) rather than the predicate being dropped.
- **Notes / OD:** the recall figure is aspirational; AF-019 confirms it and sets the production `ef_search` value.

### NFR-PERF.003 — Retrieval quality / relevance

- **Requirement:** The system shall surface the *right* memories for a task — dual-search (vector + keyword) with ranking that puts relevant memories above noise — since the whole "business brain" usefulness premise rests here.
- **Type:** threshold.
- **Upholds:** quality (this is the single load-bearing usefulness property of the system).
- **Implemented by:** FR-2.RET.* (dual-search + ranking).
- **Target / threshold:** retrieval **end-to-end p95 < 2 s** (clearance filter + vector/keyword + ranking) **and** relevance judged adequate against a realistic corpus. **Latency half ✅ CONFIRMED by AF-067 (ISSUE-002, 2026-07-04): clearance-filtered vector top-k p95 = 0.9 ms on the HNSW index** (50k memories, real Supabase). **Relevance half still AF-002 (EVAL, not yet proven).** ⚠️ Latency PASS is conditional on the pgvector planner using the HNSW index under the RLS filter — by default it picks a full Seq Scan (~19 s); **ISSUE-023 must force index usage (AF-019)**.
- **Verification:** **SPIKE+EVAL — AF-002** (load ~100 real memories, run dual-search + ranking, judge relevance; validates ranking weights). Re-ranking + HyDE are **off by default** in the v1 cost model — justified only if AF-002 earns them.
- **Launch gate:** **fast-follow** — the accuracy EVAL ships behind the human-in-loop / answer-mode-pill postures that already de-risk a thin result; it does not block go-live.
- **Acceptance criteria:**
  - AC-NFR-PERF.003.1 — Given the AF-002 corpus, When dual-search + ranking runs, Then relevant memories rank above noise at the judged threshold and the ranking weights are validated.
  - AC-NFR-PERF.003.2 — Given a retrieval on the hot path, When measured, Then end-to-end latency meets the stated p95 target (gated by AF-067). **✅ Verified 2026-07-04 (AF-067 PASS, p95 0.9 ms) — conditional on ISSUE-023 forcing HNSW index usage under RLS (AF-019).**
- **Notes / OD:** AF-034 rides on AF-002 (whether slot-fill Maturity predicts usefulness); if retrieval is noisy the one-substrate coupling is revisited.

### NFR-PERF.004 — Entity-resolution accuracy at scale

- **Requirement:** The system shall resolve a mention to the correct existing entity (`external_refs`-first, then deterministic name/type match, new entity only on no confident match) accurately enough that the brain does **not** fragment into near-duplicate entities as data grows.
- **Type:** threshold.
- **Upholds:** quality + #1 (a fragmented entity means every retrieval silently sees half its knowledge — an integrity loss) + #2 (a false-merge collapses two clients → cross-contamination).
- **Implemented by:** FR-2.ENT.005 (deterministic resolution) · FR-2.MNT.010 (duplicate-cluster erosion backstop) · the ambiguity-flag threshold (OD-033, human-confirm on hard cases).
- **Target / threshold:** false-merge and false-split rates below the EVAL-set threshold, with the ambiguity flag catching the hard cases for human confirm rather than guessing — *to be CONFIRMED by AF-082 — NOT yet proven (paper target)*. No standalone latency number; the risk is **accuracy at scale**, not speed.
- **Verification:** **EVAL — AF-082** (realistic mention data — system-ID-bearing + free-text, name collisions, aliases — measured against a ground-truth entity set; shares the AF-002 corpus).
- **Launch gate:** **fast-follow** — ships behind the FR-2.MNT.010 duplicate-cluster backstop + the OD-033 ambiguity-flag human-confirm posture; does not block go-live.
- **Acceptance criteria:**
  - AC-NFR-PERF.004.1 — Given the AF-082 mention set, When resolution runs, Then false-merge and false-split rates are within threshold and ambiguous cases are flagged for human confirm rather than silently resolved.
- **Notes / OD:** the structural-erosion duplicate scan (FR-2.MNT.010) is only a backstop, not the primary guarantee.

### NFR-PERF.005 — Scale envelope (≤~20 users / silo)

- **Requirement:** The system shall state every performance target against the ADR-001 physical-isolation scale envelope — **≤~20 users per silo, ~6 roles** — and is explicitly **not** designed for hot failover or high concurrency at v1.
- **Type:** posture.
- **Upholds:** quality (targets are only meaningful bounded to the real operating envelope; over-claiming scale would be a hallucinated SLO).
- **Implemented by:** ADR-001 (per-client isolated Supabase project) · ADR-006 (≤20 users, one-page indexed permission table) · ADR-008 posture (backup-restore with downtime, not HA).
- **Target / threshold:** N/A (envelope, not a number) — the tiny, fully-indexed permission table at this scale is *why* the live-RLS lookup is plausible (NFR-PERF.001); HA/read-replicas are a per-client upsell (OOS-014).
- **Verification:** DOCS (every PERF target references this envelope; no target is stated for a scale the product does not target).
- **Launch gate:** blocking (the envelope frames the blocking latency spike AF-067).
- **Acceptance criteria:**
  - AC-NFR-PERF.005.1 — Given any stated PERF target, When reviewed, Then it is bounded to the ≤~20-user/silo envelope and does not imply hot-failover or high-concurrency behaviour the design excludes.
- **Notes / OD:** ADR-001 projects ~20 *clients* by year two (each an isolated silo); the ≤20-*users*-per-silo figure is ADR-006 §Axis-2 / ADR-008 posture. HA deferred → OOS-014.

### NFR-PERF.006 — Memory-injection cap

- **Requirement:** The system shall cap the number of relevant memories injected into a task at `memories_injected_per_task` (default 7), bounding prompt size and per-task token cost without silently starving the task of context.
- **Type:** threshold (locked-config lever).
- **Upholds:** quality (bounded, relevant context beats an unbounded dump) — a cost lever that is also a latency/quality lever.
- **Implemented by:** `memories_injected_per_task=7` (config, LIVE, int 1–50) · FR-2.RET.* (retrieval feeds the injection set).
- **Target / threshold:** 7 memories per task (config-tunable 1–50); it is the top-`k` on the ranked retrieval set (NFR-PERF.003), so its quality depends on ranking being good (AF-002).
- **Verification:** DOCS (config default) — the *quality* of the top-7 is validated inside AF-002.
- **Launch gate:** not a launch gate — locked-config posture (tunable at runtime).
- **Acceptance criteria:**
  - AC-NFR-PERF.006.1 — Given a task retrieval, When memories are injected, Then at most `memories_injected_per_task` (default 7) are included, drawn from the top of the ranked set.
- **Notes / OD:** raising it trades token cost for context; the ceiling of 50 is the config bound.

### NFR-PERF.007 — Chain-depth limit

- **Requirement:** The system shall enforce a maximum orchestration chain depth of `chain_depth_limit` (default 6) **at plan-build time** — a plan exceeding it is rejected/trimmed with lowered confidence, never silently truncated mid-run.
- **Type:** threshold (locked-config lever).
- **Upholds:** quality (bounded chains keep tasks tractable and costs bounded) + #3 (over-limit is a visible reject/trim, not a silent cut).
- **Implemented by:** FR-8.PLAN.003 (enforce at plan-build) · `chain_depth_limit=6` (config, LIVE, int ≥ 1).
- **Target / threshold:** 6 steps (config-tunable ≥ 1); enforced when the plan is built, before execution.
- **Verification:** build-time test (a plan exceeding the limit is rejected/trimmed at build, not executed as-is — AC-8.PLAN.003.1).
- **Launch gate:** not a launch gate — locked-config posture.
- **Acceptance criteria:**
  - AC-NFR-PERF.007.1 — Given a plan exceeding `chain_depth_limit`, When it is built, Then it is not executed as-is: it is rejected or trimmed with lowered confidence, and the outcome is logged — never silently truncated.
- **Notes / OD:** —

### NFR-PERF.008 — Compression threshold (economy that never loses knowledge)

- **Requirement:** The system shall summarise earlier step outputs once a task chain exceeds `compression_threshold_tokens` (default 8000) to bound context/token growth, while **retaining the uncompressed originals** in a durable store (`task_history` / Inngest step-state) — economy shall never equal knowledge loss.
- **Type:** threshold (economy lever with a #1 guard).
- **Upholds:** #1 (originals retained — compression is lossless as to source) + quality (bounded context keeps long chains coherent and affordable).
- **Implemented by:** FR-5.ENV.003 (inter-step compression, lossless source) · `compression_threshold_tokens=8000` (config, LIVE, int ≥ 1000) · durable `task_history` (schema.md, Phase 4).
- **Target / threshold:** compress above 8000 tokens; originals kept in a durable store that outlives the longest chain + the audit window.
- **Verification:** **EVAL — AF-114** (compression preserves task-critical state a later step needs — no silent loss of needed context) + **DOCS/SPIKE — AF-115** (the originals store retains uncompressed outputs longer than the longest chain + audit window; else persist to a C5-owned durable store).
- **Launch gate:** fast-follow — the compression *fidelity* and *originals-retention* AFs are build-time gates behind the "originals retained" invariant, which itself is blocking-by-design (a #1 property, enforced in schema).
- **Acceptance criteria:**
  - AC-NFR-PERF.008.1 — Given a chain exceeding `compression_threshold_tokens`, When older steps are summarised, Then the uncompressed originals remain retrievable from the durable store (never dropped).
  - AC-NFR-PERF.008.2 — Given a compressed chain, When a later step needs earlier detail, Then AF-114 confirms the compression preserved the task-critical state (no silent loss).
- **Notes / OD:** the "originals retained" clause is the load-bearing #1 guard; the token threshold is the tunable economy knob.

### NFR-PERF.009 — `ef_search` recall/latency dial

- **Requirement:** The system shall expose `ef_search` (default 40, range 10–500) as the pgvector HNSW recall/latency trade-off dial — higher searches more thoroughly (better recall, slower); lower is faster (thinner recall).
- **Type:** threshold (locked-config lever).
- **Upholds:** quality (the dial is how recall starvation is corrected without dropping the predicate).
- **Implemented by:** `ef_search=40` (config, LIVE, int 10–500) · `indexes.md` (HNSW) · consumed by FR-2.VEC.*/RET.* retrieval.
- **Target / threshold:** default 40; AF-019 sets the production value that meets the NFR-PERF.002 recall target within the NFR-PERF.001 latency budget.
- **Verification:** LOAD — AF-019 (the recall/latency curve under the RLS predicate sets the dial).
- **Launch gate:** not a launch gate on its own — locked-config posture; its *evidence* is AF-019 (fast-follow).
- **Acceptance criteria:**
  - AC-NFR-PERF.009.1 — Given recall measured under the RLS predicate at the default dial, When it falls short, Then `ef_search` is raised within its 10–500 range to meet the recall target, trading latency knowingly.
- **Notes / OD:** the dial is the tuning surface for NFR-PERF.002; the two are a pair.

### NFR-PERF.010 — Loop cadence + lazy spin-up (idle floor ≈ free)

- **Requirement:** The system shall run its background loops on tiered cadences (`loop_cadence_fast` `*/10 * * * *`, `loop_cadence_medium` `0 */2 * * *`, `loop_cadence_slow` `0 8 * * *`) and shall run a **code DB-condition pre-check before waking the Sonnet orchestrator** — the idle-loop floor stays near-free because an idle loop short-circuits without an LLM call.
- **Type:** threshold + posture (perf/cost lever).
- **Upholds:** quality (the system stays responsive on the fast loop) + cost economy (idle floor ≈ free) — a perf lever that is also the ADR-003 cost floor.
- **Implemented by:** ADR-003 §5 (loop idle floor — code short-circuit, not an LLM gate) · `loop_cadence_fast/medium/slow` (config, BOOT).
- **Target / threshold:** fast `*/10m` (5–15 min range) · medium `2h` (1–4 h range) · slow `08:00 daily`; idle short-circuit before Sonnet spin-up. Queue dispatch latency (event verified → task running) **within seconds, not minutes** on the fast path — *to be CONFIRMED by the perf spike battery — NOT yet proven (paper target)*.
- **Verification:** DOCS (cadence config + the code-pre-check ordering) + build-time test (an idle loop does not wake the orchestrator).
- **Launch gate:** not a launch gate — locked-config posture (the cadences are BOOT config).
- **Acceptance criteria:**
  - AC-NFR-PERF.010.1 — Given a loop tick with no qualifying work (no new lead / overdue task / queued item), When the DB pre-check runs, Then the orchestrator is not woken and no Sonnet call is made.
  - AC-NFR-PERF.010.2 — Given a verified event needing fast-path work, When the fast loop runs, Then the task is dispatched within the seconds-not-minutes target.
- **Notes / OD:** the lever-precedence ordering (ADR-003 §6) places loop idle-gating third, after model routing and the selective-writing gate.

### NFR-PERF.011 — Realtime connection budget → degrade to polling (visibly)

- **Requirement:** The system shall treat the per-silo Realtime connection budget (Supabase Free ~200 / Pro ~500 concurrent) as a hard ceiling and, at `realtime_connection_headroom_threshold` (80%) utilisation, **degrade extra connections to polling** — never a silent freeze — while keeping the **two** prioritised Realtime surfaces (approval queue + notification centre) live.
- **Type:** threshold + posture.
- **Upholds:** **#3** (a connection-budget degrade is surfaced as an honest Polling/Reconnecting state, never a silent stale freeze) + quality (the two safety-critical Realtime surfaces stay live).
- **Implemented by:** FR-7.RTP.003 (per-silo budget with degrade-to-polling) · `realtime_connection_headroom_threshold=80%` (config, LIVE, int 1–100) · FR-7.RTP.001/002 (exactly two Realtime surfaces).
- **Target / threshold:** degrade at 80% of the per-silo cap (200/500); the two Realtime surfaces are last to degrade; the degraded state reads an honest Live/Polling/Reconnecting indicator (never-false-healthy).
- **Verification:** build-time / integration test (at threshold, extra connections switch to polling and the indicator reflects Polling — no silent freeze; the two prioritised surfaces stay Realtime).
- **Launch gate:** not a launch gate — locked-config posture; the *never-silent* behaviour is the load-bearing invariant (a #3 property).
- **Acceptance criteria:**
  - AC-NFR-PERF.011.1 — Given Realtime utilisation reaches `realtime_connection_headroom_threshold`, When new connections arrive, Then they degrade to polling and the client shows an honest Polling/Reconnecting indicator — never a silent freeze reading as Live.
  - AC-NFR-PERF.011.2 — Given the budget is under pressure, When surfaces degrade, Then the approval queue and notification centre are the last to lose Realtime.
- **Notes / OD:** the two-Realtime-surface cap (FR-7.RTP.001/002) is what keeps the budget affordable at the silo scale (NFR-PERF.005).

### NFR-PERF.012 — Scope-aware result caching (reuse without serving stale knowledge)

- **Requirement:** The system shall cache and reuse recent agent outputs per-agent-type (`cache_time_window`: research 30m · client 60m · campaign 60m · comms 15m · ops 120m · finance 120m · insight 1440m) only while a **scope-aware, write-triggered invalidation** holds — the cache key includes the in-scope entity ids + their last-write/memory version, and any write to an in-scope entity invalidates the entry (time-window alone can serve stale knowledge after a relevant write).
- **Type:** threshold + posture.
- **Upholds:** **#1** (a stale cache must never serve superseded knowledge — invalidate on write, miss-on-uncertainty) + quality (reuse cuts latency/cost on repeat work).
- **Implemented by:** FR-8.LRN.003 (scope-aware, time-bounded caching) · OD-076 (#1 cache invalidation = scope-aware + time-bounded) · `cache_time_window` (config, LIVE, per-agent-type minutes).
- **Target / threshold:** per-agent-type window (above) **AND** write-triggered invalidation on any in-scope-entity write; a miss on uncertainty (never serve when scope/version can't be confirmed).
- **Verification:** **SPIKE/EVAL — AF-125** (agent-result-cache staleness safety: confirm a write to an in-scope entity invalidates the entry within the window and no stale answer is served).
- **Launch gate:** **fast-follow** — ships behind the safe scope-aware/miss-on-uncertainty posture (OD-076); the staleness EVAL does not block go-live.
- **Acceptance criteria:**
  - AC-NFR-PERF.012.1 — Given a cached agent result, When any in-scope entity is written, Then the entry is invalidated before the window expires — a stale answer is never served (AF-125).
  - AC-NFR-PERF.012.2 — Given a cache lookup where scope or memory-version cannot be confirmed, When it runs, Then it misses (recomputes) rather than serving a possibly-stale entry.
- **Notes / OD:** OD-076 rejected the design's literal time-window-only cache precisely because it can serve stale knowledge after a relevant write.

---

*Drafted session 45 (2026-07-01). Follows the `NFR-*` row shape established by the exemplar
`security.md`. All numeric latency/recall targets are **aspirational paper targets** tagged for
confirmation by AF-067 (RLS hot-path, blocking) / AF-019 (vector recall, fast-follow) / AF-002
(retrieval, fast-follow) / AF-082 (entity-res, fast-follow) / AF-125 (cache staleness, fast-follow);
none is a proven or binding SLO. Config-threshold rows (injection cap, chain depth, `ef_search`, loop
cadence) are locked-config postures, not launch gates. Cites verified against `component-02-memory.md`,
`component-05-harness.md`, `component-07-observability.md`, `component-08-agent-design.md`, ADR-001/003/006,
`config-registry.md`, and `feasibility-register.md` at draft; re-checked by the Phase-5 verification gate.*
