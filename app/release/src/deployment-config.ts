// ISSUE-080 §8 step 2 — DEPLOYMENT_CONFIG: the branch-to-environment mapping and the deploy-primitive
// contract (FR-10.DEP.001). Non-secret. This CODIFIES the intent that the live Railway wiring realises;
// the live push→auto-deploy+migrate proof is the two-party capstone (§9 integration), and the actual
// Railway env/branch/Wait-for-CI settings live in the Railway control plane, not here.
//
// The primitive (ADR-005 §1 / ADR-001 §6, railway.md §7):
//   • Each client's Railway project NATIVELY tracks + auto-deploys its branch — no custom fan-out CI
//     pushing code into N accounts (ruled out, ADR-001 §6). N independent Railway subscriptions.
//   • The canary environment tracks `release`; every fleet (client) environment tracks `main`.
//   • On release, the deployment runs the schema migration against ITS OWN Supabase, via the app/silo
//     `pg` runner playing the drizzle-kit-migrate role (OD-176), wired as Railway's Pre-Deploy Command
//     so a failed migration BLOCKS that deploy (railway.md F11 caveat — the #3 fail-loud property).
//   • GitHub Actions is a MERGE GATE ONLY (runs the test suite; never deploys) — .github/workflows/ci.yml.

/** The two release environments. The canary proves a build before the fleet ever sees it. */
export type ReleaseEnvironment = "canary" | "fleet";

/** The git branch each environment's Railway service natively tracks + auto-deploys. */
export const DEPLOYMENT_CONFIG: Record<ReleaseEnvironment, { tracksBranch: string; note: string }> = {
  canary: {
    tracksBranch: "release",
    note: "The canary Railway environment auto-deploys `release`; the promotion gate runs here before the fleet.",
  },
  fleet: {
    tracksBranch: "main",
    note: "Every client (fleet) Railway environment natively auto-deploys `main`; each migrates its own Supabase independently.",
  },
} as const;

/** The branch a given environment tracks (throws on an unknown environment — never guess). */
export function branchFor(env: ReleaseEnvironment): string {
  const entry = DEPLOYMENT_CONFIG[env];
  if (!entry) throw new Error(`unknown release environment '${env}'`);
  return entry.tracksBranch;
}

/**
 * The deploy-primitive invariant (AC-10.DEP.001.2): GitHub Actions gates merges via the test suite and
 * does NOT deploy; Railway (native per-project tracking) is the ONLY deployer. A CI config that both
 * runs tests AND performs a deploy step violates the primitive and must fail this assertion.
 *
 * `ciJobKinds` is the set of job kinds a CI workflow declares. The primitive holds iff it contains at
 * least a test/gate job and NO deploy job.
 */
export type CiJobKind = "test" | "typecheck" | "lint" | "gate" | "deploy" | "release" | "publish";
const DEPLOYER_KINDS: ReadonlySet<CiJobKind> = new Set<CiJobKind>(["deploy", "release", "publish"]);

export interface PrimitiveVerdict {
  ok: boolean;
  reason: string;
}

export function assertActionsGatesNeverDeploys(ciJobKinds: readonly CiJobKind[]): PrimitiveVerdict {
  const deployers = ciJobKinds.filter((k) => DEPLOYER_KINDS.has(k));
  if (deployers.length > 0) {
    return {
      ok: false,
      reason: `GitHub Actions must gate merges, never deploy — found deployer job(s): ${deployers.join(", ")} (AC-10.DEP.001.2 / ADR-001 §6)`,
    };
  }
  const gates = ciJobKinds.filter((k) => k === "test" || k === "typecheck" || k === "lint" || k === "gate");
  if (gates.length === 0) {
    return { ok: false, reason: "CI declares no test/gate job — it is not a merge gate (AC-10.DEP.001.2)" };
  }
  return { ok: true, reason: "Actions gates merges via the test suite and does not deploy (AC-10.DEP.001.2)" };
}
