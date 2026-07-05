// ISSUE-017 §5 CFG — the `CFG-webhook.*` tunables the verification pipeline consults. Values +
// validation ranges are transcribed VERBATIM from spec/02-config/config-registry.md §B (Rule 0 —
// the registry is the source of truth). These are DEFAULTS; at runtime a deployment's config store
// (ISSUE-010) supplies the live values. Nothing here is a vendor secret — those live in
// `webhook_secrets` and are read through the WebhookStore port, never inline (ADR-001 §5).

export interface WebhookConfig {
  /** Slack: reject a webhook whose timestamp is older than this BEFORE the signature check.
   *  registry: int seconds 60–900, default 300. (AC-0.WHK.004.1) */
  replay_window_seconds: number;
  /** GHL/Google: how long a seen event ID stays in the replay cache (drop dupes within it).
   *  registry: duration ≥ replay_window_seconds, default 300 s. (AC-0.WHK.008.1) */
  replay_cache_window: number;
  /** Dual-accept rotation: how long old + new signing secret both verify.
   *  registry: duration, default 24 h. (FR-0.WHK.007) */
  secret_rotation_window: number;
  /** Google Pub/Sub push JWT `aud`. Per-deployment URL (BOOT; required when Google connector on).
   *  (AC-0.WHK.003.1) — the value itself lives in webhook_secrets; this is the CFG slot for it. */
  google_expected_audience: string | null;
  /** Per source per minute — verified webhooks above this are throttled.
   *  registry: int per source per minute ≥ 1, default 60/min. (AC-0.WHK.008.2) */
  accept_rate_limit: number;
  /** Per source per hour — MORE THAN this many verification failures → alert + auto-throttle.
   *  registry: int per source per hour ≥ 1, default 3/hr. Alert fires on the 4th ("> 3"). (AC-0.WHK.005.2) */
  failure_alert_threshold: number;
}

// Registry defaults (config-registry.md §B, lines 89–94). Durations in seconds.
export const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
  replay_window_seconds: 300, // 5 min
  replay_cache_window: 300, // 5 min (≥ replay_window_seconds — enforced below)
  secret_rotation_window: 24 * 60 * 60, // 24 h
  google_expected_audience: null, // per-deployment; required when Google connector is enabled
  accept_rate_limit: 60, // 60 / source / min
  failure_alert_threshold: 3, // 3 / source / hr (alert on the 4th)
};

// Registry validation ranges — a deployment's config store MUST reject values outside these
// (config validation is ISSUE-010's job; this makes the contract explicit + gives us a guard for
// the boot path). Returns the config unchanged, or throws loudly (#3 — never silently clamp).
export function validateWebhookConfig(c: WebhookConfig): WebhookConfig {
  const fail = (m: string): never => {
    throw new Error(`invalid CFG-webhook config: ${m}`);
  };
  if (!Number.isInteger(c.replay_window_seconds) || c.replay_window_seconds < 60 || c.replay_window_seconds > 900)
    fail(`replay_window_seconds must be an int in [60,900] (got ${c.replay_window_seconds})`);
  if (c.replay_cache_window < c.replay_window_seconds)
    fail(`replay_cache_window (${c.replay_cache_window}) must be ≥ replay_window_seconds (${c.replay_window_seconds})`);
  if (!Number.isInteger(c.accept_rate_limit) || c.accept_rate_limit < 1)
    fail(`accept_rate_limit must be an int ≥ 1 (got ${c.accept_rate_limit})`);
  if (!Number.isInteger(c.failure_alert_threshold) || c.failure_alert_threshold < 1)
    fail(`failure_alert_threshold must be an int ≥ 1 (got ${c.failure_alert_threshold})`);
  return c;
}

// Google certs endpoint (FR-0.WHK.003 — JWKS the Pub/Sub push JWT is verified against).
export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

// The date after which a GHL request carrying ONLY the legacy `X-WH-Signature` header (no
// `X-GHL-Signature`) is rejected outright (OD-046 HMAC→Ed25519 correction). AC-0.WHK.002.2.
export const GHL_LEGACY_HEADER_CUTOFF = '2026-07-01T00:00:00.000Z';

// Canonical `secret_kind` values in `webhook_secrets` (schema.md §1 comment: "e.g. ghl_webhook_ed25519,
// slack_signing"). Verifiers read their material by (connector, secret_kind) through the store.
export const SECRET_KIND = {
  ghl_ed25519_public_key: 'ghl_webhook_ed25519',
  slack_signing: 'slack_signing',
  google_expected_audience: 'google_expected_audience',
} as const;
export type SecretKind = (typeof SECRET_KIND)[keyof typeof SECRET_KIND];
