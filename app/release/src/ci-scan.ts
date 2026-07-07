// ISSUE-080 — derive the CI job kinds from a GitHub Actions workflow's raw text, so the deploy-primitive
// invariant (AC-10.DEP.001.2 — Actions gates merges, never deploys) can be asserted against the REAL
// workflow file, not just a hand-passed list. Heuristic text scan (no YAML dep): it maps observed tokens
// to CiJobKind. The deployer scan below covers both the known Railway/npm-publish patterns AND a generic
// deploy-verb catch (flyctl/vercel/netlify/gh + any `run: … deploy` / `uses: …deploy-action`), so a
// workflow that deploys via an unrecognised mechanism still trips assertActionsGatesNeverDeploys rather
// than being waved through.

import type { CiJobKind } from "./deployment-config.js";

// Tokens that indicate a DEPLOY step in a workflow — their presence means Actions is deploying (forbidden).
// logic-sweep fix (ci-scan.ts DEPLOYER_INDICATORS): the header once claimed a "raw deployer-indicator scan"
// backstop that did not exist — the list was a fixed six-pattern Railway/npm whitelist, so a non-Railway
// deployer (flyctl/vercel/netlify/a deploy-action/a raw `deploy` command) produced NO "deploy" kind and
// passed the "Actions never deploys" invariant (#2 hole). Added generic deploy-command / deploy-action
// catches. These are scoped to STEP contexts (`run:` commands, `uses:` action refs) so they do NOT match
// the word "deploy" appearing in comments/branch names/the workflow `name:` (which the real ci.yml has).
const DEPLOYER_INDICATORS: RegExp[] = [
  /\brailway\s+up\b/i,
  /\brailway\s+redeploy\b/i,
  /\brailway\s+deploy\b/i,
  /\bnpm\s+publish\b/i,
  /\bserviceInstanceDeploy\b/i,
  /uses:\s*\S*railway\S*deploy/i,
  // Generic deploy commands run as a step (flyctl/vercel/netlify/gh + a bare `<tool> deploy` verb).
  /\brun:\s*\S*\b(flyctl|vercel|netlify|wrangler|gcloud|kubectl|serverless|sls|gh)\b.*\bdeploy\b/i,
  /\brun:\s*\S+\s+deploy\b/i,
  /\brun:\s*(vercel|netlify)\b.*(--prod|deploy)/i,
  // Any action reference whose name contains "deploy" (e.g. some-org/deploy-action@v1).
  /\buses:\s*\S*deploy\S*/i,
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
