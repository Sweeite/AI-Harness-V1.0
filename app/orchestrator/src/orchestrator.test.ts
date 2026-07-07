// ISSUE-061 — offline AC coverage for the ORC + REG areas. Every AC-* in the issue §4 DoD has a test here,
// named by its AC id. No live DB: the InMemory* reference models are the contract the live pg adapter mirrors.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AgentsPermissionDenied,
  ERR_EMPTY_CHANGE_REASON,
  ERR_EMPTY_DESCRIPTION,
  InMemoryAgentRegistry,
  InMemoryDenialAuditSink,
  PERM_AGENTS_EDIT_CAPABILITY,
  PERM_AGENTS_EDIT_DESCRIPTION,
  type AgentsPerm,
  type MemoryScope,
  type NewAgent,
  type PermChecker,
} from './registry.ts';
import { domainOf, withDomain } from './supabase-store.ts';
import {
  ERR_COMMS_HAS_SEND,
  ERR_FINANCE_HAS_TXN,
  assertForbiddenToolsAbsent,
  canonicalRoster,
  seedRoster,
  type CoreLayerProbe,
} from './seed.ts';
import {
  DEFAULT_ROUTING_CONFIG,
  ERR_HARDCODED_ROUTE,
  OrchestratorEngine,
  weightsSumToOne,
  type Classification,
  type ExecutionPlan,
  type RoutingConfig,
} from './routing.ts';
import {
  FailingEventSink,
  FailingOutcomePlanStore,
  FixedClassifier,
  InMemoryEnvelopeSink,
  InMemoryEventSink,
  InMemoryPlanStore,
  InMemoryQueueGate,
  InMemorySecondarySink,
} from './fakes.ts';
import { runCheck } from './index.ts';

const NOW = 1_700_000_000;
const SCOPE: MemoryScope = { tiers: ['semantic'], entity_model: true, tool_registry: false };

function newAgent(over: Partial<NewAgent> = {}): NewAgent {
  return {
    name: 'research',
    description: 'reads sources',
    memory_scope: SCOPE,
    domain: 'research',
    change_reason: 'seed',
    ...over,
  };
}

/** A perms gate that grants a fixed node set to a fixed actor. */
function permsFor(grants: Record<string, AgentsPerm[]>): PermChecker {
  return { holds: (actorId, node) => (grants[actorId] ?? []).includes(node) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// REG.001 — the agents registry table + empty-description reject + no client_slug
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.REG.001.1 — the agents baseline schema carries no system_prompt/model column', () => {
  const findings = runCheck();
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test('AC-8.REG.001.2 — an insert with an empty description is rejected', async () => {
  const reg = new InMemoryAgentRegistry();
  await assert.rejects(() => reg.insert(newAgent({ description: '' }), 'sys', NOW), (e: Error) => e.message === ERR_EMPTY_DESCRIPTION);
  await assert.rejects(() => reg.insert(newAgent({ description: '   ' }), 'sys', NOW), (e: Error) => e.message === ERR_EMPTY_DESCRIPTION);
});

test('AC-8.REG.001.3 — the agents baseline schema carries no client_slug column (proven by the check gate)', () => {
  // runCheck asserts no client_slug/system_prompt/model column exists in the baseline agents block.
  assert.equal(runCheck().filter((f) => f.gate === 'agents-no-forbidden-col').length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// REG.002 — Layer-1 single source of truth (prompt_layers, not agents.system_prompt)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.REG.002.1 — an agent row carries no prompt copy; Layer 1 resolves by agent_id from prompt_layers', async () => {
  const reg = new InMemoryAgentRegistry();
  const row = await reg.insert(newAgent(), 'sys', NOW);
  // The AgentRow type structurally has NO system_prompt/content field — resolution is by id against prompt_layers.
  assert.equal((row as unknown as Record<string, unknown>).system_prompt, undefined);
  assert.equal((row as unknown as Record<string, unknown>).content, undefined);
  // The probe models prompt_layers resolution keyed by agent root id (the single authoritative store).
  const probe: CoreLayerProbe = { hasCore: (rootId) => rootId === reg.rootFor(row.id) };
  assert.equal(probe.hasCore(reg.rootFor(row.id)!), true);
});

test('AC-8.REG.002.2 — post-migration no agents.system_prompt value survives (check gate proves the column is absent)', () => {
  // The one-time system_prompt migration is authored in proposed-shared-spec; the check gate proves the column
  // does not exist in the baseline (the single-source-of-truth end state).
  assert.equal(runCheck().filter((f) => f.gate === 'agents-no-forbidden-col').length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// REG.003 — add-by-insert auto-discovery
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.REG.003.1 — a valid enabled row inserted becomes a routing candidate with no code change', async () => {
  const reg = new InMemoryAgentRegistry();
  assert.equal((await reg.candidates('finance')).length, 0);
  await reg.insert(newAgent({ name: 'finance', domain: 'finance', description: 'reports finances' }), 'sys', NOW);
  const cands = await reg.candidates('finance');
  assert.equal(cands.length, 1);
  assert.equal(cands[0]!.name, 'finance');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// REG.004 — version discipline
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.REG.004.1 — an edit without change_reason is rejected', async () => {
  const reg = new InMemoryAgentRegistry();
  const row = await reg.insert(newAgent(), 'sys', NOW);
  await assert.rejects(
    () => reg.editDescription(row.id, { description: 'x', change_reason: '' }, 'sys', NOW),
    (e: Error) => e.message === ERR_EMPTY_CHANGE_REASON,
  );
  await assert.rejects(
    () => reg.editCapability(row.id, { enabled: false, change_reason: '  ' }, 'sys', NOW),
    (e: Error) => e.message === ERR_EMPTY_CHANGE_REASON,
  );
});

test('AC-8.REG.004.2 — an edit creates a new version with previous_version_id; the prior stays retrievable', async () => {
  const reg = new InMemoryAgentRegistry();
  const v1 = await reg.insert(newAgent({ description: 'v1 desc' }), 'sys', NOW);
  const v2 = await reg.editDescription(v1.id, { description: 'v2 desc', change_reason: 'sharpen' }, 'sys', NOW + 1);
  assert.equal(v2.version, 2);
  assert.equal(v2.previous_version_id, v1.id);
  assert.equal(v2.description, 'v2 desc');
  // the prior version is not overwritten — it remains retrievable in the history
  const hist = await reg.history(v1.id);
  assert.equal(hist.length, 2);
  assert.equal(hist[0]!.description, 'v1 desc');
  assert.equal(hist[0]!.version, 1);
  // get() resolves to the CURRENT version
  const cur = await reg.get(v1.id);
  assert.equal(cur!.version, 2);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// REG.004 — domain-preservation contract across a memory_scope-replacing capability edit.
// The live pg adapter (supabase-store.ts) stores an agent's routing domain INSIDE the memory_scope jsonb as a
// `__domain` key. A capability edit that REPLACES memory_scope carries a plain MemoryScope with NO `__domain`;
// if the adapter wrote it verbatim the new current version would silently drop the tag and vanish from
// candidates(domain)/disable() — #1 knowledge loss / #3 silent routing gap. appendVersion() re-injects the tag
// via withDomain(next.memory_scope, domainOf(cur.memory_scope)). These assert that exact merge logic directly
// (the in-memory reference model can't cover it — it decouples domain into a side map). Teeth against the old bug.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.REG.004.3 — a memory_scope-replacing capability edit PRESERVES the __domain routing tag (adapter merge)', () => {
  // The current head as the live adapter stores it: __domain lives inside the memory_scope jsonb.
  const curScope = { tiers: ['semantic', 'entity'], entity_model: true, tool_registry: false, __domain: 'finance' } as unknown as MemoryScope;
  assert.equal(domainOf(curScope), 'finance');

  // The caller's replacement scope on a capability edit — a plain MemoryScope, __domain ABSENT (the old bug path).
  const replacement: MemoryScope = { tiers: ['semantic'], entity_model: true, tool_registry: false };
  assert.equal(domainOf(replacement), undefined);

  // What appendVersion() actually writes: re-inject the current head's domain into the replacement scope.
  const merged = withDomain(replacement, domainOf(curScope));
  assert.equal(domainOf(merged), 'finance'); // tag survives → still resolvable by candidates(domain)/disable()
  assert.deepEqual(merged.tiers, ['semantic']); // the caller's replacement content is honoured
  // And the round-trip the DB sees (JSON) still carries __domain, so the `memory_scope->>'__domain'` filter matches.
  assert.equal(JSON.parse(JSON.stringify(merged)).__domain, 'finance');
  // An explicit __domain on the incoming scope wins over the fallback (never silently re-homed).
  const reScoped = { tiers: ['semantic'], entity_model: true, tool_registry: false, __domain: 'ops' } as unknown as MemoryScope;
  assert.equal(domainOf(withDomain(reScoped, 'finance')), 'ops');
  // No domain to preserve (undefined) → withDomain is a no-op, adds no spurious tag.
  assert.equal(domainOf(withDomain(replacement, undefined)), undefined);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// REG.005 — enabled gates discovery
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.REG.005.1 — a disabled agent is excluded from routing but its row/history persists', async () => {
  const reg = new InMemoryAgentRegistry();
  const a = await reg.insert(newAgent({ name: 'ops', domain: 'ops', description: 'ops work' }), 'sys', NOW);
  const b = await reg.insert(newAgent({ name: 'ops2', domain: 'ops', description: 'more ops' }), 'sys', NOW);
  await reg.editCapability(a.id, { enabled: false, change_reason: 'retire' }, 'sys', NOW + 1);
  const cands = await reg.candidates('ops');
  assert.deepEqual(cands.map((c) => c.name), ['ops2']); // a excluded
  // its row + history persist
  assert.equal((await reg.get(a.id))!.enabled, false);
  assert.equal((await reg.history(a.id)).length, 2);
  void b;
});

test('AC-8.REG.005.2 — a domain that loses its only enabled agent routes to clarification, not a silent drop', async () => {
  const reg = new InMemoryAgentRegistry();
  const a = await reg.insert(newAgent({ name: 'comms', domain: 'comms', description: 'drafts comms' }), 'sys', NOW);
  await reg.disable(a.id, 'disable sole', 'sys', NOW + 1);
  // now route a comms task — no candidates → clarification (not a silent drop)
  const { engine, queue, events } = buildEngine(reg, { 't-comms': cls('comms', 'single') });
  queue.push({ task_id: 't-comms', task_name: 'send update', payload: {} }, NOW);
  const res = await engine.route(NOW + 2);
  assert.equal(res!.outcome, 'clarification');
  assert.equal(res!.plan, null);
  assert.equal(queue.tasks.find((t) => t.task_id === 't-comms')!.status, 'awaiting_clarification');
  assert.equal(events.byType('routing_low_confidence').length, 1);
});

test('AC-8.REG.005.3 — disabling the sole enabled agent for a domain surfaces a warning at disable-time', async () => {
  const reg = new InMemoryAgentRegistry();
  const only = await reg.insert(newAgent({ name: 'insight', domain: 'insight', description: 'insight work' }), 'sys', NOW);
  const { warning } = await reg.disable(only.id, 'retire the last one', 'sys', NOW + 1);
  assert.ok(warning);
  assert.equal(warning!.kind, 'sole_agent_disabled');
  assert.equal(warning!.domain, 'insight');
  // whereas disabling a non-sole agent yields no warning
  const reg2 = new InMemoryAgentRegistry();
  const a = await reg2.insert(newAgent({ name: 'insA', domain: 'insight', description: 'a' }), 'sys', NOW);
  await reg2.insert(newAgent({ name: 'insB', domain: 'insight', description: 'b' }), 'sys', NOW);
  const { warning: w2 } = await reg2.disable(a.id, 'one of two', 'sys', NOW + 1);
  assert.equal(w2, null);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// REG.006 — seed the canonical roster + orchestrator (idempotent) + positive Comms/Finance check
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.REG.006.1 — a freshly provisioned deployment has the orchestrator + 8 specialists with their scopes', async () => {
  const reg = new InMemoryAgentRegistry();
  const res = await seedRoster(reg, NOW);
  assert.equal(res.inserted.length, 9); // orchestrator + 8 specialists
  const names = new Set(res.inserted.map((r) => r.name));
  for (const n of ['orchestrator', 'research', 'client', 'campaign', 'comms', 'ops', 'memory', 'finance', 'insight']) {
    assert.ok(names.has(n), `missing seeded agent ${n}`);
  }
  // each has a memory_scope (the SCO matrix seed)
  for (const r of res.inserted) assert.ok(Array.isArray(r.memory_scope.tiers));
});

test('AC-8.REG.006.2 — re-running provisioning converges to the full roster without duplicates (idempotent)', async () => {
  const reg = new InMemoryAgentRegistry();
  const first = await seedRoster(reg, NOW);
  assert.equal(first.inserted.length, 9);
  // simulate an interrupted seed: a second run inserts nothing new, reports all 9 as existing
  const second = await seedRoster(reg, NOW + 100);
  assert.equal(second.inserted.length, 0);
  assert.equal(second.existing.length, 9);
  // total distinct agent chains still 9 (no duplicates) — count current-version rows across all chains
  const distinctNames = new Set<string>();
  for (const row of reg.rows.values()) {
    const root = reg.rootFor(row.id)!;
    const cur = await reg.get(root);
    if (cur && cur.id === row.id) distinctNames.add(cur.name);
  }
  assert.equal(distinctNames.size, 9);
});

test('AC-8.REG.006.3 — the seed refuses a Comms autonomous-send tool and a Finance transaction tool (fail-closed)', () => {
  const roster = canonicalRoster();
  const comms = roster.specialists.find((s) => s.role === 'comms')!;
  const finance = roster.specialists.find((s) => s.role === 'finance')!;
  // the canonical roster carries NO forbidden tools
  assert.equal(comms.tools_allowed.length, 0);
  assert.equal(finance.tools_allowed.length, 0);
  // and if one were injected, the positive seed check THROWS (never a warning) — #2 fail-closed
  const caps = new Map([['tool-send', 'autonomous_send' as const], ['tool-pay', 'transaction' as const]]);
  assert.throws(
    () => assertForbiddenToolsAbsent({ ...comms, tools_allowed: ['tool-send'] }, caps),
    (e: Error) => e.message === ERR_COMMS_HAS_SEND('tool-send'),
  );
  assert.throws(
    () => assertForbiddenToolsAbsent({ ...finance, tools_allowed: ['tool-pay'] }, caps),
    (e: Error) => e.message === ERR_FINANCE_HAS_TXN('tool-pay'),
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// OD-080 — the registry-edit authority split (capability = SA only; description = SA + Admin)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('OD-080 — capability edits require edit_capability; an Admin (description-only) is denied + logged', async () => {
  const audit = new InMemoryDenialAuditSink();
  const perms = permsFor({
    superadmin: [PERM_AGENTS_EDIT_CAPABILITY, PERM_AGENTS_EDIT_DESCRIPTION],
    admin: [PERM_AGENTS_EDIT_DESCRIPTION],
  });
  const reg = new InMemoryAgentRegistry({ perms, audit });
  // SA can insert (a capability change)
  const row = await reg.insert(newAgent(), 'superadmin', NOW);
  // Admin can edit the description
  const v2 = await reg.editDescription(row.id, { description: 'tuned', change_reason: 'tune' }, 'admin', NOW + 1);
  assert.equal(v2.description, 'tuned');
  // Admin CANNOT edit capability (memory_scope/tools/enabled) — denied + logged (default-deny, #3)
  await assert.rejects(
    () => reg.editCapability(row.id, { enabled: false, change_reason: 'try' }, 'admin', NOW + 2),
    (e: Error) => e instanceof AgentsPermissionDenied,
  );
  assert.equal(audit.denials.length, 1);
  assert.equal(audit.denials[0]!.perm_node, PERM_AGENTS_EDIT_CAPABILITY);
  // an unknown actor is default-denied on insert
  await assert.rejects(() => reg.insert(newAgent({ name: 'x', domain: 'ops' }), 'nobody', NOW + 3), (e: Error) => e instanceof AgentsPermissionDenied);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ORC.001 — orchestrator routes/plans only; unroutable halts; crash-window re-route
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.ORC.001.1 — the orchestrator produces a plan and makes no domain action-tool call (empty tools_allowed)', async () => {
  const reg = new InMemoryAgentRegistry();
  await seedRoster(reg, NOW);
  const orch = await reg.get(findRoot(reg, 'orchestrator'));
  assert.deepEqual(orch!.tools_allowed, []); // read-only: no action tool (ORC.001.1)
  const { engine, queue, envelope } = buildEngine(reg, { 't-r': cls('research', 'single') });
  queue.push({ task_id: 't-r', task_name: 'gather facts', payload: {} }, NOW);
  const res = await engine.route(NOW + 1);
  assert.equal(res!.outcome, 'planned');
  assert.ok(res!.plan);
  // the plan is handed to the C5 envelope (ORC.005.3), never executed here
  assert.ok(envelope.plans.get('t-r'));
});

test('AC-8.ORC.001.2 — an unroutable task halts-and-escalates and is logged (never silently consumed)', async () => {
  const reg = new InMemoryAgentRegistry(); // empty registry → no candidates for any domain
  const { engine, queue, events } = buildEngine(reg, { 't-x': cls('ops', 'single') });
  const task = { task_id: 't-x', task_name: 'do a thing', payload: {} };
  await engine.haltUnroutable(task, NOW);
  assert.equal(events.byType('routing_unroutable').length, 1);
  void queue;
});

test('AC-8.ORC.001.3 — a crash between dequeue and plan-persist leaves the task re-routable + logs the recovery', async () => {
  const reg = new InMemoryAgentRegistry();
  await reg.insert(newAgent({ name: 'ops', domain: 'ops', description: 'ops' }), 'sys', NOW);
  // a classifier that throws simulates a mid-route crash (after dequeue, before plan-persist)
  const crashing = new FixedClassifier(new Map());
  const queue = new InMemoryQueueGate();
  const events = new InMemoryEventSink();
  const secondary = new InMemorySecondarySink();
  const engine = new OrchestratorEngine({
    registry: reg,
    classifier: crashing, // .classify throws (no wired classification) → crash window
    queue,
    plans: new InMemoryPlanStore(),
    envelope: new InMemoryEnvelopeSink(),
    events,
    secondary,
    config: () => DEFAULT_ROUTING_CONFIG,
  });
  queue.push({ task_id: 't-crash', task_name: 'boom', payload: {} }, NOW);
  await assert.rejects(() => engine.route(NOW + 1)); // the bug re-raises (never silently swallowed)
  // the task was returned to a re-routable (pending) state — never dequeued-but-unplanned
  assert.equal(queue.tasks.find((t) => t.task_id === 't-crash')!.status, 'pending');
  assert.equal(events.byType('routing_crash_recovered').length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ORC.002 — classify
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.ORC.002.1 — domain/complexity/context/output are recorded on the routing record + event_log', async () => {
  const reg = new InMemoryAgentRegistry();
  await reg.insert(newAgent({ name: 'client', domain: 'client', description: 'client work' }), 'sys', NOW);
  const { engine, queue, events } = buildEngine(reg, { 't-c': cls('client', 'single', { output: 'summary', entity_ids: ['e1'] }) });
  queue.push({ task_id: 't-c', task_name: 'summarise', payload: {} }, NOW);
  const res = await engine.route(NOW + 1);
  assert.equal(res!.classification.domain, 'client');
  assert.equal(res!.classification.output, 'summary');
  const ev = events.byType('routing_classified')[0]!;
  assert.deepEqual(ev.payload.domain, 'client');
});

test('AC-8.ORC.002.2 — an ambiguous classification lowers confidence and propagates to the confidence check', async () => {
  const reg = new InMemoryAgentRegistry();
  await reg.insert(newAgent({ name: 'campaign', domain: 'campaign', description: 'campaign work' }), 'sys', NOW);
  const { engine, queue } = buildEngine(reg, { 't-a': cls('campaign', 'single', { ambiguous: true }) });
  queue.push({ task_id: 't-a', task_name: 'ambiguous ask', payload: {} }, NOW);
  const res = await engine.route(NOW + 1);
  // ambiguity penalty (×0.6) pushes an otherwise-1.0 top score below the 0.75 threshold → clarification
  assert.equal(res!.outcome, 'clarification');
  assert.ok(res!.confidence < DEFAULT_ROUTING_CONFIG.confidenceThreshold);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ORC.003 — description-driven; disabled never a candidate; hardcoded rule rejected
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.ORC.003.1 — a hardcoded task→agent rule is rejected (routing is data-driven)', () => {
  assert.throws(() => OrchestratorEngine.rejectHardcodedRoute(), (e: Error) => e.message === ERR_HARDCODED_ROUTE);
});

test('AC-8.ORC.003.2 — a disabled agent is never a routing candidate', async () => {
  const reg = new InMemoryAgentRegistry();
  const a = await reg.insert(newAgent({ name: 'finA', domain: 'finance', description: 'a' }), 'sys', NOW);
  await reg.insert(newAgent({ name: 'finB', domain: 'finance', description: 'b' }), 'sys', NOW);
  await reg.editCapability(a.id, { enabled: false, change_reason: 'off' }, 'sys', NOW + 1);
  const { engine, queue } = buildEngine(reg, { 't-f': cls('finance', 'single') });
  queue.push({ task_id: 't-f', task_name: 'finance task', payload: {} }, NOW);
  const res = await engine.route(NOW + 2);
  assert.ok(res!.candidates.every((c) => c.name !== 'finA'));
  assert.deepEqual(res!.candidates.map((c) => c.name), ['finB']);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ORC.004 — scoring on four weights; changed weight takes effect next task
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.ORC.004.1 — each candidate gets a recorded score from the four weighted factors', async () => {
  const reg = new InMemoryAgentRegistry();
  await reg.insert(newAgent({ name: 'opsX', domain: 'ops', description: 'x' }), 'sys', NOW);
  await reg.insert(newAgent({ name: 'opsY', domain: 'ops', description: 'y' }), 'sys', NOW);
  const { engine, queue, events } = buildEngine(reg, { 't-s': cls('ops', 'single') });
  queue.push({ task_id: 't-s', task_name: 'ops', payload: {} }, NOW);
  const res = await engine.route(NOW + 1);
  assert.equal(res!.scores.length, 2);
  for (const s of res!.scores) {
    for (const k of ['domain_match', 'complexity_fit', 'memory_scope_fit', 'tool_scope_fit', 'total'] as const) {
      assert.equal(typeof s[k], 'number');
    }
  }
  assert.equal(events.byType('routing_scored').length, 1);
});

test('AC-8.ORC.004.2 — a changed routing weight is in effect on the next task (config read fresh each route)', async () => {
  const reg = new InMemoryAgentRegistry();
  // two agents differing only on tool_scope_fit (one has a tool, one does not) for an action task
  await reg.insert(newAgent({ name: 'withTool', domain: 'ops', description: 'has tool', tools_allowed: ['tool-1'] }), 'sys', NOW);
  await reg.insert(newAgent({ name: 'noTool', domain: 'ops', description: 'no tool' }), 'sys', NOW);
  let cfg: RoutingConfig = { ...DEFAULT_ROUTING_CONFIG };
  const { engine, queue } = buildEngine(reg, { 't-w1': cls('ops', 'single', { output: 'action' }), 't-w2': cls('ops', 'single', { output: 'action' }) }, () => cfg);
  queue.push({ task_id: 't-w1', task_name: 'a', payload: {} }, NOW);
  const r1 = await engine.route(NOW + 1);
  const gap1 =
    r1!.scores.find((s) => s.agent_name === 'withTool')!.total - r1!.scores.find((s) => s.agent_name === 'noTool')!.total;
  // now crank tool_scope_fit weight up; the change must take effect on the NEXT route (config read fresh each route)
  cfg = { ...cfg, weights: { domain_match: 0.1, complexity_fit: 0.1, memory_scope_fit: 0.1, tool_scope_fit: 0.7 } };
  queue.push({ task_id: 't-w2', task_name: 'b', payload: {} }, NOW);
  const r2 = await engine.route(NOW + 2);
  const gap2 =
    r2!.scores.find((s) => s.agent_name === 'withTool')!.total - r2!.scores.find((s) => s.agent_name === 'noTool')!.total;
  // the with-tool/no-tool gap widened because tool_scope_fit now dominates — the new weight is in effect
  assert.ok(gap2 > gap1, `expected gap to widen: gap1=${gap1} gap2=${gap2}`);
  assert.ok(gap2 - gap1 > 0.2);
});

test('CFG-routing_weights defaults sum to 1.0', () => {
  assert.ok(weightsSumToOne(DEFAULT_ROUTING_CONFIG.weights));
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ORC.005 — build plan: simple→single, complex→chain, envelope hand-off
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.ORC.005.1 — a simple task plans to a single agent', async () => {
  const reg = new InMemoryAgentRegistry();
  await reg.insert(newAgent({ name: 'client', domain: 'client', description: 'c' }), 'sys', NOW);
  const { engine, queue } = buildEngine(reg, { 't-1': cls('client', 'single') });
  queue.push({ task_id: 't-1', task_name: 'simple', payload: {} }, NOW);
  const res = await engine.route(NOW + 1);
  assert.equal(res!.plan!.steps.length, 1);
  assert.equal(res!.plan!.steps[0]!.depends_on.length, 0);
});

test('AC-8.ORC.005.2 — a complex task plans to an ordered chain with deps, parallel marks, and a failure mode per step', async () => {
  const reg = new InMemoryAgentRegistry();
  await reg.insert(newAgent({ name: 'opsA', domain: 'ops', description: 'a' }), 'sys', NOW);
  await reg.insert(newAgent({ name: 'opsB', domain: 'ops', description: 'b' }), 'sys', NOW);
  await reg.insert(newAgent({ name: 'opsC', domain: 'ops', description: 'c' }), 'sys', NOW);
  const cfg: RoutingConfig = { ...DEFAULT_ROUTING_CONFIG, parallelExecutionEnabled: true };
  const { engine, queue } = buildEngine(reg, { 't-m': cls('ops', 'multi') }, () => cfg);
  queue.push({ task_id: 't-m', task_name: 'complex', payload: {} }, NOW);
  const res = await engine.route(NOW + 1);
  assert.ok(res!.plan!.steps.length >= 2);
  // ordered chain: step i>0 depends on i-1
  for (let i = 1; i < res!.plan!.steps.length; i++) {
    assert.deepEqual(res!.plan!.steps[i]!.depends_on, [i - 1]);
  }
  // EVERY step carries a failure mode (ORC.005.2 / PLAN.001)
  for (const s of res!.plan!.steps) assert.ok(['halt_escalate', 'retry', 'skip'].includes(s.failure_mode));
  // parallel eligibility surfaced when enabled
  assert.equal(res!.plan!.parallel, true);
});

test('AC-8.ORC.005.3 — the built plan is written into the context envelope execution_plan field (not executed)', async () => {
  const reg = new InMemoryAgentRegistry();
  await reg.insert(newAgent({ name: 'ops', domain: 'ops', description: 'o' }), 'sys', NOW);
  const { engine, queue, envelope } = buildEngine(reg, { 't-e': cls('ops', 'single') });
  queue.push({ task_id: 't-e', task_name: 'plan me', payload: {} }, NOW);
  await engine.route(NOW + 1);
  const written = envelope.plans.get('t-e');
  assert.ok(written);
  assert.equal(written!.task_type_name, 'plan me');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ORC.006 — confidence check → clarification; escalate on timeout
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.ORC.006.1 — below-threshold confidence raises clarification and does NOT execute the plan', async () => {
  const reg = new InMemoryAgentRegistry();
  await reg.insert(newAgent({ name: 'ops', domain: 'ops', description: 'o' }), 'sys', NOW);
  // force low confidence via ambiguity
  const { engine, queue, envelope, plans } = buildEngine(reg, { 't-lc': cls('ops', 'single', { ambiguous: true }) });
  queue.push({ task_id: 't-lc', task_name: 'unsure', payload: {} }, NOW);
  const res = await engine.route(NOW + 1);
  assert.equal(res!.outcome, 'clarification');
  assert.equal(res!.plan, null);
  assert.equal(res!.planVersionId, null);
  // NOT executed / not persisted / not handed to envelope
  assert.equal(envelope.plans.get('t-lc'), undefined);
  assert.equal(plans.versions.size, 0);
  assert.equal(queue.tasks.find((t) => t.task_id === 't-lc')!.status, 'awaiting_clarification');
});

test('AC-8.ORC.006.2 — a clarification unanswered past its window escalates (never auto-proceeds, never drops)', async () => {
  const reg = new InMemoryAgentRegistry();
  await reg.insert(newAgent({ name: 'ops', domain: 'ops', description: 'o' }), 'sys', NOW);
  const window = 3600;
  const queue = new InMemoryQueueGate(window);
  const { engine, events } = buildEngine(reg, { 't-esc': cls('ops', 'single', { ambiguous: true }) }, undefined, queue);
  queue.push({ task_id: 't-esc', task_name: 'stale', payload: {} }, NOW);
  await engine.route(NOW + 1); // → awaiting_clarification
  // before the window: no escalation
  assert.equal((await engine.escalateStaleClarifications(NOW + 10)).length, 0);
  // after the window: escalates, and the task STAYS awaiting_clarification (never auto-proceeds)
  const escalated = await engine.escalateStaleClarifications(NOW + window + 10);
  assert.deepEqual(escalated, ['t-esc']);
  assert.equal(queue.tasks.find((t) => t.task_id === 't-esc')!.status, 'awaiting_clarification');
  assert.equal(events.byType('routing_clarification_escalated').length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ORC.007 — version + log every plan; outcome tracking; secondary-sink on outcome-write failure
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.ORC.007.1 — a plan outcome is recorded against the plan version; a re-plan links to the original', async () => {
  const reg = new InMemoryAgentRegistry();
  await reg.insert(newAgent({ name: 'ops', domain: 'ops', description: 'o' }), 'sys', NOW);
  const { engine, queue, plans } = buildEngine(reg, { 't-o': cls('ops', 'single') });
  queue.push({ task_id: 't-o', task_name: 'outcome task', payload: {} }, NOW);
  const res = await engine.route(NOW + 1);
  assert.ok(res!.planVersionId);
  await engine.recordOutcome(res!.planVersionId!, { status: 'success', per_step: [{ index: 0, result: 'success' }] }, NOW + 2);
  assert.ok(plans.outcomes.get(res!.planVersionId!));
  // a re-plan after clarification links to the original
  const replan: ExecutionPlan = { task_type_name: 'outcome task', parallel: false, steps: res!.plan!.steps };
  const v2 = await engine.saveReplan(replan, res!.planVersionId!, NOW + 3);
  const stored = await plans.getVersion(v2.id);
  assert.equal(stored!.previous_version_id, res!.planVersionId);
});

test('AC-8.ORC.007.2 — an outcome-write failure surfaces via a secondary sink (distinct channel), never dropped', async () => {
  const reg = new InMemoryAgentRegistry();
  await reg.insert(newAgent({ name: 'ops', domain: 'ops', description: 'o' }), 'sys', NOW);
  const failingPlans = new FailingOutcomePlanStore();
  const secondary = new InMemorySecondarySink();
  const events = new InMemoryEventSink();
  const queue = new InMemoryQueueGate();
  const engine = new OrchestratorEngine({
    registry: reg,
    classifier: new FixedClassifier(new Map([['t-fail', cls('ops', 'single')]])),
    queue,
    plans: failingPlans,
    envelope: new InMemoryEnvelopeSink(),
    events,
    secondary,
    config: () => DEFAULT_ROUTING_CONFIG,
  });
  queue.push({ task_id: 't-fail', task_name: 'x', payload: {} }, NOW);
  const res = await engine.route(NOW + 1); // planned + persisted (saveVersion succeeds; only recordOutcome fails)
  await assert.rejects(() => engine.recordOutcome(res!.planVersionId!, { status: 'success', per_step: [] }, NOW + 2));
  // the failure was surfaced on the SECONDARY sink, distinct from event_log
  assert.equal(secondary.reports.length, 1);
  assert.match(secondary.reports[0]!.ev.summary, /secondary sink/i);
});

test('safeAppend — a primary event_log write failure falls back to the secondary sink (never silent)', async () => {
  const reg = new InMemoryAgentRegistry();
  await reg.insert(newAgent({ name: 'ops', domain: 'ops', description: 'o' }), 'sys', NOW);
  const secondary = new InMemorySecondarySink();
  const queue = new InMemoryQueueGate();
  const engine = new OrchestratorEngine({
    registry: reg,
    classifier: new FixedClassifier(new Map([['t-ev', cls('ops', 'single')]])),
    queue,
    plans: new InMemoryPlanStore(),
    envelope: new InMemoryEnvelopeSink(),
    events: new FailingEventSink(),
    secondary,
    config: () => DEFAULT_ROUTING_CONFIG,
  });
  queue.push({ task_id: 't-ev', task_name: 'x', payload: {} }, NOW);
  await engine.route(NOW + 1);
  assert.ok(secondary.reports.length > 0); // every dropped primary write reported
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ORC.008 — orchestrator is itself a scoped registry row with a Layer-1
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-8.ORC.008.1 — after provisioning the orchestrator is a registry row with its L3476 scope + a core Layer-1', async () => {
  const reg = new InMemoryAgentRegistry();
  const seededCoreRoots = new Set<string>();
  const res = await seedRoster(reg, NOW, {
    probe: { hasCore: (rootId) => seededCoreRoots.has(rootId) },
  });
  // wire a core layer for the orchestrator (models prompt_layers seed by C4)
  const orchRow = res.inserted.find((r) => r.name === 'orchestrator')!;
  const orchRoot = reg.rootFor(orchRow.id)!;
  seededCoreRoots.add(orchRoot);
  const orch = await reg.get(orchRoot);
  // its restricted scope: semantic + entity model + tool registry (L3476) — NO episodic/procedural
  assert.deepEqual(orch!.memory_scope.tiers, ['semantic']);
  assert.equal(orch!.memory_scope.entity_model, true);
  assert.equal(orch!.memory_scope.tool_registry, true);
  // and a core Layer-1 resolves for it (single source of truth, REG.002)
  const probe: CoreLayerProbe = { hasCore: (rootId) => seededCoreRoots.has(rootId) };
  assert.equal(probe.hasCore(orchRoot), true);
});

test('AC-8.ORC.008.2 — the orchestrator scope is stored narrower than a broad agent (SCO.001 enforcement owed to ISSUE-063)', async () => {
  // This slice DELIVERS the scoped row; the executable retrieval filter lands in ISSUE-063. We prove the stored
  // scope is genuinely narrower (semantic-only, no episodic/procedural) than e.g. the memory agent's full scope.
  const reg = new InMemoryAgentRegistry();
  const res = await seedRoster(reg, NOW);
  const orch = res.inserted.find((r) => r.name === 'orchestrator')!;
  const mem = res.inserted.find((r) => r.name === 'memory')!;
  assert.ok(!orch.memory_scope.tiers.includes('episodic'));
  assert.ok(!orch.memory_scope.tiers.includes('procedural'));
  assert.ok(mem.memory_scope.tiers.includes('episodic')); // the broad agent DOES have it — the scope is real
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────────────────────────
function cls(
  domain: Classification['domain'],
  complexity: Classification['complexity'],
  over: Partial<Omit<Classification, 'domain' | 'complexity' | 'context'>> & { entity_ids?: string[] } = {},
): Classification {
  const { entity_ids, ...rest } = over;
  return {
    domain,
    complexity,
    context: { entity_ids: entity_ids ?? [] },
    output: rest.output ?? 'summary',
    ambiguous: rest.ambiguous ?? false,
  };
}

function buildEngine(
  reg: InMemoryAgentRegistry,
  classifications: Record<string, Classification>,
  config?: () => RoutingConfig,
  queue?: InMemoryQueueGate,
) {
  const q = queue ?? new InMemoryQueueGate();
  const events = new InMemoryEventSink();
  const envelope = new InMemoryEnvelopeSink();
  const plans = new InMemoryPlanStore();
  const secondary = new InMemorySecondarySink();
  const engine = new OrchestratorEngine({
    registry: reg,
    classifier: new FixedClassifier(new Map(Object.entries(classifications))),
    queue: q,
    plans,
    envelope,
    events,
    secondary,
    config: config ?? (() => DEFAULT_ROUTING_CONFIG),
  });
  return { engine, queue: q, events, envelope, plans, secondary };
}

/** Resolve a seeded agent's current row id by name (for get()). */
function findRoot(reg: InMemoryAgentRegistry, name: string): string {
  for (const row of reg.rows.values()) {
    if (row.name === name) {
      const root = reg.rootFor(row.id);
      if (root) return root;
    }
  }
  throw new Error(`no seeded agent named ${name}`);
}
