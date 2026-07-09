// @harness/execution-optimisation — ISSUE-054 (C5 OPT). Public surface: the per-deployment config (config.ts), the
// DAG step model + resolver (dag.ts), the decomposition/planning step (plan.ts), the parallel DAG scheduler + OD-056
// approval semantics (scheduler.ts), the AF-113 race-freedom simulation (simulate.ts), smart scheduling
// (smart-schedule.ts), and chained-task pre-warm (prewarm.ts). Port + in-memory reference logic only — the DAG /
// envelope / queue / retrieval stores are owned by ISSUE-049/050/052/053 and consumed here via thin injected ports.
// NO live pg adapter (this slice is config-gated logic over existing stores; it introduces no direct DB write path,
// so there is no supabase-store.ts and no R10 live smoke to run).
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './config.ts';
export * from './dag.ts';
export * from './plan.ts';
export * from './scheduler.ts';
export * from './simulate.ts';
export * from './smart-schedule.ts';
export * from './prewarm.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ──────────────────────────────────────────
// This slice adds NO schema (label-only §5) and NO new event_types. Its correctness rests on config + the shape of
// the existing stores it reads. The check asserts — against the repo (Rule 0 source of truth) — that:
//   1. the three optimisation flags are registered with the documented class: parallel_execution_enabled (BOOT/bool),
//      smart_scheduling_enabled (BOOT/bool), chained_task_prewarm_enabled (BOOT/bool). The FIRST TWO already ship;
//      the THIRD is a proposed additive row (results manifest) — until the orchestrator registers it the check
//      reports ONE EXPECTED pending finding (gate 'cfg-chained_task_prewarm_enabled'); the check.test allowlists it.
//   2. chain_depth_limit is registered LIVE with default 6 (NFR-PERF.007) — the ceiling decomposition binds to.
//   3. the stores the scheduler READS are verify-present in the baseline with the columns it relies on: task_queue
//      (priority, status), task_graph_versions (steps jsonb = the DAG), execution_plans (plan_body jsonb = the plan
//      source). A drift here would break the injected-port shape offline+live identically.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { CFG_KEYS, CHAIN_DEPTH_DEFAULT } from './config.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');
const CONFIG_REGISTRY = join(HERE, '..', '..', '..', 'spec', '02-config', 'config-registry.md');

/** The gate id of the ONE finding that is EXPECTED until the orchestrator registers the proposed prewarm flag. */
export const PENDING_REGISTRATION_GATE = 'cfg-chained_task_prewarm_enabled';

export interface Finding {
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

function cfgRow(cfg: string, key: string): string {
  return cfg.split('\n').find((l) => new RegExp('`' + key + '`').test(l)) ?? '';
}

export function runCheck(migrationsDir: string = SILO_MIGRATIONS, configRegistry: string = CONFIG_REGISTRY): Finding[] {
  const findings: Finding[] = [];

  // 1 + 2. the config keys.
  const cfg = readOr(configRegistry, findings, 'config-registry-present');
  if (cfg) {
    // the two flags that already ship — BOOT/bool.
    for (const [key, gate] of [
      [CFG_KEYS.parallelExecution, 'cfg-parallel_execution_enabled'],
      [CFG_KEYS.smartScheduling, 'cfg-smart_scheduling_enabled'],
    ] as const) {
      const row = cfgRow(cfg, key);
      if (!row) findings.push({ gate, message: `CFG-${key} row not found in config-registry.md` });
      else if (!/\bBOOT\b/.test(row)) findings.push({ gate, message: `CFG-${key} must be BOOT-class (a per-deployment optimisation toggle)` });
    }
    // the proposed additive flag — EXPECTED pending until the orchestrator registers it (do NOT block on it).
    const prewarmRow = cfgRow(cfg, CFG_KEYS.prewarm);
    if (!prewarmRow) {
      findings.push({ gate: PENDING_REGISTRATION_GATE, message: `CFG-${CFG_KEYS.prewarm} row not found in config-registry.md — proposed additive BOOT/bool flag (orchestrator registers; EXPECTED pending)` });
    } else if (!/\bBOOT\b/.test(prewarmRow)) {
      findings.push({ gate: PENDING_REGISTRATION_GATE, message: `CFG-${CFG_KEYS.prewarm} must be BOOT-class (per-deployment pre-warm toggle)` });
    }
    // chain_depth_limit — LIVE, default 6 (NFR-PERF.007).
    const depthRow = cfgRow(cfg, CFG_KEYS.chainDepth);
    if (!depthRow) findings.push({ gate: 'cfg-chain_depth_limit', message: `CFG-${CFG_KEYS.chainDepth} row not found in config-registry.md` });
    else {
      if (!/\bLIVE\b/.test(depthRow)) findings.push({ gate: 'cfg-chain_depth_limit-class', message: `CFG-${CFG_KEYS.chainDepth} must be LIVE-class (NFR-PERF.007 runtime ceiling)` });
      if (!new RegExp(`\\|\\s*${CHAIN_DEPTH_DEFAULT}\\s*\\|`).test(depthRow)) findings.push({ gate: 'cfg-chain_depth_limit-default', message: `CFG-${CFG_KEYS.chainDepth} default must be ${CHAIN_DEPTH_DEFAULT}` });
    }
  }

  // 3. the verify-present store shapes the scheduler reads (baseline is Rule-0 source of truth for shape).
  const baseline = readOr(join(migrationsDir, '0001_baseline.sql'), findings, 'baseline-present');
  if (baseline) {
    const table = (name: string): string => {
      const start = baseline.indexOf(`create table ${name}`);
      return start < 0 ? '' : baseline.slice(start, baseline.indexOf(');', start) + 2);
    };
    const tq = table('task_queue');
    if (!tq) findings.push({ gate: 'task_queue-present', message: 'create table task_queue not found (verify-present) — smart scheduling reads it' });
    else {
      if (!/priority\s+int not null/.test(tq)) findings.push({ gate: 'task_queue-shape', message: 'task_queue.priority int NOT NULL not found — smart scheduling reads priority' });
      if (!/status\s+task_status not null/.test(tq)) findings.push({ gate: 'task_queue-shape', message: 'task_queue.status task_status NOT NULL not found — smart scheduling reads status' });
    }
    const tgv = table('task_graph_versions');
    if (!tgv) findings.push({ gate: 'task_graph_versions-present', message: 'create table task_graph_versions not found (verify-present) — the DAG source' });
    else if (!/steps\s+jsonb not null/.test(tgv)) findings.push({ gate: 'task_graph_versions-shape', message: 'task_graph_versions.steps jsonb NOT NULL not found — the per-step deps the scheduler resolves' });
    const ep = table('execution_plans');
    if (!ep) findings.push({ gate: 'execution_plans-present', message: 'create table execution_plans not found (verify-present) — the plan source' });
    else if (!/plan_body\s+jsonb not null/.test(ep)) findings.push({ gate: 'execution_plans-shape', message: 'execution_plans.plan_body jsonb NOT NULL not found — the ordered plan copied into the envelope' });
  }

  report(findings);
  return findings;
}

function report(findings: Finding[]): void {
  const blocking = findings.filter((f) => f.gate !== PENDING_REGISTRATION_GATE);
  if (findings.length === 0) {
    console.log(
      '✓ execution-optimisation check: parallel_execution_enabled + smart_scheduling_enabled + chained_task_prewarm_enabled BOOT/bool · ' +
        `chain_depth_limit LIVE default ${CHAIN_DEPTH_DEFAULT} · task_queue(priority,status) + task_graph_versions.steps + execution_plans.plan_body verify-present.`,
    );
  } else {
    console.error(`✗ execution-optimisation check: ${findings.length} finding(s) (${blocking.length} blocking, ${findings.length - blocking.length} expected-pending):`);
    for (const f of findings) console.error(`  [${f.gate}]${f.gate === PENDING_REGISTRATION_GATE ? ' (EXPECTED pending registration)' : ''} ${f.message}`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    // Exit non-zero only on BLOCKING findings; the expected pending-registration finding does not fail the gate.
    const blocking = runCheck().filter((f) => f.gate !== PENDING_REGISTRATION_GATE);
    process.exit(blocking.length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
