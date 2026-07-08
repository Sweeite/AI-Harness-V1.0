// ISSUE-068 (C9 MODE) — LIVE-ADAPTER regression suite for SupabaseProactivityStore. These reproduce the
// fake-vs-live breaks the offline InMemory fake CANNOT surface, using a mock pg Pool/Client that records every
// query (and can be told to fail a specific statement):
//   • writeMatrix binds the actor's profile UUID (config_values.updated_by, a uuid FK) — NOT the free-text
//     actorIdentity (which throws 22P02/23503 live). A missing/invalid uuid fails LOUD before any write (#1/#3).
//   • writeMatrix is TRANSACTIONAL for a committed edit: audit + config UPSERT on one client inside
//     BEGIN/COMMIT; if the UPSERT throws, the audit is ROLLED BACK — no false 'committed' access_audit row (#1).
//   • a denied edit is still appended to access_audit (#3 never silent), as a standalone INSERT.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SupabaseProactivityStore } from './supabase-store.ts';
import type { AutonomyMatrixWriteRequest } from './store.ts';

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

// A minimal pg PoolClient stand-in: records every query; optionally throws on a matching statement.
class MockClient {
  readonly queries: RecordedQuery[] = [];
  released = false;
  constructor(private readonly failOn?: (sql: string) => boolean) {}
  async query(sql: string, params: unknown[] = []): Promise<{ rowCount: number; rows: unknown[] }> {
    this.queries.push({ sql, params });
    if (this.failOn?.(sql)) throw new Error('simulated config_values UPSERT failure');
    return { rowCount: 1, rows: [] };
  }
  release(): void {
    this.released = true;
  }
}

// A minimal pg Pool stand-in: pool-level queries (loadMatrix select, denied-path audit) recorded separately;
// connect() hands out the single MockClient used for the committed-edit transaction.
class MockPool {
  readonly poolQueries: RecordedQuery[] = [];
  constructor(
    readonly client: MockClient,
    private readonly storedValue: unknown = {},
  ) {}
  async query(sql: string, params: unknown[] = []): Promise<{ rowCount: number; rows: unknown[] }> {
    this.poolQueries.push({ sql, params });
    if (/select value from public\.config_values/.test(sql)) {
      return this.storedValue === undefined
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [{ value: this.storedValue }] };
    }
    return { rowCount: 1, rows: [] };
  }
  async connect(): Promise<MockClient> {
    return this.client;
  }
}

const A_UUID = '11111111-1111-4111-8111-111111111111';

function req(over: Partial<AutonomyMatrixWriteRequest> = {}): AutonomyMatrixWriteRequest {
  return {
    subType: 'low_risk_external_nonclient',
    ceiling: 'prepare',
    actorIdentity: 'Alice Admin', // human name → access_audit.actor_identity (text)
    actorProfileId: A_UUID, //       profile uuid → config_values.updated_by (uuid FK)
    isSuperAdmin: true,
    ...over,
  };
}

function findQuery(qs: RecordedQuery[], re: RegExp): RecordedQuery | undefined {
  return qs.find((q) => re.test(q.sql));
}

// ── BUG (MAJOR / fake-vs-live): updated_by is a uuid FK — bind actorProfileId, NEVER the free-text name. ──
test('writeMatrix binds actorProfileId (uuid) to config_values.updated_by, not the free-text actorIdentity', async () => {
  const client = new MockClient();
  const pool = new MockPool(client, {});
  const store = new SupabaseProactivityStore(pool as never);

  const out = await store.writeMatrix(req());
  assert.equal(out.committed, true);

  const cfg = findQuery(client.queries, /insert into public\.config_values/);
  assert.ok(cfg, 'the committed config UPSERT must run on the transaction client');
  // updated_by (3rd param) is the profile UUID — the OLD code passed req.actorIdentity ('Alice Admin'),
  // which throws 22P02/23503 live. This assertion fails against the pre-fix adapter.
  assert.equal(cfg!.params[2], A_UUID);
  assert.notEqual(cfg!.params[2], 'Alice Admin');

  // and the audit still carries the human name in actor_identity (text).
  const audit = findQuery(client.queries, /insert into public\.access_audit/);
  assert.ok(audit, 'a committed edit must be audited in the same transaction');
  assert.equal(audit!.params[1], 'Alice Admin');
});

// ── BUG (MAJOR / #1/#3): a committed edit with a missing/invalid profile uuid fails LOUD before any write. ─
test('writeMatrix throws (before writing anything) when a committed edit lacks a valid profile uuid', async () => {
  for (const bad of [undefined, null, 'sa1', 'Alice Admin', 'not-a-uuid'] as const) {
    const client = new MockClient();
    const pool = new MockPool(client, {});
    const store = new SupabaseProactivityStore(pool as never);

    await assert.rejects(() => store.writeMatrix(req({ actorProfileId: bad })), /profile UUID/);

    // NOTHING was written — not the config, and critically NOT a false 'committed' audit row (#1).
    assert.equal(findQuery(client.queries, /insert into public\.access_audit/), undefined);
    assert.equal(findQuery(client.queries, /insert into public\.config_values/), undefined);
    assert.equal(findQuery(pool.poolQueries, /insert into public\.access_audit/), undefined);
  }
});

// ── BUG (MAJOR / #1): non-atomic audit-before-commit — a failed UPSERT must ROLL BACK the audit row. ─────
test('writeMatrix rolls back the audit when the config UPSERT fails — no false committed audit row (#1)', async () => {
  const client = new MockClient((sql) => /insert into public\.config_values/.test(sql));
  const pool = new MockPool(client, {});
  const store = new SupabaseProactivityStore(pool as never);

  await assert.rejects(() => store.writeMatrix(req()), /simulated config_values UPSERT failure/);

  // The audit + the UPSERT ran on ONE client inside a transaction that did NOT commit.
  assert.ok(findQuery(client.queries, /^\s*begin/i), 'the committed path must open a transaction');
  assert.ok(findQuery(client.queries, /insert into public\.access_audit/), 'audit must be inside the txn');
  assert.ok(findQuery(client.queries, /rollback/i), 'a failed UPSERT must ROLL BACK');
  assert.equal(findQuery(client.queries, /commit/i), undefined, 'a failed edit must NEVER COMMIT');
  assert.equal(client.released, true, 'the client must be released');

  // Pre-fix, the audit was a standalone pool.query committed BEFORE the UPSERT — this asserts it is NOT.
  assert.equal(findQuery(pool.poolQueries, /insert into public\.access_audit/), undefined);
});

// ── A denied edit is still appended to access_audit (#3 never silent) — standalone, no config write. ────
test('writeMatrix audits a denied (non-Super-Admin) edit and writes no config', async () => {
  const client = new MockClient();
  const pool = new MockPool(client, {});
  const store = new SupabaseProactivityStore(pool as never);

  const out = await store.writeMatrix(req({ isSuperAdmin: false, actorProfileId: null }));
  assert.equal(out.denied, true);
  assert.equal(out.committed, false);

  // the denial is audited (on the pool — a single append-only INSERT is atomic on its own).
  assert.ok(findQuery(pool.poolQueries, /insert into public\.access_audit/), 'denied edit must be audited (#3)');
  // and nothing was committed, and no transaction was opened (denied edits need no config write).
  assert.equal(findQuery(client.queries, /insert into public\.config_values/), undefined);
  assert.equal(findQuery(client.queries, /^\s*begin/i), undefined);
});

// ── committed happy path opens+commits a transaction (no rollback). ─────────────────────────────────────
test('writeMatrix commits a valid Super-Admin edit inside a transaction', async () => {
  const client = new MockClient();
  const pool = new MockPool(client, {});
  const store = new SupabaseProactivityStore(pool as never);

  const out = await store.writeMatrix(req({ ceiling: 'suggest' }));
  assert.equal(out.committed, true);
  assert.ok(findQuery(client.queries, /^\s*begin/i));
  assert.ok(findQuery(client.queries, /commit/i));
  assert.equal(findQuery(client.queries, /rollback/i), undefined);
  assert.equal(client.released, true);
});
