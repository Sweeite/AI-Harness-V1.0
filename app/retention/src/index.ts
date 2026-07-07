// @harness/retention — ISSUE-084 (C10 retention / isolation / residency / legal-review gate). Public
// surface: the RetentionStore port + in-memory fake reference model, the live pg adapter, and the retention
// catalog (the four CFG keys + floors + region + sanctioned delete paths). Downstream: ISSUE-082 (individual
// erasure, FR-10.DEL.*) and ISSUE-083 (client offboarding, FR-10.OFF.*) consume RET.001's two-path
// constraint + the retention CFG values; ISSUE-012 owns client_registry.region this slice records into.
//
// This slice authors NO new DDL: it registers the four FR-10.RET.002 CFG keys into the ISSUE-010 config
// store and ASSERTS the ISSUE-008 baseline schema (keeping the invariant in a TS lint avoids the SQL/TS
// drift ISSUE-010 caught). The proposed CFG keys + the no-client_slug lint assertion + the residency
// default are written to results/proposed-shared-spec.md for the orchestrator to fold into the shared spec.
//
// The `check` CLI runs the offline build-time gates (no DB, no network):
//   (1) isolation lint — the ISSUE-008 baseline migration (app-silo tables only) must declare NO
//       client_slug / client-identity column on ANY application table (FR-10.ISO.001 AC-10.ISO.001.1 /
//       AC-NFR-SEC.001.1). A false negative here is a #2 isolation breach.
//   (2) identity-home — client_slug must appear ONLY under the management-plane block (schema §13), never
//       in a client silo (AC-10.ISO.001.2).
//   (3) config completeness — the four retention keys are catalogued with their defaults + PERM-config.infra
//       gate (AC-10.RET.002.1); the v2 deployment_region knob is present as a stub (AC-10.ISO.003.2).
//   (4) residency default — the v1 region lock resolves to ap-southeast-2 (AC-10.ISO.003.1).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

import {
  RETENTION_KEYS,
  RETENTION_DEFAULTS,
  DEFAULT_FLOORS,
  DEPLOYMENT_REGION_KEY,
  INFRA_PERM,
  V1_REGION_DEFAULT,
  SANCTIONED_DELETE_PATHS,
  ROUTINE_OPS,
} from './catalog.ts';

// ── re-exports (public surface) ─────────────────────────────────────────────────────────────────────
export {
  RETENTION_KEYS,
  RETENTION_DEFAULTS,
  DEFAULT_FLOORS,
  DEPLOYMENT_REGION_KEY,
  INFRA_PERM,
  V1_REGION_DEFAULT,
  SANCTIONED_DELETE_PATHS,
  ROUTINE_OPS,
  KEY_KIND,
  type RetentionKey,
  type FloorRegistry,
  type DeletePath,
  type RoutineOp,
} from './catalog.ts';
export {
  InMemoryRetentionStore,
  RetentionError,
  ERR_DENIED,
  ERR_BELOW_FLOOR,
  ERR_FLOOR_UNRESOLVED,
  ERR_BAD_TYPE,
  ERR_CLIENT_SLUG,
  ERR_UNAUTHORISED_DELETE,
  type RetentionStore,
  type RetentionAuditRow,
  type RegistryRow,
  type Tombstone,
  type ResidencyRecord,
  type LegalReview,
} from './store.ts';
export { SupabaseRetentionStore } from './supabase-store.ts';

interface Finding {
  gate: string;
  message: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
// The ISSUE-008 baseline migration = the app-silo schema (management-plane tables are a separate migration;
// see its header note). Every `create table` here is an application table where client_slug is forbidden.
const BASELINE = join(HERE, '..', '..', 'silo', 'migrations', '0001_baseline.sql');

/** The client-identity column names the isolation invariant forbids on ANY application table. */
const IDENTITY_COLUMNS = ['client_slug', 'client_id', 'tenant_id', 'tenant'] as const;

/** Split the baseline SQL into per-table `create table … ( … );` blocks. Returns [tableName, body].
 *
 * logic-sweep fix (index.ts:87 tableBlocks): the old terminator `([\s\S]*?)\n\)\s*;` closed each block at
 * the FIRST `\n);`, so a multi-line parenthesised constraint whose closing paren wraps onto its own line
 * (a mid-table `\n);`) truncated the body — every column after it (e.g. a `client_slug`) escaped the
 * identity scan, a #2/#3 silent false-clean. We now match the CREATE TABLE header, then walk the body
 * tracking paren depth to find the TRUE top-level closing `)` before the statement's `;`, so nested `);`
 * inside a constraint no longer ends the block early. */
function tableBlocks(sql: string): Array<[string, string]> {
  const blocks: Array<[string, string]> = [];
  const head = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = head.exec(sql)) !== null) {
    // `head` consumed through the opening `(`; walk from here tracking paren depth (starting at 1).
    let depth = 1;
    let i = head.lastIndex;
    for (; i < sql.length && depth > 0; i++) {
      const ch = sql[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    // On a balanced close, `i` sits just past the top-level `)`; the body is between the opening `(` and it.
    if (depth === 0) {
      blocks.push([m[1]!.toLowerCase(), sql.slice(head.lastIndex, i - 1)]);
      // Resume scanning after this table's closing paren so nested `create table` text can't be re-matched.
      head.lastIndex = i;
    }
  }
  return blocks;
}

/** Strip line + trailing comments so a `-- … client_slug …` note never trips the column scan. */
function stripComments(body: string): string {
  return body
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join('\n');
}

function checkIsolationLint(): Finding[] {
  const findings: Finding[] = [];
  let sql = '';
  try {
    sql = readFileSync(BASELINE, 'utf8');
  } catch {
    return [{ gate: 'isolation-lint', message: `ISSUE-008 baseline migration not found at ${BASELINE} — cannot assert the no-client_slug invariant (FR-10.ISO.001)` }];
  }
  const blocks = tableBlocks(sql);
  if (blocks.length === 0) {
    return [{ gate: 'isolation-lint', message: `no create-table blocks parsed from the baseline — the isolation lint cannot run (a silent pass would be a #3 false-clean)` }];
  }
  // logic-sweep fix (index.ts:87): defence-in-depth — if the parser ever captures fewer tables than the raw
  // `create table` count, some table's columns went unscanned. Fail LOUD rather than silently skip them.
  const rawTableCount = (sql.match(/create\s+table\b/gi) ?? []).length;
  if (blocks.length !== rawTableCount) {
    return [{ gate: 'isolation-lint', message: `parsed ${blocks.length} table block(s) but the baseline declares ${rawTableCount} 'create table' statement(s) — the identity scan would miss ${rawTableCount - blocks.length} table('s) columns (a #3 false-clean); fix the parse before trusting the lint` }];
  }
  // (1) NO application table may declare a client-identity column (AC-10.ISO.001.1 / AC-NFR-SEC.001.1).
  for (const [table, rawBody] of blocks) {
    const body = stripComments(rawBody);
    for (const col of IDENTITY_COLUMNS) {
      // A column declaration is `<col> <type> …` at the start of a definition line. Word-boundary match on
      // the identifier so `client_slug` matches but e.g. `client_slug_ref` would too (over-strict = safe).
      const colRe = new RegExp(`(^|,)\\s*${col}\\b`, 'im');
      if (colRe.test(body)) {
        findings.push({
          gate: 'isolation-lint',
          message: `application table '${table}' declares client-identity column '${col}' — FR-10.ISO.001 / ADR-001 §3 forbids ANY client_slug on an app table (#2 isolation breach)`,
        });
      }
    }
  }
  // (2) client_slug may appear only under the management-plane block — the baseline is app-silo-only, so it
  // must not appear as a column at all here. If the file's header note mentions it, that's fine (comments
  // are stripped); a bare column occurrence is the failure, already caught above. Assert the header note
  // actually documents the confinement (identity-home, AC-10.ISO.001.2).
  if (!/client_slug\s+never\s+appears\s+in\s+a\s+silo|management-plane\s+tables|client_registry/i.test(sql)) {
    findings.push({
      gate: 'identity-home',
      message: `the baseline migration does not document that client identity lives only in the management-plane client_registry (AC-10.ISO.001.2) — the confinement must be explicit`,
    });
  }
  return findings;
}

function checkConfigCompleteness(): Finding[] {
  const findings: Finding[] = [];
  // (3) the four retention keys with the right defaults (AC-10.RET.002.1).
  const expected: Record<string, number | boolean> = {
    client_offboarding_retention_days: 90,
    individual_deletion_audit_years: 7,
    data_export_link_expiry_hours: 72,
    deletion_two_person_auth_required: true,
  };
  for (const key of RETENTION_KEYS) {
    if (!(key in expected)) {
      findings.push({ gate: 'config', message: `retention key '${key}' has no expected default in the check set` });
      continue;
    }
    if (RETENTION_DEFAULTS[key] !== expected[key]) {
      findings.push({ gate: 'config', message: `retention default '${key}' = ${String(RETENTION_DEFAULTS[key])}, expected ${String(expected[key])} (AC-10.RET.002.1)` });
    }
  }
  if (RETENTION_KEYS.length !== 4) {
    findings.push({ gate: 'config', message: `expected exactly 4 retention keys (FR-10.RET.002), got ${RETENTION_KEYS.length}` });
  }
  // Each numeric key must carry a legal-minimum floor (AF-136 safeguard); the boolean key must not.
  for (const key of RETENTION_KEYS) {
    const numeric = key !== 'deletion_two_person_auth_required';
    const hasFloor = key in DEFAULT_FLOORS;
    if (numeric && !hasFloor) findings.push({ gate: 'config', message: `numeric key '${key}' has no legal-minimum floor (AC-NFR-CMP.004.1)` });
    if (!numeric && hasFloor) findings.push({ gate: 'config', message: `boolean key '${key}' should not carry a numeric floor` });
  }
  // The infra gate must be the Super-Admin-only node.
  if (INFRA_PERM !== 'PERM-config.infra') {
    findings.push({ gate: 'config', message: `the retention-config edit gate is ${INFRA_PERM}, expected PERM-config.infra (Super Admin only)` });
  }
  // (3b) the v2 residency knob is present as a stub (AC-10.ISO.003.2).
  if (DEPLOYMENT_REGION_KEY !== 'deployment_region') {
    findings.push({ gate: 'config', message: `the v2 residency knob key is '${DEPLOYMENT_REGION_KEY}', expected 'deployment_region' (FR-10.ISO.003)` });
  }
  return findings;
}

function checkResidencyDefault(): Finding[] {
  // (4) the v1 region lock (AC-10.ISO.003.1).
  if (V1_REGION_DEFAULT !== 'ap-southeast-2') {
    return [{ gate: 'residency', message: `v1 region default is '${V1_REGION_DEFAULT}', expected 'ap-southeast-2' (Sydney lock — ADR-001 §Consequences / FR-10.ISO.003)` }];
  }
  return [];
}

function runCheck(): Finding[] {
  const findings = [...checkIsolationLint(), ...checkConfigCompleteness(), ...checkResidencyDefault()];
  if (findings.length === 0) {
    console.log(
      `✓ retention check: no client_slug on any application table (${tableCount()} tables linted) · identity confined to the management-plane registry · 4 retention keys catalogued (90/7/72/true) with legal-minimum floors + PERM-config.infra gate · v1 residency lock ap-southeast-2 · v2 deployment_region stub present.`,
    );
  } else {
    console.error(`✗ retention check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

function tableCount(): number {
  try {
    return tableBlocks(readFileSync(BASELINE, 'utf8')).length;
  } catch {
    return 0;
  }
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

// Exposed for the test suite's isolation-lint AC (so the lint runs against the real baseline offline).
export { checkIsolationLint, tableBlocks, stripComments, IDENTITY_COLUMNS, BASELINE };
