# ISSUE-044 — Proposed shared-spec deltas (config-registry keys)

> **These are PROPOSALS, not edits.** Per the fan-out isolation rule, ISSUE-044 does NOT edit
> `config-registry.md`. The orchestrator applies these two keys to the shared config registry at
> integration time. Both keys are named in ISSUE-044 §2/§5/§8 and cited to `component-04-prompt.md`
> FR-4.BIZ.002 / FR-4.BIZ.003.

## 1. `business_context.dynamic_fields`

| Field | Value |
|---|---|
| **Key** | `business_context.dynamic_fields` |
| **Type** | list of strings (declared dynamic Layer-2 field names) |
| **Default** | `[]` (empty — every Layer-2 field is static until declared dynamic) |
| **Edit-class** | GENERAL prompt/config content — editable by Super Admin + Admin (per `PERM-prompt.edit`, the same class governing Layer-2 content). NOT a SECRET key; not credential material. |
| **Purpose** | Declares which Layer-2 fields are **dynamic** (resolved at assembly from the operator-editable `dynamic_field_values` store) vs **static** (baked from deployment config at boot). A field is classified **exactly once**; a name listed here is dynamic, every other Layer-2 field is static (FR-4.BIZ.002). Duplicate names are a config error. |
| **Consumed by** | `Layer2Classification` (src/context.ts) → `BusinessContextService.assemble` (src/business-context.ts). The assembly-time read itself is ISSUE-053. |
| **Cites** | `component-04-prompt.md` FR-4.BIZ.002 (L210–214), FR-4.BIZ.003 (L216–228); OD-052 (L426). |
| **Validation** | each entry non-empty; no duplicates; entries SHOULD be resolvable keys in `dynamic_field_values`. |

## 2. `dynamic_field_freshness_threshold`

| Field | Value |
|---|---|
| **Key** | `dynamic_field_freshness_threshold` |
| **Type** | integer (seconds) |
| **Default** | proposed `604800` (7 days) — orchestrator/operator to confirm the default at integration; the code takes it as a parameter and does not hard-code it. |
| **Edit-class** | GENERAL config — Super Admin + Admin (`PERM-prompt.edit` class). Not a SECRET. |
| **Purpose** | A dynamic field whose `dynamic_field_values.last_updated` is older than this threshold has its **staleness surfaced to the operator** (required, not optional) and is **never silently presented as current** (AC-4.BIZ.003.3, the #3 no-silent-failure check). A direct expression of the ADR-003 cost/freshness lever posture ("controls before gates"). |
| **Boundary semantics** | `age > threshold` ⇒ stale. `age == threshold` ⇒ fresh (proven in the AC-4.BIZ.003.3 test). |
| **Consumed by** | `resolveDynamicField` (src/context.ts) → `BusinessContextService.assemble`. Must be a positive, finite number of seconds (rejected otherwise). |
| **Cites** | `component-04-prompt.md` FR-4.BIZ.003 / AC-4.BIZ.003.3 (L225–228, CFG stub L228); ADR-003 (cost posture). |

## Notes for the orchestrator
- **No migration is owed by this slice.** `dynamic_field_values` and `prompt_layers` (incl. the
  `prompt_layer_kind` enum values `business` + `task_template`) are created by **ISSUE-042**. The adapters
  in `src/supabase-store.ts` write rows only.
- The `check` gate (src/index.ts) VERIFIES-PRESENT the ISSUE-042 baseline shapes these keys/adapters depend
  on and asserts this slice ships **no** `0044_*` migration.
- These two keys are the only shared-spec surface this slice introduces. No `schema.md`,
  `PERMISSION_NODES.md`, or `glossary.md` delta is proposed.
