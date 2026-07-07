// ISSUE-035 — the C3 WRITE-PATH GATE (FR-3.ACT.001 + FR-3.ACT.002). This is the generic
// write-tool contract, built ONCE in the shared runtime so every connector inherits it (FR-3.CONN.002):
//   (1) the uniform higher-risk write contract — a `write` tool carries risk_level + requires_approval and,
//       when requires_approval=true, routes the *proposed* action to the C6 approval queue BEFORE any
//       external side effect, applying identical gate logic regardless of which connector performs the write
//       (FR-3.ACT.001 / AC-3.ACT.001.1/.2);
//   (2) the connector-grain application of the seven hard limits — every autonomous write is classified by
//       the C6 hard-limit code gate (@harness/hard-limits, ISSUE-055) BEFORE it can reach a consequential
//       external effect; a hit is blocked fail-closed, logged, alerted, with no C3 approve affordance
//       (FR-3.ACT.002 / AC-3.ACT.002.1/.2 / AC-NFR-SEC.004.1 connector-grain portion).
//
// The seam map (deliberate honesty — §8 of the issue):
//   #1 external email          → forced to draft-to-approval by the connector instance (ISSUE-040); this
//                                gate refuses to invoke a raw autonomous `send_message` write.
//   #2 financial / #5 impersonate → NO C3 mechanism — they rest wholly on the C6 code gate + AF-068. This
//                                gate asserts no autonomous C3 write path offers them (classified → blocked).
//   #3 record delete           → *partly* pre-empted at the scope grant (AC-3.CONN.005.3, ISSUE-032:
//                                DELETE_GRANTING_SCOPES) + gated at C6.
//   #4 cross-client share      → physically impossible (ADR-001) — no C3 table carries a client id, no write
//                                path can address another deployment; asserted here.
//   #6 self-approve            → barred by construction: requires_approval is read from the REGISTRY ROW, never
//                                from tool args / instruction / config; a queued write cannot self-resolve.
//   #7 tool-content-as-instructions → defused by the boundary tag (FR-3.CONN.003, ISSUE-032) on reads +
//                                classified here if a write's intent originates from monitored-tool content.
//
// EVERYTHING is deterministic (caller-supplied `now` epoch-seconds; no Date.now()/random — house discipline).
//
// FAKE-vs-LIVE discipline: this module carries NO DB code. It composes the two sibling ports
// (ConnectorRuntimeStore/ToolRuntime from @harness/connector-runtime, HardLimitGate from @harness/hard-limits)
// and an injected ApprovalQueue seam. The live silo behaviour is entirely the two siblings' pg adapters plus
// ISSUE-056's queue; a store.ts fake ApprovalQueue mirrors that seam so tests cannot pass offline while the
// live wiring would diverge.

// Import the pg-free submodules directly (NOT each sibling's index.ts, which re-exports its live pg adapter
// and would drag `pg` resolution into a directory with no node_modules). We only ever need the types, the
// pure classifier, and the in-memory fakes — never the siblings' live adapters.
import type { ToolRow } from '../../connector-runtime/src/store.ts';
import type { ToolRuntime, WriteObserver } from '../../connector-runtime/src/runtime.ts';
import type { ActionAttempt } from '../../hard-limits/src/limits.ts';
import type { AlertSink, EnforcementOutcome, HardLimitGate } from '../../hard-limits/src/store.ts';
import type { ApprovalQueue, ApprovalDecision, WriteProposal } from './store.ts';

/** Raised when a write is asked to run but its intended action trips one of the seven hard limits. The
 *  block is FINAL — it is never converted to an approval route (a hard limit has no approve affordance). */
export class HardLimitBlockedError extends Error {
  constructor(
    public readonly outcome: EnforcementOutcome,
    message: string,
  ) {
    super(message);
    this.name = 'HardLimitBlockedError';
  }
}

/** Raised when a caller tries to relax the approval requirement from anywhere other than the registry row
 *  (a tool arg, an instruction, a config snapshot). The gate reads requires_approval from the ROW only. */
export class ApprovalOverrideRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalOverrideRejected';
  }
}

/** The intended real-world effect of a write tool, in the shape the hard-limit classifier consumes. A write
 *  tool declares its effect kind so the connector-grain gate can classify it BEFORE any external call. The
 *  classifier fields (autonomous, recipientExternal, source/targetClient, fromMonitoredTool …) map straight
 *  onto @harness/hard-limits ActionAttempt — this is the wiring of the seven limits at the connector grain. */
export type WriteIntent = ActionAttempt;

/** The result of routing/executing a write through the gate. Exactly one of {queued, executed} is populated;
 *  a hard-limit hit throws HardLimitBlockedError (never returns) so a blocked write can never be mistaken for
 *  a queued or executed one (#2 — fail loud, never fall through). */
export interface WriteGateResult {
  /** the write was routed to the approval queue and NO external effect occurred (requires_approval=true). */
  queued?: { proposalId: string; proposal: WriteProposal };
  /** the write executed (requires_approval=false, or post-approval) — idempotently via the runtime. */
  executed?: { result: unknown; suppressed: boolean };
}

export interface WriteGateDeps {
  /** the ISSUE-032 shared runtime — the ONLY thing that performs the external write (idempotently). */
  runtime: ToolRuntime;
  /** the ISSUE-055 hard-limit code gate — classifies + enforces the seven before any external effect. */
  hardLimits: HardLimitGate;
  /** the C6 approval-queue seam (ISSUE-056) — receives a proposed write; this slice does NOT build the queue. */
  approvals: ApprovalQueue;
  /** the C7 alert sink the hard-limit gate emits a hit to (ISSUE-011/075). */
  alerts: AlertSink;
}

/**
 * The uniform write-path gate. One code path, applied identically to every connector's write tools
 * (FR-3.ACT.001 AC.2 — connector-agnostic). The order is load-bearing:
 *
 *   1. HARD-LIMIT CLASSIFY (connector-grain, FR-3.ACT.002) — the intended effect is classified by the C6
 *      code gate. A hit is blocked/logged/alerted and THROWS: no external effect, no queue route, no approve.
 *      This runs FIRST so a hard-limited effect can never even reach the approval queue (#2).
 *   2. APPROVAL ROUTE (FR-3.ACT.001) — requires_approval is read from the REGISTRY ROW (never from args /
 *      instruction / config). If true, the proposed write is emitted to the C6 queue and NO external side
 *      effect occurs; the gate returns {queued}. Execution happens later, only on an approval decision.
 *   3. EXECUTE — requires_approval=false (or a returning approval) → the runtime performs the write once,
 *      idempotently (FR-3.CONN.004 via the idempotency_ledger). The runtime is the only writer.
 */
export class WriteGate {
  constructor(private readonly deps: WriteGateDeps) {}

  /** The single entry point for a write tool. `intent` is the intended real-world effect (classified by the
   *  seven-limit gate); `args` are the connector call arguments (idempotency-keyed by the runtime). */
  async invoke(
    tool: ToolRow,
    intent: WriteIntent,
    args: Record<string, unknown>,
    now: number,
    observer?: WriteObserver,
  ): Promise<WriteGateResult> {
    if (tool.category !== 'write') {
      // Dispatch by category — a read must never traverse the write path (FR-3.CONN.001).
      throw new Error(
        `WriteGate.invoke called on a '${tool.category}' tool '${tool.name}' — the write gate is for category=write only (FR-3.CONN.001)`,
      );
    }

    // ── Step 1: connector-grain hard-limit gate (FR-3.ACT.002 / AC-3.ACT.002.1/.2 / AC-NFR-SEC.004.1). ──
    // Classify+enforce BEFORE any external effect and BEFORE the approval route. A hit is FINAL: blocked,
    // logged to guardrail_log(type='hard_limit'), alerted — and thrown, never routed to approval (there is
    // deliberately no approve affordance for a hard-limit hit — AC-NFR-SEC.004.1).
    const outcome = await this.deps.hardLimits.enforce(intent, this.deps.alerts, now, tool.name);
    if (outcome.blocked) {
      throw new HardLimitBlockedError(
        outcome,
        `write tool '${tool.name}' blocked by hard limit '${outcome.decision.limit}': ${outcome.decision.reason} ` +
          `— blocked at the code layer, no approve path (FR-3.ACT.002 / AC-NFR-SEC.004.1)`,
      );
    }

    // ── Step 2: approval route (FR-3.ACT.001 / AC-3.ACT.001.1/.2). ──
    // requires_approval is read from the REGISTRY ROW. It is NEVER taken from a tool arg, an instruction, or
    // a config snapshot — that would let prompt content self-clear the gate (hard-limit #6 self-approve /
    // ADR-007: gating is code, not instruction). Guard against a caller smuggling an override in args.
    this.assertNoApprovalOverrideInArgs(tool, args);

    if (tool.requires_approval === true) {
      // Route the PROPOSED action into the C6 queue. NO external side effect happens now. Execution is
      // deferred to executeApproved(), invoked only when an approval decision returns (ISSUE-056 owns the
      // queue + the decision; this slice only routes into it and executes on approval).
      const proposal: WriteProposal = {
        toolId: tool.id,
        toolName: tool.name,
        connector: tool.connector,
        riskLevel: tool.risk_level,
        args,
        proposedAt: now,
      };
      const proposalId = await this.deps.approvals.enqueue(proposal, now);
      return { queued: { proposalId, proposal } };
    }

    // ── Step 3: auto-execute (requires_approval=false). Idempotent, via the runtime (the only writer). ──
    const exec = await this.deps.runtime.invokeWrite(tool, args, now, observer);
    return { executed: exec };
  }

  /**
   * Execute a previously-queued write once its approval decision returns. Only an `approved` decision
   * executes; a `rejected`/`modified` decision NEVER performs the external effect (fail-closed — a
   * non-approval is a non-execution). The hard-limit gate is re-run at execution time so a change of intent
   * between propose and approve cannot slip a hard-limited effect through (#2 — the gate is not cached).
   *
   * ⚠️ SEAM CONTRACT ([[OD-196]] — no-self-approval defense-in-depth). The `decision` passed here MUST be a
   * decision PRODUCED BY the approval queue's `decide()` — the single place the no-self-approval invariant is
   * enforced (`SelfApprovalRejected` when `decidedBy === AGENT_PROPOSER_ACTOR`, hard-limit #6 / AC-6.APR.005.3).
   * `executeApproved` deliberately trusts that upstream decision and does NOT independently re-fetch the
   * proposal or re-authorise `decidedBy` — it is DOWNSTREAM of an already-validated decision. A caller must
   * therefore never hand-forge an `{status:'approved', decidedBy:AGENT_PROPOSER_ACTOR}` object and call this
   * directly, bypassing `decide()`; doing so would self-approve + execute the agent's own queued write (#2/#6).
   * The real caller (ISSUE-056's approval-queue surface) is UNBUILT; when it is built, fold the belt-and-
   * suspenders hardening (take a proposalId, re-read the stored proposal, require pending + a distinct-human
   * approver before executing) into that wiring — OD-196 Option A, deferred here because no live caller exists.
   */
  async executeApproved(
    tool: ToolRow,
    intent: WriteIntent,
    args: Record<string, unknown>,
    decision: ApprovalDecision,
    now: number,
    observer?: WriteObserver,
  ): Promise<WriteGateResult> {
    if (decision.status !== 'approved') {
      // A rejected/modified/pending decision does NOT execute. The proposal is dropped, not run (#2).
      return {};
    }
    // Re-classify at execution — never trust a stale propose-time decision to still be safe.
    const outcome = await this.deps.hardLimits.enforce(intent, this.deps.alerts, now, tool.name);
    if (outcome.blocked) {
      throw new HardLimitBlockedError(
        outcome,
        `approved write '${tool.name}' re-blocked by hard limit '${outcome.decision.limit}' at execution ` +
          `(the gate is re-checked, never cached) — ${outcome.decision.reason}`,
      );
    }
    const exec = await this.deps.runtime.invokeWrite(tool, args, now, observer);
    return { executed: exec };
  }

  /**
   * The requested-scope set for a connector's write tools must grant NO destructive delete-of-record scope —
   * the cheapest gate for hard-limit #3, enforced at the grant itself (AC-3.CONN.005.3, ISSUE-032). This
   * re-asserts it for this slice's write tools: it delegates to the runtime, which throws a
   * ScopeViolationError if any DELETE_GRANTING_SCOPE is present.
   */
  requestedWriteScopes(connector: string): string[] {
    return this.deps.runtime.requestedScopes(connector, { includeWrites: true });
  }

  /**
   * Gate-don't-promote (FR-3.ACT.002 note / NFR-SEC.005 / AC-NFR-SEC.005.1). A NEW dangerous write capability
   * that is not one of the seven is routed to hard-approval + a rate cap — never silently auto-allowed and
   * never promoted to an eighth hard limit (the set of seven is change-control, OD-047). Delegates to the C6
   * coverage-gap governance (ISSUE-055).
   */
  routeNewCapability(capability: string) {
    return this.deps.hardLimits.classifyNewCapability(capability);
  }

  // ── non-overridability guard (FR-3.ACT.002 / NFR-SEC.004) ──
  // requires_approval lives ONLY on the registry row. If a caller tries to pass a relaxing key in the write
  // args (e.g. requires_approval:false, skip_approval:true, auto_approve:true, hard_limits_enabled:false),
  // reject it — the gate must never consult model/tool output to weaken itself. This is the connector-grain
  // half of "gating is code, not instruction" (ADR-007).
  private assertNoApprovalOverrideInArgs(tool: ToolRow, args: Record<string, unknown>): void {
    const banned = [
      'requires_approval',
      'skip_approval',
      'auto_approve',
      'bypass_approval',
      'hard_limits_enabled',
      'override_hard_limit',
      'disable_gate',
    ];
    for (const key of banned) {
      if (Object.prototype.hasOwnProperty.call(args, key)) {
        throw new ApprovalOverrideRejected(
          `write tool '${tool.name}': arg '${key}' cannot relax the approval/hard-limit gate — ` +
            `requires_approval is read from the registry row only, never from tool args/instruction/config ` +
            `(FR-3.ACT.002 / ADR-007: gating is code, not instruction)`,
        );
      }
    }
  }
}
