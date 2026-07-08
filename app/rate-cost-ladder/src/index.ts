// ISSUE-058 — @harness/rate-cost-ladder public surface + the `check` non-drift guard.
//
// `check` is a no-DB, CI-safe build-time guard that catches drift between this package's baked-in constants and
// the live source-of-truth files (#3 — a silent drift about a guardrail's threshold is exactly the failure this
// slice exists to prevent). It asserts:
//   (1) `rate_limit` is present in the guardrail_type enum (0001 baseline) — the type every row here writes;
//   (2) the four cost-ladder defaults (50/200/75/100) match config-registry.md AND are strictly ordered;
//   (3) each of the five rate caps' defaults match config-registry.md, each has a finite ceiling > default;
//   (4) exactly ONE cost model-gate exists (AC-NFR-COST.007.2) and the lever order has all five levers.
// Run: `tsx src/index.ts check`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CAP_IDS, CAP_POLICIES } from './caps.ts';
import { DEFAULT_COST_THRESHOLDS, COST_LEVER_ORDER, COST_MODEL_GATES, validateCostThresholds } from './ladder.ts';
import { GUARDRAIL_TYPE_RATE_LIMIT } from './store.ts';

// ── Public exports ──────────────────────────────────────────────────────────────────────────────
export * from './caps.ts';
export * from './ladder.ts';
export * from './store.ts';
export { SupabaseGuardrailLogSink } from './supabase-store.ts';

// ── check ─────────────────────────────────────────────────────────────────────────────────────
const BASELINE = '0001_baseline.sql';
const REGISTRY = ['spec', '02-config', 'config-registry.md'];

function repoRoot(): string {
  // src → package → app → repo root
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/** The guardrail_type enum value set from the 0001 baseline. */
function baselineGuardrailTypes(): Set<string> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'silo', 'migrations', BASELINE);
  const sql = readFileSync(path, 'utf8');
  const m = sql.match(/create\s+type\s+guardrail_type\s+as\s+enum\s*\(([\s\S]*?)\)\s*;/i);
  if (!m) throw new Error(`${BASELINE}: could not locate the guardrail_type enum`);
  return new Set([...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));
}

/** The cells of a config-registry.md row for `key` (['', '`key`', 'description', 'default', 'scope', 'range', '']). */
function registryRow(registry: string, key: string): string[] {
  const line = registry.split('\n').find((l) => l.includes('`' + key + '`'));
  if (!line) throw new Error(`config-registry.md: key '${key}' not found`);
  return line.split('|').map((c) => c.trim());
}

/** The first integer in the default (value) cell of a config-registry.md row for `key`. */
function registryDefault(registry: string, key: string): number {
  const cells = registryRow(registry, key);
  const valueCell = cells[3];
  if (!valueCell) throw new Error(`config-registry.md: key '${key}' has no default cell`);
  const digits = valueCell.replace(/[,$]/g, '').match(/\d+/);
  if (!digits) throw new Error(`config-registry.md: key '${key}' default cell '${valueCell}' has no number`);
  return Number(digits[0]);
}

/**
 * The declared UPPER BOUND of a config-registry.md range cell, if the range is bounded above, else null.
 * A bounded range reads `int <lo>–<hi> (…)` (e.g. `int 1–200`); an unbounded one reads `int ≥ 0` (no upper).
 * Used to catch a code ceiling that has drifted away from the registry's stated max (e.g. a ceiling silently
 * bumped to 999) — the previous gate only checked ceiling > default and finiteness, which such a drift passes.
 */
function registryRangeUpper(registry: string, key: string): number | null {
  const cells = registryRow(registry, key);
  const rangeCell = cells[5];
  if (!rangeCell) throw new Error(`config-registry.md: key '${key}' has no range cell`);
  // A bounded range is `<lo><dash><hi>` where dash is an en/em/hyphen dash.
  const m = rangeCell.replace(/[,$]/g, '').match(/(\d+)\s*[–—-]\s*(\d+)/);
  return m ? Number(m[2]) : null;
}

interface Finding {
  gate: string;
  ok: boolean;
  detail: string;
}

export function runChecks(): Finding[] {
  const findings: Finding[] = [];
  const registry = readFileSync(join(repoRoot(), ...REGISTRY), 'utf8');

  // (1) guardrail_type enum contains 'rate_limit'.
  const enumValues = baselineGuardrailTypes();
  findings.push({
    gate: 'guardrail_type-has-rate_limit',
    ok: enumValues.has(GUARDRAIL_TYPE_RATE_LIMIT),
    detail: `enum={${[...enumValues].join(',')}} — writing '${GUARDRAIL_TYPE_RATE_LIMIT}'`,
  });

  // (2) cost-ladder defaults match the registry AND are strictly ordered.
  const costKeyDefaults: Array<[string, number]> = [
    ['cost_ladder_soft_threshold_daily_usd', DEFAULT_COST_THRESHOLDS.softDailyUsd],
    ['cost_ladder_soft_threshold_weekly_usd', DEFAULT_COST_THRESHOLDS.softWeeklyUsd],
    ['cost_ladder_throttle_threshold', DEFAULT_COST_THRESHOLDS.throttleDailyUsd],
    ['cost_ladder_hard_kill_threshold', DEFAULT_COST_THRESHOLDS.hardKillDailyUsd],
  ];
  for (const [key, coded] of costKeyDefaults) {
    const reg = registryDefault(registry, key);
    findings.push({
      gate: `cost-default:${key}`,
      ok: reg === coded,
      detail: `code=${coded} registry=${reg}`,
    });
  }
  const ordered = validateCostThresholds(DEFAULT_COST_THRESHOLDS);
  findings.push({
    gate: 'cost-ladder-strictly-ordered',
    ok: ordered.ok,
    detail: ordered.ok ? '50 < 75 < 100' : ordered.reason,
  });

  // (3) rate-cap defaults match the registry; each cap has a finite ceiling > default and a sane floor.
  for (const cap of CAP_IDS) {
    const p = CAP_POLICIES[cap];
    const reg = registryDefault(registry, cap);
    const ceilingOk = Number.isFinite(p.ceiling) && p.ceiling > p.default && p.default >= p.min;
    findings.push({
      gate: `cap:${cap}`,
      ok: reg === p.default && ceilingOk,
      detail: `default code=${p.default} registry=${reg}; floor=${p.min} ceiling=${p.ceiling} (finite,>default=${ceilingOk})`,
    });
    // Cross-check the code ceiling against the registry's declared range max — a bounded cap whose baked-in
    // ceiling has drifted from the registry (e.g. tool_writes ceiling silently → 999) is a drift the gate above
    // does NOT catch. A cap with an UNBOUNDED-above registry range (max_retries: `int ≥ 0`) has no max to
    // compare — that known divergence is tracked in sharedSpecEdits (registry should be tightened), not failed.
    const regUpper = registryRangeUpper(registry, cap);
    if (regUpper !== null) {
      findings.push({
        gate: `cap-ceiling-matches-registry-range:${cap}`,
        ok: p.ceiling === regUpper,
        detail: `ceiling code=${p.ceiling} registry-range-max=${regUpper}`,
      });
    }
  }

  // (4) exactly one cost model-gate + the full five-lever order (AC-NFR-COST.007.2 / ADR-003 §7).
  findings.push({
    gate: 'exactly-one-cost-model-gate',
    ok: COST_MODEL_GATES.length === 1,
    detail: `gates={${COST_MODEL_GATES.join(',')}}`,
  });
  findings.push({
    gate: 'cost-lever-order-complete',
    ok: COST_LEVER_ORDER.length === 5,
    detail: `levers={${COST_LEVER_ORDER.join(',')}}`,
  });

  return findings;
}

function main(): void {
  const findings = runChecks();
  let failed = 0;
  for (const f of findings) {
    const mark = f.ok ? 'PASS' : 'FAIL';
    if (!f.ok) failed++;
    console.log(`[${mark}] ${f.gate} — ${f.detail}`);
  }
  if (failed > 0) {
    console.error(`\n✗ rate-cost-ladder check: ${failed} non-drift gate(s) FAILED.`);
    process.exit(1);
  }
  console.log(`\n✓ rate-cost-ladder check: all ${findings.length} non-drift gates passed.`);
}

// Run only when invoked as the CLI (tsx src/index.ts check), never on import.
const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly && process.argv[2] === 'check') main();
