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
| AF-004 | **Provisioning/deploy spike** — operator Railway app deploying from the shared repo, connected to a client-owned Supabase | Proves the ADR-001 hybrid + ADR-005 deploy model actually wires up before we spec it in full. | SPIKE | 🔴 |

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
| AF-020 | Railway native GitHub auto-deploy + can run drizzle migrations on release | ADR-001 §6 | 🔴 |
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

---

> This register grows as each ADR and component surfaces new assumptions. Next AF number: AF-060
> (cost block C now uses AF-040–043; 044–049 reserved for cost overflow).
> Items are not blockers to *writing* the spec — they are commitments to *test* before/while building.
