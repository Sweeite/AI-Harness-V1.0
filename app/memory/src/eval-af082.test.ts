// ISSUE-022 — the AF-082 entity-resolution EVAL (AC-NFR-PERF.004.1 / NFR-PERF.004). This is the `Verified` path
// for the #1 "links-not-fragments" claim: a ground-truth mention set (system-ID-bearing + free-text, name
// collisions, aliases, cross-type same-name) is run through the deterministic resolver and the outcomes are
// scored for false-merge / false-split / flagged. The binding thresholds encode the design's risk posture:
//   • FALSE-MERGE rate MUST be 0 — a false-merge collapses two real entities into cross-contamination (#2), the
//     irreversible failure; the resolver must never silently pick a wrong entity.
//   • Every genuinely AMBIGUOUS mention MUST be flagged (never silently resolved) — AC-2.ENT.005.2.
//   • FALSE-SPLIT rate is allowed but bounded — a duplicate is recoverable (FR-2.MNT.010 erosion scan + merge
//     queue), so the conservative resolver may split-and-flag rather than risk a merge.
//
// This is a seed EVAL against a hand-built ground-truth set (a scaled real-mention corpus + the AF-002 shared
// corpus is the onboarding follow-up — feasibility-register AF-082). A paper-only pass is NOT sufficient; this
// executes the resolver.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntity, type Mention, type Resolution } from './resolution.ts';
import type { EntityRow } from './store.ts';

// ── Ground-truth entity set ────────────────────────────────────────────────────────────────────
function entity(id: string, type: string, name: string, refs: Record<string, string> = {}): EntityRow {
  return { id, type, name, external_refs: refs, is_internal_org: false, maturity: null, maturity_updated_at: null, created_at: '2000-01-01T00:00:00.000Z' };
}

const ENTITIES: EntityRow[] = [
  entity('E1', 'Client', 'Acme Corporation', { ghl: 'g1' }),
  entity('E2', 'Client', 'Globex', { ghl: 'g2' }),
  entity('E3', 'Client', 'North Star'), // collides with E4 by name
  entity('E4', 'Client', 'North Star'), // a genuinely distinct "North Star" — a real name collision
  entity('E5', 'Contact', 'John Smith', { slack: 's1' }),
  entity('E6', 'Vendor/Partner', 'Acme Corporation'), // same NAME as E1 but different TYPE — must never merge with E1
];

type Expected = { kind: 'link'; entityId: string } | { kind: 'create' } | { kind: 'ambiguous' };

const CASES: { mention: Mention; expected: Expected; note: string }[] = [
  { mention: { type: 'Client', name: 'ACME', external_refs: { ghl: 'g1' } }, expected: { kind: 'link', entityId: 'E1' }, note: 'external_ref authoritative over a loose name' },
  { mention: { type: 'Client', name: 'Acme Corporation' }, expected: { kind: 'link', entityId: 'E1' }, note: 'exact name+type link (E6 is a different type)' },
  { mention: { type: 'Client', name: 'Globex', external_refs: { ghl: 'g2' } }, expected: { kind: 'link', entityId: 'E2' }, note: 'external_ref link' },
  { mention: { type: 'Client', name: 'Globex Inc' }, expected: { kind: 'create' }, note: 'conservative: "Globex Inc" != "Globex" → split-not-merge (backstopped)' },
  { mention: { type: 'Client', name: 'North Star' }, expected: { kind: 'ambiguous' }, note: 'name collides with TWO entities → must flag' },
  { mention: { type: 'Contact', name: 'John Smith', external_refs: { slack: 's1' } }, expected: { kind: 'link', entityId: 'E5' }, note: 'external_ref link (Contact)' },
  { mention: { type: 'Contact', name: 'Jon Smith' }, expected: { kind: 'link', entityId: 'E5' }, note: 'one-char alias at the 0.9 threshold → link' },
  { mention: { type: 'Vendor/Partner', name: 'Acme Corporation' }, expected: { kind: 'link', entityId: 'E6' }, note: 'same name as E1 but Vendor type → link E6, NEVER E1 (type-scoped)' },
  { mention: { type: 'Client', name: 'Brand New Client' }, expected: { kind: 'create' }, note: 'genuinely new → create' },
  { mention: { type: 'Client', name: 'conflated', external_refs: { ghl: 'g1', slack: 's1' } }, expected: { kind: 'ambiguous' }, note: 'refs point at TWO distinct entities → flag, never pick one' },
];

function classify(res: Resolution): 'link' | 'create' | 'ambiguous' {
  return res.kind === 'linked' ? 'link' : res.kind;
}

test('AC-NFR-PERF.004.1 — AF-082 EVAL: zero false-merge, all ambiguous flagged, false-split within threshold', () => {
  let falseMerge = 0;
  let falseSplit = 0;
  let correct = 0;
  const unflaggedAmbiguous: string[] = [];
  const merges: string[] = [];

  for (const { mention, expected, note } of CASES) {
    const res = resolveEntity(mention, ENTITIES);
    const got = classify(res);

    if (expected.kind === 'link') {
      if (got === 'link' && res.kind === 'linked' && res.entityId === expected.entityId) correct++;
      else if (got === 'link') { falseMerge++; merges.push(`"${mention.name}" → wrong entity (${note})`); } // linked to the WRONG entity
      else if (got === 'create') falseSplit++; // should have linked, created instead — a duplicate (recoverable)
      // got === 'ambiguous' when a link was expected: flagged for human — not a silent error, not counted against.
    } else if (expected.kind === 'create') {
      if (got === 'create') correct++;
      else if (got === 'link') { falseMerge++; merges.push(`"${mention.name}" → linked when it should be new (${note})`); }
      // ambiguous when create expected: flagged — acceptable.
    } else {
      // expected ambiguous — MUST be flagged, never silently resolved (AC-2.ENT.005.2).
      if (got === 'ambiguous') correct++;
      else if (got === 'link') { falseMerge++; merges.push(`"${mention.name}" → silently linked despite ambiguity (${note})`); }
      else unflaggedAmbiguous.push(`"${mention.name}" → silently created instead of flagged (${note})`);
    }
  }

  const total = CASES.length;
  const falseSplitRate = falseSplit / total;
  // Report (visible on -v / on failure).
  console.log(`AF-082 EVAL: ${correct}/${total} correct · false-merge=${falseMerge} · false-split=${falseSplit} (${(falseSplitRate * 100).toFixed(0)}%) · unflagged-ambiguous=${unflaggedAmbiguous.length}`);

  // Binding assertions.
  assert.equal(falseMerge, 0, `false-merge must be ZERO (#2 cross-contamination): ${merges.join('; ')}`);
  assert.equal(unflaggedAmbiguous.length, 0, `every ambiguous mention must be flagged (AC-2.ENT.005.2): ${unflaggedAmbiguous.join('; ')}`);
  assert.ok(falseSplitRate <= 0.2, `false-split rate ${(falseSplitRate * 100).toFixed(0)}% exceeds the 20% EVAL threshold`);
});
