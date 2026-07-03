---
id: ISSUE-022
title: Memory + entity model + sensitivity/visibility tagging
epic: C — memory
status: blocked
github: "#22"
---

# ISSUE-022 — Memory + entity model + sensitivity/visibility tagging

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the C2 data foundation — the `memories` and `entities` tables, the entity model (types, Internal Org singleton, `external_refs`, deterministic resolution) and the orthogonal visibility × sensitivity tags every later memory slice writes and reads through.

## 2. Scope — in / out
**In:** The persistent shape of the business brain and the write-time classification rules that later slices depend on:
- The four memory types + the `memories` row schema, including the `≥1 entity`, `source`/`confidence`, and idempotency-key invariants (MEM).
- The `entities` table + the entity model: the documented default entity-type list as config, the singular walled-off Internal Org entity, the `external_refs` pointer schema, and the deterministic (external_refs-first → name/type) entity-resolution logic with ambiguity-flagging (ENT).
- The two orthogonal classification axes written at commit time: the visibility axis (global/team/private) with most-restrictive-default, the writer-assigned sensitivity tier with the never-autonomously-Restricted rule, and the "both axes must pass, evaluated separately" contract (TAG).
- The migration that creates §3 Memory (`entities`, `memories`) with all CHECK constraints and the `unique(idempotency_key)` guard, and the `is_internal_org` singleton enforcement.

**Out:**
- The actual **HNSW index + embedding generation + vector search** — owned by ISSUE-023 (C2 VEC). This slice defines the `embedding`/`embedding_model`/`embedding_v2` columns but does not build the index or the ANN path.
- The **sole-writer write path** (contradiction check, confidence lifecycle, validate-and-commit, embedding-failure halt) — owned by ISSUE-024 (C2 WRT). This slice provides the schema + tag rules the writer *populates*; it does not build the writer.
- **Retrieval / clearance-before-ranking / answer modes** — ISSUE-025 (C2 RET). The RLS predicates that *enforce* visibility/sensitivity/Restricted on `memories` are owned by ISSUE-020 (C1 RLS.003).
- **Ingestion filters/queue/pipelines** — ISSUE-026 (C2 ING); **maintenance / erosion / merge** — ISSUE-027/028/029; **Maturity + cold-start gating** — ISSUE-030 (C2 MAT). The `entities.maturity` column exists here but is populated/recomputed by ISSUE-030.
- The `ingestion_queue`, `memory_conflicts`, `consolidation_approvals` tables (created by their owning slices 026/028).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-2.MEM.001, FR-2.MEM.002, FR-2.ENT.001, FR-2.ENT.002, FR-2.ENT.003, FR-2.ENT.004, FR-2.ENT.005, FR-2.TAG.001, FR-2.TAG.002, FR-2.TAG.003 (all component-02-memory)
- **NFRs:** NFR-PERF.004 (entity-resolution accuracy at scale), NFR-CMP.002 (golden rule — pointers + enrichment, never copies)
- **Rests on:** ADR-002 (Maturity/Retrieval Sufficiency — this slice ships the stored `entities.maturity` column + expected-slots config shape it depends on), ADR-004 (sole-writer + per-entity concurrency + idempotency-key — this slice ships the `unique(idempotency_key)` + CAS `superseded_by` schema those invariants require), AF-082 (entity resolution accuracy, EVAL), AF-031 (writer type-split + confidence quality)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-2.MEM.001.1, AC-2.MEM.001.2
- AC-2.MEM.002.1, AC-2.MEM.002.2
- AC-2.ENT.001.1
- AC-2.ENT.002.1, AC-2.ENT.002.2
- AC-2.ENT.003.1, AC-2.ENT.003.2
- AC-2.ENT.004.1
- AC-2.ENT.005.1, AC-2.ENT.005.2
- AC-2.TAG.001.1
- AC-2.TAG.002.1, AC-2.TAG.002.2
- AC-2.TAG.003.1
- AC-NFR-PERF.004.1, AC-NFR-CMP.002.1, AC-NFR-CMP.002.2
- **Gating spikes (if any):** none launch-gating (spikes ISSUE-001–006 do not gate this slice). Build-time feasibility: AF-082 (entity-resolution EVAL, verified via NFR-PERF.004) and AF-031 (writer type/confidence quality, cited by FR-2.MEM.001) — tracked in `feasibility-register.md`, not ship-blockers for the schema/tag build but their EVAL result feeds the resolution-threshold tuning here.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-entities (entities: type, name, external_refs, is_internal_org, maturity, maturity_updated_at), DATA-memories (memories: type, content, embedding cols, entity_ids, source, source_ref, confidence, visibility, sensitivity, superseded_by, content_hash, idempotency_key, expires_at) — schema §3 Memory
- **PERM:** none created here (ingestion/write PERMs — `PERM-ingestion.*`, `PERM-memory.write` — are homed in C1 and consumed by ISSUE-024/026)
- **CFG:** CFG-entity_types (the configurable entity-type list, structured object in `config_values` per schema §12)
- **UI:** none (entity browser / memory detail surfaces are Phase-3; the memory navigation surface is ISSUE-031)
- **Connectors:** none (Pipeline-1 systems-of-record ingestion is C3-seamed via ISSUE-026)

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-02-memory.md — the FR text + ACs for MEM, ENT, TAG (and its Context Manifest table + Doc-reconciliation notes)
- spec/04-data-model/schema.md §3 Memory — the `entities` + `memories` DDL, CHECK constraints, idempotency-key + CAS-chain notes (and §Types for `memory_type`, `memory_source`, `visibility_tier`, `sensitivity_tier` enums; §12 for the `config_values` entity-types object)
- spec/05-non-functional/performance.md §NFR-PERF.004 — entity-resolution accuracy posture + AC
- spec/05-non-functional/compliance.md §NFR-CMP.002 — golden-rule (pointers not copies) posture + ACs
- spec/00-foundations/adr/ADR-002-coverage-metric.md — the Maturity metric this slice's `entities.maturity` column serves
- spec/00-foundations/adr/ADR-004-concurrency-model.md — the sole-writer + idempotency-key + CAS-supersede invariants the schema encodes

## 7. Dependencies
- **Blocked-by:** ISSUE-008 (migration harness + 0001 baseline — this slice ships a migration through it), ISSUE-019 (Clearance + Restricted model — C1 defines the four sensitivity tiers + Restricted rules that TAG.002/TAG.003 tag against; must exist before the sensitivity axis is meaningful). Neither is a spike.
- **Blocks:** ISSUE-023 (embeddings/HNSW — needs `memories` + embedding cols), ISSUE-024 (write path — needs the schema + tag rules to populate), ISSUE-030 (Maturity — needs `entities` + `entities.maturity`)

## 8. Build order within the slice
1. **Enums / domains** — confirm `memory_type`, `memory_source`, `visibility_tier`, `sensitivity_tier` exist in schema §Types (add via the migration if not already shipped by an earlier tier); these back the MEM/TAG field domains.
2. **Migration (expand-only, via ISSUE-008 harness)** — create `entities` then `memories` per schema §3, including: the `cardinality(entity_ids) >= 1` CHECK (AC-2.MEM.002.2), the `source='system_pointer' or confidence is not null` CHECK, `unique(idempotency_key)` (ADR-004), and `superseded_by` self-FK (CAS chain). `embedding`/`embedding_v2`/`embedding_model` columns are declared but their HNSW index is deferred to ISSUE-023.
3. **Entity-type config** — seed the documented default entity-type list (incl. `Internal Org`) into `config_values['entity_types']` (CFG-entity_types); validate `entities.type` against the configured list; soft-disable (never orphan) semantics per FR-2.ENT.002.
4. **Internal Org singleton** — enforce exactly one `is_internal_org = true` entity per deployment at provisioning (DB partial-unique/guard), seeded once (FR-2.ENT.003 / AC-2.ENT.003.1).
5. **Entity resolution** — implement the deterministic resolver: `external_refs` match → normalised name+type match → create-new-only-on-no-confident-match, with the OD-033 ambiguity path (flag for human confirm / create-and-flag-for-merge, never silent mis-link) (FR-2.ENT.005 / AC-2.ENT.005.*). Wire the entity-match confidence threshold as config.
6. **Tag defaults + rules** — visibility default (global for business / private for personal, most-restrictive on unset) (FR-2.TAG.001); sensitivity write-time assignment with the hard "never autonomously assign Restricted" guard (FR-2.TAG.002); the orthogonal "both axes evaluated separately, either failing excludes" contract as the shape retrieval (ISSUE-025) will consume (FR-2.TAG.003).
7. **Golden-rule guard** — enforce `source_ref` pointer + no verbatim source-file copy at the schema/write-shape level (NFR-CMP.002); Internal Org exclusion from client-facing contexts is a resolution/tag attribute here, enforced at retrieval by ISSUE-025/020.
8. **Tests to the AC** — unit + DB-constraint tests for every AC in §4; an entity-resolution EVAL harness seeded for AF-082 (false-merge/false-split against a ground-truth set) per NFR-PERF.004.

## 9. Verification (how DoD is proven)
- **DB-constraint / migration tests** (per `spec/05-non-functional/test-strategy.md`): the `entities`/`memories` CHECKs, the `unique(idempotency_key)`, the Internal Org singleton guard, and the entity-type-config validation — proving MEM.002, ENT.001/003, TAG defaults at the schema layer.
- **Unit tests** for the entity resolver (ENT.005) and the tag-assignment rules (TAG.001/002/003), including the never-auto-Restricted guard (AC-2.TAG.002.2) and the ambiguity path (AC-2.ENT.005.2).
- **EVAL** (AF-082 → NFR-PERF.004): false-merge/false-split rates within threshold on the AF-082 mention set, ambiguous cases flagged not silently resolved (AC-NFR-PERF.004.1) — this is the `Verified` path for the resolution accuracy claim; a paper-only pass is not sufficient.
- **Golden-rule check** (NFR-CMP.002): AC-NFR-CMP.002.1/.2 — inspected memory rows carry a `source_ref` and contain no verbatim source-file copy.
