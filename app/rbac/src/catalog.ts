// ISSUE-018 — the permission catalog + seed matrix (FR-1.PERM.005 / .007, FR-1.ROLE.001).
//
// TWO related but distinct authoritative structures — both sourced, neither guessed:
//
//   1. CATALOG — the concrete PERM-* node catalog. The runtime gate ids can() checks and the seed
//      source for role_permissions rows. Transcribed from PERMISSION_NODES.md; the check CLI
//      re-parses that file and asserts this TS matches it (Rule 0: the .md is the source of truth,
//      the TS must not drift — the ISSUE-010 keygroup-parity discipline).
//
//   2. SEED_MATRIX — the design-doc L509-615 thirteen-category default matrix (capability rows ×
//      six-role booleans). This is what FR-1.PERM.007 / AC-1.PERM.007.1 mean by "the seed catalog …
//      thirteen categories … with default-role assignments." Several categories (Sensitivity
//      Clearance, Agent Invocation) have NO concrete PERM node — they are enforced by clearance rows
//      / per-agent invoke gating — so the thirteen categories are proven via THIS matrix, not by
//      partitioning CATALOG. Transcribed verbatim from the design doc.
//
// The two agree where they overlap (a concrete node's default roles reconcile with its design-doc
// capability row) because PERMISSION_NODES.md was itself reconciled from L509-615.

// ── The six seeded roles (FR-1.ROLE.001; design-doc L471-498) ────────────────────────────────────
export const ROLES = [
  'Super Admin',
  'Admin',
  'Finance',
  'HR',
  'Account Manager',
  'Standard User',
] as const;
export type Role = (typeof ROLES)[number];

/** Super Admin is always protected; the other five defaults are protected while in use (OD-025). */
export const PROTECTED_ROLE: Role = 'Super Admin';

// ── The thirteen permission categories (FR-1.PERM.007; component-01-rbac L331) ────────────────────
export const THIRTEEN_CATEGORIES = [
  'Memory Access',
  'Sensitivity Clearance',
  'Dashboard Access',
  'Tool Access',
  'Agent Invocation',
  'Asset Management',
  'System Functions',
  'User Management',
  'Approval Authority',
  'Ingestion and Initialisation',
  'Compliance',
  'Observability',
  'Chat Commands',
] as const;
export type Category = (typeof THIRTEEN_CATEGORIES)[number];

// ── The C0 stub nodes this issue homes (component-01-rbac L931; ISSUE-018 §5) ─────────────────────
export const C0_STUB_NODES = [
  'PERM-auth.provider_toggle',
  'PERM-user.invite',
  'PERM-support.view',
  'PERM-support.resolve',
] as const;

// A concrete catalog node (the four required fields of FR-1.PERM.005 + its owning section).
export interface CatalogNode {
  node: string;
  description: string;
  defaultRoles: Role[]; // the reconciled seed holders; parenthetical/when-granted caveats are NOT blanket grants
  scope: string;
  addedIn: string;
  section: string; // the PERMISSION_NODES.md owning-component group (the admin-matrix grouping key)
}

const SA: Role[] = ['Super Admin'];
const SA_ADMIN: Role[] = ['Super Admin', 'Admin'];

// ── CATALOG — the concrete PERM-* nodes (PERMISSION_NODES.md, transcribed; parity-checked at build) ─
export const CATALOG: CatalogNode[] = [
  // C0 — Login / Auth (homed in C1)
  { node: 'PERM-auth.provider_toggle', description: 'Toggle the OAuth / auth provider (deployment auth config)', defaultRoles: SA, scope: 'deployment auth', addedIn: 'C0', section: 'C0' },
  { node: 'PERM-support.view', description: 'View the support / "trouble signing in" queue', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C0', section: 'C0' },
  { node: 'PERM-support.resolve', description: 'Transition / resolve support-queue requests', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C0', section: 'C0' },
  { node: 'PERM-user.invite', description: 'Invite users', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C0', section: 'C0' },

  // C1 — RBAC
  { node: 'PERM-system.role_manage', description: 'Create / edit / delete roles + their node assignments', defaultRoles: SA, scope: 'intra-client', addedIn: 'C1', section: 'C1' },
  { node: 'PERM-system.add_sensitivity', description: 'Add custom sensitivity levels beyond the four', defaultRoles: SA, scope: 'intra-client', addedIn: 'C1', section: 'C1' },
  { node: 'PERM-user.assign_role', description: 'Assign roles to users', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C1', section: 'C1' },
  { node: 'PERM-user.deactivate', description: 'Deactivate a user account', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C1', section: 'C1' },
  { node: 'PERM-user.reset_2fa', description: "Reset a user's 2FA / MFA factors", defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C1', section: 'C1' },
  { node: 'PERM-user.view_activity', description: "View a user's activity log", defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C1', section: 'C1' },
  { node: 'PERM-user.grant_clearance', description: 'Grant a sensitivity clearance', defaultRoles: SA, scope: 'intra-client', addedIn: 'C1', section: 'C1' },
  { node: 'PERM-user.grant_restricted', description: 'Grant Restricted access per named individual', defaultRoles: SA, scope: 'per-individual', addedIn: 'C1', section: 'C1' },

  // C2 — Memory (gated by C1)
  { node: 'PERM-memory.write', description: 'Human writes / edits to memory rows', defaultRoles: SA, scope: 'intra-client', addedIn: 'C2', section: 'C2' },
  { node: 'PERM-memory.delete', description: 'Compliance erasure / hard-delete of memory (right-to-erasure)', defaultRoles: SA, scope: 'intra-client', addedIn: 'C2 / C10', section: 'C2' },
  { node: 'PERM-ingestion.initiate', description: 'Initiate memory / document ingestion', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C2', section: 'C2' },
  { node: 'PERM-ingestion.interview', description: 'Run onboarding interviews', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C2', section: 'C2' },
  { node: 'PERM-ingestion.review', description: 'Review the ingestion queue (include / defer)', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C2', section: 'C2' },
  { node: 'PERM-memory.review_conflict', description: 'Resolve a quarantined hard-conflict write on the surface-03 Conflicts queue', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'surface-03 / OD-115', section: 'C2' },
  { node: 'PERM-memory.approve_consolidation', description: 'Approve/reject a Personal-tier merge or episodic→semantic summarise held for human approval', defaultRoles: SA, scope: 'intra-client', addedIn: 'surface-03 / OD-115', section: 'C2' },

  // C3 — Tool layer (homed in C1 / C6)
  { node: 'PERM-tool.manage', description: 'Edit the tool registry (create / version tools)', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C3', section: 'C3' },

  // C4 — Prompt architecture (homed in C1)
  { node: 'PERM-prompt.edit', description: 'Edit general (non-principles) prompt content', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C4', section: 'C4' },
  { node: 'PERM-prompt.edit_principles', description: 'Edit the operating-principles block (the hard floor)', defaultRoles: SA, scope: 'intra-client', addedIn: 'C4', section: 'C4' },
  { node: 'PERM-prompt.rollback', description: 'Roll back a prompt asset to a prior version', defaultRoles: SA, scope: 'intra-client', addedIn: 'C4', section: 'C4' },
  { node: 'PERM-prompt.view_history', description: 'View prompt version history', defaultRoles: SA, scope: 'intra-client', addedIn: 'C4', section: 'C4' },

  // C9 — Proactive / Commands (homed in C1)
  { node: 'PERM-commands.manage', description: 'Create / edit / delete custom chat commands', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C9', section: 'C9' },
  { node: 'PERM-system.tune', description: '/tune + full system commands (threshold config)', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'C9', section: 'C9' },

  // C10 — Infra / Compliance
  { node: 'PERM-config.edit', description: 'Edit infra / compliance CFG-* values', defaultRoles: SA, scope: 'deployment', addedIn: 'C10', section: 'C10' },
  { node: 'PERM-compliance.download_records', description: 'Export / download compliance audit records', defaultRoles: SA, scope: 'intra-client', addedIn: 'C1 (specced C7)', section: 'C10' },
  { node: 'PERM-compliance.view_audit', description: 'Read the access_audit table (the audit trail)', defaultRoles: SA, scope: 'intra-client', addedIn: 'C1 (specced C7) / OD-166', section: 'C10' },

  // Config Admin — the PERM-config.* family (Phase 2; all default Super Admin only)
  { node: 'PERM-config.auth', description: 'Config sections A (auth/session), B (webhooks), C (support)', defaultRoles: SA, scope: 'deployment', addedIn: 'Phase 2', section: 'Config Admin' },
  { node: 'PERM-config.memory', description: 'Config section E (memory)', defaultRoles: SA, scope: 'deployment', addedIn: 'Phase 2', section: 'Config Admin' },
  { node: 'PERM-config.tools', description: 'Config section F (tool layer / connectors)', defaultRoles: SA, scope: 'deployment', addedIn: 'Phase 2', section: 'Config Admin' },
  { node: 'PERM-config.prompts', description: 'Config section G (prompt architecture)', defaultRoles: SA, scope: 'deployment', addedIn: 'Phase 2', section: 'Config Admin' },
  { node: 'PERM-config.loops', description: 'Config section H (agent harness / loops)', defaultRoles: SA, scope: 'deployment', addedIn: 'Phase 2', section: 'Config Admin' },
  { node: 'PERM-config.guardrails', description: 'Config section I (guardrails, anomaly, rate, cost ladder, injection)', defaultRoles: SA, scope: 'deployment', addedIn: 'Phase 2', section: 'Config Admin' },
  { node: 'PERM-config.observability', description: 'Config section J (observability incl. alert routing)', defaultRoles: SA, scope: 'deployment', addedIn: 'Phase 2', section: 'Config Admin' },
  { node: 'PERM-config.agents', description: 'Config section K (agent routing, models, health)', defaultRoles: SA, scope: 'deployment', addedIn: 'Phase 2', section: 'Config Admin' },
  { node: 'PERM-config.proactive', description: 'Config section L (scanners, thresholds, cold-start)', defaultRoles: SA, scope: 'deployment', addedIn: 'Phase 2', section: 'Config Admin' },
  { node: 'PERM-config.infra', description: 'Config section M (deploy, residency, retention, deletion policy)', defaultRoles: SA, scope: 'deployment', addedIn: 'Phase 2', section: 'Config Admin' },
  { node: 'PERM-config.secrets', description: 'Config section N (platform secrets — presence-only view)', defaultRoles: SA, scope: 'deployment', addedIn: 'Phase 2', section: 'Config Admin' },

  // Dashboard Access — the PERM-dashboard.* family
  { node: 'PERM-dashboard.overview', description: 'Enter the agency / management overview dashboard (surface-07)', defaultRoles: ['Super Admin', 'Admin', 'Account Manager'], scope: 'intra-client', addedIn: 'surface-07 / OD-129', section: 'Dashboard Access' },
  { node: 'PERM-dashboard.ops', description: 'Enter the technical operations dashboard (surface-05)', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'surface-05 (ref) / surface-07 / OD-129', section: 'Dashboard Access' },
  { node: 'PERM-dashboard.workspace', description: 'Enter the personal user workspace (surface-08)', defaultRoles: [...ROLES], scope: 'intra-client', addedIn: 'surface-08 / OD-133', section: 'Dashboard Access' },

  // Asset Management — the PERM-agents.* family
  { node: 'PERM-agents.view', description: 'Enter the agent fleet/builder (surface-09); view the registry, definitions, version history, routing, health', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'surface-09 / OD-137', section: 'Asset Management' },
  { node: 'PERM-agents.edit_description', description: "Edit an agent's description / max_tokens / registry tuning; roll back an execution-plan version", defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'surface-09 / OD-137', section: 'Asset Management' },
  { node: 'PERM-agents.edit_capability', description: 'Edit memory_scope / tools_allowed / enabled; add a new agent; disable an agent (capability grants)', defaultRoles: SA, scope: 'intra-client', addedIn: 'surface-09 / OD-137', section: 'Asset Management' },

  // Approval Authority — the PERM-action.* family
  { node: 'PERM-action.review', description: 'Enter the surface-04 approval queue and Approve / Reject / Modify a held agent action', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'surface-04 / OD-117', section: 'Approval Authority' },

  // Guardrails — autonomy (pre-existing, glossary)
  { node: 'PERM-guardrail.edit_autonomy', description: 'Edit action_autonomy_matrix (autonomy tiers; floored rows reject downgrade)', defaultRoles: SA, scope: 'deployment', addedIn: 'C6 / C9', section: 'Guardrails' },

  // Management Plane — the fleet console (management-plane scope; all Super Admin only / never delegable)
  { node: 'PERM-fleet.view', description: 'Enter the fleet console (deployment health grid + read-only cross-deployment panels)', defaultRoles: SA, scope: 'management-plane', addedIn: 'surface-06 / OD-125', section: 'Management Plane' },
  { node: 'PERM-fleet.provision', description: 'Run/track the provisioning flow + register a new client (FR-10.PRV.001)', defaultRoles: SA, scope: 'management-plane', addedIn: 'surface-06 / OD-125', section: 'Management Plane' },
  { node: 'PERM-fleet.promote_release', description: 'Promote a release (canary→main) and roll back (FR-10.DEP.002/003)', defaultRoles: SA, scope: 'management-plane', addedIn: 'surface-06 / OD-125', section: 'Management Plane' },
  { node: 'PERM-fleet.offboard', description: 'Initiate + execute client offboarding (hard-delete additionally requires two-person auth)', defaultRoles: SA, scope: 'management-plane', addedIn: 'surface-06 / OD-125', section: 'Management Plane' },
  { node: 'PERM-fleet.rotate_token', description: "Rotate a deployment's internal_token (FR-10.MGT.004)", defaultRoles: SA, scope: 'management-plane', addedIn: 'surface-06 / OD-125', section: 'Management Plane' },

  // Operations Actions — the PERM-ops.* family
  { node: 'PERM-ops.dlq_manage', description: 'Requeue / discard a dead-lettered task_queue row on the surface-05 DLQ panel', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'surface-05 / OD-167', section: 'Operations Actions' },
  { node: 'PERM-ops.connector_reconnect', description: 'Trigger the C3 connector reconnect / re-auth action from the surface-05 connectors panel', defaultRoles: SA_ADMIN, scope: 'intra-client', addedIn: 'surface-05 / OD-167', section: 'Operations Actions' },
];

/** Every node id in the catalog (unique set). */
export const CATALOG_NODES: ReadonlySet<string> = new Set(CATALOG.map((n) => n.node));

/** The default (role → granted node set) matrix derived from CATALOG — what provisioning seeds. */
export function defaultMatrix(): Map<Role, Set<string>> {
  const m = new Map<Role, Set<string>>();
  for (const r of ROLES) m.set(r, new Set<string>());
  for (const n of CATALOG) for (const r of n.defaultRoles) m.get(r)!.add(n.node);
  return m;
}

// ── SEED_MATRIX — the design-doc L509-615 thirteen-category default matrix (verbatim transcription) ─
// Column order: [Super Admin, Admin, Finance, HR, Account Manager, Standard User].
// A row's booleans are the design-doc ✓/✗. `*`/`**`/`***` caveats (scoped/per-individual/granted) are
// footnoted in the design doc and treated as the base ✓ here; per-item narrowing is context (can()).
type RoleFlags = [boolean, boolean, boolean, boolean, boolean, boolean];
const T = true, F = false;
export interface SeedRow { capability: string; roles: RoleFlags; }
export const SEED_MATRIX: Record<Category, SeedRow[]> = {
  'Memory Access': [
    { capability: 'Global visibility', roles: [T, T, T, T, T, T] },
    { capability: 'Team visibility', roles: [T, T, T, T, T, F] },
    { capability: 'Private visibility', roles: [T, T, F, F, F, F] },
    { capability: 'Write memory directly', roles: [T, T, F, F, F, F] },
    { capability: 'Delete / retire memory', roles: [T, T, F, F, F, F] },
  ],
  'Sensitivity Clearance': [
    { capability: 'Standard', roles: [T, T, T, T, T, T] },
    { capability: 'Confidential (all)', roles: [T, T, F, F, F, F] },
    { capability: 'Confidential (finance only)', roles: [T, T, T, F, F, F] },
    { capability: 'Confidential (client only)', roles: [T, T, F, F, T, F] },
    { capability: 'Personal (all)', roles: [T, T, F, F, F, F] },
    { capability: 'Personal (team member only)', roles: [T, T, F, T, F, F] },
    { capability: 'Restricted', roles: [T, F, F, F, F, F] },
  ],
  'Dashboard Access': [
    { capability: 'Super Admin dashboard', roles: [T, F, F, F, F, F] },
    { capability: 'Operations dashboard', roles: [T, T, F, F, F, F] },
    { capability: 'Memory health dashboard', roles: [T, T, F, F, F, F] },
    { capability: 'Failure health dashboard', roles: [T, T, F, F, F, F] },
    { capability: 'Self-improvement panel', roles: [T, T, F, F, F, F] },
    { capability: 'Guardrail log (full)', roles: [T, T, F, F, F, F] },
    { capability: 'Event log (full)', roles: [T, T, F, F, F, F] },
    { capability: 'Agency owner view', roles: [T, T, F, F, T, F] },
    { capability: 'Standard user view', roles: [T, T, T, T, T, T] },
    { capability: 'Approval queue (own items)', roles: [T, T, T, T, T, F] },
    { capability: 'Approval queue (all items)', roles: [T, T, F, F, F, F] },
    { capability: 'Mobile view', roles: [T, T, T, T, T, T] },
  ],
  'Tool Access': [
    { capability: 'Read tools (all)', roles: [T, T, T, T, T, F] },
    { capability: 'Write tools (low risk)', roles: [T, T, T, F, T, F] },
    { capability: 'Write tools (medium risk)', roles: [T, T, T, F, T, F] },
    { capability: 'Write tools (high risk)', roles: [T, T, F, F, F, F] },
  ],
  'Agent Invocation': [
    { capability: 'All agents (direct invoke)', roles: [T, T, F, F, F, F] },
    { capability: 'Finance Agent (direct)', roles: [T, T, T, F, F, F] },
    { capability: 'Human-initiated via chat', roles: [T, T, T, T, T, T] },
  ],
  'Asset Management': [
    { capability: 'Create / edit agents', roles: [T, T, F, F, F, F] },
    { capability: 'Create / edit task graphs', roles: [T, T, F, F, F, F] },
    { capability: 'Create / edit task templates', roles: [T, T, F, F, F, F] },
    { capability: 'Create / edit tools', roles: [T, T, F, F, F, F] },
    { capability: 'Create / edit prompt layers', roles: [T, T, F, F, F, F] },
    { capability: 'View asset version history', roles: [T, T, F, F, F, F] },
    { capability: 'Roll back assets', roles: [T, T, F, F, F, F] },
  ],
  'System Functions': [
    { capability: 'Create / edit / delete roles', roles: [T, F, F, F, F, F] },
    { capability: 'Add custom entity types', roles: [T, T, F, F, F, F] },
    { capability: 'Add custom sensitivity levels', roles: [T, F, F, F, F, F] },
    { capability: 'Manage deployment config', roles: [T, T, F, F, F, F] },
    { capability: 'Manage connector auth', roles: [T, T, F, F, F, F] },
    { capability: 'Plugin management', roles: [T, F, F, F, F, F] },
    { capability: 'Create / edit triggers', roles: [T, T, F, F, F, F] },
    { capability: 'Create / edit loops', roles: [T, T, F, F, F, F] },
    { capability: 'Manually trigger loop run', roles: [T, T, F, F, F, F] },
  ],
  'User Management': [
    { capability: 'Invite users', roles: [T, T, F, F, F, F] },
    { capability: 'Deactivate user accounts', roles: [T, T, F, F, F, F] },
    { capability: 'Reset user 2FA', roles: [T, T, F, F, F, F] },
    { capability: 'Assign roles to users', roles: [T, T, F, F, F, F] },
    { capability: 'Grant sensitivity clearances', roles: [T, F, F, F, F, F] },
    { capability: 'Grant Restricted (individual)', roles: [T, F, F, F, F, F] },
    { capability: 'View user activity logs', roles: [T, T, F, F, F, F] },
  ],
  'Approval Authority': [
    { capability: 'Approve own-domain actions', roles: [T, T, T, T, T, F] },
    { capability: 'Approve any action', roles: [T, T, F, F, F, F] },
    { capability: 'Reassign approval items', roles: [T, T, F, F, F, F] },
    { capability: 'Set approval routing rules', roles: [T, T, F, F, F, F] },
  ],
  'Ingestion and Initialisation': [
    { capability: 'View ingestion queue', roles: [T, T, F, F, F, F] },
    { capability: 'Action ingestion queue items', roles: [T, T, F, F, F, F] },
    { capability: 'Initiate ingestion pipelines', roles: [T, T, F, F, F, F] },
    { capability: 'Run verification pass', roles: [T, T, F, F, F, F] },
    { capability: 'Conduct onboarding interviews', roles: [T, T, F, F, F, F] },
  ],
  Compliance: [
    { capability: 'View deletion request queue', roles: [T, T, F, F, F, F] },
    { capability: 'Execute deletion requests', roles: [T, T, F, F, F, F] },
    { capability: 'Initiate client offboarding', roles: [T, F, F, F, F, F] },
    { capability: 'Download compliance records', roles: [T, T, F, F, F, F] },
  ],
  Observability: [
    { capability: 'View full cost breakdown', roles: [T, T, F, F, F, F] },
    { capability: 'Set cost alert thresholds', roles: [T, T, F, F, F, F] },
    { capability: 'Export cost reports', roles: [T, T, F, F, F, F] },
    { capability: 'Action maintenance queue', roles: [T, T, F, F, F, F] },
    { capability: 'Action dead letter queue', roles: [T, T, F, F, F, F] },
    { capability: 'Act on self-improvement', roles: [T, T, F, F, F, F] },
  ],
  'Chat Commands': [
    { capability: '/recall /remember /forget', roles: [T, T, T, T, T, T] },
    { capability: '/verify', roles: [T, T, T, T, T, T] },
    { capability: '/run /queue /status', roles: [T, T, T, T, T, T] },
    { capability: '/approve /reject', roles: [T, T, T, T, T, F] },
    { capability: '/schedule /trigger', roles: [T, T, F, F, F, F] },
    { capability: '/health /alerts /help', roles: [T, T, T, T, T, T] },
    { capability: '/tune', roles: [T, T, F, F, F, F] },
    { capability: '/memory-health', roles: [T, T, F, F, F, F] },
  ],
};
