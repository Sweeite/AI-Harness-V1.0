// ISSUE-067 (surface-09 · UI-AGENT-BUILDER) — the offline, no-DB non-drift `check` gate for the Builder save-guard.
//
// The guard (builder-guard.ts) is pure logic, but it makes STRUCTURAL ASSUMPTIONS about the real schema that, if they
// drift, would let a green offline suite ship a guard the live write path contradicts (a #3 silent-drift risk). This
// gate reads the repo (Rule 0 source of truth) and asserts every shape the guard + its live composition rely on:
//   1. `agents` (0001_baseline.sql) carries the columns the versioned write path + the guard touch —
//      description text NOT NULL · memory_scope jsonb NOT NULL · tools_allowed uuid[] · enabled · version ·
//      previous_version_id (the version chain) · change_reason text NOT NULL.
//   2. `tools` carries `category tool_category` + `config jsonb` — the exact projection the FAIL-CLOSED live tool
//      gate (evaluateLiveGrant) reads (category='write' + config->>'hard_limit_class'); a drift here breaks the
//      reject-at-write classification the Builder's live save path composes.
//   3. every value of the DB `memory_type` enum is a member of MEMORY_TIERS — the guard's tier vocabulary must be a
//      SUPERSET of what the DB can actually store, else validateMemoryScope would reject a legitimately-stored tier.
//   4. GUARD/SEED NON-DRIFT: the value the canonical roster is seeded with — `memory_scope = '{}'::jsonb`
//      (0001d_seed.sql, OD-177 fail-closed default) — is ACCEPTED by validateMemoryScope. This is the regression
//      that pins the guard to the seed: if the guard's scope contract ever tightens to reject '{}' again, EVERY
//      capability edit that round-trips a seed agent's existing scope would be blocked. Fail here, loudly.
//
// It does NOT assert config-registry / PERMISSION_NODES rows: this slice ships the pg-free guard KERNEL, which has no
// runtime CFG/PERM dependency (those gate the surface, minted with the surface-09 sections). See the residuals note.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { MEMORY_TIERS } from '../../../app/orchestrator/src/registry.ts';
import { validateMemoryScope } from './builder-guard.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', '..', 'app', 'silo', 'migrations');

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

/** Slice out a `create table <name> ( … );` block, or '' if absent. */
function tableBlock(sql: string, name: string): string {
  const start = sql.indexOf(`create table ${name}`);
  if (start < 0) return '';
  const end = sql.indexOf(');', start);
  return end < 0 ? '' : sql.slice(start, end + 2);
}

export function runCheck(migrationsDir: string = SILO_MIGRATIONS): Finding[] {
  const findings: Finding[] = [];

  const baseline = readOr(join(migrationsDir, '0001_baseline.sql'), findings, 'baseline-present');
  if (baseline) {
    // 1. agents columns the versioned write path + guard rely on.
    const agents = tableBlock(baseline, 'agents');
    if (!agents) {
      findings.push({ gate: 'agents-present', message: 'create table agents not found in 0001_baseline.sql' });
    } else {
      const need: [RegExp, string][] = [
        [/description\s+text\s+not null/, 'agents.description text NOT NULL (routing signal — REG.001.2)'],
        [/memory_scope\s+jsonb\s+not null/, 'agents.memory_scope jsonb NOT NULL (least-privilege filter — SCO.003.1)'],
        [/tools_allowed\s+uuid\[\]\s+not null/, 'agents.tools_allowed uuid[] NOT NULL (reject-at-write set — SPC)'],
        [/enabled\s+boolean\s+not null/, 'agents.enabled boolean NOT NULL (routing candidacy — REG.005)'],
        [/version\s+int\s+not null/, 'agents.version int NOT NULL (version discipline — REG.004)'],
        [/previous_version_id\s+uuid\s+references\s+agents\(id\)/, 'agents.previous_version_id uuid → agents(id) (version chain — REG.004.2)'],
        [/change_reason\s+text\s+not null/, 'agents.change_reason text NOT NULL (mandatory on every write — REG.004.1)'],
      ];
      for (const [re, label] of need) {
        if (!re.test(agents)) findings.push({ gate: 'agents-columns', message: `expected ${label} — not found in agents DDL` });
      }
    }

    // 2. tools projection the fail-closed live tool gate reads (evaluateLiveGrant).
    const tools = tableBlock(baseline, 'tools');
    if (!tools) {
      findings.push({ gate: 'tools-present', message: 'create table tools not found in 0001_baseline.sql' });
    } else {
      if (!/category\s+tool_category\s+not null/.test(tools)) {
        findings.push({ gate: 'tools-columns', message: 'expected tools.category tool_category NOT NULL — the coarse read/write split evaluateLiveGrant fail-closes on — not found' });
      }
      if (!/config\s+jsonb\s+not null/.test(tools)) {
        findings.push({ gate: 'tools-columns', message: "expected tools.config jsonb NOT NULL — carries config->>'hard_limit_class' the live classifier reads — not found" });
      }
    }

    // 3. every DB memory_type value must be a member of MEMORY_TIERS (guard vocabulary ⊇ DB vocabulary).
    const memType = baseline.match(/create type memory_type\s+as enum\s*\(([^)]*)\)/i)?.[1] ?? '';
    if (!memType) {
      findings.push({ gate: 'memory_type-enum', message: 'create type memory_type … as enum not found in 0001_baseline.sql' });
    } else {
      const dbTiers = Array.from(memType.matchAll(/'([^']+)'/g)).map((m) => m[1] as string);
      for (const t of dbTiers) {
        if (!(MEMORY_TIERS as readonly string[]).includes(t)) {
          findings.push({
            gate: 'memory_type-superset',
            message: `DB memory_type value '${t}' is not in MEMORY_TIERS (${MEMORY_TIERS.join(', ')}) — validateMemoryScope would reject a legitimately-stored tier`,
          });
        }
      }
    }
  }

  // 4. guard/seed non-drift: the seeded '{}'::jsonb default must be ACCEPTED by validateMemoryScope.
  const seed = readOr(join(migrationsDir, '0001d_seed.sql'), findings, 'seed-present');
  if (seed) {
    if (!/memory_scope\s*=\s*'\{\}'::jsonb|'\{\}'::jsonb/.test(seed)) {
      findings.push({ gate: 'seed-scope-literal', message: "0001d_seed.sql no longer seeds memory_scope = '{}'::jsonb — the guard/seed non-drift anchor moved; re-verify the contract" });
    }
    const v = validateMemoryScope({}); // the exact runtime value the seeded '{}'::jsonb deserialises to
    if (!v.ok) {
      findings.push({
        gate: 'seed-scope-accepted',
        message: `validateMemoryScope({}) REJECTS the seeded fail-closed default — '${v.reason}'. This would block every capability edit that round-trips a seed agent's scope (guard/seed drift).`,
      });
    }
  }

  report(findings);
  return findings;
}

function report(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(
      '✓ agent-bridge check: agents versioned-write columns present · tools category/config present for the ' +
        'fail-closed live gate · MEMORY_TIERS ⊇ DB memory_type · validateMemoryScope accepts the seeded \'{}\' default.',
    );
  } else {
    console.error(`✗ agent-bridge check: ${findings.length} finding(s):`);
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
