# Component 2 — Memory System: the business brain (FRs)

> **Third component, pattern-matched to the C0/C1 exemplars.** **C2 = "what the AI knows."**
> It is the heart of the system — the durable, multi-entity, sensitivity-tagged knowledge base
> that every task reads from (step 4, *context assembled*) and writes back to (step 7, *remember*).
> C2 **consumes** the C1 authorization model (clearances, visibility, Restricted, the `(select …)`
> RLS pattern) and **owns the mechanisms C1 only stated the rule for**: tagging a memory with a
> sensitivity tier + entity type, the retrieval pipeline that enforces clearance-before-ranking,
> never-auto-inject-Restricted, and the `service_role` sole-writer path whose mid-task authorization
> C1 governs (FR-1.RLS.007). C2 is the spec home of **ADR-002** (Maturity / Retrieval Sufficiency),
> **ADR-003** (write-path routing + cost), and **ADR-004** (write concurrency).

**Status:** 🟢 **Approved** — **57 FRs** (56 Approved + 1 v2-deferred) decomposed, cited, resolved; **OD-032…OD-038 resolved** (OD-034 → cold storage deferred OOS-016; OD-038 → erasure rule homed here as FR-2.MNT.017, backups seamed to Phase 5); **verification gate run + reconciled**. New **AF-082** (entity-resolution accuracy); **OOS-016/017** logged.
**Sign-off:** ☑ **Approved 2026-06-25, user-authorized** — OD resolution delegated C0/C1-style; OD-034 + OD-038 (the two scope/legal calls) decided by the user directly; verification-gate findings reconciled in-file.
**Drafted / resolved:** 2026-06-25.

> **Verification gate (2 zero-context subagents, 2026-06-25):**
> - **Orphan/contradiction pass CLEAN** — all design intents L1338–1967 mapped; the 3 deferrals (cold storage, re-rank/HyDE, structured-extraction/query-decomposition) correctly logged as OOS-016/003/017; **no contradictions** with ADR-001/002/003/004/006/007 or the consumed C1 FRs; all 5 trap areas PASS (Filter1/2≠3rd-layer · no sole-writer bypass · no golden-rule copy · no Restricted-auto-inject/rank-then-hide · WRT.006 faithful to ADR-004). One **citation slip** (Personal-no-consolidation rule was cited L1407, corrected to **L1414**) + a cross-ref slip (MNT.009→**MNT.008**, MNT.016→**MNT.014**) — both fixed.
> - **Quality/failure pass found 7 findings, ALL reconciled:** +**FR-2.WRT.007** (embedding-failure halts commit, never stores a null/invalid embedding — F1); +**AC-2.WRT.006.3** (mid-task revocation re-check at the commit boundary, realizing C1 FR-1.RLS.007 — F2); +**FR-2.ING.003** escalation AC + `CFG-review_escalation_days` and the now-defined `CFG-ingest_defer_resurface_days`, + **FR-2.MNT.010** scans the ingestion queue + null-embedding rows (F3, closes a Rule-0 dangling decision); +**FR-2.MNT.017** transitive erasure across the supersede chain + merged/summarised derived rows (+AC-2.MNT.017.3 — F4); +escalation ACs on **FR-2.WRT.002 / FR-2.MNT.014** (F5); +**FR-2.WRT.006** lexical-recheck note pointing at the FR-2.MNT.006 daily backstop (F6); +**AC-2.VEC.003.2** re-embed completeness gate (F7). Confirmed-adequate: clearance-before-ranking, Restricted, golden rule, decay-never-deletes, evidence layer, sole-writer.

> **Spine:** three ADRs converge here. **ADR-002** fixes the metrics (Maturity drives cold-start
> gating; Retrieval Sufficiency drives the `[Building]` flag). **ADR-003** fixes the write-path cost
> shape (≤1 Sonnet writer wrapped in cheap Haiku gates; "controls before gates"; the selective-writing
> gate audited in a shadow-retain trust window). **ADR-004** fixes write concurrency (Memory Agent =
> sole writer as `service_role`; per-entity serialize + optimistic validate-and-commit). Where a FR
> restates an ADR part, it cites it rather than re-deciding it.

---

## Context Manifest (load only these)

| Dependency | What it constrains here |
|---|---|
| **ADR-002** (Maturity / Retrieval Sufficiency) — metrics spine | "Coverage %" is split into **Maturity** (`filled slots / expected slots` per entity, stored, daily + on-write — drives cold-start gating 20/50/80) and **Retrieval Sufficiency** (query-time, thin threshold over retrieval signals — drives the `[Building]` flag). 5–8 operator-editable **expected knowledge slots** per entity type are the Maturity denominator. ⚠️ AF-034. |
| **ADR-003** (write-path routing + cost; "controls before gates") | Memory write = **≤1 Sonnet call** (the writer) wrapped in **cheap Haiku** pre-checks. The **one** self-funding Haiku gate is **selective-writing** (relevance); it must earn its keep (⚠️ AF-043) and is audited in a **3-week shadow-retain trust window** (§8). Re-rank / HyDE **not** mandated (OOS). Estimate-grade cost tracking; the tiered cost ladder is the runaway backstop. |
| **ADR-004** (Memory Agent = sole writer; concurrency) | The **Memory Agent is the only writer** (invariant, design `L3435`), running as **`service_role`** (off the RLS path, governed by harness RBAC). Same-entity writes serialize via **sorted per-entity advisory locks**; the slow Sonnet writer runs **unlocked**, then a short txn re-checks a per-entity watermark and commits (**optimistic validate-and-commit**). Unique idempotency key kills retry double-writes; CAS supersede (`WHERE superseded_by IS NULL`) kills lost supersession. ⚠️ AF-061/062/063. |
| **ADR-001 §3/§4** (Silo isolation) + **Golden rule** (`L1634`, glossary) | One Supabase per client → cross-client isolation is **physical**, never an RLS predicate. **Golden rule:** source files/records live in their system of record (GHL/Drive/Slack); memory stores **pointers (`source_ref`) + enrichment, never a copy of the source binary/record** — so ingestion "points, doesn't copy," and recent loss is re-derivable by re-ingestion (ADR-008). |
| **ADR-006 + C1** (`component-01-rbac.md`) — authorization C2 consumes | **FR-1.CLR.001** (the four sensitivity tiers + semantics) · **FR-1.CLR.004** (entity-type-scoped clearance) · **FR-1.CLR.006** (clearance + visibility enforced **before ranking/injection**) · **FR-1.RST.003** (Restricted never auto-injected) · **FR-1.RLS.003** (RLS row-access subset on `memories`, intra-client) · **FR-1.RLS.007** (a `service_role` task halts+quarantines on mid-task deactivation/clearance-revoke before a consequential side effect) · **FR-1.AUD.001** (Personal/Restricted access → `access_audit`). C2 supplies the **mechanism**; C1 owns the **rule**. The hot-path performance of the live clearance predicate composing with pgvector ranking is **⚠️ AF-067**. |
| **ADR-007** (containment-first) | Sole-writer + sensitivity-gated memory are named by ADR-007 as part of the **containment boundary**: a successful prompt injection cannot poison memory because the write path ignores prompt content where it matters (sole writer, human-gated sensitivity, idempotency). |
| **Standards:** `migration-discipline.md`, `config-edit-taxonomy.md`, `rbac.md` | Embedding-model change = an **expand-contract** migration (new column, backfill, switch, drop — zero downtime). Every memory tunable is a config key (Phase 2) classified per the edit taxonomy. Clearance/visibility enforcement follows `rbac.md`. |
| **Feasibility** | **AF-002** (retrieval surfaces relevant, low-noise memory; validates ranking weights) · **AF-019** (pgvector HNSW perf — RLS/WHERE filters apply **after** the ANN scan, so per-client RLS can starve recall; LOAD-test **with predicates applied**) · **AF-031** (writer produces clean type splits + sensible confidence) · **AF-034** (slot-fill Maturity predicts usefulness; Sufficiency cleanly separates `[Building]`/`[Unknown]`) · **AF-043** (the Haiku selective-writing gate pays for itself + is trustworthy) · **AF-061/062/063** (validate-and-commit closes the window; locks don't bottleneck; Inngest per-key concurrency) · **AF-067** (live clearance predicate composes with pgvector on the hot path) · **NEW AF-082…** (this session). |
| **Design doc** | `design-doc-v4.md` **L1338–1967** (the Memory System: types/entities L1342–1455, the orthogonal tags L1400–1420, the two ingestion filters L1569–1601, the write flow L1604–1658, confidence lifecycle L1666–1695, retrieval L1703–1772, maintenance L1780–1900, the three ingestion pipelines + init sequence L1908–1946, optimisations L1952–1965) + the C2 checklist overview **L222–243** + the memory config block **L906–926** + embedding/vector **L73–78, L1037, L1487–1559**. |

## Area codes

| Code | Area |
|---|---|
| **MEM** | Memory model — the four types, the memory row schema |
| **ENT** | Entities — the entity model, per-deployment entity types, the Internal Org entity, entity schema, entity resolution |
| **TAG** | Visibility × sensitivity tagging — the two orthogonal axes, write-time assignment, defaults (C2 owns *tagging*; C1 owns the *clearance/access* model) |
| **ING** | Ingestion — Filter 1 (relevance), Filter 2 (sensitivity), the ingestion queue, the three pipelines, the initialisation sequence, the no-backdoor rule |
| **WRT** | Write flow — sole writer, contradiction check, the memory writer, the golden-rule pointer, confidence assignment, validate-and-commit, the Haiku selective-writing gate |
| **RET** | Retrieval & ranking — entity extraction, dual search, the candidate filters, clearance-before-ranking, the ranking formula, injection, answer modes / Retrieval Sufficiency |
| **MNT** | Maintenance — confidence lifecycle, decay, expiry, merge, supersede, summarise, conflict-resolution priority, the erosion checks, cold storage, the schedule, no-silent-failure |
| **VEC** | Vector index & embeddings — HNSW, the embedding model, the re-embedding migration |
| **MAT** | Maturity & Retrieval Sufficiency — expected slots, recompute, cold-start gating, the `[Building]` flag (ADR-002 home) |

## Doc-reconciliation — carry these into the FRs (do not re-derive from prose)

1. **The two design filters map onto ADR-003's Haiku layer.** Design **Filter 1 (relevance, L1569–1583)** = ADR-003's **selective-writing Haiku gate** (the one self-funding gate, §4/§6) — audited in the shadow-retain trust window (§8). Design **Filter 2 (sensitivity, L1585–1601)** = the Haiku **sensitivity classify + contradiction pre-check** before the Sonnet writer. So C2 specs the *behaviour* the design states and *cites ADR-003* for the model tier + the trust-window audit — it does not introduce a third filter.
2. **Golden rule governs ingestion (L1634).** All three pipelines **point, don't copy**: structured/system-of-record data becomes an entity + a `source_ref` pointer + enrichment, never a copied record/binary (glossary "Golden rule"; ADR-008 scope). `system_pointer` memories are unscored.
3. **Sole writer is an invariant, not a choice (ADR-004).** Every memory — including those from all three ingestion pipelines and direct human dashboard writes — flows through the Memory Writer + contradiction check + sensitivity filter. **Ingestion is not a backdoor** (L1908). The only non-writer path is a human *editing/verifying* an already-written memory (which is itself audited, C1).
4. **Restricted is never a memory's auto-path (C1).** C2 *tags* a memory's sensitivity at write (TAG.002) but **never autonomously assigns Restricted** (L1418) — Restricted classification requires human confirmation; Restricted retrieval is governed by FR-1.RST.003 (never auto-injected) + FR-1.RST.001 (per-individual grant).
5. **Clearance/visibility filtering is C1's rule, C2's mechanism (FR-1.CLR.006).** The retrieval pipeline applies the visibility + sensitivity filter **before ranking, never after** (L1725) — C2 builds the filter step; C1 defines what passes it.
6. **Maturity slots are ADR-002's, homed as data here (MAT.001).** The 5–8 expected knowledge slots per entity type are operator-editable config (glossary "Expected knowledge slot"); C2 stores them and computes Maturity, it does not re-decide the metric.

---

# MEM — Memory model

### FR-2.MEM.001 — Four memory types: semantic, episodic, procedural, working
- **Statement:** The system shall model four memory types — **semantic** (facts), **episodic** (events), **procedural** (how-to), and **working** (the transient active context) — and shall durably store the first three; working memory is transient unless deliberately written back.
- **Source:** design-doc-v4.md L1342–1349
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (definitional; consumed by WRT/RET).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: a written memory carries `type ∈ {semantic, episodic, procedural}` (`DATA-memories.type`); working memory lives only in the live task context and is persisted only by becoming a written memory via the write flow (FR-2.WRT.003).
  - Branches: one event may yield several memories of different types in one write (L1636–1658) — e.g. a call → a semantic fact + an episodic log + a procedural refinement.
  - Edge / failure: working-memory state that is never written back is **expected loss**, not a failure (it is transient by definition); anything worth keeping must pass the write flow.
- **Data touched:** `DATA-memories` (type field).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** memory-health dashboard (Phase 3) groups by type.
- **Observability:** —
- **Acceptance criteria:**
  - AC-2.MEM.001.1 — Given a written memory, When stored, Then its `type` is exactly one of semantic/episodic/procedural.
  - AC-2.MEM.001.2 — Given working-memory context, When the task ends without a write-back, Then nothing persists.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-031 (the writer produces clean, well-separated type splits).
- **Notes:** Cross-task carryover of *working* state (intermediate task scratch) is a **C8 agent-design** concern, not C2 — C2 only owns the durable three.

### FR-2.MEM.002 — The memory row schema
- **Statement:** The system shall store each memory as a row carrying id, type, content, embedding (vector 1536), entity_ids, source, source_ref, confidence (0.0–1.0), visibility, sensitivity, superseded_by, expires_at, created_at, updated_at.
- **Source:** design-doc-v4.md L1440–1455
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (schema; Phase 4 data-model authors the SQL).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: every memory row populates the fields per their domains — `source ∈ {ai_inferred, human_verified, system_pointer}`, `visibility ∈ {global, team, private}`, `sensitivity ∈ {standard, confidential, personal, restricted}`, `entity_ids uuid[]` (≥1), `confidence` numeric 0.0–1.0 (null for `system_pointer`).
  - Branches: `superseded_by` (nullable uuid) builds the traceable supersession chain (FR-2.MNT.007); `expires_at` (nullable) drives hard expiry (FR-2.MNT.005).
  - Edge / failure: a memory with an **empty** `entity_ids` is rejected — no memory exists without ≥1 entity (FR-2.ENT.001); a memory whose `embedding` dimensions ≠ the active model's is rejected (FR-2.VEC.002).
- **Data touched:** `DATA-memories` (defined here; SQL in Phase 4).
- **Permissions:** writes only via the sole writer (FR-2.WRT.001).
- **Config dependencies:** —
- **Surfaces:** memory detail view (Phase 3).
- **Observability:** —
- **Acceptance criteria:**
  - AC-2.MEM.002.1 — Given a memory row, When inspected, Then all schema fields are present with values inside their documented domains.
  - AC-2.MEM.002.2 — Given a memory with zero entity_ids, When a write is attempted, Then it is rejected.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** `DATA-memories` is the canonical store consolidated in Phase 4; C1's FR-1.RLS.003 attaches the visibility/sensitivity/Restricted RLS predicates to it. Structured typed-field extraction (L1960) is a v2 optimisation → OOS-017.

---

# ENT — Entities

### FR-2.ENT.001 — Every memory hangs off one or more entities
- **Statement:** The system shall require every memory to reference at least one entity, and shall organise all knowledge around entities as the foundational structure.
- **Source:** design-doc-v4.md L1353–1356, L1394
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every write (the writer resolves the relevant entities, FR-2.WRT.003).
- **Preconditions:** Referenced entities exist (or are created/resolved first, FR-2.ENT.005).
- **Behaviour:**
  - Happy path: the writer sets `entity_ids` to the resolved entities a memory is about; retrieval keys on entity match (FR-2.RET.002).
  - Branches: a memory about multiple entities (e.g. a deal involving a client + a contact) lists all of them.
  - Edge / failure: content with **no possible entity link** fails Filter 1 and is never written (L1583, FR-2.ING.001) — there is no entity-less memory.
- **Data touched:** `DATA-memories.entity_ids`, `DATA-entities`.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** entity browser (Phase 3).
- **Observability:** —
- **Acceptance criteria:**
  - AC-2.ENT.001.1 — Given a write, When stored, Then `entity_ids` has ≥1 valid entity.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.ENT.002 — Entity types are per-deployment config, with a documented default set
- **Statement:** The system shall ship a default set of entity types and shall let an operator customise the entity-type list per deployment as configuration, with no code change.
- **Source:** design-doc-v4.md L1353–1394 (default list), L1366 ("customizable per deployment")
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Operator configuring entity types at/after provisioning.
- **Preconditions:** `PERM-system.*` config authority (C1); the default list seeded.
- **Behaviour:**
  - Happy path: the default types seed at provisioning (Client, Contact, Team Member, Vendor/Partner, Campaign, Task, Deliverable, Template, Deal, Contract/Retainer, Invoice, Brand Guide, Audience, Channel, Team/Department, Meeting, SOP/Playbook, Tool/Platform, Goal/OKR, Financial Period, Lesson Learned, **Internal Org** — L1369–1394); an operator may add/rename/disable a type as data.
  - Branches: entity type is a free-text field on `DATA-entities.type` validated against the configured list.
  - Edge / failure: disabling an entity type in use must not orphan its memories (#1) — handle like a soft-disable (hidden for new writes, existing retained); confirm in OD-033 (resolution/lifecycle).
- **Data touched:** `DATA-entities.type`; entity-type config table.
- **Permissions:** config authority (C1).
- **Config dependencies:** `CFG-entity_types` (the configurable list).
- **Surfaces:** entity-type config (Phase 3).
- **Observability:** entity-type config change `audit`.
- **Acceptance criteria:**
  - AC-2.ENT.002.1 — Given a fresh deployment, When seeded, Then exactly the documented default entity types exist (incl. Internal Org).
  - AC-2.ENT.002.2 — Given an operator adds a custom entity type, When saved, Then memories can reference it with no deploy.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Each entity type carries its 5–8 **expected knowledge slots** (FR-2.MAT.001) — the Maturity denominator.

### FR-2.ENT.003 — The Internal Org entity is first-class, singular, and walled off from client agents
- **Statement:** The system shall create exactly one **Internal Org** entity per deployment at setup, link all internal-business knowledge to it, default its memories to Confidential or Restricted sensitivity, and ensure client-facing agents never access Internal Org memories.
- **Source:** design-doc-v4.md L1357–1363
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Setup (creates it); every retrieval (enforces the wall).
- **Preconditions:** Provisioning seed (with FR-2.ENT.002).
- **Behaviour:**
  - Happy path: one Internal Org entity is seeded at setup; founder/internal knowledge (the onboarding interview output) links to it; its memories default to Confidential/Restricted (TAG.002).
  - Branches: a client-facing agent task's retrieval **excludes** Internal Org memories — enforced by the clearance/visibility filter (FR-2.RET.004) treating Internal Org as out-of-scope for client contexts.
  - Edge / failure: a second Internal Org entity must never be created (singleton guard, ADR-004 pattern); an Internal Org memory leaking into a client-facing context is a #2 failure the filter must prevent.
- **Data touched:** `DATA-entities` (the singleton), `DATA-memories` (links).
- **Permissions:** internal-knowledge access gated by C1 clearances.
- **Config dependencies:** —
- **Surfaces:** entity browser (Internal Org is distinguished).
- **Observability:** any Internal Org memory access → `access_audit` where Confidential/Restricted (FR-1.AUD.001).
- **Acceptance criteria:**
  - AC-2.ENT.003.1 — Given a deployment, When provisioned, Then exactly one Internal Org entity exists.
  - AC-2.ENT.003.2 — Given a client-facing agent task, When memory is retrieved, Then no Internal Org memory is injected.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** This is *why* founder knowledge can outlive the founder's presence (L1363) — it is captured as Internal Org memories during onboarding (FR-2.ING.008).

### FR-2.ENT.004 — The entity row schema (with external_refs pointers)
- **Statement:** The system shall store each entity as a row carrying id (uuid), type (text, from config), name (text), external_refs (json), created_at — where external_refs holds cross-system identifiers (e.g. GHL ID, Slack ID, Drive folder).
- **Source:** design-doc-v4.md L1429–1436
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (schema).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: an entity created from a system of record records its source IDs in `external_refs` (golden rule — the pointer to where the real record lives).
  - Branches: `external_refs` may hold multiple systems' IDs for one entity (the same client in GHL + Drive + Slack).
  - Edge / failure: `external_refs` is the join key for entity resolution (FR-2.ENT.005) — a missing/duplicate ref is what causes entity fragmentation (OD-033).
- **Data touched:** `DATA-entities`.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** entity detail (Phase 3).
- **Observability:** —
- **Acceptance criteria:**
  - AC-2.ENT.004.1 — Given an entity from a system of record, When created, Then its `external_refs` records the originating system ID(s).
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.ENT.005 — Entity resolution: a mention maps to an existing entity or creates one, deterministically
- **Statement:** The system shall resolve an entity mention (from a task or ingested content) to the correct existing entity — preferring an `external_refs` match, then a deterministic name/type match — and shall create a new entity only when no confident match exists, so the same real-world entity is not fragmented across duplicates.
- **Source:** design-doc-v4.md L1353–1356, L1429–1436 (model); **mechanism unspecified → OD-033**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Entity extraction at write (FR-2.WRT.003) and at retrieval (FR-2.RET.001).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: a mention carrying a system ID resolves by `external_refs`; otherwise a normalised name + type match resolves it; a confident match links to the existing entity.
  - Branches: an ambiguous/low-confidence match → per OD-033, either flag for human confirmation or create-and-flag-for-merge (never silently guess into the wrong entity, #1).
  - Edge / failure: duplicate entities that slip through are caught by the **structural erosion** check (FR-2.MNT.010, duplicate clusters — *corrected 2026-07-01 from a stale FR-2.MNT.011 cross-ref; MNT.010 is structural erosion, MNT.011 is relevance erosion; surface-11 gate*) and a merge path.
- **Data touched:** `DATA-entities` (read/match/create).
- **Permissions:** resolution runs in the writer's `service_role` path.
- **Config dependencies:** an entity-match confidence threshold (Phase 2).
- **Surfaces:** an entity-merge / disambiguation queue (Phase 3).
- **Observability:** entity create + entity merge `audit`.
- **Acceptance criteria:**
  - AC-2.ENT.005.1 — Given a mention with a known external_ref, When resolved, Then it links to the existing entity (no duplicate created).
  - AC-2.ENT.005.2 — Given an ambiguous mention, When resolved, Then it is handled per OD-033 (never silently mis-linked).
- **Open decisions:** ✅ RESOLVED — OD-033 (the resolution/disambiguation/merge mechanism + ambiguity handling).
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-082 (entity resolution is accurate enough that the brain does not fragment into duplicate entities at scale — EVAL).
- **Notes:** Entity fragmentation is a direct #1 (knowledge-integrity) risk — split knowledge about one client across two entities silently degrades every retrieval about it.

---

# TAG — Visibility × sensitivity tagging

### FR-2.TAG.001 — Visibility axis (global / team / private), with defaults
- **Statement:** The system shall tag every memory with a visibility scope — global, team, or private — independent of its sensitivity, defaulting to global for business knowledge and private for personal/sensitive content.
- **Source:** design-doc-v4.md L1400–1404, L1862–1866
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The writer at write time (FR-2.WRT.003).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: business knowledge → `visibility = global`; personal/sensitive → `visibility = private`; team-scoped knowledge → `team`.
  - Branches: visibility is enforced at retrieval **with** sensitivity (FR-2.RET.004) — the two are orthogonal (FR-2.TAG.003).
  - Edge / failure: an unset visibility defaults to the **most restrictive sane** scope (private), never silently global (#2).
- **Data touched:** `DATA-memories.visibility`.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** memory detail (visibility shown/editable by cleared roles).
- **Observability:** —
- **Acceptance criteria:**
  - AC-2.TAG.001.1 — Given a business-knowledge memory with no explicit visibility, When written, Then it defaults to global; a personal one defaults to private.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.TAG.002 — The writer assigns sensitivity at write time; never autonomously assigns Restricted
- **Statement:** The system shall have the memory writer assign a sensitivity tier (Standard/Confidential/Personal/Restricted) at write time, shall hold sensitive content flagged during ingestion for human confirmation before storage, and shall never autonomously assign Restricted — Restricted always requires human confirmation.
- **Source:** design-doc-v4.md L1418; **C1** FR-1.CLR.001 (tier semantics)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The writer (auto-assign Standard/Confidential/Personal); the ingestion-queue reviewer (confirm/assign for flagged content).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: the writer assigns Standard/Confidential/Personal from content + source; Internal Org content defaults Confidential/Restricted-eligible (FR-2.ENT.003).
  - Branches: content Filter 2 flags as sensitive is **held** in the ingestion queue (FR-2.ING.003) and a human confirms the tier before storage (L1418) — no sensitive content stored without approval (FR-2.ING.004).
  - Edge / failure: the writer **never** sets `sensitivity = restricted` on its own — Restricted is a human-confirmed classification and a per-individual *access* grant (FR-1.RST.001); an unclassifiable item defaults to the most restrictive sane tier pending review, never silently Standard (#1/#2).
- **Data touched:** `DATA-memories.sensitivity`.
- **Permissions:** ingestion-queue review = `PERM-*` (Super Admin/Admin, C1 / L1598).
- **Config dependencies:** —
- **Surfaces:** ingestion queue (Phase 3).
- **Observability:** sensitivity assignment / human-confirm `audit`.
- **Acceptance criteria:**
  - AC-2.TAG.002.1 — Given content the writer judges Confidential, When written, Then `sensitivity = confidential` with no human step required.
  - AC-2.TAG.002.2 — Given any path, When a memory would be set Restricted, Then a human confirmation is required first.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** C2 owns *tagging*; C1 (FR-1.CLR.*/RST.*) owns *who may then read each tier*.

### FR-2.TAG.003 — Visibility and sensitivity are orthogonal and both apply at retrieval
- **Statement:** The system shall treat visibility and sensitivity as two independent axes, both applied at retrieval time, so a memory's scope (who, by structure) and its handling class (what kind of content) are evaluated separately and both must pass.
- **Source:** design-doc-v4.md L1400–1402, L1864–1866
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every retrieval (FR-2.RET.004).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: a candidate memory is admitted only if the requester's **visibility scope** includes it **and** their **sensitivity clearance** (entity-type-scoped, FR-1.CLR.004) covers its tier.
  - Branches: failing **either** axis excludes the memory entirely (L1866) — not ranked, not returned.
  - Edge / failure: the two axes must not be conflated into one check (a global-but-Confidential memory must still require clearance; a Standard-but-private memory must still require scope).
- **Data touched:** `DATA-memories.visibility`, `.sensitivity`.
- **Permissions:** evaluated via C1 clearance/visibility (FR-1.CLR.006).
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** —
- **Acceptance criteria:**
  - AC-2.TAG.003.1 — Given a global-visibility Confidential memory and a requester without Confidential clearance, When retrieval runs, Then it is excluded.
- **Open decisions:** —
- **Feasibility assumptions:** —

---

# ING — Ingestion (filters, queue, pipelines)

### FR-2.ING.001 — Filter 1 (relevance): is this worth saving at all?
- **Statement:** The system shall apply a relevance filter to every candidate event that **saves** decisions, preferences, entity facts, processes, relationship signals, goals/priorities, and lessons learned, and **discards** casual banter, filler, duplicates, social chatter, system notifications/auto-replies, and any content with no possible entity link — discarding immediately so it never reaches Filter 2 or the writer.
- **Source:** design-doc-v4.md L1569–1583; **ADR-003 §4/§6** (this *is* the selective-writing Haiku gate)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every candidate event (task result, message, ingested item).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: a save-worthy event passes to Filter 2 / the writer; an irrelevant one is dropped with no Sonnet cost (the gate's whole purpose, ADR-003).
  - Branches: the gate runs on **Haiku** (cheap) — it must filter enough volume to pay for itself (AF-043).
  - Edge / failure: **during the shadow-retain trust window (ADR-003 §8), a "would-drop" is written + tagged rather than lost**, so the gate's accuracy can be audited before it is trusted to discard — see OD-036 for the window's retain mechanics + exit criteria.
  - Edge / failure: **after graduation to live-discard, a sampled audit continues** so the gate can't silently drift (OD-036) — 5% of live Filter-1 drops (minimum 20/week) are logged to the Haiku-decision review queue for a weekly human spot-check; a week with zero sampled drops reviewed is itself logged as a missed-audit condition (FR-2.MNT.015).
- **Data touched:** writes nothing on a true drop (post-trust-window); during the window writes a tagged shadow record; post-graduation writes a sampled-drop audit record.
- **Permissions:** runs in the `service_role` write path.
- **Config dependencies:** Haiku-gate + trust-window keys (Phase 2); post-graduation sample rate (5%, minimum 20/week) + weekly review cadence (Phase 2).
- **Surfaces:** the Haiku-decision review queue (Phase 3) — the trust-window audit surface and the post-graduation sampled-audit surface.
- **Observability:** every Filter-1 decision logged to the Haiku decision log (ADR-003 §8); post-graduation, the sampled-audit run (rate, count reviewed, disagreements found) is logged under FR-2.MNT.015's job-run log so a missed or empty audit run is never silent.
- **Acceptance criteria:**
  - AC-2.ING.001.1 — Given casual banter with no entity link, When ingested, Then it is discarded and no Sonnet writer call occurs.
  - AC-2.ING.001.2 — Given the trust window is active, When Filter 1 would drop an item, Then a tagged shadow record is retained for review (not lost).
  - AC-2.ING.001.3 — Given the gate has graduated to live-discard, When Filter 1 drops items over a week, Then at least 5% of drops (minimum 20/week) are sampled into the Haiku-decision review queue and logged as a reviewed audit run.
- **Open decisions:** ✅ RESOLVED — OD-036 (trust-window shadow-retain mechanics + exit criteria).
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-043 (the gate pays for itself + is accurate enough to trust).
- **Notes:** Reconciliation #1 — Filter 1 = ADR-003's single self-funding Haiku gate; not a new model.

### FR-2.ING.002 — Filter 2 (sensitivity): how should this be handled?
- **Statement:** The system shall apply a sensitivity filter that passes clean standard business content to the writer and **flags** personal info, financial specifics, legal/regulatory content, HR matters, founder-private decisions, and source-marked-confidential content for human decision before storage.
- **Source:** design-doc-v4.md L1585–1601
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every event that passed Filter 1.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: clean standard content proceeds to the writer with an auto-assigned tier (FR-2.TAG.002).
  - Branches: flagged content is **held in the ingestion queue** (FR-2.ING.003), not written, until a human decides.
  - Edge / failure: a false-negative (sensitive content passed as clean) is mitigated by the writer's own tier assignment + the monthly clearance review (FR-1.CLR.005); a flagged item must never auto-store (FR-2.ING.004).
- **Data touched:** `DATA-ingestion_queue` (hold), `DATA-memories` (on clean pass).
- **Permissions:** runs in the `service_role` path; review = Admin/Super Admin (C1).
- **Config dependencies:** —
- **Surfaces:** ingestion queue (Phase 3).
- **Observability:** flag → queue `event_log`.
- **Acceptance criteria:**
  - AC-2.ING.002.1 — Given content with financial specifics, When ingested, Then it is held for human decision, not auto-written.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Reconciliation #1 — Filter 2 = the Haiku sensitivity-classify + contradiction pre-check before the Sonnet writer (ADR-003).

### FR-2.ING.003 — The ingestion queue: human reviews flagged content (Include / Exclude / Defer), all logged
- **Statement:** The system shall hold Filter-2-flagged content in an ingestion queue, notify a reviewer via the dashboard with the content, the flag reason, and a suggested sensitivity level, and let the reviewer Include (assign sensitivity + proceed to write), Exclude (discard permanently, reason logged), or Defer (hold) — logging every decision with reviewer, timestamp, and reason.
- **Source:** design-doc-v4.md L1598–1601
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A reviewer (Admin/Super Admin) actioning the queue.
- **Preconditions:** `PERM-*` ingestion-queue review authority (C1 / L1598).
- **Behaviour:**
  - Happy path: reviewer Includes → the item proceeds to the writer with the assigned tier; Excludes → discarded permanently with a logged reason; Defers → stays queued.
  - Branches: a **Deferred** item resurfaces after `CFG-ingest_defer_resurface_days`, and **any** queue item un-actioned past `CFG-review_escalation_days` is **escalated** (Super Admin alert + dashboard badge) — so flagged sensitive content can never sit in a silent indefinite hold (#3). (gate Finding 3/5 — the resurfacing cadence is now a config key with an AC, not a dangling "Phase 2" decision.)
  - Edge / failure: an item must never leave the queue except by an explicit logged decision — a silently dropped queue item is a #1/#3 failure; a **stuck** item (write-then-crash, or never actioned) is caught by the queue-staleness scan in FR-2.MNT.010.
- **Data touched:** `DATA-ingestion_queue` (read/update), `DATA-memories` (on Include), `audit`.
- **Permissions:** `PERM-ingestion.review` (Admin/Super Admin, C1).
- **Config dependencies:** `CFG-ingest_defer_resurface_days`, `CFG-review_escalation_days` (LIVE).
- **Surfaces:** `UI-INGESTION-QUEUE` (Phase 3).
- **Observability:** every Include/Exclude/Defer → `audit` (reviewer/time/reason); overdue-item escalation → alert.
- **Acceptance criteria:**
  - AC-2.ING.003.1 — Given a flagged item, When a reviewer Excludes it, Then it is discarded and an audit record captures who/when/why.
  - AC-2.ING.003.2 — Given a queued item, When it leaves the queue, Then it did so only via a logged Include/Exclude/Defer.
  - AC-2.ING.003.3 — Given a queue item un-actioned past `CFG-review_escalation_days`, When the next cycle runs, Then it is escalated (alert + badge), never silently held.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.ING.004 — No sensitive content enters memory without explicit human approval
- **Statement:** The system shall ensure that no content flagged sensitive by Filter 2 is ever written to memory without an explicit human Include decision.
- **Source:** design-doc-v4.md L1601
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any write originating from flagged content.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: flagged → queued → human Include → written; there is no auto-write path for flagged content.
  - Branches: applies across **all three pipelines** (the document and structured passes flag the same way).
  - Edge / failure: a code path that writes flagged content without an Include is forbidden (#2) — a direct expression of "ingestion is not a backdoor" (FR-2.ING.010).
- **Data touched:** `DATA-memories`.
- **Permissions:** human Include = Admin/Super Admin.
- **Config dependencies:** —
- **Surfaces:** ingestion queue.
- **Observability:** —
- **Acceptance criteria:**
  - AC-2.ING.004.1 — Given flagged content with no human Include, When the pipeline runs to completion, Then nothing is written for that item.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.ING.005 — HR content is excluded by default; enabled only by a per-client config flag
- **Statement:** The system shall exclude HR content from memory by default (the default reviewer decision for HR matters is Exclude), and shall allow a client to enable HR content only via a per-client config flag that requires separate legal consideration — when enabled, the full sensitivity + RBAC system applies.
- **Source:** design-doc-v4.md L1420
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Filter 2 flagging HR content; an operator enabling the flag.
- **Preconditions:** `CFG-hr_content_enabled` (default off).
- **Behaviour:**
  - Happy path: HR matters are flagged by Filter 2; with the flag **off** the default reviewer decision is Exclude.
  - Branches: with the flag **on** (per-client, after legal review), HR content is reviewable/storable and governed by HR-role clearances scoped to team-member entities (FR-1.CLR.002).
  - Edge / failure: the flag is **off across all deployments by default** (L1420) — it is never on without an explicit per-client decision.
- **Data touched:** `DATA-memories` (HR-related); config.
- **Permissions:** flag change = Super Admin (C1).
- **Config dependencies:** `CFG-hr_content_enabled` (per-client, default off).
- **Surfaces:** config + ingestion queue.
- **Observability:** flag change `audit`.
- **Acceptance criteria:**
  - AC-2.ING.005.1 — Given the default config, When HR content is ingested, Then the default reviewer decision is Exclude.
  - AC-2.ING.005.2 — Given the flag enabled, When HR content is stored, Then HR-role clearances scoped to team-member entities govern access.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.ING.006 — Pipeline 1: structured data from systems of record (point, don't copy)
- **Statement:** The system shall ingest structured data by connecting to a system of record, extracting entities, creating entity records with `external_refs` pointers, running a summarisation pass, having a human validate a sample, and logging a full ingestion report — storing pointers + enrichment, never copies of the source records.
- **Source:** design-doc-v4.md L1910–1914; **Golden rule** (L1634)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Operator running structured ingestion at onboarding (and refreshes).
- **Preconditions:** A connected system of record (the connector + OAuth is **C3 Tool Layer**).
- **Behaviour:**
  - Happy path: connect → extract → create entities with `external_refs` → summarise → human validates a sample → log the report.
  - Branches: the connector/auth/rate-limit specifics live in **C3** (seam); C2 consumes the extracted records.
  - Edge / failure: the pipeline **points** (creates `source_ref`/`external_refs`), it does not copy source binaries/records into Supabase (golden rule, #1 scope).
- **Data touched:** `DATA-entities`, `DATA-memories` (pointer + enrichment), an ingestion-report log.
- **Permissions:** `PERM-ingestion.initiate` (Admin/Super Admin, C1 / L514–515).
- **Config dependencies:** —
- **Surfaces:** ingestion report (Phase 3).
- **Observability:** full ingestion report logged (record counts, sample-validation outcome).
- **Acceptance criteria:**
  - AC-2.ING.006.1 — Given a connected system of record, When Pipeline 1 runs, Then entities are created with external_refs and no source record is copied wholesale into Supabase.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Seam to **C3** for the actual connectors (GHL/Drive/Slack) + their AF-003-corrected rate/token limits.

### FR-2.ING.007 — Pipeline 2: unstructured documents (chunk, filter, classify, verify)
- **Statement:** The system shall ingest unstructured documents by collecting them in priority order (SOPs → brand guides → proposals → emails), extracting text, chunking into configurable 200–400-token segments with overlap, running the sensitivity filter, having a human confirm flagged content, classifying and storing via the memory writer, running a human verification pass, and logging a full ingestion report.
- **Source:** design-doc-v4.md L1916–1918; chunk size L921 (`chunk_size_tokens: 300`)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Operator running document ingestion.
- **Preconditions:** Documents available (via C3 connectors or upload).
- **Behaviour:**
  - Happy path: collect → extract text → chunk (`CFG-chunk_size_tokens`, default 300, with overlap) → Filter 2 → human-confirm flagged → writer classifies + stores → human verification pass → report.
  - Branches: every chunk routes through the standard write flow (FR-2.ING.010) — contradiction check + sensitivity filter apply.
  - Edge / failure: a document with no extractable text or no entity link is dropped at Filter 1.
- **Data touched:** `DATA-memories`, ingestion-report log.
- **Permissions:** `PERM-ingestion.initiate`.
- **Config dependencies:** `CFG-chunk_size_tokens` (default 300).
- **Surfaces:** ingestion report.
- **Observability:** ingestion report logged.
- **Acceptance criteria:**
  - AC-2.ING.007.1 — Given a document, When Pipeline 2 runs, Then it is chunked at the configured size, passes both filters, and is stored via the writer.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.ING.008 — Pipeline 3: tacit-knowledge interviews (three structured sessions)
- **Statement:** The system shall capture tacit knowledge via three structured 20–30-minute interview sessions (Clients; How we work; Business context), processing each transcript through the memory writer, having the interviewee review and verify the resulting memories, detecting sparse entities, and suggesting follow-up questions.
- **Source:** design-doc-v4.md L1920–1932
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Operator/founder running onboarding interviews.
- **Preconditions:** `PERM-ingestion.interview` (Admin/Super Admin, C1 / L514–515).
- **Behaviour:**
  - Happy path: each session → writer processes the transcript → interviewee verifies the memories (bumping verified ones to confidence 1.0, FR-2.MNT.001) → gap detection surfaces sparse entities (low Maturity, FR-2.MAT.002) → follow-up questions suggested.
  - Branches: Session 2 (Internal Org / how-we-work) feeds the Internal Org entity (FR-2.ENT.003); a 30-min founder interview yields ~40–60 high-confidence memories (L1932).
  - Edge / failure: an unverified interview memory stays at its inferred confidence until the verification step (it is not auto-trusted).
- **Data touched:** `DATA-memories`, `DATA-entities`.
- **Permissions:** `PERM-ingestion.interview`.
- **Config dependencies:** —
- **Surfaces:** interview flow + verification UI (Phase 3).
- **Observability:** interview-session + verification `audit`.
- **Acceptance criteria:**
  - AC-2.ING.008.1 — Given a completed interview session, When the transcript is processed, Then memories are created and surfaced to the interviewee for verification before reaching confidence 1.0.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.ING.009 — The initialisation sequence is ordered, and the human verification pass is mandatory
- **Statement:** The system shall run onboarding in the documented order (define entities → create Internal Org + capture founder knowledge → connect systems of record → structured data pass → priority documents → onboarding interviews → human verification pass), shall never skip the verification pass (which bumps verified memories to confidence 1.0), and shall surface a dashboard warning while verification is incomplete.
- **Source:** design-doc-v4.md L1934–1946
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Onboarding.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: the seven steps run in order; step 7 (human verification) bumps verified memories to confidence 1.0 (source `human_verified`).
  - Branches: incomplete verification → a persistent dashboard warning (L1946) — Maturity-based cold-start gating (FR-2.MAT.002) also reflects the unfinished state.
  - Edge / failure: skipping step 7 is blocked from being silent — the warning makes an unverified brain *visible* (#3).
- **Data touched:** `DATA-memories` (confidence bumps), onboarding-state.
- **Permissions:** Admin/Super Admin.
- **Config dependencies:** —
- **Surfaces:** onboarding dashboard (Phase 3).
- **Observability:** verification-pass progress.
- **Acceptance criteria:**
  - AC-2.ING.009.1 — Given onboarding with verification incomplete, When the dashboard renders, Then a warning is shown.
  - AC-2.ING.009.2 — Given a human-verified memory, When verification completes, Then its confidence is 1.0 / source human_verified.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.ING.010 — Ingestion is not a backdoor: every pipeline routes through the standard write flow
- **Statement:** The system shall route all ingested content — from every pipeline — through the standard write flow (relevance filter → sensitivity filter → contradiction check → memory writer), so ingestion cannot bypass the filters, the contradiction check, or the sole-writer rule.
- **Source:** design-doc-v4.md L1908; **ADR-004** (sole writer)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every pipeline.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: ingested items pass the same gates as live-task writes; no pipeline writes directly to `DATA-memories`.
  - Branches: bulk ingestion still serializes same-entity writes (ADR-004) and respects `rate_limit_memory_writes_per_minute`.
  - Edge / failure: a pipeline that inserts rows directly (skipping the writer) is forbidden (#1/#2) — the sole-writer invariant has no exceptions for ingestion.
- **Data touched:** `DATA-memories` (only via the writer).
- **Permissions:** `service_role` writer.
- **Config dependencies:** `rate_limit_memory_writes_per_minute` (default 30, ADR-004).
- **Surfaces:** —
- **Observability:** —
- **Acceptance criteria:**
  - AC-2.ING.010.1 — Given any ingestion pipeline, When it stores a memory, Then the write passed through the relevance + sensitivity + contradiction gates and the sole writer.
- **Open decisions:** —
- **Feasibility assumptions:** —

---

# WRT — Write flow

### FR-2.WRT.001 — The Memory Agent is the sole writer (invariant)
- **Statement:** The system shall permit only the Memory Agent (the memory writer) to create or modify memory rows; no other component, agent, or pipeline writes to memory directly.
- **Source:** design-doc-v4.md L3435; **ADR-004** (sole-writer invariant)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every memory write.
- **Preconditions:** The writer runs as `service_role` (ADR-004/006).
- **Behaviour:**
  - Happy path: all writes — live-task, ingestion, and human dashboard writes — are mediated by the writer (a human "write a memory" action invokes the writer path with source `human_verified`).
  - Branches: a human *edit/verify* of an existing memory is an audited update through the same controlled path (C1 USR/AUD), not a side-channel insert.
  - Edge / failure: any direct insert/update to `DATA-memories` outside the writer is forbidden — this invariant is what makes contradiction-checking, idempotency, and sensitivity-gating trustworthy (and is named by ADR-007 as a containment control against memory poisoning).
- **Data touched:** `DATA-memories` (exclusive write).
- **Permissions:** `service_role` (writer); human writes gated by C1 (`PERM-memory.write`).
- **Config dependencies:** —
- **Surfaces:** —
- **Observability:** every write attributed to the writer + originating identity (FR-1.RLS.007 binds the originating user).
- **Acceptance criteria:**
  - AC-2.WRT.001.1 — Given any memory row change, When traced, Then it was performed by the memory writer path.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.WRT.002 — Contradiction check before write (no / soft / hard conflict)
- **Statement:** The system shall, before writing, pull the 3–5 most similar existing memories and check for conflict: no conflict → write; **soft** conflict → write the new memory and mark the old as superseded; **hard** conflict → do not auto-resolve, flag for human review — never silently overwriting, and always recording supersession via the `superseded_by` chain.
- **Source:** design-doc-v4.md L1608–1615
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every write (pre-commit).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: no conflict → straight write; soft conflict → write new + CAS-supersede old (`WHERE superseded_by IS NULL`, ADR-004).
  - Branches: hard conflict → per **OD-032** the new memory is **held in a pending/quarantine state** (not in the live retrievable set, not written over the old, not dropped), surfaced in a hard-conflict review queue; an **un-actioned** hard conflict past `CFG-review_escalation_days` is **escalated** (alert + badge), never silently held; the conflict-resolution priority rules (FR-2.MNT.008) inform the suggested resolution.
  - Edge / failure: the check runs **unlocked** (it is part of the slow path); the per-entity validate-and-commit (FR-2.WRT.006) re-runs only the **cheap DB** contradiction check under the lock to catch a same-entity race (ADR-004).
- **Data touched:** `DATA-memories` (read similar; write/ supersede); quarantine-pending store.
- **Permissions:** writer.
- **Config dependencies:** the "N most similar" count; `CFG-review_escalation_days` (Phase 2).
- **Surfaces:** a hard-conflict review queue (Phase 3).
- **Observability:** soft-supersede + hard-conflict-flag + overdue-escalation `event_log`.
- **Acceptance criteria:**
  - AC-2.WRT.002.1 — Given a soft conflict, When the new memory is written, Then the old is marked superseded (chain intact), not deleted.
  - AC-2.WRT.002.2 — Given a hard conflict, When detected, Then the write is held in quarantine for human review, never silently applied.
  - AC-2.WRT.002.3 — Given a hard conflict un-actioned past `CFG-review_escalation_days`, When the next cycle runs, Then it is escalated (alert + badge), neither auto-resolved nor silently held.
  - (Schema: `memory_conflicts` — consolidated in `spec/04-data-model/schema.md`, Phase 4.)
- **Open decisions:** ✅ RESOLVED — OD-032 (unresolved-hard-conflict handling + the "inject both with a note" rule).
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-061 (validate-and-commit closes the same-entity TOCTOU window without livelock).

### FR-2.WRT.003 — The memory writer: extract facts, decide types, assign entities/confidence/sensitivity/expiry
- **Statement:** The system shall run a single Sonnet memory-writer call that, given what just happened plus the relevant existing memories, decides which facts changed/confirmed (semantic), whether to log the event (episodic), whether a process was discovered/refined (procedural), whether the content is a system-of-record pointer (pointer only), which entities relate, and the confidence, sensitivity, and expiry — producing one or more linked memories.
- **Source:** design-doc-v4.md L1617–1658, L160 (writer = claude-sonnet-4-6); **ADR-003** (≤1 Sonnet call)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** An event that passed Filters 1 & 2.
- **Preconditions:** Relevant existing memories retrieved for context.
- **Behaviour:**
  - Happy path: one Sonnet call drafts the memory(ies) — possibly several types + a pointer from one event (L1636–1658) — each linked to its resolved entities (FR-2.ENT.005) with a confidence (FR-2.WRT.005), sensitivity (FR-2.TAG.002), and optional expiry.
  - Branches: data owned by a system of record → a `system_pointer` memory (golden rule, FR-2.WRT.004), not a copy.
  - Edge / failure: the writer is the **one** Sonnet call per written memory (ADR-003 cost shape) — wrapped in cheap Haiku gates, never multiple Sonnet calls; it runs **unlocked** (ADR-004).
- **Data touched:** `DATA-memories` (write), `DATA-entities` (resolve).
- **Permissions:** `service_role` writer.
- **Config dependencies:** the price table (ADR-003, for cost estimation).
- **Surfaces:** —
- **Observability:** writer call → token/cost estimate (ADR-003); decision auditable.
- **Acceptance criteria:**
  - AC-2.WRT.003.1 — Given one rich event, When the writer runs, Then it may emit multiple typed memories + pointers, each entity-linked, in a single Sonnet call.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-031 (clean type splits + sensible confidence); AF-001 (write cost stays within the viability target).

### FR-2.WRT.004 — Golden rule: data owned by a system of record is stored as a pointer, not a copy
- **Statement:** The system shall store data that a system of record owns (GHL contacts, Drive documents, Slack messages) as a `system_pointer` memory (`source_ref` + enrichment), never copying the source record/binary into memory.
- **Source:** design-doc-v4.md L1634; **Golden rule** (glossary, binding); **ADR-008** (scope)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The writer, when content references system-of-record data.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: the writer creates a `system_pointer` memory (unscored, FR-2.WRT.005) holding a `source_ref` to the live record + any enrichment the brain adds.
  - Branches: enrichment (an inferred fact *about* the pointed-to record) may itself be a scored semantic memory linked to the same entity.
  - Edge / failure: copying a source binary/record into Supabase is forbidden (golden rule) — this keeps the backup scope to the derived DB layer and makes recent loss re-derivable (ADR-008).
- **Data touched:** `DATA-memories` (`system_pointer`, `source_ref`).
- **Permissions:** writer.
- **Config dependencies:** —
- **Surfaces:** memory detail shows the source link.
- **Observability:** —
- **Acceptance criteria:**
  - AC-2.WRT.004.1 — Given content owned by a system of record, When stored, Then a pointer memory is created and no source binary is copied into Supabase.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.WRT.005 — Confidence is assigned at write by source type
- **Statement:** The system shall assign initial confidence by source: human_verified 0.95–1.0; system_of_record 0.85–0.95; ai_inferred_strong 0.75–0.85; ai_inferred_weak 0.60–0.75; system_pointer unscored.
- **Source:** design-doc-v4.md L1666–1674
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The writer at write time.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: the writer sets confidence from the source signal strength (multiple consistent signals → strong; limited/indirect → weak).
  - Branches: a `system_pointer` carries no confidence score (it points at an authoritative record).
  - Edge / failure: confidence governs retrieval admission (FR-2.RET.003 keyword floor 0.7) — a mis-set confidence under-/over-surfaces a memory; the lifecycle (FR-2.MNT.001/002) corrects over time.
- **Data touched:** `DATA-memories.confidence`, `.source`.
- **Permissions:** writer.
- **Config dependencies:** —
- **Surfaces:** memory detail (confidence shown).
- **Observability:** —
- **Acceptance criteria:**
  - AC-2.WRT.005.1 — Given a human-verified memory, When written, Then confidence is 0.95–1.0; given an ai_inferred_weak memory, Then 0.60–0.75.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.WRT.006 — Validate-and-commit under a per-entity advisory lock (ADR-004)
- **Statement:** The system shall, after the unlocked writer call, commit each write inside a short transaction holding **sorted per-entity Postgres advisory locks**, re-checking the per-entity watermark — committing if unchanged, else re-running only the cheap DB contradiction check — and shall enforce a unique idempotency key and CAS supersession to make retries and concurrent same-entity writes safe.
- **Source:** **ADR-004**; design-doc-v4.md L1604–1615 (the contradiction-then-write flow the concurrency model protects)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every commit.
- **Preconditions:** Per-entity advisory-lock keys derived from `entity_ids` (sorted, deadlock-free).
- **Behaviour:**
  - Happy path: writer runs unlocked → short txn under sorted per-entity locks → watermark unchanged → commit (locks held ms).
  - Branches: watermark changed (a same-entity write landed) → re-run the **cheap DB** contradiction check only (no second Sonnet call) → commit / re-target / bounce; disjoint-entity writes never block each other (fan-out preserved).
  - Edge / failure: a retry double-write is killed by the unique idempotency key `hash(source_ref, sorted entity_ids, content_hash)`; a lost supersession is killed by the CAS (`WHERE superseded_by IS NULL`).
  - **Mid-task authorization (gate Finding 2 — consumes C1 FR-1.RLS.007):** the commit txn **is** "the next consequential side effect" FR-1.RLS.007 governs. Because the Sonnet writer ran **unlocked** for seconds, the commit must re-check that the **originating user is still active and the relied-on clearance/Restricted grant is still in force**; if it was revoked/deactivated mid-write, the commit **halts + quarantines** the pending memory (never persists on a stale snapshot) per FR-1.RLS.007. A benign **session-expiry** is not a revocation and does not halt (C0 FR-0.SESS.006).
- **Data touched:** `DATA-memories` (write under lock); reads originating-identity status/clearance (C1 helpers).
- **Permissions:** writer (`service_role`), bound to its originating identity (FR-1.RLS.007).
- **Config dependencies:** `rate_limit_memory_writes_per_minute` (default 30).
- **Surfaces:** —
- **Observability:** lock contention / re-check / bounce metrics; a mid-task-revocation halt → `audit` + quarantine.
- **Acceptance criteria:**
  - AC-2.WRT.006.1 — Given two same-entity concurrent writes, When committed, Then at most one wins per the watermark re-check and no duplicate/lost-supersede results.
  - AC-2.WRT.006.2 — Given two disjoint-entity writes, When committed, Then neither blocks the other.
  - AC-2.WRT.006.3 — Given the originating user is deactivated or a relied-on clearance/Restricted grant is revoked while the writer runs unlocked, When the commit txn opens, Then the write is halted + quarantined per FR-1.RLS.007 (not committed on a stale snapshot); a session-expiry alone does not halt it.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-061 (closes the window, no livelock); AF-062 (locks don't bottleneck, deadlock-free); AF-063 (Inngest per-key concurrency behaves as assumed); AF-081 (agent-path mid-task audit completeness).
- **Notes:** The cheap on-race re-check is intentionally **lexical/DB-level** (no second Sonnet call, ADR-004). A racing same-entity write that introduces a *semantically* (not lexically) contradicting memory is therefore caught not here but by the **daily supersede safety-net (FR-2.MNT.006)** within ≤1 day — so the residual window is bounded and surfaced, not silent (gate Finding 6; gated by AF-061).

### FR-2.WRT.007 — An embedding failure halts the commit; a memory is never stored with a null/invalid embedding
- **Statement:** The system shall, when the embedding call fails, times out, rate-limits, or returns a degenerate/invalid vector, halt the commit and route the source event to a retryable write-failure queue with an alert — and shall never commit a memory with a null or unvalidated embedding.
- **Source:** **gate Finding 1**; FR-2.VEC.002 (embeds on write); the three non-negotiables (#1/#3)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The writer, when embedding a memory at commit.
- **Preconditions:** An external embedding provider (OpenAI via the AI SDK).
- **Behaviour:**
  - Happy path: a valid 1536-dim embedding is produced and stored with the row (FR-2.MEM.002).
  - Branches: an embedding **failure** (error/timeout/rate-limit) → the commit is halted and the **source event** is enqueued for retry with an alert — a live-task event is not silently lost (unlike ingestion, a live event is not trivially re-playable, so it must be captured, #1); a **degenerate/zero/wrong-dim** vector → rejected (FR-2.MEM.002), same retry path.
  - Edge / failure: committing a memory with a null/garbage embedding is forbidden — it would be permanently invisible to the vector arm and **no maintenance job would detect it** (decay/erosion key on confidence/age, not embedding validity); FR-2.MNT.010 adds a null/invalid-embedding scan as a backstop.
- **Data touched:** `DATA-memories` (no partial write); a write-failure/retry queue.
- **Permissions:** writer.
- **Config dependencies:** embedding retry/backoff (Phase 2); embedding spend (ADR-003).
- **Surfaces:** a write-failure queue surface (Phase 3).
- **Observability:** every embedding failure → `event_log` + alert; retry outcomes logged (no silent loss, #3).
- **Acceptance criteria:**
  - AC-2.WRT.007.1 — Given the embedding call fails, When the writer commits, Then the write is halted, the source event is enqueued for retry, and an alert fires — no memory is committed.
  - AC-2.WRT.007.2 — Given a degenerate/invalid embedding, When validated, Then the row is rejected (never stored with a bad vector).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Pairs with the re-embedding migration (FR-2.VEC.003) and the null-embedding erosion scan (FR-2.MNT.010) — the three together guarantee no memory is silently unsearchable for want of a valid vector.

---

# RET — Retrieval & ranking

### FR-2.RET.001 — Extract entities from the incoming task
- **Statement:** The system shall parse an incoming task to identify which entities it is about, as the first retrieval step.
- **Source:** design-doc-v4.md L1703–1705
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A task arriving (step 4, context assembly).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: the task text yields a set of entity references resolved against `DATA-entities` (FR-2.ENT.005) → drives the keyword arm of dual search.
  - Branches: a task about a not-yet-known entity → no keyword hits, vector arm still applies; may flag low Maturity (FR-2.MAT.003).
  - Edge / failure: mis-resolution sends retrieval to the wrong entity (the OD-033 risk).
- **Data touched:** `DATA-entities` (resolve).
- **Permissions:** retrieval runs in the requesting session/agent context.
- **Config dependencies:** —
- **Surfaces:** —
- **Observability:** —
- **Acceptance criteria:**
  - AC-2.RET.001.1 — Given a task naming a known client, When retrieval starts, Then that client entity is identified for the keyword arm.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.RET.002 — Dual search: keyword (exact, this client) + vector (semantic, top-20)
- **Statement:** The system shall retrieve candidates via two arms — a keyword/structured search scoped to the task's entities, and a vector search that embeds the task text and finds the top ~20 semantically similar memories across all entities — combining what is known about this entity specifically with what is relevant to this kind of task.
- **Source:** design-doc-v4.md L1707–1721
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Retrieval.
- **Preconditions:** Entities extracted (FR-2.RET.001); HNSW index present (FR-2.VEC.001).
- **Behaviour:**
  - Happy path: keyword arm filters by entity membership + the candidate filters (FR-2.RET.003); vector arm returns the top-20 by cosine similarity (`ef_search` tuned).
  - Branches: the two candidate sets are unioned before the clearance filter + ranking.
  - Edge / failure: pgvector applies WHERE/RLS predicates **after** the ANN scan, so an aggressive clearance predicate can starve recall (AF-019) — the union + `ef_search` tuning must keep enough cleared candidates.
- **Data touched:** `DATA-memories` (keyword + vector read).
- **Permissions:** under the requester's RLS (human path) or harness clearance (agent path).
- **Config dependencies:** vector top-k (~20), `ef_search`.
- **Surfaces:** —
- **Observability:** retrieval candidate counts.
- **Acceptance criteria:**
  - AC-2.RET.002.1 — Given a task, When dual search runs, Then both a keyword (entity-scoped) and a vector (top-~20) candidate set are produced.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-019 (HNSW recall with predicates applied); AF-002 (retrieval is relevant, low-noise).

### FR-2.RET.003 — Candidate filters: confidence floor, not expired, not superseded — applied to both arms
- **Statement:** The system shall admit a candidate memory only if its confidence ≥ `retrieval_confidence_threshold` (default 0.7), it is not expired (`expires_at` null or future), and it is not superseded (`superseded_by` null) — and shall apply these filters uniformly to both the keyword and vector arms.
- **Source:** design-doc-v4.md L1707–1716 (keyword predicates), L906 (`retrieval_confidence_threshold: 0.7`); **vector-arm uniformity unspecified → OD-035**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Retrieval (candidate filtering).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: a candidate below the confidence floor, expired, or superseded is excluded before ranking.
  - Branches: the design states these predicates explicitly for the keyword arm (L1714); per OD-035 they apply equally to the vector arm (else a low-confidence/expired/superseded memory re-enters via semantic similarity — a #1/#2 leak of stale knowledge).
  - Edge / failure: a decayed memory below `confidence_floor` (0.5) is already excluded by the 0.7 retrieval floor; a `system_pointer` (unscored) is admitted on its own rule (it points at authoritative data).
- **Data touched:** `DATA-memories` (filter).
- **Permissions:** —
- **Config dependencies:** `CFG-retrieval_confidence_threshold` (LIVE, default 0.7).
- **Surfaces:** —
- **Observability:** —
- **Acceptance criteria:**
  - AC-2.RET.003.1 — Given a superseded memory that is semantically similar to a task, When the vector arm runs, Then it is excluded from candidates (per OD-035).
- **Open decisions:** ✅ RESOLVED — OD-035 (confirm the confidence/expiry/superseded filters apply uniformly to the vector arm; and whether `system_pointer` admission is unconditional).
- **Feasibility assumptions:** —

### FR-2.RET.004 — Clearance + visibility filter runs BEFORE ranking (never after)
- **Statement:** The system shall apply the requester's visibility scope and sensitivity clearance to the candidate set **before** ranking, excluding out-of-clearance memories entirely so they are never ranked or returned — realising C1's FR-1.CLR.006 as the retrieval mechanism.
- **Source:** design-doc-v4.md L1723–1725, L1864–1866; **C1** FR-1.CLR.006; **ADR-003** ("controls before gates")
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Retrieval, after candidate filtering, before ranking.
- **Preconditions:** Requester clearances/visibility resolved (C1 helpers; or harness RBAC on the agent path).
- **Behaviour:**
  - Happy path: candidates failing visibility **or** sensitivity (entity-type-scoped, FR-1.CLR.004) are dropped first; only cleared candidates are ranked.
  - Branches: human/session path is also backstopped by RLS (FR-1.RLS.003); the agent `service_role` path is governed by harness RBAC (FR-1.RLS.004/007) since it bypasses RLS.
  - Edge / failure: a memory ranked-then-stripped is forbidden (it could leak via ordering/scores, #2); Restricted is never auto-injected even for a cleared holder (FR-1.RST.003 / FR-2.RET.006).
  - Branches *(change-control 2026-06-26, C8 session 25 — OD-081)*: when the caller is the agent path, the read flow also accepts an optional **agent-scope predicate** (the running agent's `memory_scope`, C8 FR-8.SCO.001) and drops out-of-agent-scope candidates **before** ranking, alongside clearance + visibility. The agent-scope filter narrows *within* clearance; it never widens access.
- **Data touched:** `DATA-memories` (filter under clearance).
- **Permissions:** C1 clearance/visibility model.
- **Config dependencies:** —
- **Surfaces:** —
- **Observability:** Personal/Restricted candidate access → `access_audit` (FR-1.AUD.001).
- **Acceptance criteria:**
  - AC-2.RET.004.1 — Given a candidate outside the requester's clearance, When retrieval runs, Then it is excluded before ranking (not ranked then hidden).
  - AC-2.RET.004.2 — *(Change-control 2026-06-26, C8 OD-081.)* Given an agent-path read with an agent-scope predicate, When retrieval runs, Then candidates outside the agent's `memory_scope` are excluded before ranking (an additional narrowing within clearance, never a widening).
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-067 (the live clearance predicate composes with pgvector ranking within latency budget).

### FR-2.RET.005 — Rank and trim: weighted score, procedural boost, top 6–8
- **Statement:** The system shall rank the cleared candidates by a configurable weighted score — recency 0.3 + confidence 0.3 + entity-match 0.2 + vector-similarity 0.2 — apply a configurable procedural boost (×1.2), and trim to a configurable top N (default 7) for injection.
- **Source:** design-doc-v4.md L1727–1738; config L907–914 (weights, `procedural_boost: 1.2`, `memories_injected_per_task: 7`)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Retrieval ranking.
- **Preconditions:** Cleared candidate set.
- **Behaviour:**
  - Happy path: score each candidate, apply the procedural ×1.2 boost, sort, take the top `memories_injected_per_task`.
  - Branches: all weights + the boost + N are LIVE config (Phase 2) — tunable per deployment.
  - Edge / failure: too-low N starves context; too-high N adds noise + cost — AF-002 validates the defaults.
- **Data touched:** `DATA-memories` (rank).
- **Permissions:** —
- **Config dependencies:** the compound `CFG-ranking_weights` (recency 0.3 · confidence 0.3 · entity_match 0.2 · vector_similarity 0.2, sum = 1.0 — config-registry Appendix A), `CFG-rank_recency_half_life_days` (90, the recency-decay half-life — OD-169), `CFG-procedural_boost` (1.2), `CFG-memories_injected_per_task` (7) — all LIVE.
- **Surfaces:** —
- **Observability:** ranking inputs/outputs sampled for the retrieval-quality EVAL.
- **Acceptance criteria:**
  - AC-2.RET.005.1 — Given cleared candidates, When ranked, Then the top `memories_injected_per_task` by weighted score (procedural ×1.2) are selected.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-002 (the weights/threshold produce relevant, low-noise retrieval).
- **Notes:** Re-ranking (a second model pass, L1956) and HyDE (L1954) are **off / not mandated** (ADR-003) → OOS-003.
- **Notes (sub-signal normalization → OD-169):** the four raw signals normalize to `[0,1]` before the weighted sum: **recency** = `0.5 ^ (age_days / CFG-rank_recency_half_life_days)` over `created_at`; **confidence** used directly (already 0–1; `system_pointer` unscored, excluded from this term); **entity-match** = Jaccard overlap of the task's resolved entities (FR-2.RET.001) against the candidate's `entity_ids`; **vector-similarity** = cosine mapped to `[0,1]` via `(cosine + 1)/2`. Normalization *shapes* are fixed by OD-169; the half-life default and the weights are AF-002-tuned; the scoring SQL body is a Phase-4 build artifact.

### FR-2.RET.006 — Inject as Business Context with type tags; Restricted never auto-injected
- **Statement:** The system shall prepend the selected memories to the prompt as a Business Context section, tagged by type ([Semantic]/[Episodic]/[Procedural]), and shall never auto-inject Restricted-tier content even for a cleared holder.
- **Source:** design-doc-v4.md L1740–1751; **C1** FR-1.RST.003
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Retrieval, after ranking.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: the top memories are formatted as Business Context with type tags and prepended (Layer 3 of the prompt).
  - Branches: Restricted content is excluded from auto-injection unconditionally (FR-1.RST.003) — it surfaces only via an explicit, audited access.
  - Edge / failure: injecting more than N, or injecting an out-of-clearance/Restricted memory, is forbidden.
- **Data touched:** prompt assembly (reads `DATA-memories`).
- **Permissions:** —
- **Config dependencies:** —
- **Surfaces:** the assembled prompt (observable in the agent trace).
- **Observability:** injected memory IDs traceable (for the Cited pill, FR-2.RET.007).
- **Acceptance criteria:**
  - AC-2.RET.006.1 — Given a ranked set, When injected, Then each memory is type-tagged and no Restricted memory is auto-injected.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.RET.007 — Answer modes + Retrieval Sufficiency / the [Building] flag
- **Statement:** The system shall, after assembling context, evaluate Retrieval Sufficiency for the query and emit the signals that drive the response's answer mode — Cited (from verified memory/live tool data), Inferred (reasoned, not verified), or Unknown (insufficient context, redirect to a productive next step) — and shall raise the `[Building]` flag when retrieval is thin **and** the touched entities' Maturity is low.
- **Source:** design-doc-v4.md L1755–1772; **ADR-002** (Retrieval Sufficiency, the `[Building]` flag, three pills — OD-008)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Post-retrieval, per response.
- **Preconditions:** Maturity computed (FR-2.MAT.002); Sufficiency threshold configured.
- **Behaviour:**
  - Happy path: C2 emits (a) the **provenance** of injected memory (which IDs/sources → supports the Cited pill) and (b) the **Retrieval Sufficiency** verdict for the query (ADR-002).
  - Branches: thin retrieval + low entity Maturity → `[Building]` flag overlaid on an Unknown/thin response (ADR-002); thin retrieval + mature entity → plain Unknown.
  - Edge / failure: the **pill itself** is attached by the response/agent layer (**C8 seam**); C2 owns the *signals*, not the rendering — a high proportion of Inferred/Unknown is the observability signal of thin coverage (L1772).
- **Data touched:** reads retrieval results + `DATA-entities` Maturity.
- **Permissions:** —
- **Config dependencies:** `CFG-retrieval_sufficiency_threshold` (Phase 2); the Maturity proactive threshold (ADR-002).
- **Surfaces:** the answer-mode pill (rendered by C8 / chat surface, Phase 3).
- **Observability:** answer-mode distribution metric (thin-coverage signal).
- **Acceptance criteria:**
  - AC-2.RET.007.1 — Given thin retrieval on a low-Maturity entity, When a response is produced, Then the [Building] flag is raised.
  - AC-2.RET.007.2 — Given memory was the source, When a response is produced, Then provenance is available for a Cited pill.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-034 (Sufficiency cleanly separates [Building] from [Unknown]).
- **Notes:** Pill *rendering* + the Inferred-vs-Cited decision (which depends on whether the agent used memory) is **C8** (agent/chat). C2 owns retrieval provenance + the Sufficiency/Maturity signals.

---

# MNT — Maintenance & lifecycle

### FR-2.MNT.001 — Confidence lifecycle: initial assignment (cross-ref) + movement signals
- **Statement:** The system shall move a memory's confidence over its life: **up** on human verify (+0.10, cap 1.0), successful retrieval-and-use (+0.02), corroboration by a newer memory (+0.05) or a system of record (+0.05); **down** on soft decay (×0.95), human flag/edit (−0.15), system-of-record contradiction (−0.20, flagged), or poor outcome after retrieval (−0.05); and shall **freeze** confidence for memories in active human review and never decay `human_verified` memories.
- **Source:** design-doc-v4.md L1679–1695
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Feedback events + the daily decay job.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: each signal adjusts `confidence` by the documented delta, capped at [floor, 1.0].
  - Branches: `human_verified` memories are frozen against decay (L1695); a memory in active review is frozen until resolved.
  - Edge / failure: a system-of-record contradiction both drops confidence (−0.20) **and** flags for review (it is evidence the brain is wrong, #1).
- **Data touched:** `DATA-memories.confidence`.
- **Permissions:** signals from the system (`service_role`) + humans (C1).
- **Config dependencies:** the deltas (Phase 2, likely fixed v1).
- **Surfaces:** memory health dashboard.
- **Observability:** every confidence change logged with cause (feedback log, FR-2.MNT.017).
- **Acceptance criteria:**
  - AC-2.MNT.001.1 — Given a human-verified memory, When the daily decay job runs, Then its confidence does not decay.
  - AC-2.MNT.001.2 — Given a system-of-record contradiction, When recorded, Then confidence drops 0.20 and the memory is flagged.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.MNT.002 — Soft decay (daily): stale, unconfirmed, low-confidence memories drift down — never deleted
- **Statement:** The system shall run a daily soft-decay job that, for a memory older than `soft_decay_age_months` (6) with confidence < 0.8 and no newer confirming memory, multiplies confidence by `soft_decay_multiplier` (0.95) toward `confidence_floor` (0.5) — never deleting, and never decaying human-written memories.
- **Source:** design-doc-v4.md L1804–1815; config L915–917
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Daily decay job.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: qualifying memories drift down 5%/run; at the floor they stop being injected (below the 0.7 retrieval threshold well before the floor) and are flagged for review.
  - Branches: a memory confirmed since last run does not decay; human-written never decays.
  - Edge / failure: decay **never deletes** (L1815) — a low-confidence memory is retained (re-confirmable), protecting #1.
- **Data touched:** `DATA-memories.confidence`.
- **Permissions:** `service_role` job.
- **Config dependencies:** `CFG-soft_decay_age_months` (6), `CFG-soft_decay_multiplier` (0.95), `CFG-confidence_floor` (0.5) — LIVE.
- **Surfaces:** memory health dashboard.
- **Observability:** decay-job run logged (records affected) — FR-2.MNT.015.
- **Acceptance criteria:**
  - AC-2.MNT.002.1 — Given a 7-month-old unconfirmed memory at 0.7, When the decay job runs, Then confidence becomes ~0.665 and the memory is never deleted.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.MNT.003 — Amber-zone + bulk-drop alerts
- **Statement:** The system shall raise a proactive dashboard flag when a memory's confidence crosses below `amber_zone_threshold` (0.75) — firing **before** the memory drops below `retrieval_confidence_threshold` (0.7) and becomes invisible to retrieval — and shall raise a separate systemic alert when more than `bulk_drop_alert_count` (10) memories drop within `bulk_drop_alert_window_minutes` (60).
- **Source:** design-doc-v4.md L1697, L1823; config L918, L924–925
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** The decay/feedback path crossing a threshold.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: a memory crossing 0.75 is flagged for review proactively (before it stops being injected at the 0.7 retrieval floor).
  - Branches: a burst of drops (>10 in 60 min) → a systemic alert (something changed wholesale — a connector broke, a bad ingestion).
  - Edge / failure: the alert makes erosion *visible* (#3) rather than letting the brain quietly degrade.
- **Data touched:** `DATA-memories`; alert sink.
- **Permissions:** —
- **Config dependencies:** `CFG-amber_zone_threshold` (0.75), `CFG-bulk_drop_alert_count` (10), `CFG-bulk_drop_alert_window_minutes` (60) — LIVE.
- **Surfaces:** memory health dashboard (amber flags + systemic alert).
- **Observability:** amber + bulk alerts logged.
- **Acceptance criteria:**
  - AC-2.MNT.003.1 — Given a memory crossing below 0.75, When detected, Then a proactive review flag is raised.
  - AC-2.MNT.003.2 — Given 11 memories dropping in 30 minutes, When detected, Then a systemic alert fires.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.MNT.004 — Hard expiry: time-limited memories excluded automatically
- **Statement:** The system shall set `expires_at` at write time for time-limited facts and shall automatically exclude expired memories at retrieval.
- **Source:** design-doc-v4.md L1802; L1716 (retrieval excludes expired)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Writer (sets); retrieval (enforces).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: a memory with a future `expires_at` is retrievable; once past, it is filtered out (FR-2.RET.003).
  - Branches: most memories have null `expires_at` (no expiry).
  - Edge / failure: an expired memory is excluded but **not deleted** (consistent with decay-never-deletes) unless a maintenance job archives it.
- **Data touched:** `DATA-memories.expires_at`.
- **Permissions:** —
- **Config dependencies:** —
- **Surfaces:** —
- **Observability:** —
- **Acceptance criteria:**
  - AC-2.MNT.004.1 — Given a memory whose expires_at has passed, When retrieval runs, Then it is excluded.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.MNT.005 — Merge job (weekly): consolidate near-duplicate memories
- **Statement:** The system shall run a weekly merge job that collapses memories with similarity above `merge_similarity_threshold` (0.92) into one richer memory, while superseding (not merging) two similar memories more than three months apart.
- **Source:** design-doc-v4.md L1780, L1891; config L919
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Weekly merge job.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: ≥0.92-similar memories collapse into one (evidence preserved); >3-months-apart similar pairs are superseded rather than merged (the newer wins, chain kept).
  - Branches: **Personal-tier memories are never auto-consolidated** without explicit human approval (FR-2.MNT.014 / L1414) — the merge job must skip/queue them.
  - Edge / failure: merging across different entities or sensitivity tiers is forbidden (would blend scopes, #2).
- **Data touched:** `DATA-memories` (merge/supersede).
- **Permissions:** `service_role` job.
- **Config dependencies:** `CFG-merge_similarity_threshold` (0.92) — LIVE.
- **Surfaces:** memory health dashboard.
- **Observability:** merge-job run logged.
- **Acceptance criteria:**
  - AC-2.MNT.005.1 — Given two ≥0.92-similar Standard memories, When the merge job runs, Then they collapse into one richer memory.
  - AC-2.MNT.005.2 — Given two ≥0.92-similar Personal memories, When the merge job runs, Then they are not auto-merged (FR-2.MNT.014).
- **Open decisions:** ✅ RESOLVED — OD-037 (Personal-consolidation gate mechanism — skip vs human-approval queue).
- **Feasibility assumptions:** —

### FR-2.MNT.006 — Supersede safety net (daily)
- **Statement:** The system shall run a daily supersede safety-net job that catches contradictions the write-time check missed, marking the superseded memory via the `superseded_by` chain.
- **Source:** design-doc-v4.md L1782, L1884
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Daily supersede job.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: a newer authoritative memory supersedes an older contradicted one that slipped past the write-time check.
  - Branches: a hard conflict it finds → human review (FR-2.WRT.002 / OD-032), not auto-resolution.
  - Edge / failure: never silently overwrites — supersession is always via the traceable chain.
- **Data touched:** `DATA-memories` (supersede).
- **Permissions:** `service_role` job.
- **Config dependencies:** —
- **Surfaces:** memory health dashboard.
- **Observability:** supersede-job run logged.
- **Acceptance criteria:**
  - AC-2.MNT.006.1 — Given a contradiction missed at write time, When the daily job runs, Then the older memory is superseded (chain intact).
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.MNT.007 — Summarise (weekly): episodic → semantic, evidence retained and drillable
- **Statement:** The system shall run a weekly summarise job that, for entities with ≥ `summarise_episode_trigger` (10) new episodic memories since the last summary, generates one richer semantic memory referencing the episodic cluster it came from — retaining the episodic memories as an evidence layer (never deleted/superseded) so any fact is drillable to the events that produced it.
- **Source:** design-doc-v4.md L1784–1796, L1890; config L920
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Weekly summarise job.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: 10+ new episodics on an entity → a semantic summary linked to that cluster; the episodics persist as evidence.
  - Branches: Personal episodics are not folded without human approval (FR-2.MNT.014).
  - Edge / failure: the evidence layer is **never** deleted (L1796) — drill-down from fact → events must always work (#1).
- **Data touched:** `DATA-memories` (new semantic + cluster reference).
- **Permissions:** `service_role` job.
- **Config dependencies:** `CFG-summarise_episode_trigger` (10) — LIVE.
- **Surfaces:** memory health dashboard.
- **Observability:** summarise-job run logged.
- **Acceptance criteria:**
  - AC-2.MNT.007.1 — Given an entity with 10 new episodics, When the summarise job runs, Then a semantic memory is created referencing the cluster, and the episodics are retained.
- **Open decisions:** ✅ RESOLVED — OD-037 (Personal handling).
- **Feasibility assumptions:** —

### FR-2.MNT.008 — Conflict-resolution priority rules
- **Statement:** The system shall resolve conflicts by priority: (1) human_verified always wins; (2) system_of_record beats ai_inferred; (3) more recent beats older (same source type); (4) higher confidence beats lower (same age); (5) genuinely ambiguous → flag for human and inject both with a note.
- **Source:** design-doc-v4.md L1835–1844
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The contradiction check (FR-2.WRT.002) and the supersede/merge jobs.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: a conflict is resolved by the first applicable rule; the loser is superseded (chain kept).
  - Branches: rule 5 (genuine ambiguity) → both memories are retained and **both injected with a note** at retrieval, plus a human flag — the "inject both with a note" behaviour is part of OD-032 (how the note renders + how long both persist).
  - Edge / failure: never auto-pick when truly ambiguous (#1) — surface it.
- **Data touched:** `DATA-memories`.
- **Permissions:** —
- **Config dependencies:** —
- **Surfaces:** conflict review queue.
- **Observability:** conflict resolution logged (which rule applied).
- **Acceptance criteria:**
  - AC-2.MNT.008.1 — Given a human_verified memory conflicting with an ai_inferred one, When resolved, Then the human_verified wins.
  - AC-2.MNT.008.2 — Given a genuinely ambiguous conflict, When retrieved, Then both are injected with a note and a human is flagged.
- **Open decisions:** ✅ RESOLVED — OD-032 (the unresolved-conflict + inject-both-with-note behaviour).
- **Feasibility assumptions:** —

### FR-2.MNT.009 — Coverage erosion (daily): per-entity staleness detection
- **Statement:** The system shall run a daily per-entity coverage check that flags an entity as going stale in the memory health dashboard when no new memory about it has appeared within `coverage_stale_window_days` (30).
- **Source:** design-doc-v4.md L1825, L1886; config L922
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Daily coverage job.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: an entity with no new memory in 30 days → flagged stale (a prompt to re-engage / re-ingest).
  - Branches: ties into Maturity (FR-2.MAT.002) — a stale low-Maturity entity is a coverage gap.
  - Edge / failure: surfaced, not silently tolerated (#3).
- **Data touched:** `DATA-entities`, `DATA-memories` (read).
- **Permissions:** `service_role` job.
- **Config dependencies:** `CFG-coverage_stale_window_days` (30) — LIVE.
- **Surfaces:** memory health dashboard.
- **Observability:** coverage-job run logged.
- **Acceptance criteria:**
  - AC-2.MNT.009.1 — Given an entity with no new memory in 31 days, When the daily job runs, Then it is flagged stale.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.MNT.010 — Structural erosion (weekly): orphans, unresolved conflicts, long chains, missed duplicates
- **Statement:** The system shall run a weekly structural-health job that scans for orphaned memories, unresolved conflicts, over-long supersession chains, duplicate clusters the merge job missed, **memory rows with a null/invalid embedding**, and **ingestion-queue items stuck past the escalation threshold** — surfacing each finding as a maintenance task in the dashboard.
- **Source:** design-doc-v4.md L1827, L1885; **gate Findings 1 & 3** (null-embedding + stuck-queue backstops)
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Weekly structural job.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: each structural anomaly becomes a dashboard maintenance task (with a suggested action).
  - Branches: duplicate clusters → routed to the merge path; orphans (no live entity) → re-link or retire via review; a **null/invalid-embedding** row → routed to re-embed (FR-2.WRT.007/VEC.003); a **stuck ingestion-queue** item → escalated (FR-2.ING.003).
  - Edge / failure: an over-long supersession chain is a signal of churn worth a human look; a null-embedding row that no other job detects (decay/erosion key on confidence/age, not embedding validity) is **only** caught here — this scan is the backstop that keeps "silently unsearchable" from being permanent (#1/#3).
- **Data touched:** `DATA-memories`, `DATA-entities`, `DATA-ingestion_queue` (scan).
- **Permissions:** `service_role` job.
- **Config dependencies:** chain-length threshold; `CFG-review_escalation_days` (Phase 2).
- **Surfaces:** maintenance queue (Phase 3).
- **Observability:** structural-job run logged.
- **Acceptance criteria:**
  - AC-2.MNT.010.1 — Given an orphaned memory, When the weekly job runs, Then a maintenance task is created.
  - AC-2.MNT.010.2 — Given a memory row with a null/invalid embedding, When the weekly job runs, Then it is surfaced and routed to re-embed.
  - AC-2.MNT.010.3 — Given an ingestion-queue item stuck past the escalation threshold, When the weekly job runs, Then it is surfaced/escalated.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.MNT.011 — Relevance erosion (monthly + on-use): live-data cross-check, review window
- **Statement:** The system shall, when a memory is retrieved and used, check whether live tool data confirms or contradicts it (a contradiction raises an immediate soft-conflict flag), and shall run a monthly sweep flagging memories not retrieved or confirmed within `relevance_review_window_days` (30) for relevance review.
- **Source:** design-doc-v4.md L1829–1830, L1896; config L923
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** On-use cross-check (real-time) + the monthly sweep.
- **Preconditions:** Live tool data available (**C3 seam**).
- **Behaviour:**
  - Happy path: used memory confirmed by live data → relevance affirmed (+confidence on success, FR-2.MNT.001); contradicted → immediate soft-conflict flag (FR-2.WRT.002).
  - Branches: the live-data comparison depends on the **Tool Layer (C3)** being able to fetch the authoritative record — seam.
  - Edge / failure: a memory neither retrieved nor confirmed in 30 days → relevance-review flag (candidate for decay/retire), surfaced not silently dropped.
- **Data touched:** `DATA-memories`; live tool data (C3).
- **Permissions:** `service_role`.
- **Config dependencies:** `CFG-relevance_review_window_days` (30) — LIVE.
- **Surfaces:** memory health dashboard.
- **Observability:** relevance-sweep run logged.
- **Acceptance criteria:**
  - AC-2.MNT.011.1 — Given a used memory contradicted by live tool data, When detected, Then an immediate soft-conflict flag is raised.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Seam to **C3** for the live-data fetch.

### FR-2.MNT.012 — Cold storage (monthly): migrate old, low-access memories off the hot index — ⏸️ v2-DEFERRED
- **Statement:** *(v2 — not built in v1, per OD-034 / OOS-016.)* The system shall run a monthly job that moves memories older than 12 months with low access frequency to cold storage to keep the vector index fast and cheap, while preserving them and a path to retrieve them back if they become relevant.
- **Source:** design-doc-v4.md L1897, L1962; **OD-034 → deferred OOS-016**
- **Status:** Deferred (v2) — OOS-016
- **Priority:** Could
- **Actor / trigger:** Monthly cold-storage job.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: qualifying memories are moved to a cold tier (out of the hot HNSW index) per OD-034's chosen mechanism.
  - Branches: a cold memory that becomes relevant again is brought back (the retrieval-back path) — OD-034 defines whether cold memories are still searchable (degraded) or fully archived.
  - Edge / failure: cold storage **must not lose** memories (#1) and must not silently make them unfindable when needed (#3) — both are OD-034 concerns.
- **Data touched:** `DATA-memories` (tier/flag), cold store.
- **Permissions:** `service_role` job.
- **Config dependencies:** age (12 mo) + access-frequency threshold (Phase 2).
- **Surfaces:** memory health dashboard (cold-tier counts).
- **Observability:** cold-storage-job run logged.
- **Acceptance criteria:**
  - AC-2.MNT.012.1 — *(v2)* Given a 13-month-old rarely-accessed memory, When the monthly job runs, Then it is moved to cold storage (keeping it in-table + keyword-reachable + rehydratable) and remains recoverable.
- **Open decisions:** ✅ RESOLVED — OD-034 → **RESOLVED: deferred to v2 (OOS-016)**; AF-019 identifies the hot-index size that motivates building it.
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-019 (the hot-index size/perf tradeoff that would motivate cold storage; until it bites, deferral stands).
- **Notes:** **v1 does not build cold storage.** It adds a lose-a-memory failure mode (#1) for no launch-scale benefit (HNSW stays fast past ≤20-user volume). When built, the safe shape is in-table + keyword-reachable + rehydratable, never archived-and-unsearchable.

### FR-2.MNT.013 — Embedding-cache validation (monthly): don't re-embed unchanged content
- **Statement:** The system shall run a monthly check that re-embeds a memory only when its content has changed, skipping re-embedding for unchanged content.
- **Source:** design-doc-v4.md L1898, L1964
- **Status:** Approved
- **Priority:** Could
- **Actor / trigger:** Monthly embedding-cache job (and any content edit).
- **Preconditions:** A content hash per memory.
- **Behaviour:**
  - Happy path: unchanged content (matching hash) → no re-embed (cost saving); changed content → re-embed.
  - Branches: a model change is a separate, deliberate re-embedding migration (FR-2.VEC.003), not this job.
  - Edge / failure: re-embedding unchanged content wastes embedding spend (ADR-003 cost).
- **Data touched:** `DATA-memories.embedding`, content hash.
- **Permissions:** `service_role` job.
- **Config dependencies:** —
- **Surfaces:** —
- **Observability:** embedding-cache-job run logged.
- **Acceptance criteria:**
  - AC-2.MNT.013.1 — Given a memory whose content is unchanged, When the monthly job runs, Then it is not re-embedded.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.MNT.014 — Personal-tier memories are never auto-consolidated without human approval
- **Statement:** The system shall exclude Personal-tier memories from automatic consolidation (merge and episodic→semantic summarise), folding them into broader memories only with explicit human approval.
- **Source:** design-doc-v4.md L1414 ("Personal — never consolidated into broader memories without explicit human approval"); **mechanism → OD-037**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The merge (FR-2.MNT.005) + summarise (FR-2.MNT.007) jobs.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: per **OD-037** a job encountering a Personal-tier candidate **skips** it by default; a cleared human may opt it into consolidation via an approval queue.
  - Branches: with explicit human approval, a Personal memory may be consolidated under audit; an approval-queue item un-actioned past `CFG-review_escalation_days` is escalated (alert + badge), not silently held.
  - Edge / failure: auto-folding Personal data into a broader (more-injected) memory would broaden its exposure beyond its tier — a #2 failure this FR forbids.
- **Data touched:** `DATA-memories` (Personal tier).
- **Permissions:** human approval = a cleared role (C1).
- **Config dependencies:** `CFG-review_escalation_days` (LIVE).
- **Surfaces:** a Personal-consolidation approval queue (Phase 3, per OD-037).
- **Observability:** any Personal consolidation → `access_audit`; overdue-approval escalation → alert.
- **Acceptance criteria:**
  - AC-2.MNT.014.1 — Given a Personal-tier memory, When merge/summarise runs, Then it is not auto-consolidated.
  - AC-2.MNT.014.2 — Given a Personal-consolidation approval item un-actioned past `CFG-review_escalation_days`, When the next cycle runs, Then it is escalated, never silently held.
  - (Schema: `consolidation_approvals` — consolidated in `spec/04-data-model/schema.md`, Phase 4.)
- **Open decisions:** ✅ RESOLVED — OD-037 (skip vs approval-queue mechanism).
- **Feasibility assumptions:** —

### FR-2.MNT.015 — The maintenance schedule runs on cadence and never fails silently
- **Statement:** The system shall run the documented maintenance jobs on their cadences (real-time, daily, weekly, monthly) and shall log every job run with its time, outcome, and records affected — no maintenance job ever runs or fails silently — surfacing a maintenance-queue completion-rate metric that flags when work piles up.
- **Source:** design-doc-v4.md L1872–1900, L1902
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The scheduler (loops/cron — seam to the harness/observability components).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: each job (real-time filters/checks; daily decay/supersede/structural/coverage/amber; weekly summarise/merge/health-report/queue-refresh/Haiku-gate sampled-drop audit; monthly relevance/cold-storage/embedding/clearance-review-trigger) runs on cadence and logs run/outcome/records.
  - Branches: a failed run is logged loudly + alerts (#3), never swallowed; the completion-rate metric flags a backlog.
  - Edge / failure: a silent job failure is the exact thing this FR forbids — it would let the brain degrade invisibly (#1/#3); the weekly Haiku-gate sampled-drop audit (FR-2.ING.001, OD-036) is subject to the same rule — a skipped or empty audit week logs a job-run record and is not silently swallowed.
- **Data touched:** job-run log; `DATA-memories` (per job).
- **Permissions:** `service_role`.
- **Config dependencies:** the cadence schedules (Phase 2).
- **Surfaces:** memory health dashboard (job-run log + completion-rate).
- **Observability:** every job run logged; failures alert.
- **Acceptance criteria:**
  - AC-2.MNT.015.1 — Given any maintenance job, When it runs or fails, Then a log record captures time/outcome/records-affected.
  - AC-2.MNT.015.2 — Given a job failure, When it occurs, Then it is surfaced/alerted, not silent.
  - AC-2.MNT.015.3 — Given the weekly Haiku-gate sampled-drop audit (FR-2.ING.001), When the week's run completes with zero drops reviewed, Then a job-run record is still logged and flagged (not silently skipped).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** The **clearance-review trigger** (monthly, L1899) fires C1's FR-1.CLR.005 review on `CFG-clearance_review_cadence_days` (90); the scheduler mechanism is a harness/observability seam (C6/C7).

### FR-2.MNT.016 — Feedback loop: usage and human corrections adjust confidence and are logged
- **Statement:** The system shall feed retrieval outcomes and human actions back into confidence — a useful retrieval raises it (+0.02), a human edit/delete/flag lowers it (−0.15) — and shall log every feedback signal with timestamp, acting user, and reason; humans may also write memories directly (confidence 1.0, source human_verified).
- **Source:** design-doc-v4.md L1850–1856, L1688
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Task outcomes; human dashboard actions.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: a memory used in a successful task gains +0.02; a human correction logs the reason and lowers confidence (or edits content via the sole-writer path).
  - Branches: a direct human write enters at confidence 1.0 / `human_verified` (via the writer path, FR-2.WRT.001).
  - Edge / failure: every feedback signal is logged (#3) — silent confidence drift is forbidden.
- **Data touched:** `DATA-memories.confidence`; feedback log.
- **Permissions:** human writes/edits gated by C1 (`PERM-memory.write`).
- **Config dependencies:** the deltas (Phase 2).
- **Surfaces:** memory detail (history); memory health dashboard.
- **Observability:** feedback log (who/when/why).
- **Acceptance criteria:**
  - AC-2.MNT.016.1 — Given a human edits a memory, When saved, Then the feedback is logged with user/time/reason and goes through the sole writer.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.MNT.017 — Compliance erasure: an audited, Super-Admin-gated hard delete that cascades across the derived layers
- **Statement:** The system shall provide a compliance-erasure capability — distinct from decay/supersede — that, on a Super-Admin-gated request, **transitively** hard-deletes a target's Personal data across the live derived layers (the memory rows, the full `superseded_by` chain, the episodic evidence layer, the embeddings, and any future cold tier) **and any merged/summarised row derived from the target's Personal content**, writes an audit tombstone to `access_audit`, and flags the off-platform backups for purge on their next cycle.
- **Source:** **OD-038** (right-to-erasure); **gate Finding 4** (derived-row residue); design-doc-v4.md L1815 (non-destructive default it is the deliberate exception to); **C1** `PERM-memory.delete`; **ADR-008** (backups)
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** A Super Admin actioning a lawful erasure request.
- **Preconditions:** `PERM-memory.delete` (Super Admin; C1) + an erasure-specific gate (this is destructive, unlike retire/supersede); memories carry provenance refs (the episodic cluster a summary derived from, FR-2.MNT.007; the inputs a merge folded, FR-2.MNT.005).
- **Behaviour:**
  - Happy path: the erasure resolves the target (an individual / entity) and hard-deletes its Personal memories **including** their episodic evidence + embeddings (a true delete, not a supersede), recording an immutable tombstone (who/when/why/what-scope) in `access_audit`.
  - Branches: erasure resolves the target's data **transitively** (gate Finding 4) — it walks the **`superseded_by` chain** (older superseded rows are deleted too, not just the live row), and uses provenance refs to find **summary rows derived from an erased episodic cluster** (FR-2.MNT.007) and **merge-collapsed rows that folded a Personal input** (FR-2.MNT.005), and either deletes or **re-derives them without the erased content** — so Personal data cannot survive re-tagged as Standard/Confidential in a derived row. The **off-platform backup purge** (ADR-008) is seamed to Phase 5 — erased records are honoured on the next backup cycle / age out within the retention window; C2 raises the requirement, Phase 5 owns the mechanics.
  - Edge / failure: erasure is the **deliberate exception** to "decay never deletes" (FR-2.MNT.002) — destructive *by design*, hence Super-Admin-gated + audited; a "deleted" memory that silently survives in the supersede chain, a summary, a merged row, evidence, embeddings, or backups is the #2/#3 failure this FR forbids.
- **Data touched:** `DATA-memories` (transitive hard delete incl. chain + derived rows + evidence + embeddings), `DATA-access_audit` (tombstone), backup-purge flag (Phase 5).
- **Permissions:** `PERM-memory.delete` + erasure gate (Super Admin).
- **Config dependencies:** backup retention window (Phase 5 / ADR-008).
- **Surfaces:** a compliance-erasure action + log (Phase 3 / Phase 5).
- **Observability:** every erasure → immutable `access_audit` tombstone.
- **Acceptance criteria:**
  - AC-2.MNT.017.1 — Given an erasure request, When executed, Then the target's Personal memories + their full supersede chain + episodic evidence + embeddings are hard-deleted and a tombstone is recorded.
  - AC-2.MNT.017.2 — Given an erasure, When complete, Then the off-platform backups are flagged for purge per ADR-008 (mechanics owned by Phase 5).
  - AC-2.MNT.017.3 — Given erased Personal content that had been summarised or merged into a surviving (possibly non-Personal-tagged) row, When erasure runs, Then that derived content is also deleted or re-generated without it (no residue).
  - AC-2.MNT.017.4 — *(Change-control 2026-06-27, session 27 — OD-074, owed since C7.)* Given the erased target also appears in the **log sinks** (`event_log` / `guardrail_log`), When erasure runs, Then the erasure **triggers the C7 redaction-tombstone** (AC-7.LOG.006.3 / AC-7.LOG.007.4) — PII scrubbed in place, the row + audit metadata retained — so Personal data cannot survive in a log sink either. The C10 individual-erasure workflow (FR-10.DEL.004) is the caller; C7 owns the log-side mechanism.
  - AC-2.MNT.017.5 — *(Change-control 2026-06-27, session 27 — C10 gate M1, partial-failure fail-closed.)* Given the transitive erasure spans multiple stores (memory rows + chain + derived rows + evidence + embeddings + the `access_audit` tombstone + the OD-074 C7 log redaction), When any leg fails midway, Then the erasure is **verified-complete-or-fails-loud** — a partial completion is **recorded + escalated** (a per-leg status), **never reported done** (the caller C10 AC-10.DEL.003.4 verifies completeness before writing its audit-done record). Silent residue from a half-applied erasure is the #1/#2/#3 failure this AC forbids. Gated by **AF-137** (transitive-erasure completeness verification).
- **Open decisions:** ✅ RESOLVED — OD-038 → **RESOLVED**: rule homed here; backup-purge mechanics + retention seamed to Phase 5 + ADR-008. **OD-074 → RESOLVED** (this amendment): log-sink erasure extends to `event_log`/`guardrail_log` via the C7 redaction-tombstone (AC-2.MNT.017.4).
- **Feasibility assumptions:** —
- **Notes:** This is the **one** sanctioned destructive path in a deliberately non-destructive model — it exists to satisfy a #2 legal obligation (the ability to comply with a lawful erasure request), not for routine cleanup. Seam to **C7/Phase 5** (compliance) + **ADR-008** (backup purge).

---

# VEC — Vector index & embeddings

### FR-2.VEC.001 — HNSW index from day one, with tuned parameters
- **Statement:** The system shall index memory embeddings with a pgvector **HNSW** index from day one (`m = 16`, `ef_construction = 64`, query-time `ef_search` starting ~40 and tuned), to keep retrieval fast and accurate as the index grows without retraining.
- **Source:** design-doc-v4.md L1487–1516
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (index definition; Phase 4 authors the DDL).
- **Preconditions:** pgvector ≥0.8 on Supabase.
- **Behaviour:**
  - Happy path: `CREATE INDEX … USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)`; `ef_search` tuned per the recall/latency curve.
  - Branches: RLS/WHERE predicates apply **after** the ANN scan (AF-019) — `ef_search` must be high enough that enough cleared candidates survive.
  - Edge / failure: a too-low `ef_search` under heavy clearance filtering starves recall (the AF-019/AF-067 interaction).
- **Data touched:** `DATA-memories.embedding` (index).
- **Permissions:** N/A.
- **Config dependencies:** `ef_search` (LIVE, tunable).
- **Surfaces:** —
- **Observability:** retrieval latency + recall metrics.
- **Acceptance criteria:**
  - AC-2.VEC.001.1 — Given the memories table, When indexed, Then an HNSW cosine index exists with the documented parameters.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-019 (HNSW recall/latency at scale **with RLS predicates applied** — LOAD).

### FR-2.VEC.002 — One embedding model, recorded per memory (text-embedding-3-small, 1536 dims)
- **Statement:** The system shall embed memory content with a single configured model (default OpenAI `text-embedding-3-small`, 1536 dimensions) and shall record the embedding model name on every memory row so dimension mismatches are detectable.
- **Source:** design-doc-v4.md L73–78, L1037, L1520–1525
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The writer (embeds on write).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: each memory stores a 1536-dim embedding + the model name; the HNSW index is built for 1536 dims.
  - Branches: a model change invalidates existing embeddings (different vectors/dims) → the migration path (FR-2.VEC.003).
  - Edge / failure: writing an embedding of the wrong dimension is rejected (FR-2.MEM.002).
- **Data touched:** `DATA-memories.embedding`, `.embedding_model`.
- **Permissions:** writer.
- **Config dependencies:** `CFG-embedding_model` (change-controlled).
- **Surfaces:** —
- **Observability:** embedding spend (ADR-003 cost — OpenAI embeddings counted).
- **Acceptance criteria:**
  - AC-2.VEC.002.1 — Given a written memory, When stored, Then it carries a 1536-dim embedding and the model name.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-2.VEC.003 — Embedding-model change is a zero-downtime expand-contract migration
- **Statement:** The system shall change the embedding model only via an expand-contract migration — add an `embedding_v2` column, run a background re-embedding job, switch the read path, rename, drop the old index, rebuild on the new column — with zero user-facing downtime.
- **Source:** design-doc-v4.md L1520–1559; **`standards/migration-discipline.md`** (expand-contract)
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** A deliberate operator decision to change the model.
- **Preconditions:** Change control (this is a locked-schema change).
- **Behaviour:**
  - Happy path: expand (new column) → backfill (background re-embed) → **reconcile (100% of live rows have a valid `embedding_v2`)** → switch reads → contract (rename/drop old) — never a destructive in-place swap.
  - Branches: during the migration, reads use the old column until the switch (no mixed-dimension queries); a partial-backfill shortfall (some rows never re-embedded — the FR-2.WRT.007 provider-fragility case) **halts the migration before the contract step** with an alert (gate Finding 7).
  - Edge / failure: an in-place model swap that orphans existing embeddings is forbidden (#1); dropping the old column while any live row lacks a valid `embedding_v2` would silently make those rows unsearchable on the vector arm — the reconciliation gate forbids it.
- **Data touched:** `DATA-memories.embedding` (+ `embedding_v2`).
- **Permissions:** operator + change control.
- **Config dependencies:** `CFG-embedding_model`.
- **Surfaces:** —
- **Observability:** re-embedding-job progress + reconciliation completeness %.
- **Acceptance criteria:**
  - AC-2.VEC.003.1 — Given an embedding-model change, When migrated, Then it follows expand-contract with no downtime and no orphaned embeddings.
  - AC-2.VEC.003.2 — Given a partial backfill, When the contract (drop-old) step is reached, Then it is blocked until 100% of live rows have a valid `embedding_v2`; any shortfall halts the migration with an alert.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Follows the same expand-contract discipline ADR-005 mandates for the fleet (the migration standard).

---

# MAT — Maturity & Retrieval Sufficiency (ADR-002 home)

### FR-2.MAT.001 — Expected knowledge slots per entity type (the Maturity denominator)
- **Statement:** The system shall define 5–8 operator-editable **expected knowledge slots** per entity type as configuration (the Maturity denominator), and shall use empty slots to seed onboarding interview questions.
- **Source:** **ADR-002** (glossary "Expected knowledge slot"); design checklist L222–243
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Operator configuring slots; onboarding consuming them.
- **Preconditions:** Entity types defined (FR-2.ENT.002).
- **Behaviour:**
  - Happy path: each entity type carries 5–8 expected slots (e.g. a Client's budget, decision-makers, preferences); operators edit them as data.
  - Branches: empty slots feed the onboarding interview gap-detection (FR-2.ING.008).
  - Edge / failure: binary fill at v1 (a slot is filled or not); confidence-weighted slot-fill is deferred (OOS, ADR-002).
- **Data touched:** an expected-slots config table per entity type.
- **Permissions:** config authority (C1).
- **Config dependencies:** `CFG-expected_slots` per entity type.
- **Surfaces:** slot config + Maturity view (Phase 3).
- **Observability:** slot-config change `audit`.
- **Acceptance criteria:**
  - AC-2.MAT.001.1 — Given an entity type, When configured, Then it has 5–8 editable expected slots.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-034 (slot-fill Maturity predicts "system is useful").

### FR-2.MAT.002 — Maturity is computed per entity and drives cold-start gating
- **Statement:** The system shall compute Maturity (`filled slots / expected slots`) per entity, recomputed daily and on write, roll it up to an aggregate, and use the aggregate to drive cold-start gating (the cold-start *mode* deactivates permanently at 80%) and per-entity `[Building]` behaviour.
- **Source:** **ADR-002** (glossary "Maturity", "Cold start")
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Daily recompute + on-write; cold-start gating.
- **Preconditions:** Slots defined (FR-2.MAT.001).
- **Behaviour:**
  - Happy path: Maturity stored per entity; aggregate < `full_threshold` (80%) → cold-start mode (gates proactive behaviour at 20/50/80); ≥80% → mode off permanently.
  - Branches: a new/thin entity still raises the per-entity `[Building]` flag after cold-start mode is off.
  - Edge / failure: an incomplete onboarding (low Maturity) is visible via gating + the verification warning (FR-2.ING.009).
- **Data touched:** `DATA-entities` (Maturity), aggregate.
- **Permissions:** —
- **Config dependencies:** `CFG-cold_start_full_threshold` (80%) + the 20/50/80 gates (ADR-002).
- **Surfaces:** onboarding/Maturity dashboard.
- **Observability:** Maturity recompute logged.
- **Acceptance criteria:**
  - AC-2.MAT.002.1 — Given aggregate Maturity reaching 80%, When recomputed, Then cold-start mode deactivates permanently.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-034.

### FR-2.MAT.003 — Retrieval Sufficiency drives the [Building] flag (query-time)
- **Statement:** The system shall compute Retrieval Sufficiency inline per query — were the slots this query touches filled **and** surfaced above a relevance×confidence bar — and shall raise the `[Building]` flag when sufficiency is thin and the touched entities' Maturity is below the proactive threshold.
- **Source:** **ADR-002** (glossary "Retrieval Sufficiency"); design L1755–1772 (answer modes)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Per query (with FR-2.RET.007).
- **Preconditions:** Maturity available; the sufficiency threshold configured.
- **Behaviour:**
  - Happy path: sufficiency computed from existing retrieval signals (no stored metric); thin + low Maturity → `[Building]`.
  - Branches: thin + mature → plain `[Unknown]` (the coverage is as good as it'll get; not "still building").
  - Edge / failure: the threshold must cleanly separate `[Building]` from `[Unknown]` (AF-034) — a fuzzy split mislabels responses.
- **Data touched:** reads retrieval signals + Maturity.
- **Permissions:** —
- **Config dependencies:** `CFG-retrieval_sufficiency_threshold`.
- **Surfaces:** the `[Building]` flag on responses (C8-rendered).
- **Observability:** sufficiency distribution.
- **Acceptance criteria:**
  - AC-2.MAT.003.1 — Given thin sufficiency on a low-Maturity entity, When a query runs, Then [Building] is raised; on a mature entity, Then [Unknown] without [Building].
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-034 (the sufficiency threshold cleanly separates the two).

---

## Open decisions raised by this component (full text in `open-decisions.md`)

| OD | Question | Blocks |
|---|---|---|
| **OD-032** | Unresolved **hard-conflict** handling + the "inject both with a note" behaviour (what happens to a held write when a hard conflict is never reviewed; how "both with a note" renders/persists) | FR-2.WRT.002, FR-2.MNT.008 |
| **OD-033** | **Entity resolution / disambiguation / merge** mechanism (match precedence, ambiguity handling, dup-merge, entity-type soft-disable lifecycle) | FR-2.ENT.005, FR-2.ENT.002, FR-2.RET.001 |
| **OD-034** | **Cold-storage** mechanism + retrieval-back path + recall impact (archived vs degraded-searchable) | FR-2.MNT.012 |
| **OD-035** | **Vector-arm candidate-filter uniformity** — do the confidence-floor / expiry / superseded filters apply to the vector arm too; is `system_pointer` admission unconditional | FR-2.RET.003 |
| **OD-036** | **Trust-window shadow-retain** mechanics + exit criteria for the Filter-1 Haiku gate (ADR-003 §8) — what is retained, for how long, and what graduates the gate to trusted-discard | FR-2.ING.001 |
| **OD-037** | **Personal-consolidation gate** mechanism — skip outright vs route to a human-approval queue (merge + summarise) | FR-2.MNT.014, FR-2.MNT.005, FR-2.MNT.007 |
| **OD-038** | **Memory hard-delete / compliance erasure** path — right-to-erasure for Personal data across the episodic evidence layer, embeddings, cold storage, and backups (vs "decay never deletes") | (cross-cutting; seams to Phase 5 compliance + ADR-008) |

## Seams to other components (acknowledged, not owned here)

- **C3 (Tool Layer):** the connectors behind the three ingestion pipelines (GHL/Drive/Slack OAuth, rate/token limits — AF-003 corrected values, OD-011 Slack app class) and the **live-data fetch** for relevance cross-check (FR-2.MNT.011). C2 consumes extracted data + live records; C3 owns the connection.
- **C5/C6/C8 (Harness / Guardrails / Agent design):** the **scheduler** that fires the maintenance cadences (FR-2.MNT.015); the **answer-mode pill rendering** + Inferred-vs-Cited decision (FR-2.RET.007); the mid-task `service_role` revocation **quarantine machinery** (C1 FR-1.RLS.007) that protects a long-running writer.
- **C7 / Phase 5 (Compliance / NFR):** `access_audit` storage/retention/tamper-evidence (OD-024); the compliance-erasure path (OD-038).
- **Phase 4 (Data model):** the SQL for `DATA-memories`, `DATA-entities`, `DATA-ingestion_queue`, the expected-slots + entity-type config tables, the HNSW index, and the C1 RLS predicates attached to `memories`.
- **Phase 2 (Config):** every `CFG-*` named here (the L906–926 block + the Haiku-gate/trust-window/cadence keys) is classified + surfaced.
