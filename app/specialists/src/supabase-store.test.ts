// ISSUE-062 (C8 SPC) — LIVE-path guard tests. These reproduce the live FAIL-OPEN the offline reference suite could
// not see: the class tag lives on `tools.config->>'hard_limit_class'`, a tag that is on NO tool row today, so a
// naive "no tag ⇒ non-forbidden" default silently permits granting an untagged memory-write tool to a non-Memory
// agent (#2). The fix is a FAIL-CLOSED kernel (evaluateLiveGrant) — a write tool it cannot classify is DENIED. We
// test the pure kernel AND the adapter wiring (via an injected query seam, no real DB — R10 still owes the smoke).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLASS_MEMORY_WRITE,
  ForbiddenCapabilityGrant,
  InMemoryRejectionLog,
  UncertifiableCapabilityGrant,
  evaluateLiveGrant,
  type LiveToolRow,
} from './store.ts';
import { SupabaseSpecialistRegistry, type QueryExec } from './supabase-store.ts';
import { CLIENT, MEMORY, COMMS, FINANCE } from './specialists.ts';

const UUID = {
  memWrite: '11111111-1111-4111-8111-111111111111',
  send: '22222222-2222-4222-8222-222222222222',
  txn: '33333333-3333-4333-8333-333333333333',
  readTool: '44444444-4444-4444-8444-444444444444',
  writeUntagged: '55555555-5555-4555-8555-555555555555',
};

// ── The pure FAIL-CLOSED kernel ───────────────────────────────────────────────────────────────────────

test('evaluateLiveGrant — REGRESSION: an UNTAGGED memory-write (write) tool granted to a non-Memory agent is DENIED (fail-closed), not allowed', () => {
  // The live fail-open: the memory-write tool exists in `tools` as category='write' but carries NO hard_limit_class
  // tag (the tag is unshipped). The OLD default treated it as unclassified⇒non-forbidden ⇒ ALLOWED to CLIENT (#2).
  const rows: LiveToolRow[] = [{ id: UUID.memWrite, category: 'write', klass: null }];
  const v = evaluateLiveGrant(CLIENT, [UUID.memWrite], rows);
  assert.equal(v.ok, false);
  assert.ok(v.ok === false && 'uncertifiable' in v && v.uncertifiable.kind === 'unclassified_write');
});

test('evaluateLiveGrant — a TAGGED memory-write tool is rejected for a non-Memory agent (precise forbidden reason)', () => {
  const rows: LiveToolRow[] = [{ id: UUID.memWrite, category: 'write', klass: 'memory_write' }];
  const v = evaluateLiveGrant(CLIENT, [UUID.memWrite], rows);
  assert.ok(v.ok === false && 'forbidden' in v && v.forbidden.tool_class === CLASS_MEMORY_WRITE);
});

test('evaluateLiveGrant — a TAGGED memory-write tool IS allowed for the Memory agent (the sole writer)', () => {
  const rows: LiveToolRow[] = [{ id: UUID.memWrite, category: 'write', klass: 'memory_write' }];
  assert.deepEqual(evaluateLiveGrant(MEMORY, [UUID.memWrite], rows), { ok: true });
});

test('evaluateLiveGrant — an UNTAGGED write tool is denied even for Memory (fail-closed until it is classified)', () => {
  // Safe direction: if we cannot prove the write tool is the memory-write capability (untagged), we do not hand it
  // to anyone — the operator must classify it. Denies rather than permits (#2).
  const rows: LiveToolRow[] = [{ id: UUID.writeUntagged, category: 'write', klass: null }];
  const v = evaluateLiveGrant(MEMORY, [UUID.writeUntagged], rows);
  assert.ok(v.ok === false && 'uncertifiable' in v && v.uncertifiable.kind === 'unclassified_write');
});

test('evaluateLiveGrant — an untagged READ tool is provably non-forbidden and is allowed', () => {
  const rows: LiveToolRow[] = [{ id: UUID.readTool, category: 'read', klass: null }];
  assert.deepEqual(evaluateLiveGrant(CLIENT, [UUID.readTool], rows), { ok: true });
});

test('evaluateLiveGrant — an id ABSENT from `tools` cannot be classified and is denied (unknown_tool)', () => {
  const v = evaluateLiveGrant(CLIENT, [UUID.memWrite], /* no rows */ []);
  assert.ok(v.ok === false && 'uncertifiable' in v && v.uncertifiable.kind === 'unknown_tool');
});

test('evaluateLiveGrant — deterministic first-violation in input order', () => {
  const rows: LiveToolRow[] = [
    { id: UUID.readTool, category: 'read', klass: null },
    { id: UUID.send, category: 'write', klass: 'autonomous_send' },
    { id: UUID.writeUntagged, category: 'write', klass: null },
  ];
  const v = evaluateLiveGrant(COMMS, [UUID.readTool, UUID.send, UUID.writeUntagged], rows);
  assert.ok(v.ok === false && 'forbidden' in v && v.forbidden.tool_id === UUID.send);
});

// ── The adapter wiring (injected query seam — no real DB) ──────────────────────────────────────────────

test('adapter REGRESSION — setToolsAllowed denies an untagged memory-write tool to a non-Memory agent AND writes no agents row', async () => {
  const rejections = new InMemoryRejectionLog();
  let inserts = 0;
  const exec: QueryExec = async <R extends Record<string, unknown>>(text: string, params?: unknown[]) => {
    if (/from tools/.test(text)) {
      return { rows: [{ id: UUID.memWrite, category: 'write', klass: null }] as unknown as R[] };
    }
    if (/insert into agents/.test(text)) inserts += 1;
    if (/from agents/.test(text)) {
      return {
        rows: [
          { id: 'a', name: params?.[0], memory_scope: {}, tools_allowed: [], max_tokens: null, enabled: true,
            version: 1, change_reason: 'seed', description: 'd', created_by: null, updated_at: new Date(0).toISOString() },
        ] as unknown as R[],
      };
    }
    throw new Error(`unexpected: ${text}`);
  };
  const reg = new SupabaseSpecialistRegistry('postgres://x?sslmode=disable', { rejections, queryExec: exec });
  await assert.rejects(
    () => reg.setToolsAllowed(CLIENT, [UUID.memWrite], 'grant untagged write', 'super-admin', 1000),
    (e: unknown) => e instanceof UncertifiableCapabilityGrant && e.detail.kind === 'unclassified_write',
  );
  assert.equal(inserts, 0, 'no agents row may be inserted on a denied grant (#2)');
  assert.equal(rejections.rejections.length, 1, 'the deny is durably logged (#3)');
  assert.equal(rejections.rejections[0]!.tool_class, 'unclassified_write');
});

test('adapter — a TAGGED forbidden grant throws ForbiddenCapabilityGrant and logs, no write', async () => {
  const rejections = new InMemoryRejectionLog();
  let inserts = 0;
  const exec: QueryExec = async <R extends Record<string, unknown>>(text: string, params?: unknown[]) => {
    if (/from tools/.test(text)) return { rows: [{ id: UUID.txn, category: 'write', klass: 'transaction' }] as unknown as R[] };
    if (/insert into agents/.test(text)) inserts += 1;
    if (/from agents/.test(text)) {
      return { rows: [{ id: 'a', name: params?.[0], memory_scope: {}, tools_allowed: [], max_tokens: null,
        enabled: true, version: 1, change_reason: 'seed', description: 'd', created_by: null, updated_at: new Date(0).toISOString() }] as unknown as R[] };
    }
    throw new Error(`unexpected: ${text}`);
  };
  const reg = new SupabaseSpecialistRegistry('x?sslmode=disable', { rejections, queryExec: exec });
  await assert.rejects(
    () => reg.setToolsAllowed(FINANCE, [UUID.txn], 'grant txn', 'sa', 1000),
    (e: unknown) => e instanceof ForbiddenCapabilityGrant,
  );
  assert.equal(inserts, 0);
  assert.equal(rejections.rejections.length, 1);
});

test('adapter — a clean READ-tool grant is allowed, appends a version, returns caller-now updated_at', async () => {
  let insertParams: unknown[] | undefined;
  const exec: QueryExec = async <R extends Record<string, unknown>>(text: string, params?: unknown[]) => {
    if (/from tools/.test(text)) return { rows: [{ id: UUID.readTool, category: 'read', klass: null }] as unknown as R[] };
    if (/from agents/.test(text)) {
      return { rows: [{ id: 'a', name: params?.[0], memory_scope: {}, tools_allowed: [], max_tokens: null,
        enabled: true, version: 1, change_reason: 'seed', description: 'd', created_by: null, updated_at: new Date(0).toISOString() }] as unknown as R[] };
    }
    if (/insert into agents/.test(text)) {
      insertParams = params;
      return { rows: [{ id: 'b', name: params?.[0], memory_scope: {}, tools_allowed: params?.[3], max_tokens: null,
        enabled: true, version: 2, change_reason: params?.[8], description: params?.[1], created_by: null,
        updated_at: params?.[10] }] as unknown as R[] };
    }
    throw new Error(`unexpected: ${text}`);
  };
  const reg = new SupabaseSpecialistRegistry('x?sslmode=disable', { queryExec: exec });
  const now = 3000;
  const def = await reg.setToolsAllowed(CLIENT, [UUID.readTool], 'grant a read tool', 'sa', now);
  assert.deepEqual(def.tools_allowed, [UUID.readTool]);
  assert.equal(def.version, 2);
  // caller-supplied-now discipline: persisted created_at == updated_at == to_timestamp(now); returned reflects it.
  assert.equal(def.updated_at, new Date(now * 1000).toISOString());
  assert.equal(insertParams?.[10], new Date(now * 1000).toISOString());
});

test('adapter — getByRole returns the PERSISTED updated_at, not wall-clock', async () => {
  const persisted = new Date(1234567 * 1000).toISOString();
  const exec: QueryExec = async <R extends Record<string, unknown>>(text: string, params?: unknown[]) => {
    if (/from agents/.test(text)) {
      return { rows: [{ id: 'a', name: params?.[0], memory_scope: {}, tools_allowed: [], max_tokens: null,
        enabled: true, version: 1, change_reason: 'seed', description: 'd', created_by: null, updated_at: persisted }] as unknown as R[] };
    }
    throw new Error(`unexpected: ${text}`);
  };
  const reg = new SupabaseSpecialistRegistry('x?sslmode=disable', { queryExec: exec });
  const def = await reg.getByRole(CLIENT);
  assert.equal(def?.updated_at, persisted);
});

test('adapter — a non-uuid tool id is treated as unknown_tool (fail-closed), never sent to $1::uuid[]', async () => {
  let toolsQueryParams: unknown[] | undefined;
  const exec: QueryExec = async <R extends Record<string, unknown>>(text: string, params?: unknown[]) => {
    if (/from tools/.test(text)) {
      toolsQueryParams = params;
      return { rows: [] as unknown as R[] };
    }
    if (/from agents/.test(text)) {
      return { rows: [{ id: 'a', name: params?.[0], memory_scope: {}, tools_allowed: [], max_tokens: null,
        enabled: true, version: 1, change_reason: 'seed', description: 'd', created_by: null, updated_at: new Date(0).toISOString() }] as unknown as R[] };
    }
    throw new Error(`unexpected: ${text}`);
  };
  const reg = new SupabaseSpecialistRegistry('x?sslmode=disable', { queryExec: exec });
  await assert.rejects(
    () => reg.setToolsAllowed(CLIENT, ['not-a-uuid'], 'x', 'sa', 1),
    (e: unknown) => e instanceof UncertifiableCapabilityGrant && e.detail.kind === 'unknown_tool',
  );
  // the malformed id was filtered out — the uuid[] param is empty, so no raw pg parse error over the batch.
  assert.deepEqual(toolsQueryParams, undefined); // liveToolRows short-circuits (no valid uuids) before querying
});
