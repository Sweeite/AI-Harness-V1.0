// ISSUE-068 (C9 MODE) — the policy-layer AC suite. One test per §4 Definition-of-done AC where practical.
// Pure, no DB: proves the #2 invariants (floor holds regardless of config; no floored action reaches Act;
// ambiguous → floored; Act unreachable in the matrix) offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assignMode,
  capMode,
  resolveSubType,
  tierToMode,
  validateMatrixEdit,
  EMPTY_AUTONOMY_MATRIX,
  FLOORED_SUBTYPES,
  PROACTIVITY_MODES,
  RISK_SUBTYPES,
  type AutonomyMatrix,
  type ProactivityMode,
} from './modes.ts';

const FORCE_ACT: AutonomyMatrix = { ceilingFor: () => 'act' };

// ── AC-9.MODE.001.1 — exactly one mode ∈ {suggest, prepare, act} is recorded. ───────────────────────────
test('AC-9.MODE.001.1 — assignMode returns exactly one valid proactive_mode', () => {
  const cases = [
    { hasAction: false },
    { hasAction: true, tier: 'auto' as const },
    { hasAction: true, tier: 'soft' as const },
    { hasAction: true, tier: 'hard' as const },
    { hasAction: true, tier: 'auto' as const, subType: 'financial_operation' as const },
  ];
  for (const c of cases) {
    const d = assignMode(c);
    assert.ok((PROACTIVITY_MODES as readonly string[]).includes(d.mode), `mode '${d.mode}' must be a valid proactive_mode`);
  }
});

// ── AC-9.MODE.001.2 — indeterminate mode defaults to Suggest, never Act. ─────────────────────────────────
test('AC-9.MODE.001.2 — tier unavailable / pure-insight → Suggest, never Act', () => {
  assert.equal(assignMode({ hasAction: true, tier: undefined }).mode, 'suggest'); // tier unavailable
  assert.equal(assignMode({ hasAction: false }).mode, 'suggest'); // pure-insight, no action
  // never silently Act on indeterminacy:
  assert.notEqual(assignMode({ hasAction: true, tier: undefined }).mode, 'act');
});

// ── AC-9.MODE.002.1 — auto → Act; hard → Suggest/Prepare, never Act. ─────────────────────────────────────
test('AC-9.MODE.002.1 — mode mapped from C6 tier (auto→Act, hard→never Act)', () => {
  // low-risk auto-approve, non-floored INTERNAL action → Act.
  assert.equal(assignMode({ hasAction: true, tier: 'auto' }).mode, 'act');
  // high-risk hard-approval → Suggest (no prepared draft) or Prepare (draft ready) — never Act.
  assert.equal(assignMode({ hasAction: true, tier: 'hard' }).mode, 'suggest');
  assert.equal(assignMode({ hasAction: true, tier: 'hard', preparedDraft: true }).mode, 'prepare');
  assert.notEqual(assignMode({ hasAction: true, tier: 'hard', preparedDraft: true }).mode, 'act');
  // soft → Prepare.
  assert.equal(assignMode({ hasAction: true, tier: 'soft' }).mode, 'prepare');
  // tierToMode direct mapping:
  assert.equal(tierToMode('auto'), 'act');
  assert.equal(tierToMode('soft'), 'prepare');
  assert.equal(tierToMode('hard'), 'suggest');
  assert.equal(tierToMode(undefined), 'suggest');
});

// ── AC-9.MODE.002.2 — a floored-set action is NEVER assigned Act (the load-bearing #2). ──────────────────
test('AC-9.MODE.002.2 — a floored sub-type is never Act, even under auto tier + an Act-forcing matrix', () => {
  for (const s of FLOORED_SUBTYPES) {
    const d = assignMode({ hasAction: true, tier: 'auto', subType: s, matrix: FORCE_ACT });
    assert.notEqual(d.mode, 'act', `floored sub-type '${s}' must never be Act`);
    assert.equal(d.floored, true);
    assert.equal(d.mode, 'prepare'); // capped at the hard-approval floor's Prepare ceiling
  }
});

// ── AC-9.MODE.004.1 — matrix accepts no value above Prepare (no Act) for ANY sub-type. ───────────────────
test('AC-9.MODE.004.1 — validateMatrixEdit rejects Act for every sub-type; low-risk-external ≤ Prepare accepted', () => {
  for (const s of RISK_SUBTYPES) {
    assert.equal(validateMatrixEdit(s, 'act').ok, false, `Act must be rejected for '${s}'`);
  }
  // low_risk_external_nonclient is editable between Suggest and Prepare (per FR-9.MODE.004.1).
  assert.equal(validateMatrixEdit('low_risk_external_nonclient', 'suggest').ok, true);
  assert.equal(validateMatrixEdit('low_risk_external_nonclient', 'prepare').ok, true);
});

// ── AC-9.MODE.004.2 — setting a floored sub-type below hard-approval is rejected at write. ───────────────
test('AC-9.MODE.004.2 — validateMatrixEdit rejects any floored-sub-type edit (floor holds at write)', () => {
  for (const s of FLOORED_SUBTYPES) {
    for (const m of ['suggest', 'prepare', 'act'] as ProactivityMode[]) {
      const r = validateMatrixEdit(s, m);
      assert.equal(r.ok, false, `floored '${s}' → '${m}' must be rejected`);
      assert.ok(r.error && r.error.length > 0, 'a rejection must carry a non-empty reason (#3)');
    }
  }
});

// ── AC-9.MODE.004.3 — a sub-type that cannot be proven non-client/low-risk → floored (hard), never lowered. ─
test('AC-9.MODE.004.3 — ambiguous recipient → floored; assignMode caps it', () => {
  // external comm, recipient cannot be proven a non-client → floored.
  const amb = resolveSubType({ isExternalComm: true, recipientIsClient: undefined });
  assert.equal(amb.floored, true);
  assert.equal(amb.ambiguous, true);
  assert.equal(amb.subType, 'existing_client_external');
  // proven non-client → low-risk-external, NOT floored.
  const proven = resolveSubType({ isExternalComm: true, recipientIsClient: false });
  assert.equal(proven.floored, false);
  assert.equal(proven.subType, 'low_risk_external_nonclient');
  // and the ambiguous one, mode-assigned under auto tier + Act-forcing matrix, never reaches Act:
  const d = assignMode({ hasAction: true, tier: 'auto', subType: amb.subType, ambiguous: amb.ambiguous, matrix: FORCE_ACT });
  assert.notEqual(d.mode, 'act');
  assert.equal(d.floored, true);
});

// ── AC-9.MODE.004.5 (gate M4) — the floor caps the mode regardless of matrix OR the indeterminate default. ─
test('AC-9.MODE.004.5 — the floor always wins over the matrix and over the default', () => {
  // matrix says Act, tier says auto (base Act) → floor caps to Prepare.
  const overMatrix = assignMode({ hasAction: true, tier: 'auto', subType: 'financial_operation', matrix: FORCE_ACT });
  assert.equal(overMatrix.mode, 'prepare');
  assert.equal(overMatrix.cappedBy, 'floor');
  // even ambiguity-forced floor over an Act-forcing matrix:
  const overDefault = assignMode({ hasAction: true, tier: 'auto', ambiguous: true, matrix: FORCE_ACT });
  assert.equal(overDefault.mode, 'prepare');
  assert.equal(overDefault.floored, true);
});

// ── The non-floored low-risk-external ceiling actually caps (matrix Suggest lowers a soft-tier Prepare). ──
test('low-risk-external matrix ceiling caps the base mode (Suggest ceiling < Prepare base)', () => {
  const matrix: AutonomyMatrix = { ceilingFor: (s) => (s === 'low_risk_external_nonclient' ? 'suggest' : undefined) };
  // soft tier → base Prepare, but the operator set the ceiling to Suggest → capped to Suggest.
  const d = assignMode({ hasAction: true, tier: 'soft', subType: 'low_risk_external_nonclient', matrix });
  assert.equal(d.mode, 'suggest');
  assert.equal(d.cappedBy, 'matrix');
  // with no matrix entry, low-risk-external defaults to the Prepare ceiling → soft base Prepare stands.
  const d2 = assignMode({ hasAction: true, tier: 'soft', subType: 'low_risk_external_nonclient', matrix: EMPTY_AUTONOMY_MATRIX });
  assert.equal(d2.mode, 'prepare');
});

// ── An internal (no sub-type) auto-tier action MAY be Act — the matrix only caps the five sub-types. ─────
test('internal auto-tier action (no sub-type) may be Act — no matrix cap applies', () => {
  const d = assignMode({ hasAction: true, tier: 'auto', subType: undefined });
  assert.equal(d.mode, 'act');
  assert.equal(d.floored, false);
});

// ── capMode is a lower-bound (ceiling) operator. ────────────────────────────────────────────────────────
test('capMode returns the less-autonomous of base and ceiling', () => {
  assert.equal(capMode('act', 'prepare'), 'prepare');
  assert.equal(capMode('prepare', 'act'), 'prepare');
  assert.equal(capMode('suggest', 'act'), 'suggest');
  assert.equal(capMode('prepare', 'suggest'), 'suggest');
});
