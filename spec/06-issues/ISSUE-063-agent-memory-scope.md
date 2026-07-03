---
id: ISSUE-063
title: Per-agent memory scoping (least-privilege retrieval filter)
epic: H — agent design
status: blocked
github: "#63"
---

# ISSUE-063 — Per-agent memory scoping (least-privilege retrieval filter)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Make each agent's registry-defined `memory_scope` a real least-privilege retrieval filter: the run pipeline passes the running agent's scope into the C2 read flow so an agent receives only in-scope memory, fails closed if the wiring is absent, applies clearance on top (never widening), and treats scope as data — the containment half of C8's "who may see what."

## 2. Scope — in / out
**In:** The C8 **SCO** area group end-to-end — the three-part contract that turns the `agents.memory_scope` column (defined/seeded by ISSUE-062) into an enforced filter. (1) SCO.001: on every agent invocation the run pipeline reads the running agent's `memory_scope` (memory types + entity classes per the L3467–3476 matrix: Research read-all; Client/Campaign/Comms/Ops/Finance narrowed; Memory full r/w; Insight read-all-no-write; Orchestrator semantic+entity-model+tool-registry) and passes it as the agent-scope predicate into the C2 read; an out-of-scope request returns empty without revealing existence; and if the predicate is not applied (wiring missing/failed) retrieval **fails closed** (agent gets nothing, never silently widening to the clearance-only set). (2) SCO.002: sensitivity clearance applies **on top of** scope — effective access = `memory_scope` ∩ task clearance; scope never grants above the task's clearance; Restricted is never auto-injected even for read-all agents. (3) SCO.003: scope is registry data (`memory_scope` jsonb) — an edit changes the next run's access with no code change; an invalid scope spec is rejected at write. This slice owns the C8 side of the OD-081 wiring: the run pipeline reading the scope and passing it down, plus the fail-closed behaviour when it doesn't arrive.
**Out:** The C5 run-pipeline mechanism that *carries* the scope into the C2 read and fails closed — realised in ISSUE-053 via AC-5.ASM.006.2 (this slice defines the scope and the contract; ISSUE-053 owns the harness pass-through). The C2 read-path predicate that *applies* the scope (drops out-of-agent-scope candidates before ranking) — ISSUE-025 via AC-2.RET.004.2. The clearance/visibility/Restricted **model + RLS enforcement** that SCO.002 sits on top of — ISSUE-019/020 (C1 CLR/RST/RLS) and ISSUE-025 (clearance-before-ranking). The `agents` table + `memory_scope` **column, seed roster, and per-agent hard limits** (Research read-only, Comms/Finance/Memory identities) that populate the scopes — ISSUE-062 (C8 SPC/REG). The `PERM-agents.manage` gate + version discipline + `change_reason`/audit on a scope edit — ISSUE-061 (C8 ORC/REG). The registry-editor UI to edit scope — ISSUE-067 (surface-09). Scope-misconfiguration drift surfacing — ISSUE-065 (C8 HLTH). Out-of-scope-attempt log delivery/retention — C7 (ISSUE-011).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-8.SCO.001, FR-8.SCO.002, FR-8.SCO.003 (component-08 Agent Design).
- **NFRs:** none owned. (SCO.001 inherits the RLS-hot-path latency posture from the C2 retrieval path it narrows — NFR-PERF.001 via AF-067, owned/proven by ISSUE-025/ISSUE-002; the agent-scope predicate is an additional narrowing within that already-gated read, not a new hot-path budget.)
- **Rests on:** OD-081 (RESOLVED + applied 2026-06-26 via change-control — the cross-component wiring: C5 AC-5.ASM.006.2 passes the agent's `memory_scope` into the C2 read and fails closed, C2 AC-2.RET.004.2 drops out-of-agent-scope candidates before ranking — this is what makes SCO.001 executable, not asserted-only; closed verification-gate H1); OD-080 (scope edits = Super Admin only — capability grant); ADR-004 (sole-writer concurrency — the Memory Agent's full-r/w scope is the only write scope, all other agents read-only to memory); consumes ADR-002 / C2 FR-2.RET.004 (clearance-before-ranking the scope predicate composes with), C2 FR-2.RET.006 + C1 FR-1.RST.003 (Restricted never auto-injected), C1 FR-1.CLR.004/006 (entity-type-scoped clearance the intersection uses). AF-067 (live clearance predicate composes with pgvector on the hot path — the ISSUE-002 launch-gating spike SCO.001 inherits through the C2 read it narrows).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-8.SCO.001.1 (run pipeline passes `memory_scope`; only in-scope types+entities returned — a real filter, not a registry annotation)
- AC-8.SCO.001.2 (out-of-scope request returns empty without revealing existence)
- AC-8.SCO.001.3 (predicate not applied → fails closed, never silently widens to clearance-only set)
- AC-8.SCO.002.1 (read-all agent excluded from a memory above the task clearance)
- AC-8.SCO.002.2 (Restricted never auto-injected for any agent)
- AC-8.SCO.003.1 (a `memory_scope` edit governs the next run with no code change)
- **Cross-component ACs this slice's contract depends on (owned elsewhere, must be honoured together):** AC-5.ASM.006.2 (ISSUE-053 — harness passes scope + fails closed; **its FR/interface is now in the Context manifest §6 — `component-05-harness.md §ASM` — so the pass-through contract and the SCO.001.3 fail-closed test can be resolved from the named files, not guessed**) and AC-2.RET.004.2 (ISSUE-025 — C2 drops out-of-scope candidates before ranking). Both are the OD-081 wiring; SCO.001/.001.3 cannot be proven **in isolation** from them — this is why `status: blocked`. The wiring/interface needed to *build against and write the tests* is fully resolvable from the manifest (C8 defines + validates the scope; C5 AC-5.ASM.006.2 carries it + fails closed; C2 AC-2.RET.004.2 applies it); what waits on the blockers is running the joint end-to-end demonstration once ISSUE-053's run pipeline and ISSUE-025's read path exist. That is a coordinated-across-the-boundary constraint, deliberately honoured — not a missing spec.
- **Gating spikes:** AF-067 must be **GREEN** before this issue ships (ISSUE-002, the RLS-hot-path latency spike per OD-157/RP-1) — inherited via the C2 retrieval path (ISSUE-025) the agent-scope predicate narrows; the additional scope predicate must not break the initPlan-once-per-statement budget confirmed there.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-agents.memory_scope (read on every agent invocation — the jsonb least-privilege filter: memory types + entity classes; validated at write per SCO.003). No other table written by this slice; memory is **read** through the C2 read flow (DATA-memories), never directly.
- **PERM:** scope edits gated to **Super Admin only** (OD-080 — a capability grant, mirroring C4 principles-are-tighter); the `PERM-agents.manage` split + mandatory `change_reason`/audit on the edit is owned by ISSUE-061. The read-time enforcement itself is not per-node — it is the scope predicate composed with C1 clearance on the agent `service_role` path (ISSUE-020/025).
- **CFG:** none. (Scope is per-agent registry data, not a config key.)
- **UI:** none in this slice — the registry-editor scope field is rendered by ISSUE-067 (surface-09). This slice defines the contract and the fail-closed behaviour only.
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-08-agent-design.md §SCO (FR-8.SCO.001–003 + their ACs; also the L3467–3476 scope matrix in FR-8.SCO.001 behaviour and the per-agent identities in §SPC that populate each scope).
- spec/01-requirements/component-02-memory.md §RET (FR-2.RET.004 — the clearance-before-ranking read the agent-scope predicate rides on, incl. the OD-081 branch + AC-2.RET.004.2; FR-2.RET.006 / Restricted-never-auto-injected for SCO.002; FR-2.MEM.001 — the closed `memory_type` set {semantic, episodic, procedural} a scope's `memory_types` validates against).
- spec/01-requirements/component-05-harness.md §ASM (FR-5.ASM.006 + **AC-5.ASM.006.2** — the C5 run-pipeline pass-through that reads the running agent's `memory_scope`, carries it into the C2 read as the agent-scope predicate, and fails closed if it can't be applied; this is the harness boundary build steps 2/4 wire against and the SCO.001.3 fail-closed test runs against, owned by ISSUE-053).
- spec/04-data-model/schema.md §9 Agent Design (the `agents.memory_scope` jsonb column this slice reads and validates); **§3 Memory** — the `entities` table (`entities.type` validated vs `config_values['entity_types']` — the closed, config-driven set of entity classes a scope's `entity_classes` validates against; `entities.is_internal_org` — the Internal-Org access flag) and the `memory_type` enum in the top-of-file Types block (`semantic`/`episodic`/`procedural`). These are what make the §10 `memory_scope` jsonb shape below a *validatable* filter, not free-form json.
- spec/00-foundations/adr/ADR-004-concurrency-model.md (sole-writer — why only the Memory Agent's scope carries write; every other scope is read-only to memory).

## 7. Dependencies
- **Blocked-by:** ISSUE-062 (eight specialist definitions + `memory_scope` values + per-agent hard limits — the scopes this filter enforces don't exist until 062 seeds them); ISSUE-025 (Retrieval + clearance-before-ranking — the C2 read this slice narrows, and the home of AC-2.RET.004.2, the C2 half of the OD-081 wiring). Transitively rests on ISSUE-002 (SPIKE — AF-067 GREEN) through ISSUE-025. (Not listed as a formal blocker but load-bearing: ISSUE-053 owns AC-5.ASM.006.2, the C5 pass-through + fail-closed; the DoD cannot be *demonstrated* end-to-end until 053's run pipeline carries the scope — coordinate the SCO.001.3 fail-closed test across the boundary.)
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Scope-spec validation (FR-8.SCO.003):** build the write-time validator for the `memory_scope` jsonb against the **concrete shape + closed value-sets fixed in §10 below** (field names, the `memory_type` enum for `memory_types`, `config_values['entity_types']` + the `internal_org` flag for `entity_classes`), rejecting an invalid spec at write, so a scope is always a well-formed filter. The shape is *this issue's* contract (no builder guessing) — it is the machine-checkable form of the L3467–3476 prose matrix. Scope edits are Super Admin (OD-080) — the gate + audit live in ISSUE-061, this step is the shape/validity contract. → AC-8.SCO.003.1.
2. **Scope read on invocation (FR-8.SCO.001, happy path):** on every agent invocation, read the running agent's `memory_scope` and translate it into the agent-scope predicate (memory types + entity classes) that the run pipeline passes into the C2 read flow (the C5 pass-through is AC-5.ASM.006.2 / ISSUE-053; the C2 application is AC-2.RET.004.2 / ISSUE-025). Verify only in-scope types+entities come back — a real filter, not a registry annotation. → AC-8.SCO.001.1.
3. **Out-of-scope = empty, non-revealing (FR-8.SCO.001, branch):** an agent requesting out-of-scope memory receives nothing — not an error that leaks the existence of the out-of-scope memory. → AC-8.SCO.001.2.
4. **Fail-closed on missing/failed wiring (FR-8.SCO.001, edge — the #2 non-negotiable):** if the agent-scope predicate is not applied (the OD-081 wiring is absent or the pass-through fails), retrieval returns **nothing** rather than silently widening to the full clearance-only set. This is least-privilege-on-failure and must be tested against the C5 boundary (AC-5.ASM.006.2 fail-closed). → AC-8.SCO.001.3.
5. **Clearance on top (FR-8.SCO.002):** compose the scope predicate with the task's sensitivity clearance so effective access = `memory_scope` ∩ task clearance — clearance-before-ranking (C2 FR-2.RET.004) runs regardless of scope, so a read-all agent (Research) is still excluded from above-clearance memory, and Restricted is never auto-injected even for read-all agents (C2 FR-2.RET.006 / C1 FR-1.RST.003). Scope narrows within clearance; it never widens. → AC-8.SCO.002.1, AC-8.SCO.002.2.
6. **Observability hook:** out-of-scope access *attempts* logged (feeds the scope-misconfiguration drift/health signal owned by ISSUE-065; delivered/retained by C7 / ISSUE-011) — never silently widened.
7. **Tests to the ACs** (below).

## 9. Verification (how DoD is proven)
- **Integration / build-time tests** (per `spec/05-non-functional/test-strategy.md`): an agent's read returns only its in-scope memory types+entities (AC-8.SCO.001.1); an out-of-scope request returns empty without leaking existence (AC-8.SCO.001.2); with the pass-through deliberately disabled/failing, retrieval returns nothing rather than the clearance-only set (AC-8.SCO.001.3 — the fail-closed test, run against the ISSUE-053 / AC-5.ASM.006.2 harness boundary); a read-all agent (Research) is excluded from above-clearance memory and Restricted is never auto-injected for any agent (AC-8.SCO.002.1/.002.2); a saved `memory_scope` edit governs the next run with no redeploy and an invalid spec is rejected at write (AC-8.SCO.003.1). Prove SCO.001 jointly with AC-2.RET.004.2 (candidate dropped **before** ranking, an additional narrowing within clearance, never a widening) so the least-privilege intersection is confirmed on the real read path, not asserted.
- **Blocking gate:** AF-067 (ISSUE-002) must read **GREEN** in `spec/00-foundations/feasibility-register.md` before ship — the agent-scope predicate is an added narrowing on the C2 clearance-before-ranking hot path, so the AC→Verified path runs through NFR-PERF.001's initPlan-once-per-statement confirmation (owned/proven by ISSUE-025); the scope predicate must not regress that budget.

## 10. `memory_scope` jsonb shape (the validatable contract this slice fixes)
`schema.md §9` declares only `memory_scope jsonb not null` with a one-line comment — no structure. This section
**is** the shape (build step 1 / FR-8.SCO.003 / AC-8.SCO.003.1 validate against it); it is the machine-checkable
form of the L3467–3476 prose matrix in FR-8.SCO.001, grounded entirely in **existing** schema/FR names (no new
canonical model is introduced — if `component-08`/`schema.md` later hoists this shape, that supersedes here). The
write-time validator rejects any spec that is not this shape or uses a value outside the closed sets below.

```jsonc
{
  "memory_types":   ["semantic","episodic","procedural"],   // subset of the memory_type enum (schema §3 / FR-2.MEM.001), or the string "all"
  "entity_classes": ["client","contact","campaign", ...],   // subset of config_values['entity_types'] (entities.type, schema §3), or "all"
  "internal_org":   true,                                    // bool — grants Internal-Org memories (entities.is_internal_org); default false
  "write":          false,                                   // bool — memory write scope; MUST be false for every agent except Memory (ADR-004 sole-writer)
  "reference":      ["entity_model","tool_registry"]         // optional; non-memory reference stores (Orchestrator only). Closed set: {entity_model, tool_registry}
}
```

**Closed value-sets the validator enforces (invalid → reject at write, AC-8.SCO.003.1):**
- `memory_types`: each element ∈ the `memory_type` enum `{semantic, episodic, procedural}` (schema §3 Types block / FR-2.MEM.001), **or** the literal `"all"` (read-all agents). Empty array is invalid.
- `entity_classes`: each element ∈ `config_values['entity_types']` (the set `entities.type` is validated against, schema §3), **or** the literal `"all"`. A class not in that config set is rejected — this keeps entity classes a *closed, machine-checkable* set (config-driven, not hard-coded here) so the prose names below stay in sync with the entity model. Empty array is invalid.
- `internal_org`, `write`: booleans. `write: true` on any agent **other than** the Memory Agent is **rejected at write** (ADR-004 sole-writer — the same negative-invariant discipline as SPC.003/SPC.004 tool limits; the containment #1 guarantee).
- `reference`: optional array, each element ∈ `{entity_model, tool_registry}`; present only on the Orchestrator scope.

**Roster → scope mapping (the L3467–3476 matrix, as this shape — build/seed reference; the seed itself is ISSUE-062):**
| Agent | `memory_types` | `entity_classes` | `internal_org` | `write` | `reference` |
|---|---|---|---|---|---|
| Research | `"all"` | `"all"` | false | false | — |
| Client | `[semantic, episodic]` | `[client, contact]` | false | false | — |
| Campaign | `[semantic, episodic, procedural]` | `[campaign]` | false | false | — |
| Comms | `[semantic]` | `[brand_guide, contact_pref]` | false | false | — |
| Ops | `[semantic, procedural]` | `[sop, team_member]` | true | false | — |
| Memory | `"all"` | `"all"` | true | **true** | — |
| Finance | `[semantic]` | `[contract, invoice]` | false | false | — |
| Insight | `"all"` | `"all"` | false | false | — |
| Orchestrator | `[semantic]` | `"all"` | false | false | `[entity_model, tool_registry]` |

The `entity_classes` slugs above (`client`, `contact`, `campaign`, `brand_guide`, `contact_pref`, `sop`,
`team_member`, `contract`, `invoice`) are the prose classes of L3467–3476 expressed as `entities.type` values;
the **authoritative** closed set is whatever `config_values['entity_types']` holds for the deployment — the seed
(ISSUE-062) must register these classes there, and the validator checks membership against that config, not
against this list. Restricted-tier is **never** expressible in scope (SCO.002 / AC-8.SCO.002.2 — sensitivity
is orthogonal clearance, applied on top, never widened by scope).
