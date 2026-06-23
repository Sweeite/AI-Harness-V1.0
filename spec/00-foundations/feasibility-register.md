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
| AF-001 | **Cost spike** — run one real multi-agent task + memory write, measure actual tokens/$ | Validates the ADR-003 viability target (typical-volume deployment ≤ ~$20/day, under the $50 soft alert). Also measures memory-write cost (now corrected to ≤1 Sonnet + Haiku, AF-043) and feeds AF-042. Most likely thing to invalidate the design. | SPIKE+EVAL | 🔴 |
| AF-002 | **Memory retrieval spike** — load ~100 real memories, run dual-search + ranking, judge relevance | If retrieval surfaces noise, the whole "business brain" premise is shaky. Validates ranking weights. | SPIKE+EVAL | 🔴 |
| AF-003 | **Vendor-claims verification** — confirm every external limit/capability the doc asserts | Several are checkable and possibly stale; they shape rate-limit, token, and Realtime design. | DOCS | 🟡 **DOCS pass done 2026-06-23** — see Block A findings below. 3 claims stale/refuted (AF-010/011/014), 1 design-fork found (AF-012 Slack → OD-011). Residual: AF-019 stays SPIKE/LOAD-open; AF-012 needs EVAL on a live workspace. |
| AF-004 | **Provisioning/deploy spike** — run the ADR-005 §5 path end-to-end: operator Railway app deploying from the shared repo against a **client-owned** Supabase, with env + secrets + `internal_token` minted/dual-stored + `client_registry` row + first-boot seed all green | Proves the ADR-001 hybrid + ADR-005 provisioning script actually wire up before we spec it in full. | SPIKE | 🔴 |

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
| AF-019 | pgvector HNSW maintains fast/accurate search at millions of vectors | L1477-1489 | 🟡 **HNSW verified; perf stays SPIKE/LOAD-open** — see F10 |
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
| AF-035 | Two-model routing (Haiku for classification, Sonnet for reasoning) saves enough to matter **AND the cheap model is good enough** — i.e. Haiku's classification/gate decisions and Sonnet's routing don't lose quality. **Standing dual-track telemetry (not a one-off):** every routed call records model + task type + tokens/$ (**cost track**) and a correctness signal — gate false-drops, mis-routes, classifier errors (**quality track**) — so routing config is tuned with evidence. Cost win is worthless if quality silently degrades. | 🔴 |

## C. Cost feasibility (verify by measurement — AF-001 umbrella)

| ID | Assumption | Status |
|---|---|---|
| AF-040 | A real task's end-to-end cost (orchestrator + research + specialists + memory writes) is acceptable — sits under the ADR-003 viability target (≤ ~$20/day typical) | 🔴 |
| AF-041 | The $50/day soft-alert + $100/day hard-ceiling defaults (ADR-003 cost ladder) are realistic for a working deployment | 🔴 |
| AF-042 | The **token-derived cost estimate** (ADR-003) stays close to — and biased above — the real vendor invoice. The fail-safe round-up must keep drift conservative so the hard ceiling fires early, not late. Validate by reconciling estimate vs a real Anthropic/OpenAI bill. | 🔴 |
| AF-043 | The **Haiku selective-writing gate** (ADR-003 §4/§6) filters enough events to pay for its own Haiku cost vs running the Sonnet writer unfiltered, **and is accurate enough to trust** (low operator disagree-rate). Validated by the **Haiku decision log + 3-week shadow-retain trust window** (ADR-003 §8) — manual review is the gate to autonomy. If it fails either bar, drop or retune it (controls-before-gates). | 🔴 |

## D. Performance / scale feasibility (verify by LOAD)

| ID | Assumption | Status |
|---|---|---|
| AF-050 | Loops don't back up at ~20 concurrent client deployments | 🔴 |
| AF-051 | Vector search latency stays acceptable as memories grow | 🔴 |
| AF-052 | Consolidation/summarise jobs complete within Inngest comfortably at volume | 🔴 |

## E. Concurrency feasibility (ADR-004 — verify by SPIKE / LOAD / DOCS)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-061 | The **optimistic validate-and-commit closes the TOCTOU window** (ADR-004 §3): running the Sonnet writer unlocked, then a short locked transaction that re-checks a per-entity watermark and re-runs only the cheap DB contradiction check on change, actually catches same-entity races **without livelock or excessive re-runs**. The whole correctness claim rests on this — it is the core thing that can only be proven by testing. | SPIKE+EVAL | 🔴 |
| AF-062 | **Sorted per-entity Postgres advisory locks + short commit transactions don't bottleneck under fan-out at scale** (`L2115`, ~20 concurrent deployments), and multi-entity writes (locking 2–3 entities each, in sorted order) stay **deadlock-free** and contention-light. | LOAD | 🔴 |
| AF-063 | **Inngest per-key concurrency serializes same-entity steps** as ADR-004 §2 assumes — and if it doesn't, the design **degrades safely** to "advisory lock alone" (the lock, not the queue, is the correctness boundary). | DOCS+SPIKE | 🔴 |

## F. Deploy / provisioning / version-skew feasibility (ADR-005 — verify by SPIKE / DOCS / EVAL)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-064 | **Railway supports the branch-based canary/release-train + promotion model** (ADR-005 §2): a canary deployment tracking a `release` branch, the fleet tracking `main`, promotion by fast-forward, and **build-history rollback** (§4). If Railway's branch/environment model differs, the *mechanism* changes but the *decision* (a canary gate before the fleet) stands. | DOCS+SPIKE | 🔴 |
| AF-065 | **Expand-contract migrations keep a mixed-version fleet safe** (ADR-005 §3/§4): a `vN` and a `vN-1` deployment both run correctly against their own schema through a rollout, **and prior code runs against the newer schema** (the rollback premise). Parts 3 + 4 of ADR-005 rest entirely on this. | SPIKE | 🔴 |
| AF-066 | **The synthetic canary corpus + smoke battery is representative enough** (ADR-005 §6/C2) to catch behavioral/data-dependent regressions (retrieval, memory contradiction, agent routing) before promotion — i.e. the canary is not a false sense of safety. Honest limit: it only catches what its fixtures + assertions cover. Shares the AF-001/AF-002 corpus. | EVAL | 🔴 |

## G. RLS / dynamic-roles feasibility (ADR-006 — verify by SPIKE / LOAD)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-067 | **Live data-driven RLS performs on the hot retrieval path** (ADR-006 §D3/Axis 3): a `STABLE SECURITY DEFINER` permission lookup keyed on `auth.uid()`, evaluated **once per statement** over the (tiny, fully-indexed) permission tables, composes with **pgvector** ranking of a large memory batch without unacceptable latency. The whole D3 "read permissions live, no token cache" choice rests on this. **Fallback if it fails at scale:** denormalise permissions into JWT claims (the rejected D2), accepting a staleness window — logged as OOS-012. | SPIKE+LOAD | 🔴 |

## H. Prompt-injection / containment feasibility (ADR-007 — verify by SPIKE / red-team)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-068 | **The containment boundary holds end-to-end** (ADR-007 part 1): there is **no authorized-but-dangerous autonomous action path** by which injected instructions reach a consequential side effect — external communication, financial action, cross-client read, destructive write of a system of record, or memory poisoning — **without** passing a code-enforced hard limit / RBAC check / approval gate that **ignores prompt content**. Verified by red-teaming the harness with live injection payloads and confirming none escalate. This is the load-bearing claim of the whole posture; if a bypass path exists it must be **closed in code**, not patched with a detection rule. | SPIKE (red-team) | 🔴 |

---

> This register grows as each ADR and component surfaces new assumptions. Next AF number: AF-069
> (cost block C uses AF-040–043, 044–049 reserved for cost overflow; concurrency block E uses
> AF-061–063; deploy block F uses AF-064–066; RLS block G uses AF-067; injection block H uses AF-068).
> Items are not blockers to *writing* the spec — they are commitments to *test* before/while building.
