// ISSUE-067 — @harness/agent-bridge. The ONLY place the web tier reaches into the real C8 backend packages
// (mirrors @harness/rbac-bridge). Re-exports the pg-FREE leaf modules so surface-09 consumes the SAME
// load-bearing logic the harness/RLS enforce — no second source of truth (Rule 0). The relative imports up
// into app/* are permitted by next.config's transpilePackages + turbopack.root=repoRoot (ADR-011: the product
// code is one repo; app/* lives alongside web/). NB: we import the LEAF files directly (registry.ts /
// specialists.ts / store.ts / taxonomy.ts), NEVER each package's index.ts or supabase-store.ts — those pull in
// `pg`, which must never enter the browser bundle. Every symbol below is pure, framework-free, and pg-free.

// ── The agents registry write-path + MemoryScope + OD-080 authority gating (ISSUE-061, C8 REG). ─────────
export {
  InMemoryAgentRegistry,
  InMemoryDenialAuditSink,
  AgentsPermissionDenied,
  AGENT_DOMAINS,
  MEMORY_TIERS,
  ORCHESTRATOR_NAME,
  PERM_AGENTS_VIEW,
  PERM_AGENTS_EDIT_DESCRIPTION,
  PERM_AGENTS_EDIT_CAPABILITY,
  ERR_EMPTY_DESCRIPTION,
  ERR_EMPTY_CHANGE_REASON,
  ERR_EMPTY_MEMORY_SCOPE,
  ERR_SOLE_AGENT_DISABLE,
  CAP_AUTONOMOUS_SEND,
  CAP_TRANSACTION,
  type AgentRow,
  type MemoryScope,
  type MemoryTier,
  type NewAgent,
  type CapabilityEdit,
  type DescriptionEdit,
  type AgentDomain,
  type AgentsPerm,
  type PermChecker,
  type SoleAgentDisableWarning,
  type AgentRegistry,
} from '../../../app/orchestrator/src/registry.ts';

// ── The reject-at-write hard-limit tool guard (ISSUE-062, C8 SPC / AF-068). ─────────────────────────────
export {
  evaluateToolsAllowed,
  evaluateLiveGrant,
  isForbiddenGrant,
  isForbiddenToolClass,
  forbiddenReason,
  ForbiddenCapabilityGrant,
  InMemoryToolClassifier,
  CLASS_MEMORY_WRITE,
  CLASS_AUTONOMOUS_SEND,
  CLASS_TRANSACTION,
  FORBIDDEN_TOOL_CLASSES,
  type ToolClassifier,
  type ForbiddenToolClass,
  type ForbiddenGrantDetail,
} from '../../../app/specialists/src/store.ts';
export {
  SPECIALIST_ROLES,
  SPECIALIST_CONTRACTS,
  allContracts,
  RESEARCH,
  CLIENT,
  CAMPAIGN,
  COMMS,
  OPS,
  MEMORY,
  FINANCE,
  INSIGHT,
  type SpecialistRole,
  type SpecialistContract,
} from '../../../app/specialists/src/specialists.ts';

// ── The canonical step-failure-mode taxonomy (ISSUE-064, C8 PLAN — halt-and-escalate default). ──────────
export {
  STEP_FAILURE_MODES,
  DEFAULT_STEP_FAILURE_MODE,
  isStepFailureMode,
  type StepFailureMode,
} from '../../../app/execution-plans/src/taxonomy.ts';

// ── The composed Builder save-guard (ISSUE-067's own leaf; the surface-09 front gate). ──────────────────
export {
  validateMemoryScope,
  evaluateBuilderSave,
  toolPickerOptions,
  BUILDER_REJECT_CODES,
  type ScopeValidation,
  type BuilderSaveInput,
  type BuilderSaveVerdict,
  type BuilderRejectCode,
  type ToolPickerOption,
} from './builder-guard.ts';

// ── The pure UI-logic layer (save gate + OD-080 authority projection + honest-health helper). ───────────
export {
  evaluateStagedSave,
  builderAuthority,
  CAPABILITY_LOCKED_AFFORDANCE,
  primaryHealthStale,
  type BuilderAuthority,
  type StagedBuilderEdit,
} from './builder-ui.ts';
