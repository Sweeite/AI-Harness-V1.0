// @harness/webhook-auth — ISSUE-017 (C0 WHK). Public surface: the shared verification entrypoint,
// the WebhookStore port + in-memory fake, rotation + obscurity helpers, and config. The ingesting
// component (C2/C3, ISSUE-037/026) consumes `verifyWebhook` and, on a 200 outcome, takes
// `outcome.verifiedPayload` — that is the seam boundary this slice stops at.

export { verifyWebhook, type VerifyDeps } from './verify.js';
export { type VerifyOutcome, type HttpStatus } from './outcome.js';
export {
  type WebhookStore,
  InMemoryWebhookStore,
  type Connector,
  type ActiveSecret,
  type WebhookSecretRow,
  type GuardrailLogRow,
  type EventLogRow,
  type AuditRow,
  type WebhookAlert,
} from './store.js';
export {
  DEFAULT_WEBHOOK_CONFIG,
  validateWebhookConfig,
  type WebhookConfig,
  SECRET_KIND,
  type SecretKind,
  GHL_LEGACY_HEADER_CUTOFF,
  GOOGLE_CERTS_URL,
} from './config.js';
export { ingress, type InboundRequest, type Ingress } from './rawBody.js';
export { sourceId } from './source.js';
export { rotateSecret, retireOldVersions, rotationWindowSeconds, type RotationResult } from './rotation.js';
export { mintEndpointToken, webhookPath, isValidEndpointToken } from './obscurity.js';
export { type Jwks } from './verifiers/google.js';
