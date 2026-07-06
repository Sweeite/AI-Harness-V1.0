// @harness/orchestrator — ISSUE-061 (C8 ORC/REG). Public surface: the AgentRegistry port + in-memory fake +
// live pg adapter, the seven-step OrchestratorEngine + its seams/fakes, the canonical-roster seeder + REG.006.3
// positive check, and the OD-080 PERM gate. Consumers: ISSUE-053 (run pipeline — executes the plans), 062
// (specialist definitions — seeded here), 064 (execution_plans structure — co-owned), 065/066 (consume the
// per-candidate scores + plan outcomes emitted here).
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './registry.ts';
export * from './routing.ts';
export * from './seed.ts';
export * from './fakes.ts';
export { SupabaseAgentRegistry } from './supabase-store.ts';

// ── `check` — offline build-time gate (no DB, no network) ────────────────────────────────────────
// Asserts the baseline schema invariants this slice depends on are true in the migration corpus (Rule 0: the
// migrations are the built reality). If any drifts, the build fails LOUD rather than shipping a store that
// assumes a shape the DB does not have (#3). Mirrors the prompt-store / silo `check` gates.
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

  // (1) `agents` shape (verify-present — this slice does NOT re-create it; §8 step 1).
  const agents = blockOf('agents');
  if (agents === '') {
    findings.push({ gate: 'agents-present', message: 'create table agents not found in 0001_baseline.sql' });
  } else {
    const need: [RegExp, string][] = [
      [/description\s+text not null/, 'agents.description text NOT NULL (routing signal, AC-8.REG.001.2)'],
      [/memory_scope\s+jsonb not null/, 'agents.memory_scope jsonb NOT NULL'],
      [/tools_allowed\s+uuid\[\]\s+not null default '\{\}'/, "agents.tools_allowed uuid[] NOT NULL default '{}'"],
      [/enabled\s+boolean not null default true/, 'agents.enabled boolean NOT NULL default true'],
      [/version\s+int not null default 1/, 'agents.version int NOT NULL default 1'],
      [/previous_version_id uuid references agents\(id\)/, 'agents.previous_version_id self-FK'],
      [/change_reason\s+text not null/, 'agents.change_reason text NOT NULL'],
    ];
    for (const [re, label] of need) {
      if (!re.test(agents)) findings.push({ gate: 'agents-shape', message: `agents: expected ${label} — not found` });
    }
    // AC-8.REG.001.1 / .3 — NO system_prompt, NO model, NO client_slug column.
    for (const forbidden of ['system_prompt', 'model', 'client_slug']) {
      // match a column declaration, not a comment mention (comments are stripped line-wise)
      const noComments = agents.replace(/--.*$/gm, '');
      if (new RegExp(`(^|,|\\()\\s*${forbidden}\\s+`, 'm').test(noComments)) {
        findings.push({ gate: 'agents-no-forbidden-col', message: `agents must NOT carry a '${forbidden}' column (AC-8.REG.001.1/.3, OD-075/ADR-001 §3) — found one` });
      }
    }
  }

  // (2) `execution_plans` shape (co-owned w/ ISSUE-064 — verify-present, note co-ownership in proposed-shared-spec).
  const plans = blockOf('execution_plans');
  if (plans === '') {
    findings.push({ gate: 'execution_plans-present', message: 'create table execution_plans not found in 0001_baseline.sql' });
  } else {
    const need: [RegExp, string][] = [
      [/plan_body\s+jsonb not null/, 'execution_plans.plan_body jsonb NOT NULL (steps + per-step failure_mode + deps)'],
      [/previous_version_id uuid references execution_plans\(id\)/, 'execution_plans.previous_version_id self-FK (version chain)'],
      [/unique \(task_type_name, version\)/, 'execution_plans UNIQUE (task_type_name, version)'],
    ];
    for (const [re, label] of need) {
      if (!re.test(plans)) findings.push({ gate: 'execution_plans-shape', message: `execution_plans: expected ${label} — not found` });
    }
  }

  // (3) `prompt_layers` core-layer shape (REG.002 / ORC.008.1 — Layer-1 single source; verify-present).
  const pl = blockOf('prompt_layers');
  if (pl === '') {
    findings.push({ gate: 'prompt_layers-present', message: 'create table prompt_layers not found in 0001_baseline.sql' });
  } else {
    if (!/agent_id\s+uuid references agents\(id\)/.test(pl)) {
      findings.push({ gate: 'prompt_layers-shape', message: 'prompt_layers.agent_id → agents(id) not found (Layer-1 resolution key, REG.002)' });
    }
    if (!/check \(layer <> 'core' or agent_id is not null\)/.test(pl)) {
      findings.push({ gate: 'prompt_layers-shape', message: "prompt_layers CHECK (layer='core' ⇒ agent_id not null) not found (ORC.008.1)" });
    }
  }

  // (4) `event_log` append target (the observability sink, §8.9 — verify-present).
  const ev = blockOf('event_log');
  if (ev === '') {
    findings.push({ gate: 'event_log-present', message: 'create table event_log not found in 0001_baseline.sql' });
  } else if (!/summary\s+text not null/.test(ev)) {
    findings.push({ gate: 'event_log-shape', message: 'event_log.summary text NOT NULL not found (never-empty routing summaries)' });
  }

  report(findings);
  return findings;
}

function report(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(
      '✓ orchestrator check: agents (no system_prompt/model/client_slug; description/memory_scope/change_reason NOT NULL; self-FK version chain) · execution_plans (plan_body, self-FK, unique task_type+version) · prompt_layers (agent_id core-layer) · event_log (summary NOT NULL) — all present in baseline.',
    );
  } else {
    console.error(`✗ orchestrator check: ${findings.length} finding(s):`);
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
