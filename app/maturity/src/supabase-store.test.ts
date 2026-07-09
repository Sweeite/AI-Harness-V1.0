// ISSUE-030 (C2 MAT) — LIVE-adapter parity tests via an injected fake Pool (no DB). Proves the SQL the adapter emits
// carries the ONE-WAY latch guard (finding 1: writeColdStartState can never persist a re-armed latch under a lost
// update) and that reading a CORRUPT persisted latch fails LOUD + CLOSED instead of silently re-arming the mode
// (finding 2). The DB-touching truth is the R10 live-adapter smoke; these seam tests pin the SQL/parse contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { SupabaseMaturityStore, COLD_START_LATCH_KEY } from './supabase-store.ts';
import { ColdStartLatchError } from './coldstart.ts';

interface Call {
  text: string;
  params: unknown[];
}

/** A minimal fake Pool that records every query and answers the cold-start SELECT from `latchValue`. */
function fakePool(opts: { latchRows?: { value: unknown }[] } = {}): { pool: Pool; calls: Call[] } {
  const calls: Call[] = [];
  const query = async (text: string, params?: unknown[]) => {
    calls.push({ text, params: params ?? [] });
    if (/select value from config_values where key = \$1/i.test(text)) {
      return { rows: opts.latchRows ?? [], rowCount: (opts.latchRows ?? []).length };
    }
    return { rows: [], rowCount: 0 };
  };
  return { pool: { query } as unknown as Pool, calls };
}

// ── finding 1 — writeColdStartState emits a SQL-level ONE-WAY guard (deactivated is OR'd, never overwritten) ──────
test('AC-2.MAT.002.1: writeColdStartState upsert OR-guards `deactivated` so a stale write cannot clear the latch', async () => {
  const { pool, calls } = fakePool();
  await new SupabaseMaturityStore(pool).writeColdStartState({ deactivated: false, phase: 'basic' });
  const upsert = calls.find((c) => /insert into config_values/i.test(c.text));
  assert.ok(upsert, 'an upsert was emitted');
  const sql = upsert!.text;
  // the on-conflict path must OR the incoming flag with the already-persisted one (not a blind excluded.value overwrite)
  assert.match(sql, /on conflict \(key\) do update set/i);
  assert.match(sql, /jsonb_set/i);
  assert.match(sql, /config_values\.value->>'deactivated'/i);
  assert.match(sql, /excluded\.value->>'deactivated'\)::bool\)/i);
  assert.match(sql, /\bor\b/i);
  assert.ok(!/do update set value = excluded\.value\b/i.test(sql), 'must NOT blindly overwrite value with excluded.value (that re-arms the latch)');
  assert.equal(upsert!.params[0], COLD_START_LATCH_KEY);
});

// ── finding 2 — readColdStartState: no row = default, malformed row = LOUD throw ─────────────────────────────────
test('readColdStartState: NO row is a legitimate fresh-deployment default (mode active), not an error', async () => {
  const { pool } = fakePool({ latchRows: [] });
  assert.deepEqual(await new SupabaseMaturityStore(pool).readColdStartState(), { deactivated: false, phase: 'none' });
});

test('readColdStartState: a well-formed persisted latch round-trips', async () => {
  const { pool } = fakePool({ latchRows: [{ value: { deactivated: true, phase: 'full' } }] });
  assert.deepEqual(await new SupabaseMaturityStore(pool).readColdStartState(), { deactivated: true, phase: 'full' });
});

test('finding 2: a row present but with a non-boolean `deactivated` throws LOUD (never silently re-arms the latch)', async () => {
  const { pool } = fakePool({ latchRows: [{ value: { deactivated: 'yes', phase: 'full' } }] });
  await assert.rejects(() => new SupabaseMaturityStore(pool).readColdStartState(), ColdStartLatchError);
});

test('finding 2: a row missing `deactivated` throws LOUD rather than defaulting to mode-active', async () => {
  const { pool } = fakePool({ latchRows: [{ value: { phase: 'full' } }] });
  await assert.rejects(() => new SupabaseMaturityStore(pool).readColdStartState(), ColdStartLatchError);
});

test('finding 2: a garbage `phase` string is rejected LOUD, not passed through', async () => {
  const { pool } = fakePool({ latchRows: [{ value: { deactivated: true, phase: 'sideways' } }] });
  await assert.rejects(() => new SupabaseMaturityStore(pool).readColdStartState(), ColdStartLatchError);
});

test('finding 2: a null/non-object persisted value throws LOUD', async () => {
  const { pool } = fakePool({ latchRows: [{ value: null }] });
  await assert.rejects(() => new SupabaseMaturityStore(pool).readColdStartState(), ColdStartLatchError);
});
