### AF-001 evidence — cost-viability spike (ISSUE-001)

**(a) Verdict:** PASS → status 🟢
**(b) Date / method:** 2026-07-03 · SPIKE+EVAL
**(b′) Models called:** Sonnet=claude-sonnet-5 · Haiku=claude-haiku-4-5-20251001 · embed=text-embedding-3-small

**(c) Declared typical-volume profile (extrapolation basis):**
- 50 real multi-agent tasks/day
- 500 write-path events/day, of which 100 survive
- loops/day: 144 fast · 24 medium · 1 slow (idle-gated → ~$0 model)
- rationale:
  Anchored to a healthy ≤~20-user silo (test-strategy §1) + ADR-003 §5 cadence.
  • 50 real multi-agent tasks/day ≈ ~2–3 substantive tasks per active user/day plus a small
    share of loop spin-ups. Loop runs themselves (144 fast + 24 medium + 1 slow = 169/day) are
    idle-gated to ~0 model cost (ADR-003 §7 lever 3: DB/condition pre-check before spin-up);
    the spin-ups that DO become tasks are counted inside the 50.
  • 500 write-path events/day, of which ~100 survive (≈20% survival). The other ~400 are
    charged one Haiku gate call each (round-up: we assume they reach the Haiku gate rather than
    dying free at the code filter). 100 survivors ≈ 1–2 durable memories per task.
  Contestable by design — dispute routes to an AF-040/041 threshold-realism EVAL, not to this gate.

**(d) Measured per-vendor cost + tokens (round-up estimator, all vendors):**
- one task ($0.0359):
  - anthropic/sonnet: 5 call(s), 5 attempt(s), 2025 in + 1985 out tok → $0.0358
  - anthropic/haiku: 1 call(s), 1 attempt(s), 71 in + 5 out tok → $0.0001
- one surviving memory write ($0.0025):
  - anthropic/sonnet: 1 call(s), 1 attempt(s), 123 in + 123 out tok → $0.0022
  - anthropic/haiku: 3 call(s), 3 attempt(s), 260 in + 26 out tok → $0.0003
  - openai/text-embedding-3-small: 1 call(s), 1 attempt(s), 72 in + 0 out tok → $0.0000
- one Haiku gate (non-survivor unit cost): $0.0001
- **Extrapolated: $2.09/day** vs ~$20 target / $50 soft alert
  - tasks $1.80 · surviving writes $0.26 · non-survivor gates $0.04 · loops $0.00

**(e) Observed memory-write shape (AF-043):** surviving write = 1 Sonnet + 3 Haiku + 1 embed (ADR-003 §4 asserts 1 Sonnet + 3 Haiku). Non-survivor 0 Sonnet: confirmed.

**(f) Estimate-vs-invoice basis (AF-042):** cost is token-derived via `cost_tokens × price_table` (schema.md §8), round-up (retries charged, standard non-batch rates, no cache discount) → biased ABOVE the real vendor invoice by construction. Reconciliation against a real Anthropic/OpenAI bill is the AF-042 fast-follow.

**(g) Assembled corpus composition:** 1 task (account-brief (research+summarize+recommend) — orchestrator→research→2 specialists→synthesis); 3 memory events fed (1 survivor / 1 gate-drop / 1 code-filter drop).

**(h) Over-soft-alert lever path:** n/a — under the soft alert.
