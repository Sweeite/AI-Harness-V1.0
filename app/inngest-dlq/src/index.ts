// ISSUE-052 — @harness/inngest-dlq public surface + the `check` command.
//
// `check` is a no-DB, CI-safe non-drift guard: every event_type constant this slice EMITS
// (EMITTED_EVENT_TYPES = task_completed / task_failed / queue_backup) must exist in the live silo's event_type
// enum (0001 baseline). If one were renamed/typo'd, the engine would emit a value the DB rejects — a
// run-completion record, a fan-out partial-failure signal, or the DLQ liveness heartbeat that THROWS instead of
// logging = a silent-failure of the very signal meant to make a failure loud (#3). Run: `tsx src/index.ts check`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EMITTED_EVENT_TYPES } from './store.ts';

// ── Public exports ──────────────────────────────────────────────────────────────────────────────────────────
export * from './store.ts';
export * from './engine.ts';
export { SupabaseProjectionSink, SupabaseEventSink } from './supabase-store.ts';

// ── check ─────────────────────────────────────────────────────────────────────────────────────────────────
const BASELINE = '0001_baseline.sql';

/** Extract the event_type enum's value set from the 0001 baseline `create type event_type as enum (...)`. */
function baselineEventTypes(): Set<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, '..', '..', 'silo', 'migrations', BASELINE);
  const sql = readFileSync(path, 'utf8');
  const m = sql.match(/create\s+type\s+event_type\s+as\s+enum\s*\(([\s\S]*?)\)\s*;/i);
  if (!m) throw new Error(`${BASELINE}: could not locate the event_type enum`);
  return new Set([...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));
}

function fail(msg: string): never {
  console.error(`✗ inngest-dlq check: ${msg}`);
  process.exit(1);
}

export function check(): void {
  const enumValues = baselineEventTypes();
  for (const c of EMITTED_EVENT_TYPES) {
    if (!enumValues.has(c)) {
      fail(
        `event_type constant '${c}' is absent from the ${BASELINE} event_type enum — the engine would emit a value the DB rejects (a run/DLQ record or the DLQ heartbeat throwing instead of logging = #3). Add it via an ALTER TYPE migration or fix the constant.`,
      );
    }
  }
  console.log(
    `✓ inngest-dlq check: all emitted event_type constants (${EMITTED_EVENT_TYPES.map((c) => `'${c}'`).join(', ')}) are present in the live event_type enum (no drift).`,
  );
}

if (process.argv[2] === 'check') check();
