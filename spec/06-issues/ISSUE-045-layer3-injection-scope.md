---
id: ISSUE-045
title: Layer-3 memory-injection scoping — per-agent scope + clearance filter + volume bound
epic: E — prompt
status: blocked
github: "#45"
---

# ISSUE-045 — Layer-3 memory-injection scoping — per-agent scope + clearance filter + volume bound

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Define **what memory reaches an agent in Layer 3** — retrieved memory presented as Business Context,
narrowed by the agent's `memory_scope`, filtered by sensitivity clearance (never above-clearance, never
auto-inject Restricted), and capped at a configurable per-task volume — as the C4 **content contract** that
the C2 retrieval mechanism (ISSUE-025) enforces before ranking.

## 2. Scope — in / out
**In:** The **Layer-3 content contract** — the rules governing which memories may appear in an assembled
Layer 3 and how many. Concretely: (a) Layer 3 **carries the retrieved memories** for the task, presented
to the agent as Business Context (FR-4.INJ.001); (b) **per-agent scoping** — an agent receives only memories
within its configured `memory_scope`, so e.g. the finance agent never sees campaign memories (FR-4.INJ.002),
expressed as the agent-scope retrieval predicate applied within clearance; (c) **sensitivity-clearance
scoping** — an agent running without a given clearance never receives memory of that sensitivity, Restricted
is never auto-injected, and the filter runs **before** ranking, never after (FR-4.INJ.003), with the
containment-breach halt-and-audit path when an above-clearance/Restricted memory nonetheless reaches an
assembled Layer 3 (AC-4.INJ.003.3); (d) the **Layer-3 volume bound** — at most `memories_injected_per_task`
memories injected, a configurable per-task token-cost lever (FR-4.INJ.004). This slice owns the C4 *scope +
volume rules* and the assertions that the C2/C5 read flow honours them; it also owns proving the
fail-closed and `S ∩ C` postures (NFR-SEC.011) and the injection cap (NFR-PERF.006) hold at the Layer-3
boundary.

**Out:** The **memory retrieval mechanism itself** — dual search, candidate filters, the clearance/visibility
filter step, ranking, trim, injection formatting, and the agent-scope predicate acceptance (FR-2.RET.001–006,
incl. FR-2.RET.004 clearance-before-ranking and its OD-081 agent-scope branch) — is **ISSUE-025** (blocked-by;
this slice specifies the Layer-3 scope those predicates must satisfy, it does not build the pipeline). The
**runtime prompt-stack assembly** that invokes the memory read flow and stores the result in the envelope's
`memory_retrieved` (FR-5.ASM.006), and the assembly-time required-element halt (FR-4.LYR.004 / FR-5.ASM.003),
*execute* in **ISSUE-053** (C5 run pipeline). The **clearance/visibility/Restricted model and RLS** are
**C1 → ISSUE-019 / ISSUE-020** (FR-1.CLR.006, FR-1.RST.003 — consumed here as the rule). The **`agents`
registry and `memory_scope` column** and the per-agent memory-scoping retrieval filter as an agent-design
concern are **C8 → ISSUE-063** (FR-8.SCO.001); this slice consumes `agents.memory_scope`, it does not author
the registry. **Layer-1/Layer-2/Layer-4 content** are **ISSUE-043 / ISSUE-044**. The `prompt_layers` store,
version discipline, and pinning are **ISSUE-042**.

> **Integration note (bundled FRs).** INJ.002 (per-agent scope) and INJ.003 (clearance scope) are **two
> composing predicates over the same candidate set**, and the composition is the security posture
> NFR-SEC.011 states: the returned set is `memory_scope ∩ clearance`, the agent-scope filter **narrows within
> clearance and never widens it**, and an unresolved `memory_scope` **fails closed** (retrieval denied, never
> defaulted to all). Both filters run **before** ranking (INJ.003 / FR-2.RET.004) so nothing out-of-scope is
> ever ranked-then-stripped (a leak via ordering/scores). INJ.004's volume cap applies to what survives both
> filters — bound the *cleared, in-scope* set, never pad it. Build the clearance filter and the agent-scope
> filter as one pre-ranking narrowing step, then the cap on the ranked survivors; the mechanism lives in
> ISSUE-025's read flow — this slice asserts the Layer-3 output honours all three (scope, clearance, cap) and
> that a bypass is a containment breach (AC-4.INJ.003.3), not a silent send.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-4.INJ.001, FR-4.INJ.002, FR-4.INJ.003, FR-4.INJ.004 (Component 4 — Prompt; Layer-3 Memory
  Injection scoping + volume bound).
- **NFRs:** NFR-SEC.011 (`service_role` blast radius bounded — fail-closed on unresolvable scope; returned
  set = `memory_scope ∩ clearance`; Restricted never auto-injected); NFR-PERF.006 (memory-injection cap =
  `memories_injected_per_task`, the FR-4.INJ.004 volume bound).
- **Rests on:** ADR-007 (containment-first posture — an above-clearance/Restricted memory in an assembled
  Layer 3 is a containment breach, halt-and-audit); ADR-002 (memory injected as context feeding the
  Cited/Inferred answer modes); OD-081 (the agent-scope predicate narrows within clearance before ranking).
  Consumed rules: FR-1.CLR.006 (clearance + visibility enforced before ranking), FR-1.RST.003 (Restricted
  never auto-injected), FR-2.RET.004 (the retrieval-side mechanism that realises both). No build-time
  viability gate holds any FR in this slice.

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-4.INJ.001.1 (retrieved memories appear in Layer 3, labelled Business Context)
- AC-4.INJ.002.1 (memory of a category outside the agent's scope never appears in Layer 3)
- AC-4.INJ.003.1 (no above-clearance memory in Layer 3; excluded before ranking, never ranked-then-hidden)
- AC-4.INJ.003.2 (Restricted memory never auto-injected — consistent with FR-1.RST.003)
- AC-4.INJ.003.3 (above-clearance/Restricted memory reaching an assembled Layer 3 = containment breach → halt-and-audit, never silent)
- AC-4.INJ.004.1 (at most `memories_injected_per_task` memories injected into Layer 3)
- AC-NFR-SEC.011.1 (unresolvable `memory_scope` → retrieval denied, fail-closed, not defaulted to all)
- AC-NFR-SEC.011.2 (returned set = `memory_scope ∩ clearance`; Restricted never auto-injected)
- AC-NFR-PERF.006.1 (at most `memories_injected_per_task` (default 7) injected, drawn from the top of the ranked set)
- **Gating spikes (if any):** none — no launch-gating spike (ISSUE-001..006) and no build-time AF gates this
  slice. (Blocked-by ISSUE-042 and ISSUE-025 are feature issues, not spikes.)

## 5. Touches (complete blast radius, by ID)
- **DATA:** `prompt_layers` rows where `layer='memory'` (schema.md §5) — the Layer-3 content this slice
  scopes/bounds; reads `memories` (schema.md §3, its `sensitivity`/`visibility`/entity fields) as the
  candidate source and `agents.memory_scope` (schema.md §9) as the scope predicate. No new column; no DDL
  change (ISSUE-042 owns `prompt_layers`, ISSUE-022/023 own `memories`, ISSUE-063/C8 own `agents`).
- **PERM:** none new. *(Clearance is the C1 sensitivity model consumed via FR-1.CLR.006 / FR-1.RST.003, not a
  new PERM node.)*
- **CFG:** `memories_injected_per_task` (LIVE, int 1–50, default 7 — the Layer-3 volume bound, FR-4.INJ.004 /
  NFR-PERF.006). *(Consumed alongside ISSUE-025's ranking/retrieval knobs; owned as the injection cap here.)*
- **UI:** none. *(Layer 3 is assembled at runtime, not operator-edited; there is no Layer-3 editor surface.)*
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-04-prompt.md — FR-4.INJ.001–004 text and their ACs (the INJ area), plus
  doc-reconciliation note 5 (clearance filter is C1 rule / C2 mechanism) and the seams list (Layer-3 scope
  vs the C2/C5 gate)
- spec/01-requirements/component-02-memory.md §RET — FR-2.RET.004 (clearance + visibility before ranking,
  incl. the OD-081 agent-scope branch) + FR-2.RET.006 (inject as Business Context, Restricted never
  auto-injected): the retrieval mechanism this slice's scope rules constrain
- spec/04-data-model/schema.md §3 (Memory — C2), §5 (Prompt Content — C4), §9 (Agent Design — C8) — the
  `memories` candidate source, the `prompt_layers` `layer='memory'` rows, and `agents.memory_scope`
- spec/05-non-functional/security.md — NFR-SEC.011 (`memory_scope ∩ clearance`, fail-closed, Restricted
  never auto-injected)
- spec/05-non-functional/performance.md — NFR-PERF.006 (memory-injection cap)
- spec/00-foundations/adr/ADR-007-injection-posture.md — the containment-first posture behind the
  above-clearance/Restricted breach path (AC-4.INJ.003.3)

## 7. Dependencies
- **Blocked-by:** ISSUE-042 (prompt layer model + `prompt_layers` store — this slice scopes/bounds the
  `layer='memory'` content that store holds); ISSUE-025 (retrieval + ranking + clearance-before-ranking +
  answer modes — the C2 read flow, incl. FR-2.RET.004's clearance/visibility filter and its OD-081
  agent-scope predicate, that this slice's Layer-3 scope + cap rules constrain and assert). Neither is a
  spike.
- **Blocks:** ISSUE-053 (C5 run pipeline — FR-5.ASM.006 invokes the memory read flow, applies the agent's
  `memory_scope` as the additional retrieval predicate, and stores the result in the envelope's
  `memory_retrieved`; it relies on this slice's Layer-3 scope + clearance + volume contract and the
  fail-closed/breach postures).

## 8. Build order within the slice
1. **Layer-3 carries retrieved memory (FR-4.INJ.001)** — assert the assembled `layer='memory'` content is
   the retrieved set, labelled Business Context. → AC-4.INJ.001.1.
2. **Clearance/sensitivity scope (FR-4.INJ.003)** — assert the read flow's pre-ranking clearance+visibility
   filter (ISSUE-025 / FR-2.RET.004) drops above-clearance candidates *before* ranking and never
   auto-injects Restricted (FR-1.CLR.006 / FR-1.RST.003 are the consumed rule). → AC-4.INJ.003.1/.2.
3. **Per-agent scope (FR-4.INJ.002)** — assert the agent's `memory_scope` predicate narrows the cleared set
   (finance agent ≠ campaign memories), applied before ranking as an additional narrowing within clearance
   (OD-081), and that an unresolvable scope **fails closed** (retrieval denied, not all) — the returned set
   is `memory_scope ∩ clearance`. → AC-4.INJ.002.1; AC-NFR-SEC.011.1/.2.
4. **Volume bound (FR-4.INJ.004)** — cap the injected set at `memories_injected_per_task` (LIVE, default 7),
   drawn from the top of the ranked survivors of steps 2–3 — bound the cleared, in-scope set, never pad it.
   → AC-4.INJ.004.1; AC-NFR-PERF.006.1.
5. **Containment-breach guard (AC-4.INJ.003.3)** — if an above-clearance/Restricted memory nonetheless
   appears in an assembled Layer 3 (filter bypass/misconfig), treat it as a containment breach:
   halt-and-audit, never a silent send (ADR-007; breach enforcement is the C2/C5 seam this slice asserts).
6. **Tests to the ACs** — the DoD list above.

## 9. Verification (how DoD is proven)
- **Retrieval/integration layer** (per spec/05-non-functional/test-strategy.md): against ISSUE-025's read
  flow, a scoping matrix proving Layer 3 = the cleared, in-scope, capped set — above-clearance dropped
  before ranking (AC-4.INJ.003.1), Restricted never auto-injected (AC-4.INJ.003.2), out-of-scope category
  absent (AC-4.INJ.002.1), and the intersection posture `memory_scope ∩ clearance` (AC-NFR-SEC.011.2).
- **Fail-closed test:** an agent whose `memory_scope` cannot be resolved → retrieval **denied**, not
  defaulted to all (AC-NFR-SEC.011.1) — the fail-closed invariant.
- **Volume/cap test:** with a per-task limit of N (default 7), at most N memories reach Layer 3, drawn from
  the top of the ranked set (AC-4.INJ.004.1 / AC-NFR-PERF.006.1).
- **Containment-breach test:** an injected above-clearance/Restricted memory triggers halt-and-audit, never
  a silent send (AC-4.INJ.003.3) — proves the breach path, not just the happy filter.
- No launch-gating spike and no build-time AF gates this slice; the `AC → Verified` path is the retrieval
  scoping + fail-closed + cap + breach suites above.
