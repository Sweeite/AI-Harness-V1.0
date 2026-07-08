// ISSUE-065 — @harness/agent-health public surface + the `check` command. `check` is a no-DB, CI-safe non-drift
// guard: the three CFG defaults this slice hard-codes (drift_threshold, dead_agent_threshold,
// polling_interval_health_metrics_s) MUST equal the registered defaults in config-registry.md. If a default
// silently drifted, this producer would flag agents against a different threshold than the operator configured
// and reads — a #3 silent inconsistency between the code and the config register (Rule-0). Run: `tsx src/index.ts check`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_DRIFT_THRESHOLD,
  DEFAULT_DEAD_AGENT_THRESHOLD,
  DEFAULT_POLLING_INTERVAL_HEALTH_METRICS_S,
} from './store.ts';

// ── Public exports ──────────────────────────────────────────────────────────────────────────────
export * from './store.ts';
export * from './health.ts';
export { SupabaseAgentHealthStore } from './supabase-store.ts';

// ── check ─────────────────────────────────────────────────────────────────────────────────────
const CONFIG_REGISTRY = join('spec', '02-config', 'config-registry.md');

/** Parse the numeric default for a config key out of config-registry.md's table row
 *  (`| \`<key>\` | <desc> | <default> | <scope> | <validation> |`). Extracts the first number in the default
 *  cell (so "0.5 success-rate" → 0.5). Throws with a clear message if the row/number is absent (no silent skip). */
function registryDefault(key: string): number {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, '..', '..', '..', CONFIG_REGISTRY);
  const md = readFileSync(path, 'utf8');
  const rowRe = new RegExp(`^\\|\\s*\`${key}\`\\s*\\|(.*)$`, 'm');
  const row = md.match(rowRe);
  if (!row) throw new Error(`${CONFIG_REGISTRY}: could not locate the '${key}' config row`);
  const cells = row[1]!.split('|').map((c) => c.trim());
  // cells[0] = description, cells[1] = default (key was consumed by the regex prefix).
  const defaultCell = cells[1];
  if (defaultCell === undefined) throw new Error(`${CONFIG_REGISTRY}: '${key}' row has no default column`);
  const numMatch = defaultCell.match(/-?\d+(?:\.\d+)?/);
  if (!numMatch) throw new Error(`${CONFIG_REGISTRY}: '${key}' default '${defaultCell}' has no parseable number`);
  return Number(numMatch[0]);
}

/**
 * The pure, no-side-effect CFG-drift guard: assert the three hard-coded code defaults equal the registered
 * defaults in config-registry.md. THROWS on any drift (so it can be exercised by the gating AC suite, not just
 * the standalone `check` script — a #3 guarantee that isn't run by the test that flips the issue `done` is not a
 * guarantee). Returns the three matched values on success. `check()` wraps this with console output + exit code.
 */
export function verifyCfgDefaults(): {
  drift_threshold: number;
  dead_agent_threshold: number;
  polling_interval_health_metrics_s: number;
} {
  const cases: Array<[string, number]> = [
    ['drift_threshold', DEFAULT_DRIFT_THRESHOLD],
    ['dead_agent_threshold', DEFAULT_DEAD_AGENT_THRESHOLD],
    ['polling_interval_health_metrics_s', DEFAULT_POLLING_INTERVAL_HEALTH_METRICS_S],
  ];
  for (const [key, constant] of cases) {
    const registered = registryDefault(key);
    if (registered !== constant) {
      throw new Error(
        `CFG default drift: '${key}' = ${registered} in ${CONFIG_REGISTRY} but the code constant is ${constant}. ` +
          `The producer would use a threshold the operator never configured (#3). Reconcile the constant with the register.`,
      );
    }
  }
  return {
    drift_threshold: DEFAULT_DRIFT_THRESHOLD,
    dead_agent_threshold: DEFAULT_DEAD_AGENT_THRESHOLD,
    polling_interval_health_metrics_s: DEFAULT_POLLING_INTERVAL_HEALTH_METRICS_S,
  };
}

export function check(): void {
  let matched: ReturnType<typeof verifyCfgDefaults>;
  try {
    matched = verifyCfgDefaults();
  } catch (err) {
    console.error(`✗ agent-health check: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log(
    `✓ agent-health check: the three CFG defaults match config-registry.md ` +
      `(drift_threshold=${matched.drift_threshold}, dead_agent_threshold=${matched.dead_agent_threshold}, ` +
      `polling_interval_health_metrics_s=${matched.polling_interval_health_metrics_s}) — no drift.`,
  );
}

if (process.argv[2] === 'check') check();
