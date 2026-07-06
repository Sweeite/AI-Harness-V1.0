---
id: ISSUE-036
title: Tool optimisation — confidence-gate, run-cache, batch, graceful degrade
epic: D — tool layer
status: in-progress
github: "#36"
---

# ISSUE-036 — Tool optimisation — confidence-gate, run-cache, batch, graceful degrade

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Add the four cost/quality optimisations to the shared tool runtime — confidence-gated tool selection, within-run read caching, connector batching, and graceful degradation — so the harness spends less and never fabricates a complete-looking partial result.

## 2. Scope — in / out
**In:** The four generic-runtime OPT behaviours, built once in the shared connector runtime (ISSUE-032) so every connector inherits them:
- **Confidence-gate selection** — at tool-selection time, compare selection confidence against `CFG-tool_selection_confidence_threshold`; call only when at/above, otherwise emit a clarification/ask signal rather than call a possibly-wrong tool. Log below-threshold ask events.
- **Run-scoped read cache** — a per-task-run ephemeral cache that serves a repeated identical read from cache (no second connector call) and is discarded at run end. Writes are never cached and never served from cache.
- **Batch reads** — group batch-eligible reads up to the connector's documented batch limit; clamp/reject over-limit batches; connectors without batching fall back to individual calls under the rate tiers.
- **Graceful degradation** — when a required tool is unavailable, log the gap, complete the doable part, and attach a **structured, mandatory-to-read** gap field to the task result so a downstream consumer cannot present the partial as complete; a fully blocking dependency pauses (recoverable) rather than hard-fails.

**Out:**
- The runtime seams these hook into — connector contract shape, tool registry (`tools`), the `read`/`write` category branch, boundary-tagging: **ISSUE-032** (blocked-by).
- The rate-limit tiers/backoff that batching-fallback defers to: **ISSUE-034**. Write-side idempotency (`idempotency_ledger`, the "never cache writes" guard's partner): **ISSUE-032/035** (FR-3.CONN.004).
- The **pause/recover** state machine that a blocking degradation hands off to (auto-resume, escalation): **ISSUE-038** (FR-3.DSC.*). ISSUE-036 only raises the pause; ISSUE-038 owns the recovery flow.
- **Downstream consumption** of the gap flag (C2 ingestion, C5/C6 task graphs actually reading the mandatory field): owned by those consumers (ISSUE-026/053/060). C3 guarantees the field is present and structured; it cannot guarantee a consumer reads it.
- Confidence-threshold *tuning* is an EVAL concern (prompt-architecture work), not this build.
- The cost-ladder / cost meter (throttle-kill rungs): **ISSUE-058/074**. Cache/batch here are the structural cost controls the ladder assumes exist, not the ladder itself.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-3.OPT.001, FR-3.OPT.002, FR-3.OPT.003, FR-3.OPT.004 (all Component 3 — Tool Layer)
- **NFRs:** none directly owned. *(Informational: the run-cache + batching are the structural "controls before gates" that NFR-COST.007 assumes, and the cost estimator per NFR-COST.005 is deliberately biased to assume **no** cache/batch discount — do not couple this build to the ladder.)*
- **Rests on:** ADR-007 (containment-first — degradation must never mask a gap; #3 at the tool grain), ADR-004 (idempotency — the write-side guard that pairs with "never cache writes")

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-3.OPT.001.1
- AC-3.OPT.002.1
- AC-3.OPT.002.2
- AC-3.OPT.003.1
- AC-3.OPT.004.1
- AC-3.OPT.004.2
- **Gating spikes (if any):** none. ISSUE-032 (blocked-by) is not a spike; no AF gates the OPT FRs (all four carry "Feasibility assumptions: —").

## 5. Touches (complete blast radius, by ID)
- **DATA:** `tools` (read only — selection reads the registry descriptions FR-3.REG.002 exposes); in-run read cache is **ephemeral** (no table); graceful-degradation gap annotation is a **structured field on the task result** (result schema owned by C5/C7, not a new C3 table). OPT creates no schema of its own.
- **PERM:** none (tool *invocation* runs on the agent path as `service_role`, no per-tool RBAC gate — ADR-006).
- **CFG:** CFG-tool_selection_confidence_threshold; per-connector batch-size limit (config parameter on the connector, e.g. Gmail per-API batch recommend ≤50).
- **UI:** clarification/ask prompt (C8 agent UX — signal only, not built here); the flagged gap renders on the task-result surface (C7). No UI owned by this issue.
- **Connectors:** generic runtime (all connectors inherit); batch limits are per-connector parameters supplied by the GHL/Google/Slack instances (ISSUE-039/040/041).

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-03-tool-layer.md — §OPT (FR-3.OPT.001–004 text + ACs); §GENERIC and the CONN/REG runtime spine it hooks into
- spec/04-data-model/schema.md §4 Tools & Connectors — the `tools` registry read at selection time; `idempotency_ledger` for the never-cache-writes pairing
- spec/00-foundations/adr/ADR-007-injection-posture.md — containment posture (degradation never masks a gap)
- spec/00-foundations/adr/ADR-004-concurrency-model.md — idempotency (write-side guard for FR-3.OPT.002)

## 7. Dependencies
- **Blocked-by:** ISSUE-032 (connector contract + shared runtime + tool registry — the runtime these four behaviours are built into; `tools` selection surface and read/write category branch must exist first)
- **Blocks:** none (leaf)

## 8. Build order within the slice
1. **Confidence-gate (FR-3.OPT.001):** at the runtime's tool-selection step, read `CFG-tool_selection_confidence_threshold`; branch call vs ask; emit the below-threshold ask event to `event_log`. High-risk write defaults to asking when ambiguous.
2. **Run-scoped read cache (FR-3.OPT.002):** add an ephemeral per-run cache keyed on the read's identity; serve repeat identical reads from it; hard-exclude the `write` category (never insert, never serve) — cross-check the CONN read/write branch from ISSUE-032. Discard the cache at run end.
3. **Batching (FR-3.OPT.003):** where the connector declares a batch endpoint + limit, group eligible reads to that limit; clamp/reject over-limit; non-batching connectors fall through to individual calls (defers to the rate tiers, ISSUE-034).
4. **Graceful degradation (FR-3.OPT.004):** on unavailable-tool, log the gap, complete the doable part, and write the **structured, mandatory-to-read** gap field onto the task result (satisfies AC-3.OPT.004.2 — not advisory free-text); a fully blocking dependency raises a recoverable pause handed to the DSC flow (ISSUE-038) rather than hard-failing (#3).
5. **Observability hooks:** below-threshold asks + missing-tool events to `event_log`; cache hit/miss counts optional (C7).
6. **Tests to the ACs** (see Verification).

**Integration note (spans FR-3.OPT.002 ↔ FR-3.CONN.004):** the "never cache writes" rule (OPT.002) and idempotency (CONN.004, ISSUE-032/035) are complementary halves of write-correctness — the cache must key off the runtime's `read`/`write` category so a write is structurally ineligible for the cache, and idempotency (not caching) is the only re-run guard on the write path. Build the cache's write-exclusion against the same category branch ISSUE-032 defines.

## 9. Verification (how DoD is proven)
- **Unit / integration** (per spec/05-non-functional/test-strategy.md): confidence-gate above/below threshold → call vs ask (AC-3.OPT.001.1); repeated identical read served from cache with no second connector call (AC-3.OPT.002.1); a write neither cached nor served (AC-3.OPT.002.2); batch-capable connector groups within the documented limit and clamps over-limit (AC-3.OPT.003.1); missing tool → task completes doable part + no hard fail + no silent partial (AC-3.OPT.004.1); the gap flag is a structured mandatory-to-read field on the result, asserted by a consumer-side read (AC-3.OPT.004.2).
- **AC→Verified path:** each AC moves to `Verified` when its test passes; FR-3.OPT.004 is the #3 (never-fail-silently) guarantee at the tool grain and must be exercised end-to-end (produce a partial, assert the mandatory gap field is present and machine-readable, not free-text).
