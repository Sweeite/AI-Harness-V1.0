# Assumptions & Feasibility Register

Every claim or assumption that **can only be confirmed by testing** lives here. A spec proves
the design is *coherent*; it cannot prove the design *works*. This register tracks the gap.

**The contract:** if a requirement or ADR depends on an unproven assumption, it gets tagged
`⚠️ FEASIBILITY: AF-NNN` at the point of use, and an entry is created here. Nothing unproven
is ever presented as proven. These items are *expected to be tested* — surfacing them is the
safety mechanism, not a problem.

**Verification methods:** `DOCS` (confirm from vendor documentation / research) · `SPIKE`
(build a throwaway to prove it) · `EVAL` (measure output quality on real data) · `LOAD`
(test under volume).

**Status:** 🔴 unverified · 🟡 verifying · 🟢 verified · ⛔ failed (forces redesign)

---

## ⭐ Priority spikes — do these alongside the ADR phase (they can invalidate the architecture)

| ID | Spike | Why it's priority | Method | Status |
|---|---|---|---|---|
| AF-001 | **Cost spike** — run one real multi-agent task + memory write, measure actual tokens/$ | Validates the ADR-003 viability target (typical-volume deployment ≤ ~$20/day, under the $50 soft alert). Also measures memory-write cost (now corrected to ≤1 Sonnet + Haiku, AF-043) and feeds AF-042. Most likely thing to invalidate the design. | SPIKE+EVAL | 🟢 **PASS 2026-07-03** — extrapolated **$2.09/day** vs $20 target / $50 soft alert (round-up, all vendors: Sonnet+Haiku+OpenAI embed). Measured: task $0.0359, surviving write $0.0025 (**1 Sonnet + 3 Haiku + 1 embed** — ADR-003 §4 shape confirmed), non-survivor **0 Sonnet**. Declared profile: 50 tasks/day · 500 write-events (100 survive) · 169 idle-gated loops. Harness + evidence (fields a–h): `spikes/issue-001-cost-viability/` → `results/af-001-evidence.2026-07-03.md`. |
| AF-002 | **Memory retrieval spike** — load ~100 real memories, run dual-search + ranking, judge relevance | If retrieval surfaces noise, the whole "business brain" premise is shaky. Validates ranking weights. | SPIKE+EVAL | 🔴 **↳ now ALSO carries the ISSUE-023/AF-019 residual** — nearest-neighbour HNSW *ranking recall* under RLS is not measurable on synthetic vectors (distance concentration), so it was deferred here: this EVAL's **real-embedding corpus** is where NN-ranking recall@k under the clearance predicate gets measured (sets the production `ef_search` beyond the safe default 40). See AF-019 (2026-07-09) + `spikes/issue-023-hnsw-forcing/`. |
| AF-003 | **Vendor-claims verification** — confirm every external limit/capability the doc asserts | Several are checkable and possibly stale; they shape rate-limit, token, and Realtime design. | DOCS | 🟡 **DOCS pass done 2026-06-23** — see Block A findings below. 3 claims stale/refuted (AF-010/011/014), 1 design-fork found (AF-012 Slack → OD-011). Residual: AF-019 stays SPIKE/LOAD-open; AF-012 needs EVAL on a live workspace. |
| AF-004 | **Provisioning/deploy spike** — run the ADR-005 §5 path end-to-end: operator Railway app deploying from the shared repo against a **client-owned** Supabase, with env + secrets + `internal_token` minted/dual-stored + `client_registry` row + first-boot seed all green | Proves the ADR-001 hybrid + ADR-005 provisioning script actually wire up before we spec it in full. **→ 🟢 PASS 2026-07-04 (session 60, two-party live run — evidence `app/provisioning/results/af-004-evidence.2026-07-04.md`):** operator Railway service `AI-Harness-V1.0` auto-deployed commit `324ae79` from GitHub with **Root Directory `/app/service`**, all 7 env secrets injected, `internal_token` dual-stored (Railway env + mgmt `client_registry.internal_token`), `client_registry` row written (`status=initialising`), and `GET /health → 200 {supabaseReachable:true}` — the deployed service reached the **client-owned Supabase silo** (`Transpera-AIOS-V1`, `ap-southeast-2`). 4 Railway mutations validated live (AF-143 partial). **Session-61 follow-through:** the two ISSUE-007 §10 code follow-ups **landed** — the **canary live seed** (`SupabaseSeed`, real OpenAI embeddings + idempotent live upsert; evidence `app/canary/results/live-seed-evidence.2026-07-04.md`) and **`RailwayInfra` codification** (`app/provisioning/src/infra.ts`). ISSUE-007 is now `done` and **Checkpoint 0 is CLOSED**. **Remaining caveat (honest):** the boot target is still the minimal `/health` PROBE, not the C0/C1 first-boot seed (separate issues, out of ISSUE-007 §2), so the `initialising→active` seed transition is exercised by those issues, not here. | SPIKE | 🟢 |

---

## A. Vendor capability claims (verify by DOCS / research — AF-003 umbrella)

| ID | Claim (from design doc) | Source | Status |
|---|---|---|---|
| AF-010 | Google APIs: 100 req/100s/user; Gmail 250 quota units/user/sec | L2120-2126 | 🟠 **STALE** — see F1 |
| AF-011 | GHL: 120 req/min/location, hard limit, no burst | L2128-2131 | ⛔ **REFUTED** — see F2 |
| AF-012 | Slack: ~1 req/sec typical; Retry-After header on 429 | L2133-2138 | 🟠 **STALE + design fork** — see F3, OD-011 |
| AF-013 | Google access token 1h; refresh token dies after 6mo unused; prod needs verified OAuth app | L2275-2279 | 🟢 **VERIFIED** (sharper) — see F4 |
| AF-014 | GHL access token 1 day; refresh valid indefinitely | L2281-2284 | ⛔ **PARTLY REFUTED** — see F5 |
| AF-015 | Slack bot tokens don't expire; revocable by workspace admin | L2286-2290 | 🟢 **VERIFIED** — see F6 |
| AF-016 | Supabase Realtime: 200 (free) / 500 (pro) concurrent connections | L3134-3136 | 🟢 **VERIFIED** (soft quota) — see F7 |
| AF-017 | Supabase Edge Functions 150s execution limit (the reason to use Inngest) | L2630 | 🟠 **STALE** — see F8 |
| AF-018 | Inngest: no execution-time limit, step-level retries, DLQ, generous free tier | L2632-2662 | 🟢 **VERIFIED** (wording fixes) — see F9 |
| AF-019 | pgvector HNSW maintains fast/accurate search at millions of vectors | L1477-1489 | 🟢 **INDEX-FORCING + latency + completeness PASS 2026-07-09 (ISSUE-023, 50k clustered on the live silo, isolated af019_ fixture).** The ISSUE-023 retrieval-session contract (`hnsw.ef_search` + `hnsw.iterative_scan='relaxed_order'` + `enable_seqscan=off`, txn-scoped) **forces the HNSW index under the RLS clearance predicate: contract 30.8 ms vs default 2178 ms seqscan (70.8×)** — the ISSUE-002 ~308× cliff RESOLVED; `iterative_scan` alone is insufficient (still seqscan → `enable_seqscan=off` is the necessary lever, a binding rule for ISSUE-025). Completeness: all 6 roles return a full top-10 of cleared rows (no starvation). p95 21.5 ms < 2 s. **Residual (honest, → AF-002/ISSUE-025):** nearest-neighbour RANKING recall is NOT measurable on synthetic vectors (distance concentration → exact-vs-HNSW overlap is an artifact, measured 0 on runs 1–2); recall/relevance QUALITY at scale awaits a REAL-embedding corpus. `ef_search` ships at default 40 (adequate for latency+completeness) with the raise-not-drop lever ready. Evidence: `spikes/issue-023-hnsw-forcing/results/af-019-evidence.2026-07-09.md`. See F10. |
| AF-020 | Railway native per-project GitHub auto-deploy + running `drizzle-kit migrate` on release behave as assumed (ADR-005 §1) | ADR-001 §6 | 🟢 **VERIFIED** (caveat) — see F11 |
| AF-021 | Operator Railway can securely connect to a client-owned Supabase (hybrid model) | ADR-001 §5 | 🟢 **VERIFIED** (caveats) — see F12 |

### AF-003 DOCS verification findings (2026-06-23) — corrected values + sources

Primary-source verification of the Block A claims. Where a claim is **stale/refuted**, the corrected
value below is the one the spec must cite. Items touching a locked decision are flagged; none force an
ADR supersede (these are vendor facts, not architecture), but the corrected numbers must propagate into
Phase-1/2 rate-limit, token-lifecycle, and Realtime requirements.

- **F1 · AF-010 (Gmail) — STALE.** "250 quota-units/user/**sec**" is retired. Current: **6,000 QU/min/user**
  + 1,200,000 QU/min/project. **Date-dependent:** projects active Nov 2025–Apr 2026 keep old quotas; only
  projects created **on/after 2026-05-01** get the new per-minute figures → the limit a Silo gets depends on
  **GCP project activation date** (pin per-environment, don't cite one number). Quota-unit model confirmed
  (`messages.send`=100, `.get`=20, `.list`=5). Src: developers.google.com/workspace/gmail/api/reference/quota
- **F2 · AF-011 (GHL) — REFUTED.** Not "120/min, no burst." Real v2 model: **100 req / 10 s burst** +
  **200,000 req / day**, scoped **per Marketplace app per location**. No per-minute limit exists. Daily cap is
  the real ceiling for high-volume sync. Headers expose it (`X-RateLimit-*`, `X-RateLimit-Limit-Daily`). Src:
  help.gohighlevel.com/support/solutions/articles/48001060529
- **F3 · AF-012 (Slack) — STALE + DESIGN FORK.** "~1/sec" is only the special posting tier; real model is
  tiered (T1 1+/min · T2 20+/min · T3 50+/min · T4 100+/min). Retry-After on 429 ✓. **The fork (→ OD-011):**
  since **2025-05-29**, non-Marketplace apps have `conversations.history`/`.replies` cut to **Tier 1 (1 call/min,
  `limit` max 15)** — ~15 msgs/min/token, lethal for history ingest. **Exempt:** Marketplace-approved apps **and
  internal custom apps** (keep 50+/min × 1,000). Needs an EVAL on a live workspace once we build ingest. Src:
  docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps
- **F4 · AF-013 (Google OAuth) — VERIFIED, sharper.** Access token ~1 h (design to `expires_in`, not a constant).
  Refresh token: **Testing-status apps expire it in 7 days** (Gmail scopes don't get the name/email exception) →
  must publish to Production; Production tokens don't age out but **die after 6 months unused** and are **revoked
  on user password reset**; **100-refresh-token-per-account-per-client-id cap** (101st silently kills the oldest)
  — load-bearing for a Silo reusing one OAuth client across users. Restricted-scope (Gmail) verification = **CASA
  security assessment, re-done ≥ every 12 months, ~weeks lead time** → onboarding critical-path (already AF-013 in
  ADR-005). Src: developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- **F5 · AF-014 (GHL OAuth) — PARTLY REFUTED.** Access token ~24 h ✓. Refresh token is **NOT indefinite** — it's
  **single-use/rotating** (each refresh returns a new one, invalidates the old) and **expires after 1 year unused**.
  ⚠️ **non-negotiable #1 risk:** the harness **must persist the new refresh token after every refresh** or it
  silently loses GHL access. (30 s concurrency window returns the same token — race-safe.) Src:
  marketplace.gohighlevel.com/docs/Authorization/OAuth2.0
- **F6 · AF-015 (Slack tokens) — VERIFIED.** `xoxb` non-expiring by default, admin/uninstall-revocable
  (`tokens_revoked` event). Optional rotation → 12 h tokens, prefix changes `xoxb`→`xoxe` (code must handle if
  enabled). Src: docs.slack.dev/authentication/tokens
- **F7 · AF-016 (Realtime) — VERIFIED, soft.** 200 Free / 500 Pro **concurrent connections** confirmed but these
  are **adjustable defaults, not hard caps** (Pro overflow bills ~$10/1k). Separate ceilings — **messages/sec** and
  **channel-joins/sec** (Free 100 / Pro 500) — often bind first. Model capacity as a provisionable quota. Src:
  supabase.com/docs/guides/realtime/limits
- **F8 · AF-017 (Edge Functions) — STALE.** "150 s" is **Free-only** wall-clock; **paid = 400 s**. The real
  binding constraint is the **2 s CPU-time cap on ALL plans** (excludes async I/O wait) — that, not wall-clock, is
  why long/CPU-bound work offloads to Inngest. Cite "2 s CPU (all plans) + 400 s paid wall-clock," not "150 s." Src:
  supabase.com/docs/guides/functions/limits
- **F9 · AF-018 (Inngest) — VERIFIED, two wording fixes.** Durable long functions ✓ but **per-step cap ≤ 2 h** —
  decompose accordingly (so "no execution limit" is true at function level, false at step level). Step-level retries
  ✓ (default 4). "DLQ" → correct mechanism is **`onFailure` / `inngest/function.failed`** event. Per-key concurrency
  (`concurrency.key`) ✓ — **confirms the ADR-004 assumption**. Footguns to log: Free **concurrency = 5**; billing
  counts **every step** as an execution (50k executions ≠ 50k jobs). Src: inngest.com/docs/guides/concurrency,
  inngest.com/docs/usage-limits/inngest
- **F10 · AF-019 (pgvector) — HNSW verified; perf stays open.** HNSW supported since 0.5.0; iterative index scans
  since 0.8.0 (current 0.8.x on Supabase). **Keep AF-019 SPIKE/LOAD-open:** WHERE/RLS filters apply **after** the
  ANN scan, so under **per-client RLS (ADR-006) selective filters can starve recall** — iterative scans mitigate but
  must be enabled+tuned (`ef_search`, `maintenance_work_mem`). Must be LOAD-tested **with RLS predicates applied**,
  not bare ANN benchmarks. Src: github.com/pgvector/pgvector
  **↳ Now demonstrated real (ISSUE-002 / AF-067 spike, 2026-07-04, 50k memories on real Supabase):** with the
  clearance RLS predicate present, the pgvector planner **defaults to a full Seq Scan (~19 s)** rather than the HNSW
  index (**63 ms forced**) — a **~300× cliff**. The HNSW index *composes correctly* with RLS (forced, it returns in
  ms); the planner just won't pick it under the filter without help. **ISSUE-023 hard requirement:** force/guarantee
  index usage under the clearance predicate (partial indexes / cost tuning / `hnsw.iterative_scan` = relaxed) — this is
  no longer paper, it's a measured build blocker for the retrieval path.
  **↳ RESOLVED (ISSUE-023 spike, 2026-07-09, 50k clustered on the live silo, isolated af019_ fixture):** the retrieval-
  session contract (`hnsw.ef_search` + `hnsw.iterative_scan='relaxed_order'` + `enable_seqscan=off`, all `set local` =
  txn-scoped) **forces the index — contract 30.8 ms (index) vs default 2178 ms (seqscan), 70.8×.** Key finding:
  **`iterative_scan` alone is NOT enough** (the planner still seqscans) — `enable_seqscan=off` is the necessary lever
  (a binding rule for ISSUE-025's retrieval session, codified in `app/embeddings/src/retrieval-session.ts`). Completeness:
  all 6 roles return a full top-10 of *cleared* rows (the post-ANN clearance filter does not starve the result). p95
  21.5 ms < 2 s. **The recall RANKING dimension of AF-019 ("accurate search") is NOT closed here** — synthetic vectors
  suffer distance concentration (no recoverable NN ranking; exact-vs-HNSW overlap measured 0), so recall/relevance
  QUALITY at scale is deferred to **AF-002 / ISSUE-025 with a real-embedding corpus**. Evidence:
  `spikes/issue-023-hnsw-forcing/` → `results/af-019-evidence.2026-07-09.md`.
- **F11 · AF-020 (Railway) — VERIFIED.** Per-service GitHub auto-deploy with **configurable trigger branch per
  environment** + optional "Wait for CI" → **supports the ADR-005 canary/release-train branch model** (corroborates
  AF-064). **Pre-Deploy Command** runs between build and cutover and **blocks deploy on failure** → `drizzle-kit
  migrate` as a release-phase migration works as assumed. ⚠️ Caveat: pre-deploy runs in an **isolated container, no
  volumes mounted** — fine for a network DB migration, not for volume-dependent ones. Src:
  docs.railway.com/deployments/pre-deploy-command
- **F12 · AF-021 (cross-account Supabase) — VERIFIED.** No technical barrier — a Supabase project is Postgres + an
  API gateway; an external host connects with the connection string / service-role key regardless of dashboard
  ownership (Supavisor pooler IPv4-only; direct needs IPv4 add-on). ⚠️ Two security caveats, load-bearing under
  ADR-001 hybrid ownership + ADR-007 containment: (1) the **service-role key bypasses RLS entirely** (god-mode on the
  client's DB — a #2 containment concern, links ADR-006 service-role-bypass note); (2) the client *can* IP-allowlist
  the operator, but that **assumes the operator compute has a static egress IP** — verify before relying on it. Src:
  supabase.com/docs/guides/platform/network-restrictions

## B. Behavioral / quality feasibility (verify by EVAL / SPIKE — unprovable on paper)

| ID | Assumption | Status |
|---|---|---|
| AF-030 | Orchestrator routes to the correct agent from descriptions alone (the doc's claim that routing quality = description quality) | 🔴 |
| AF-031 | Memory writer produces clean semantic/episodic/procedural splits with sensible confidence | 🔴 |
| AF-032 | Prompt-injection defenses (regex + embedding similarity + boundary tags) actually hold — and don't over-quarantine legit content | 🔴 |
| AF-033 | Answer-mode classification (Cited/Inferred/Unknown) is accurate enough to trust | 🔴 |
| AF-034 | Slot-fill **Maturity** predicts "system is useful" for gating, **and** the Retrieval Sufficiency threshold cleanly separates `[Building]` from `[Unknown]` (ADR-002). Validate in AF-002 spike; if slot-fill doesn't predict retrieval adequacy, revisit the one-substrate coupling. | 🔴 |
<!-- AF-034 — ISSUE-030 (`app/maturity/`, Session 83, 2026-07-10) built the MAT signal-producers (Maturity math + the cold-start latch + Retrieval Sufficiency → `[Building]`) and shipped `done` CARRYING this EVAL open per ISSUE-030 §4/§9 (not a sign-off blocker). The `keywordSlotClassifier` (memory→slot mapping) is a deliberately thin v1 default (ADR-002 guardrail #1); whether it + the sufficiency threshold actually predict usefulness / cleanly separate the pill states is validated in the AF-002 real-embedding-corpus spike (the same corpus AF-002/ISSUE-025 need), not offline. Stays 🔴 until that EVAL runs. -->

| AF-035 | Two-model routing (Haiku for classification, Sonnet for reasoning) saves enough to matter **AND the cheap model is good enough** — i.e. Haiku's classification/gate decisions and Sonnet's routing don't lose quality. **Standing dual-track telemetry (not a one-off):** every routed call records model + task type + tokens/$ (**cost track**) and a correctness signal — gate false-drops, mis-routes, classifier errors (**quality track**) — so routing config is tuned with evidence. Cost win is worthless if quality silently degrades. | 🔴 |

## C. Cost feasibility (verify by measurement — AF-001 umbrella)

| ID | Assumption | Status |
|---|---|---|
| AF-040 | A real task's end-to-end cost (orchestrator + research + specialists + memory writes) is acceptable — sits under the ADR-003 viability target (≤ ~$20/day typical) | 🔴 — ↳ **AF-001 spike 2026-07-03** measured one real task at $0.0359 → $2.09/day extrapolated (strong positive signal); threshold-realism EVAL over more task types still owed before flipping. |
| AF-041 | The $50/day soft-alert + $100/day hard-ceiling defaults (ADR-003 cost ladder) are realistic for a working deployment | 🔴 — measured typical sits ~25× under the $50 soft alert (AF-001, 2026-07-03), so the defaults are not tight; their *realism as alert lines* is a separate threshold EVAL (unchanged). |
| AF-042 | The **token-derived cost estimate** (ADR-003) stays close to — and biased above — the real vendor invoice. The fail-safe round-up must keep drift conservative so the hard ceiling fires early, not late. Validate by reconciling estimate vs a real Anthropic/OpenAI bill. | 🔴 — ↳ **AF-001 spike 2026-07-03** recorded the estimate *basis*: `cost_tokens × price_table`, round-up (retries charged, non-batch rates, no cache discount) → biased above by construction. Reconciliation vs a real invoice still owed. |
| AF-043 | The **Haiku selective-writing gate** (ADR-003 §4/§6) filters enough events to pay for its own Haiku cost vs running the Sonnet writer unfiltered, **and is accurate enough to trust** (low operator disagree-rate). Validated by the **Haiku decision log + 3-week shadow-retain trust window** (ADR-003 §8) — manual review is the gate to autonomy. If it fails either bar, drop or retune it (controls-before-gates). | 🔴 — ↳ **AF-001 spike 2026-07-03** confirmed the write-path *shape*: survivor = 1 Sonnet + 3 Haiku + 1 embed, non-survivor = 0 Sonnet (gate cost $0.0001 « the $0.0022 Sonnet writer it displaces → gate pays for itself). Accuracy/disagree-rate (shadow-retain window) still owed. |

## D. Performance / scale feasibility (verify by LOAD)

| ID | Assumption | Status |
|---|---|---|
| AF-050 | Loops don't back up at ~20 concurrent client deployments | 🔴 |
| AF-051 | Vector search latency stays acceptable as memories grow | 🔴 |
| AF-052 | Consolidation/summarise jobs complete within Inngest comfortably at volume | 🔴 |

## E. Concurrency feasibility (ADR-004 — verify by SPIKE / LOAD / DOCS)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-061 | The **optimistic validate-and-commit closes the TOCTOU window** (ADR-004 §3): running the Sonnet writer unlocked, then a short locked transaction that re-checks a per-entity watermark and re-runs only the cheap DB contradiction check on change, actually catches same-entity races **without livelock or excessive re-runs**. The whole correctness claim rests on this — it is the core thing that can only be proven by testing. | SPIKE+EVAL | 🟡 |
| AF-062 | **Sorted per-entity Postgres advisory locks + short commit transactions don't bottleneck under fan-out at scale** (`L2115`, ~20 concurrent deployments), and multi-entity writes (locking 2–3 entities each, in sorted order) stay **deadlock-free** and contention-light. | LOAD | 🟡 |
| AF-063 | **Inngest per-key concurrency serializes same-entity steps** as ADR-004 §2 assumes — and if it doesn't, the design **degrades safely** to "advisory lock alone" (the lock, not the queue, is the correctness boundary). | DOCS+SPIKE | 🟢 |

<!-- AF-061/062/063 — ISSUE-024 (Session 83, 2026-07-10, `app/memory-write/`). **AF-063 🔴→🟢:** the design's
     fallback IS what was built — the Postgres advisory lock (not the Inngest queue) is the correctness boundary,
     and the advisory-lock-alone path is proven correct (unit interleavings: same-entity serialize + disjoint
     non-block, `commit.test.ts`; live-adapter smoke: `pg_advisory_xact_lock(hashtext(eid)::int8)` settable,
     `app/memory-write/results/live-smoke.sql`). So Inngest per-key concurrency is now an OPTIMISATION, not a
     correctness dependency — the AF's safe-degrade clause is realised. **AF-061 🔴→🟡:** the validate-and-commit
     MECHANISM is proven — the watermark re-check + `WHERE superseded_by IS NULL` CAS + `unique(idempotency_key)`
     together prevent lost-write/duplicate (any one alone suffices; `commit.test.ts` proves chain convergence
     `t←w1←w2` and idempotent no-op under concurrent same-entity writes) and the live SQL executes against the
     real schema (R10). What remains for GREEN: an at-scale EVAL that re-run counts stay bounded (no livelock)
     under real fan-out — needs a load harness, deferred. **AF-062 🔴→🟡:** **deadlock-freedom is proven by
     construction** (every txn acquires the sorted total order — `commit.test.ts` disjoint/serial cases + the smoke)
     — the LOAD half (no bottleneck at ~20 concurrent deployments) needs a real concurrent-deployment load run,
     deferred as an honest residual (not faked). The AC-2.WRT.006.* behaviours themselves PASS at the mechanism
     level (unit + live-adapter); AF-061/062 carry only the at-scale LOAD/EVAL confidence, exactly like AF-082's
     at-scale residual for ISSUE-022. -->


## F. Deploy / provisioning / version-skew feasibility (ADR-005 — verify by SPIKE / DOCS / EVAL)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-064 | **Railway supports the branch-based canary/release-train + promotion model** (ADR-005 §2): a canary deployment tracking a `release` branch, the fleet tracking `main`, promotion by fast-forward, and **build-history rollback** (§4). If Railway's branch/environment model differs, the *mechanism* changes but the *decision* (a canary gate before the fleet) stands. **→ DOCS-RESOLVED 2026-07-04 (`tool-integrations/railway.md`): ACHIEVABLE — branch-per-environment (`canary`←canary branch, `production`←`main`) + "Wait for CI" gate + Git-merge promotion; NO native promote primitive (→ OD-173). Build-history rollback = `deploymentRollback` (instant image re-serve), bounded by plan retention (Hobby 72h / Pro 120h); CLI can't do historical rollback (use API). Live SPIKE owed: "Wait for CI" scope (waits on ALL check suites) + `canRollback`.** **→ 🟢 LIVE-PROVEN 2026-07-05 (session 64, ISSUE-080 capstone, operator-present): canary env `023f250b` tracking `release` with Wait-for-CI ON. GREEN push (`84878f5`, CI-green) → canary auto-deployed it (`16e41e5d` RUNNING, `/version` reports the deployed SHA). RED push (`078b30c`, own service suite deliberately failing → CI failure) → Wait-for-CI BLOCKED the canary deploy: it held the prior good build for 2+ min and never rolled forward (the #3 guard proven live). Evidence `app/release/results/od-173-wait-for-ci-spike.2026-07-05.md`. Residual (honest limit, non-gating): only one check-suite producer exists in-repo, so the "waits on ALL suites" scope stays DOCS-backed — re-confirm if a third-party check suite is later added. `deploymentRollback` historical-rollback is DOCS-confirmed; rollback SAFETY = AF-065 🟢 (not re-exercised here, per §9).** | DOCS+SPIKE | 🟢 |
| AF-065 | **Expand-contract migrations keep a mixed-version fleet safe** (ADR-005 §3/§4): a `vN` and a `vN-1` deployment both run correctly against their own schema through a rollout, **and prior code runs against the newer schema** (the rollback premise). Parts 3 + 4 of ADR-005 rest entirely on this. **NOTE (2026-07-04): Railway's *build-history rollback mechanism* is DOCS-confirmed in `tool-integrations/railway.md` (under AF-064); AF-065's claim is expand-contract *migration* safety — a Postgres SPIKE unaffected by the Railway dossier. Unchanged.** **NOTE (2026-07-04, session 62 / ISSUE-008): 🟢 PASS (2026-07-04, session 62 / ISSUE-008 live capstone): on the live migrated silo (`nwufvzaamomajdyzemhx`, PG 17.6), an EXPAND (add nullable column) made the schema vN; the v1 reader stayed correct before AND after (rollback premise), the v1 writer still inserted against vN, the v2 path used the new column, and a fail-loud assert confirmed **0 data loss** (3 rows, all 1536-d, prior read unchanged) → then CONTRACT restored the baseline. Evidence `app/silo/results/{af-065-mixed-fleet-spike.sql, live-capstone-evidence.2026-07-04.md}`.** | SPIKE | 🟢 |
| AF-066 | **The synthetic canary corpus + smoke battery is representative enough** (ADR-005 §6/C2) to catch behavioral/data-dependent regressions (retrieval, memory contradiction, agent routing) before promotion — i.e. the canary is not a false sense of safety. Honest limit: it only catches what its fixtures + assertions cover. Shares the AF-001/AF-002 corpus. | EVAL | 🔴 |

## G. RLS / dynamic-roles feasibility (ADR-006 — verify by SPIKE / LOAD)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-067 | **Live data-driven RLS performs on the hot retrieval path** (ADR-006 §D3/Axis 3): a `STABLE SECURITY DEFINER` permission lookup keyed on `auth.uid()`, evaluated **once per statement** over the (tiny, fully-indexed) permission tables, composes with **pgvector** ranking of a large memory batch without unacceptable latency. The whole D3 "read permissions live, no token cache" choice rests on this. **Fallback if it fails at scale:** denormalise permissions into JWT claims (the rejected D2), accepting a staleness window — logged as OOS-012. **⚠️ Critical precision (from the Supabase Auth research, 2026-06-24, Block J/SA15): `STABLE` alone does NOT guarantee once-per-statement evaluation inside an RLS policy** — Postgres re-evaluates the helper **per row** unless the call is **wrapped in a scalar subquery** `(select helper())`, which forces an `initPlan` that caches per-statement (Supabase's own benchmark: **178,000ms → 12ms**). So the ADR-006 design-doc framing ("evaluated once per statement if STABLE") is half-right and must become a **binding implementation rule**: wrap every `auth.*`/helper call in `(select …)`, index every policy-referenced column, scope policies `TO authenticated`, and wire the `auth_rls_initplan` advisor lint (lint 0003) into CI. The spike still validates latency at scale, but the per-row cliff is now a known, avoidable footgun, not an open risk. Src: supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv; GitHub Discussion #14576. | SPIKE+LOAD | 🟢 **PASS 2026-07-04** (ISSUE-002, real Supabase — Postgres 17.6 / pgvector 0.8.2, 50k memories · 20 users · 6 roles). **initPlan overhead 1.06 ms/statement** (< 50 ms target), initPlan **loops = [1,1,0,1] → once per statement confirmed** (not per row); `auth_rls_initplan` lint (splinter 0003) **PASS** (every `auth.*`/helper call wrapped in `(select …)`, all policy columns indexed). **Cliff proven** on `count(*)` full scan: bare per-row policy **2.5× slower** than wrapped (modest ratio — helpers hit tiny indexed tables; direction + mechanism identical to the 178,000→12 benchmark). Clearance-filtered vector top-k **p95 0.899 ms** (< 2 s) on the HNSW index. **⚠️ Surfaced finding → AF-019/ISSUE-023 (not an AF-067 failure):** the RLS predicate makes the pgvector planner default to a full Seq Scan (**19.4 s**) instead of HNSW (**63 ms**) — a **308× cliff**; ISSUE-023 MUST force index usage under the clearance predicate or retrieval is non-viable. OOS-012 (JWT-cache fallback) NOT triggered. Harness + evidence (fields a–h): `spikes/issue-002-rls-latency/` → `results/af-067-evidence.2026-07-04.md`. |

## H. Prompt-injection / containment feasibility (ADR-007 — verify by SPIKE / red-team)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-068 | **The containment boundary holds end-to-end** (ADR-007 part 1): there is **no authorized-but-dangerous autonomous action path** by which injected instructions reach a consequential side effect — external communication, financial action, cross-client read, destructive write of a system of record, or memory poisoning — **without** passing a code-enforced hard limit / RBAC check / approval gate that **ignores prompt content**. Verified by red-teaming the harness with live injection payloads and confirming none escalate. This is the load-bearing claim of the whole posture; if a bypass path exists it must be **closed in code**, not patched with a detection rule. | SPIKE (red-team) | 🟢 **PASS 2026-07-04** (ISSUE-003, self-contained TS harness reproducing the ADR-007 seams — C5 step order · C6 sanitize/wrap/quarantine · seven hard limits + hard-approval floor · RBAC-RLS + physical isolation). Threat model = a **fully-compromised, maximally-obedient model** (assumes HL7 already happened at the reasoning layer; security never rests on the model refusing). Battery = **12 attacks + 4 negative controls**; **12/12 attacks contained** (no consequential side effect), **4/4 negative controls succeed** (human-approved send + same-client read + benign read + normal memory write all allowed — the gate is not a brick). **8 evasion payloads carried no injection literal → not quarantined → reached the model → still blocked by the code gate** ("contained, not caught" — ADR-007 part 1). `enforce()` takes **no prompt/content parameter** — structurally unswayable by injected text. Guardrail rows written loudly (hard_limit / prompt_injection / approval); **0** hard_limit rows approved (schema L506 check held); quarantine retained + human-routed, `human_decision=null`; `injection_semantic_detection_enabled=false` at boot (AC-NFR-SEC.006.3). **Mutation-tested** (an injected bypass flips the verdict ⛔ + exits non-zero — the battery has teeth). **Scope honesty:** proves the *design path* + yields the retained regression battery; the *shipped* enforcement code (ISSUE-055/059/020) is re-tested against this same battery pre-release; detection-signal quality is AF-117 (separate EVAL). Harness + evidence (fields a–h): `spikes/issue-003-injection-containment/` → `results/af-068-evidence.2026-07-04.md`. |

## I. Backup & disaster-recovery feasibility (ADR-008 — verify by SPIKE / DOCS / LOAD)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-069 | **A restore actually works end-to-end** (ADR-008 part 4): a recent backup — in-project PITR target *and* the off-platform `pg_dump` — restored into a throwaway project comes back **complete and queryable**, including **pgvector memory** and **`auth` user rows**, within acceptable downtime. Supabase makes **no backup-verification claim**, so "a backup exists" ≠ "a restore works" — the entire tested-restore guarantee (and thus non-negotiable #1) rests on this. Verified by a periodic restore rehearsal, logged. | SPIKE | 🟢 **PASS (Path B) 2026-07-04** (ISSUE-004, R8 you-present — real dump→restore into a throwaway Supabase project). **Off-platform `pg_dump`→`pg_restore` driven end-to-end:** **5000/5000 memories restored with embeddings intact** (0 null, 0 wrong-dimension; cosine `<=>` similarity query returns top-5) and **25/25 `auth.users` rows restored + resolvable**; **measured RTO 19.4 s** (AC-NFR-DR.005.1 — measured, not assumed). **Supabase-correct restore (learned in-run):** the target's `auth` schema is MANAGED (217 objects, owned by `supabase_auth_admin`) so a whole-DB `pg_restore --clean` fails ("must be owner") — the harness restores `public` (memories+embeddings) cleanly and loads only the `auth.users` ROWS data-only into the target's managed auth schema. **⚠️ Path A NOT exercised:** the in-project PITR/daily-backup restore was not run this session (operator-driven out-of-band step, skipped; also note Supabase in-project backups restore in-place, not into a throwaway) — recorded honestly as not-proven; **residual: confirm the in-project/PITR restore on the real production tier before go-live** (the off-platform path proven here is the load-bearing #1 guarantee against project loss). Harness + evidence (fields a–h): `spikes/issue-004-restore-rehearsal/` → `results/af-069-evidence.2026-07-04.md`. |
| AF-070 | **The Supabase Management API exposes the backup-health fields** the management-plane push needs (ADR-008 part 5): `GET /v1/projects/{ref}/database/backups` (+ project status) returns a **last-backup timestamp**, the **recovery tier (`pitr_enabled` / retention)**, and **project status (active / paused / billing-at-risk)** — enough to drive remote health monitoring **without** crossing any business data. Endpoint *existence* is DOCS-verified (2026-06-23); the **exact response payload is not** — confirm against the live API. If a field is missing, the monitor degrades to what *is* exposed + a coarser pause alert. | SPIKE | 🔴 |
| AF-071 | **Backup + off-platform region locality satisfies AU data residency** (ap-southeast-2 / Sydney). Supabase primary docs state backups live "in S3" but **do not pin the backup storage region** relative to the project, nor confirm cross-region behaviour — DOCS were **insufficient** (2026-06-23). Confirm via Supabase support / SLA before asserting any residency guarantee; the off-platform copy's region is operator-chosen and controllable. | DOCS (vendor confirmation) | 🔴 |
| AF-072 | **The hourly off-platform `pg_dump` completes within the hour — and restore time scales acceptably — for a large mature brain** (ADR-008 part 1/2/4). The portable off-platform copy is a scripted logical dump whose duration grows with the memory corpus; an **hourly** cadence is the *default RPO mechanism*, so this directly gates the default — confirm it fits the hour without hammering the DB, and that restore downtime stays acceptable at volume. **Fallback if it can't keep up:** back off the cadence (logged) or move that client to the **PITR upsell**. | LOAD | 🔴 |

## J. Supabase Auth platform feasibility (Component 0 research-first gate — verify by DOCS / SPIKE / EVAL)

Supabase Auth underpins all of Component 0 (Login). Per the research-first gate (`standards/tool-integration-research.md`)
and the AF-003 "vendor facts go stale" lesson, a **dated primary-source pass was run on 2026-06-24** (4 parallel agents,
supabase.com/docs + blog + changelog + github.com/supabase). Supabase is a *platform* dependency, so these live here, not
in `tool-integrations/` (that folder is for client-facing connectors). **C0 FRs must cite the corrected values below, not
the design doc.** The pass **refuted or corrected 6 design-doc claims** — exactly the hallucinations the gate exists to catch.

| ID | New must-test item raised | Method | Status |
|---|---|---|---|
| AF-073 | **HttpOnly cookie enforcement.** The design's "HTTP-only cookies, not localStorage (prevents XSS)" is **not** Supabase's documented default — `@supabase/ssr` stores session in cookies but docs say HttpOnly is *"not necessary"* and tokens are designed client-readable. Prove HttpOnly can be forced via `@supabase/ssr` cookie options **without** breaking client-side `getSession`/`getClaims`, or accept the non-HttpOnly default and mitigate XSS otherwise. | SPIKE | 🔴 |
| AF-074 | **Link-expiry 24h hard cap + invite/OTP coupling.** Confirm on hosted Supabase that the email OTP/invite/recovery expiry is **hard-capped at 86400 s (24 h)**, is a **global** project setting (not per-link), and that lowering the global slider also shortens invite links (vs a separate fixed invite TTL). This refutes the design's **72 h invite** and constrains the **24 h** setup link. | SPIKE+DOCS | 🔴 |
| AF-075 | **Microsoft Authenticator (and other RFC-6238 apps) enroll/verify against Supabase TOTP.** Supabase docs name Google Authenticator/Authy/1Password/Apple Keychain but **never name Microsoft Authenticator**; compatibility rests on the open `otpauth`/RFC-6238 standard, not a vendor statement. Verify by enrolling MS Authenticator against a live project if the client needs a named guarantee. | EVAL | 🔴 |
| AF-076 | **Org-wide end-user 2FA enforcement has no silent bypass.** There is **no project toggle** to require MFA for app end-users (the one that exists governs only Supabase *dashboard* team members). Enforcement must be **built**: restrictive RLS policies requiring `aal = 'aal2'` on **every** protected resource **plus** post-login app-layer gating that forces enrollment/challenge before granting access. Prove coverage is complete — one unprotected table = a silent aal1 bypass (non-negotiable #2 + #3). | SPIKE | 🟡 (**RLS half GREEN, session 76 / ISSUE-020**: the `user_aal()='aal2'` baseline clause is on every protected human-path GRANT policy, retrofitted onto the pre-existing ones, with a CI text-lint (`checkAal2Coverage`, create+alter aware) **and** a live migration tail assertion — both fail the build if any `authenticated` GRANT policy omits it. Live capstone: an aal1 session reads **0** protected rows. The **app-layer** enrollment/challenge gate that forces aal2 at login is still owed to **C0 / ISSUE-014** — until it ships, AF-076 is not fully 🟢.) |
| AF-077 | **Login brute-force / credential-stuffing posture.** Supabase provides **no per-account lockout or login backoff**; the password sign-in grant has **no separately documented numeric rate limit** (shares the `/token` path's 1800/hr IP limit). Platform defenses = Cloudflare + fail2ban + IP limits + CAPTCHA (hCaptcha/Turnstile) + leaked-password protection (Pro+). If the spec requires per-account lockout, it is an **app-layer** responsibility to build. | SPIKE | 🟢 **PASS 2026-07-04** (ISSUE-005, R8 you-present — live throwaway Supabase Auth project, plan **pro**, CAPTCHA **Cloudflare Turnstile** ON + **observed live**, leaked-password ON/enforceable). Scripted single-account **and** simulated multi-IP credential-stuffing **both halted before any session minted** — the app-layer per-account soft-lock trips at threshold **5** and holds (attempt 6 blocked before reaching Supabase), proving the defense IP-independent (survives the multi-IP case that defeats the per-IP caps). 2FA challenge soft-locks at wrong-code **6** (`mfa_softlock_threshold`=5) and refuses even a genuinely-correct code once locked; **AAL2 never reached**; every attempt logged, **2 Super-Admin alerts** fired. **CAPTCHA observed live** = Turnstile genuinely rejected the scripted logins (not merely config-flagged). Confirmed build values for ISSUE-014: `account_lockout_threshold`=5 · `account_lockout_minutes`=15 · `mfa_softlock_threshold`=5 · CAPTCHA+leaked on. **Caveat:** multi-IP was **simulated** (no proxies supplied; the per-account soft-lock proof is IP-independent, so a real-proxy run would strengthen but not change the verdict). Harness + evidence (fields a–h): `spikes/issue-005-brute-force-defense/` → `results/af-077-evidence.2026-07-04.md`. |

### Block J findings (2026-06-24) — corrected values + sources (cite these in C0, not the design doc)

Verdict key: ✅ VERIFIED · 🟠 STALE · ⛔ REFUTED · ⬜ UNCONFIRMED (not stated in primary docs).
> **Doc-date caveat:** Supabase docs pages carry **no visible last-updated date** — facts are stamped to fetch date **2026-06-24**; the dated anchors are the JWT-signing-keys blog (2025-07-14) and the passkeys changelog (2026-05-28). Set **`Re-verify by 2026-12-24`** (Supabase Auth moves fast: asymmetric-keys + API-key-format migrations both have live deadlines into late 2026).

- **SA1 · Session = JWT + rotating refresh token — ✅.** Access token = JWT; refresh token = opaque single-use string.
- **SA2 · Access token TTL 1 h — ✅.** Default 1 h, configurable ("JWT expiry limit"); rec floor 5 min, >1 h discouraged.
- **SA3 · Refresh token "7-day TTL" — ⛔ REFUTED.** Refresh tokens **never expire**; they **rotate single-use** with a **10 s reuse interval** and **reuse-detection that revokes the whole session** on suspicious reuse. Session lifetime is instead bounded by optional **time-box** + **inactivity-timeout** settings (**Pro+ plan, no default, enforced lazily at next refresh**, not proactively). ⇒ the design's `auth.session_refresh_days: 7` **maps to no native setting** — C0 must re-model session bounds (→ component-0 OD). The harness must persist the new refresh token on every rotation and handle reuse-detection → full-session-revocation as a failure mode.
- **SA4 · HTTP-only cookies, not localStorage — 🟠 STALE/REFUTED as default.** `@supabase/ssr` uses cookies but HttpOnly is *"not necessary"* per docs; tokens are meant to be client-readable. → **AF-073**.
- **SA5 · "Server-side session continues mid-task after client JWT expires" — ⛔ REFUTED (wrong mechanism).** No distinct server-side-session object exists. Real options: (a) `@supabase/ssr` middleware **refreshes** the JWT server-side, or (b) background work runs as **service_role** (bypasses RLS, **no `auth.uid()`**). C0 must pick one explicitly (→ component-0 OD); the two have very different security postures (#2).
- **SA6 · `auth.uid()` per-request-stable — ✅.** From JWT `sub`; returns `null` when unauthenticated (policies must not silently pass on null — #3).
- **SA7 · 2FA = TOTP + QR — ✅.** GA, **enabled by default** on all projects, 30 s interval, ±1 interval skew tolerance. Phone (SMS/WhatsApp) factor exists but opt-in (SIM-swap warning); Passkeys/WebAuthn beta (2026-05-28) is positioned as **primary** auth, **not** a 2FA factor — do **not** spec it as 2FA yet.
- **SA8 · Compatible w/ Google + Microsoft Authenticator — ✅ via open standard / ⬜ MS unnamed.** Docs name Google Authenticator/Authy/1Password/Apple Keychain; **Microsoft Authenticator is not named**. → **AF-075**.
- **SA9 · "2FA required" is a deployment config — ⛔ REFUTED for end-users.** No project-wide end-user MFA toggle; enforce via restrictive `aal2` RLS + app gating. → the design's `auth.two_factor_required` must be **built**, not flipped. → **AF-076**.
- **SA10 · Google + Microsoft/Azure as login IdP — ✅.** Azure provider slug `azure`; **pin the tenant** (single-tenant URL for org-only login), **require the `email` scope**, enable the **`xms_edov`** claim to reject unverified-email domains (#2).
- **SA11 · Invite link 72 h — ⛔ REFUTED.** OTP/invite/recovery link expiry is **hard-capped at 86400 s = 24 h**, a **global** project setting (not per-link); Supabase recommends ≤1 h and its advisor flags >1 h. ⇒ 72 h is impossible natively — C0 must either re-spec to ≤24 h or **build a custom invite-token layer** (own table + token + expiry + delivery). → **AF-074** + component-0 OD.
- **SA12 · Super Admin setup link 24 h — achievable with caveats.** Only by setting the global OTP expiry to 86400 s (which stretches **all** magic/recovery links to 24 h and trips the ≤1 h advisor) **or** a custom token. Seed = admin `createUser` (no password, no email sent) + `generateLink` (you deliver) or custom token.
- **SA13 · Invite-only (no self-register) — ✅.** "Allow new users to sign up" toggle off; admin API (`createUser`/`inviteUserByEmail`/`generateLink`) **bypasses** the public toggle (that's *why* invite-only works); optional **Before User Created Hook** for domain allowlists.
- **SA14 · Email delivery — ⚠️ production constraint.** Built-in auth email = **2/hour** (demo only); production **requires custom SMTP** (default **30 new-user emails/hr**, raisable). A throttled invite looks like nothing happened (#3) — C0/Phase-5 must mandate custom SMTP.
- **SA15 · RLS on every query + service_role bypass — ✅, with precision.** RLS = implicit WHERE on every query; **service_role bypasses RLS**, but only when connecting **as `service_role` with no end-user JWT attached** (a user JWT + service key → the user's RLS still applies). **Performance:** see the sharpened **AF-067** — `STABLE` alone ≠ once-per-statement; must wrap helper calls in `(select …)` to force the initPlan (178,000ms→12ms), index policy columns, scope `TO authenticated`, wire the `auth_rls_initplan` lint.
- **SA16 · Auth endpoint rate limits — ✅ documented (config-driven).** verify 360/hr (burst 30, per IP, fixed); token/refresh 1800/hr; MFA 15/hr; built-in email 2/hr; send-OTP 30/hr (configurable). **No per-account lockout; no separate password-grant limit.** → **AF-077**.
- **SA17 · Asymmetric JWT signing keys — ✅ (architecture-relevant change).** New projects default to **RS256/ES256 since 2025-10-01**; backends verify JWTs **locally via JWKS** (`/auth/v1/.well-known/jwks.json`, `getClaims()`) with **no Auth-server round-trip** — but use `getUser()` where authoritative revocation/logout state matters (`getClaims()` won't see server-side logout). API-key rename: `anon`→`sb_publishable_…`, `service_role`→`sb_secret_…` (legacy keys migrate by **late 2026**). C0 token-verification + secrets-custody FRs must reflect this.

**Outputs filed:** AF-073–077 (above); AF-067 sharpened (initPlan `(select …)` rule). **Forks to become component-0 ODs** when C0 is drafted: session-lifetime model (SA3), mid-task continuation mechanism (SA5), invite-expiry approach 24h-vs-custom-token (SA11/12), HttpOnly requirement (SA4). **Glossary terms to add when first used in a C0 FR:** AAL (aal1/aal2), refresh-token rotation/reuse-detection, asymmetric JWT / JWKS local verification, custom invite-token layer. **Connector FRs this unblocks:** C0 login/session/2FA/invite/seed/webhook-auth FRs (cite Block J).

## K. Component 0 (Login) implementation feasibility (verify by SPIKE)

| ID | Must-test item | Method | Status |
|---|---|---|---|
| AF-078 | **End-to-end inbound webhook verification across GHL / Google / Slack actually rejects forged & replayed events.** The three verifiers (FR-0.WHK.002/003/004) each depend on getting the mechanics exactly right: capturing the **raw body before JSON parsing** (parsing re-serialises and invalidates the signature), **constant-time** comparison (`crypto.timingSafeEqual`, never `===`), correct base-string construction (Slack `v0:[ts]:[body]`), JWKS/audience/expiry checks (Google), and replay rejection (Slack 5-min window + the GHL/Google nonce cache from OD-022). One framework that buffers/parses the body before the verifier sees it silently breaks all three. Prove with a test battery of valid, tampered, and replayed payloads per connector. Load-bearing for non-negotiable #2 (an unverified webhook is the trust-boundary entry point per ADR-007). | SPIKE | 🟡 **MECHANICS PASS 2026-07-04** (ISSUE-006, MODE M self-contained harness — **17/17** cases). The per-connector verifiers **reject forged / tampered / replayed / stale** webhooks and **accept valid** ones; the load-bearing **raw-body-before-parse** trap is proven (a deliberate parse-then-verify variant provably fails the same signature — AC-0.WHK.005.1), and **constant-time** compare (`crypto.timingSafeEqual`) + replay defense (Slack 5-min window · GHL/Google seen-ID cache) hold. **Slack** fully proven (symmetric HMAC — the mechanics ARE the real proof, no asymmetric vendor gap); **Google** OIDC mechanics (JWKS / audience / expiry) proven; **GHL** signing input **DOCS-resolved → AF-090** (raw-body-only Ed25519 + published public key). **Live per-connector confirmation deferred (OD-172):** re-gated from launch-blocking to per-connector **ONBOARDING** — proven on ISSUE-017 / 039 / 040 / 041 before each connector goes live (operator has no GHL account; connectors client-driven). For Checkpoint-0 / go-no-go the proven mechanics + AF-090 DOCS satisfy AF-078; the live checks are **tracked residuals** (#3), not silent. Harness + evidence: `spikes/issue-006-webhook-forgery/` (README + MODE-M battery). |

---

## L. Component 1 (RBAC) implementation feasibility

| ID | Must-test item | Method | Status |
|---|---|---|---|
| AF-079 | **RLS coverage is complete — no application table ships without RLS enabled + a policy.** The DB backstop (L719, ADR-006 part 5) only holds if it is *universal*: a single table created without `ENABLE ROW LEVEL SECURITY` + a policy is a silent hole an authenticated user can read directly. Prove with a CI/lint gate that fails the build if any table in the public schema lacks RLS + ≥1 policy (analogous to AF-076 for the `aal2` clause, but for the base default-deny policy). Load-bearing for #2/#3 (a silent un-guarded table). | SPIKE / CI-lint | 🟢 **PASS 2026-07-05** (ISSUE-009): the coverage gate is built as an offline text lint (`app/silo/src/rls-lint.ts` `checkCoverage`, wired into `npm run check`) **and** a live catalog assertion (`assertRlsCoverageLive` / `lint:rls` + the 0002 tail assertion), **unit-proven to fail the build when a table is created without a policy**. Green live on the silo (44 app tables + `_migrations`, all RLS-enabled + ≥1 policy). It caught a real gap on first live run — the runner's own `_migrations` table had RLS but no policy — fixed at source (no carve-out). Evidence `app/silo/results/issue-009-rls-capstone-evidence.2026-07-05.md`. |
| AF-080 | **The harness `can()` check and the RLS helper functions, both reading the same permission tables, cannot disagree on the visibility/sensitivity/Restricted subset — and any runtime divergence is observable.** ADR-006 part 5's "single source of truth → cannot drift" claim rests on both readers deriving identically from the same rows. A subtle divergence (e.g. the harness applies entity-type scope but a helper forgets it, or `NULL`-scope semantics differ) would let one layer allow what the other denies — a leak or a false denial. Prove with (a) a build-time **differential test**: for a matrix of (user, node, entity, tier) cases, assert `can()` and the RLS result agree; **and (b)** a **runtime divergence signal** (FR-1.RLS.008) — when RLS zero-rows a read the harness believed permitted, it is logged/alerted, not silently returned as "no data" (#3). | EVAL / differential-test + runtime signal | 🟢 (part **a** GREEN, session 68: the build-time differential now compares two *independent* readers — `effectiveNodes` via `userRoleId`+`roleNodes` vs `rlsHelperPerms` re-joining the raw tables — + a deactivated-assignment teeth case, and a LIVE capstone confirmed `user_perms(uid)` returns exactly the seeded `role_permissions` set `can()` reads [ISSUE-018 `app/rbac`]. Part **b** the *runtime* divergence signal FR-1.RLS.008 is **built, session 76 / ISSUE-020**: `app/rls-enforcement/divergence.ts` — a harness-permitted read that RLS returns as zero rows emits an `rls_harness_divergence` `event_log` event (never a silent empty result); unit-proven AC-1.RLS.008.1 + the live capstone confirms the enum accepts the value. Both parts now GREEN → AF-080 🟢.) |
| AF-081 | **Agent-path (`service_role`) Personal/Restricted access audit is complete.** FR-1.RLS.004 puts the agent path **off** RLS by design, so the audit record for every agent read/write/injection of Personal/Restricted content (FR-1.AUD.001) rests **entirely on harness discipline** — there is no DB backstop catching a missed log, unlike the human path. A single un-instrumented agent access path is a permanent silent gap (#3) and a knowledge-provenance hole (#1). Prove with the same shape as AF-076/079: an audit-coverage check over every agent access path to sensitive content (instrument-or-fail), exercised by a test battery. | SPIKE / EVAL | 🔴 |

---

## M. Component 2 (Memory) implementation feasibility

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-082 | **Entity resolution is accurate enough that the brain does not fragment into duplicate entities at scale.** FR-2.ENT.005 resolves a mention to an existing entity by `external_refs`-first then a deterministic name/type match, creating a new entity only on no confident match. If resolution is too loose it **merges distinct entities** (two clients collapsed → cross-contaminated knowledge, a #2 leak); too strict it **fragments one entity into duplicates** (knowledge about one client split across rows → every retrieval silently sees half of it, a #1 integrity loss). The structural-erosion duplicate-cluster check (FR-2.MNT.010) is only a backstop. Prove with an **EVAL** over realistic mention data (mixed system-ID-bearing and free-text references, name collisions, aliases): measure false-merge and false-split rates against a ground-truth entity set, and validate that the ambiguity-flag threshold (OD-033) catches the hard cases for human confirm rather than guessing. Shares the AF-002 retrieval corpus. | EVAL | 🟡 |
<!-- AF-082 status note (ISSUE-022, session 75, 2026-07-08): 🔴→🟡 SEED-EVAL PROVEN. The deterministic resolver
(app/memory/src/resolution.ts) was run through a hand-built ground-truth mention set (app/memory/src/eval-af082.test.ts:
system-ID-bearing + free-text, name collisions, aliases, cross-type same-name) — result: **false-merge=0** (the #2
hazard the resolver must never do — it never silently picks a wrong entity), **every ambiguous mention flagged** (never
silently resolved, AC-2.ENT.005.2), false-split=0 on the seed set. The mechanics + risk posture (conservative
split-not-merge, external_refs-first, ambiguity-flag) are Verified. STILL PENDING (onboarding fast-follow, per
NFR-PERF.004 launch-gate = fast-follow behind the FR-2.MNT.010 duplicate-cluster backstop): the full at-scale EVAL over
the realistic AF-002 retrieval corpus. Does not block go-live. -->


> **Note:** C2 also *relies on* existing AFs rather than creating new ones for them — **AF-002** (retrieval relevance/ranking), **AF-019** (HNSW recall **with RLS predicates applied** — the pgvector-after-ANN-scan cliff that C2's `ef_search` tuning must survive), **AF-031** (writer type-split + confidence quality), **AF-034** (Maturity predicts usefulness; Sufficiency cleanly separates `[Building]`/`[Unknown]`), **AF-043** (the Filter-1 Haiku gate pays for itself + is trustworthy; OD-036's trust window is its measurement vehicle), **AF-061/062/063** (validate-and-commit), and **AF-067** (live clearance predicate composes with pgvector on the hot path). These are tagged at their points of use in `component-02-memory.md` but already live in blocks B/E/G above.

---

## N. Component 3 (Tool Layer / connectors) implementation feasibility

> Filed from the session-19 research dossiers (`tool-integrations/{slack,gohighlevel,google-gmail}.md`,
> verified 2026-06-25). Vendor facts are DOCS-verified **in the dossiers**; the AF items below are the
> claims that still need *testing* (SPIKE/EVAL/LOAD) or a non-primary-source follow-up (DOCS) before
> build / go-live. Each is tagged at its point of use in `component-03-tool-layer.md` + its dossier.

### Slack (dossier `slack.md`)

| ID | Must-test item | Method | Status |
|---|---|---|---|
| AF-083 | **The OD-011 exemption holds for our exact setup** — a per-client *internal customer-built* Slack app actually receives Tier 3 (50+/min, `limit`=1,000) on `conversations.history`/`.replies` on a **live** workspace. DOCS-verified (two independent reads) but unproven for our config; **gates locking OD-011** + marking the Slack history-ingest FRs `Ready`. | EVAL | 🔴 |
| AF-084 | **Events API silent-failure surface** — the connector stays under Slack's 95%-fail/60-min auto-disable threshold, and gap-reconciliation via `conversations.history` recovers events dropped during `app_rate_limited`/disable windows (no silent event loss, #3). | LOAD / EVAL | 🔴 |
| AF-085 | **`chat.postMessage` has no idempotency key** — verify the app-side write-dedup design (track app-side key / returned `ts`) prevents double-posting on retry-after-timeout (OD-010 exposure). | SPIKE | 🔴 |
| AF-086 | **Rate-limit introspection** — whether any Web-API headers beyond `Retry-After` expose quota-remaining; if not, backoff relies on `Retry-After` only. | SPIKE | 🔴 |
| AF-087 | **Slack has no per-call charge** — docs state no fee but never positively "free"; confirm via Terms/pricing before the ADR-003 cost model treats Slack as $0. | DOCS | 🔴 |
| AF-088 | **Prompt-injection mitigation for ingested untrusted Slack text** flowing into the memory/LLM system (ADR-007 containment; #2). | SECURITY / SPIKE | 🔴 |

### GoHighLevel (dossier `gohighlevel.md`)

| ID | Must-test item | Method | Status |
|---|---|---|---|
| AF-089 | **Refresh-token rotation persistence/race (#1, load-bearing).** GHL refresh tokens are single-use/rotating; the harness must persist the new refresh token **atomically on every refresh** or silently lose access. Prove the persist-on-refresh + single-flight design survives concurrent refreshes (the 30 s same-token grace helps but isn't a guarantee). | SPIKE / LOAD | 🔴 |
| AF-090 | **Webhook Ed25519 signing input (#2).** Confirm exactly which bytes GHL signs (raw body? body+timestamp?) against the published public key, on a live payload, before implementing `X-GHL-Signature` verification. (Old GHL-091 folded here.) | SPIKE | 🟡 **DOCS-CONFIRMED 2026-07-04** (ISSUE-006 research pass, GHL primary developer docs). **GHL signs the RAW BODY ONLY** (no timestamp/header concatenation) with **Ed25519**, header `X-GHL-Signature`; legacy `X-WH-Signature` (RSA) deprecates 2026-07-01. **Published Ed25519 public key (SPKI PEM):** `MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=`. Src: `marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide` (fetched 2026-07-04). **Residual (empirical):** confirm a real GHL-signed webhook verifies against this key on a live captured payload — owed at **GHL onboarding** (operator has no GHL account; the connector is client-driven), per **OD-172**, on ISSUE-017/039 before the GHL connector ships. |
| AF-091 | **OAuth endpoint surface** — confirm the exact authorize/`chooselocation` URL + required query params + the (undated) "Smarter Refresh Token Handling" changelog facts. | DOCS | 🔴 |
| AF-092 | **Token invalidation triggers + caps** — token invalidation on app uninstall and on scope change, and whether any per-account token-count cap exists (none documented). | SPIKE | 🔴 |
| AF-093 | **Outbound 429 shape** — response body shape + whether `Retry-After` is returned on *outbound* API 429s (docs only cover inbound webhook retries); backoff must not assume `Retry-After`. | SPIKE / EVAL | 🔴 |
| AF-094 | **v3 search pagination + incremental** — exact `searchAfter` vs `page`/`pageLimit` params, max page size, and a reliable `dateUpdated` filter + stable sort for incremental pulls (not confirmable from JS-rendered docs). Delta-vs-full-rescan strategy depends on it. | SPIKE | 🔴 |
| AF-095 | **No write idempotency (#1)** — confirm there is no `Idempotency-Key` support on writes (send the header on a create, observe); substitute is `/contacts/upsert` + app-side dedup. | DOCS / SPIKE | 🔴 |
| AF-096 | **Message webhook event strings + replay** — exact inbound/outbound message webhook event-name strings and any replay-protection window beyond `timestamp`. | DOCS / SPIKE | 🔴 |
| AF-097 | **Webhook retry-policy conflict (#3)** — GHL's own docs contradict (Integration Guide: 12 retries/any-non-2xx; help article: 6 retries/429-only/no 5xx retry). If 5xx truly gets no retry, a transient outage silently drops events. Mitigation regardless: durably queue → 2xx on receipt (OD-042). | DOCS / SPIKE | 🔴 |
| AF-098 | **PHI/BAA chain (#2, legal gate).** GHL data can carry PHI; GHL's BAA is HighLevel↔Agency. Docs are silent on whether a third-party app that *egresses* PHI is covered or must hold its own BAA with the client. **Must resolve before ingesting any HIPAA-enabled location's data** — ingesting PHI without a BAA chain is a compliance violation. | LEGAL / DOCS | 🔴 |
| AF-099 | **Conversations-API send draws the wallet** — confirm a v2 API send debits the same LC Phone/Email wallet as UI/workflow sends (implied, unverified) — send one SMS on a test sub-account, observe the debit. | SPIKE | 🔴 |
| AF-100 | **`POST /contacts/` create-on-duplicate error shape** — uncertain (mitigated by preferring `/contacts/upsert`). | SPIKE | 🔴 |

### Google — Gmail / Drive / Calendar (dossier `google-gmail.md`)

| ID | Must-test item | Method | Status |
|---|---|---|---|
| AF-101 | **Drive & Calendar exact quota numbers** — per-minute/per-method models verified; exact current numbers unconfirmed verbatim, and whether the 2026-05-01 project-age split applies to Drive/Calendar is open. | DOCS | 🔴 |
| AF-102 | **Calendar `events.insert` 409-duplicate idempotency** — Google states ID-collision detection is "not guaranteed at event creation time" in the distributed system; rapid-retry test before treating ADR-004 idempotency as airtight for Calendar. | EVAL | 🔴 |
| AF-103 | **Workspace API overage billing** — "free today" is true-but-expiring (overage billing planned "later in 2026," ≥90 days' notice; rates/date TBD). Time-boxed; re-verify before go-live. | DOCS | 🔴 |
| AF-104 | **Backoff "with jitter" cite** — jitter is *our* addition; Workspace error pages mandate exponential backoff, not jitter. Find a primary cite or own it as a design choice. | DOCS | 🔴 |
| AF-105 | **Deprecation-notice window** — no explicit Workspace deprecation-notice window found in primary docs; locate the exact commitment before citing a notice period in an ADR. | DOCS | 🔴 |
| AF-106 | **Refresh-token non-rotation** — Google does NOT rotate refresh tokens on a normal refresh (opposite of GHL); confirmed only indirectly via `prompt=consent` language. Refresh twice; confirm the same token is retained. | SPIKE | 🔴 |
| AF-107 | **Unused OAuth *client* deletion** — policy eff. 2025-10-27: Google may delete OAuth clients idle ≥6 months (distinct from token inactivity — a long-idle integration can lose the whole client, #1/#3). Keep clients active; alert on long idle. | DOCS / monitor | 🔴 |
| AF-108 | **Drive `changes` page-token expiry/error** — undocumented; needed for full-resync fallback parity with Gmail 404 / Calendar 410. | DOCS / SPIKE | 🔴 |
| AF-109 | **Gmail Pub/Sub OIDC push-token validation** end-to-end (cert source, `aud`/`email` claim checks, clock skew) — provable only by standing up an authenticated push subscription. | SPIKE | 🔴 |
| AF-110 | **2025 dated policy changes verbatim** — quote the 2025-10-27 (unused-client deletion) + 2025-12-15 changelog text not fully fetched this pass. | DOCS | 🔴 |

> **Note:** C3 also relies on existing items — **AF-013/014** (Google/GHL OAuth, now superseded by the
> dossiers as the citable source), **AF-019** (HNSW under RLS for the ingested-memory path), and **OD-010**
> (compensation/rollback — every external-write ACT tool is an exposure point). The AF-003 corrected
> vendor values (F1–F6) are now carried by the three dossiers.

---

## Block O — Component-4 (Prompt Architecture), 2026-06-26

**AF-111 — Prompt-version → outcome attribution is signal, not noise (EVAL, build-time).** Two coupled
claims the design leans on but cannot prove on paper: (1) "prompt versioning **with performance tracking** —
track which version produced better outcomes" (L2485) assumes task outcomes can be attributed to the prompt
version in force cleanly enough to *discriminate* a better version from a worse one; at launch task volume
(≤20 users), per-version sample sizes may be too small to separate signal from variance. (2) "compressed,
audited prompts **outperform** organic ones" (L2489, L3634) is an empirical performance claim, not a
structural fact. **Method:** EVAL — once a deployment has real task history, measure whether version-bucketed
outcome deltas exceed noise, and whether compression measurably improves task success/cost. **Relied on by:**
FR-4.OPT.001 (version performance tracking), FR-4.OPT.003 (compression discipline). **Not a blocker to
speccing C4** — the version identity + pin (FR-4.OPT.001/STO.006) are built regardless; this gates only the
*claim that the feedback loop produces usable signal*. Pairs with the C7 observability signals (L3578,
L3589–3591) and the AF-001 cost spike. Next AF number: **AF-112**.

---

## Block P — Component-5 (Agent Harness), 2026-06-26

**AF-112 — Loop catch-up + idempotency under missed-run backlog (LOAD/EVAL, build-time).** The design promises
"a missed run triggers automatic catch-up" with loops running independently (L2575), and idempotency keys
"per task and per step" (L2581) to make retries safe. The unproven claim is that **a missed/overlapping/late
catch-up loop run does not duplicate writes or double-act** at real scale — i.e. the idempotency keys fully
cover the catch-up and self-overlap paths, not just the simple per-step retry. **Method:** LOAD/EVAL — force
missed runs + overruns on a live loop against a populated queue and assert no duplicate side effects or
double-processed items. **Relied on by:** FR-5.LOP.004 (catch-up/overlap), FR-5.GRP.003 (idempotency keys).
**Resolution dep:** OD-057. Pairs with AF-018 (Inngest idempotency, verified) + AF-063 (per-key concurrency).

**AF-113 — Parallel-step DAG correctness + approval ordering (SPIKE/LOAD, build-time).** Parallel execution of
independent steps (L2614) must (1) honour the dependency DAG with **no race on `shared_context` /
`previous_outputs`** when siblings write concurrently, and (2) never let a parallel step fire an **irreversible
side effect ahead of a pending approval** it should logically follow (#2). **Method:** SPIKE/LOAD — run a
graph with concurrent siblings + a gated step; assert deterministic envelope state and that no irreversible
write precedes the gate. **Relied on by:** FR-5.OPT.001. **Resolution dep:** OD-056 (if the ordering can't be
made reliable, fall back to all-or-nothing gating).

> **Status 🟡 — OFFLINE-GREEN for small graphs; live-LOAD residual OUTSTANDING (ISSUE-054, Session 83, 2026-07-10).**
> `app/execution-optimisation/src/simulate.ts` + `simulate.test.ts` prove the three load-bearing properties by an
> EXHAUSTIVE deterministic-interleaving simulation over small DAGs (1–3 concurrent disjoint-key steps): (1) the
> scheduler honours the dependency DAG (a step never runs before its deps); (2) concurrent siblings never race on
> `shared_context` / `previous_outputs` (disjoint-key writes only; a shared-key write serialises); (3) no
> irreversible side effect fires ahead of a pending approval it should follow (OD-056 step-level semantics —
> an approval-gated step blocks itself + dependents; independent reversible siblings proceed). What CANNOT be
> proven offline: the SAME properties **under real Inngest fan-out + concurrency at scale** (the LOAD half). That
> is a SPIKE/LOAD residual **gating live enablement of `parallel_execution_enabled`** — the flag ships **OFF by
> default** (opt-in), so the deployment default runs the already-proven plain-sequential path (#2); the flag must
> not be flipped on for a live deployment until the real-Inngest LOAD run is GREEN. Honest residual, not faked.

**AF-114 — Inter-step compression fidelity (EVAL, build-time).** Compressing earlier step outputs into
summaries between steps (L2608) must not silently drop **task-critical state a later step needs** — the chain
must produce the same outcome compressed as uncompressed. **Method:** EVAL — run representative long chains
with and without compression; assert equivalent final outputs and that resume-from-failure still works from the
(retained) originals. **Relied on by:** FR-5.ENV.003. **Resolution dep:** OD-055 (retention of originals is the
safety net regardless).

**AF-115 — Originals-store retention outlives task chains + audit window (DOCS/SPIKE, build-time).** OD-055's
"lossless source" guarantee retains the full uncompressed step outputs in "the durable step record (Inngest
step state / task history)" (FR-5.ENV.003), and FR-5.JOB.007 pins v1 to Inngest **cloud**. The unproven
assumption: **managed Inngest cloud step-state retention may have its own TTL** shorter than the longest task
chain + the audit/compliance window — if so, the retained originals silently evaporate and the economy measure
becomes #1 knowledge loss. **Method:** DOCS (confirm Inngest cloud step-output retention) → if insufficient,
SPIKE the C5-owned durable task-history store as the authoritative originals store (engine state = cache only).
**Relied on by:** FR-5.ENV.003, FR-5.GRP.004 (resume reads originals), FR-5.JOB.007. **Surfaced by:** C5
verification gate (M4). Next AF number: **AF-116**.

---

## Block Q — Component-6 (Guardrails), 2026-06-26

**AF-116 — Behavioral anomaly-detection accuracy (EVAL, build-time).** FR-6.ANM.002 specs five anomaly checks;
three of them — **volume** ("unusually high number of actions"), **scope** ("expanded significantly beyond the
trigger"), and **sentiment** ("unusually negative or urgent") — rest on judgments with no DOCS-provable
threshold. The unproven assumption: the checks fire on real anomalies without a false-positive rate that buries
reviewers (alert fatigue → #3 in practice) or a false-negative rate that misses the runaway they exist to catch
(#2). **Method:** EVAL — measure per-anomaly precision/recall against a labelled set on a runnable deployment;
tune the FR-6.ANM.004 thresholds + the FR-6.ANM.005 baselines. **Relied on by:** FR-6.ANM.002/003/004/005. Does
**not** hold an FR from Approved-on-paper (the machinery is sound); it gates the *accuracy claim*. **Surfaced
by:** C6 drafting.

**AF-117 — Injection known-pattern library coverage (EVAL, build-time).** FR-6.INJ.002 lists ~10 literal regex
patterns and FR-6.INJ.003's semantic scan compares to "a library of known injection embeddings." The unproven
assumption: the pattern/embedding library has **enough coverage** to catch real-world injections (and a tractable
update/versioning process, AC-6.INJ.002.2) without so many false positives that legitimate tool content is
constantly quarantined. Pairs with **AF-068** (the containment red-team is the *enforcement* proof; AF-117 is the
*detection-signal-quality* proof — and per ADR-007 detection is only a signal, so a library gap degrades the
signal, it does not breach containment). **Method:** EVAL — run the AF-068 red-team payloads + a benign corpus
through the pipeline; measure detect/quarantine precision-recall. **Relied on by:** FR-6.INJ.002/003/005/006.
Gates the *detection-quality claim*, not the FR machinery. **Surfaced by:** C6 drafting.

---

## Block R — Component 7 (Observability) — AF-118…AF-120, AF-139

**AF-118 — Absence-of-signal detection is only as live as its evaluator (SPIKE, build-time).** C7 leans hard on
"absence of signal is itself a signal" — the management-plane staleness check (AC-7.MGM.002.3) and the alert-engine
watchdog (FR-7.ALR.008). The unproven assumption: the **independent heartbeat evaluator / watchdog cannot itself
silently stall** (if it does, every card stays last-known-green and every alert silently stops — the meta-#3 the
whole component exists to prevent). **Method:** SPIKE — build the heartbeat + watchdog, fault-inject (kill the
evaluator, the reporter, the silo DB) and confirm each failure surfaces out-of-band. **Relied on by:** FR-7.ALR.008,
FR-7.MGM.001/002. Does **not** hold an FR from Approved-on-paper; it gates the *liveness claim* of the silent-failure
detectors. **Surfaced by:** C7 verification gate (finding F2/F7). **→ 🟢 PASS 2026-07-05 (session 66, ISSUE-011):** fault-injection proved the silent-failure detector flags a terminal `task_queue` status with no terminal `event_log` row, and the alert-engine watchdog is **independent** of the engine — a stalled, never-started, AND self-stalled watchdog each surface (the meta-#3 addressed via `watchdogSelfStalled()` + an out-of-band health-bit latch). Independently re-verified (SAFE). Residual: the whole chain still runs on the infra it watches — the external dead-man's-switch is **AF-139** (out of ISSUE-011 scope). Evidence `app/silo/results/stage2-checkpoint-evidence.2026-07-05.md`.

**AF-119 — Last-resort out-of-band log-failure surface durability (SPIKE, build-time).** AC-7.LOG.003.2 says an
`event_log` write failure is surfaced via an out-of-band path (local stderr/file + a `log-write-failing` health bit
on the push) — i.e. NOT only through the DB substrate that just failed. The unproven assumption: that out-of-band
path is **actually reachable** when the silo's own Postgres/Supabase is down (the classic "log the logging failure
to the log" trap). **Method:** SPIKE — induce a DB-write failure and confirm the condition reaches the Super Admin
grid without the local DB. **Relied on by:** AC-7.LOG.003.2. Gates the *durability claim* of the last-resort surface.
**Surfaced by:** C7 verification gate (finding F8). **→ 🟡 SEAM-PROVEN 2026-07-05 (session 66, ISSUE-011):** the out-of-band path is architecturally proven offline — on an `event_log` write failure the degraded sink + `log-write-failing` health bit are set via a path that does NOT touch the failed `EventLogStore` (no "log the logging failure to the log"; the DB holds zero half-written rows). **Caveat retained (not yet 🟢):** the *durability* of the last-resort surface when the silo's own Postgres is truly down (stderr/local-file survives + the mgmt-plane push carries the bit off-box) is exercised only at **ISSUE-012** integration (the push is 012's). Evidence `app/silo/results/stage2-checkpoint-evidence.2026-07-05.md`.

**AF-120 — Cross-deployment clock-sync for window math (DOCS/SPIKE, build-time).** All staleness / escalation /
"N hours" / daily-weekly windows use a single server-authoritative timestamp (AC-7.MGM.002.4 / AC-7.ALR.005.3). The
unproven assumption: cross-deployment clocks (each silo + the management plane) are synced tightly enough — or the
math is anchored receiver-side — so a skewed reporter clock can't make a dead deployment look fresh or an escalation
window miscompute and skip its secondary alert (#3). **Method:** DOCS (Railway/Supabase NTP guarantees) + SPIKE
(inject skew, confirm receiver-side anchoring holds). **Relied on by:** AC-7.MGM.002.4, AC-7.ALR.005.3. Gates the
*window-correctness claim*. **Surfaced by:** C7 verification gate (finding F6). **→ 🟢 PASS 2026-07-05 (session 66, ISSUE-011):** proven receiver/server-anchored — `event_log.created_at` is stamped server-side (`EventLogInput` has no time field, so a caller cannot assert time), the retention cutoff is computed against the server clock, and the watchdog stall math is receiver-anchored (a beat claiming "recent" but server-old still trips the stall). A skewed reporter clock cannot make a dead thing look fresh. Cross-deployment NTP between silo + mgmt-plane is a DOCS item for ISSUE-012's push. Evidence `app/silo/results/stage2-checkpoint-evidence.2026-07-05.md`.

**AF-139 — Out-of-band external monitor for the management plane itself (SPIKE, build-time).** The entire "watcher
watches the watcher" chain — the alert-evaluation-engine watchdog (FR-7.ALR.008), the mgmt-plane staleness evaluator
(FR-7.MGM.002), and the DLQ-liveness heartbeat (AC-5.JOB.006.2) — runs on the **same operator-hosted infrastructure
it watches** (Railway + the management-plane Supabase); there is no monitor **external to / out-of-band of** that
infrastructure. If the operator's own Railway account, region, or the management-plane deployment itself goes fully
dark (not just one silo), every internal watchdog goes dark with it — the meta-#3 one layer above AF-118 (that AF
covers an evaluator stalling; this one covers the evaluator's *host infrastructure* disappearing). The unbuilt
assumption: **an out-of-band external monitor** — a synthetic uptime check / dead-man's-switch service, hosted
outside the operator's own Railway infra — watches the management-plane deployment itself and alerts a human when
*it* stops responding. **Method:** SPIKE — stand up an external synthetic-check/dead-man's-switch service against
the management-plane's public health endpoint, fault-inject a full management-plane outage (kill the Railway
project/region), and confirm the external monitor fires when nothing internal can. **Relied on by:** FR-7.ALR.008,
FR-7.MGM.002 (both already gate on their evaluator surviving; this AF gates the evaluator's *host infrastructure*
surviving). Gates **the #3 guarantee's own foundation** — C7 cannot claim "never fail silently" while every one of
its watchdogs shares a single point of failure (the operator's own infra) with the thing it watches. **Surfaced by:**
whole-spec audit (H48) — this residual risk was not previously logged as an OD or AF anywhere, unlike almost every
other risk in this component.

## Block S — Component 8 (Agent Design), session 25 (2026-06-26)

**AF-121 — Description-driven routing accuracy (EVAL, build-time).** The whole C8 premise (L3400, L3419) is that the
orchestrator routes correctly by reading agent **descriptions**, not hardcoded logic. The unproven assumption: with
realistic, operator-authored descriptions, routing lands on the right specialist at an acceptable rate. **Method:**
EVAL (a labelled routing test set across the eight domains; measure top-1 routing accuracy + mis-route rate).
**Relied on by:** FR-8.ORC.001/003/005, FR-8.SPC.001, FR-8.LRN.002. Gates the *routing-quality claim*, not the FR
machinery. **Surfaced by:** C8 drafting.

**AF-122 — Orchestrator confidence calibration (EVAL, build-time).** ORC.006 + COST.002 rest on the confidence score
meaningfully separating good from bad routing so the threshold (default 0.75) is a real cost/quality dial (L3620).
The unproven assumption: the score is calibrated — high-confidence routes are actually more correct than
low-confidence ones. **Method:** EVAL (reliability diagram / correlation of confidence vs routing correctness).
**Relied on by:** FR-8.ORC.006, FR-8.COST.002. Gates the *threshold-as-dial claim*. **Surfaced by:** C8 drafting.

**AF-123 — Specialisation-drift detection accuracy (EVAL, build-time).** HLTH.002 claims an agent operating outside
its intended scope can be detected periodically (L3642). The unproven assumption: drift is detectable without
excessive false positives that would train operators to ignore the flag. **Method:** EVAL (inject scoped vs
out-of-scope behaviour; measure precision/recall of the drift signal). **Relied on by:** FR-8.HLTH.002. Gates the
*drift-detection claim*. **Surfaced by:** C8 drafting.

**AF-124 — Dead-agent / low-quality signal reliability (EVAL, build-time).** HLTH.001/003 produce a "consistently
fails or low quality" signal (L3578, L3644). The unproven assumption: the quality signal (task success/failure +
answer-mode-pill distribution + approval/rejection outcomes) reliably distinguishes a genuinely failing agent from
normal variance. **Method:** EVAL (compare signal against human-labelled agent quality). **Relied on by:**
FR-8.HLTH.001/003. Gates the *dead-agent-detection claim*. **Surfaced by:** C8 drafting.

**AF-125 — Agent-result-cache staleness safety (SPIKE/EVAL, build-time).** LRN.003 + OD-076 claim the scope-aware,
time-bounded invalidation prevents serving stale knowledge (#1). The unproven assumption: the cache key (in-scope
entity ids + their last-write/memory version) + write-invalidation actually catches every relevant change before a
reuse — no stale hit slips through (e.g. an out-of-band write, a memory-version race). **Method:** SPIKE (force
concurrent in-scope writes during a cache window; confirm no stale hit) + EVAL on the invalidation logic. **Relied
on by:** FR-8.LRN.003. Gates the *cache #1-staleness claim*. **Surfaced by:** C8 drafting (the #1-touching OD-076).

**AF-126 — Orchestrator learning measurably improves routing (EVAL, build-time).** LRN.001 + ORC.007 + PLAN.004 claim
that outcome-tracking refinement improves routing over time (L3640). The unproven assumption: the feedback loop
produces a measurable improvement and does not degrade routing (overfitting / feedback-loop drift). **Method:** EVAL
(longitudinal routing-accuracy trend with vs without the learning update; guard against regression). **Relied on
by:** FR-8.LRN.001, FR-8.PLAN.004. Gates the *self-improvement claim*. **Surfaced by:** C8 drafting.

---

## Block T — Component 9 (Proactive Intelligence), 2026-06-27 (session 26)

**AF-127 — Proactive signal-detection accuracy (EVAL, build-time).** PRO.001/004/005/007 rest on the system reliably
detecting sentiment/relationship-health drops, risk signals (overdue payment, underperforming campaign, capacity,
silent renewal), opportunity signals, and cross-memory patterns. The unproven assumption: these classifiers are
accurate enough (precision/recall) that proactive surfacing is trusted, not noise. **Method:** EVAL (labelled signal
set; measure false-positive/false-negative rate per signal class). **Relied on by:** FR-9.PRO.001/004/005/007. Gates
the *quality* of proactive generation, **not** the FR machinery. **Surfaced by:** C9 drafting.

**AF-128 — Dismissal-learning never suppresses a true escalating signal (EVAL, build-time).** OD-084's floor
(FR-9.SUG.005) claims learning tunes volume but never silences a derisking/hard-risk signal, and that escalating
metrics re-surface regardless of prior dismissal. The unproven assumption: the floor + re-surface logic holds under
real dismissal patterns (no learned suppression of a genuine risk). **Method:** EVAL (adversarial dismissal sequences
against escalating-risk fixtures; confirm re-surface fires). **Relied on by:** FR-9.SUG.005, AC-9.PRO.004.2. Gates
the #1/#3 invariant for the learning loop. **Surfaced by:** C9 drafting.

**AF-129 — Ranking + briefing surface the genuinely important items (EVAL, build-time).** SUG.002 + PRO.006 claim the
urgency×relevance ranking and the daily briefing surface what matters and don't bury it under low-value volume. The
unproven assumption: the ranking is well-calibrated and the briefing is relevant, not noise. **Method:** EVAL
(human-rated relevance of top-N surfaced items + briefings). **Relied on by:** FR-9.SUG.002, FR-9.PRO.002/003/006.
Gates the *anti-spam / orientation claim*. **Surfaced by:** C9 drafting.

**AF-131 — Non-client / content-sensitivity classification accuracy (EVAL, build-time).** The autonomy matrix's
Configurable-vs-LOCKED distinction rests on correctly tagging an action's risk sub-type — **recipient =
existing-client/SoR vs non-client**, **content = financial / Confidential / Restricted vs not**. **Stakes lowered
by OD-161 (2026-07-02):** since the Act-tier autonomous-send path no longer exists (every sub-type caps at
Prepare, human sends), a *confident-but-wrong* tag can at worst produce a wrong-context draft a human reviews
before sending, not an autonomous client send — no longer a #2 containment gate. Defended by
ambiguity-defaults-to-floored (AC-9.MODE.004.3). **Method:** EVAL (labelled recipient/content set; measure
mis-as-non-client + mis-as-non-sensitive rates — still worth measuring for draft-quality/UX accuracy).
**Relied on by:** FR-9.MODE.004. **Surfaced by:** the C9 verification gate (finding H1); stakes reassessed by the
pre-Phase-6 audit (OD-161).

**AF-130 — Cold-start ETA from ingestion rate is meaningful (SPIKE, build-time).** CST.007 surfaces an
"estimated time to full coverage" from the current ingestion rate (L3720). The unproven assumption: the estimate is
accurate enough to show rather than mislead (ingestion rate is non-linear — interviews + verification dominate).
**Method:** SPIKE (compare estimated vs actual time-to-coverage on seed deployments; fall back to "calculating" when
unreliable, per AC-9.CST.007.1). **Relied on by:** FR-9.CST.007. Gates only the *ETA display*. **Surfaced by:** C9 drafting.

---

## Block U — Infrastructure & Compliance (C10, session 27)

**AF-132 — Offboarding deprovision completeness end-to-end (SPIKE, build-time).** FR-10.OFF.005 deprovisions four
systems (Supabase project, Railway service, credentials, all connector OAuth tokens). The unproven assumption: each
deprovision actually completes + is idempotent on re-run, and a partial failure is detectable (so the offboarding can
hold in `deletion_failed` rather than silently report done). **Method:** SPIKE (deprovision a throwaway test
deployment; assert Supabase project gone, Railway service gone, tokens rejected, re-run is a clean no-op; inject a
mid-sequence failure + confirm `deletion_failed` + per-system status). **Relied on by:** FR-10.OFF.005. Gates the *#2/#3
clean-offboarding claim*. **Surfaced by:** C10 drafting (OD-089).

**AF-133 — Offboarding export integrity + readability at scale (SPIKE, build-time).** FR-10.OFF.002/003 generate a
complete JSON+CSV export, verify it (row-count/checksum reconciliation), encrypt it, and deliver it behind a
time-limited link — and destruction is gated on this. The unproven assumption: the export is genuinely complete +
re-importable/readable at real data volume, and the verification catches a partial export. **Method:** SPIKE (export a
loaded test deployment; reconcile counts; confirm the encrypted artefact decrypts + parses; corrupt one table +
confirm verification blocks). **Relied on by:** FR-10.OFF.002/003 (gates FR-10.OFF.005). Gates the *#1 no-loss claim*.
**Surfaced by:** C10 drafting (OD-090).

**AF-134 — Individual-erasure recall / name-identifier matching (EVAL, build-time).** FR-10.DEL.002 finds memories
that reference a person by `entity_id` (deterministic) **and** by name/identifier in content (probabilistic). The
unproven assumption: the probabilistic sweep has high enough recall that a human-reviewed result does not leave
personal data un-erased (#2), across name variants + identifiers. **Method:** EVAL (labelled corpus with known
person-mentions incl. variants/aliases; measure recall of the sweep; the floor's compliance safety depends on
high recall + human review). **Relied on by:** FR-10.DEL.002/004. Gates the *#2 erasure-completeness claim*.
**Surfaced by:** C10 drafting (OD-092).

**AF-135 — Deployment-freeze propagation completeness (SPIKE, build-time).** FR-10.OFF.004 freezes a deployment
(`status=frozen`) and the C5 dispatch layer must block **every** path that would write/run — Inngest jobs, triggers,
all three loops, manual actions. The unproven assumption: the freeze gate is checked at every dispatch site (no path
slips through). **Method:** SPIKE (freeze a test deployment; attempt each dispatch path — event trigger, scheduled
loop, manual task, chained successor; confirm each is blocked + logged). **Relied on by:** FR-10.OFF.004 + the C5
freeze-gate amendment. Gates the *#2/#3 frozen-means-frozen claim*. **Surfaced by:** C10 drafting (OD-091).

**AF-136 — Jurisdiction-specific lawful retention minimums (DOCS / legal, build-time).** FR-10.RET.002 enforces a
"legal-minimum floor" on retention values + FR-10.LEG.001 requires legal review. The spec **cannot assert** the
specific lawful minimums (Australia Privacy Act 1988 / UK GDPR / EU GDPR / US) — they are jurisdiction-, client-type-,
and data-nature-dependent. **Method:** legal review (a qualified lawyer sets the actual floors per jurisdiction before
the system handles that jurisdiction's regulated data). **Relied on by:** FR-10.RET.002, FR-10.LEG.001. This is the
honest *paper-until-a-lawyer-signs-off* gate — the floor is a configurable safeguard, not legal advice. **Surfaced
by:** C10 drafting (the design's own legal disclaimer, L4107–4109).

> Carried-in build-time AFs C10 relies on (already logged): **AF-004** (provisioning end-to-end), **AF-013** (Google
> OAuth production-verification lead-time), **AF-020** (Railway native auto-deploy + on-release migrate), **AF-064**
> (Railway release-train/canary model), **AF-065** (expand-contract mixed-version safety — the rollback premise),
> **AF-066** (canary corpus representativeness), **AF-071** (backup/data residency — Phase-5 backup track). None holds
> a C10 FR from being `Ready`; they gate the build-time *claims*.

**AF-137 — Transitive-erasure completeness verification (SPIKE, build-time).** C2 FR-2.MNT.017 (+AC-2.MNT.017.5) +
C10 FR-10.DEL.003 erasure spans many stores (memory rows + supersede chain + merged/summarised derived rows +
episodic evidence + embeddings + the `access_audit` tombstone + the OD-074 C7 `event_log`/`guardrail_log` redaction +
the off-platform backup-purge flag). The unproven assumption: the erasure can be **verified complete** across all
those legs (so a partial completion is detected + escalated, never reported done) — the OD-074 cross-process C2→C7
fan-out adds a new failure point. **Method:** SPIKE (erase a seeded target with residue planted in every leg incl. a
merged row + a log sink; assert every leg cleared + the verification catches an injected partial failure). **Relied
on by:** C2 AC-2.MNT.017.5, C10 AC-10.DEL.003.4. Gates the *#1/#2 no-residue claim* of the erasure path. **Surfaced
by:** the C10 verification gate (finding M1). Adjacent to but distinct from AF-134 (recall of *finding* the data) —
this is completeness of *deleting* it.

### Block V — Phase 5 (NFR / mobile)

**AF-138 — Mobile web-push delivery of a "critical, immediate, always" alert (SPIKE/LOAD, fast-follow).**
surface-12 ships mobile as responsive web + PWA with web-push (OD-150 / OOS-040). The push *routing
contract* (FR-7.VIEW.003: critical=immediate · hard-limit=immediate+always+non-suppressible) is approved,
but **background web-push delivery reliability** — whether a browser/OS actually delivers a critical push
promptly when the PWA is backgrounded/closed (iOS Safari web-push constraints, FCM/APNs bridging, battery
throttling) — is unproven. The unproven assumption: a "critical, immediate, always" alert reaches the phone
within a usable window. **Method:** SPIKE/LOAD — instrument web-push across the target device/OS matrix,
measure delivery latency + drop rate for backgrounded PWAs. **Relied on by:** surface-12 push contract
(FR-7.VIEW.003), the mobile NFR-OBS alert-delivery rows. **Fails safe:** a dropped push falls back to the
persisted in-app notification centre (FR-7.ALR.001/006) — **no FR rests on delivery**, so this is fast-follow,
not launch-gating. **Surfaced by:** the Phase-3 surface-12 spec (flagged for Phase 5) + the Phase-5 harvest.

**AF-141 — Railway GitHub App install + repo authorization is a MANUAL, dashboard/OAuth-only gate (SPIKE — load-bearing).**
Source: `tool-integrations/railway.md` §7 (2026-07-04). ISSUE-007 / FR-10.PRV.001 / **AF-004** describe a *scripted,
idempotent* provisioning flow, but the GitHub-repo-link step it depends on requires the **Railway GitHub App installed on
the GitHub account/org that owns the shared repo and granted access to it** — and there is **NO API or CLI path** to install
or authorize it (dashboard + GitHub OAuth only). The unproven assumption: that per-client provisioning can be fully unattended.
**Reality:** the script automates everything *after* the install; the install itself is a one-time human step. **The
provisioner MUST pre-flight-verify repo access and fail loud if the GitHub App is absent** (never a silent deploy-from-nothing
— #3). **Method:** SPIKE (attempt `serviceConnect` on a repo without the App → expect a clear auth error; then with it →
success; confirm *which* account installs it — operator org vs client). **Relied on by:** FR-10.PRV.001, AF-004, the AF-004
two-party run, OD-174. **Fails safe:** the pre-flight check converts a silent failure into a loud, actionable onboarding blocker.
**→ 🟢 CONFIRMED 2026-07-04 (AF-004 session 60):** the operator installed the Railway GitHub App + linked the repo via the
dashboard — confirming the manual, no-API gate; once installed, `serviceConnect`/auto-deploy proceeded. `RailwayInfra.linkRailway`
now fails loud pointing at this step (OD-174). The install account is the **operator org** that owns the shared `app/` repo (ADR-011).

**AF-142 — Automated provisioning needs a Workspace/Account token; project tokens can't create (SPIKE).**
Source: `tool-integrations/railway.md` §2 (2026-07-04). A Railway **project token** is scoped to an *existing* environment and
(per docs) cannot `projectCreate`/`serviceCreate`, so `RailwayInfra` structurally needs a **Workspace or Account token** —
whose blast radius is **every client project in the workspace** (a god-mode credential if leaked). The unproven assumptions:
(a) that a project token genuinely can't create resources (asserted by scope wording, not an explicit prohibition), and
(b) least-privilege custody holds. **Method:** SPIKE (project-token `projectCreate` → expect scope error; Workspace-token →
success). **Relied on by:** `RailwayInfra` token custody, NFR-SEC (secrets custody, Phase 5). **Fails safe:** token held only
in the operator secret store, never in repo/build; every provisioning call audit-logged.
**→ 🟡 RESIDUAL (session 61):** `RailwayInfra` is coded to require a Workspace/Account token (`RAILWAY_API_TOKEN`, fail-loud if
absent) and the CLI `--execute` path is wired, but a full **scripted** provisioning re-run (project/service create + deploy via
GraphQL) was **not** live-exercised — the AF-004 run used the operator's dashboard-linked service + GitHub-native deploy, and no
Workspace token has been minted. Not blocking Checkpoint 0 (AF-004 proved the plumbing); flip 🟢 when a Workspace-token scripted
run lands (before multi-client provisioning).

**AF-143 — Railway GraphQL mutation names/inputs (incl. `templateDeployV2`) are doc-thin/undated; validate vs live schema (SPIKE/DOCS).**
Source: `tool-integrations/railway.md` §4/§7 (2026-07-04). Railway docs pages carry **no last-updated dates**, and several
load-bearing mutations (`serviceConnect`, `serviceInstanceUpdate.rootDirectory`, `deploymentRollback`, and especially
`templateDeployV2` — confirmed only via Help Station, `V2` suffix implies churn) are not fully spec'd in primary prose. The
unproven assumption: the exact mutation names + input shapes the adapter codes against are current. **Method:** introspect the
live schema at `railway.com/graphiql` before marking any Railway-citing FR Ready. **Relied on by:** every `RailwayInfra`
operation. **Fails safe:** the AF-004 two-party session runs each mutation against live infra, catching any drift immediately.
**→ 🟡 PARTIAL (sessions 60–61):** **validated live** in AF-004 — `serviceInstanceUpdate` (rootDirectory), `variableUpsert`/
`variableCollectionUpsert` (skipDeploys), `serviceDomainCreate`, the `deployments` query + status enum, and the Supabase
Management API `/database/query`. `RailwayInfra` (`app/provisioning/src/infra.ts`) codes against exactly these. **Still to
validate** (marked inline as ⚠️ AF-143 in the adapter): the `variables(...)` read query, `serviceInstanceDeploy`, and the
service repo-link read — documented shapes, not yet live-run (need the AF-142 Workspace token). Non-blocking.

---

> This register grows as each ADR and component surfaces new assumptions. Next AF number: AF-144
> (priority spikes use AF-001–004; vendor block A uses AF-010–021; behavioral block B uses AF-030–035;
> cost block C uses AF-040–043, 044–049 reserved for cost overflow; performance block D uses AF-050–052;
> concurrency block E uses AF-061–063; deploy block F uses AF-064–066; RLS block G uses AF-067; injection
> block H uses AF-068; backup/DR block I uses AF-069–072; **Supabase Auth block J uses AF-073–077**;
> **Component-0 block K uses AF-078**; **Component-1 block L uses AF-079–081**; **Component-2 block M uses
> AF-082**; **Component-3 block N uses AF-083–110**; **Component-4 block O uses AF-111**; **Component-5
> block P uses AF-112–115**; **Component-6 block Q uses AF-116–117**; **Component-7 block R uses AF-118–120,
> AF-139**; **Component-8 block S uses AF-121–126**; **Component-9 block T uses AF-127–131**; **Railway dossier block
> uses AF-141–143** — `tool-integrations/railway.md`).
> Items are not blockers to *writing* the spec — they are commitments to *test* before/while building.
