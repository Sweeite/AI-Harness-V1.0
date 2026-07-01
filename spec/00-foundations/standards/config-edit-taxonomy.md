# Standard: Config Edit Taxonomy

Decided once, applied to every `CFG-` key in Phase 2. This directly answers the
requirements: *"every config must have a dashboard"* and *"define if it's backend edits or
on-screen edits."*

Every config key is classified into exactly one edit class:

| Class | Editable where | Takes effect | Example | Has a dashboard surface? |
|---|---|---|---|---|
| **SECRET** | Deployment env vars only (Railway). Never shown, never UI-editable. | On redeploy | `ANTHROPIC_API_KEY`, `X-Internal-Token` | Read-only presence/last-rotated row in a "Deployment Secrets" admin panel. The *value* is never on screen. |
| **BOOT** | On-screen in a Config Admin screen | On next deploy/boot | `loops.fast`, `entity_types`, `plugins` | Yes — editable field, flagged "applies on next boot". |
| **LIVE** | On-screen in a Config Admin screen | Immediately | `memory.amber_zone_threshold`, ranking weights | Yes — editable field, takes effect live. |
| **REBUILD** | On-screen, but editing triggers a migration/index rebuild | After background job completes | `models.embedding`, HNSW `m`/`ef_construction` | Yes — editable behind a confirm dialog that warns of the rebuild. |

## Rules

1. **Every CFG key gets exactly one class.** No `???`. This is the Phase 2 gate.
2. **"Every config has a dashboard" is honoured for BOOT/LIVE/REBUILD** (editable surfaces)
   and **honoured-by-exception for SECRET** (a read-only presence row — because putting an
   API key value on screen is a security defect, not a feature). SECRET is the *only*
   justified exception, and it is still represented on a surface.
3. **Each editable CFG row must specify:** validation rule (type, min/max, enum), default,
   the `PERM-` node required to edit it, and the `UI-` surface it lives on.
4. **Changing any editable value — LIVE, BOOT, or REBUILD — must be audited** (who/when/old→new)
   in the config audit log. **SECRET produces no audit row** because it is never UI-editable (see
   the SECRET class above + rule 2); a secret value therefore never reaches the log (this is what
   `config_audit_log`/`FR-7.LOG.008 AC-7.LOG.008.5` rely on). *(Amended via change-control 2026-07-01,
   session 43 / OD-153: broadened from "LIVE" to all three editable classes — a BOOT or REBUILD change
   to a security-relevant knob going unaudited would be a #1/#3 gap; reconciles this rule with
   `config-registry.md` §"cross-cutting rules" and surface-01's per-section Save, which already audit
   BOOT changes.)*
5. **REBUILD changes require explicit confirmation** and surface the rebuild's progress.

## The Config Admin surface (defined in Phase 3)

A single role-gated Config Admin area, sectioned by config group (memory, guardrails,
loops, observability, ...). Each tunable renders per its class. This is where the registry
becomes a real screen.
