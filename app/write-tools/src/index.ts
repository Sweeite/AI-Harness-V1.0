// @harness/write-tools — ISSUE-035 (C3 ACT: write tools + the seven hard limits at the connector grain).
// Public surface: the WriteGate (the uniform write-path gate that routes to the C6 approval queue before any
// external effect + wires the seven hard limits at the connector grain), the ApprovalQueue port + in-memory
// fake reference model + the live pg adapter.
//
// Composition (this slice builds NO new machinery — it wires two siblings + an injected queue seam):
//   - @harness/connector-runtime (ISSUE-032) — the ToolRuntime that performs the idempotent external write +
//     the requestedScopes / DELETE_GRANTING_SCOPES that pre-empt hard limit #3 at the grant.
//   - @harness/hard-limits (ISSUE-055) — the HardLimitGate that classifies+enforces the seven, fail-closed,
//     un-overridable, no approve affordance; carries the AF-068 gate (GREEN via ISSUE-003/055).
//   - ApprovalQueue (this package) — the C6 queue seam (ISSUE-056 owns the queue itself).
//
// This slice stops at those seams: it declares + applies the limits at the connector grain and routes a
// proposed write into the queue. It does NOT own the C6 code gate (that IS @harness/hard-limits), the queue
// surface (ISSUE-056), or the per-connector write tools (ISSUE-039/040/041).
//
// The `check` CLI runs the offline build-time invariants (no DB, no network) so drift is caught pre-integration:
//   (1) a requires_approval=true write ROUTES and performs NO external effect (AC-3.ACT.001.1).
//   (2) a hard-limited autonomous write is BLOCKED at the gate — never queued, never executed (AC-3.ACT.002.1).
//   (3) an arg crafted to relax the gate is REJECTED (AC-3.ACT.002.2 / non-overridable).
//   (4) a delete-granting write scope is REFUSED at the grant (AC-3.CONN.005.3).

// Import the pg-free submodules directly (see write-gate.ts note) — the fakes + types only.
import { InMemoryConnectorRuntimeStore, type ToolRow } from '../../connector-runtime/src/store.ts';
import { ToolRuntime, type ConnectorParams, type ExternalIO } from '../../connector-runtime/src/runtime.ts';
import { InMemoryHardLimitGate } from '../../hard-limits/src/store.ts';
import type { AlertSink } from '../../hard-limits/src/store.ts';
import {
  ApprovalOverrideRejected,
  HardLimitBlockedError,
  WriteGate,
  type WriteGateDeps,
  type WriteGateResult,
  type WriteIntent,
} from './write-gate.ts';
import {
  AGENT_PROPOSER_ACTOR,
  InMemoryApprovalQueue,
  SelfApprovalRejected,
  type ApprovalDecision,
  type ApprovalQueue,
  type ApprovalStatus,
  type QueuedProposal,
  type WriteProposal,
} from './store.ts';
import { SupabaseApprovalQueue } from './supabase-store.ts';

export {
  WriteGate,
  HardLimitBlockedError,
  ApprovalOverrideRejected,
  type WriteGateDeps,
  type WriteGateResult,
  type WriteIntent,
};
export {
  InMemoryApprovalQueue,
  SupabaseApprovalQueue,
  SelfApprovalRejected,
  AGENT_PROPOSER_ACTOR,
  type ApprovalQueue,
  type ApprovalDecision,
  type ApprovalStatus,
  type QueuedProposal,
  type WriteProposal,
};

// ── build-time gates (offline; no DB) ──────────────────────────────────────────────────────────────────
const NULL_SINK: AlertSink = { emit: async () => {} };

function testTool(over: Partial<ToolRow> = {}): ToolRow {
  return {
    id: 'tool-0001',
    name: 'ghl.contact.upsert',
    description: 'create-or-update a CRM contact',
    category: 'write',
    risk_level: 'medium',
    requires_approval: true,
    connector: 'ghl',
    scopes: ['contacts.write'],
    config: {},
    enabled: true,
    version: 1,
    previous_version_id: null,
    change_reason: 'initial',
    created_at: '2023-11-14T22:13:20.000Z',
    updated_at: '2023-11-14T22:13:20.000Z',
    ...over,
  };
}

function harness() {
  const store = new InMemoryConnectorRuntimeStore();
  const externalWrites: string[] = [];
  const io: ExternalIO = {
    read: async () => ({ source: 'x', content: 'y' }),
    write: async (name) => {
      externalWrites.push(name);
      return { ok: true };
    },
  };
  const ghl: ConnectorParams = {
    connector: 'ghl',
    readScopes: ['contacts.readonly'],
    writeScopes: ['contacts.write'],
    deriveIdempotencyKey: (t, a) => `${t}:${JSON.stringify(a)}`,
  };
  const runtime = new ToolRuntime({ store, params: { ghl }, io, logFailure: () => {} });
  const hardLimits = new InMemoryHardLimitGate();
  const approvals = new InMemoryApprovalQueue();
  const deps: WriteGateDeps = { runtime, hardLimits, approvals, alerts: NULL_SINK };
  return { gate: new WriteGate(deps), approvals, externalWrites };
}

interface Finding {
  gate: string;
  ok: boolean;
  detail: string;
}

async function runChecks(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const NOW = 1_700_000_000;
  // A benign write intent (internal, non-hard-limited) — a CRM upsert is not one of the seven.
  const benign: WriteIntent = { kind: 'noop', autonomous: true };

  // (1) requires_approval=true routes to the queue and performs NO external effect.
  {
    const h = harness();
    const res = await h.gate.invoke(testTool({ requires_approval: true }), benign, { email: 'a@b.com' }, NOW);
    const q = res.queued ? await h.approvals.get(res.queued.proposalId) : null;
    findings.push({
      gate: 'routes-before-effect',
      ok: !!res.queued && !res.executed && h.externalWrites.length === 0 && q?.externalEffectPerformed === false,
      detail: `queued=${!!res.queued} executed=${!!res.executed} externalWrites=${h.externalWrites.length}`,
    });
  }

  // (2) a hard-limited autonomous write is blocked — never queued, never executed.
  {
    const h = harness();
    const email: WriteIntent = { kind: 'send_message', autonomous: true, recipientExternal: true, target: 'ceo@x.com' };
    let blocked = false;
    try {
      await h.gate.invoke(testTool({ requires_approval: false }), email, {}, NOW);
    } catch (e) {
      blocked = e instanceof HardLimitBlockedError;
    }
    findings.push({
      gate: 'hard-limit-blocks',
      ok: blocked && h.approvals.proposals.size === 0 && h.externalWrites.length === 0,
      detail: `blocked=${blocked} queued=${h.approvals.proposals.size} externalWrites=${h.externalWrites.length}`,
    });
  }

  // (3) an arg crafted to relax the gate is rejected.
  {
    const h = harness();
    let rejected = false;
    try {
      await h.gate.invoke(testTool({ requires_approval: true }), benign, { requires_approval: false }, NOW);
    } catch (e) {
      rejected = e instanceof ApprovalOverrideRejected;
    }
    findings.push({ gate: 'non-overridable', ok: rejected, detail: `override-arg rejected=${rejected}` });
  }

  // (4) a delete-granting write scope is refused at the grant.
  {
    const store = new InMemoryConnectorRuntimeStore();
    const io: ExternalIO = { read: async () => ({ source: 'x', content: 'y' }), write: async () => ({}) };
    const bad: ConnectorParams = {
      connector: 'ghl',
      readScopes: ['contacts.readonly'],
      writeScopes: ['conversations.write'], // delete-granting — must be refused
      deriveIdempotencyKey: (t) => t,
    };
    const runtime = new ToolRuntime({ store, params: { ghl: bad }, io, logFailure: () => {} });
    const gate = new WriteGate({ runtime, hardLimits: new InMemoryHardLimitGate(), approvals: new InMemoryApprovalQueue(), alerts: NULL_SINK });
    let refused = false;
    try {
      gate.requestedWriteScopes('ghl');
    } catch {
      refused = true;
    }
    findings.push({ gate: 'no-delete-scope', ok: refused, detail: `delete-granting write scope refused=${refused}` });
  }

  return findings;
}

async function main(): Promise<void> {
  const findings = await runChecks();
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

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly && process.argv[2] === 'check') {
  void main();
}

// referenced so the imports aren't flagged unused when the CLI branch is not taken
void SupabaseApprovalQueue;
