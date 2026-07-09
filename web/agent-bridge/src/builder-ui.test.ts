// ISSUE-067 (surface-09) — the AC harness for the Builder render's PURE UI-logic layer (builder-ui.ts): the save
// gate the render routes every Save through, and the OD-080 authority projection the render locks capability fields
// with. Each test names the AC / OD it proves and FAILS on regression. Runs under tsx --test like the guard's 21.
//
// Covers:
//   • the save path routes through evaluateBuilderSave and BLOCKS on every reject verdict (REG.004.1 change_reason,
//     REG.001.2 description, SCO.003.1 invalid memory_scope, SPC.003.3/.004.3/.005.2 forbidden capability) — and
//     ADMITS a clean edit;
//   • the OD-080 authority matrix (OD-139a): a caller without PERM-agents.edit_capability CANNOT edit capability
//     fields (they are locked), while description tuning stays open — proving an Admin-shaped node set is read-only
//     on scope/tools/enabled/add/disable.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateStagedSave, builderAuthority, primaryHealthStale } from './builder-ui.ts';
import { BUILDER_REJECT_CODES } from './builder-guard.ts';
import {
  InMemoryToolClassifier,
  CLASS_AUTONOMOUS_SEND,
  CLASS_TRANSACTION,
  CLASS_MEMORY_WRITE,
} from '../../../app/specialists/src/store.ts';
import { COMMS, FINANCE } from '../../../app/specialists/src/specialists.ts';
import {
  PERM_AGENTS_VIEW,
  PERM_AGENTS_EDIT_DESCRIPTION,
  PERM_AGENTS_EDIT_CAPABILITY,
} from '../../../app/orchestrator/src/registry.ts';

const SEND_TOOL = 'tool-send-0001';
const TXN_TOOL = 'tool-txn-0001';
const MEMWRITE_TOOL = 'tool-memwrite-0001';
const READ_TOOL = 'tool-read-0001';

function classifier(): InMemoryToolClassifier {
  return new InMemoryToolClassifier([
    [SEND_TOOL, CLASS_AUTONOMOUS_SEND],
    [TXN_TOOL, CLASS_TRANSACTION],
    [MEMWRITE_TOOL, CLASS_MEMORY_WRITE],
    // READ_TOOL deliberately unclassified (benign).
  ]);
}

// ── The save gate routes through evaluateBuilderSave and BLOCKS on every reject. ──────────────────────────

test('save path BLOCKS an empty change_reason (AC-8.REG.004.1)', () => {
  const v = evaluateStagedSave(
    { role: 'comms', description: 'drafts client comms', change_reason: '   ' },
    classifier(),
  );
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.CHANGE_REASON_REQUIRED);
  assert.equal(v.ok === false && v.field, 'change_reason');
});

test('save path BLOCKS an empty description on insert (AC-8.REG.001.2)', () => {
  const v = evaluateStagedSave(
    { role: 'comms', descriptionRequired: true, description: '  ', change_reason: 'add agent' },
    classifier(),
  );
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.DESCRIPTION_REQUIRED);
});

test('save path BLOCKS a shape-invalid memory_scope at write (AC-8.SCO.003.1)', () => {
  const v = evaluateStagedSave(
    { role: 'comms', memory_scope: { tiers: ['not-a-tier'] }, change_reason: 'edit scope' },
    classifier(),
  );
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.INVALID_MEMORY_SCOPE);
  assert.equal(v.ok === false && v.field, 'memory_scope');
});

test('save path BLOCKS an autonomous-send tool on Comms (AC-8.SPC.003.3)', () => {
  const v = evaluateStagedSave(
    { role: COMMS, tools_allowed: [READ_TOOL, SEND_TOOL], change_reason: 'add send' },
    classifier(),
  );
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, BUILDER_REJECT_CODES.FORBIDDEN_CAPABILITY);
  assert.equal(v.ok === false && v.field, 'tools_allowed');
  assert.equal(v.ok === false && v.forbidden?.tool_id, SEND_TOOL);
});

test('save path BLOCKS a transaction tool on Finance (AC-8.SPC.004.3)', () => {
  const v = evaluateStagedSave(
    { role: FINANCE, tools_allowed: [TXN_TOOL], change_reason: 'add txn' },
    classifier(),
  );
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.forbidden?.tool_class, CLASS_TRANSACTION);
});

test('save path BLOCKS memory-write on a non-Memory agent (AC-8.SPC.005.2)', () => {
  const v = evaluateStagedSave(
    { role: 'client', tools_allowed: [MEMWRITE_TOOL], change_reason: 'add memwrite' },
    classifier(),
  );
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.forbidden?.tool_class, CLASS_MEMORY_WRITE);
});

test('save path ADMITS a clean edit (reason + valid scope + benign tools)', () => {
  const v = evaluateStagedSave(
    {
      role: 'comms',
      description: 'drafts outbound comms for human approval',
      memory_scope: { tiers: ['semantic'], entity_model: true },
      tools_allowed: [READ_TOOL],
      change_reason: 'tighten scope + add read tool',
    },
    classifier(),
  );
  assert.equal(v.ok, true);
});

// ── OD-080 authority matrix (OD-139a): capability fields locked without edit_capability. ──────────────────

test('OD-080: an Admin-shaped node set (view + edit_description, NO edit_capability) locks capability edits', () => {
  const adminNodes = new Set([PERM_AGENTS_VIEW, PERM_AGENTS_EDIT_DESCRIPTION]);
  const a = builderAuthority(adminNodes);
  assert.equal(a.canView, true, 'Admin can enter the Builder');
  assert.equal(a.canEditDescription, true, 'Admin can edit description / tuning');
  assert.equal(
    a.canEditCapability,
    false,
    'Admin must NOT be able to mutate memory_scope / tools_allowed / enabled / add / disable (OD-080 — Super-Admin-only)',
  );
});

test('OD-080: a Super-Admin-shaped node set (all three) unlocks capability edits', () => {
  const saNodes = new Set([PERM_AGENTS_VIEW, PERM_AGENTS_EDIT_DESCRIPTION, PERM_AGENTS_EDIT_CAPABILITY]);
  const a = builderAuthority(saNodes);
  assert.equal(a.canView && a.canEditDescription && a.canEditCapability, true);
});

test('OD-080 fail-closed: an empty node set locks everything (no view, no edits)', () => {
  const a = builderAuthority(new Set<string>());
  assert.equal(a.canView || a.canEditDescription || a.canEditCapability, false);
});

// ── M1 regression (AC-8.HLTH.004.2 / #3) — the primary health badge is NON-green when its data is stale-at-source.
test('AC-8.HLTH.004.2 — a stalled producer forces the primary health badge stale (never last-known-good green)', () => {
  // fresh overall read, but the metric PRODUCER is stalled → the numbers are last-known → must render non-green.
  assert.equal(primaryHealthStale({ readStale: false, producerHeartbeat: 'stalled', deadAgentFlag: false }), true);
});

test('AC-8.HLTH.003.2 — a dead-agent flag forces the primary badge stale (a 0%-success agent is never green)', () => {
  assert.equal(primaryHealthStale({ readStale: false, producerHeartbeat: 'fresh', deadAgentFlag: true }), true);
});

test('a fresh read on a live, fresh-producer agent renders the primary badge green (the only green case)', () => {
  assert.equal(primaryHealthStale({ readStale: false, producerHeartbeat: 'fresh', deadAgentFlag: false }), false);
});

test('a stale overall read also forces stale regardless of producer/dead', () => {
  assert.equal(primaryHealthStale({ readStale: true, producerHeartbeat: 'fresh', deadAgentFlag: false }), true);
});

// ── M2 regression (AC-8.REG.003.1 / REG.001.2 on insert) — the add-agent path routes the insert through the guard.
test('AC-8.REG.003.1 — add-agent with a valid description + reason PASSES the insert gate (fail-closed narrow scope)', () => {
  const v = evaluateStagedSave(
    { role: 'insight', description: 'a new specialist', tools_allowed: [], memory_scope: {}, change_reason: 'add insight agent', descriptionRequired: true },
    new InMemoryToolClassifier(new Map()),
  );
  assert.equal(v.ok, true);
});

test('AC-8.REG.001.2 on insert — add-agent with an EMPTY description is REJECTED at write', () => {
  const v = evaluateStagedSave(
    { role: 'insight', description: '   ', tools_allowed: [], memory_scope: {}, change_reason: 'add', descriptionRequired: true },
    new InMemoryToolClassifier(new Map()),
  );
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.code, BUILDER_REJECT_CODES.DESCRIPTION_REQUIRED);
});
