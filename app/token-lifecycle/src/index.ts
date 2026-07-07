// @harness/token-lifecycle — ISSUE-033 (C3 TOK). The generic OAuth token-lifecycle runtime that lives
// once in the connector-runtime spine and serves every connector. Public surface:
//   - the CredentialStore port + in-memory fake reference model + the live pg adapter (over the shared
//     connector_credentials table, ISSUE-032 / baseline 0001);
//   - the RefreshEngine — single-flight + ATOMIC rotate-persist + grace-window recovery (FR-3.TOK.005);
//   - the 3-layer model (proactive / reactive-401 / dead-token degrade) + the metric hook (TokenLayers,
//     RefreshMetric);
//   - the per-connector TokenParams data sets (Google / GHL / Slack — FR-3.TOK.007/008/009);
//   - the no-token-leak redaction boundary (FR-3.TOK.001 / NFR-SEC.003).
// The connector INSTANCES (ISSUE-039/040/041) supply the VendorRefresh + ConnectorParams; this slice
// owns none of that.

export {
  type CredentialStore,
  type CredentialRow,
  type CredentialState,
  type RotatePersist,
  type PersistOutcome,
  InMemoryCredentialStore,
  CREDENTIAL_STATES,
} from './store.js';

export {
  RefreshEngine,
  type RefreshEngineDeps,
  type RefreshResult,
  type VendorRefresh,
  type VendorTokenResponse,
  type PersistRetryDriver,
  immediatePersistRetry,
  DeadRefreshTokenError,
  RotatePersistLostError,
} from './refresh.js';

export {
  TokenLayers,
  RefreshMetric,
  type LayerDeps,
  type ReauthSignal,
} from './layers.js';

export {
  type TokenParams,
  type TokenCapWarning,
  GOOGLE_TOKEN_PARAMS,
  GHL_TOKEN_PARAMS,
  slackTokenParams,
  SLACK_TOKEN_PARAMS_DEFAULT,
  REFRESH_TOKEN_CAP_APPROACH_THRESHOLD,
  detectCapApproach,
} from './params.js';

export {
  REDACTED,
  type CredentialPresence,
  redactCredential,
  redact,
  findTokenLeaks,
} from './redact.js';

export { SupabaseCredentialStore } from './supabase-store.js';
