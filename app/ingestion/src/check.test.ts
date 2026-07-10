// ISSUE-026 (C2 ING) — the offline non-drift `check` gate: green against the real repo, and each guard actually fires
// on a drift (so a #3 silent divergence is caught offline, not only live).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCheck } from './index.ts';

// ── green against the real repo ─────────────────────────────────────────────────────────────────────────────────
test('check is GREEN against the real silo migrations + config registry', () => {
  assert.deepEqual(runCheck(), []);
});

// ── each guard fires on a drift ─────────────────────────────────────────────────────────────────────────────────
function scratch(baseline: string, registry: string): { migrations: string; registry: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ing-check-'));
  const migrations = join(dir, 'migrations');
  mkdirSync(migrations);
  writeFileSync(join(migrations, '0001_baseline.sql'), baseline);
  const reg = join(dir, 'config-registry.md');
  writeFileSync(reg, registry);
  return { migrations, registry: reg };
}

const GOOD_BASELINE = `
create type ingestion_state as enum ('pending','deferred','included','excluded','shadow_dropped');
create type sensitivity_tier as enum ('standard','confidential','personal','restricted');
create type event_type as enum ('memory_read','approval_queue_stale');
create table ingestion_queue (
  id uuid primary key,
  content text not null,
  source_ref text,
  flag_reason text,
  suggested_tier sensitivity_tier,
  target_entity_id uuid,
  state ingestion_state not null default 'pending',
  deferred_until timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now()
);
`;
const GOOD_REGISTRY = [
  '| `ingest_defer_resurface_days` | x | 14 | LIVE | int |',
  '| `review_escalation_days` | x | 7 | LIVE | int |',
  '| `chunk_size_tokens` | x | 300 | LIVE | int |',
  '| `rate_limit_memory_writes_per_minute` | x | 30 | LIVE | int |',
  '| `hr_content_enabled` | x | false | BOOT | bool; legal review gate |',
].join('\n');

test('a scratch GOOD fixture is green', () => {
  const s = scratch(GOOD_BASELINE, GOOD_REGISTRY);
  assert.deepEqual(runCheck(s.migrations, s.registry), []);
});

test('a missing ingestion_state value is caught', () => {
  const s = scratch(GOOD_BASELINE.replace(",'shadow_dropped'", ''), GOOD_REGISTRY);
  const f = runCheck(s.migrations, s.registry);
  assert.ok(f.some((x) => x.gate === 'ingestion-state-enum'));
});

test('a missing ingestion_queue column is caught', () => {
  const s = scratch(GOOD_BASELINE.replace('decision_reason text,', ''), GOOD_REGISTRY);
  const f = runCheck(s.migrations, s.registry);
  assert.ok(f.some((x) => x.gate === 'ingestion_queue-columns'));
});

test('the escalation event_type (approval_queue_stale) must be present', () => {
  const s = scratch(GOOD_BASELINE.replace(",'approval_queue_stale'", ''), GOOD_REGISTRY);
  const f = runCheck(s.migrations, s.registry);
  assert.ok(f.some((x) => x.gate === 'event_type-value'));
});

test('hr_content_enabled mis-classed as LIVE (not BOOT) is caught', () => {
  const s = scratch(GOOD_BASELINE, GOOD_REGISTRY.replace('| BOOT | bool; legal review gate |', '| LIVE | bool |'));
  const f = runCheck(s.migrations, s.registry);
  assert.ok(f.some((x) => x.gate === 'cfg-class'));
});

test('a LIVE cfg row mis-classed is caught', () => {
  const s = scratch(GOOD_BASELINE, GOOD_REGISTRY.replace('| `chunk_size_tokens` | x | 300 | LIVE | int |', '| `chunk_size_tokens` | x | 300 | BOOT | int |'));
  const f = runCheck(s.migrations, s.registry);
  assert.ok(f.some((x) => x.gate === 'cfg-class'));
});
