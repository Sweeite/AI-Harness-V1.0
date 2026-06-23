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
| AF-003 | **Vendor-claims verification** — confirm every external limit/capability the doc asserts | Several are checkable and possibly stale; they shape rate-limit, token, and Realtime design. | DOCS | 🔴 |
| AF-004 | **Provisioning/deploy spike** — run the ADR-005 §5 path end-to-end: operator Railway app deploying from the shared repo against a **client-owned** Supabase, with env + secrets + `internal_token` minted/dual-stored + `client_registry` row + first-boot seed all green | Proves the ADR-001 hybrid + ADR-005 provisioning script actually wire up before we spec it in full. | SPIKE | 🔴 |

---

## A. Vendor capability claims (verify by DOCS / research — AF-003 umbrella)

| ID | Claim (from design doc) | Source | Status |
|---|---|---|---|
| AF-010 | Google APIs: 100 req/100s/user; Gmail 250 quota units/user/sec | L2120-2126 | 🔴 |
| AF-011 | GHL: 120 req/min/location, hard limit, no burst | L2128-2131 | 🔴 |
| AF-012 | Slack: ~1 req/sec typical; Retry-After header on 429 | L2133-2138 | 🔴 |
| AF-013 | Google access token 1h; refresh token dies after 6mo unused; prod needs verified OAuth app | L2275-2279 | 🔴 |
| AF-014 | GHL access token 1 day; refresh valid indefinitely | L2281-2284 | 🔴 |
| AF-015 | Slack bot tokens don't expire; revocable by workspace admin | L2286-2290 | 🔴 |
| AF-016 | Supabase Realtime: 200 (free) / 500 (pro) concurrent connections | L3134-3136 | 🔴 |
| AF-017 | Supabase Edge Functions 150s execution limit (the reason to use Inngest) | L2630 | 🔴 |
| AF-018 | Inngest: no execution-time limit, step-level retries, DLQ, generous free tier | L2632-2662 | 🔴 |
| AF-019 | pgvector HNSW maintains fast/accurate search at millions of vectors | L1477-1489 | 🔴 |
| AF-020 | Railway native per-project GitHub auto-deploy + running `drizzle-kit migrate` on release behave as assumed (ADR-005 §1) | ADR-001 §6 | 🔴 |
| AF-021 | Operator Railway can securely connect to a client-owned Supabase (hybrid model) | ADR-001 §5 | 🔴 |

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

---

> This register grows as each ADR and component surfaces new assumptions. Next AF number: AF-068
> (cost block C uses AF-040–043, 044–049 reserved for cost overflow; concurrency block E uses
> AF-061–063; deploy block F uses AF-064–066; RLS block G uses AF-067).
> Items are not blockers to *writing* the spec — they are commitments to *test* before/while building.
