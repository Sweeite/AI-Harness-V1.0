// ISSUE-025 — clearance.ts unit tests: the #2 core, exercised as a faithful realisation of the 0031
// memories_clearance_read predicate. Every clause + every fail-closed path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearanceVerdict, type Requester, type EntityTypeLookup } from './clearance.ts';
import { mkMemory } from './testkit.ts';

// entity e1:client, e2:internal — the entity-type lookup the sensitivity/restricted clauses key on.
const typeOf: EntityTypeLookup = (id) => ({ e1: 'client', e2: 'internal' })[id];

function human(over: Partial<Requester> = {}): Requester {
  return { path: 'human', aal2: true, visibility: ['global', 'team', 'private'], clearances: [], restricted: [], ...over };
}

test('clause 1 — no aal2 is fail-closed (nothing visible)', () => {
  const m = mkMemory({ entity_ids: ['e1'], visibility: 'global', sensitivity: 'standard' });
  assert.equal(clearanceVerdict(m, typeOf, human({ aal2: false })).visible, false);
  assert.equal(clearanceVerdict(m, typeOf, human({ aal2: true })).visible, true);
});

test('clause 2 — visibility must be HELD; an empty visibility set clears nothing', () => {
  const teamMem = mkMemory({ entity_ids: ['e1'], visibility: 'team', sensitivity: 'standard' });
  assert.equal(clearanceVerdict(teamMem, typeOf, human({ visibility: ['global'] })).visible, false, 'team not held');
  assert.equal(clearanceVerdict(teamMem, typeOf, human({ visibility: ['team'] })).visible, true, 'team held');
  assert.equal(clearanceVerdict(teamMem, typeOf, human({ visibility: [] })).visible, false, 'empty set = fail-closed');
});

test('clause 3 — standard is implicit-cleared; confidential/personal need a matching clearance tier', () => {
  const conf = mkMemory({ entity_ids: ['e1'], sensitivity: 'confidential' });
  assert.equal(clearanceVerdict(conf, typeOf, human()).visible, false, 'no clearance → denied');
  assert.equal(
    clearanceVerdict(conf, typeOf, human({ clearances: [{ tier: 'confidential', entityTypeScope: null }] })).visible,
    true,
    'global confidential clearance → cleared',
  );
  const std = mkMemory({ entity_ids: ['e1'], sensitivity: 'standard' });
  assert.equal(clearanceVerdict(std, typeOf, human()).visible, true, 'standard implicit-cleared without any clearance');
});

test('clause 3 — entity-type-scoped clearance only clears rows touching that type (FR-1.CLR.004)', () => {
  const conf = mkMemory({ entity_ids: ['e1'], sensitivity: 'confidential' }); // e1 = client
  const clientScoped = human({ clearances: [{ tier: 'confidential', entityTypeScope: 'client' }] });
  const internalScoped = human({ clearances: [{ tier: 'confidential', entityTypeScope: 'internal' }] });
  assert.equal(clearanceVerdict(conf, typeOf, clientScoped).visible, true, 'scope matches row entity type');
  assert.equal(clearanceVerdict(conf, typeOf, internalScoped).visible, false, 'scope does not match → denied');
});

test('clause 3 — a personal clearance does NOT satisfy a confidential row (tiers are distinct)', () => {
  const conf = mkMemory({ entity_ids: ['e1'], sensitivity: 'confidential' });
  const onlyPersonal = human({ clearances: [{ tier: 'personal', entityTypeScope: null }] });
  assert.equal(clearanceVerdict(conf, typeOf, onlyPersonal).visible, false);
});

test('clause 4 — a restricted row needs a LIVE per-individual grant (never a clearance); by id or type', () => {
  const r = mkMemory({ entity_ids: ['e1'], sensitivity: 'restricted' });
  // a full clearance set does NOT admit a restricted row (restricted is not a clearance tier).
  const cleared = human({ clearances: [{ tier: 'confidential', entityTypeScope: null }, { tier: 'personal', entityTypeScope: null }] });
  assert.equal(clearanceVerdict(r, typeOf, cleared).visible, false, 'clearances alone never admit restricted');
  assert.equal(clearanceVerdict(r, typeOf, human({ restricted: [{ entityId: 'e1', entityType: null }] })).visible, true, 'grant by id');
  assert.equal(clearanceVerdict(r, typeOf, human({ restricted: [{ entityId: null, entityType: 'client' }] })).visible, true, 'grant by type');
  assert.equal(clearanceVerdict(r, typeOf, human({ restricted: [{ entityId: 'other', entityType: null }] })).visible, false, 'grant on a different entity → denied');
  assert.equal(clearanceVerdict(r, typeOf, human({ restricted: [{ entityId: null, entityType: 'internal' }] })).visible, false, 'grant on a different type → denied');
});

test('verdict flags — sensitiveTouch on personal/restricted; restricted flag on restricted', () => {
  assert.deepEqual(
    clearanceVerdict(mkMemory({ entity_ids: ['e1'], sensitivity: 'personal' }), typeOf, human({ clearances: [{ tier: 'personal', entityTypeScope: null }] })),
    { visible: true, sensitiveTouch: true, restricted: false },
  );
  assert.deepEqual(
    clearanceVerdict(mkMemory({ entity_ids: ['e1'], sensitivity: 'restricted' }), typeOf, human({ restricted: [{ entityId: 'e1', entityType: null }] })),
    { visible: true, sensitiveTouch: true, restricted: true },
  );
  assert.equal(clearanceVerdict(mkMemory({ entity_ids: ['e1'], sensitivity: 'standard' }), typeOf, human()).sensitiveTouch, false);
});

test('OD-081 agent-scope — narrows WITHIN clearance, never widens; undefined = no narrowing; empty = fail-closed', () => {
  const m = mkMemory({ entity_ids: ['e1'], sensitivity: 'standard' }); // e1 = client, cleared by visibility+standard
  const agent = (scope?: Requester['agentScope']): Requester => ({ path: 'agent', aal2: true, visibility: ['global', 'team', 'private'], clearances: [], restricted: [], agentScope: scope });
  assert.equal(clearanceVerdict(m, typeOf, agent(undefined)).visible, true, 'no scope = full clearance applies');
  assert.equal(clearanceVerdict(m, typeOf, agent({ entityIds: ['e1'] })).visible, true, 'in scope by id');
  assert.equal(clearanceVerdict(m, typeOf, agent({ entityTypes: ['client'] })).visible, true, 'in scope by type');
  assert.equal(clearanceVerdict(m, typeOf, agent({ entityIds: ['other'] })).visible, false, 'out of scope → dropped');
  assert.equal(clearanceVerdict(m, typeOf, agent({ entityIds: [], entityTypes: [] })).visible, false, 'explicit empty scope = nothing');
});

test('OD-081 — agent-scope never WIDENS: an out-of-clearance row stays denied even if in agent scope', () => {
  const conf = mkMemory({ entity_ids: ['e1'], sensitivity: 'confidential' });
  const agentInScopeNoClearance: Requester = { path: 'agent', aal2: true, visibility: ['global', 'team', 'private'], clearances: [], restricted: [], agentScope: { entityIds: ['e1'] } };
  assert.equal(clearanceVerdict(conf, typeOf, agentInScopeNoClearance).visible, false, 'in scope but no clearance → still denied');
});

test('human path ignores agentScope entirely', () => {
  const m = mkMemory({ entity_ids: ['e1'], sensitivity: 'standard' });
  const h = human({ agentScope: { entityIds: ['other'] } }); // would be out-of-scope on the agent path
  assert.equal(clearanceVerdict(m, typeOf, h).visible, true, 'agentScope is a no-op on the human path');
});
