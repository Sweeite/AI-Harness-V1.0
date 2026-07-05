// @harness/prompt-layer-identity — ISSUE-043 (C4 CID/PRIN). Public surface: the Layer-1 content contract
// (six-element completeness + non-removable safety elements + advisory length), the canonical
// seven-principle block + the hard floor, the Super-Admin-only principles-edit path (PERM gate + safety
// event + propagation), the statement-not-enforcement invariant, and the CorePromptStore port + in-memory
// fake + live pg adapter. This slice writes `core` records INTO the ISSUE-042 prompt_layers store; the run
// pipeline (ISSUE-053) consumes `assemblyRequiredElementChecks` for the FR-4.LYR.004 assembly re-check.
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export {
  CANONICAL_PRINCIPLES,
  PRINCIPLE_IDS,
  checkSevenPrincipleFloor,
  defaultPrinciplesBlock,
  renderCanonicalPrinciplesBlock,
  renderPrinciplesBlock,
  type FloorResult,
  type Principle,
  type PrincipleId,
  type PrinciplesBlock,
} from './principles.ts';

export {
  ANSWER_MODES,
  CANONICAL_HARD_LIMITS,
  LAYER1_WORD_TARGET_MAX,
  SECTION,
  assemblyRequiredElementChecks,
  contentHasAllSevenPrinciplesVerbatim,
  defaultLayer1,
  hasAllSevenPrinciples,
  hasAnswerModeInstruction,
  hasBoundaryInstruction,
  hasHardLimitStatement,
  hasUncertaintyHandling,
  renderLayer1Content,
  sectionBody,
  validateLayer1,
  wordCount,
  type ElementFinding,
  type Layer1Content,
  type Layer1ElementKey,
  type Layer1Validation,
} from './core-record.ts';

export {
  InMemoryAuditSink,
  PERM,
  PrinciplesPermissionDenied,
  enforcePerm,
  type AuditSink,
  type DenialLogRow,
  type PermChecker,
  type PromptPerm,
  type SafetyEventRow,
} from './rbac.ts';

export {
  InMemoryCorePromptStore,
  type CoreEditInput,
  type CorePromptStore,
  type LayerKind,
  type NewCoreInput,
  type PromptLayer,
} from './store.ts';

export {
  Layer1IdentityService,
  Layer1SaveRejected,
  PrinciplesFloorBreach,
  splicePrinciplesBlock,
  type Layer1IdentityDeps,
  type PrinciplesEditResult,
} from './service.ts';

export {
  RbacCodeControl,
  controlUnaffectedByPromptWeakening,
  weakenPrinciple,
  type CodeControl,
} from './code-control.ts';

export { SupabaseCorePromptStore } from './supabase-store.ts';

// ── `check` — offline build-time gate (no DB, no network) ────────────────────────────────────────
// This slice authors NO migration (prompt_layers is ISSUE-042's). The check VERIFIES the baseline
// prompt_layers shape this slice writes `core` records into is present in the migration corpus (Rule 0:
// the migrations are the built reality). If the table this slice depends on drifts, the build fails LOUD
// rather than shipping a content validator that assumes a shape the DB does not have (#3).
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

  // (1) The baseline prompt_layers shape this slice writes `core` records into (verify-present, NOT
  //     re-create — this slice authors no migration). Mirrors ISSUE-042's check for the columns this
  //     content slice depends on.
  const baseline = read('0001_baseline.sql');
  if (baseline === null) {
    findings.push({ gate: 'baseline-present', message: `0001_baseline.sql not found in ${migrationsDir} — prompt_layers (ISSUE-042) is the table this slice writes into` });
  } else {
    const start = baseline.indexOf('create table prompt_layers');
    if (start < 0) {
      findings.push({ gate: 'prompt_layers-present', message: 'create table prompt_layers not found in 0001_baseline.sql (ISSUE-042 dependency)' });
    } else {
      const block = baseline.slice(start);
      const plBlock = block.slice(0, block.indexOf(');') + 2);
      const need: [RegExp, string][] = [
        [/create type prompt_layer_kind\s+as enum\s*\('core','business','memory','task_template'\)/, "prompt_layer_kind enum = core|business|memory|task_template"],
        [/layer\s+prompt_layer_kind not null/, 'prompt_layers.layer prompt_layer_kind NOT NULL'],
        [/content\s+text not null/, 'prompt_layers.content text NOT NULL (the record this slice validates)'],
        [/change_reason\s+text not null/, 'prompt_layers.change_reason text NOT NULL (mandatory on principles edit)'],
        [/previous_version_id uuid references prompt_layers\(id\)/, 'prompt_layers.previous_version_id self-FK (version chain the propagation appends onto)'],
        [/check \(layer <> 'core' or agent_id is not null\)/, "prompt_layers CHECK (layer='core' ⇒ agent_id not null)"],
      ];
      for (const [re, label] of need) {
        const hay = re.source.includes('prompt_layer_kind\\s+as enum') ? baseline : plBlock;
        if (!re.test(hay)) findings.push({ gate: 'schema-shape', message: `prompt_layers: expected ${label} — not found in 0001_baseline.sql` });
      }
      if (/client_slug/.test(plBlock)) {
        findings.push({ gate: 'no-client-slug', message: 'prompt_layers must NOT carry client_slug (OD-096 / FR-10.ISO.001 / AC-4.STO.001.1) — found one' });
      }
    }
  }

  // (2) This slice authors NO new migration — assert we did not add one under a prompt-identity name
  //     (a fan-out safety check: the migration corpus is owned elsewhere; ISSUE-043 is content-only).
  //     (No positive migration to assert; the check is the absence of an over-reach, verified by the
  //     orchestrator's migration-journal reconciliation, not here.)

  if (findings.length === 0) {
    console.log('✓ prompt-layer-identity check: prompt_layers baseline shape (ISSUE-042) present + no client_slug — the core-record store this slice writes into is intact. No migration authored by this slice.');
  } else {
    console.error(`✗ prompt-layer-identity check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
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
