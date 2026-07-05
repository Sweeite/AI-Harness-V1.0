// @harness/connector-runtime — ISSUE-032 (C3 CONN + REG). Public surface: the ConnectorRuntimeStore
// port + in-memory fake reference model, the shared ToolRuntime (contract dispatch, boundary-tag,
// idempotency guard, minimal-scope), the description-driven selector, and the live pg adapter. The
// downstream C3 runtime concerns (ISSUE-033 token / 034 rate-limit / 035 write-limits / 036 opt /
// 037 trigger) plug into ToolRuntime + ConnectorParams; the connector instances (039/040/041) supply
// ConnectorParams only.

export {
  type ConnectorRuntimeStore,
  InMemoryConnectorRuntimeStore,
  type ToolRow,
  type ToolContract,
  type ToolEdit,
  type ToolCategory,
  type CredentialRow,
  type CredentialState,
  type RateWindowRow,
  type LedgerRow,
  type IntentOutcome,
  TOOL_CATEGORIES,
  CREDENTIAL_STATES,
} from './store.js';

export {
  ToolRuntime,
  type RuntimeDeps,
  type ConnectorParams,
  type ExternalIO,
  type WriteObserver,
  type BoundaryTagged,
  BoundaryTagError,
  ScopeViolationError,
  NotRegisteredError,
  DELETE_GRANTING_SCOPES,
} from './runtime.js';

export { selectTool, descriptionScore, type SelectionResult } from './selection.js';

export { SupabaseConnectorRuntimeStore } from './supabase-store.js';
