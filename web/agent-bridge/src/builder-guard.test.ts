// ISSUE-067 (surface-09 · UI-AGENT-BUILDER) — the AC harness for the Builder save-guard. Each test names the AC-*
// it proves (Definition of done, ISSUE-067 §4) and FAILS on regression. Covers: REG.004.1 (change_reason),
// REG.001.2 (description), SCO.003.1 (invalid memory_scope), SPC.003.3/.004.3/.005.2 (reject-at-write hard limits),
// OD-140 greyed-picker parity, plus two verifier-fix regressions:
//   • FINDING 4 — validateMemoryScope must ACCEPT the seeded fail-closed '{}' default (guard/seed non-drift).
//   • FINDING 5 — the live save path (liveToolRows) must FAIL-CLOSED: an unclassified write tool / unknown id is
//     DENIED, not allowed through the fail-open reference classifier.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateBuilderSave,
  validateMemoryScope,
  toolPickerOptions,
  BUILDER_REJECT_CODES,
  type BuilderSaveInput,
} from './builder-guard.ts';
import {
  InMemoryToolClassifier,
  evaluateToolsAllowed,
  forbiddenReason,
  CLASS_MEMORY_WRITE,
  CLASS_AUTONOMOUS_SEND,
  CLASS_TRANSACTION,
  type LiveToolRow,
} from '../../../app/specialists/src/store.ts';
import { COMMS, FINANCE, MEMORY, RESEARCH } from '../../../app/specialists/src/specialists.ts';
import { MEMORY_TIERS } from '../../../app/orchestrator/src/registry.ts';

// A fully-populated reference classifier (the offline-fake model: every named forbidden tool is tagged).
const SEND_TOOL = 'tool-send-0001';
const TXN_TOOL = 'tool-txn-0001';
const MEMWRITE_TOOL = 'tool-memwrite-0001';
const READ_TOOL = 'tool-read-0001';

function classifier(): InMemoryToolClassifier {
  return new InMemoryToolClassifier([
    [SEND_TOOL, CLASS_AUTONOMOUS_SEND],
    [TXN_TOOL, CLASS_TRANSACTION],
    [MEMWRITE_TOOL, CLASS_MEMORY_WRITE],
  ]);
}

/** A minimal valid save input; individual tests override the fields under test. */
function base(over: Partial<BuilderSaveInput> = {}): BuilderSaveInput {
  return {
    role: RESEARCH,
    change_reason: 'test reason',
    classifier: classifier(),
    ...over,
  };
}

// ── AC-8.REG.004.1 — a save without a change_reason is rejected at write. ────────────────────────────────
test('AC-8.REG.004.1 · empty change_reason is rejected', () => {
  const v = evaluateBuilderSave(base({ change_reason: '' }));
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.CHANGE_REASON_REQUIRED);
  assert.equal(v.ok === false && v.field, 'change_reason');
});

test('AC-8.REG.004.1 · whitespace-only change_reason is rejected (not merely non-empty string)', () => {
  const v = evaluateBuilderSave(base({ change_reason: '   ' }));
  assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.CHANGE_REASON_REQUIRED);
});

// ── AC-8.REG.001.2 — description required at insert / non-empty when supplied. ───────────────────────────
test('AC-8.REG.001.2 · descriptionRequired with no description is rejected', () => {
  const v = evaluateBuilderSave(base({ descriptionRequired: true }));
  assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.DESCRIPTION_REQUIRED);
  assert.equal(v.ok === false && v.field, 'description');
});

test('AC-8.REG.001.2 · an empty description supplied on any edit is rejected', () => {
  const v = evaluateBuilderSave(base({ description: '   ' }));
  assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.DESCRIPTION_REQUIRED);
});

test('AC-8.REG.001.2 · a capability-only edit (description untouched) is NOT rejected for description', () => {
  const v = evaluateBuilderSave(base({ memory_scope: { tiers: ['semantic'], entity_model: true, tool_registry: false } }));
  assert.equal(v.ok, true);
});

// ── AC-8.SCO.003.1 — an invalid memory_scope is rejected at write. ──────────────────────────────────────
test('AC-8.SCO.003.1 · a well-formed memory_scope is accepted', () => {
  const v = evaluateBuilderSave(base({ memory_scope: { tiers: ['semantic', 'episodic'], entity_model: true, tool_registry: true, note: 'ok' } }));
  assert.equal(v.ok, true);
});

test('AC-8.SCO.003.1 · malformed memory_scope shapes are each rejected at write', () => {
  const bad: unknown[] = [
    null,
    [],
    'semantic',
    42,
    { tiers: 'semantic' }, // tiers not an array
    { tiers: ['bogus'] }, // unknown tier
    { tiers: ['semantic', 'semantic'] }, // duplicate tier
    { tiers: [], entity_model: 1 }, // wrong-typed present field
    { tiers: [], tool_registry: 'yes' }, // wrong-typed present field
    { note: 5 }, // wrong-typed note
  ];
  for (const scope of bad) {
    const v = evaluateBuilderSave(base({ memory_scope: scope }));
    assert.equal(v.ok, false, `expected reject for ${JSON.stringify(scope)}`);
    assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.INVALID_MEMORY_SCOPE, `expected INVALID_MEMORY_SCOPE for ${JSON.stringify(scope)}`);
  }
});

// ── FINDING 4 (regression) — the seeded fail-closed '{}' default must be VALID. ─────────────────────────
test('FINDING-4 · validateMemoryScope ACCEPTS the seeded fail-closed {} default (guard/seed non-drift)', () => {
  const v = validateMemoryScope({});
  assert.equal(v.ok, true, `guard must accept the seeded '{}' scope, got: ${v.ok === false ? v.reason : ''}`);
  // normalised to the full fail-closed narrow shape (retrieves nothing).
  assert.deepEqual(v.ok === true && v.scope, { tiers: [], entity_model: false, tool_registry: false });
});

test('FINDING-4 · a Builder capability edit round-tripping a seed agent\'s {} scope is NOT rejected', () => {
  const v = evaluateBuilderSave(base({ memory_scope: {} }));
  assert.equal(v.ok, true, 'round-tripping the seeded {} scope through the Builder must be allowed');
});

test('FINDING-4 · partial scopes default missing fields fail-closed (narrow-is-valid)', () => {
  const v = validateMemoryScope({ tiers: ['semantic'] });
  assert.equal(v.ok, true);
  assert.deepEqual(v.ok === true && v.scope, { tiers: ['semantic'], entity_model: false, tool_registry: false });
});

// ── AC-8.SPC.003.3 / .004.3 / .005.2 — reject-at-write hard limits (reference classifier). ──────────────
test('AC-8.SPC.003.3 · Comms + an autonomous-send tool is rejected at write', () => {
  const v = evaluateBuilderSave(base({ role: COMMS, tools_allowed: [SEND_TOOL] }));
  assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.FORBIDDEN_CAPABILITY);
  assert.equal(v.ok === false && v.forbidden?.tool_class, CLASS_AUTONOMOUS_SEND);
});

test('AC-8.SPC.004.3 · Finance + a transaction tool is rejected at write', () => {
  const v = evaluateBuilderSave(base({ role: FINANCE, tools_allowed: [TXN_TOOL] }));
  assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.FORBIDDEN_CAPABILITY);
  assert.equal(v.ok === false && v.forbidden?.tool_class, CLASS_TRANSACTION);
});

test('AC-8.SPC.005.2 · a non-Memory agent + a memory-write tool is rejected; Memory holding it is allowed', () => {
  const denied = evaluateBuilderSave(base({ role: RESEARCH, tools_allowed: [MEMWRITE_TOOL] }));
  assert.equal(denied.ok === false && denied.forbidden?.tool_class, CLASS_MEMORY_WRITE);
  const allowed = evaluateBuilderSave(base({ role: MEMORY, tools_allowed: [MEMWRITE_TOOL] }));
  assert.equal(allowed.ok, true, 'the Memory Agent is the sole legitimate holder of memory-write');
});

// ── OD-140 — the greyed-picker reason is byte-identical to the save-time deny reason. ───────────────────
test('OD-140 · toolPickerOptions greys a forbidden tool with the SAME reason the save-time deny logs', () => {
  const opts = toolPickerOptions(COMMS, [SEND_TOOL, READ_TOOL], classifier());
  const send = opts.find((o) => o.toolId === SEND_TOOL)!;
  assert.equal(send.forbidden, true);
  assert.equal(send.reason, forbiddenReason(COMMS, SEND_TOOL, CLASS_AUTONOMOUS_SEND));
  const read = opts.find((o) => o.toolId === READ_TOOL)!;
  assert.equal(read.forbidden, false);
});

// ── FINDING 5 (regression) — the live save path is FAIL-CLOSED. ─────────────────────────────────────────
test('FINDING-5 · the fail-open reference lets an UNCLASSIFIED write tool through (documents the gap)', () => {
  // No liveToolRows, and the classifier does not know this tool → classOf → null → fail-open ALLOW. This is the
  // exact fail-open the live path exists to close; asserting it keeps the two paths honestly distinct.
  const v = evaluateBuilderSave(base({ role: RESEARCH, tools_allowed: ['tool-untagged-write'] }));
  assert.equal(v.ok, true);
  // sanity: the underlying reference kernel is indeed fail-open on an unclassified id.
  assert.equal(evaluateToolsAllowed(RESEARCH, ['tool-untagged-write'], classifier()), null);
});

test('FINDING-5 · with liveToolRows, an UNCLASSIFIED write tool is DENIED (fail-closed)', () => {
  const rows: LiveToolRow[] = [{ id: 'tool-untagged-write', category: 'write', klass: null }];
  const v = evaluateBuilderSave(base({ role: RESEARCH, tools_allowed: ['tool-untagged-write'], liveToolRows: rows }));
  assert.equal(v.ok, false, 'an untagged write grant must not pass the live Builder gate');
  assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.UNCERTIFIABLE_CAPABILITY);
  assert.equal(v.ok === false && v.uncertifiable?.kind, 'unclassified_write');
});

test('FINDING-5 · with liveToolRows, an UNKNOWN tool id is DENIED (fail-closed)', () => {
  const rows: LiveToolRow[] = []; // id not present in tools
  const v = evaluateBuilderSave(base({ role: RESEARCH, tools_allowed: ['tool-ghost'], liveToolRows: rows }));
  assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.UNCERTIFIABLE_CAPABILITY);
  assert.equal(v.ok === false && v.uncertifiable?.kind, 'unknown_tool');
});

test('FINDING-5 · the live path still fires the recognized-forbidden deny (memory-write to non-Memory)', () => {
  const rows: LiveToolRow[] = [{ id: MEMWRITE_TOOL, category: 'write', klass: CLASS_MEMORY_WRITE }];
  const v = evaluateBuilderSave(base({ role: RESEARCH, tools_allowed: [MEMWRITE_TOOL], liveToolRows: rows }));
  assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.FORBIDDEN_CAPABILITY);
  assert.equal(v.ok === false && v.forbidden?.tool_class, CLASS_MEMORY_WRITE);
});

test('FINDING-5 · the live path ALLOWS a provably-benign read tool + a correctly-tagged Memory grant', () => {
  const rows: LiveToolRow[] = [
    { id: READ_TOOL, category: 'read', klass: null },
    { id: MEMWRITE_TOOL, category: 'write', klass: CLASS_MEMORY_WRITE },
  ];
  const v = evaluateBuilderSave(base({ role: MEMORY, tools_allowed: [READ_TOOL, MEMWRITE_TOOL], liveToolRows: rows }));
  assert.equal(v.ok, true);
});

// ── A fully-clean save returns ok. ──────────────────────────────────────────────────────────────────────
test('a fully-valid save (all fields) returns ok', () => {
  const rows: LiveToolRow[] = [{ id: READ_TOOL, category: 'read', klass: null }];
  const v = evaluateBuilderSave(
    base({
      role: RESEARCH,
      description: 'gathers info',
      descriptionRequired: true,
      memory_scope: { tiers: [...MEMORY_TIERS], entity_model: true, tool_registry: true },
      tools_allowed: [READ_TOOL],
      liveToolRows: rows,
      change_reason: 'grant the read tool',
    }),
  );
  assert.equal(v.ok, true);
});
