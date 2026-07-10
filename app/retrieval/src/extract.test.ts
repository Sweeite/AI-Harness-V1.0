// ISSUE-025 — extract.ts unit tests (FR-2.RET.001 / AC-2.RET.001.1): read-only resolution; only confident single
// matches seed the keyword arm; ambiguous/no-match never guess an entity on the read path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEntities } from './extract.ts';
import { mkEntity } from './testkit.ts';

const acme = mkEntity({ id: 'e-acme', type: 'client', name: 'Acme Corp', external_refs: { ghl: 'acme-123' } });
const acmeDup = mkEntity({ id: 'e-acme2', type: 'client', name: 'Acme Corp' }); // a name-collision duplicate
const globex = mkEntity({ id: 'e-globex', type: 'client', name: 'Globex' });

test('AC-2.RET.001.1 — a task naming a known client identifies that entity for the keyword arm', () => {
  const r = extractEntities([{ name: 'Acme Corp', type: 'client' }], [acme, globex]);
  assert.deepEqual(r.entityIds, ['e-acme']);
  assert.equal(r.primaryEntityId, 'e-acme');
});

test('external_refs win — a system id resolves authoritatively', () => {
  const r = extractEntities([{ name: 'totally different label', type: 'client', external_refs: { ghl: 'acme-123' } }], [acme, globex]);
  assert.deepEqual(r.entityIds, ['e-acme']);
});

test('a not-yet-known entity yields no keyword hit (vector arm still runs)', () => {
  const r = extractEntities([{ name: 'Umbrella Inc', type: 'client' }], [acme]);
  assert.deepEqual(r.entityIds, []);
  assert.equal(r.primaryEntityId, null);
});

test('ambiguous mention never guesses an entity (#2) — no keyword seed, flagged', () => {
  const r = extractEntities([{ name: 'Acme Corp', type: 'client' }], [acme, acmeDup]);
  assert.deepEqual(r.entityIds, [], 'two plausible matches → do not seed the keyword arm with a guess');
  assert.equal(r.hadAmbiguous, true);
  assert.equal(r.primaryEntityId, null);
});

test('primary — the marked-primary mention drives primaryEntityId; else the first resolved', () => {
  const mentions = [
    { name: 'Globex', type: 'client' },
    { name: 'Acme Corp', type: 'client', primary: true },
  ];
  const r = extractEntities(mentions, [acme, globex]);
  assert.deepEqual(r.entityIds.sort(), ['e-acme', 'e-globex']);
  assert.equal(r.primaryEntityId, 'e-acme', 'marked-primary wins over first-resolved');
});

test('duplicate mentions dedupe; order stable', () => {
  const r = extractEntities([{ name: 'Acme Corp', type: 'client' }, { name: 'Acme Corp', type: 'client' }], [acme]);
  assert.deepEqual(r.entityIds, ['e-acme']);
});
