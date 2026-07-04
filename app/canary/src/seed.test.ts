// Build-time tests for the canary fixture + seed (ISSUE-007 §9, FR-10.PRV.003).
// Proves, WITHOUT live infra:
//   • the corpus is deterministic + schema-valid (≥1 entity/memory, valid refs)
//   • the KNOWN_ANSWERS contract points at real fixture rows (smoke battery always has a target)
//   • a fresh seed inserts everything; a re-seed converges (idempotent — AC-NFR-INF.006.1 posture)
//   • a partial seed fails LOUD (no silent half-corpus — #3)
// The behavioural assertions (retrieval/contradiction/routing) are owned by C2/C5/C8, not here.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CANARY_CORPUS, KNOWN_ANSWERS, contentHash } from "./fixture.ts";
import { EMBED_DIMS, InMemorySeedStore } from "./port.ts";
import { CanarySeedError, seedCanary } from "./seed.ts";

test("corpus is deterministic — idempotency keys are pure/stable", () => {
  for (const m of CANARY_CORPUS.memories) {
    const sorted = [...m.entityIds].sort().join(",");
    const expected = contentHash(`memory:${m.id}`, sorted, contentHash(m.content));
    assert.equal(m.idempotencyKey, expected, `idempotencyKey for ${m.id} must be a pure fn of its content`);
  }
  // keys are unique across the corpus (DB-level unique(idempotency_key))
  const keys = CANARY_CORPUS.memories.map((m) => m.idempotencyKey);
  assert.equal(new Set(keys).size, keys.length, "idempotency keys must be unique");
});

test("schema invariants — every memory has ≥1 real entity; exactly one internal_org", () => {
  const entityIds = new Set(CANARY_CORPUS.entities.map((e) => e.id));
  for (const m of CANARY_CORPUS.memories) {
    assert.ok(m.entityIds.length >= 1, `${m.id} must reference ≥1 entity (AC-2.MEM.002.2)`);
    for (const id of m.entityIds) {
      assert.ok(entityIds.has(id), `${m.id} references unknown entity ${id}`);
    }
    // non system_pointer memories must carry confidence (schema check)
    if (m.source !== "system_pointer") {
      assert.notEqual(m.confidence, null, `${m.id} (${m.source}) must have confidence`);
    }
  }
  for (const msg of CANARY_CORPUS.messages) {
    for (const id of msg.entityIds) {
      assert.ok(entityIds.has(id), `${msg.id} references unknown entity ${id}`);
    }
  }
  const internalOrgs = CANARY_CORPUS.entities.filter((e) => e.isInternalOrg);
  assert.equal(internalOrgs.length, 1, "exactly one internal_org singleton (FR-2.ENT.003)");
});

test("KNOWN_ANSWERS contract points at real fixture rows", () => {
  const memById = new Map(CANARY_CORPUS.memories.map((m) => [m.id, m]));
  const msgById = new Map(CANARY_CORPUS.messages.map((m) => [m.id, m]));

  // retrieval target exists and its content contains the expected answer
  const r = memById.get(KNOWN_ANSWERS.retrieval.expectMemoryId);
  assert.ok(r, "retrieval target memory must exist");
  assert.ok(r.content.includes(KNOWN_ANSWERS.retrieval.expectSubstring), "retrieval target must contain the answer");

  // contradiction pair: both exist, share the entity, and genuinely differ
  const a = memById.get(KNOWN_ANSWERS.contradiction.memoryIdA);
  const b = memById.get(KNOWN_ANSWERS.contradiction.memoryIdB);
  assert.ok(a && b, "both contradiction memories must exist");
  assert.ok(a.entityIds.includes(KNOWN_ANSWERS.contradiction.entityId), "A must concern the contradiction entity");
  assert.ok(b.entityIds.includes(KNOWN_ANSWERS.contradiction.entityId), "B must concern the contradiction entity");
  assert.notEqual(a.content, b.content, "the contradiction pair must actually differ");

  // routing cases reference real messages
  for (const rc of KNOWN_ANSWERS.routing) {
    assert.ok(msgById.get(rc.messageId), `routing message ${rc.messageId} must exist`);
    assert.ok(rc.expectRoute.length > 0, "each routing case must name an expected route");
  }
});

test("fresh seed inserts the whole corpus with 1536-dim embeddings", async () => {
  const store = new InMemorySeedStore();
  const rep = await seedCanary(CANARY_CORPUS, store);

  assert.equal(rep.inserted.entities, CANARY_CORPUS.entities.length);
  assert.equal(rep.inserted.messages, CANARY_CORPUS.messages.length);
  assert.equal(rep.inserted.memories, CANARY_CORPUS.memories.length);
  assert.deepEqual(rep.skipped, { entities: 0, messages: 0, memories: 0 });

  // every seeded memory carries a non-null 1536-dim embedding (schema: vector(1536) not null)
  for (const { embedding } of store.memories.values()) {
    assert.equal(embedding.length, EMBED_DIMS);
  }
});

test("re-seed converges — nothing re-applied (idempotent, AC-NFR-INF.006.1 posture)", async () => {
  const store = new InMemorySeedStore();
  await seedCanary(CANARY_CORPUS, store);
  const callsAfterFirst = store.calls.length;

  const rep = await seedCanary(CANARY_CORPUS, store);
  assert.deepEqual(rep.inserted, { entities: 0, messages: 0, memories: 0 }, "re-seed inserts nothing");
  assert.equal(rep.skipped.entities, CANARY_CORPUS.entities.length);
  assert.equal(rep.skipped.messages, CANARY_CORPUS.messages.length);
  assert.equal(rep.skipped.memories, CANARY_CORPUS.memories.length);
  assert.equal(store.calls.length, callsAfterFirst, "re-seed makes no new insert calls");
});

test("partial seed fails LOUD — CanarySeedError names the failing step (#3)", async () => {
  const store = new InMemorySeedStore();
  store.failOnce = "insertMemory"; // blow up mid-way through the memory inserts
  await assert.rejects(
    () => seedCanary(CANARY_CORPUS, store),
    (err: unknown) => {
      assert.ok(err instanceof CanarySeedError, "must throw the typed seed error");
      assert.equal(err.step, "memory");
      return true;
    },
  );
  // resume: the failure was transient (failOnce cleared) — a re-seed now completes and converges.
  const rep = await seedCanary(CANARY_CORPUS, store);
  assert.equal(rep.inserted.memories + rep.skipped.memories, CANARY_CORPUS.memories.length);
});
