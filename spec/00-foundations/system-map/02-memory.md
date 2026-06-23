# Zoom-in: C2 Memory — "what the AI knows"

This opens up steps 4 (context assembled) and 7 (remember) of the overview route. It reflects
the accepted ADRs: ADR-002 (Maturity / Retrieval Sufficiency), ADR-003 (write-path model routing
+ cost), ADR-004 (write concurrency). Where this map and a future requirement disagree, the
requirement wins and this map gets updated (change control).

## What memory is

Three durable kinds + the transient one:
- **Semantic** — facts ("Acme budget is $8k/mo")
- **Episodic** — events ("call with Sarah on 17 Jun, raised reporting concerns")
- **Procedural** — how-to ("proposals always include 3 pricing tiers")
- **Working** — the live context window; gone unless written back

Every memory hangs off one or more **entities**, and carries **visibility** (global/team/private)
and **sensitivity** (standard/confidential/personal/restricted). The **Memory Agent is the only
writer** (ADR-004 invariant).

## WRITE flow — how something becomes a memory (step 7)

```
  an event happens (call, email, decision, tool result)
        ↓
  [code noise filter]            empty / system / duplicate → dropped, no model        free
        ↓
  [Haiku: selective-writing]     "worth remembering?"  most events die here            cheap
        ↓   (during the trust window: a "would-drop" is written + tagged, never lost)
  [Haiku: contradiction pre-check + sensitivity classify]                              cheap
        ↓
  [Sonnet: memory writer]        the ONE Sonnet call — drafts the memory(ies)          the cost
        ↓
  [validate-and-commit]          short txn under a per-entity advisory lock:
                                 re-check the entity watermark; if unchanged → commit,
                                 else re-run only the cheap DB contradiction check      ms-locked
        ↓
  written  (unique idempotency key blocks retry double-writes; supersede via CAS)
```
- **Cost shape (ADR-003):** ≤1 Sonnet call per *written* memory, wrapped in cheap Haiku. The
  Haiku gate must earn its keep (AF-043) and is audited in a shadow-retain trust window (ADR-003 §8).
- **Concurrency (ADR-004):** only *same-entity* writes serialize; disjoint writes run in parallel.
  Locks are held for milliseconds, never across an LLM call.

## READ flow — how memory reaches the AI (step 4)

```
  a task arrives
        ↓
  [extract entities]             which nouns is this about?
        ↓
  [dual search]                  keyword (this client, exactly) + vector (relevant, fuzzy)
        ↓
  [sensitivity + visibility filter]   BEFORE ranking — out-of-clearance memories never ranked
        ↓
  [rank & trim]                  recency · confidence · entity-match · vector sim (tunable weights)
        ↓
  [inject as Business Context]   prepended to the prompt (Layer 3)
        ↓
  [Retrieval Sufficiency check]  enough relevant, high-confidence memory for THIS query?
                                 if thin + entity Maturity low → [Building] flag, else [Unknown]
```

## Health, over time (background hygiene — daily/weekly)

- **Confidence lifecycle** — set at write by source type; drifts down with decay, up on
  confirmation; amber-zone alert before the floor.
- **Consolidation** — merge / supersede / summarise (episodic → semantic, evidence kept).
- **Decay** — stale unconfirmed memories lose confidence; never auto-deleted.
- **Erosion checks** — confidence / coverage / structural / relevance.
- **Maturity (ADR-002)** — `filled slots / expected slots` per entity → drives cold-start gating.

## Where the decisions / config / surfaces live (for traceability later)

- ADRs: 002 (maturity, sufficiency), 003 (write-path routing, cost ladder, Haiku audit), 004 (concurrency).
- Config (Phase 2): ranking weights, thresholds, decay, merge similarity, `memory_writes_per_minute`,
  Haiku gate/trust-window keys, price table. Surfaces (Phase 3): memory health dashboard,
  Haiku-decision review queue, ingestion queue. Feasibility: AF-002, AF-031, AF-034, AF-043, AF-061..063.
