// ISSUE-025 — check.ts gate test: the offline non-drift gate passes against the real repo, and fails loudly on a
// synthetic drift (a CFG row demoted from LIVE, a missing enum value).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCheck } from './index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');
const REAL_REGISTRY = join(HERE, '..', '..', '..', 'spec', '02-config', 'config-registry.md');

test('check passes against the real repo (read-path only — no migration)', () => {
  const findings = runCheck(REAL_MIGRATIONS, REAL_REGISTRY);
  assert.deepEqual(findings, [], `expected zero findings, got: ${JSON.stringify(findings)}`);
});

test('check FAILS when the memory_read event_type is missing from the baseline (would throw 22P02 live)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ret-check-'));
  try {
    mkdirSync(join(dir, 'm'));
    // a baseline whose event_type enum omits memory_read + whose answer_mode is intact.
    writeFileSync(
      join(dir, 'm', '0001_baseline.sql'),
      `create type answer_mode as enum ('cited','inferred','unknown','building');
       create type visibility_tier as enum ('global','team','private');
       create type sensitivity_tier as enum ('standard','confidential','personal','restricted');
       create type clearance_tier as enum ('confidential','personal');
       create type event_type as enum ('task_started','tool_called');`,
    );
    const findings = runCheck(join(dir, 'm'), REAL_REGISTRY);
    assert.ok(findings.some((f) => f.gate === 'event_type-value'), 'the missing memory_read is caught');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check FAILS when a required CFG row is demoted from LIVE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ret-cfg-'));
  try {
    // copy the real registry, then demote memories_injected_per_task's LIVE → REBUILD.
    const dst = join(dir, 'config-registry.md');
    cpSync(REAL_REGISTRY, dst);
    const text = readFileSync(dst, 'utf8').replace(/(`memories_injected_per_task`.*?\|)\s*LIVE\s*(\|)/, '$1 REBUILD $2');
    writeFileSync(dst, text);
    const findings = runCheck(REAL_MIGRATIONS, dst);
    assert.ok(findings.some((f) => f.gate === 'cfg-class'), 'the demoted CFG row is caught');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
