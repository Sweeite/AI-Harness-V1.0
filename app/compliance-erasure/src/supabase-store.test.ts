// ISSUE-082 — offline structural guards for the live adapter (R10 parity WITHOUT a DB). The live R10 smoke (against
// the silo, rolled back) proves the SQL runs; these tests catch the classes a fake-only suite would miss offline:
//   1. every lifecycle → event_type mapping targets an EXISTING baseline event_type enum value (no 22P02 live).
//   2. the adapter emits the expected statements against a recording exec (the SQL shape, casts, and idempotency).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { LIFECYCLE_EVENT_TYPE, SupabaseDeletionWorkflowStore, type QueryExec } from './supabase-store.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');

/** the valid event_type members = the baseline enum ∪ every additive `add value` across the migration corpus (0047's
 *  deletion-workflow values included). This is the honest R10 predicate: what will be a valid enum value LIVE. */
function corpusEventTypes(): Set<string> {
  const baseline = readFileSync(join(MIGRATIONS, '0001_baseline.sql'), 'utf8');
  const start = baseline.indexOf('create type event_type');
  const end = baseline.indexOf(');', start);
  const values = new Set([...baseline.slice(start, end).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!));
  for (const f of readdirSync(MIGRATIONS)) {
    if (!f.endsWith('.sql')) continue;
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    for (const m of sql.matchAll(/add value if not exists '([a-z_]+)'/g)) values.add(m[1]!);
  }
  return values;
}

test('every lifecycle → event_type mapping targets a valid corpus event_type value (no 22P02 live)', () => {
  const valid = corpusEventTypes();
  for (const [logical, mapped] of Object.entries(LIFECYCLE_EVENT_TYPE)) {
    assert.ok(valid.has(mapped), `lifecycle '${logical}' maps to '${mapped}' which is NOT a valid event_type value`);
  }
  // the fallback default must also be valid
  assert.ok(valid.has('deletion_request_held'), 'the emitLifecycle fallback event_type must be a valid enum value');
});

/** a recording exec that returns canned rows so the adapter's mappers run. */
function recorder(rowsFor: (sql: string) => Record<string, unknown>[] = () => []): { exec: QueryExec; calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];
  const exec: QueryExec = async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: rowsFor(sql) as never[], rowCount: rowsFor(sql).length };
  };
  return { exec, calls };
}

test('writeDeletionAudit inserts an immutable access_audit row with the disposition split + NO PII (AC-10.DEL.005.1/.2)', async () => {
  const { exec, calls } = recorder();
  const store = new SupabaseDeletionWorkflowStore(exec);
  await store.writeDeletionAudit({
    requestId: 'req-1', requesterId: 'r', authorizedBy: 'a', secondAuthoriserId: 'b', executorId: 'c',
    actorIdentity: 'c', originatingUserId: 'c', targetEntityId: 'target', legalBasis: 'gdpr', executedAt: '2026-07-11T00:00:00.000Z',
    hardDeletedCount: 3, idRemovedCount: 2, redactedCount: 1, done: true,
  });
  const call = calls.find((c) => c.sql.includes('insert into access_audit'))!;
  assert.ok(call, 'an access_audit insert was emitted');
  assert.match(call.sql, /'individual_deletion'/);
  assert.match(call.sql, /'user'::actor_type/);
  const payload = JSON.parse(call.params[6] as string);
  assert.deepEqual([payload.hard_deleted_count, payload.id_removed_count, payload.redacted_count], [3, 2, 1]);
  assert.equal(payload.done, true);
  // no erased content — only counts + identities
  assert.equal(JSON.stringify(payload).includes('content'), false);
});

test('scrubMemory de-links via array_remove and never empties the array in-statement (cardinality guard upstream)', async () => {
  const { exec, calls } = recorder(() => [{ entity_ids: ['acme'] }]);
  const store = new SupabaseDeletionWorkflowStore(exec);
  const res = await store.scrubMemory('m', 'target', '[REDACTED]', true);
  const call = calls[0]!;
  assert.match(call.sql, /array_remove\(entity_ids, \$3::uuid\)/);
  assert.deepEqual(res.entity_ids, ['acme']);
});

test('emitLifecycle maps the logical event + preserves it in the payload', async () => {
  const { exec, calls } = recorder();
  const store = new SupabaseDeletionWorkflowStore(exec);
  await store.emitLifecycle('deletion_request_executed', 'req-1', { hard_deleted: 3 });
  const call = calls[0]!;
  assert.equal(call.params[0], 'deletion_request_executed'); // its own honest event_type (0047)
  const payload = JSON.parse(call.params[2] as string);
  assert.equal(payload.logical_event, 'deletion_request_executed');
  assert.equal(payload.hard_deleted, 3);
});

test('createRequest persists target_user_id (OD-206) + echoes the resolved targetEntityId from intake', async () => {
  const { exec, calls } = recorder(() => [{ id: 'req-1', requester_id: 'r', target_user_id: 'u', legal_basis: null, status: 'received', authorized_by: null, second_authoriser_id: null, executor_id: null, executed_at: null, created_at: new Date('2026-07-11'), updated_at: new Date('2026-07-11') }]);
  const store = new SupabaseDeletionWorkflowStore(exec);
  const req = await store.createRequest({ requesterId: 'r', targetUserId: 'u', targetEntityId: 'entity-x', legalBasis: null });
  assert.match(calls[0]!.sql, /insert into deletion_requests/);
  assert.equal(req.targetEntityId, 'entity-x', 'the resolved entity_id is carried in-flight (not a persisted column)');
  assert.equal(req.targetUserId, 'u');
});
