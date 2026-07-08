// ISSUE-062 (C8 SPC) — one test per §4 AC, plus reject-at-write robustness tests. Offline (in-memory reference +
// the shared guard kernel). The live adapter reuses the SAME kernel (evaluateToolsAllowed); its DB class-lookup is
// proven by the R10 live-adapter smoke.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SPECIALIST_CONTRACTS,
  SPECIALIST_ROLES,
  allContracts,
  commsProduce,
  financeHandlePayment,
  isSelectableOnDemand,
  mayWriteMemory,
  orderChain,
  COMMS,
  FINANCE,
  MEMORY,
  RESEARCH,
  INSIGHT,
  CLIENT,
  type SpecialistRole,
} from './specialists.ts';
import {
  CLASS_AUTONOMOUS_SEND,
  CLASS_MEMORY_WRITE,
  CLASS_TRANSACTION,
  ForbiddenCapabilityGrant,
  InMemoryRejectionLog,
  InMemorySpecialistRegistry,
  InMemoryToolClassifier,
  evaluateToolsAllowed,
  isForbiddenGrant,
} from './store.ts';
import { runCheck } from './index.ts';

// A registry seeded with the 8 specialists + a classifier wired with one tool of each forbidden class (the ids are
// arbitrary stand-ins for real uuids; live, the class comes from tools.config->>'hard_limit_class').
function cleanRegistry() {
  const rejections = new InMemoryRejectionLog();
  const c = new InMemoryToolClassifier([
    ['tool-mem-write', CLASS_MEMORY_WRITE],
    ['tool-send', CLASS_AUTONOMOUS_SEND],
    ['tool-txn', CLASS_TRANSACTION],
  ]);
  const reg = new InMemorySpecialistRegistry({ classifier: c, rejections });
  return { reg, rejections, c };
}

// ── AC-8.SPC.001.1 — all eight specialists exist, each with a single-domain contract. ────────────────
test('AC-8.SPC.001.1 — eight specialists, each single-domain', () => {
  const contracts = allContracts();
  assert.equal(contracts.length, 8);
  const roles = contracts.map((c) => c.role).sort();
  assert.deepEqual(roles, [...SPECIALIST_ROLES].sort());
  // each role owns exactly one domain, and domains are 1:1 with roles (single-domain — SPC.001.1).
  const domains = new Set(contracts.map((c) => c.domain));
  assert.equal(domains.size, 8);
  for (const c of contracts) {
    assert.equal(typeof c.domain, 'string');
    assert.ok(c.domain.length > 0);
    assert.equal(c.domain, c.role); // one role ↔ one domain
  }
});

// ── AC-8.SPC.002.1 — a chain needing gathered context puts Research first. ───────────────────────────
test('AC-8.SPC.002.1 — Research is the first step when a chain needs gathering', () => {
  const chain = orderChain([CLIENT, RESEARCH, COMMS], true);
  assert.equal(chain[0], RESEARCH);
  assert.deepEqual(chain, [RESEARCH, CLIENT, COMMS]);
  // when no gathering is needed, Research is not forced first (a task may skip it — SPC.002 branch).
  const noGather = orderChain([CLIENT, COMMS], false);
  assert.deepEqual(noGather, [CLIENT, COMMS]);
});

// ── AC-8.SPC.002.2 — Research holds no write/action tools (read-only). ───────────────────────────────
test('AC-8.SPC.002.2 — Research is read-only (holds no write/action tools)', async () => {
  assert.equal(SPECIALIST_CONTRACTS[RESEARCH].read_only, true);
  const { reg } = cleanRegistry();
  const def = await reg.getByRole(RESEARCH);
  assert.ok(def);
  assert.deepEqual(def.tools_allowed, []); // seeded least-privilege: no tools
});

// ── AC-8.SPC.003.1 — a Comms output lands in the approval queue, never an outbound send. ─────────────
test('AC-8.SPC.003.1 — Comms produces an approval-queue draft, not an outbound send', () => {
  const out = commsProduce('Hi client, here is the update.');
  assert.equal(out.kind, 'approval_queue_draft');
  // the product type is closed — there is no code path yielding an outbound send from the specialist.
  assert.notEqual((out as { kind: string }).kind, 'outbound_send');
});

// ── AC-8.SPC.003.2 — the Comms Agent has no autonomous-send tool. ────────────────────────────────────
test('AC-8.SPC.003.2 — Comms holds no autonomous-send tool', async () => {
  assert.equal(SPECIALIST_CONTRACTS[COMMS].can_send_autonomously, false);
  const { reg } = cleanRegistry();
  const def = await reg.getByRole(COMMS);
  assert.deepEqual(def?.tools_allowed, []);
});

// ── AC-8.SPC.003.3 — a registry edit adding an autonomous-send tool to Comms is REJECTED AT WRITE. ───
test('AC-8.SPC.003.3 — adding an autonomous-send tool to Comms is rejected at write (denied, not audited)', async () => {
  const { reg, rejections } = cleanRegistry();
  await assert.rejects(
    () => reg.setToolsAllowed(COMMS, ['tool-send'], 'try to grant send', 'super-admin', 1000),
    (e: unknown) => e instanceof ForbiddenCapabilityGrant && e.detail.tool_class === CLASS_AUTONOMOUS_SEND,
  );
  // the write did NOT land — the Comms row is unchanged (still empty, still version 1). Not "audited-then-applied".
  const def = await reg.getByRole(COMMS);
  assert.deepEqual(def?.tools_allowed, []);
  assert.equal(def?.version, 1);
  // …and the reason was logged (#3 never-silent).
  assert.equal(rejections.rejections.length, 1);
  assert.equal(rejections.rejections[0]!.tool_class, CLASS_AUTONOMOUS_SEND);
  assert.match(rejections.rejections[0]!.reason, /never sends autonomously/);
});

// ── AC-8.SPC.004.1 — Finance holds no transaction tool and its clearance is finance-scoped Confidential. ─
test('AC-8.SPC.004.1 — Finance holds no transaction tool; clearance is finance-scoped Confidential', async () => {
  assert.equal(SPECIALIST_CONTRACTS[FINANCE].can_transact, false);
  assert.deepEqual(SPECIALIST_CONTRACTS[FINANCE].clearance, { tier: 'confidential', scope: 'finance' });
  const { reg } = cleanRegistry();
  const def = await reg.getByRole(FINANCE);
  assert.deepEqual(def?.tools_allowed, []);
});

// ── AC-8.SPC.004.2 — a payment-implying task produces a human flag, never a transaction. ─────────────
test('AC-8.SPC.004.2 — Finance flags a payment for a human, never transacts', () => {
  const out = financeHandlePayment('Invoice #42 appears due — human decision required.');
  assert.equal(out.kind, 'human_flag');
  assert.notEqual((out as { kind: string }).kind, 'transaction');
  assert.ok(out.reason.length > 0); // never a silent no-op (#3)
});

// ── AC-8.SPC.004.3 — a registry edit adding a transaction tool to Finance is REJECTED AT WRITE. ──────
test('AC-8.SPC.004.3 — adding a transaction tool to Finance is rejected at write', async () => {
  const { reg, rejections } = cleanRegistry();
  await assert.rejects(
    () => reg.setToolsAllowed(FINANCE, ['tool-txn'], 'try to grant txn', 'super-admin', 1000),
    (e: unknown) => e instanceof ForbiddenCapabilityGrant && e.detail.tool_class === CLASS_TRANSACTION,
  );
  const def = await reg.getByRole(FINANCE);
  assert.deepEqual(def?.tools_allowed, []);
  assert.equal(rejections.rejections.length, 1);
  assert.equal(rejections.rejections[0]!.tool_class, CLASS_TRANSACTION);
});

// ── AC-8.SPC.005.1 — a memory write occurs only via the Memory Agent. ────────────────────────────────
test('AC-8.SPC.005.1 — only the Memory Agent may invoke the memory-write flow', () => {
  assert.equal(mayWriteMemory(MEMORY), true);
  for (const role of SPECIALIST_ROLES) {
    if (role === MEMORY) continue;
    assert.equal(mayWriteMemory(role), false, `${role} must not write memory directly (ADR-004)`);
  }
});

// ── AC-8.SPC.005.2 — only the Memory Agent may hold memory-write capability in tools_allowed. ────────
test('AC-8.SPC.005.2 — memory-write capability is rejected for every non-Memory agent, allowed for Memory', async () => {
  // rejected for every non-Memory role…
  for (const role of SPECIALIST_ROLES) {
    if (role === MEMORY) continue;
    const { reg } = cleanRegistry();
    await assert.rejects(
      () => reg.setToolsAllowed(role, ['tool-mem-write'], 'grant memory write', 'super-admin', 1000),
      (e: unknown) => e instanceof ForbiddenCapabilityGrant && e.detail.tool_class === CLASS_MEMORY_WRITE,
      `${role} must be denied memory-write at write`,
    );
  }
  // …and ALLOWED for the Memory Agent (the sole writer — ADR-004).
  const { reg } = cleanRegistry();
  const def = await reg.setToolsAllowed(MEMORY, ['tool-mem-write'], 'the sole memory writer', 'super-admin', 2000);
  assert.deepEqual(def.tools_allowed, ['tool-mem-write']);
  assert.equal(def.version, 2);
});

// ── AC-NFR-SEC.004.2 — the registry editor rejects-at-save all three; not merely audited. ────────────
test('AC-NFR-SEC.004.2 — reject-at-save for Comms send / Finance transact / non-Memory memory-write', async () => {
  const cases: [SpecialistRole, string, string][] = [
    [COMMS, 'tool-send', CLASS_AUTONOMOUS_SEND],
    [FINANCE, 'tool-txn', CLASS_TRANSACTION],
    [CLIENT, 'tool-mem-write', CLASS_MEMORY_WRITE],
  ];
  for (const [role, toolId, klass] of cases) {
    const { reg, rejections } = cleanRegistry();
    await assert.rejects(
      () => reg.setToolsAllowed(role, [toolId], 'attempt', 'anyone', 500),
      (e: unknown) => e instanceof ForbiddenCapabilityGrant && e.detail.tool_class === klass,
    );
    // reject-at-SAVE: the row never changed (not applied-then-audited) AND the reason is logged.
    assert.equal((await reg.getByRole(role))?.version, 1);
    assert.equal(rejections.rejections.length, 1);
  }
});

// ── Robustness: the guard fires REGARDLESS of caller role (a negative invariant on the data, not OD-080). ─
test('reject-at-write is caller-role independent (a data invariant, not an authority check)', async () => {
  for (const actor of ['super-admin', 'admin', 'system:provisioning', 'attacker']) {
    const { reg } = cleanRegistry();
    await assert.rejects(
      () => reg.setToolsAllowed(COMMS, ['tool-send'], 'x', actor, 1),
      (e: unknown) => e instanceof ForbiddenCapabilityGrant,
      `guard must fire for actor '${actor}'`,
    );
  }
});

// ── Robustness: a clean grant is allowed and version-bumped; an unclassified tool is not forbidden. ──
test('a non-forbidden grant is allowed (unclassified tool ids pass; version appends)', async () => {
  const { reg } = cleanRegistry();
  const def = await reg.setToolsAllowed(CLIENT, ['tool-read-only-xyz'], 'grant a read tool', 'super-admin', 3000);
  assert.deepEqual(def.tools_allowed, ['tool-read-only-xyz']);
  assert.equal(def.version, 2);
});

// ── Robustness: a mixed set is denied on the FIRST forbidden id (deterministic order), nothing lands. ─
test('a mixed tools_allowed with one forbidden id is denied wholesale', async () => {
  const { reg } = cleanRegistry();
  await assert.rejects(
    () => reg.setToolsAllowed(COMMS, ['tool-read-ok', 'tool-send', 'tool-other'], 'mixed', 'sa', 10),
    (e: unknown) => e instanceof ForbiddenCapabilityGrant && e.detail.tool_id === 'tool-send',
  );
  assert.deepEqual((await reg.getByRole(COMMS))?.tools_allowed, []);
});

// ── Robustness: empty change_reason is rejected loud (every edit is audited). ────────────────────────
test('an empty change_reason is rejected (every tools_allowed edit is audited)', async () => {
  const { reg } = cleanRegistry();
  await assert.rejects(() => reg.setToolsAllowed(CLIENT, [], '   ', 'sa', 1), /change_reason/);
});

// ── Kernel unit: isForbiddenGrant precisely encodes the three invariants. ────────────────────────────
test('isForbiddenGrant encodes exactly the three named invariants', () => {
  // memory-write: forbidden to everyone EXCEPT memory
  assert.equal(isForbiddenGrant(MEMORY, CLASS_MEMORY_WRITE), false);
  assert.equal(isForbiddenGrant(CLIENT, CLASS_MEMORY_WRITE), true);
  assert.equal(isForbiddenGrant(INSIGHT, CLASS_MEMORY_WRITE), true);
  // autonomous-send: forbidden to Comms only (the named invariant)
  assert.equal(isForbiddenGrant(COMMS, CLASS_AUTONOMOUS_SEND), true);
  assert.equal(isForbiddenGrant(CLIENT, CLASS_AUTONOMOUS_SEND), false);
  // transaction: forbidden to Finance only (the named invariant)
  assert.equal(isForbiddenGrant(FINANCE, CLASS_TRANSACTION), true);
  assert.equal(isForbiddenGrant(CLIENT, CLASS_TRANSACTION), false);
});

// ── Kernel unit: evaluateToolsAllowed returns null for a clean set. ──────────────────────────────────
test('evaluateToolsAllowed returns null when the set is clean', () => {
  const c = new InMemoryToolClassifier([['tool-send', CLASS_AUTONOMOUS_SEND]]);
  assert.equal(evaluateToolsAllowed(COMMS, ['a', 'b'], c), null);
  assert.equal(evaluateToolsAllowed(MEMORY, ['tool-send'], c), null); // send isn't forbidden to Memory
});

// ── SPC.006 — Insight is slow-loop only / not on-demand / read-only. ─────────────────────────────────
test('AC-8.SPC.006.1/.006.2 — Insight is read-only, slow-loop-only, not on-demand', async () => {
  assert.equal(SPECIALIST_CONTRACTS[INSIGHT].read_only, true);
  assert.equal(SPECIALIST_CONTRACTS[INSIGHT].routing.slow_loop_only, true);
  assert.equal(isSelectableOnDemand(INSIGHT), false);
  // every other role IS selectable on demand
  for (const role of SPECIALIST_ROLES) {
    if (role === INSIGHT) continue;
    assert.equal(isSelectableOnDemand(role), true, `${role} should be on-demand selectable`);
  }
  const { reg } = cleanRegistry();
  assert.deepEqual((await reg.getByRole(INSIGHT))?.tools_allowed, []); // read-all/no-write
});

// ── check gate — the offline non-drift guard passes against the real baseline migrations. ────────────
test('check gate is clean against the live baseline migrations', () => {
  const findings = runCheck();
  assert.deepEqual(findings, [], `check findings: ${JSON.stringify(findings)}`);
});
