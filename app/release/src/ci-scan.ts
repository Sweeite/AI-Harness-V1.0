// ISSUE-080 — derive the CI job kinds from a GitHub Actions workflow's raw text, so the deploy-primitive
// invariant (AC-10.DEP.001.2 — Actions gates merges, never deploys) can be asserted against the REAL
// workflow file, not just a hand-passed list. Heuristic text scan (no YAML dep): it maps observed tokens
// to CiJobKind. Conservative — an unrecognised deployer token still trips assertActionsGatesNeverDeploys
// via the raw deployer-indicator scan below.

import type { CiJobKind } from "./deployment-config.js";

// Tokens that indicate a DEPLOY step in a workflow — their presence means Actions is deploying (forbidden).
const DEPLOYER_INDICATORS: RegExp[] = [
  /\brailway\s+up\b/i,
  /\brailway\s+redeploy\b/i,
  /\brailway\s+deploy\b/i,
  /\bnpm\s+publish\b/i,
  /\bserviceInstanceDeploy\b/i,
  /uses:\s*\S*railway\S*deploy/i,
];

const GATE_INDICATORS: { re: RegExp; kind: CiJobKind }[] = [
  { re: /\bnpm\s+(run\s+)?test\b|\bnpm\s+test\b|tsx\s+--test|--test\b/i, kind: "test" },
  { re: /\b(typecheck|tsc\s+--noEmit)\b/i, kind: "typecheck" },
  { re: /\b(eslint|npm\s+run\s+lint|\blint\b)\b/i, kind: "lint" },
];

/** Extract the declared job kinds from a workflow's raw YAML text (heuristic). */
export function deriveJobKindsFromWorkflow(raw: string): CiJobKind[] {
  const kinds = new Set<CiJobKind>();
  for (const { re, kind } of GATE_INDICATORS) if (re.test(raw)) kinds.add(kind);
  for (const re of DEPLOYER_INDICATORS) {
    if (re.test(raw)) {
      kinds.add("deploy");
      break;
    }
  }
  return [...kinds];
}
