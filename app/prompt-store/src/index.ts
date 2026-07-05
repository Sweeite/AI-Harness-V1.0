// @harness/prompt-store — ISSUE-042 (C4 LYR/STO). Public surface: the PromptStore port + in-memory fake,
// the PromptService (version discipline, PERM gating, rollback, pinning, assembly), the layer/PERM
// contract + the FR-4.LYR.004 halt hook, the RBAC gate + denial sink, and the editor-side helpers. The
// content slices (043-046) and the run pipeline (053) consume this store; that is the seam this slice
// stops at.
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export {
  LAYER_KINDS,
  LAYER_ORDER,
  PERM,
  REQUIRED_ELEMENTS,
  isLayerKind,
  slotOf,
  validateAssembledCore,
  type AssemblyValidationResult,
  type LayerKind,
  type LayerSlot,
  type PromptPerm,
  type RequiredElement,
  type RequiredElementCheck,
  type RequiredElementChecks,
  type ResolvedCore,
} from './layers.js';

export {
  InMemoryPromptStore,
  type AssetKey,
  type EditInput,
  type NewLayerInput,
  type PromptLayer,
  type PromptStore,
} from './store.js';

export {
  InMemoryDenialAuditSink,
  PromptPermissionDenied,
  enforcePerm,
  type DenialAuditSink,
  type DenialLogRow,
  type PermChecker,
} from './rbac.js';

export {
  PromptService,
  type AssembledStructure,
  type AssemblyPin,
  type PromptServiceDeps,
} from './service.js';

export {
  LAYER1_WORD_TARGET_MAX,
  toHistoryView,
  validateSave,
  wordCount,
  type HistoryEntry,
  type SaveValidation,
} from './editor.js';

export { SupabasePromptStore } from './supabase-store.js';

// ── `check` — offline build-time gate (no DB, no network) ────────────────────────────────────────
// Asserts the schema invariants this slice depends on are true in the migration corpus (Rule 0: the
// migrations are the built reality). If any drifts, the build fails LOUD rather than shipping a store
// that assumes a shape the DB does not have (#3). This is the prompt-store analogue of the silo/release
// `check` gates.
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

  // (1) The baseline prompt_layers shape this slice depends on (verify-present, not re-create — §8 step 2).
  const baseline = read('0001_baseline.sql');
  if (baseline === null) {
    findings.push({ gate: 'baseline-present', message: `0001_baseline.sql not found in ${migrationsDir}` });
  } else {
    const block = baseline.slice(baseline.indexOf('create table prompt_layers'));
    const plBlock = block.slice(0, block.indexOf(');') + 2);
    const need: [RegExp, string][] = [
      [/create type prompt_layer_kind\s+as enum\s*\('core','business','memory','task_template'\)/, "prompt_layer_kind enum = core|business|memory|task_template"],
      [/layer\s+prompt_layer_kind not null/, 'prompt_layers.layer prompt_layer_kind NOT NULL'],
      [/change_reason\s+text not null/, 'prompt_layers.change_reason text NOT NULL'],
      [/previous_version_id uuid references prompt_layers\(id\)/, 'prompt_layers.previous_version_id self-FK'],
      [/check \(layer <> 'core' or agent_id is not null\)/, "prompt_layers CHECK (layer='core' ⇒ agent_id not null)"],
    ];
    for (const [re, label] of need) {
      const hay = re.source.includes('prompt_layer_kind\\s+as enum') ? baseline : plBlock;
      if (!re.test(hay)) findings.push({ gate: 'schema-shape', message: `prompt_layers: expected ${label} — not found in 0001_baseline.sql` });
    }
    // OD-096 / FR-10.ISO.001 / AC-4.STO.001.1 — NO client_slug column on prompt_layers.
    if (/client_slug/.test(plBlock)) {
      findings.push({ gate: 'no-client-slug', message: 'prompt_layers must NOT carry client_slug (OD-096 / FR-10.ISO.001 / AC-4.STO.001.1) — found one' });
    }
  }

  // (2) The 0004 version-discipline migration this slice ADDS must be present, forbid in-place mutation,
  //     require a non-empty change_reason, and cover prompt_layers with an RLS policy (composes on 0002).
  const disc = read('0004_prompt_version_discipline.sql');
  if (disc === null) {
    findings.push({ gate: 'migration-present', message: '0004_prompt_version_discipline.sql not found — this slice must ship it' });
  } else {
    if (!/create\s+(?:or\s+replace\s+)?trigger[\s\S]*?before[\s\S]*?(update|delete)[\s\S]*?on\s+(?:public\.)?prompt_layers/is.test(disc)) {
      findings.push({ gate: 'version-trigger', message: '0004 must install a BEFORE UPDATE OR DELETE trigger on prompt_layers (append-only-by-version)' });
    }
    if (!/create\s+policy\b[\s\S]*?on\s+(?:public\.)?prompt_layers/is.test(disc)) {
      findings.push({ gate: 'rls-policy', message: '0004 must add an RLS policy on prompt_layers (PERM-prompt.edit read/write gate, composing on the 0002 default-deny floor)' });
    }
    // The initplan-wrap discipline: any helper/auth call in the 0004 policy must be (select …)-wrapped
    // (AF-067). A bare user_perms(auth.uid()) is the anti-pattern — reuse the silo lint's rule textually.
    const policyBody = (disc.match(/create\s+policy[\s\S]*?;/gi) ?? []).join('\n').replace(/--.*$/gm, '');
    const stripped = policyBody.replace(/\(\s*select[\s\S]*?\)/gi, ' ');
    if (/\b(user_perms|user_clearances|user_restricted|user_aal|auth\.uid|auth\.jwt|auth\.role)\s*\(/i.test(stripped)) {
      findings.push({ gate: 'initplan-wrap', message: '0004 prompt_layers policy has an unwrapped permission lookup — wrap every helper/auth call as `(select fn(…))` (AF-067 / AC-1.RLS.002.2)' });
    }
  }

  if (findings.length === 0) {
    console.log('✓ prompt-store check: prompt_layers baseline shape present (no client_slug) · 0004 version-discipline trigger + RLS policy present + initplan-wrapped.');
  } else {
    console.error(`✗ prompt-store check: ${findings.length} finding(s):`);
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

// Only run the CLI when invoked directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
