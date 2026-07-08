// ISSUE-022 — one test per AC in §4 Definition of done, proved against the InMemoryMemoryStore reference model
// (offline; the live adapter is proven by results/live-smoke.sql, R10). AF-082 EVAL (AC-NFR-PERF.004.1) lives in
// eval-af082.test.ts.
//
// AC map:
//   AC-2.MEM.001.1  — a written memory's type is exactly semantic/episodic/procedural
//   AC-2.MEM.001.2  — working-memory context with no write-back persists nothing
//   AC-2.MEM.002.1  — a memory row's fields are all present + inside their documented domains
//   AC-2.MEM.002.2  — a zero-entity write is rejected
//   AC-2.ENT.001.1  — a stored memory carries >=1 valid entity
//   AC-2.ENT.002.1  — a fresh deployment has exactly the documented default entity types (incl Internal Org)
//   AC-2.ENT.002.2  — an operator-added custom type is referenceable with no deploy
//   AC-2.ENT.003.1  — exactly one Internal Org entity exists (a 2nd is rejected)
//   AC-2.ENT.003.2  — an Internal Org memory is excluded from a client-facing context (shape here; RLS = 020/025)
//   AC-2.ENT.004.1  — an entity from a system of record records its external_refs
//   AC-2.ENT.005.1  — a mention with a known external_ref links to the existing entity (no duplicate)
//   AC-2.ENT.005.2  — an ambiguous mention is flagged, never silently mis-linked
//   AC-2.TAG.001.1  — business defaults global, personal defaults private (unset → most-restrictive)
//   AC-2.TAG.002.1  — writer-judged Confidential is assigned with no human step
//   AC-2.TAG.002.2  — any path that would set Restricted requires human confirmation first
//   AC-2.TAG.003.1  — a global Confidential memory is excluded for a requester without Confidential clearance
//   AC-NFR-CMP.002.1/.2 — a stored memory carries a source_ref pointer, never a verbatim source-file copy

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryMemoryStore,
  validateMemoryRow,
  MemoryError,
  ERR_NO_ENTITY,
  ERR_POINTER_NEEDS_REF,
  MEMORY_TYPES,
  DEFAULT_ENTITY_TYPES,
  INTERNAL_ORG_TYPE,
  type MemoryRow,
} from './index.ts';
import {
  defaultVisibility,
  assignSensitivity,
  admits,
  TagError,
  ERR_NEVER_AUTO_RESTRICTED,
  type RequesterContext,
} from './tags.ts';
import { resolveEntity, resolveOrCreate } from './resolution.ts';

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
async function withInternalOrg(store: InMemoryMemoryStore) {
  return store.insertEntity({ type: INTERNAL_ORG_TYPE, name: 'Internal Org', is_internal_org: true });
}
async function aClient(store: InMemoryMemoryStore, name = 'Acme Corp', refs?: Record<string, string>) {
  return store.insertEntity({ type: 'Client', name, external_refs: refs });
}

// ── MEM ────────────────────────────────────────────────────────────────────────────────────────
test('AC-2.MEM.001.1 — a written memory type is exactly one of semantic/episodic/procedural', async () => {
  const store = new InMemoryMemoryStore();
  const e = await aClient(store);
  for (const type of MEMORY_TYPES) {
    const row = store._memoryRow({ type, content: `fact ${type}`, entity_ids: [e.id], source: 'ai_inferred', visibility: 'global', sensitivity: 'standard' });
    const { inserted } = await store.insertMemory(row);
    assert.equal(inserted, true);
    assert.ok(MEMORY_TYPES.includes((await store.getMemory(row.id))!.type));
  }
  // a non-durable/unknown type is rejected at validation.
  const bad = store._memoryRow({ type: 'semantic', content: 'x', entity_ids: [e.id], source: 'ai_inferred', visibility: 'global', sensitivity: 'standard' });
  assert.throws(() => validateMemoryRow({ ...bad, type: 'working' as unknown as MemoryRow['type'] }), (err) => err instanceof MemoryError);
});

test('AC-2.MEM.001.2 — working-memory context with no write-back persists nothing', async () => {
  const store = new InMemoryMemoryStore();
  await aClient(store);
  // "working" is not a persisted memory_type; a task that ends without writing a memory back leaves the store empty.
  assert.equal(MEMORY_TYPES.includes('working' as never), false);
  assert.deepEqual(await store.listMemories(), []);
});

test('AC-2.MEM.002.1 — a memory row carries all fields inside their documented domains', async () => {
  const store = new InMemoryMemoryStore();
  const e = await aClient(store);
  const row = store._memoryRow({ type: 'semantic', content: 'Acme renews in Q3', entity_ids: [e.id], source: 'human_verified', visibility: 'global', sensitivity: 'confidential', confidence: 0.95, source_ref: 'ghl:deal/42' });
  await store.insertMemory(row);
  const stored = (await store.getMemory(row.id))!;
  assert.ok(['semantic', 'episodic', 'procedural'].includes(stored.type));
  assert.ok(['ai_inferred', 'human_verified', 'system_pointer'].includes(stored.source));
  assert.ok(['global', 'team', 'private'].includes(stored.visibility));
  assert.ok(['standard', 'confidential', 'personal', 'restricted'].includes(stored.sensitivity));
  assert.ok(stored.confidence !== null && stored.confidence >= 0 && stored.confidence <= 1);
  assert.ok(stored.entity_ids.length >= 1 && stored.content_hash && stored.idempotency_key);
});

test('AC-2.MEM.002.2 — a zero-entity write is rejected', async () => {
  const store = new InMemoryMemoryStore();
  const row = store._memoryRow({ type: 'semantic', content: 'orphan', entity_ids: ['tmp'], source: 'ai_inferred', visibility: 'global', sensitivity: 'standard' });
  await assert.rejects(store.insertMemory({ ...row, entity_ids: [] }), (err) => err instanceof MemoryError && err.reason === ERR_NO_ENTITY);
});

// ── ENT ────────────────────────────────────────────────────────────────────────────────────────
test('AC-2.ENT.001.1 — a stored memory carries >=1 valid entity', async () => {
  const store = new InMemoryMemoryStore();
  const e = await aClient(store);
  const row = store._memoryRow({ type: 'semantic', content: 'about Acme', entity_ids: [e.id], source: 'ai_inferred', visibility: 'global', sensitivity: 'standard' });
  await store.insertMemory(row);
  const stored = (await store.getMemory(row.id))!;
  assert.ok(stored.entity_ids.length >= 1);
  assert.ok(await store.getEntity(stored.entity_ids[0]!)); // the referenced entity exists
});

test('AC-2.ENT.002.1 — a fresh deployment has exactly the documented default entity types incl Internal Org', async () => {
  const store = new InMemoryMemoryStore();
  const types = await store.listEntityTypes();
  assert.deepEqual(types, [...DEFAULT_ENTITY_TYPES]);
  assert.ok(types.includes(INTERNAL_ORG_TYPE));
});

test('AC-2.ENT.002.2 — an operator-added custom entity type is referenceable with no deploy', async () => {
  const custom = [...DEFAULT_ENTITY_TYPES, 'Podcast Episode'];
  const store = new InMemoryMemoryStore(custom);
  const e = await store.insertEntity({ type: 'Podcast Episode', name: 'Ep 12' });
  assert.equal(e.type, 'Podcast Episode');
  // an unconfigured type is still rejected (fail-closed).
  await assert.rejects(store.insertEntity({ type: 'Nonsense', name: 'x' }), (err) => err instanceof MemoryError);
});

test('AC-2.ENT.003.1 — exactly one Internal Org entity exists (a 2nd is rejected)', async () => {
  const store = new InMemoryMemoryStore();
  await withInternalOrg(store);
  assert.ok(await store.internalOrg());
  await assert.rejects(withInternalOrg(store), (err) => err instanceof MemoryError && err.reason === 'internal_org_exists');
  assert.equal((await store.listEntities()).filter((e) => e.is_internal_org).length, 1);
});

test('AC-2.ENT.003.2 — an Internal Org memory is excluded from a client-facing context (shape)', async () => {
  const store = new InMemoryMemoryStore();
  const io = await withInternalOrg(store);
  // Internal-Org business knowledge defaults Confidential (FR-2.ENT.003); a client-facing agent has no
  // Confidential clearance, so the orthogonal admit (the shape ISSUE-025/020 enforce) excludes it.
  const mem = store._memoryRow({ type: 'semantic', content: 'agency margin target', entity_ids: [io.id], source: 'human_verified', visibility: 'global', sensitivity: 'confidential', confidence: 1 });
  await store.insertMemory(mem);
  const clientAgent: RequesterContext = { visibilityScopes: new Set(['global', 'team', 'private']), clearedTiers: new Set() };
  const stored = (await store.getMemory(mem.id))!;
  const decision = admits(stored, clientAgent);
  assert.equal(decision.admitted, false);
  assert.equal(decision.failedAxis, 'sensitivity');
  // and the memory is structurally identifiable as Internal-Org-linked (the exclusion key retrieval uses).
  assert.ok(stored.entity_ids.includes(io.id));
});

test('AC-2.ENT.004.1 — an entity from a system of record records its external_refs', async () => {
  const store = new InMemoryMemoryStore();
  const e = await aClient(store, 'Acme Corp', { ghl: 'contact_abc', slack: 'T0ACME', drive: 'folder/acme' });
  const read = (await store.getEntity(e.id))!;
  assert.equal(read.external_refs.ghl, 'contact_abc');
  assert.equal(read.external_refs.slack, 'T0ACME');
  assert.equal(read.external_refs.drive, 'folder/acme');
});

test('AC-2.ENT.005.1 — a mention with a known external_ref links to the existing entity (no duplicate)', async () => {
  const store = new InMemoryMemoryStore();
  const acme = await aClient(store, 'Acme Corporation', { ghl: 'contact_abc' });
  // a later mention carries the same GHL id but a differently-spelled name.
  const outcome = await resolveOrCreate(store, { type: 'Client', name: 'ACME', external_refs: { ghl: 'contact_abc' } });
  assert.equal(outcome.created, false);
  assert.equal(outcome.entityId, acme.id);
  assert.equal(outcome.via, 'external_ref');
  assert.equal((await store.listEntities()).length, 1); // no duplicate created
});

test('AC-2.ENT.005.2 — an ambiguous mention is flagged, never silently mis-linked', async () => {
  const store = new InMemoryMemoryStore();
  // two distinct existing entities share the mention's identical normalised name+type — genuinely ambiguous.
  const a = await aClient(store, 'North Star');
  const b = await aClient(store, 'North  Star'); // normalises to the same name, distinct row
  const res = resolveEntity({ type: 'Client', name: 'North Star' }, await store.listEntities());
  assert.equal(res.kind, 'ambiguous');
  assert.equal(res.kind === 'ambiguous' && res.candidates.length, 2);
  // resolveOrCreate never picks one: it creates-and-flags-for-merge (OD-033), never silently links to a or b.
  const outcome = await resolveOrCreate(store, { type: 'Client', name: 'North Star' });
  assert.equal(outcome.created, true);
  assert.equal(outcome.flaggedForMerge, true);
  assert.notEqual(outcome.entityId, a.id);
  assert.notEqual(outcome.entityId, b.id);
});

// ── TAG ────────────────────────────────────────────────────────────────────────────────────────
test('AC-2.TAG.001.1 — business defaults global, personal defaults private, unset → most-restrictive', () => {
  assert.equal(defaultVisibility('business'), 'global');
  assert.equal(defaultVisibility('personal'), 'private');
  assert.equal(defaultVisibility(undefined), 'private'); // never silently global (#2)
  assert.equal(defaultVisibility('business', 'team'), 'team'); // an explicit choice wins
});

test('AC-2.TAG.002.1 — writer-judged Confidential is assigned with no human step', () => {
  assert.equal(assignSensitivity('confidential'), 'confidential');
  assert.equal(assignSensitivity('standard'), 'standard');
  assert.equal(assignSensitivity('personal'), 'personal');
});

test('AC-2.TAG.002.2 — any path that would set Restricted requires human confirmation first', () => {
  assert.throws(() => assignSensitivity('restricted'), (err) => err instanceof TagError && err.reason === ERR_NEVER_AUTO_RESTRICTED);
  assert.equal(assignSensitivity('restricted', { humanConfirmed: true }), 'restricted'); // human-confirmed path allowed
});

test('AC-2.TAG.003.1 — a global Confidential memory is excluded for a requester without Confidential clearance', () => {
  const requester: RequesterContext = { visibilityScopes: new Set(['global', 'team', 'private']), clearedTiers: new Set() };
  const decision = admits({ visibility: 'global', sensitivity: 'confidential' }, requester);
  assert.equal(decision.admitted, false);
  assert.equal(decision.failedAxis, 'sensitivity'); // visibility passed; sensitivity failed — axes evaluated separately
  // orthogonality the other way: a Standard-but-private memory still needs scope.
  const noPrivate: RequesterContext = { visibilityScopes: new Set(['global', 'team']), clearedTiers: new Set() };
  assert.equal(admits({ visibility: 'private', sensitivity: 'standard' }, noPrivate).failedAxis, 'visibility');
});

// ── Golden rule (NFR-CMP.002) ────────────────────────────────────────────────────────────────────
test('AC-NFR-CMP.002.1/.2 — a stored memory carries a source_ref pointer, never a verbatim source-file copy', async () => {
  const store = new InMemoryMemoryStore();
  const e = await aClient(store);
  // a system-of-record memory is a system_pointer + source_ref (enrichment), never a copied file.
  const pointer = store._memoryRow({ type: 'semantic', content: 'Q3 renewal likely (enrichment)', entity_ids: [e.id], source: 'system_pointer', source_ref: 'drive:file/contract.pdf', sensitivity: 'confidential', visibility: 'global' });
  await store.insertMemory(pointer);
  const stored = (await store.getMemory(pointer.id))!;
  assert.ok(stored.source_ref && stored.source_ref.length > 0); // carries a pointer
  // a system_pointer WITHOUT a source_ref is rejected (nothing to point at — the golden-rule guard).
  const bad = store._memoryRow({ type: 'semantic', content: 'copied file bytes', entity_ids: [e.id], source: 'system_pointer', source_ref: null, sensitivity: 'confidential', visibility: 'global' });
  await assert.rejects(store.insertMemory(bad), (err) => err instanceof MemoryError && err.reason === ERR_POINTER_NEEDS_REF);
});
