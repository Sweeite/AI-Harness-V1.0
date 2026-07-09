// @harness/embeddings — ISSUE-023 (C2 VEC). Public surface: the embed-on-write step (embed.ts), the AF-019
// retrieval-session index-usage contract (retrieval-session.ts), the expand-contract model-change state machine + the
// reconcile gate (model-change.ts), the VectorAdmin port + in-memory reference model (store.ts), and the live pg
// adapter (supabase-store.ts). Consumed by ISSUE-024 (the sole-writer wraps embedForWrite) + ISSUE-025 (retrieval
// consumes retrievalSessionSql + the HNSW index this slice guarantees).
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './embed.ts';
export * from './retrieval-session.ts';
export * from './model-change.ts';
export * from './store.ts';
export {
  SupabaseVectorAdmin,
  SupabaseModelChangeObserver,
  EVT_MODEL_CHANGE,
  EVT_REEMBED_PROGRESS,
  EVT_RECONCILE_BLOCKED,
  EMBEDDING_EVENT_TYPES,
} from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ─────────────────────────────────────────
// The memories table + the HNSW index + the embedding columns already ship in the 0001 baseline / 0001b_indexes (this
// slice is VERIFY-PRESENT for the index, like ISSUE-022/064). The check asserts — against the repo (Rule 0) — that the
// shape THIS slice's contract + adapter rely on is true:
//   1. memories carries embedding vector(1536) NOT NULL + embedding_model text + embedding_v2 vector(1536).
//   2. the HNSW index exists with the DOCUMENTED params (hnsw, vector_cosine_ops, m=16, ef_construction=64) — the
//      params the live hnswIndexInfo() reads back for AC-2.VEC.001.1; a drift here means the assertion would fail live.
//   3. CFG-ef_search is LIVE with the 10-500 range + default 40 in the config registry — the bounds retrieval-session.ts
//      enforces; and CFG-embedding_model is REBUILD-class (a model change is expand-contract, never a live swap).
//   4. the additive embedding event_type values (0038) exist in the migration corpus — else a live event_log write throws.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { HNSW_PARAMS } from './store.ts';
import { EF_SEARCH_MIN, EF_SEARCH_MAX, EF_SEARCH_DEFAULT } from './retrieval-session.ts';
import { EMBEDDING_EVENT_TYPES } from './supabase-store.ts';

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

  // 1. the memories embedding columns (baseline).
  const baseline = readOr(join(migrationsDir, '0001_baseline.sql'), findings, 'baseline-present');
  if (baseline) {
    const start = baseline.indexOf('create table memories');
    const memories = start < 0 ? '' : baseline.slice(start, baseline.indexOf(');', start) + 2);
    if (!memories) {
      findings.push({ gate: 'memories-present', message: 'create table memories not found in 0001_baseline.sql (verify-present)' });
    } else {
      const need: [RegExp, string][] = [
        [/embedding\s+vector\(1536\)\s+not null/, 'memories.embedding vector(1536) NOT NULL'],
        [/embedding_model\s+text\s+not null/, 'memories.embedding_model text NOT NULL'],
        [/embedding_v2\s+vector\(1536\)/, 'memories.embedding_v2 vector(1536) (the expand-contract slot)'],
      ];
      for (const [re, label] of need) if (!re.test(memories)) findings.push({ gate: 'memories-embedding-cols', message: `expected ${label} — not found` });
    }
  }

  // 2. the HNSW index with the documented params (0001b_indexes).
  const indexes = readOr(join(migrationsDir, '0001b_indexes.sql'), findings, 'indexes-present');
  if (indexes) {
    const idx = indexes.match(/create index[^;]*memories_embedding_hnsw[^;]*;/i)?.[0] ?? '';
    if (!idx) {
      findings.push({ gate: 'hnsw-index-present', message: 'memories_embedding_hnsw index not found in 0001b_indexes.sql' });
    } else {
      const checks: [RegExp, string][] = [
        [/using\s+hnsw/i, 'USING hnsw'],
        [/vector_cosine_ops/i, `opclass ${HNSW_PARAMS.opclass}`],
        [new RegExp(`m\\s*=\\s*${HNSW_PARAMS.m}\\b`), `m = ${HNSW_PARAMS.m}`],
        [new RegExp(`ef_construction\\s*=\\s*${HNSW_PARAMS.efConstruction}\\b`), `ef_construction = ${HNSW_PARAMS.efConstruction}`],
        [/\(\s*embedding\b/i, 'on the embedding column'],
      ];
      for (const [re, label] of checks) if (!re.test(idx)) findings.push({ gate: 'hnsw-index-params', message: `memories_embedding_hnsw missing ${label} — the live hnswIndexInfo() assertion (AC-2.VEC.001.1) would drift` });
    }
  }

  // 3. CFG-ef_search bounds + CFG-embedding_model class in the config registry (Rule 0 source of truth).
  const cfg = readOr(configRegistry, findings, 'config-registry-present');
  if (cfg) {
    const efRow = cfg.split('\n').find((l) => /`ef_search`/.test(l)) ?? '';
    if (!efRow) findings.push({ gate: 'cfg-ef_search', message: 'CFG-ef_search row not found in config-registry.md' });
    else {
      if (!/LIVE/.test(efRow)) findings.push({ gate: 'cfg-ef_search-class', message: 'CFG-ef_search must be LIVE-class (the runtime recall/latency dial)' });
      if (!new RegExp(`${EF_SEARCH_MIN}[–\\-]${EF_SEARCH_MAX}`).test(efRow)) findings.push({ gate: 'cfg-ef_search-range', message: `CFG-ef_search range must be ${EF_SEARCH_MIN}–${EF_SEARCH_MAX} (retrieval-session.ts assertEfSearch)` });
      if (!new RegExp(`\\|\\s*${EF_SEARCH_DEFAULT}\\s*\\|`).test(efRow)) findings.push({ gate: 'cfg-ef_search-default', message: `CFG-ef_search default must be ${EF_SEARCH_DEFAULT}` });
    }
    const modelRow = cfg.split('\n').find((l) => /`embedding_model`/.test(l)) ?? '';
    if (!modelRow) findings.push({ gate: 'cfg-embedding_model', message: 'CFG-embedding_model row not found in config-registry.md' });
    else if (!/REBUILD/.test(modelRow)) findings.push({ gate: 'cfg-embedding_model-class', message: 'CFG-embedding_model must be REBUILD-class (a model change is expand-contract, never a live swap)' });
  }

  // 4. the additive embedding event_type values (0038 or baseline).
  const evt = readOr(join(migrationsDir, '0038_embedding_event_types.sql'), findings, 'embedding-event-types-migration');
  const corpus = [baseline ?? '', evt ?? ''].join('\n');
  for (const e of EMBEDDING_EVENT_TYPES) {
    if (!new RegExp(`add value if not exists '${e}'`).test(corpus) && !new RegExp(`create type event_type[\\s\\S]*'${e}'[\\s\\S]*\\);`).test(baseline ?? '')) {
      findings.push({ gate: 'event_type-value', message: `event_type '${e}' is not in the baseline enum nor added by 0038 — a live event_log write would throw 22P02` });
    }
  }

  report(findings);
  return findings;
}

function report(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(
      `✓ embeddings check: memories embedding cols (vector(1536)+model+v2) present · memories_embedding_hnsw carries ` +
        `hnsw/${HNSW_PARAMS.opclass}/m=${HNSW_PARAMS.m}/ef_construction=${HNSW_PARAMS.efConstruction} · CFG-ef_search LIVE ` +
        `${EF_SEARCH_MIN}–${EF_SEARCH_MAX} default ${EF_SEARCH_DEFAULT} · CFG-embedding_model REBUILD · embedding event_types present (0038).`,
    );
  } else {
    console.error(`✗ embeddings check: ${findings.length} finding(s):`);
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
