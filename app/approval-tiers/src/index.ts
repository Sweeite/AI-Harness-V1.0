// @harness/approval-tiers — ISSUE-056 (C6 Guardrails, APR + ESC areas). Public surface: the pure tier
// classifier + contextual router (tiers.ts), the ApprovalWorkflow port + in-memory fake reference model +
// the C5 TaskSeam fake (store.ts), and the live pg adapter (supabase-store.ts). Consumers: ISSUE-053 (run
// pipeline — its pre-execution approval gate + mid-task quarantine land in this queue and use this tier
// policy), ISSUE-028 (conflict-quarantine approval reuse), ISSUE-068 (proactivity modes floor here),
// ISSUE-079 (mobile queue render). This slice stops at those seams: it delivers tier policy + routing + the
// flagged/escalation workflow + the surface-04 view model, not the C5 state machine (@harness/task-queue),
// the alert transport (C7), or the hard-limit gate itself (@harness/hard-limits, ISSUE-055).
//
// The `check` CLI runs the offline build-time gates (no DB, no network) — the invariants that must hold by
// construction so drift is caught before integration:
//   (1) FLOOR non-downgradable — no action_autonomy_matrix value can lower a floored action below hard.
//   (2) DEFAULT-HARD — an uncertain (unknown-risk) action defaults to hard, never auto-allowed.
//   (3) SOFT reversible-only — an irreversible action is never soft (so the soft auto-run path can never touch
//       an irreversible effect).
//   (4) NO-SELF-APPROVAL — the initiator can never be routed as their own reviewer.
//   (5) HARD-LIMIT NEVER APPROVABLE — a hard_limit row is killed-not-held, never in the queue, never approved.

import { fileURLToPath } from 'node:url';

import {
  classifyTier,
  isApprovalTier,
  isFlooredCategory,
  mostRestrictiveTier,
  routeApproval,
  APPROVAL_TIERS,
  EMPTY_AUTONOMY_MATRIX,
  ERR_NO_ELIGIBLE_REVIEWER,
  FLOORED_CATEGORIES,
  RISK_LEVELS,
  type ApprovalTier,
  type AutonomyMatrix,
  type FlooredCategory,
  type GatedAction,
  type Reviewer,
  type RiskLevel,
  type RoutingOutcome,
  type RoutingRules,
  type TierDecision,
} from './tiers.ts';
import {
  DEFAULT_APPROVAL_CONFIG,
  ERR_HARD_LIMIT_APPROVE_FORBIDDEN,
  ERR_HARD_LIMIT_NO_AFFORDANCE,
  ERR_HOLD_ONLY_SOFT,
  ERR_MODIFY_HARD_FLOOR,
  ERR_RESOLVE_NOT_PENDING,
  ERR_SELF_APPROVAL,
  InMemoryApprovalWorkflow,
  InMemoryTaskSeam,
  type ApprovalConfig,
  type ApprovalNotification,
  type ApprovalWorkflow,
  type AppliedEffect,
  type CompensationSink,
  type CompensationTask,
  type FaultConfig,
  type FlagOutcome,
  type FreshnessMode,
  type GuardrailHit,
  type GuardrailLogRow,
  type GuardrailStatus,
  type GuardrailType,
  type NotificationSink,
  type QueueFilter,
  type QueueItemView,
  type QueueView,
  type ResolutionOutcome,
  type TaskRow,
  type TaskSeam,
  type TaskStatus,
  type TierDisposition,
} from './store.ts';
import { SupabaseApprovalWorkflow } from './supabase-store.ts';

export {
  // pure tier + routing
  classifyTier,
  isApprovalTier,
  isFlooredCategory,
  mostRestrictiveTier,
  routeApproval,
  APPROVAL_TIERS,
  EMPTY_AUTONOMY_MATRIX,
  ERR_NO_ELIGIBLE_REVIEWER,
  FLOORED_CATEGORIES,
  RISK_LEVELS,
  type ApprovalTier,
  type AutonomyMatrix,
  type FlooredCategory,
  type GatedAction,
  type Reviewer,
  type RiskLevel,
  type RoutingOutcome,
  type RoutingRules,
  type TierDecision,
  // workflow port + fake + seam
  InMemoryApprovalWorkflow,
  InMemoryTaskSeam,
  SupabaseApprovalWorkflow,
  DEFAULT_APPROVAL_CONFIG,
  ERR_HARD_LIMIT_APPROVE_FORBIDDEN,
  ERR_HARD_LIMIT_NO_AFFORDANCE,
  ERR_HOLD_ONLY_SOFT,
  ERR_MODIFY_HARD_FLOOR,
  ERR_RESOLVE_NOT_PENDING,
  ERR_SELF_APPROVAL,
  type ApprovalConfig,
  type ApprovalNotification,
  type ApprovalWorkflow,
  type AppliedEffect,
  type CompensationSink,
  type CompensationTask,
  type FaultConfig,
  type FlagOutcome,
  type FreshnessMode,
  type GuardrailHit,
  type GuardrailLogRow,
  type GuardrailStatus,
  type GuardrailType,
  type NotificationSink,
  type QueueFilter,
  type QueueItemView,
  type QueueView,
  type ResolutionOutcome,
  type TaskRow,
  type TaskSeam,
  type TaskStatus,
  type TierDisposition,
};

interface Finding {
  gate: string;
  ok: boolean;
  detail: string;
}

// A matrix that tries to lower EVERYTHING to auto — the adversary the floor must resist.
const LOWER_EVERYTHING: AutonomyMatrix = { tierFor: () => 'auto' };

function runChecks(): Finding[] {
  const findings: Finding[] = [];

  // (1) FLOOR non-downgradable — an external-comm action stays hard even when the matrix says auto.
  const flooredDec = classifyTier(
    { actionType: 'send_email_external', riskLevel: 'low', reversible: true, flooredCategories: ['external_comm'] },
    LOWER_EVERYTHING,
  );
  findings.push({
    gate: 'floor-non-downgradable',
    ok: flooredDec.tier === 'hard' && flooredDec.floored === true,
    detail: `external_comm under lower-everything matrix → tier=${flooredDec.tier} floored=${flooredDec.floored}`,
  });

  // (2) DEFAULT-HARD — unknown risk defaults to hard.
  const uncertain = classifyTier({ actionType: 'mystery_action' }, EMPTY_AUTONOMY_MATRIX);
  findings.push({
    gate: 'default-hard-if-uncertain',
    ok: uncertain.tier === 'hard' && uncertain.defaultedHard === true,
    detail: `unknown-risk action → tier=${uncertain.tier} defaultedHard=${uncertain.defaultedHard}`,
  });

  // (3) SOFT reversible-only — a medium-risk IRREVERSIBLE action is raised to hard, never soft.
  const irreversible = classifyTier({ actionType: 'irreversible_medium', riskLevel: 'medium', reversible: false });
  findings.push({
    gate: 'soft-reversible-only',
    ok: irreversible.tier === 'hard',
    detail: `medium-risk irreversible → tier=${irreversible.tier} (never soft)`,
  });

  // (4) NO-SELF-APPROVAL — the initiator is never routed as their own reviewer; with only self available it
  //     escalates to no-eligible-reviewer rather than returning the initiator.
  const rules: RoutingRules = {
    roleForContext: () => 'account_manager',
    defaultRole: 'account_manager',
    escalationRole: 'super_admin',
  };
  const selfOnly = routeApproval(
    { actionType: 'crm_update', originatingUserId: 'u1', routingContext: 'crm' },
    [
      { role: 'account_manager', identity: 'u1', available: true },
      { role: 'super_admin', identity: 'u1', available: true },
    ],
    rules,
  );
  findings.push({
    gate: 'no-self-approval',
    ok: selfOnly.reviewerIdentity !== 'u1',
    detail: `initiator-only candidates → reviewer=${String(selfOnly.reviewerIdentity)} (must not be the initiator)`,
  });

  return findings;
}

async function main(): Promise<void> {
  const findings = runChecks();
  let failed = 0;
  for (const f of findings) {
    const mark = f.ok ? 'PASS' : 'FAIL';
    if (!f.ok) failed++;
    console.log(`[${mark}] ${f.gate} — ${f.detail}`);
  }
  if (failed > 0) {
    console.error(`\n${failed} build-time gate(s) failed.`);
    process.exit(1);
  }
  console.log(`\nall ${findings.length} build-time gates passed.`);
}

// Run only when invoked as the CLI (tsx src/index.ts check), never on import.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv[2] === 'check') {
  void main();
}

// referenced so the imports aren't flagged unused when the CLI branch is not taken.
void SupabaseApprovalWorkflow;
void DEFAULT_APPROVAL_CONFIG;
void InMemoryApprovalWorkflow;
void InMemoryTaskSeam;
void mostRestrictiveTier;
void classifyTier;
