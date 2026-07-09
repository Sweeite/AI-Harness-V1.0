// @harness/memory-write — ISSUE-024 (C2 WRT). Public surface: the sole-writer orchestration (writer.ts), the
// validate-and-commit port + in-memory reference fake (commit.ts), the source-typed confidence bands
// (confidence.ts), the contradiction classifier (contradiction.ts), and the live pg adapters (supabase-store.ts).
// Consumed by ISSUE-026 (ingestion routes through writeMemories, FR-2.ING.010) + the human PERM-memory.write path.
//
// The default export path also exposes a `check` CLI (offline build-time non-drift gate, no DB) — see runCheck().

export * from './confidence.ts';
export * from './contradiction.ts';
export * from './commit.ts';
export * from './writer.ts';
export {
  SupabaseCommitStore,
  SupabaseWriteEventSink,
  SupabaseSimilarReader,
  EVT_MEMORY_WRITTEN,
  EVT_AUTHZ_REVOKED_MIDTASK,
  EVT_WRITE_SUPERSEDED,
  EVT_WRITE_CONFLICT,
  EVT_WRITE_EMBED_FAILED,
  WRITE_EVENT_TYPES,
} from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ─────────────────────────────────────────
// The memories/entities/memory_conflicts tables + the idempotency/watermark/CHECK constraints already ship in the
// 0001 baseline (this slice is VERIFY-PRESENT — an absence is an ISSUE-022/008 gap, flagged not silently added).
// The check asserts — against the repo (Rule 0) — the shape THIS slice's writer + commit adapter rely on:
//   1. memories carries the idempotency/watermark/CAS/pointer columns + the two DB CHECKs + unique(idempotency_key).
//   2. the (entity_ids, updated_at) watermark index exists (ADR-004 §6) — the commit re-check reads it.
//   3. the WRITE event_type values (0039) exist — else a live event_log write throws 22P02.
//   4. the CFG keys (rate_limit_memory_writes_per_minute LIVE, memory_write_serialization, review_escalation_days)
//      are registered — the writer rate-cap (never unlimited, AC-NFR-COST.008.2) + the escalation clock read them.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { WRITE_EVENT_TYPES } from './supabase-store.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');
const CONFIG_REGISTRY = join(HERE, '..', '..', '..', 'spec', '02-config', 'config-registry.md');

interface Finding {
  gate: string;
  message: string;
}

function readOr(path: string, findings: Finding[], gate: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    findings.push({ gate, message: `${path} not found` });
    return null;
  }
}

export function runCheck(migrationsDir: string = SILO_MIGRATIONS, configRegistry: string = CONFIG_REGISTRY): Finding[] {
  const findings: Finding[] = [];

  // 1. memories columns + CHECKs + unique(idempotency_key) (verify-present in the baseline).
  const baseline = readOr(join(migrationsDir, '0001_baseline.sql'), findings, 'baseline-present');
  if (baseline) {
    const start = baseline.indexOf('create table memories');
    const memories = start < 0 ? '' : baseline.slice(start, baseline.indexOf(');', start) + 2);
    if (!memories) {
      findings.push({ gate: 'memories-present', message: 'create table memories not found in 0001_baseline.sql (verify-present)' });
    } else {
      const need: [RegExp, string][] = [
        [/content_hash\s+text\s+not null/, 'memories.content_hash text NOT NULL (idempotency component)'],
        [/idempotency_key\s+text\s+not null/, 'memories.idempotency_key text NOT NULL'],
        [/superseded_by\s+uuid\s+references memories\(id\)/, 'memories.superseded_by uuid references memories(id) (CAS chain)'],
        [/updated_at\s+timestamptz\s+not null/, 'memories.updated_at (watermark component)'],
        [/unique\s*\(idempotency_key\)/, 'unique(idempotency_key) (ADR-004 §4 — ON CONFLICT DO NOTHING)'],
        [/check\s*\(cardinality\(entity_ids\)\s*>=\s*1\)/, 'check(cardinality(entity_ids) >= 1)'],
        [/check\s*\(source\s*=\s*'system_pointer'\s+or\s+confidence\s+is\s+not\s+null\)/, "check(source='system_pointer' or confidence is not null)"],
      ];
      for (const [re, label] of need) if (!re.test(memories)) findings.push({ gate: 'memories-columns', message: `expected ${label} — not found (ISSUE-022/008 gap)` });
    }
    if (baseline.indexOf('create table memory_conflicts') < 0) {
      findings.push({ gate: 'memory_conflicts-present', message: 'create table memory_conflicts not found in 0001_baseline.sql (the quarantine target)' });
    }
  }

  // 2. the (entity_ids, updated_at) watermark index (ADR-004 §6) — created in 0001b_indexes.sql.
  const indexes = readOr(join(migrationsDir, '0001b_indexes.sql'), findings, 'indexes-present');
  if (indexes && !/memories\s*\(\s*entity_ids\s*,\s*updated_at\s*\)/i.test(indexes) && !/on\s+memories[^;]*entity_ids[^;]*updated_at/i.test(indexes)) {
    findings.push({ gate: 'watermark-index', message: 'the (entity_ids, updated_at) watermark index not found in 0001b_indexes.sql (ADR-004 §6 — the commit re-check reads it)' });
  }

  // 3. the WRITE event_type values (0039) exist in the migration corpus.
  const evt = readOr(join(migrationsDir, '0039_memory_write_event_types.sql'), findings, 'write-event-types-migration');
  const corpus = [baseline ?? '', evt ?? ''].join('\n');
  for (const e of WRITE_EVENT_TYPES) {
    if (!new RegExp(`add value if not exists '${e}'`).test(corpus) && !new RegExp(`create type event_type[\\s\\S]*'${e}'[\\s\\S]*\\);`).test(baseline ?? '')) {
      findings.push({ gate: 'event_type-value', message: `event_type '${e}' is not in the baseline enum nor added by 0039 — a live event_log write would throw 22P02` });
    }
  }

  // 4. the CFG keys in the config registry (Rule 0 source of truth).
  const cfg = readOr(configRegistry, findings, 'config-registry-present');
  if (cfg) {
    const rateRow = cfg.split('\n').find((l) => /`rate_limit_memory_writes_per_minute`/.test(l)) ?? '';
    if (!rateRow) findings.push({ gate: 'cfg-rate-limit', message: 'CFG-rate_limit_memory_writes_per_minute row not found in config-registry.md' });
    else if (!/LIVE/.test(rateRow)) findings.push({ gate: 'cfg-rate-limit-class', message: 'CFG-rate_limit_memory_writes_per_minute must be LIVE-class (the writer safety ceiling)' });
    if (!cfg.split('\n').some((l) => /`memory_write_serialization`/.test(l))) findings.push({ gate: 'cfg-serialization', message: 'CFG-memory_write_serialization row not found in config-registry.md (ADR-004 §Config)' });
    if (!cfg.split('\n').some((l) => /`review_escalation_days`/.test(l))) findings.push({ gate: 'cfg-review-escalation', message: 'CFG-review_escalation_days row not found in config-registry.md (AC-2.WRT.002.3 escalation clock)' });
  }

  report(findings);
  return findings;
}

function report(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(
      `✓ memory-write check: memories idempotency/watermark/CAS columns + the two CHECKs + unique(idempotency_key) present · ` +
        `(entity_ids, updated_at) watermark index present · WRITE event_types present (0039) · ` +
        `CFG rate_limit_memory_writes_per_minute (LIVE) + memory_write_serialization + review_escalation_days registered.`,
    );
  } else {
    console.error(`✗ memory-write check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
