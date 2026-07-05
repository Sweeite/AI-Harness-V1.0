// @harness/prompt-optimisation — ISSUE-046 (C4 OPT). Public surface: the PromptOptimisationStore port +
// in-memory fake reference model (version-to-outcome attribution + dynamic-Layer-2 fresh injection), the
// live pg adapter, and the compression-discipline editor affordance. Implements FR-4.OPT.001/002/003, all
// resting on the AF-111 build-time EVAL (feasibility-register block O).
//
// This slice consumes ISSUE-042's stable version identity + ISSUE-044's dynamic_field_values; it adds NO
// migration and owns NO shared spec. C5 (ISSUE-053) writes the actual completion/outcome record the
// attribution attaches to — see the required-fields contract in store.ts + the proposed attribution
// columns in results/opt001-attribution-columns.sql.

export {
  InMemoryPromptOptimisationStore,
  LAYER_SLOTS,
  type DynamicFieldValue,
  type InjectedDynamicField,
  type LayerSlot,
  type OutcomeRecord,
  type PromptOptimisationStore,
  type TaskOutcome,
  type VersionAttribution,
  type VersionOutcomeBucket,
  type VersionRef,
} from './store.js';

export {
  LAYER1_WORD_TARGET_MAX,
  compressionAffordance,
  saveBlockedForLength,
  wordCount,
  type CompressionAffordance,
} from './editor.js';

export { SupabasePromptOptimisationStore } from './supabase-store.js';
