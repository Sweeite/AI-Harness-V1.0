// @harness/execution-plans — ISSUE-064 (C8 PLAN). Public surface: the canonical failure-mode taxonomy (taxonomy.ts),
// the build-time discipline kernels — assignment / safe default / unattended-halt re-escalation / chain-depth gate
// (plan.ts) — and the versioning + attribution + human-only rollback store (store.ts) with its live pg adapter
// (supabase-store.ts). Consumes ISSUE-061's ExecutionPlan/PlanStep structure (the plan this slice types & versions);
// consumed by ISSUE-052 (C5 executor reads the pre-assigned mode) + ISSUE-067 (agent-builder surface renders history).
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './taxonomy.ts';
export * from './plan.ts';
export * from './store.ts';
export { SupabaseExecutionPlanAdmin, EVT_PLAN_OUTCOME, EVT_PLAN_ROLLBACK, PLAN_EVENT_TYPES } from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ─────────────────────────────────
// execution_plans + step_failure_mode already ship in the 0001 baseline (this slice is VERIFY-PRESENT, not net-new
// — like ISSUE-022). The check asserts the shape THIS slice's discipline + adapter rely on is true in the corpus
// (Rule 0): the versioned store's columns, the self-FK version chain, the unique(task_type_name, version), and — the
// load-bearing one — that the step_failure_mode enum's CANONICAL values are exactly ('retry','skip_and_continue',
// 'halt_and_escalate'). If those enum values drifted, the OD-201 taxonomy this slice canonicalizes to would be wrong
// and a live plan_body validate would diverge (#3). Mirrors the orchestrator `check` (which co-owns execution_plans).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { STEP_FAILURE_MODES } from './taxonomy.ts';
import { PLAN_EVENT_TYPES } from './supabase-store.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');

interface Finding {
  gate: string;
  message: string;
}

export function runCheck(migrationsDir: string = SILO_MIGRATIONS): Finding[] {
  const findings: Finding[] = [];
  let baseline: string;
  try {
    baseline = readFileSync(join(migrationsDir, '0001_baseline.sql'), 'utf8');
  } catch {
    findings.push({ gate: 'baseline-present', message: `0001_baseline.sql not found in ${migrationsDir}` });
    report(findings);
    return findings;
  }

  const start = baseline.indexOf('create table execution_plans');
  const plans = start < 0 ? '' : baseline.slice(start, baseline.indexOf(');', start) + 2);
  if (plans === '') {
    findings.push({ gate: 'execution_plans-present', message: 'create table execution_plans not found in 0001_baseline.sql (this slice is verify-present)' });
  } else {
    const need: [RegExp, string][] = [
      [/task_type_name\s+text not null/, 'execution_plans.task_type_name text NOT NULL'],
      [/version\s+int not null/, 'execution_plans.version int NOT NULL (the version chain)'],
      [/plan_body\s+jsonb not null/, 'execution_plans.plan_body jsonb NOT NULL (steps + per-step canonical failure_mode)'],
      [/previous_version_id uuid references execution_plans\(id\)/, 'execution_plans.previous_version_id self-FK (append-only version chain; rollback appends, never deletes)'],
      [/unique \(task_type_name, version\)/, 'execution_plans UNIQUE (task_type_name, version) (the version race backstop)'],
      [/created_by\s+uuid references profiles\(id\)/, 'execution_plans.created_by → profiles(id) (rollback actor attribution)'],
    ];
    for (const [re, label] of need) if (!re.test(plans)) findings.push({ gate: 'execution_plans-shape', message: `expected ${label} — not found` });
  }

  // the LOAD-BEARING one: the canonical enum values THIS slice maps the orchestrator shorthand onto (OD-201).
  const enumMatch = baseline.match(/create type step_failure_mode\s+as enum \(([^)]*)\)/);
  if (!enumMatch) {
    findings.push({ gate: 'step_failure_mode-enum', message: 'step_failure_mode enum not found in 0001_baseline.sql' });
  } else {
    const values = enumMatch[1]!.match(/'([^']+)'/g)?.map((s) => s.replace(/'/g, '')) ?? [];
    for (const canonical of STEP_FAILURE_MODES) {
      if (!values.includes(canonical)) {
        findings.push({ gate: 'step_failure_mode-values', message: `step_failure_mode enum is missing canonical value '${canonical}' (found: ${values.join(', ')}) — the OD-201 taxonomy would diverge from the DB` });
      }
    }
  }

  // the two event_type values the live adapter writes (attribution + rollback) MUST exist (baseline enum or an ALTER
  // in 0037) — else a live event_log insert throws '22P02'. The in-memory fake accepts any string; the DB does not.
  let planEvents = '';
  try {
    planEvents = readFileSync(join(migrationsDir, '0037_plan_event_types.sql'), 'utf8');
  } catch {
    /* handled by the per-value check below */
  }
  const corpus = [baseline, planEvents].join('\n');
  for (const evt of PLAN_EVENT_TYPES) {
    if (!new RegExp(`add value if not exists '${evt}'`).test(corpus) && !new RegExp(`create type event_type[\\s\\S]*'${evt}'[\\s\\S]*\\);`).test(baseline)) {
      findings.push({ gate: 'event_type-value', message: `event_type '${evt}' is not in the baseline enum nor added by an ALTER TYPE (0037) — a live event_log write would throw` });
    }
  }

  report(findings);
  return findings;
}

function report(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(
      `✓ execution-plans check: execution_plans (task_type_name/version/plan_body/self-FK/unique/created_by) present in baseline · step_failure_mode enum carries the canonical (${STEP_FAILURE_MODES.join(', ')}) — verify-present, taxonomy aligned.`,
    );
  } else {
    console.error(`✗ execution-plans check: ${findings.length} finding(s):`);
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
