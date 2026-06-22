# ADR-003 — Cost Model & Economic Viability

- **Status:** Accepted
- **Date decided:** 2026-06-22
- **Resolves:** OD-003
- **Affects:** Guardrails component (cost ladder = a new guardrail class alongside rate limits),
  loops (idle short-circuit), memory component (write-path model routing + selective-writing
  gate), orchestrator/agents (model routing, chain-depth, confidence threshold), surfaces
  (ops cost dashboard, Super Admin cross-deployment cost), config registry (`cost_*` keys +
  price table), Super Admin push payload (`cost-to-date`). Feasibility AF-001 / AF-035 / AF-040 /
  AF-041 / AF-042 / AF-043. Builds on ADR-001 (client-borne opex) and ADR-002 (cold-start loop reduction).

## Context

OD-003 framed cost as a thing that "could invalidate the architecture" — an unstated assumption
that *someone with a P&L eats the token bill*. **ADR-001 changed that frame.** The client owns
the Supabase project and the Anthropic/OpenAI API keys and pays the vendors **directly on their
own card**. The operator's only marginal cost per client is the small, flat Railway compute
(ADR-001 L101), which is out of scope for the token cost model.

So "economic viability" is **not** the operator's token P&L. It is two client-side questions:
1. **Viability:** does a single deployment's monthly bill stay low enough that the retainer
   stays worth paying? (~5 clients yr 1 → ~20 yr 2; retainer for build+manage, opex client-borne.)
2. **Guarantee:** what stops one runaway deployment from burning **unbounded client money** —
   overnight, on the client's card, with nobody watching?

The design doc supplies cost *mechanisms* but never confronts the viability question and leaves
the guarantee toothless:
- **Model routing** (the doc's "most important cost decision," `L147`): Haiku for classification,
  Sonnet for reasoning (`L145–168`). Two-model split is config-driven (`L1034–1037`, `L80–83`).
- **Cost alerts** `cost_alert_daily_usd: 50`, `cost_alert_weekly_usd: 200` (`L1004–1005`) — but
  breach only fires a **dashboard notification** (`L3308–3309`), no automated action.
- **Cost is token-derived:** the event log stores `cost_tokens int` (`L3057`); tracking polls
  every 5 min, *"real-time cost tracking adds no value"* (`L3120–3123`). There is **no** path to
  the vendor's real invoice (and ADR-001 forbids crossing the boundary to get it).
- **"Up to three [calls] per memory write event"** (`L3598`) — OD-003 paraphrased this as "3
  Sonnet calls," but the routing table (`L149–168`) puts the relevance filter, sensitivity
  classifier, and contradiction pre-check on **Haiku** and only the writer on Sonnet.
- **Loops** (`L2564–2573`, `L937–942`): fast every ~10 min (144/day), medium hourly-ish, slow
  daily — an always-on recurring cost floor, each step an AI call.
- **Cost-control levers** scattered across `L335`, `L3596–3620`: caching, parallelism,
  chain-depth limit, orchestrator confidence threshold ("highest leverage single tunable",
  `L3620`), context compression, memory-injection limit, selective writing.

What's missing and what this ADR locks: (a) whose problem cost is, (b) what the breach actually
*does*, (c) what number the breach triggers on (estimate vs invoice), (d) the true memory-write
cost shape, (e) the idle-loop floor, (f) a viability target, (g) a disciplined ordering of the
levers — and a principle for *not* adding cost-control machinery that costs more than it saves.

## Options considered

**Scope of the ADR (the framing fork):**
- **A1 — Operator P&L framing** (pooled keys, resale with markup). Cleaner billing story but
  directly contradicts ADR-001 (client owns keys). Would reopen ADR-001. Rejected.
- **A2 — Mechanisms only, no number.** Lock the levers + alert behaviour, commit to no envelope.
  Lighter, but leaves "is it viable?" formally unanswered — the exact thing OD-003 raised. Rejected.
- **A3 — Client-side viability + guardrails (chosen).** Operator marginal cost ≈ $0; the ADR
  commits to a defensible per-deployment cost *envelope* and to hard-cap/throttle *guarantees*.

**Breach behaviour:**
- **B1 — Alert-only (doc as-is).** Cannot satisfy the runaway guarantee. Rejected.
- **B2 — Single hard cap (full stop).** Strong but brittle — kills live client ops, no graceful
  degradation. Rejected.
- **B3 — Tiered ladder → hard cap (chosen).** Mirrors the existing rate-limit ladder
  (`L2159–2191`, 80/95/100): degrade non-critical work first, kill switch last.

**Cost source of truth:**
- **C1 — Token-derived estimate, all vendors (chosen).** Stays inside the ADR-001 boundary;
  buildable today (`cost_tokens` exists). Accept it's an estimate; make it fail-safe.
- **C2 — Pull actual spend from vendor APIs.** Needs client billing credentials, crosses the
  isolation boundary, not real-time. Infeasible per-deployment. Rejected.
- **C3 — Hybrid (estimate now, reconcile later).** The reconcile step still needs invoice
  access → inherits C2's boundary problem. Deferred, not chosen.

## Decision

### 1. Scope — client-side viability + guardrails (resolves the OD-003 framing)
Cost is **not** the operator's P&L (ADR-001: opex client-borne, operator marginal cost ≈ $0).
ADR-003 commits to: **(a)** a defensible per-deployment monthly cost **envelope** the architecture
must sit under so the retainer stays worth paying, and **(b)** hard-cap/throttle guarantees so a
single deployment cannot burn unbounded **client** money. Cost tracking stays **visibility-grade,
not invoice-grade** (ADR-001), and more precisely **estimate-grade** (see §3).

### 2. The cost ladder — a new guardrail class (resolves breach behaviour)
A tiered ladder per deployment, modelled on the rate-limit ladder, **all keys operator-editable
and tuned per client to their spend tolerance:**

| Rung | Default | Behaviour |
|---|---|---|
| Soft alert — spike | `cost_alert_daily_usd: 50` | Dashboard notification only. No throttle. |
| Soft alert — sustained | `cost_alert_weekly_usd: 200` | Notification. Catches ~$28/day sustained burn the daily rate misses. (The two rates are deliberately not multiples — daily catches spikes, weekly catches sustained burn.) |
| **Throttle** | `cost_throttle_daily_usd: 75` (1.5×) | Pause **non-critical** work (proactive suggestions, insight agent, self-improvement, consolidation/summaries, medium-loop batch); reduce loop frequency. User-facing + urgent untouched. |
| **Hard ceiling** | `cost_hard_ceiling_daily_usd: 100` (2×) | **Kill switch.** Halt all non-critical work; allow only **urgent fast-loop triggers + human-initiated requests + human-approved actions + guardrails.** |

- **Critical (never killed):** human-initiated requests, urgent fast-loop triggers (new leads,
  flagged messages, overdue tasks), human-approved actions, guardrail/security functions.
- **Auto-actions are daily-anchored.** The weekly soft alert is human-attention only (a sustained
  just-under-ceiling burn surfaces there for a human to act); no weekly auto-throttle at v1.

### 3. Cost source of truth — fail-safe token estimate (resolves the trigger-number fork)
The number on every dashboard **and** every ladder rung is a **token-derived estimate**, computed
from event-log token counts × a price table. It is **not** the vendor invoice, and the ADR-001
boundary means it never will be. Three binding conditions make an estimate fit to anchor a kill
switch:
1. **Price table is a config key** (`cost.price_table`), not hardcoded — tracks Anthropic/OpenAI
   price changes without a deploy.
2. **All vendors counted** — Sonnet **+** Haiku **+** OpenAI embeddings (`text-embedding-3-small`).
   A ceiling blind to the OpenAI bill does not bound total client cost.
3. **Fail-safe bias — the estimator rounds *up*** (count retries, no optimistic cache/batch
   discount assumptions). An estimator guarding spend must err toward **overcounting** so the
   ceiling fires **early, not late**; the hard ceiling is set with margin below the true
   "unacceptable" number. This converts estimator drift from a guarantee-breaker into conservative
   behaviour. ⚠️ **AF-042** tracks real-invoice-vs-estimate drift.

### 4. Memory-write cost — Haiku-dominant, ≤1 Sonnet call per *written* memory (corrects OD-003)
OD-003's "3 Sonnet calls per write" is **rejected.** Per memory-write event:
- **Code-level noise filter first** (empty/system/dedupe) — no model.
- **Selective-writing classifier — Haiku** — *"is this worth remembering?"* Most events die here;
  common-case Sonnet cost per event = **0**. (Doc's "the one optimisation that pays off
  immediately," `L1952`.) Tuned **conservative**: kills only obvious noise, passes through when in
  doubt (the writer is the real judge). ⚠️ **AF-043** measures whether the gate filters enough to
  pay for its own Haiku cost.
- For surviving events: **contradiction pre-check + sensitivity classifier — Haiku**; **memory
  writer — Sonnet (the only Sonnet call).**

So a *written* memory = **exactly 1 Sonnet call** wrapped in ≤3 Haiku calls. `memory_writes_per_minute:
30` therefore caps the **Sonnet** writer at 30/min (not 90). Memory drops from "scariest cost
line" to bounded and mostly-Haiku.

### 5. Loop idle floor — code short-circuit, not an LLM gate
A loop checks for real work with a **plain DB/condition query** (is there a new lead / flagged
message / overdue task / queued item?) **before** waking the Sonnet orchestrator. An idle
deployment's loop floor ≈ free. The fast loop's 144 runs/day cost ~nothing when there is nothing
to do. (Reinforced by ADR-002's cold-start loop-frequency reduction.)

### 6. "Controls before gates" — the binding cost-discipline principle
The cheapest call is the one you never make. Cost controls are ordered:
1. **Structural / code limits** — cost nothing, can't misjudge: chain-depth ceiling, memory-injection
   cap, loop condition checks, the rate caps (`memory_writes_per_minute`, max tool writes/task, etc.).
2. **Cheap model-gates — only where a genuine judgment is needed AND the gate reliably prevents a
   costlier call.** v1 keeps exactly one: the Haiku selective-writing gate (§4), self-funding
   because Haiku is ~15–20× cheaper than the Sonnet writer it prevents.
3. **Never** an LLM gate whose own cost/quality-risk exceeds what it saves. **Re-ranking and HyDE
   (`L1934–1956`) are NOT mandated** — they add read-path LLM cost for unproven payoff; optional,
   off-by-default, justified only by an AF-002 eval if they earn their keep.

### 7. Viability target — the AF-001 gate
A typical-volume **healthy** deployment should sit **comfortably below the soft alert** — target
**≤ ~$20/day (~$600/mo)**, with `$50/day` as the "investigate" line and `$100/day` as the backstop.
**AF-001** (the cost spike) must measure a real end-to-end task + memory write and confirm typical
volume lands under the soft alert. **If AF-001 measures typical volume *above* the soft alert, the
response is to pull the levers — in this order — before raising the ceiling:**
`model routing → selective-writing gate → loop idle-gating → memory-injection limit → orchestrator
confidence threshold` (the doc's highest-leverage single tunable, `L3620`).

### 8. Haiku decision log + trust window — making the cheap model auditable
A cost-saving gate is only trustworthy if its decisions are **visible**. Every Haiku decision in
the memory write path is logged for human review, with a **trust window** before the gate is allowed
to run unsupervised.
- **Logged decisions (all three Haiku calls):** selective gate (keep/drop — the high-stakes one),
  contradiction pre-check (conflict/none), sensitivity classifier (class). Each record captures the
  **input snapshot**, the **verdict**, and the **downstream outcome** (written by Sonnet or not).
- **A drop is invisible by default** — you cannot review a memory that was never written. So during
  the trust window the gate runs in **shadow-retain** mode: a "would-drop" memory is **written
  anyway and tagged** `haiku_would_drop`, so nothing is lost and every drop is reviewable. The gate
  saves nothing during the window — acceptable because a new deployment is low-volume/cold-start
  (ADR-002), so this is a calibration period, not a savings period.
- **Review surface:** a queue of Haiku decisions (drops highlighted) where the operator marks
  **agree / disagree**; disagreements feed the AF-035 quality track and tune the gate threshold.
- **Trust window:** default **~3 weeks** (`haiku_audit_window_days: 21`, config). When it ends, if
  the disagree-rate is under `haiku_gate_disagree_threshold`, the gate goes **autonomous** (drops
  actually drop) and review drops to optional sampling. If over threshold, the gate stays supervised
  and the threshold/prompt is retuned — the cheap model has not earned trust yet.
- This audit log **is** the validation data for AF-043 (does the gate pay for itself?) and the
  memory-path half of AF-035 (is Haiku good enough?). Same pattern is the template for auditing
  orchestrator routing later.

## Consequences

**Becomes required (new requirements / artifacts to write):**
- **Guardrails component:** a **cost-ladder guardrail** (sibling to rate-limit ladder) — evaluates
  estimated daily/weekly spend against the four rungs; throttle and kill-switch actions; the
  critical/non-critical work classification.
- **Config registry (Phase 2):** new keys `cost_throttle_daily_usd` (75), `cost_hard_ceiling_daily_usd`
  (100), `cost.price_table` (per-model $/token, all vendors), plus existing `cost_alert_daily_usd`
  (50) / `cost_alert_weekly_usd` (200) — **all per-deployment, operator-editable.** Note the daily
  ≠ weekly×7 relationship as intentional.
- **Cost estimator:** token→$ computation over the event log, all vendors, fail-safe round-up.
  Feeds dashboards, the ladder, and the Super Admin `cost-to-date` push.
- **Memory component:** code noise-filter → Haiku selective-writing gate → Haiku pre-checks →
  Sonnet writer write-path; gate tuned conservative. **Shadow-retain mode** during the trust window
  (writes "would-drop" memories tagged `haiku_would_drop`); switches to autonomous after the window.
- **Haiku decision log (data):** a table recording each memory-path Haiku decision — classifier
  type, input snapshot, verdict, downstream outcome, `haiku_would_drop` flag, operator agree/disagree.
- **Audit review surface:** a Haiku-decision queue (drops highlighted) with agree/disagree capture;
  feeds the AF-035 quality track and gate tuning.
- **Config (Phase 2):** `haiku_audit_window_days` (21), `haiku_gate_disagree_threshold`, plus the
  cost keys above — all per-deployment, operator-editable.
- **Loops:** DB/condition pre-check before orchestrator spin-up.
- **Surfaces:** ops cost dashboard (per-task-type trend, ladder state); Super Admin cross-deployment
  cost overview reads pushed `cost-to-date`.
- **Model-routing telemetry (standing, dual-track):** every routed model call records `model`,
  `task_type`, and tokens/$ (**cost track**) **and** a correctness signal — selective-gate
  false-drops, mis-routes, classifier errors (**quality track**). The two-model split is only a win
  if Haiku is *good enough*; a cheap-model quality regression must be visible, not silent. Feeds the
  per-task-type cost view (`L3321`) and self-improvement's "cost health" surface, and is the evidence
  base for tuning the (config-driven) routing table. ⚠️ **AF-035.**

**Ruled out:**
- Operator-P&L / resale framing (would reopen ADR-001).
- Alert-only breach behaviour; single-cliff hard cap.
- Pulling real vendor-invoice spend per deployment (boundary violation).
- "3 Sonnet calls per memory write" (it's ≤1 Sonnet + Haiku).
- Mandating re-ranking / HyDE as standard cost machinery.

**Anti-bloat guardrails (binding on downstream FRs):**
1. **Controls before gates** — structural/code limits first; a model-gate must demonstrably prevent
   a costlier call; no self-defeating LLM gate.
2. v1 keeps exactly **one** cost model-gate (Haiku selective-writing).
3. Re-rank/HyDE deferred to AF-002 eval; not in the v1 cost model.

**Feasibility (paper-pending-test):**
- ⚠️ **AF-001 / AF-040 / AF-041** — the viability target (≤ ~$20/day typical; soft alert realistic)
  is **paper-only** until the cost spike measures a real task end-to-end.
- ⚠️ **AF-042** — the token estimate drifts from the real vendor invoice; the fail-safe round-up
  must keep drift conservative (fire early). Validate by reconciling estimate vs a real bill.
- ⚠️ **AF-043** — the Haiku selective-writing gate must filter enough events to pay for its own
  cost; if it doesn't, drop it (controls-before-gates). Measure in the AF-001 spike.
- ⚠️ **AF-035** (existing, sharpened) — two-model routing must save enough **and** Haiku must be
  good enough; tracked on a **standing dual-track** (cost + quality) telemetry, not validated once.
  The whole envelope rests on it.

**Spawns / informs:** guardrails-component FRs (cost ladder), memory-component FRs (write-path
routing + gate), loops FRs (idle short-circuit), orchestrator FRs (lever ordering, confidence
threshold), config registry (`cost_*` + price table), surface specs (cost dashboard), Super Admin
push payload. No new ODs.
