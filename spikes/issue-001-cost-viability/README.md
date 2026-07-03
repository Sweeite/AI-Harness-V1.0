# ISSUE-001 — cost-viability spike (AF-001 gate)

Runnable measurement harness for **[ISSUE-001](../../spec/06-issues/ISSUE-001-cost-viability-spike.md)**.
It proves — by measuring a real end-to-end multi-agent task + a memory write and extrapolating to a
typical day — that a healthy deployment lands **at/under ~$20/day** (and under the **$50/day** soft
alert), so the retainer model holds. This is one of the six launch go/no-go SPIKE-GATEs (**AF-001**).

Stack: **TypeScript / Node** ([ADR-009](../../spec/00-foundations/adr/ADR-009-implementation-stack.md)).

## What it does (maps 1:1 to ISSUE-001 build order)

| Step | File | What |
|---|---|---|
| 0 declare profile | `src/profile.ts` | The typical-volume profile (tasks/day, writes/day, loops) — the extrapolation basis. **Contestable by design.** |
| 1 corpus | `src/corpus.ts` | Assembles + records the corpus (no canonical corpus file exists in the repo). |
| 2 token capture | `src/pricing.ts`, `src/ledger.ts` | `price_table` rates + the round-up estimator; the running meter (`cost = cost_tokens × price_table`). |
| 3 run task + write | `src/task.ts`, `src/memoryWrite.ts` | One real multi-agent task; the ADR-003 §4 write path (code filter → Haiku gate → 2 Haiku pre-checks → 1 Sonnet writer → embed). |
| 4–5 extrapolate + compare | `src/extrapolate.ts`, `src/thresholds.ts` | Per-unit → $/day; assert ≤ ~$20/day and < $50 soft alert (AC-NFR-COST.006.1). |
| 7 evidence | `src/report.ts` | Emits the AF-001 evidence block (fields a–h) → `results/`. |

## Run

```bash
npm install
npm run spike:dry     # mock tokens, no spend — exercises the full flow (never PASSes)
npm run spike         # REAL paid calls — needs a filled .env
```

Copy `.env.example` → `.env` and fill `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` before `npm run spike`.

## Rates (source of truth)

- `price_table` — [config-registry.md](../../spec/02-config/config-registry.md) App. A item 10:
  Sonnet `0.003/0.015`, Haiku `0.0008/0.004` ($/1k tok).
- OpenAI `text-embedding-3-small` `0.00002/1k` (= $0.02/1M, standard tier — **not** the batch rate;
  round-up posture forbids optimistic discounts). Verified vs OpenAI pricing 2026-07-03.
- Thresholds — config-registry §I: soft $50/day · weekly $200 · throttle $75 · hard-kill $100.

## Posture (non-negotiables)

- **Round-up estimate** (ADR-003 §3): every attempt incl. retries is charged, standard (non-batch)
  rates, no cache discount → biased **above** the real invoice, never below.
- **Never a silent $0** (schema.md §7): an uncomputable cost is `cost_unknown`, surfaced loudly.
- **Estimate, not invoice** (ADR-001): the $ figure is `cost_tokens × price_table`; reconciling
  against a real bill is the AF-042 fast-follow.

## Output

`results/af-001-evidence.<date>.{json,md}` — paste the markdown block into
[feasibility-register.md](../../spec/00-foundations/feasibility-register.md) AF-001 and flip
🔴→🟢 on PASS.
