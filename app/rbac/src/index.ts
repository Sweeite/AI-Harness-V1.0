// @harness/rbac — ISSUE-018 (C1 authorization core). Public surface: the RbacStore port + in-memory fake
// reference model, the can() gate, the role seed + runtime CRUD + guards, and the permission catalog +
// thirteen-category seed matrix. Downstream: ISSUE-019 extends the seeded clearances + can() node set;
// ISSUE-021 owns the deactivate/role-change ACTIONS whose last-Super-Admin guard is homed here; ISSUE-072
// routes command dispatch through can(). The live pg adapter is supabase-store.ts; the seed is applied at
// provisioning by seedRoles() (there is NO new migration — the tables/policies land in ISSUE-008/009, and
// keeping the matrix in TS-only avoids the SQL/TS drift ISSUE-010 caught, §5 "authoring no new DDL").
//
// The `check` CLI runs the offline build-time gates (no DB, no network):
//   (1) catalog ≡ PERMISSION_NODES.md — the TS CATALOG must not drift from the .md source of truth (node
//       set + default-role assignments) (FR-1.PERM.005).
//   (2) four-field completeness — every catalog node carries description · default roles · scope · added-in
//       (AC-1.PERM.005.1).
//   (3) matrix completeness — the admin matrix renders EVERY catalog node, none hardcoded/omitted
//       (AC-1.PERM.005.2).
//   (4) seed completeness — all thirteen categories present with per-role assignments + every C0 stub node
//       catalogued with default roles (AC-1.PERM.007.1).
//   (5) fail-closed default — the default grant matrix grants only catalogued nodes; an unknown node is
//       granted to no role (default-deny holds structurally) (AC-1.PERM.002.2 / AC-NFR-SEC.005.1).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

import {
  ROLES,
  THIRTEEN_CATEGORIES,
  C0_STUB_NODES,
  CATALOG,
  CATALOG_NODES,
  SEED_MATRIX,
  defaultMatrix,
  type Role,
  type Category,
  type CatalogNode,
} from './catalog.ts';
import {
  assertScopeTokensPresent,
  assertNoRestrictedRoleDefault,
  isAutoInjectable,
  DEFAULT_CLEARANCES,
} from './clearance.ts';

// ── re-exports (public surface) ───────────────────────────────────────────────────────────────────
export {
  ROLES,
  PROTECTED_ROLE,
  THIRTEEN_CATEGORIES,
  C0_STUB_NODES,
  CATALOG,
  CATALOG_NODES,
  SEED_MATRIX,
  defaultMatrix,
  type Role,
  type Category,
  type CatalogNode,
  type SeedRow,
} from './catalog.ts';
export {
  InMemoryRbacStore,
  RbacError,
  ERR_DENIED,
  ERR_PROTECTED,
  ERR_ROLE_IN_USE,
  ERR_LAST_SUPER_ADMIN,
  ERR_NO_SUCH_ROLE,
  type RbacStore,
  type RoleRow,
  type ClearanceRow,
  type AuditRow,
} from './store.ts';
export {
  can,
  allowed,
  canWithPrompt,
  authorizeDestructive,
  effectiveNodes,
  rlsHelperPerms,
  type CanContext,
  type Decision,
  type ScopeCheck,
} from './can.ts';
export {
  seedRoles,
  createRole,
  toggleNode,
  deleteRole,
  changeUserRole,
  deactivateUser,
  isLastSuperAdmin,
  auditDeniedAccess,
  ROLE_MANAGE_NODE,
} from './roles.ts';
export { SupabaseRbacStore } from './supabase-store.ts';
export {
  // ISSUE-019 — clearance + Restricted model + flows.
  BASE_SENSITIVITY_TIERS,
  TIER_HANDLING,
  sensitivityTiers,
  isAutoInjectable,
  filterAutoInjectable,
  applyClearanceControl,
  DEFAULT_CLEARANCES,
  FINANCE_ENTITY_TYPES,
  SHIPPED_ENTITY_TYPES,
  assertScopeTokensPresent,
  assertNoRestrictedRoleDefault,
  seedDefaultClearances,
  grantClearance,
  revokeClearance,
  effectiveClearances,
  hasClearanceFor,
  confirmClearanceReview,
  reviewOverdueClearances,
  grantRestricted,
  revokeRestricted,
  InMemoryAlertSink,
  GRANT_CLEARANCE_NODE,
  GRANT_RESTRICTED_NODE,
  ADD_SENSITIVITY_NODE,
  type SensitivityTier,
  type DefaultClearance,
  type ClearanceAlert,
  type ClearanceAlertSink,
} from './clearance.ts';
export { type RestrictedGrantRow } from './store.ts';

interface Finding {
  gate: string;
  message: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_MD = join(HERE, '..', '..', '..', 'PERMISSION_NODES.md');

/** Parse the "Default roles" cell of a catalog row into the concrete seed-role set. Leading role tokens
 *  before any '(' / '—' / '+' are the base holders; parenthetical/dynamic ("+ Compliance-holding roles",
 *  "(read-only)", "only when granted") are NOT blanket seed grants. "All six roles" → every role. */
function parseDefaultRoles(cell: string): Role[] {
  const c = cell.trim();
  if (/^all six roles/i.test(c)) return [...ROLES];
  const head = c.split(/[(—+]/)[0] ?? '';
  const tokens = head.split(',').map((t) => t.trim()).filter(Boolean);
  return tokens.filter((t): t is Role => (ROLES as readonly string[]).includes(t));
}

/** Extract every catalog row (node id + default-roles cell) from the PERMISSION_NODES.md tables. */
function parseCatalogMd(md: string): Map<string, Role[]> {
  const out = new Map<string, Role[]>();
  for (const line of md.split('\n')) {
    // a catalog row: | `PERM-x.y` [⚠] | description | Default roles | scope | added |
    const m = line.match(/^\|\s*`(PERM-[a-z0-9_.]+)`[^|]*\|([^|]*)\|([^|]*)\|/i);
    if (!m) continue;
    const node = m[1]!;
    const rolesCell = m[3]!;
    out.set(node, parseDefaultRoles(rolesCell));
  }
  return out;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** Gate 1 — the TS CATALOG must match PERMISSION_NODES.md exactly (node set + default roles). */
function checkCatalogParity(): Finding[] {
  const findings: Finding[] = [];
  let md = '';
  try {
    md = readFileSync(CATALOG_MD, 'utf8');
  } catch {
    return [{ gate: 'catalog-parity', message: `PERMISSION_NODES.md not found at ${CATALOG_MD} — cannot verify catalog is not drifting` }];
  }
  const fromMd = parseCatalogMd(md);
  // every .md node is in the TS catalog, and vice-versa
  for (const node of fromMd.keys()) {
    if (!CATALOG_NODES.has(node)) findings.push({ gate: 'catalog-parity', message: `PERMISSION_NODES.md has '${node}' but the TS CATALOG does not (a homed gate is missing from code — #3)` });
  }
  for (const n of CATALOG) {
    const mdRoles = fromMd.get(n.node);
    if (!mdRoles) {
      findings.push({ gate: 'catalog-parity', message: `TS CATALOG has '${n.node}' but PERMISSION_NODES.md does not (uncatalogued gate — FR-1.PERM.005)` });
      continue;
    }
    if (!sameSet(n.defaultRoles, mdRoles)) {
      findings.push({ gate: 'catalog-parity', message: `default roles for '${n.node}' drift: TS=[${n.defaultRoles.join(', ')}] vs .md=[${mdRoles.join(', ')}]` });
    }
  }
  return findings;
}

/** Gate 2 — every catalog node carries all four required fields (AC-1.PERM.005.1). */
function checkFourFields(): Finding[] {
  const findings: Finding[] = [];
  for (const n of CATALOG) {
    if (!n.description?.trim()) findings.push({ gate: 'four-fields', message: `${n.node}: missing description` });
    if (!n.defaultRoles || n.defaultRoles.length === 0) findings.push({ gate: 'four-fields', message: `${n.node}: no default roles (a node with no seed holder must default to Super Admin, never empty — OD-030)` });
    if (!n.scope?.trim()) findings.push({ gate: 'four-fields', message: `${n.node}: missing scope` });
    if (!n.addedIn?.trim()) findings.push({ gate: 'four-fields', message: `${n.node}: missing added-in` });
  }
  return findings;
}

/** The admin permission matrix: every catalog node as a configurable (role → granted) row, grouped by its
 *  owning section. Generated from the catalog — nothing hardcoded (AC-1.PERM.005.2). Also the seam the
 *  surface-02 Permissions tab renders. */
export function renderAdminMatrix(): Array<{ node: string; section: string; grants: Record<Role, boolean> }> {
  const matrix = defaultMatrix();
  return CATALOG.map((n) => {
    const grants = Object.fromEntries(ROLES.map((r) => [r, matrix.get(r)!.has(n.node)])) as Record<Role, boolean>;
    return { node: n.node, section: n.section, grants };
  });
}

/** Gate 3 — the rendered matrix covers exactly the catalog node set (none omitted, none hardcoded-extra). */
function checkMatrixCompleteness(): Finding[] {
  const rendered = new Set(renderAdminMatrix().map((r) => r.node));
  const findings: Finding[] = [];
  for (const node of CATALOG_NODES) if (!rendered.has(node)) findings.push({ gate: 'matrix', message: `catalog node '${node}' is not rendered in the admin matrix (omitted node — AC-1.PERM.005.2)` });
  for (const node of rendered) if (!CATALOG_NODES.has(node)) findings.push({ gate: 'matrix', message: `admin matrix renders '${node}' which is not in the catalog (hardcoded node — AC-1.PERM.005.2)` });
  return findings;
}

/** Gate 4 — all thirteen categories present with per-role assignments + every C0 stub catalogued (AC-1.PERM.007.1). */
function checkSeedCompleteness(): Finding[] {
  const findings: Finding[] = [];
  for (const cat of THIRTEEN_CATEGORIES) {
    const rows = SEED_MATRIX[cat as Category];
    if (!rows || rows.length === 0) {
      findings.push({ gate: 'seed', message: `category '${cat}' has no seed rows (thirteen-category seed incomplete — AC-1.PERM.007.1)` });
      continue;
    }
    for (const row of rows) {
      if (row.roles.length !== ROLES.length) findings.push({ gate: 'seed', message: `'${cat}' / '${row.capability}': ${row.roles.length} role flags, expected ${ROLES.length}` });
    }
  }
  const cats = Object.keys(SEED_MATRIX);
  if (cats.length !== THIRTEEN_CATEGORIES.length) findings.push({ gate: 'seed', message: `SEED_MATRIX has ${cats.length} categories, expected ${THIRTEEN_CATEGORIES.length}` });
  for (const stub of C0_STUB_NODES) {
    const n = CATALOG.find((x) => x.node === stub);
    if (!n) findings.push({ gate: 'seed', message: `C0 stub node '${stub}' is not catalogued (AC-1.PERM.007.1)` });
    else if (n.defaultRoles.length === 0) findings.push({ gate: 'seed', message: `C0 stub node '${stub}' has no default-role assignment (AC-1.PERM.007.1)` });
  }
  return findings;
}

/** Gate 5 — the default grant matrix grants only catalogued nodes; an unknown node is granted to no role
 *  (default-deny holds structurally — a new node is denied for everyone until explicitly granted). */
function checkFailClosed(): Finding[] {
  const findings: Finding[] = [];
  const matrix = defaultMatrix();
  for (const role of ROLES) {
    for (const node of matrix.get(role)!) {
      if (!CATALOG_NODES.has(node)) findings.push({ gate: 'fail-closed', message: `role '${role}' is seeded node '${node}' which is not in the catalog (uncatalogued grant)` });
    }
  }
  // a brand-new, unseeded node must be granted to nobody (AC-1.PERM.002.2)
  const BRAND_NEW = 'PERM-brandnew.capability_xyz';
  const grantedToSomeone = ROLES.some((r) => matrix.get(r)!.has(BRAND_NEW));
  if (grantedToSomeone) findings.push({ gate: 'fail-closed', message: `a brand-new node is granted by default — default-deny violated (#2)` });
  return findings;
}

/** Gate 6 — the ISSUE-019 clearance model integrity (offline, static): every default scope token is a shipped
 *  entity type (OD-186), no role default is Restricted (FR-1.RST.001), Standard User carries no clearance row
 *  (Standard is implicit), and Restricted is never auto-injectable (FR-1.RST.003). */
function checkClearanceModel(): Finding[] {
  const findings: Finding[] = [];
  try {
    assertScopeTokensPresent(); // every default scope token ∈ SHIPPED_ENTITY_TYPES (OD-186)
  } catch (e) {
    findings.push({ gate: 'clearance', message: (e as Error).message });
  }
  try {
    assertNoRestrictedRoleDefault(); // FR-1.RST.001 — Restricted is never a role default
  } catch (e) {
    findings.push({ gate: 'clearance', message: (e as Error).message });
  }
  if (DEFAULT_CLEARANCES['Standard User'].length !== 0) {
    findings.push({ gate: 'clearance', message: `Standard User has ${DEFAULT_CLEARANCES['Standard User'].length} default clearance row(s) — Standard is implicit, expected none` });
  }
  if (isAutoInjectable('restricted')) {
    findings.push({ gate: 'clearance', message: `Restricted is auto-injectable — FR-1.RST.003 requires it is never auto-injected (#2)` });
  }
  return findings;
}

function runCheck(): Finding[] {
  const findings = [
    ...checkCatalogParity(),
    ...checkFourFields(),
    ...checkMatrixCompleteness(),
    ...checkSeedCompleteness(),
    ...checkFailClosed(),
    ...checkClearanceModel(),
  ];
  if (findings.length === 0) {
    console.log(
      `✓ rbac check: CATALOG ≡ PERMISSION_NODES.md (${CATALOG.length} nodes) · all four fields present · admin matrix renders every node · ${THIRTEEN_CATEGORIES.length} categories + ${C0_STUB_NODES.length} C0 stubs seeded · fail-closed default holds · clearance model integrity (scope tokens ⊆ entity_types, no Restricted role default, Standard implicit).`,
    );
  } else {
    console.error(`✗ rbac check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

// Only run the CLI when invoked directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}
