# ADR-002 — Memory "Coverage %" → split into Maturity + Retrieval Sufficiency

- **Status:** Accepted
- **Date decided:** 2026-06-22
- **Resolves:** OD-002. Also closes OD-008 (answer-mode pill count).
- **Affects:** Cold-start gating, onboarding/initialisation indicator, the answer-mode pill,
  proactive suppression, read-only mode, loop frequency. Components: memory (entity-slot
  model, Maturity recompute job), agents/orchestrator (read-only gating, Sufficiency at query
  time, pill selection), surfaces (init progress indicator, memory health dashboard "coverage
  by entity"). Config keys `cold_start.*`. Feasibility AF-034 (validated in AF-002).

## Context

The design doc drives several different behaviours off one undefined number it calls
**"coverage %"** — but never defines its denominator (flagged 🔴 OPEN in the glossary). Worse,
it uses that one number for two jobs that run on different clocks with different denominators,
and contradicts itself on scope.

**Job 1 — gating & onboarding (slow clock, aggregate):**
- `cold_start { basic 20, proactive 50, full 80 }` thresholds unlock features
  (`design-doc-v4.md L929–934`, `L3773–3776`).
- Gates read-only mode, proactive suppression, loop frequency (`L3734–3767`).
- Surfaced as a single **"overall coverage percentage"** on the init progress indicator —
  *"Memory coverage: thin (32%)"* + ETA (`L3718–3723`).
- Question answered: *"How complete is what we know — enough to turn features on?"*

**Job 2 — the `[Building]` pill (fast clock, per-response):**
- Pill shows `[Building]` *"for responses where coverage is thin due to incomplete
  initialisation rather than a genuine unknown"* (`L3741–3743`).
- Explicitly **per-query, per-entity**: *"uses per-entity coverage when deciding whether to use
  [Building] mode for a specific response… A response about Acme Corp… still shows [Building]
  if Acme-specific coverage is thin"* (`L3780–3782`).
- Question answered: *"Did we retrieve enough for THIS query, right now?"*

**Two contradictions in the source:**
1. Coverage is *"measured per entity, not globally"* (`L3780`) **yet** also a single "overall"
   gating number (`L3719`). One scalar cannot be both an aggregate gate and a per-response
   retrieval verdict.
2. Cold-start mode is *"permanently deactivated for this deployment"* once past 80% — gaps
   thereafter are `[Unknown]`, not `[Building]` (`L3759–3767`) — **yet** `[Building]` is
   per-entity and should appear for any thin entity (`L3782`). What about a brand-new client
   added in year two, in an otherwise-mature deployment?

## Options considered

**A — Force one number to do both jobs (literal reading).** One stored `coverage %`.
- Pro: simplest to state; matches the doc's words.
- Con: cannot satisfy `L3782` — a stored aggregate can't render a per-query, per-entity
  verdict. The contradiction is intrinsic, not cosmetic. Rejected.

**B — Split into two metrics, each with its own denominator/engine.**
- Pro: clean separation.
- Con: two scoring systems to build and to validate (AF-002/AF-034), with no evidence yet that
  they must differ. Bloat risk. Rejected in favour of C.

**C — Split into two metrics over ONE shared substrate (chosen).** Define **Maturity** and
**Retrieval Sufficiency** as two *read-paths* over a single underlying data structure
(per-entity knowledge *slots*), not two independent engines.

**Denominator candidates considered for Maturity:**
- *Volume* (`memory count / target`): trivial but meaningless and gameable — 100 trivia
  memories outrank 10 critical facts. Rejected.
- *Confidence-weighted coverage*: conflates **Confidence** (trust) with completeness, which the
  glossary keeps orthogonal; still needs a target denominator anyway. Rejected for v1
  denominator (folded in later as slot-fill *quality*, see v2 note).
- *Expected knowledge slots* (chosen): each entity *type* declares the things we expect to know
  about it; the denominator is that slot set. Real, stable, explainable — and the empty slots
  double as the onboarding interview script (`L3784–3788`).

## Decision

**Retire "coverage %." Replace it with two metrics computed over one slot substrate.**

### 1. The substrate — expected knowledge slots
- Each **entity type** declares a small set of **expected knowledge slots** (e.g. a Client:
  primary contact, contract value, renewal date, key stakeholders, cadence, known risks,
  goals). **5–8 slots per type at v1**, operator-editable config. Deliberately *not* an
  exhaustive ontology — an oversized slot set makes the denominator arbitrary and the gating
  thresholds garbage-in.
- A slot is **filled (binary, v1)** if it has ≥1 live (non-decayed, non-superseded) memory.
- ⚠️ **v2 (deferred, do not build now):** graduate "filled" from binary to a 0→1 score weighted
  by the backing memories' confidence/verification. The denominator (slots) does not change, so
  this layers on without rework.

### 2. Maturity — knowledge-base completeness (gating)
- `Maturity(entity) = filled slots / expected slots`. **Aggregate Maturity** = rollup across
  the deployment's entities.
- **Stored**, recomputed on the **slow loop (daily)** and on memory-write for the touched entity
  (so onboarding progress feels live).
- **Gates on aggregate Maturity:** the deployment-level cold-start apparatus — init progress
  indicator, the persistent banner, read-only mode, global proactive suppression, reduced loop
  frequency — keyed to the `cold_start` thresholds (20/50/80, unchanged, operator-configurable).
- **The deployment cold-start *mode* is one-time:** once aggregate Maturity crosses
  `full_threshold` (80%), the mode deactivates **permanently** and its apparatus (banner,
  read-only, indicator) does not return. (Honors `L3763–3767`.)

### 3. Retrieval Sufficiency — query-time adequacy (the `[Building]` flag)
- Computed **inline per query, not stored.** A **thin threshold over signals already produced
  by retrieval** (the dual-search relevance + memory confidence ranking, AF-002) — explicitly
  **not** a new bespoke scoring engine.
- `Sufficient(query)` = the slots this query touches on the primary entity are filled **AND**
  retrieval surfaced them above a relevance×confidence bar. If the query maps to no slot, it
  falls back to pure retrieval quality (relevance×confidence of top-k). Either way: one rule.

### 4. Pill selection — `[Building]` vs `[Unknown]`
- The answer-mode pill is **always one of three: Cited / Inferred / Unknown.** `[Building]` is a
  **flag overlaid on an otherwise-`[Unknown]`/thin response**, not a fourth pill. → **closes
  OD-008.**
- Rule: a response with **low Retrieval Sufficiency** is flagged **`[Building]`** iff the
  **primary entity's Maturity < `proactive_threshold` (50%)**; otherwise the thin retrieval is a
  genuine **`[Unknown]`**. (Honors `L3755–3761`.)
- **`[Building]` is per-entity and recurs.** The deployment *mode* ends once (§2), but the
  `[Building]` flag reappears for any new/thin entity — e.g. a client onboarded in year two
  whose per-entity Maturity is below threshold — because the honest message there is "still
  learning *this* entity," not "permanent gap." This **resolves contradiction #2**: mode is
  deployment-level and one-time; the pill flag is entity-level and standing.

## Consequences

**Becomes required (new requirements / artifacts to write):**
- **DATA / config:** an `entity_type → expected_slots[]` definition (operator-editable);
  per-entity slot-fill state derivable from memories. Maturity stored per entity + aggregate.
- **Memory component:** Maturity recompute job (slow loop + on-write for touched entity).
- **Orchestrator/agents:** query-time Retrieval Sufficiency check feeding pill selection;
  read-only-mode and proactive-suppression gates keyed to aggregate Maturity thresholds.
- **Surfaces:** init progress indicator shows aggregate Maturity ("X% — N of M slots") + ETA;
  memory-health "coverage by entity" reads per-entity Maturity; empty slots feed the onboarding
  interview queue (highest-priority incomplete step, `L3788`).
- **Glossary:** add **Maturity**, **Retrieval Sufficiency**, **Expected knowledge slot**; retire
  **Coverage %** (points here); resolve **Answer mode** + **Cold start** rows.

**Ruled out:**
- A single "coverage %" scalar (Option A).
- Two independent scoring engines (Option B) — both metrics bind to the slot substrate.
- Volume-based or confidence-only denominators for v1.
- A fourth answer-mode pill.

**Anti-bloat guardrails (binding on downstream FRs):**
1. Retrieval Sufficiency stays a thin threshold over existing retrieval signals — no bespoke
   model.
2. 5–8 expected slots per entity type — small and operator-editable, not an ontology.
3. Confidence-weighted slot-fill is **deferred to v2**; v1 is binary.

**Feasibility (paper-pending-test):**
- ⚠️ **AF-034** — whether slot-fill Maturity actually predicts "the system is now useful," and
  whether the Sufficiency threshold cleanly separates `[Building]` from `[Unknown]`, is
  **decided-on-paper only.** Validate against real memories in the **AF-002 retrieval spike**
  (SPIKE+EVAL). If AF-002 shows slot-fill does not predict retrieval adequacy, revisit the
  "one substrate" coupling (decouple with evidence, not on spec).

**Spawns / informs:** memory-component FRs (slot model, Maturity job), orchestrator FRs
(Sufficiency + pill), surface specs (init indicator, coverage-by-entity), config registry
(`cold_start.*` + the slot definitions). No new ODs.
