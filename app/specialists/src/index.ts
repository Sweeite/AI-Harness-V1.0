// @harness/specialists — ISSUE-062 (C8 SPC). Public surface: the eight specialist behavioural contracts + pure
// reference behaviours (specialists.ts), the reject-at-write hard-limit guard (kernel + classifier + port +
// in-memory reference + rejection log, store.ts), and the live pg adapter (supabase-store.ts). Consumers:
// ISSUE-063 (per-agent memory scoping — needs the specialist rows + memory_scope), ISSUE-067 (agent-builder
// surface — renders the greyed-picker reasons this slice's classifier drives, OD-140).
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './specialists.ts';
export * from './store.ts';
export { SupabaseSpecialistRegistry, TOOL_CLASS_CONFIG_KEY } from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ─────────────────────────────────
// Asserts the baseline DDL shapes THIS slice's guard + live adapter depend on are true in the migration corpus
// (Rule 0: the migrations are the built reality). The reject-at-write guard classifies tools_allowed ids against
// `tools`; if the columns it reads drift, the live adapter would misclassify and let a forbidden grant through
// (#2) — so the build fails LOUD here rather than shipping a guard that assumes a shape the DB does not have (#3).
// Mirrors the orchestrator / rls-enforcement `check` gates.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');

interface Finding {
  gate: string;
  message: string;
}

export function runCheck(migrationsDir: string = SILO_MIGRATIONS): Finding[] {
  const findings: Finding[] = [];
  const read = (f: string): string | null => {
    try {
      return readFileSync(join(migrationsDir, f), 'utf8');
    } catch {
      return null;
    }
  };

  const baseline = read('0001_baseline.sql');
  if (baseline === null) {
    findings.push({ gate: 'baseline-present', message: `0001_baseline.sql not found in ${migrationsDir}` });
    report(findings);
    return findings;
  }

  const blockOf = (table: string): string => {
    const start = baseline.indexOf(`create table ${table}`);
    if (start < 0) return '';
    return baseline.slice(start, baseline.indexOf(');', start) + 2);
  };

  // (1) `agents` — the reject-at-write target column (§8 step 4). tools_allowed uuid[] is what the guard reads/writes.
  const agents = blockOf('agents');
  if (agents === '') {
    findings.push({ gate: 'agents-present', message: 'create table agents not found in 0001_baseline.sql' });
  } else {
    const need: [RegExp, string][] = [
      [/tools_allowed\s+uuid\[\]\s+not null default '\{\}'/, "agents.tools_allowed uuid[] NOT NULL default '{}' (the reject-at-write target, AC-8.SPC.003.3/.004.3/.005.2)"],
      [/description\s+text not null/, 'agents.description text NOT NULL (the routing signal, SPC.001)'],
      [/memory_scope\s+jsonb not null/, 'agents.memory_scope jsonb NOT NULL (carried across the version append)'],
      [/previous_version_id uuid references agents\(id\)/, 'agents.previous_version_id self-FK (append-only version chain)'],
      [/change_reason\s+text not null/, 'agents.change_reason text NOT NULL (every tools_allowed edit is audited)'],
    ];
    for (const [re, label] of need) {
      if (!re.test(agents)) findings.push({ gate: 'agents-shape', message: `agents: expected ${label} — not found` });
    }
  }

  // (2) `tools` — the class-predicate source (§8 step 4). tools_allowed → tools.id; the guard reads config for the
  // version-controlled hard_limit_class tag; category is the coarse read/write (proves send/transact/memory-write
  // are NOT separable by column — the whole reason the identity predicate exists).
  const tools = blockOf('tools');
  if (tools === '') {
    findings.push({ gate: 'tools-present', message: 'create table tools not found in 0001_baseline.sql' });
  } else {
    const need: [RegExp, string][] = [
      [/id\s+uuid primary key/, 'tools.id uuid PK (the target of the tools_allowed → tools.id class lookup)'],
      [/category\s+tool_category not null/, "tools.category tool_category NOT NULL (only 'read'|'write' — cannot split send/transact/memory-write; hence the identity predicate)"],
      [/config\s+jsonb not null default '\{\}'/, "tools.config jsonb NOT NULL default '{}' (carries the version-controlled hard_limit_class tag the live classifier reads)"],
    ];
    for (const [re, label] of need) {
      if (!re.test(tools)) findings.push({ gate: 'tools-shape', message: `tools: expected ${label} — not found` });
    }
  }

  // (3) tool_category is exactly ('read','write') — proves neither 'send'/'transact'/'memory_write' is an enum value
  // (so the guard's identity predicate is REQUIRED, not redundant with a column). Drift here = the predicate premise broke.
  if (!/create type tool_category\s+as enum \('read','write'\)/.test(baseline)) {
    findings.push({
      gate: 'tool_category-enum',
      message: "tool_category enum expected exactly ('read','write') — the class predicate premise (no send/transact/memory-write column) drifted",
    });
  }

  report(findings);
  return findings;
}

function report(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(
      '✓ specialists check: agents.tools_allowed (uuid[] reject-at-write target) + self-FK version chain · tools (id/category/config — the class-predicate source) · tool_category = (read,write) only — all present in baseline; the identity-based hard-limit class predicate premise holds.',
    );
  } else {
    console.error(`✗ specialists check: ${findings.length} finding(s):`);
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
