# Surface: UI-MEMORY-NAV (surface-11) — Memory Navigation / Entity Browser

**Status:** 🟢 **Drafted + gate-clean 2026-07-01** — OD-145–148 raised + resolved surface-local (recommendations). The twelfth
Phase-3 surface. Surface ID **`UI-MEMORY-NAV`** is **minted here** — C2 references "entity browser", "entity detail",
"memory detail view", and the dual keyword+vector search by description (FR-2.ENT.001/003/004, FR-2.MEM.002, FR-2.RET.002)
but assigns no `UI-` id. FR source: **C2 (Memory)** — the entity model, the memory schema, the clearance-scoped retrieval
rules, and the Maturity / answer-mode signals. This is the **read/browse** counterpart to surface-03's memory-*review*
queues: surface-03 gates the **write path**, surface-11 navigates **what is stored**. **No PERM entry node is minted** —
memory *read* is clearance-scoped at the row (FR-2.RET.004 / C1 FR-1.RLS.003), not node-gated (OD-145); the browser shows
exactly the cleared subset a user's retrieval would surface. **Catalog housekeeping done this session (separate from
surface-11's own ODs):** the **3 long-owed nodes** flagged in `PERMISSION_NODES.md` — `PERM-memory.review_conflict` +
`PERM-memory.approve_consolidation` (surface-03 / OD-115) and `PERM-action.review` (surface-04 / OD-117) — are
**transcribed into the catalog** (48→51), closing a standing Rule-0 dangling-ID debt. Next OD: OD-149.

> **Verification gate (independent zero-context subagent, checks a–f): CLEAN — 0 HIGH · 0 MED · 2 LOW (both benign).**
> (a) Coverage PASS — every cited C2 FR/AC (MEM/ENT/TAG/RET/MNT/MAT) resolves and paraphrases faithfully; no invented AC;
> no over-claim (answer-mode pill → C4/C8, ingestion → surface-03, agent-actions → surface-04 all correctly seamed out;
> the surface never writes memory directly). (b) CFG PASS — all four keys real, treated read-only (edited on surface-01).
> (c) DATA PASS — no `client_slug`; read is row-level clearance RLS (FR-1.RLS.003), no `service_role` browse; field lists
> match MEM.002/ENT.004. (d) PERM PASS — no entry node minted (memory read = clearance model, OD-145); the 3 long-owed
> nodes transcribed with 4-field defs matching open-decisions.md; catalog 48→51, owed-debt CLOSED; six roles used, no
> role-string gates. (e) #1/#2/#3 sweep PASS — clearance/Restricted enforced *before* display everywhere (no
> shown-then-hidden leak); Restricted explicit-and-audited only; Internal Org walled; supersede chains drillable/retained;
> a failed load never reads as an empty brain; every human edit routes through the sole writer (ADR-004), never a direct
> `UPDATE`. (f) Seams PASS. **LOW-1 (not a surface defect):** the surface's duplicate-cluster cite `FR-2.MNT.010` is
> *correct* — the C2 component's own L219 prose mis-cited it as `FR-2.MNT.011` (structural vs relevance erosion); **the
> stale C2 cross-ref was corrected this session** (anti-hallucination reference-verify). **LOW-2:** this banner replaced
> its "pending" placeholder with the PASS result (done).

> The **human window into the business brain** — the surface a cleared user opens to *see what the system knows*: the
> **Entity Browser** (every entity the brain is organised around — Clients, Contacts, Deals, the singular Internal Org —
> each with its memory count, its Maturity, and a `[Building]` marker when coverage is thin), the **Entity Detail**
> (one entity's memories grouped by type, its filled/empty knowledge slots, its cross-system pointers), the **Memory
> Detail** (one memory row in full — content, provenance, confidence, visibility × sensitivity, and the drillable
> supersede chain), and **Memory Search** (the same dual keyword + vector search retrieval uses, exposed for a human to
> explore). The three non-negotiables it most directly serves: **#1** — the browser is where knowledge *integrity* is
> made visible: a supersede chain is drillable (nothing is overwritten, the prior version is retained, FR-2.MNT.007),
> a fragmented entity (two rows for one real client — the AF-082 risk) is *visible* so a human can spot and merge it,
> and erasure is an audited cascade (FR-2.MNT.017); **#2** — clearance, visibility, and Restricted are enforced at the
> row **before** anything is shown (FR-2.RET.004 — never shown-then-hidden, which could leak via ordering), Restricted is
> **never auto-shown** (surfaces only via explicit audited access, C1 FR-1.RST.003), Internal Org is walled from
> client-facing agents (FR-2.ENT.003), and every human edit routes through the **sole writer** (ADR-004 — the browser
> never issues a direct `UPDATE`); **#3** — a memory that failed to embed was never stored (FR-2.WRT.007) so it can't
> appear as a silent partial, a low-confidence or system-of-record-contradicted memory is **shown with its state**
> (FR-2.MNT.001) rather than silently trusted or hidden, and a failed/stale load reads "—", never a false-empty brain.
> It does **not** write memory (that is the Memory Agent, C2 WRT), gate the *ingestion* write path (surface-03), review
> agent *actions* (surface-04), or edit memory-structure *config* (entity types / expected slots live in the config
> registry, edited on surface-01 — reflected read-only here).

---

## Context manifest

- **Surface ID:** **`UI-MEMORY-NAV`** (minted here) — C2 names the entity browser / entity detail / memory detail /
  search by description but assigns no `UI-` id. The operator's planning-doc "memory browser / knowledge explorer"
  concept maps here.
- **Owned by:** **C2 (Memory)** — the four memory types + row schema (FR-2.MEM.001/002), the entity model
  (FR-2.ENT.001–005), visibility × sensitivity tagging (FR-2.TAG.001–003), the clearance-scoped retrieval pipeline
  (FR-2.RET.001–007 — the browser reuses its filter + search), the confidence lifecycle + supersede/summarise history
  (FR-2.MNT.001/006/007), compliance erasure (FR-2.MNT.017), and Maturity / Retrieval-Sufficiency (FR-2.MAT.001–003).
  **C1** owns the clearance/visibility/Restricted model the browser reads under (FR-1.CLR.*/RST.*/RLS.003). **C10 / C2**
  own the erasure workflow the browser *initiates* (FR-2.MNT.017 / C10 FR-10.DEL.*). **C4/C8** own the answer-mode pill
  seam where AI-derived context is shown (FR-4.CID.006 — rendered on the chat/activity surfaces, not here).
- **FRs served:**
  - **The memory model (C2 MEM):** FR-2.MEM.001 (**four types** — semantic / episodic / procedural durable, working
    transient; the browser groups a memory by type, AC-2.MEM.001.1), FR-2.MEM.002 (**the memory row schema** — id, type,
    content, embedding, `entity_ids` (≥1), source, source_ref, confidence, visibility, sensitivity, `superseded_by`,
    `expires_at`, timestamps; the Memory Detail renders all of it; a memory with zero entities can't exist AC-2.MEM.002.2).
  - **The entity model (C2 ENT):** FR-2.ENT.001 (**every memory hangs off ≥1 entity** — knowledge is entity-organised;
    the browser's spine), FR-2.ENT.002 (**entity types are per-deployment config** with a documented default set incl.
    Internal Org; the browser filters by type — the type *list* is config, surface-01), FR-2.ENT.003 (**Internal Org is
    first-class, singular, walled off from client-facing agents** — distinguished in the browser, its memories default
    Confidential/Restricted; a cleared *human* may see it, a client-facing *agent* never does AC-2.ENT.003.2),
    FR-2.ENT.004 (**the entity row + `external_refs`** — the cross-system pointers GHL/Slack/Drive shown on Entity
    Detail), FR-2.ENT.005 (**entity resolution** — the browser is where a human can *see* a fragmented/duplicate entity,
    the AF-082 risk, and route a merge; ambiguity handled per OD-033).
  - **Tagging (C2 TAG):** FR-2.TAG.001 (**visibility** global/team/private — shown on each memory), FR-2.TAG.002
    (**sensitivity** Standard/Confidential/Personal/Restricted, writer-assigned, **Restricted never autonomous** — shown
    as a tag; editing a tier routes to the writer), FR-2.TAG.003 (**visibility and sensitivity are orthogonal, both apply
    at retrieval** — both gate what the browser shows, AC-2.TAG.003.1).
  - **Retrieval / search reused as browse (C2 RET):** FR-2.RET.002 (**dual search** — keyword exact + vector semantic
    top-20; Memory Search exposes both to a human), FR-2.RET.004 (**clearance + visibility filter runs BEFORE ranking,
    never after** — the browser applies the identical filter; a memory outside clearance is excluded *before* it could
    appear, never shown-then-stripped AC-2.RET.004.1; the agent-scope predicate AC-2.RET.004.2 is an agent-path concern,
    N/A to a human browser), FR-2.RET.006 (**Restricted never auto-injected/-shown** — even a cleared holder sees
    Restricted only via explicit audited access, C1 FR-1.RST.003), FR-2.RET.007 (**answer modes + Retrieval Sufficiency /
    `[Building]`** — the browser surfaces the `[Building]`/coverage signal per entity; the *pill on a response* is C8's
    seam, not rendered here).
  - **Lifecycle / integrity made visible (C2 MNT):** FR-2.MNT.001 (**confidence lifecycle** — the Memory Detail shows the
    current confidence + its movement signals; `human_verified` never decays; a system-of-record contradiction is shown
    flagged, not hidden), FR-2.MNT.006 (**supersede safety net**) + FR-2.MNT.007 (**summarise: episodic→semantic,
    evidence retained + drillable** — the supersede/summary chain is navigable, nothing overwritten, #1), FR-2.MNT.017
    (**compliance erasure — an audited, Super-Admin-gated hard delete that cascades across the derived layers** — the
    browser *initiates* it under `PERM-memory.delete`; the transitive cascade + verify-before-done is C2/C10).
  - **Maturity / coverage (C2 MAT):** FR-2.MAT.001 (**expected knowledge slots per entity type** — the Maturity
    denominator; Entity Detail shows filled/empty slots; the slot *list* is config, surface-01), FR-2.MAT.002 (**Maturity
    = filled/expected per entity**, drives cold-start gating; shown as a per-entity %), FR-2.MAT.003 (**Retrieval
    Sufficiency drives `[Building]`** — the browser marks a thin/low-Maturity entity `[Building]`, AC-2.MAT.003.1).
- **CFG dependencies** (all **read-only reflections** — the browser reflects these config-derived values but **edits none
  here**; entity-type + slot config are edited on **surface-01** / the config admin, gated `PERM-config.*`; description
  text binds DRY to `config-registry.md`):
  - `CFG-entity_types` — the configurable entity-type list (FR-2.ENT.002; the browser's type filter reflects it).
  - `CFG-expected_slots` — the 5–8 expected knowledge slots per entity type (FR-2.MAT.001; Entity Detail reflects
    filled/empty).
  - `CFG-cold_start_full_threshold` (**80%**) — the Maturity aggregate at which cold-start mode ends (FR-2.MAT.002;
    shown as context on the per-entity Maturity %).
  - `CFG-retrieval_sufficiency_threshold` — the thin-vs-sufficient bar behind the `[Building]` marker (FR-2.MAT.003 /
    FR-2.RET.007).
- **PERM gates:** ⚠️ **OD-145 — memory read is clearance-scoped, not node-gated (no new entry node).** There is **no
  `PERM-memory.view`/`.browse` node** in the catalog, and the surface **does not mint one** — memory *read* authority is
  the **C1 clearance/visibility model** applied at the row (FR-2.RET.004 / FR-1.RLS.003 / FR-1.CLR.006), the same model
  that decides what retrieval injects into any task. Introducing a browse node would make this the *only* place
  memory-read is node-gated — an inconsistency. Entry is therefore **any authenticated user**; the row-level filter shows
  each user exactly their cleared subset (a Standard User sees global-visibility Standard business knowledge; an
  Account Manager sees their clients under clearance; Restricted is never auto-shown to anyone, RST.003). **Every
  mutation, by contrast, IS node-gated** (the browser is read-first):
  - **`PERM-memory.write`** (Super Admin, unseeded) — a human content correction / tier change; **routes through the sole
    writer** (ADR-004 — never a direct `UPDATE`, OD-148).
  - **`PERM-memory.delete`** (Super Admin + erasure gate) — initiate compliance erasure (FR-2.MNT.017); the two-gated
    cascade is C2/C10.
  - **Conflict / consolidation review** links out to **surface-03** (`PERM-memory.review_conflict` /
    `PERM-memory.approve_consolidation`) — the browser surfaces a conflicted/duplicate entity but the *decision* is
    surface-03's (these two nodes are **transcribed to the catalog this session**, closing the OD-115 debt).
  - A **flag-as-incorrect / verify-as-correct** feedback action is a logged confidence signal (FR-2.MNT.016 — "human
    corrections adjust confidence and are logged"), available to a cleared viewer; a change to *content* escalates to
    `PERM-memory.write` (writer-routed). All nodes default-deny (FR-1.PERM.002 / OD-030).
- **DATA bindings** (Phase-4 stubs; **intra-client — no `client_slug` on any binding** per OD-096 / FR-10.ISO.001;
  reads are RLS-clearance-scoped per C1 FR-1.RLS.003; ADR-006):
  - **`DATA-memories`** (read; FR-2.MEM.002) — id, type, content, embedding (not displayed raw), `entity_ids` (uuid[]),
    source (`ai_inferred`/`human_verified`/`system_pointer`), source_ref, confidence, visibility, sensitivity,
    `superseded_by`, `expires_at`, timestamps. **Row-level clearance/visibility/Restricted RLS (FR-1.RLS.003) is the
    gate.** **No `client_slug`.**
  - **`DATA-entities`** (read; FR-2.ENT.004) — id, type (from `CFG-entity_types`), name, `external_refs` (json — GHL /
    Slack / Drive ids), created_at; plus the per-entity Maturity (FR-2.MAT.002) and the Internal Org singleton flag
    (FR-2.ENT.003). **No `client_slug`.**
  - **Expected-slots store** (read; FR-2.MAT.001) — per entity type, the 5–8 slots + filled/empty state per entity
    (config-defined list; the fill-state is derived from memories). **No `client_slug`.**
  - **`access_audit`** (write on Personal/Restricted view; C1 FR-1.AUD.001) — viewing a Confidential/Restricted memory
    or an Internal Org memory is audited (FR-2.ENT.003 / FR-2.RET.004 observability). **No `client_slug`.**
  - **Sole-writer path** (write, indirect; FR-2.WRT.001/006) — a human correction is submitted to the Memory Agent's
    validate-and-commit flow (per-entity lock, contradiction check), never a direct table write.
- **ADR constraints:**
  - **ADR-004** — the **Memory Agent is the sole writer**: the browser is **read-first**; any human edit/correction is an
    authorized *request* routed through the writer's validate-and-commit (FR-2.WRT.006), never a direct `UPDATE` (OD-148).
  - **ADR-002** — **Maturity + Retrieval Sufficiency**: the browser surfaces per-entity Maturity and the `[Building]`
    coverage marker (FR-2.MAT.002/003) — making cold-start / thin-coverage visible.
  - **ADR-006** — reads are **static data-driven RLS** clearance-scoped at the row (FR-1.RLS.003); the human path is
    RLS-backstopped (no `service_role` browse).
  - **ADR-001 §3** — intra-client only; **no `client_slug` column** on any binding; no cross-deployment view.
  - **The three non-negotiables** — **#1** (supersede/summary chains drillable, nothing overwritten MNT.007;
    fragmentation visible + mergeable ENT.005/AF-082; erasure audited-cascade MNT.017), **#2** (clearance/visibility/
    Restricted filtered *before* display RET.004; Restricted never auto-shown RST.003; Internal Org walled ENT.003; edits
    sole-writer-routed ADR-004), **#3** (embed-failed memories never stored so never a silent partial WRT.007;
    low-confidence/contradicted memories shown *with state* MNT.001; failed/stale load reads "—", never a false-empty brain).

---

## Overview

surface-11 is the **memory navigation / entity browser** of one client deployment — the surface a cleared user opens to
*see what the system knows*. It renders the entity-organised brain C2 defines: the **Entity Browser** (every entity, its
type, its memory count, its Maturity %, a `[Building]` marker on thin entities), **Entity Detail** (one entity's memories
grouped by type + its filled/empty knowledge slots + its cross-system pointers), **Memory Detail** (one memory row in full
— content, provenance, confidence, visibility × sensitivity, and the drillable supersede chain), and **Memory Search**
(the dual keyword + vector search retrieval uses, exposed for a human). It is **read-first**: viewing is clearance-scoped
at the row (a user sees exactly the cleared subset their retrieval would surface — Restricted never auto-shown), and every
*mutation* routes through a node-gated, sole-writer path (ADR-004). It is the human window into the three memory
non-negotiables — where knowledge integrity is made *visible* (supersede chains, fragmentation, erasure), where the
clearance wall is enforced *before* display (never shown-then-hidden), and where a low-confidence or contradicted memory
is shown *with its state* rather than silently trusted. The cardinal sins here are a **Restricted or out-of-clearance
memory rendered** (a #2 leak — guarded by RET.004 filter-before-display + RST.003), a **direct human `UPDATE` bypassing
the sole writer** (a #2/#1 breach of ADR-004), and a **failed load reading as an empty brain** (a #3 false-healthy view).

---

## Access

> Uses the six canonical C1 roles (FR-1.ROLE.001). **Entry is any authenticated user** — memory read is clearance-scoped
> at the row (OD-145), not gated by a browse node. What each role *sees* is their cleared subset; what each role can *do*
> (correct / erase) is node-gated below. Restricted content is never auto-shown to anyone (RST.003).

| Role | Can enter? | What they see / can do |
|---|---|---|
| Super Admin | Yes | Full cleared view (incl. Internal Org under clearance); may correct (`PERM-memory.write`, writer-routed) + initiate erasure (`PERM-memory.delete`) |
| Admin | Yes | Cleared view; conflict/consolidation review links to surface-03 (`PERM-memory.review_conflict` if held) |
| Finance | Yes | Cleared view scoped to finance-cleared entities/tiers (FR-1.CLR.004 entity-type-scoped clearance) |
| HR | Yes | Cleared view; HR-tier content per clearance (HR memory is excluded-by-default at ingestion, FR-2.ING.005) |
| Account Manager | Yes | Cleared view of their clients' entities + memories (the primary day-to-day browser user) |
| Standard User | Yes | Cleared view — global-visibility Standard business knowledge; no Confidential/Personal/Restricted without clearance |

**Entry gate:** none beyond authentication — the surface renders for any authenticated user, and the **row-level
clearance/visibility/Restricted RLS (FR-1.RLS.003 / FR-2.RET.004)** determines what appears. This mirrors the memory-read
model everywhere else in the system (retrieval is clearance-scoped, not node-gated). **Mutations are node-gated:**
correcting a memory = `PERM-memory.write` (writer-routed, ADR-004); initiating erasure = `PERM-memory.delete` (+ erasure
gate); conflict/consolidation decisions route to surface-03. Viewing a Confidential/Restricted/Internal-Org memory is
**audited** (`access_audit`, FR-1.AUD.001). All mutation nodes default-deny (OD-030).

---

## Layout

A **browser + detail-drawer console** on the client deployment, reached from the main navigation (**OD-146**): an
**Entity Browser grid/list landing** (one card/row per entity, type-filterable, searchable) with a **per-entity detail
drawer** that opens over the grid, from which a **Memory Detail** view opens for a single memory. A persistent **Memory
Search** bar (dual keyword + vector) sits in the header and can search across the whole cleared brain, not just the
current entity. Persistent chrome: a sticky header with the search bar + type filter + a clearance indicator ("showing
your cleared view"), and the two always-loud notification banners (alert-engine-stalled AC-7.ALR.008.2,
alert-delivery-misconfigured AC-7.ALR.009.1) pinned above (FR-7.ALR.001).

- **Browser section (landing):** the **Entity Browser** grid (Section A); clicking a card opens the **Entity Detail**
  drawer (Section B), from which a memory opens the **Memory Detail** (Section C).
- **Search:** the **Memory Search** bar (Section D) is always available and returns entities + memories.

**No section here holds a Realtime subscription** — surface-11 is a read/navigation surface, not one of the two Realtime
surfaces (FR-7.RTP.001 = approval queue + notification centre). The browser is **static on load + on-demand refresh** (the
brain changes on writes made elsewhere; a manual refresh re-reads). Per-entity Maturity / `[Building]` markers refresh on
load (recomputed daily + on-write server-side, FR-2.MAT.002).

---

## Sections

> Four sections in two playbook buckets: **navigate the brain** (A Entity Browser · B Entity Detail · C Memory Detail)
> and **find within it** (D Memory Search). Each states its poll contract and all five states.

---

### Section A — Entity Browser (the entity grid; landing)

**Purpose:** The entity-organised spine (FR-2.ENT.001) — one card/row per entity the caller is cleared to see, filterable
by type (FR-2.ENT.002), each a glance at *what this entity is, how much the brain knows about it, is that coverage thin*.
Clicking opens Entity Detail (Section B). This is where a human can spot a **fragmented/duplicate entity** (two rows for
one real client — the AF-082 risk) and route a merge (FR-2.ENT.005).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Entity card (one per row) | `DATA-entities` (FR-2.ENT.004) | `type`, `name`, memory count, Maturity %, `[Building]` marker; **clearance-scoped** — only cleared entities appear |
| Type filter | `CFG-entity_types` (FR-2.ENT.002) | The configurable type list (config, surface-01); Internal Org is a distinguished, singular type (FR-2.ENT.003) |
| Maturity % | per-entity Maturity (FR-2.MAT.002) | `filled slots / expected slots`; context: cold-start ends at `CFG-cold_start_full_threshold` (80%) |
| `[Building]` marker | FR-2.MAT.003 / FR-2.RET.007 | Thin coverage on a low-Maturity entity — shown honestly, never hidden (#3) |
| Internal Org badge | FR-2.ENT.003 | The singular Internal Org entity is distinguished + walled from client-facing agents; a cleared human sees it under clearance |
| Possible-duplicate flag | FR-2.ENT.005 / FR-2.MNT.010 | A structural-erosion duplicate cluster is surfaced so a human can merge — the fragmentation (#1) safeguard |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Open entity (card click) | Opens the Entity Detail drawer (Section B) | none (clearance-scoped read) |
| Filter by type | Filters the grid by `CFG-entity_types` value | none |
| Merge duplicate entities → | Routes a flagged duplicate cluster to the entity-merge path (FR-2.ENT.005 / OD-033) — a writer-side operation | `PERM-memory.write` (writer-routed) |
| Edit entity types → | Links to **surface-01** (the entity-type list is config, FR-2.ENT.002) | `PERM-config.*` (surface-01) |

**Real-time / poll:** **Static on load + on-demand refresh.** Not Realtime. Maturity/`[Building]` reflect the last
server recompute (daily + on-write).

**States:**
- **Loading:** Skeleton cards — never a false "no entities" before data resolves.
- **Empty:** Genuinely no cleared entities → distinguish two cases: a **brand-new/cold-start deployment** ("The brain is
  still being built — entities appear as knowledge is ingested", tied to Maturity/onboarding FR-2.ING.009) vs **a cleared
  user who legitimately has zero in-scope entities** ("No entities in your cleared view"). Never a bare blank.
- **Error:** `DATA-entities` read fails → "Couldn't load the entity browser" + retry; **never render an empty grid as if
  the brain were empty** (a false-empty could mask a lost/again-unreadable store — a #1/#3 risk).
- **Partial:** Entities load but the Maturity/`[Building]` recompute is stale/unavailable → cards render with Maturity
  marked **"as-of HH:MM" / "coverage unavailable"**, never a false 100% or a missing `[Building]` on a thin entity.
- **Offline / stale:** "last loaded HH:MM" + manual refresh; merge/erase actions disabled offline.

---

### Section B — Entity Detail (one entity's memories, slots, pointers)

**Purpose:** One entity's full picture (FR-2.ENT.001/003/004) — its memories grouped by type (FR-2.MEM.001), its filled/
empty knowledge slots (FR-2.MAT.001, the Maturity denominator + the onboarding gap), and its cross-system pointers
(`external_refs`, FR-2.ENT.004). This is where thin coverage is concrete: an empty slot is a visible gap.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Entity header | `DATA-entities` (FR-2.ENT.004) | `type`, `name`, `external_refs`, Maturity %, Internal-Org / `[Building]` markers |
| Memories (grouped by type) | `DATA-memories` where entity in `entity_ids` (FR-2.MEM.001/ENT.001) | Semantic / Episodic / Procedural groups; **clearance-scoped before display** (FR-2.RET.004); Restricted not auto-shown (RST.003) |
| Knowledge slots | Expected-slots store (FR-2.MAT.001) | 5–8 per type; **filled** (links to the memory that fills it) vs **empty** (the visible gap → onboarding question, FR-2.ING.008) |
| External references | `external_refs` json (FR-2.ENT.004) | Pointers to GHL / Slack / Drive — the golden-rule "where the real record lives" (FR-2.WRT.004); a link out, not a copy |
| Related entities | memories with multiple `entity_ids` (FR-2.ENT.001) | Entities this one co-occurs with (a deal → client + contact) |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Open a memory | Opens the Memory Detail (Section C) | none (clearance-scoped read) |
| Follow an external ref | Opens the source system record (the pointer, not a copy — FR-2.WRT.004) | the external system's own auth |
| Correct / add knowledge → | Submits a correction/addition to the **sole writer** (ADR-004 / FR-2.WRT.006) — never a direct write | `PERM-memory.write` (writer-routed) |
| Initiate erasure → | Starts the audited compliance-erasure workflow for this entity's memories (FR-2.MNT.017; the two-gated cascade is C2/C10) | `PERM-memory.delete` (+ erasure gate) |
| Merge / disambiguate → | Routes to the entity-merge path if this entity is a duplicate (FR-2.ENT.005 / OD-033) | `PERM-memory.write` (writer-routed) |

**Real-time / poll:** **Static on load + on-demand.** Not Realtime.

**States:**
- **Loading:** Skeleton header + memory groups; slots load after the memory list resolves.
- **Empty:** A real entity with **no cleared memories** → "No memories you're cleared to see for this entity" (distinct
  from "this entity has no memories" — the two must not be conflated, a #2/#3 distinction: a cleared-out view is not an
  empty brain). Empty **slots** are shown as gaps, not hidden.
- **Error:** Read fails → "Couldn't load this entity" + retry; a **memory-group** read failure shows that group as
  "couldn't load", never an empty group implying the entity has no memories of that type.
- **Partial:** The entity + some memory groups load, others fail, or the slot store is down → render what loaded, mark the
  gap; **a missing slot readout never renders as 100% Maturity** (a false-complete would hide a coverage gap, #3).
- **Offline / stale:** "as-of HH:MM"; correct/erase/merge disabled offline.

---

### Section C — Memory Detail (one memory row in full)

**Purpose:** One memory row (FR-2.MEM.002) in full — content, type, the entities it hangs off, its **provenance**
(source + source_ref — the basis for a Cited pill elsewhere), its **confidence** + lifecycle state, its **visibility ×
sensitivity** tags, and its **drillable supersede/summary chain** (nothing overwritten — the prior evidence is retained,
FR-2.MNT.007). This is where a memory's *trustworthiness* is legible.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Content + type | `DATA-memories.content`/`.type` (FR-2.MEM.001/002) | `[Semantic]`/`[Episodic]`/`[Procedural]` |
| Entities | `entity_ids` (FR-2.ENT.001) | Links back to each entity (Section B) |
| Provenance | `source` / `source_ref` (FR-2.MEM.002 / FR-2.WRT.004) | `ai_inferred` / `human_verified` / `system_pointer`; for a pointer, "the live record lives in GHL/Drive" (the Cited-pill basis, FR-2.RET.007) |
| Confidence + state | `confidence` + lifecycle (FR-2.MNT.001) | Current value + signals; `human_verified` never decays; a **system-of-record contradiction is shown flagged** (−0.20, "the brain may be wrong here"), never hidden (#1) |
| Visibility × sensitivity | `.visibility` / `.sensitivity` (FR-2.TAG.001–003) | Two orthogonal tags; **Restricted content is not rendered unless the viewer took an explicit, audited access** (RST.003) |
| Supersede / summary chain | `superseded_by` (FR-2.MNT.006/007) | Drillable — the superseded originals + summarised evidence are **retained + navigable**, never overwritten (#1) |
| Expiry | `expires_at` (FR-2.MNT.004) | If set, when this memory hard-expires |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Drill supersede/summary chain | Navigates prior versions / summarised source memories (read-only) | none (clearance-scoped read) |
| Verify as correct / flag as incorrect | A logged **feedback** signal adjusting confidence (FR-2.MNT.016 verify +0.10 / flag −0.15) — not a content edit | cleared viewer (logged, FR-2.MNT.016) |
| Correct content / re-tag → | Submits a content/tier change to the **sole writer** (ADR-004 / FR-2.WRT.006) — validate-and-commit under the per-entity lock + contradiction check; never a direct `UPDATE` | `PERM-memory.write` (writer-routed) |
| Reveal Restricted (if cleared) | Explicit, **audited** access to a Restricted memory (never auto-shown, RST.003 / FR-1.AUD.001) | matching Restricted grant (FR-1.RST.001) |
| Initiate erasure → | Starts the audited hard-delete cascade for this memory (FR-2.MNT.017) | `PERM-memory.delete` (+ erasure gate) |

**Real-time / poll:** **Static on load + on-demand.** Not Realtime.

**States:**
- **Loading:** Skeleton row; the supersede chain loads after the row.
- **Empty:** N/A — a Memory Detail is opened for an existing memory (there is no empty memory: a zero-entity or
  embed-failed memory was never stored, AC-2.MEM.002.2 / FR-2.WRT.007).
- **Error:** Read fails → "Couldn't load this memory" + retry; a **supersede-chain** read failure shows "history couldn't
  load — this may not be the full chain", **never an empty chain implying no prior versions** (a false-empty would imply
  history was lost, #1).
- **Partial:** The row loads but confidence-lifecycle or provenance detail fails → render what loaded, mark the gap;
  **provenance never silently reads "verified" when the source couldn't be confirmed** (an unresolved provenance shows
  "source unconfirmed", mirroring the answer-mode honesty, #3).
- **Offline / stale:** "as-of HH:MM"; verify/flag/correct/reveal/erase disabled offline.

---

### Section D — Memory Search (dual keyword + vector; clearance-before-ranking)

**Purpose:** The dual search retrieval uses (FR-2.RET.002) — **keyword** (exact) + **vector** (semantic top-20) — exposed
for a human to explore the cleared brain by text or meaning. It is the browse counterpart to task-time retrieval: the
**identical clearance/visibility/Restricted filter runs BEFORE ranking** (FR-2.RET.004), so a search can never surface —
even transiently, even by score/order — a memory the caller isn't cleared for.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Keyword results | `DATA-memories` exact match (FR-2.RET.002) | This client only; clearance-filtered before results |
| Vector results | `DATA-memories` semantic top-20 (FR-2.RET.002 / VEC.001 HNSW) | Semantic similarity; clearance-filtered before results |
| Clearance filter | FR-2.RET.004 | **Runs before ranking** — out-of-clearance candidates are excluded first (never ranked-then-hidden, AC-2.RET.004.1); Restricted never auto-shown (RST.003) |
| Result row | `DATA-memories` + `DATA-entities` | Each hit shows entity + type + a confidence/sensitivity glance; opens Memory Detail (Section C) |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Search (keyword/semantic) | Runs the dual search over the **cleared** brain | none (clearance-scoped read) |
| Open a result | Opens Memory Detail (Section C) / Entity Detail (Section B) | none (clearance-scoped read) |

**Real-time / poll:** **On-demand** (the user runs a search). Not Realtime.

**States:**
- **Loading:** "Searching…" spinner; keyword + vector arms may resolve at different times.
- **Empty:** A genuine no-match → "No cleared memories match" (distinct from a search *error*; and the copy makes clear it
  is *your cleared view*, not "the brain knows nothing").
- **Error:** Search fails (keyword or vector arm) → "Search couldn't complete" + retry; **if only one arm fails**, show
  the results that returned **and** a clear "semantic/keyword results unavailable" note — never present a half-result set
  as complete (a #3 partial-masking risk).
- **Partial:** One arm returns, the other is slow/failed → render the returned arm, mark the missing arm; never imply the
  result set is exhaustive.
- **Offline / stale:** Search disabled with "You're offline — search unavailable"; last results (if any) marked stale.

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| Main nav → Memory / Knowledge browser | surface-11 (Entity Browser landing) |
| Entity card click | Section B Entity Detail drawer |
| Memory row click | Section C Memory Detail |
| Memory Search result | Section B or C |
| External ref | The source system record (GHL / Slack / Drive — the pointer, FR-2.WRT.004) |
| Correct / merge → | The sole-writer submit flow (ADR-004; `PERM-memory.write`) |
| Initiate erasure → | The compliance-erasure workflow (FR-2.MNT.017 / C10; `PERM-memory.delete`) |
| Conflicted / consolidation-pending item → | surface-03 (Memory Review — `PERM-memory.review_conflict` / `PERM-memory.approve_consolidation`) |
| Edit entity types / expected slots → | surface-01 (config; `PERM-config.*`) |

---

## Mobile

This is a **read-friendly** surface — browsing entities and reading a memory works on a phone, and the clearance filter is
identical on any viewport. On a narrow viewport the Entity Browser collapses to a single-column list, Entity Detail and
Memory Detail become full-screen views, and Memory Search remains available. **Mutations** (correct → sole writer, erase,
merge) are **best-effort / discouraged on mobile** and may be gated behind an "do this on desktop" notice — a mis-issued
correction or an erasure is a #1/#2 action better not fat-fingered — but **verify/flag feedback** (a low-risk confidence
signal) remains available. Restricted content still requires the same explicit, audited reveal (RST.003). The two
protective notification banners remain mandatory. Detailed mobile treatment: `surface-12-mobile.md`.

---

## Open decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| OD-145 ⚠️ **#2 read authority** | **Entry gating** — does a memory browser need a new `PERM-memory.view`/`.browse` entry node, or is memory read governed by the existing clearance model? | (a) **No new node — entry is any authenticated user; the row-level clearance/visibility/Restricted RLS (FR-2.RET.004 / FR-1.RLS.003) is the gate**, showing each user exactly their cleared subset (the same subset retrieval injects); every *mutation* (correct/erase/merge) is node-gated (`PERM-memory.write` / `.delete`), and Restricted is never auto-shown (RST.003). (b) Mint a `PERM-memory.browse` entry node (Admin/AM/cleared power-users) — treat free browse as a capability above task-scoped injection. (c) Gate entry on any existing memory node (wrong — `PERM-memory.write`/`.delete` are mutation authorities, not read). | **(a)** — memory *read* authority **is** the C1 clearance model everywhere else (retrieval is clearance-scoped, not node-gated); a browse node would make this the *only* node-gated memory-read path, an inconsistency, and would either over-gate (hiding a user's own cleared business knowledge) or be redundant with clearance. The row filter already shows only the cleared subset; mutations stay node-gated; Restricted stays explicit-and-audited. **No node minted** (a clean case, like surface-10). |
| OD-146 | **Layout** — how to structure entity browse + entity detail + memory detail + search. | (a) **Entity Browser grid/list landing + per-entity detail drawer + a Memory Detail view within it + a persistent Memory Search bar.** (b) Fully tabbed (Entities / Memories / Search). (c) Single long scroll. | **(a)** — the entity grid is the natural home (knowledge is entity-organised, FR-2.ENT.001), a drawer keeps grid context while reading an entity, and search is cross-cutting so it earns a persistent header bar, not a co-equal tab. Consistent with surface-06/09's grid-landing + detail-drawer (OD-126/OD-138). (b) separates a memory from its entity; (c) buries search + detail. |
| OD-147 | **Entity-type + expected-slot config ownership** — does surface-11 own the entity-type list + expected-slots editors, or are they config edited elsewhere? | (a) **The config *values* live in the config registry, edited on surface-01 (`PERM-config.*`); surface-11 reflects them read-only and links out** — keeping surface-11 a *browser*, not a config editor. (b) surface-11 owns the entity-type + slot editors inline (mixes browse + config authority on one surface). (c) A separate config surface. | **(a)** — entity types (FR-2.ENT.002) and expected slots (FR-2.MAT.001) are explicitly **config**; all config is edited on surface-01 under `PERM-config.*` (Phase 2 discipline). surface-11 *reflects* them (the type filter, the slot readout) and links out to edit — DRY, single config home, no split authority. (b) forks config authority onto a read surface; (c) is unnecessary. |
| OD-148 ⚠️ **#2/#1 sole-writer** | **Human edit model** — given ADR-004 (the Memory Agent is the sole writer), how does a cleared user "correct" a memory from the browser? | (a) **Read-first: a verify/flag is a logged feedback signal (FR-2.MNT.016); a content/tier correction is an authorized request (`PERM-memory.write`) that routes through the sole-writer validate-and-commit (per-entity lock + contradiction check, FR-2.WRT.006) — never a direct `UPDATE`.** (b) Allow a direct row edit for `PERM-memory.write` holders (violates ADR-004 sole-writer — a #2/#1 breach). (c) No human edit at all (too restrictive — a human must be able to correct a wrong memory; MNT.016 mandates the feedback loop). | **(a)** — ADR-004 makes the Memory Agent the **sole writer**; a human correction must go *through* it (so the contradiction check, per-entity lock, and confidence lifecycle all apply), never around it. Verify/flag stays a light logged signal (MNT.016); content changes escalate to the writer-routed path (`PERM-memory.write`). (b) breaks the invariant that protects knowledge integrity; (c) drops the mandated human-correction loop. |

*(All four resolved surface-local, recommendations delegated — consistent with surfaces 05–10. OD-145 + OD-147 are
clean-case resolutions — no node mint, no config fork. Separately, the **3 long-owed catalog nodes** — OD-115 ×2,
OD-117 ×1 — are **transcribed to `PERMISSION_NODES.md` this session** as housekeeping, closing a standing Rule-0 debt.)*

---

## Phase 4 data binding notes

- **`DATA-memories`** (read here) — the memory rows (FR-2.MEM.002); **row-level clearance/visibility/Restricted RLS is the
  gate** (C1 FR-1.RLS.003) — the browser is a human path, RLS-backstopped, **no `service_role` browse**. Phase 4: the
  clearance predicate must compose with the entity filter + the vector/keyword search within latency (AF-067); the
  `superseded_by` chain must be queryable both directions for the drillable history. **No `client_slug`.**
- **`DATA-entities`** (read here) — id / type / name / `external_refs` (json) / Maturity / Internal-Org singleton flag.
  Phase 4: an index on `type` for the browser filter; the Internal-Org singleton guard (FR-2.ENT.003); a duplicate-cluster
  read for the merge flag (FR-2.MNT.010). **No `client_slug`.**
- **Expected-slots store** (read here) — per entity type, the config slot list (FR-2.MAT.001) + the derived filled/empty
  state per entity. The *list* is config (surface-01); the *fill-state* is derived from memories.
- **`access_audit`** (write here) — viewing a Confidential/Restricted/Internal-Org memory is audited (FR-1.AUD.001 /
  FR-2.ENT.003). Phase 4: the audit write must not itself fail silently (C1/C7 log-failure discipline).
- **Sole-writer submit path** (write, indirect) — a human correction/tier-change/merge is submitted to the Memory Agent's
  validate-and-commit (FR-2.WRT.001/006), never a direct table `UPDATE` (ADR-004). Phase 4/6 wires the browser's "correct"
  action to the writer API, not a front-end mutation.
- **No new PERM node minted** — memory read is clearance-scoped (OD-145); mutations reuse `PERM-memory.write` / `.delete`
  (catalogued). **Catalog housekeeping this session:** the 3 long-owed nodes — `PERM-memory.review_conflict` +
  `PERM-memory.approve_consolidation` (OD-115) + `PERM-action.review` (OD-117) — are **transcribed into
  `PERMISSION_NODES.md`** (count 48→51), closing the standing dangling-ID debt flagged in that file's Status section.
</content>
