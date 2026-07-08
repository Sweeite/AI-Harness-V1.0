// ISSUE-086 — @harness/config-surfaces public surface + the `check` command. `check` is a no-DB, CI-safe
// non-drift guard enforcing the invariants that keep the two config surfaces honest against their sources:
//
//   (1) registry PARITY (both directions) — every key the surface renders exists in config-registry.md with
//       the class the surface claims; AND every editable (class-bearing) registry key is rendered by the
//       surface. A registry knob the surface silently does NOT render is a #1/#3 defect (a knob invisible to
//       the only screen that can edit it); a surface key with the wrong class would show the wrong
//       dialog/badge. This is the config analog of the config-store keygroup `check`.
//   (2) PERM-node existence — every PERM node the surfaces gate on exists in PERMISSION_NODES.md (a gate on a
//       phantom node is a build-time #3).
//
// Run: `tsx src/index.ts check`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { KEY_CATALOG } from './keys.ts';
import { SECTIONS, DOWNLOAD_RECORDS_PERM } from './sections.ts';

// ── public exports ──────────────────────────────────────────────────────────────────────────────────
export * from './sections.ts';
export * from './keys.ts';
export * from './redaction.ts';
export * from './secrets.ts';
export * from './validation.ts';
export * from './save.ts';
export * from './states.ts';
export * from './audit-view.ts';
export * from './banners.ts';
export * from './a11y.ts';
export * from './store.ts';
export { SupabaseConfigSurfaceStore } from './supabase-store.ts';

// ── check ─────────────────────────────────────────────────────────────────────────────────────────────
const REGISTRY = 'spec/02-config/config-registry.md';
const PERMISSION_NODES = 'PERMISSION_NODES.md';
const CLASS_TOKENS = new Set(['LIVE', 'BOOT', 'REBUILD']);

interface Finding {
  gate: string;
  message: string;
}

function repoRoot(): string {
  // src → config-surfaces → app → repo root
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/** Parse config-registry.md §A–N tables → key → declared class (only rows that carry a LIVE/BOOT/REBUILD cell,
 *  which excludes the group-N secret rows, that have a Required column and no class). */
function registryClasses(): Map<string, string> {
  const md = readFileSync(join(repoRoot(), REGISTRY), 'utf8');
  const out = new Map<string, string>();
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (!m) continue;
    const key = m[1]!;
    const cells = line.split('|').map((c) => c.trim().replace(/\*\*/g, ''));
    const classCell = cells.find((c) => CLASS_TOKENS.has(c));
    if (classCell) out.set(key, classCell);
  }
  return out;
}

/** Every `PERM-x.y` node id defined in PERMISSION_NODES.md. */
function definedNodes(): Set<string> {
  const md = readFileSync(join(repoRoot(), PERMISSION_NODES), 'utf8');
  return new Set([...md.matchAll(/`(PERM-[a-z_]+\.[a-z_]+)`/g)].map((m) => m[1]!));
}

export function runCheck(): Finding[] {
  const findings: Finding[] = [];

  // (1) registry parity.
  let registry: Map<string, string>;
  try {
    registry = registryClasses();
  } catch (e) {
    findings.push({ gate: 'registry', message: `could not read ${REGISTRY}: ${(e as Error).message}` });
    registry = new Map();
  }
  if (registry.size > 0) {
    const catalogKeys = new Set(KEY_CATALOG.map((k) => k.key));
    // forward: every catalog key exists in the registry with the claimed class.
    for (const spec of KEY_CATALOG) {
      const regClass = registry.get(spec.key);
      if (regClass === undefined) {
        findings.push({ gate: 'registry', message: `surface renders '${spec.key}' but it is ABSENT from ${REGISTRY} (a knob with no registry source — Rule 0).` });
      } else if (regClass !== spec.editClass) {
        findings.push({ gate: 'registry', message: `class drift: surface says '${spec.key}' is ${spec.editClass} but the registry says ${regClass} (wrong dialog/badge would render).` });
      }
    }
    // reverse: every editable registry key is rendered by the surface (a new knob must not be invisible).
    for (const [key] of registry) {
      if (!catalogKeys.has(key)) {
        findings.push({ gate: 'registry', message: `registry key '${key}' is editable but the surface does NOT render it — it would be invisible on the only screen that can edit it (#1/#3).` });
      }
    }
  }

  // (2) PERM-node existence — every node the surfaces gate on is catalogued.
  let defined: Set<string>;
  try {
    defined = definedNodes();
  } catch (e) {
    findings.push({ gate: 'perm-nodes', message: `could not read ${PERMISSION_NODES}: ${(e as Error).message}` });
    defined = new Set();
  }
  if (defined.size > 0) {
    const gated = new Set<string>([...SECTIONS.map((s) => s.node), DOWNLOAD_RECORDS_PERM]);
    for (const node of gated) {
      if (!defined.has(node)) {
        findings.push({ gate: 'perm-nodes', message: `surface gates on '${node}' but it is ABSENT from ${PERMISSION_NODES} (a gate on a phantom node — #3).` });
      }
    }
  }

  if (findings.length === 0) {
    console.log(
      `✓ config-surfaces check: all ${KEY_CATALOG.length} surface keys present in ${REGISTRY} with matching class; ` +
        `every editable registry key is rendered (no drift); all ${SECTIONS.length} section nodes + the export node present in ${PERMISSION_NODES}.`,
    );
  } else {
    console.error(`✗ config-surfaces check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

function main(): void {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
