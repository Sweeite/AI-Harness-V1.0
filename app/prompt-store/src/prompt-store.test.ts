// ISSUE-042 §4 Definition of done — ONE test per AC (text read in component-04-prompt.md, Rule 0). All 14
// ACs are offline-provable with the port+fake pattern + the migration-text gate; the LIVE proof (the 0004
// version-discipline trigger actually firing, the prompt_layers RLS policy enforcing) is the Stage-2
// checkpoint capstone (results/issue-042-capstone.sql), run by the operator — noted where it applies.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  InMemoryPromptStore,
  type PromptStore,
} from './store.ts';
import { InMemoryDenialAuditSink, PromptPermissionDenied, type PermChecker } from './rbac.ts';
import { PromptService } from './service.ts';
import {
  LAYER_KINDS,
  LAYER_ORDER,
  PERM,
  isLayerKind,
  validateAssembledCore,
  type RequiredElementChecks,
} from './layers.ts';
import { runCheck } from './index.ts';

const NOW = 1_800_000_000; // fixed epoch seconds (deterministic; no Date.now in tests)

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');

// A PermChecker seeded with an explicit grant map — absence of a grant is default-deny.
function permsFor(grants: Record<string, string[]>): PermChecker {
  return {
    holds: (actorId, node) => (grants[actorId] ?? []).includes(node),
  };
}

// A superuser who holds every prompt PERM node (for the tests that aren't about denial).
const ADMIN = 'admin-1';
const adminGrants = { [ADMIN]: [PERM.edit, PERM.viewHistory, PERM.rollback] };

function svc(store: PromptStore, grants: Record<string, string[]> = adminGrants) {
  const audit = new InMemoryDenialAuditSink();
  const service = new PromptService({ store, perms: permsFor(grants), audit });
  return { service, audit };
}

// Content predicates ISSUE-043 would supply — here, simple presence markers so the FR-4.LYR.004 path is
// exercisable offline. The real content rules are ISSUE-043's; this proves the HALT HOOK wiring.
const cid043Checks: RequiredElementChecks = {
  boundary_instruction: (c) => c.includes('[BOUNDARY]'),
  hard_limit_statement: (c) => c.includes('[HARD-LIMITS]'),
  principles_block: (c) => c.includes('[PRINCIPLES]'),
};
const COMPLETE_CORE = 'You are the finance agent. [BOUNDARY] [HARD-LIMITS] [PRINCIPLES]';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// LYR — layer model / assembly contract
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test('AC-4.LYR.001.1 — an assembled prompt is exactly the four layer slots in order core → business → memory → task', async () => {
  const store = new InMemoryPromptStore();
  const { service } = svc(store);
  const core = await service.createLayer(ADMIN, { layer: 'core', name: 'fin-core', content: COMPLETE_CORE, agent_id: 'agent-fin', change_reason: 'init', created_by: ADMIN }, NOW);
  const biz = await service.createLayer(ADMIN, { layer: 'business', name: 'acme-biz', content: 'Acme Co.', agent_id: null, change_reason: 'init', created_by: ADMIN }, NOW);
  const mem = await service.createLayer(ADMIN, { layer: 'memory', name: 'fin-mem', content: '(memories)', agent_id: null, change_reason: 'init', created_by: ADMIN }, NOW);
  const task = await service.createLayer(ADMIN, { layer: 'task_template', name: 'reconcile', content: 'Reconcile {month}.', agent_id: null, change_reason: 'init', created_by: ADMIN }, NOW);

  const pin = await service.pinAtAssembly(
    {
      core: { layer: 'core', name: 'fin-core', agent_id: 'agent-fin' },
      business: { layer: 'business', name: 'acme-biz', agent_id: null },
      memory: { layer: 'memory', name: 'fin-mem', agent_id: null },
      task: { layer: 'task_template', name: 'reconcile', agent_id: null },
    },
    NOW,
  );
  const assembled = await service.assembleFromPin(pin, cid043Checks);

  assert.deepEqual(assembled.order, LAYER_ORDER);
  assert.deepEqual(assembled.layers.map((l) => l.slot), ['core', 'business', 'memory', 'task']);
  assert.deepEqual(assembled.layers.map((l) => l.version_id), [core.id, biz.id, mem.id, task.id]);
  assert.equal(assembled.validation.ok, true);
});

test('AC-4.LYR.001.2 — a layer field is one of core|business|memory|task_template and no other value is accepted', async () => {
  assert.deepEqual([...LAYER_KINDS], ['core', 'business', 'memory', 'task_template']);
  assert.equal(isLayerKind('core'), true);
  assert.equal(isLayerKind('principles'), false); // not a kind
  assert.equal(isLayerKind('task'), false); // the SLOT name is not a stored kind

  const store = new InMemoryPromptStore();
  await assert.rejects(
    // @ts-expect-error — deliberately passing an invalid kind to prove it is rejected at the store boundary
    store.createLayer({ layer: 'principles', name: 'x', content: 'y', agent_id: null, change_reason: 'r', created_by: null }, NOW),
    /invalid layer kind/,
  );
});

test('AC-4.LYR.002.1 — two distinct agents each have their own core keyed by agent_id', async () => {
  const store = new InMemoryPromptStore();
  const { service } = svc(store);
  const shared = '[PRINCIPLES the seven, verbatim]';
  await service.createLayer(ADMIN, { layer: 'core', name: 'orch-core', content: `Orchestrator. ${shared}`, agent_id: 'agent-orch', change_reason: 'init', created_by: ADMIN }, NOW);
  await service.createLayer(ADMIN, { layer: 'core', name: 'fin-core', content: `Finance. ${shared}`, agent_id: 'agent-fin', change_reason: 'init', created_by: ADMIN }, NOW);

  const a = await service.readAgentCore('agent-orch');
  const b = await service.readAgentCore('agent-fin');
  assert.ok(a && b);
  assert.equal(a!.agent_id, 'agent-orch');
  assert.equal(b!.agent_id, 'agent-fin');
  assert.notEqual(a!.id, b!.id);
  // The operating-principles block is byte-identical between them (the one shared-verbatim part).
  assert.ok(a!.content.includes(shared) && b!.content.includes(shared));
});

test('AC-4.LYR.002.2 — an agent with no core record is a configuration error at assembly', async () => {
  const store = new InMemoryPromptStore();
  const { service } = svc(store);
  assert.equal(await service.readAgentCore('agent-missing'), null);

  // Assembling with no pinned core → validateAssembledCore reports core_missing (loud config error).
  const pin = await service.pinAtAssembly({ core: { layer: 'core', name: 'nope', agent_id: 'agent-missing' } }, NOW);
  const assembled = await service.assembleFromPin(pin, cid043Checks);
  assert.equal(assembled.validation.ok, false);
  assert.deepEqual(assembled.validation.missing, ['core_missing']);
});

test('AC-4.LYR.003.1 — a task running on version N continues on N even after N+1 is published mid-run', async () => {
  const store = new InMemoryPromptStore();
  const { service } = svc(store);
  const v1 = await service.createLayer(ADMIN, { layer: 'core', name: 'fin-core', content: `${COMPLETE_CORE} v1`, agent_id: 'agent-fin', change_reason: 'init', created_by: ADMIN }, NOW);

  // A running task pins v1 at assembly.
  const pin = await service.pinAtAssembly({ core: { layer: 'core', name: 'fin-core', agent_id: 'agent-fin' } }, NOW);
  assert.equal(pin.slots.core, v1.id);

  // Mid-run, v2 is published.
  const v2 = await service.editWithReason(ADMIN, v1.id, { content: `${COMPLETE_CORE} v2`, change_reason: 'tighten' }, NOW + 10);
  assert.equal(v2.version, 2);

  // The in-flight task's assembly still resolves v1 content (pinned) — mid-run immutability holds.
  const assembled = await service.assembleFromPin(pin, cid043Checks);
  const coreLayer = assembled.layers.find((l) => l.slot === 'core')!;
  assert.equal(coreLayer.version_id, v1.id);
  assert.match(coreLayer.content, /v1$/);
});

test('AC-4.LYR.004.1 — a resolved core missing a required safety element halts assembly loudly (no silent send)', async () => {
  const store = new InMemoryPromptStore();
  const { service } = svc(store);
  // A core that is present + enabled + non-empty but LACKS [HARD-LIMITS] and [PRINCIPLES].
  const v1 = await service.createLayer(ADMIN, { layer: 'core', name: 'fin-core', content: 'Finance agent. [BOUNDARY] only.', agent_id: 'agent-fin', change_reason: 'init', created_by: ADMIN }, NOW);
  const pin = await service.pinAtAssembly({ core: { layer: 'core', name: 'fin-core', agent_id: 'agent-fin' } }, NOW);
  const assembled = await service.assembleFromPin(pin, cid043Checks);
  assert.equal(assembled.validation.ok, false);
  assert.deepEqual(assembled.validation.missing, ['hard_limit_statement', 'principles_block']);
  assert.match(assembled.validation.reason, /no silent send/);
  assert.ok(v1); // asset exists but assembly still refuses it — save-time vs assembly-time gap closed

  // Direct unit of the halt hook: a null/empty resolved core is also a loud halt.
  assert.equal(validateAssembledCore(null).ok, false);
  assert.equal(validateAssembledCore({ layer: 'core', enabled: false, content: COMPLETE_CORE }, cid043Checks).ok, false);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// STO — prompt storage & versioning
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test('AC-4.STO.001.1 — the prompt_layers schema carries the listed fields and NO client_slug (OD-096 reconciliation)', () => {
  // Offline proof over the built migration (Rule 0: the migration is reality). The `check` gate asserts
  // the baseline shape + the absence of client_slug; a clean run proves AC-4.STO.001.1 offline. The live
  // column-set assertion is the Stage-2 capstone.
  const findings = runCheck(SILO_MIGRATIONS);
  assert.deepEqual(findings, [], `check findings: ${JSON.stringify(findings)}`);

  const baseline = readFileSync(join(SILO_MIGRATIONS, '0001_baseline.sql'), 'utf8');
  const block = baseline.slice(baseline.indexOf('create table prompt_layers'));
  const plBlock = block.slice(0, block.indexOf(');') + 2);
  for (const col of ['id', 'layer', 'name', 'content', 'agent_id', 'enabled', 'version', 'previous_version_id', 'change_reason', 'created_at', 'created_by']) {
    assert.match(plBlock, new RegExp(`\\b${col}\\b`), `prompt_layers should declare ${col}`);
  }
  assert.doesNotMatch(plBlock, /client_slug/, 'prompt_layers must NOT carry client_slug (OD-096 / FR-10.ISO.001)');
});

test('logic-sweep — the version-trigger gate rejects a migration whose BEFORE trigger drops DELETE coverage (#1 knowledge-loss)', () => {
  // Regression for the logic-sweep finding (prompt-store/index.ts:120): the old `(update|delete)`
  // alternation passed a trigger firing on UPDATE only, even though DELETE is the sole role-independent
  // knowledge-loss guard (`revoke delete` is bypassed for service_role). Feed runCheck a mutated 0004
  // whose trigger event clause is `before insert or update` (DELETE removed) and assert the gate fires.
  const dir = mkdtempSync(join(tmpdir(), 'prompt-store-check-'));
  for (const f of ['0001_baseline.sql', '0002_rls_default_deny.sql', '0004_prompt_version_discipline.sql']) {
    try {
      copyFileSync(join(SILO_MIGRATIONS, f), join(dir, f));
    } catch {
      // 0002 is not read by runCheck; a missing optional file is fine.
    }
  }
  const disc = readFileSync(join(SILO_MIGRATIONS, '0004_prompt_version_discipline.sql'), 'utf8');
  const regressed = disc.replace(
    /before\s+insert\s+or\s+update\s+or\s+delete\s+on\s+public\.prompt_layers/i,
    'before insert or update on public.prompt_layers',
  );
  assert.notEqual(regressed, disc, 'the mutation should have altered the trigger event clause');
  writeFileSync(join(dir, '0004_prompt_version_discipline.sql'), regressed);

  const findings = runCheck(dir);
  assert.ok(
    findings.some((f) => f.gate === 'version-trigger'),
    `expected a version-trigger finding on a DELETE-uncovered trigger; got ${JSON.stringify(findings)}`,
  );

  // Control: the un-mutated corpus still passes the gate (no false positive on the real 0004).
  assert.deepEqual(
    runCheck(SILO_MIGRATIONS).filter((f) => f.gate === 'version-trigger'),
    [],
    'the shipped 0004 (insert or update or delete) must still pass the version-trigger gate',
  );
});

test('AC-4.STO.002.1 — a Layer-1 read comes only from prompt_layers layer=core; nothing reads agents.system_prompt', async () => {
  const store = new InMemoryPromptStore();
  const { service } = svc(store);
  await service.createLayer(ADMIN, { layer: 'core', name: 'fin-core', content: COMPLETE_CORE, agent_id: 'agent-fin', change_reason: 'init', created_by: ADMIN }, NOW);
  const core = await service.readAgentCore('agent-fin');
  assert.ok(core);
  assert.equal(core!.layer, 'core');
  assert.equal(core!.agent_id, 'agent-fin');

  // Single-source-of-truth guard (OD-048): no CODE path in this store reads/writes agents.system_prompt.
  // Grep the source files this slice ships for a system_prompt ACCESS (a `.system_prompt` field read or a
  // SQL reference), ignoring prose in comments — a re-introduced read path fails here.
  for (const f of ['store.ts', 'service.ts', 'supabase-store.ts']) {
    const src = readFileSync(join(HERE, f), 'utf8');
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''); // strip line + block comments
    assert.doesNotMatch(code, /system_prompt/, `${f} must not reference agents.system_prompt in code (OD-048)`);
  }
});

test('AC-4.STO.003.1 — an edit creates a NEW version, retains + links the prior, and does not mutate the original row', async () => {
  const store = new InMemoryPromptStore();
  const { service } = svc(store);
  const v1 = await service.createLayer(ADMIN, { layer: 'business', name: 'acme-biz', content: 'Acme v1', agent_id: null, change_reason: 'init', created_by: ADMIN }, NOW);
  const v2 = await service.editWithReason(ADMIN, v1.id, { content: 'Acme v2', change_reason: 'new tone' }, NOW + 5);

  assert.equal(v2.version, 2);
  assert.equal(v2.previous_version_id, v1.id);
  assert.notEqual(v2.id, v1.id);

  // The original row is byte-identical to how it was created (never overwritten — append-only).
  const original = await store.getVersion(v1.id);
  assert.equal(original!.content, 'Acme v1');
  assert.equal(original!.version, 1);
  assert.equal(original!.change_reason, 'init');

  // Both versions coexist in history.
  const hist = await service.readHistory(ADMIN, { layer: 'business', name: 'acme-biz', agent_id: null }, NOW);
  assert.deepEqual(hist.map((h) => h.version), [1, 2]);
});

test('AC-4.STO.003.2 — a save with an empty change_reason is rejected', async () => {
  const store = new InMemoryPromptStore();
  const { service } = svc(store);
  const v1 = await service.createLayer(ADMIN, { layer: 'business', name: 'acme-biz', content: 'Acme', agent_id: null, change_reason: 'init', created_by: ADMIN }, NOW);

  await assert.rejects(service.editWithReason(ADMIN, v1.id, { content: 'x', change_reason: '' }, NOW), /change_reason is mandatory/);
  await assert.rejects(service.editWithReason(ADMIN, v1.id, { content: 'x', change_reason: '   ' }, NOW), /change_reason is mandatory/);
  await assert.rejects(
    service.createLayer(ADMIN, { layer: 'business', name: 'b2', content: 'y', agent_id: null, change_reason: '', created_by: ADMIN }, NOW),
    /change_reason is mandatory/,
  );
});

test('AC-4.STO.004.1 — rollback to version K creates a NEW version equal to K and deletes nothing', async () => {
  const store = new InMemoryPromptStore();
  const { service } = svc(store);
  const v1 = await service.createLayer(ADMIN, { layer: 'business', name: 'acme-biz', content: 'K-content', agent_id: null, change_reason: 'init', created_by: ADMIN }, NOW);
  const v2 = await service.editWithReason(ADMIN, v1.id, { content: 'bad edit', change_reason: 'oops' }, NOW + 5);

  const rolled = await service.rollbackTo(ADMIN, v1.id, 'revert to K (v1)', NOW + 10);
  assert.equal(rolled.version, 3); // a NEW version, not a destructive revert
  assert.equal(rolled.content, 'K-content'); // equal to K
  assert.equal(rolled.previous_version_id, v2.id); // chained onto the head

  // Nothing was deleted — all three versions remain.
  const hist = await service.readHistory(ADMIN, { layer: 'business', name: 'acme-biz', agent_id: null }, NOW);
  assert.deepEqual(hist.map((h) => h.version), [1, 2, 3]);
  assert.equal((await store.getVersion(v1.id))!.content, 'K-content');
  assert.equal((await store.getVersion(v2.id))!.content, 'bad edit');
});

test('AC-4.STO.005.1 — a permitted edit takes effect on the NEXT assembly with no redeploy', async () => {
  const store = new InMemoryPromptStore();
  const { service } = svc(store);
  const v1 = await service.createLayer(ADMIN, { layer: 'core', name: 'fin-core', content: `${COMPLETE_CORE} v1`, agent_id: 'agent-fin', change_reason: 'init', created_by: ADMIN }, NOW);
  await service.editWithReason(ADMIN, v1.id, { content: `${COMPLETE_CORE} v2`, change_reason: 'tighten' }, NOW + 5);

  // A NEW task assembled AFTER the edit pins the new head (v2) — no redeploy, just the next assembly.
  const pin = await service.pinAtAssembly({ core: { layer: 'core', name: 'fin-core', agent_id: 'agent-fin' } }, NOW + 6);
  const assembled = await service.assembleFromPin(pin, cid043Checks);
  const coreLayer = assembled.layers.find((l) => l.slot === 'core')!;
  assert.equal(coreLayer.version, 2);
  assert.match(coreLayer.content, /v2$/);
});

test('AC-4.STO.005.2 — a user without PERM-prompt.edit is denied (default-deny) and the denial is logged', async () => {
  const store = new InMemoryPromptStore();
  // 'nobody' holds no prompt PERM nodes at all.
  const { service, audit } = svc(store, { [ADMIN]: [PERM.edit] });
  const v1 = await service.createLayer(ADMIN, { layer: 'business', name: 'acme-biz', content: 'Acme', agent_id: null, change_reason: 'init', created_by: ADMIN }, NOW);

  await assert.rejects(
    service.editWithReason('nobody', v1.id, { content: 'sneaky', change_reason: 'no perm' }, NOW + 1),
    (e) => e instanceof PromptPermissionDenied && e.node === PERM.edit,
  );
  // The denial is durably logged (never silent — #3).
  assert.equal(audit.denials.length, 1);
  assert.equal(audit.denials[0]!.actor_id, 'nobody');
  assert.equal(audit.denials[0]!.perm_node, PERM.edit);

  // The edit did NOT happen — the asset is still v1.
  const head = await store.currentVersion({ layer: 'business', name: 'acme-biz', agent_id: null });
  assert.equal(head!.version, 1);
});

test('AC-4.STO.006.1 — a task assembled on N runs to completion on N; the next task assembled uses N+1', async () => {
  const store = new InMemoryPromptStore();
  const { service } = svc(store);
  const v1 = await service.createLayer(ADMIN, { layer: 'core', name: 'fin-core', content: `${COMPLETE_CORE} v1`, agent_id: 'agent-fin', change_reason: 'init', created_by: ADMIN }, NOW);

  // Task A pins v1.
  const pinA = await service.pinAtAssembly({ core: { layer: 'core', name: 'fin-core', agent_id: 'agent-fin' } }, NOW);

  // The prompt is edited to v2 mid-task-A.
  await service.editWithReason(ADMIN, v1.id, { content: `${COMPLETE_CORE} v2`, change_reason: 'edit' }, NOW + 5);

  // Task A (still running) resolves v1; Task B assembled after the edit resolves v2.
  const asmA = await service.assembleFromPin(pinA, cid043Checks);
  const pinB = await service.pinAtAssembly({ core: { layer: 'core', name: 'fin-core', agent_id: 'agent-fin' } }, NOW + 6);
  const asmB = await service.assembleFromPin(pinB, cid043Checks);

  assert.equal(asmA.layers.find((l) => l.slot === 'core')!.version, 1);
  assert.equal(asmB.layers.find((l) => l.slot === 'core')!.version, 2);
});
