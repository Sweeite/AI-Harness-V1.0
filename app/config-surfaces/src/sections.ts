// ISSUE-086 — the 11-section catalog + PERM gating for both config surfaces (surface-01 §Access/§Layout,
// surface-01b §Access, config-registry.md §"Permission gates"). The cardinal #2 rule (FR-1.PERM.006 house
// discipline, mirrored from ops-dashboards/rbac.ts): a section the caller's PERM set does NOT cover is
// ABSENT from the rail — never rendered as a locked/disabled shell (a caller must not learn a section exists
// by seeing it greyed out). #infra and #secrets are Super-Admin-only and never delegable (registry note).
//
// Entry gate: the caller must hold ≥1 PERM-config.* node; a caller with none sees a 404 (surface hidden),
// never a silent empty screen (OD-026 denied-access is explicit).

export type ConfigPermNode =
  | 'PERM-config.auth'
  | 'PERM-config.memory'
  | 'PERM-config.tools'
  | 'PERM-config.prompts'
  | 'PERM-config.loops'
  | 'PERM-config.guardrails'
  | 'PERM-config.observability'
  | 'PERM-config.agents'
  | 'PERM-config.proactive'
  | 'PERM-config.infra';

/** Includes the secrets node (read-only presence view) — not a ConfigPermNode because SECRET keys never
 *  live in config_values (so config_values/config_audit_log key-prefix RLS never resolves to it). */
export type AnyConfigNode = ConfigPermNode | 'PERM-config.secrets';

export type SectionId =
  | '#auth'
  | '#memory'
  | '#tools'
  | '#prompts'
  | '#loops'
  | '#guardrails'
  | '#observability'
  | '#agents'
  | '#proactive'
  | '#infra'
  | '#secrets';

export const DOWNLOAD_RECORDS_PERM = 'PERM-compliance.download_records' as const;

export interface SectionDef {
  id: SectionId;
  label: string;
  node: AnyConfigNode;
  /** Super-Admin-only, never delegable — hidden from every non-Super-Admin caller (#infra, #secrets). */
  superAdminOnly: boolean;
  /** #secrets is a read-only presence view — never a Save control (config-edit-taxonomy rule 2). */
  readOnly: boolean;
}

// The 11 sections in rail order (surface-01 §Layout).
export const SECTIONS: readonly SectionDef[] = [
  { id: '#auth', label: 'Auth, Webhook & Support', node: 'PERM-config.auth', superAdminOnly: false, readOnly: false },
  { id: '#memory', label: 'Memory', node: 'PERM-config.memory', superAdminOnly: false, readOnly: false },
  { id: '#tools', label: 'Tool Layer / Connectors', node: 'PERM-config.tools', superAdminOnly: false, readOnly: false },
  { id: '#prompts', label: 'Prompt Architecture', node: 'PERM-config.prompts', superAdminOnly: false, readOnly: false },
  { id: '#loops', label: 'Agent Harness / Loops', node: 'PERM-config.loops', superAdminOnly: false, readOnly: false },
  { id: '#guardrails', label: 'Guardrails', node: 'PERM-config.guardrails', superAdminOnly: false, readOnly: false },
  { id: '#observability', label: 'Observability', node: 'PERM-config.observability', superAdminOnly: false, readOnly: false },
  { id: '#agents', label: 'Agent Design / Routing', node: 'PERM-config.agents', superAdminOnly: false, readOnly: false },
  { id: '#proactive', label: 'Proactive Intelligence', node: 'PERM-config.proactive', superAdminOnly: false, readOnly: false },
  { id: '#infra', label: 'Infrastructure & Compliance', node: 'PERM-config.infra', superAdminOnly: true, readOnly: false },
  { id: '#secrets', label: 'Platform Secrets', node: 'PERM-config.secrets', superAdminOnly: true, readOnly: true },
];

/** section → owning PERM node (used by keys.ts to stamp each key's node without re-listing the map). */
export const SECTION_NODE: Record<SectionId, AnyConfigNode> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s.node]),
) as Record<SectionId, AnyConfigNode>;

/** The authenticated caller as far as these surfaces are concerned. */
export interface Caller {
  isSuperAdmin: boolean;
  /** The caller's held PERM-config.* nodes + any other PERM-* nodes (e.g. PERM-compliance.download_records). */
  heldPerms: ReadonlySet<string>;
}

export function caller(isSuperAdmin: boolean, held: readonly string[]): Caller {
  return { isSuperAdmin, heldPerms: new Set(held) };
}

/** Does the caller hold ≥1 PERM-config.* node (the entry gate for BOTH surfaces)? A caller with none sees a
 *  404 (surface hidden), never an empty screen. */
export function canEnter(c: Caller): boolean {
  for (const p of c.heldPerms) if (p.startsWith('PERM-config.')) return true;
  return false;
}

/** Can this caller SEE this section? default-deny: the node must be held; Super-Admin-only sections require
 *  isSuperAdmin. An unpermitted section is absent (not returned), never a locked shell (#2). */
export function canViewSection(c: Caller, s: SectionDef): boolean {
  if (s.superAdminOnly && !c.isSuperAdmin) return false;
  return c.heldPerms.has(s.node);
}

/** The sections that RENDER in this caller's rail — the rest are omitted entirely (surface-01 §Access). */
export function visibleSections(c: Caller): SectionDef[] {
  return SECTIONS.filter((s) => canViewSection(c, s));
}

// ── Key → PERM node (the key-prefix scope, mirror of app/config-store keygroup.ts / SQL config_key_group) ──
// Only auth./webhook./support. are uniform-prefixed → PERM-config.auth; every other key resolves via the
// section catalog (keys.ts). An unknown key fails CLOSED to PERM-config.infra (Super-Admin-only, OD-181) so a
// stray/renamed key never leaks into a lower section's scope (#2). Implemented in keys.ts (it owns the
// catalog); re-exported here for scope callers that only import sections.
