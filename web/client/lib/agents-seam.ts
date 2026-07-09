// ISSUE-067 (surface-09) — the client app's data-access seam into the REAL C8 backend, mirroring rbac-seam.ts.
// This is the ONE relative-import boundary the agent Builder crosses up into @harness/agent-bridge (the web tier's
// sanctioned reach into app/orchestrator · app/specialists · app/execution-plans) so the surface consumes the SAME
// load-bearing logic the harness/RLS enforce — no second source of truth (Rule 0 / AF-080 spirit). Turbopack's
// root=repoRoot (next.config) puts app/* in-tree; every symbol below is pure, framework-free, and pg-free (the
// bridge imports the LEAF modules, never a package index.ts or supabase-store.ts that would pull `pg` into the bundle).
//
// The Builder's save path calls evaluateStagedSave/evaluateBuilderSave — it does NOT re-implement the reject logic.

// The composed reject-at-write guard kernel (the front gate the save path calls).
export {
  evaluateBuilderSave,
  validateMemoryScope,
  toolPickerOptions,
  BUILDER_REJECT_CODES,
} from '../../agent-bridge/src/builder-guard.ts';
export type {
  BuilderSaveInput,
  BuilderSaveVerdict,
  BuilderRejectCode,
  ToolPickerOption,
  ScopeValidation,
} from '../../agent-bridge/src/builder-guard.ts';

// The pure UI-logic layer (the save gate + the OD-080 authority projection the render locks fields with).
export {
  evaluateStagedSave,
  builderAuthority,
  CAPABILITY_LOCKED_AFFORDANCE,
  primaryHealthStale,
} from '../../agent-bridge/src/builder-ui.ts';
export type { BuilderAuthority, StagedBuilderEdit } from '../../agent-bridge/src/builder-ui.ts';

// The tool classifier (id → forbidden class) used by the greyed picker + the save-time deny (one source, OD-140).
export { InMemoryToolClassifier } from '../../../app/specialists/src/store.ts';
export type { ToolClassifier, ForbiddenGrantDetail } from '../../../app/specialists/src/store.ts';

// Registry types + the OD-080 PERM nodes + the memory-tier vocabulary (the real C8 shapes the render binds to).
export {
  AGENT_DOMAINS,
  MEMORY_TIERS,
  ORCHESTRATOR_NAME,
  PERM_AGENTS_VIEW,
  PERM_AGENTS_EDIT_DESCRIPTION,
  PERM_AGENTS_EDIT_CAPABILITY,
} from '../../../app/orchestrator/src/registry.ts';
export type { AgentRow, MemoryScope, MemoryTier, AgentDomain } from '../../../app/orchestrator/src/registry.ts';

// The canonical step-failure-mode taxonomy (halt-and-escalate default — Section E).
export {
  STEP_FAILURE_MODES,
  DEFAULT_STEP_FAILURE_MODE,
  isStepFailureMode,
} from '../../../app/execution-plans/src/taxonomy.ts';
export type { StepFailureMode } from '../../../app/execution-plans/src/taxonomy.ts';
