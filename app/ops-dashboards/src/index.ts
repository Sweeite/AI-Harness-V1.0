// ISSUE-078 — @harness/ops-dashboards public surface + the `check` command. `check` is a no-DB, CI-safe
// non-drift guard over the catalog, enforcing two build-time invariants:
//
//   (1) PERM-node existence — every PERM node the panel/section catalog GATES ON must exist in
//       PERMISSION_NODES.md (the C1 catalog, FR-1.PERM.005). A gate on a node that isn't in the catalog is a
//       build-time #3 defect (the surface would deny/allow against a phantom node) — the PERMISSION_NODES.md
//       rule. This is the same shape as the rls-enforcement enum-drift check, against the node catalog.
//   (2) producing-FR completeness — every panel/section maps to at least one producing FR (AC-7.VIEW.001.1:
//       "no panel sources a signal C7 invents"). An item with no producingFR would render a signal with no
//       owner — caught here.
//
// Run: `tsx src/index.ts check`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OPS_PANELS, FLEET_SECTIONS, referencedNodes } from "./catalog.ts";

// ── public exports ──────────────────────────────────────────────────────────────────────────────────
export * from "./catalog.ts";
export * from "./rbac.ts";
export * from "./freshness.ts";
export * from "./panel-state.ts";
export * from "./fleet.ts";
export * from "./offboarding.ts";
export * from "./store.ts";
export { SupabaseOpsDashboardStore } from "./supabase-store.ts";

// ── check ─────────────────────────────────────────────────────────────────────────────────────────────
const PERMISSION_NODES = "PERMISSION_NODES.md";

/** Extract every `PERM-x.y` node id defined in PERMISSION_NODES.md (repo root). */
function catalogNodeIds(): Set<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  // src → ops-dashboards → app → repo root
  const path = join(here, "..", "..", "..", PERMISSION_NODES);
  const md = readFileSync(path, "utf8");
  return new Set([...md.matchAll(/`(PERM-[a-z_]+\.[a-z_]+)`/g)].map((m) => m[1]!));
}

interface Finding {
  gate: string;
  message: string;
}

export function runCheck(): Finding[] {
  const findings: Finding[] = [];

  // (1) every gated node exists in the C1 catalog.
  let defined: Set<string>;
  try {
    defined = catalogNodeIds();
  } catch (e) {
    findings.push({ gate: "perm-nodes", message: `could not read ${PERMISSION_NODES}: ${(e as Error).message}` });
    defined = new Set();
  }
  if (defined.size > 0) {
    for (const node of referencedNodes()) {
      if (!defined.has(node)) {
        findings.push({
          gate: "perm-nodes",
          message: `catalog gates on '${node}' but it is ABSENT from ${PERMISSION_NODES} (a gate on a phantom node — #3). Add it to the C1 catalog or fix the constant.`,
        });
      }
    }
  }

  // (2) every panel/section maps to a producing FR (AC-7.VIEW.001.1).
  for (const item of [...OPS_PANELS, ...FLEET_SECTIONS]) {
    if (item.producingFR.length === 0) {
      findings.push({
        gate: "producing-fr",
        message: `item '${item.id}' has no producingFR — it would render a signal C7 invents (AC-7.VIEW.001.1).`,
      });
    }
    // surface-05 panels must name a poll cadence (AC-7.RTP.002.1); fleet sections need not.
    if (OPS_PANELS.includes(item as (typeof OPS_PANELS)[number]) && !item.cadence) {
      findings.push({
        gate: "cadence",
        message: `ops panel '${item.id}' names no poll cadence config key (AC-7.RTP.002.1).`,
      });
    }
  }

  if (findings.length === 0) {
    console.log(
      `✓ ops-dashboards check: all ${referencedNodes().size} gated PERM nodes present in ${PERMISSION_NODES}; ` +
        `all ${OPS_PANELS.length + FLEET_SECTIONS.length} panels/sections map to a producing FR; every ops panel names a poll cadence (no drift).`,
    );
  } else {
    console.error(`✗ ops-dashboards check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

function main(): void {
  const cmd = process.argv[2] ?? "check";
  if (cmd === "check") {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
