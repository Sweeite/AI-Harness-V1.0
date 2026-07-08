// ISSUE-022 — the locked domain constants for the C2 memory foundation: the four memory-model enums (mirrored
// from schema.md §Types / the 0001 baseline) and the default entity-type list (CFG-entity_types). This file is the
// CANONICAL source of truth the 0030 config seed mirrors — `index.ts check` asserts DEFAULT_ENTITY_TYPES ≡ the
// seeded config_values['entity_types'] JSON so the constant and the migration can never silently drift (cf. rbac
// catalog.ts ↔ 0006_rbac_seed). Entity-type validation is app-level: `entities.type` is a plain text column
// (OD-178) validated against the configured list, so the list lives here + in config, never as a DB enum.

// ── The four memory-model enums (schema.md §Types L176-180; 0001_baseline L31-34) ─────────────────────────
// memory_type has THREE durable values; "working" memory (FR-2.MEM.001) is the transient live task context and
// is never persisted as a row (it only becomes a memory by being written back), so it is not an enum value.
export const MEMORY_TYPES = ['semantic', 'episodic', 'procedural'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_SOURCES = ['ai_inferred', 'human_verified', 'system_pointer'] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const VISIBILITY_TIERS = ['global', 'team', 'private'] as const;
export type VisibilityTier = (typeof VISIBILITY_TIERS)[number];

export const SENSITIVITY_TIERS = ['standard', 'confidential', 'personal', 'restricted'] as const;
export type SensitivityTier = (typeof SENSITIVITY_TIERS)[number];

// The most-restrictive sane default when a visibility axis is left unset (FR-2.TAG.001 edge — never silently
// global, #2). Private is the tightest scope.
export const MOST_RESTRICTIVE_VISIBILITY: VisibilityTier = 'private';

// The one sensitivity tier a writer may NEVER assign autonomously — it always requires human confirmation
// (FR-2.TAG.002 / AC-2.TAG.002.2; design L1418). Restricted is also a per-individual ACCESS grant (C1 FR-1.RST.*).
export const NEVER_AUTO_SENSITIVITY: SensitivityTier = 'restricted';

// ── The default entity-type list (CFG-entity_types; FR-2.ENT.002; design L1369-1394; config-registry L325) ──
// The ~22 documented default kinds a thing can be filed under. Unique strings; operator-editable per deployment
// (add/rename/soft-disable, no deploy); "Internal Org" is ALWAYS present + locked (never soft-disabled).
export const INTERNAL_ORG_TYPE = 'Internal Org';

export const DEFAULT_ENTITY_TYPES: readonly string[] = [
  'Client',
  'Contact',
  'Team Member',
  'Vendor/Partner',
  'Campaign',
  'Task',
  'Deliverable',
  'Template',
  'Deal',
  'Contract/Retainer',
  'Invoice',
  'Brand Guide',
  'Audience',
  'Channel',
  'Team/Department',
  'Meeting',
  'SOP/Playbook',
  'Tool/Platform',
  'Goal/OKR',
  'Financial Period',
  'Lesson Learned',
  INTERNAL_ORG_TYPE,
];

// The exact JSON the 0030 seed writes into config_values['entity_types'] — a compact array, "Internal Org" last
// and locked-present. `index.ts check` re-reads the migration file and asserts it parses to this array.
export function defaultEntityTypesJson(): string {
  return JSON.stringify(DEFAULT_ENTITY_TYPES);
}
