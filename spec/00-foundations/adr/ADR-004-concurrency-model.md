# ADR-004 — Concurrency Model for Memory Writes

- **Status:** Accepted
- **Date decided:** 2026-06-23
- **Resolves:** OD-004
- **Affects:** Memory component (write flow / contradiction check / supersede), data model
  (`memories` table — new `entity_lock`/version + a unique idempotency constraint), Inngest
  job config (per-entity concurrency key), Guardrails (`memory_writes_per_minute` semantics),
  agents/orchestrator (the "Memory Agent is the only writer" invariant), config registry
  (`memory_write_*` keys). Feasibility AF-061 / AF-062 / AF-063. Builds on ADR-001 (one
  Supabase per deployment — concurrency is *intra*-deployment only) and ADR-003 (the write-path
  model routing: code filter → Haiku gate → Haiku pre-check → Sonnet writer).

## Context

The write flow is **check-then-act**: pull the 3–5 most similar existing memories, decide
no-conflict / soft-conflict / hard-conflict, then write (`L1604–1633`, esp. `L1608–1615`). The
soft-conflict path additionally **mutates an existing row** — it sets `superseded_by` on the
memory it replaces (`L1612`, `superseded_by uuid` at `L1451`). This is a textbook **TOCTOU**:
between the check and the write, another agent can write to the same topic, and neither check
sees the other's write.

The design doc both **creates** the race and **half-names** the fix:

- **Creates it:** `parallel_execution: true` (`L949`, `L2614`, `L3628`), Inngest **fan-out**
  (one event → research + memory + CRM jobs simultaneously, `L2650–2652`), and "multiple loops
  running simultaneously, multiple agents firing in parallel" at scale (`L2115`). A standard
  task-graph step ends in a memory write (`L3346`, `L2541–2553` step 6), so parallel steps =
  parallel writes.
- **Half-names the fix:** the **Memory Agent** is "dedicated to memory management… Other agents
  hand raw events to this one **rather than writing memory themselves**" (`L3435`). That is a
  *single-writer-queue* intent — but the doc never says writes are serialized, never defines a
  lock, transaction, version, or idempotency key for the memory write itself, and leaves the
  **daily supersede job** (`L1782`) as the only conflict backstop — which runs *hours* after the
  race window, not during it.

What a same-entity race actually produces today:
1. **Duplicate memories** — two writers both see "no conflict," both insert. (The weekly merge
   job, `L1780`, only catches this if similarity ≥ 0.92 — and hours later.)
2. **Lost supersession** — two writers both decide "soft conflict" against the same target row
   and both set `superseded_by`; last-write-wins silently drops one chain link.
3. **Double-write on retry** — Inngest retries a failed step (`L2579–2581`, `L2657`); without a
   DB-level idempotency key on the memory write, the retry re-inserts.

The hard part — and the reason this can't be "just wrap it in a transaction":

> **The check involves a Sonnet writer call (seconds). You cannot hold a database transaction
> or row lock open across an LLM call** — it exhausts the connection pool under fan-out and
> burns ADR-003 budget while idle. So the lock must wrap only the *cheap DB validate-and-commit*,
> not the LLM reasoning.

Scope note (ADR-001): each deployment is **one Supabase** with **one** logical Memory Agent role.
This is **intra-deployment** concurrency (parallel steps/loops inside one client), **not**
cross-deployment distributed consensus. That keeps the problem inside a single Postgres, where
its locking primitives are available and sufficient.

A contradiction is **always about the same entity/topic** — two memories that touch disjoint
entities are not in conflict. So the *only* race that threatens correctness is the
**same-entity** race. The model below serializes exactly that and lets everything else run wide.

## Options considered

**A — Do nothing; rely on the daily supersede + weekly merge jobs (`L1782`, `L1780`).**
The doc's de-facto current state. Pros: zero build. Cons: duplicates and lost supersessions live
for **hours**; merge only catches ≥0.92 similar; supersede can't reconstruct which write should
have won. The "business brain" silently disagrees with itself for a day. **Rejected** — backstop,
not a correctness mechanism.

**B — Global single-writer queue (serialize *all* memory writes, concurrency = 1).**
Literal reading of `L3435`. Pros: dead simple, TOCTOU gone by construction. Cons: throws away
fan-out (`L2650`) and `parallel_execution` for the one step that ends most task graphs; a slow
Sonnet writer on entity A blocks an unrelated write to entity B. **Rejected** — over-serializes;
punishes disjoint writes for no correctness gain.

**C — Pessimistic row locks across check+write (`SELECT … FOR UPDATE` wrapping the LLM call).**
Pros: textbook correctness. Cons: (1) holds a DB transaction open across a multi-second Sonnet
call → pool exhaustion under fan-out, the exact failure named above; (2) the "check" is a **vector
ANN search**, not a row read — `FOR UPDATE` locks rows you already found, not the *region of
semantic space* a concurrent writer might insert into, so it doesn't even prevent the duplicate
insert. **Rejected** — wrong lock granularity and wrong hold duration.

**D — Optimistic concurrency only (version column, detect conflict at commit, retry).**
Pros: no held locks, LLM stays unlocked. Cons alone: a version check on an existing row catches
the **lost-supersession** case but **not the duplicate-insert** case — two brand-new memories
have no shared row to conflict on. Necessary but **insufficient by itself**.

**E — Per-entity serialization + optimistic validate-and-commit (chosen).** Serialize only
**same-entity** writes; run all LLM work unlocked; close the TOCTOU window with a **short**
transaction that re-validates under a per-entity advisory lock and commits. Combines the correct
parts of B (serialize the thing that races), C (a real lock — but held for milliseconds, not
seconds), and D (optimistic version check). Details below.

## Decision

Adopt **Option E**. Five binding parts:

**1. The Memory Agent is the *only* writer (invariant, not a suggestion).**
Lock `L3435` as a hard rule: no specialist/orchestrator agent writes the `memories`/`entities`
tables directly; they hand raw events to the Memory Agent write path (ADR-003: code filter →
Haiku gate → Haiku pre-check → Sonnet writer). This gives one code path to make safe.

**2. Serialize per *entity*, not globally.**
Writes touching **disjoint** entity sets run in parallel (fan-out preserved). Writes touching the
**same** entity serialize. Mechanism = **Postgres transaction-scoped advisory locks**, one per
`entity_id` in the write's `entity_ids` array (`L1445`), **acquired in sorted order** (deadlock-free)
at the top of the commit transaction:
`SELECT pg_advisory_xact_lock(hashtext(eid)) for eid in sort(entity_ids)`.
A coarse Inngest **per-entity concurrency key** sits on top as an optimization to reduce lock
contention, but the advisory lock — not the queue — is the correctness boundary (the queue can't
express multi-entity locking; the lock can).

**3. LLM work runs UNLOCKED; only a short validate-and-commit transaction is locked.**
The shape (this is the core of the ADR):
   - **(outside any txn)** Read a per-entity watermark `v0 = max(updated_at)` over the touched
     entities' memories. Run the contradiction pre-check (Haiku) and the writer decision (Sonnet)
     against the top-3–5 similar set. Produce a *proposed* write (insert, or insert + supersede target).
   - **(short txn, advisory-locked per §2)** Re-read the watermark `v1`. **If `v1 == v0`** → no
     same-entity write landed during the LLM call → commit the proposal as-is. **If `v1 != v0`**
     → a concurrent same-entity write committed; **re-run only the cheap DB contradiction check**
     (the vector top-k re-query, no LLM) over the now-current set and either commit, re-target the
     supersede, or bounce to the verification queue. Locks are held for **milliseconds**, never
     across an LLM call.

**4. Idempotent writes (kills the retry-duplicate).**
Every memory write carries an idempotency key = `hash(source_ref, sorted entity_ids, content_hash)`
derived from the step's existing idempotency key (`L2579`) / Inngest unique event id (`L2657`).
A **unique constraint** on that key makes a retried step a no-op insert (`ON CONFLICT DO NOTHING`),
tying the doc's task-level idempotency down to the row level it currently lacks.

**5. Guard the supersede mutation with a conditional update (CAS).**
The soft-conflict path sets `superseded_by` only `WHERE superseded_by IS NULL`. If two writers
race to supersede the same target, the loser's update affects 0 rows → it re-enters the §3
re-validation (now sees the supersession) and re-decides. Cheap compare-and-swap on the one
mutating column; backstops the version check for the specific lost-supersession case.

**Backstops unchanged but demoted:** the daily supersede (`L1782`) and weekly merge (`L1780`) jobs
**stay**, but are now **hygiene** (fuzzy/cross-entity cleanup the lock can't see), no longer
load-bearing for same-entity correctness.

**`memory_writes_per_minute: 30` (`L974`) makes serialization free.** 30/min ≈ one write per 2s;
even fully serialized, same-entity writes never queue meaningfully. The cap is the safety ceiling;
per-entity serialization runs far below it. No throughput objection survives.

## Consequences

**Becomes true / required:**
- **Data model:** `memories` gets (a) an idempotency column + **unique constraint** (§4), (b)
  reliance on `updated_at` as the per-entity watermark (§3) — index `(entity_ids, updated_at)`
  to make the watermark + top-k cheap. `superseded_by` update path becomes conditional (§5).
- **Memory FRs:** the write flow FR must specify the unlocked-LLM / locked-commit split (§3),
  sorted advisory-lock acquisition (§2), the idempotency key derivation (§4), and the CAS
  supersede (§5). A negative FR: "no agent other than the Memory Agent writes memory."
- **Config:** `memory_write_serialization: per_entity` (vs `global`/`off` for debugging), and the
  existing `memory_writes_per_minute: 30` is reaffirmed as the ceiling, not the concurrency model.
- **Inngest job config:** memory-write function gets a concurrency key on primary entity (§2 opt).

**Ruled out:** global write serialization (B); locks held across LLM calls (C); optimistic-only
with no per-entity serialization (D); leaving correctness to the daily/weekly jobs (A).

**Feasibility (paper until proven):**
- **AF-061 (SPIKE/EVAL):** the optimistic validate-and-commit actually closes the window —
  the `v0≠v1` re-check catches same-entity races without livelock / excessive re-runs under
  realistic fan-out. The whole correctness claim rests on this.
- **AF-062 (LOAD):** sorted per-entity advisory locks + short commit txns don't bottleneck under
  fan-out at scale (`L2115`), and multi-entity writes (locking 2–3 entities each) stay deadlock-
  free and contention-light.
- **AF-063 (DOCS/SPIKE):** Inngest per-key concurrency does what we assume (serializes same-key
  steps) — and degrades safely to "advisory lock alone" if it doesn't, since the lock is the real
  boundary.

**Spawns:** no new OD. Glossary gains: *TOCTOU race*, *Per-entity serialization*, *Advisory lock
(transaction-scoped)*, *Optimistic validate-and-commit*, *Idempotency key (memory write)*. The
"Memory Agent is sole writer" invariant should be cross-referenced from the agents component when
Phase 1 reaches it.
