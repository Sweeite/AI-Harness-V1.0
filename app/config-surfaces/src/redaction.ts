// ISSUE-086 — credential-safety helpers for the config surfaces (NFR-SEC.003 / FR-7.LOG.005 /
// AC-7.LOG.008.5). Two layers:
//   1. isSecretKey — the group-N platform-secret keys. A SECRET key must NEVER reach putConfigValue or
//      appendAudit (it is presence-only on #secrets, never editable). This is the STRUCTURAL guarantee no
//      secret value ever lands in config_values / config_audit_log (config-edit-taxonomy rule 2).
//   2. redactCredentialMaterial — defence-in-depth: even a non-SECRET value that happens to carry a
//      token-shaped string (a pasted webhook URL with a token, a PEM, an sk-/xoxb- token) is redacted
//      BEFORE the audit row is written, so a mis-paste never becomes a durable credential leak (#1/#2).

export const REDACTED = '[REDACTED]' as const;

// The 11 platform secrets (config-registry.md §N). SECRET-class — never in config_values, never audited.
export const SECRET_KEYS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'INNGEST_API_KEY',
  'X_INTERNAL_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_WEBHOOK_URL',
  'GOHIGHLEVEL_WEBHOOK_SECRET',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY',
  'auth.smtp_bundle',
  'auth.smtp_bounce_webhook',
] as const;

const SECRET_KEY_SET = new Set(SECRET_KEYS);

/** True if this key is a SECRET-class platform secret (never editable, never audited). */
export function isSecretKey(key: string): boolean {
  if (SECRET_KEY_SET.has(key)) return true;
  // Any auth.smtp_* member is part of the SMTP secret bundle.
  return key.startsWith('auth.smtp_');
}

// A field NAME that strongly implies its value is a credential.
const CREDENTIAL_FIELD = /(secret|token|api[_-]?key|password|passwd|private[_-]?key|client[_-]?secret|webhook[_-]?url)/i;
// A VALUE that looks like credential material regardless of its field name.
const CREDENTIAL_VALUE = [
  /\bsk-[A-Za-z0-9]{16,}\b/, // OpenAI-style
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
  /\bAIza[0-9A-Za-z_-]{20,}\b/, // Google API key
  /\bghp_[A-Za-z0-9]{20,}\b/, // GitHub PAT
];

function looksLikeCredential(v: string): boolean {
  return CREDENTIAL_VALUE.some((re) => re.test(v));
}

/**
 * Return a deep copy of `value` with any credential material replaced by REDACTED. Objects: a field whose
 * NAME matches CREDENTIAL_FIELD is redacted; any string VALUE that looks like a credential is redacted.
 * Pure — never mutates the input.
 */
export function redactCredentialMaterial(value: unknown): unknown {
  if (typeof value === 'string') return looksLikeCredential(value) ? REDACTED : value;
  if (Array.isArray(value)) return value.map((v) => redactCredentialMaterial(v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (CREDENTIAL_FIELD.test(k)) out[k] = REDACTED;
      else out[k] = redactCredentialMaterial(v);
    }
    return out;
  }
  return value;
}

/** True if the value STILL carries anything that looks like unredacted credential material (audit assertion). */
export function containsCredentialMaterial(value: unknown): boolean {
  if (typeof value === 'string') return looksLikeCredential(value);
  if (Array.isArray(value)) return value.some((v) => containsCredentialMaterial(v));
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => containsCredentialMaterial(v));
  }
  return false;
}
