// ISSUE-010 §8 step 8 — the no-secret-in-log invariant (FR-7.LOG.005 / AC-7.LOG.008.5 / AC-NFR-SEC.003.2).
//
// Two guarantees, both #2 (never do something it shouldn't) + #3 (never fail silently):
//   1. SECRET-class config rows NEVER produce a config_audit_log row — by construction: SECRET keys live
//      in secret_manifest (presence only), never config_values, and are never UI-editable
//      (config-edit-taxonomy rule 2). `isSecretKey` is the classifier the write path consults to REJECT
//      an attempt to audit a SECRET key (belt-and-braces — the taxonomy already forbids the edit).
//   2. Any value that WOULD carry credential material is redacted BEFORE the row is written — a payload
//      audit finds no token/secret/credential. `redactCredentialMaterial` scrubs both known secret-shaped
//      keys and high-entropy token-shaped string values, recursively through nested JSON.
//
// This is deliberately conservative: it errs toward redaction (a false-positive redaction loses a bit of
// log detail; a false-negative leaks a credential — the asymmetry is #2). The registry's SECRET class is
// the primary control; this is the defence-in-depth pre-write scrub.

export const REDACTED = '[REDACTED]' as const;

// The group-N platform SECRET env-var names (spec/02-config/config-registry.md §N). SECRET keys are
// stored in secret_manifest, never config_values — but the write path double-checks a key against this
// before it would ever audit it (a mis-classified key must fail closed, not silently produce a
// secret-bearing row). This list is the AUTHORITATIVE §N set — every one MUST return true.
const SECRET_ENV_NAMES = new Set<string>([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'INNGEST_API_KEY',
  'X_INTERNAL_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_WEBHOOK_URL',
  'GOHIGHLEVEL_WEBHOOK_SECRET',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY',
]);

// The group-N `auth.smtp_*` secret keys (dotted names, not env-var-shaped). These are the ONLY dotted
// secret keys; they live in secret_manifest, never config_values. Matched case-insensitively.
const SMTP_SECRET_KEYS = new Set<string>([
  'auth.smtp_host',
  'auth.smtp_port',
  'auth.smtp_user',
  'auth.smtp_pass',
  'auth.smtp_sender',
  'auth.smtp_bounce_webhook',
]);

// A key is SECRET if it is a known group-N secret name, an auth.smtp_* secret, or its name matches a
// secret-shaped pattern (…_key / …_secret / …_token / api_key / password / credential …). The pattern is
// the belt-and-braces catch for payload sub-keys; the exact-name sets are the authoritative §N control.
// Case-insensitive.
const SECRET_KEY_RE = /(^|[._-])(api[._-]?key|secret|token|password|passwd|credential|private[._-]?key|access[._-]?key|service[._-]?key|webhook[._-]?url|client[._-]?secret|signing[._-]?secret|service[._-]?account[._-]?key)($|[._-])/i;

export function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (SECRET_ENV_NAMES.has(upper)) return true;
  const lower = key.toLowerCase();
  if (SMTP_SECRET_KEYS.has(lower)) return true;
  if (lower.startsWith('auth.smtp_')) return true; // any smtp_* under auth. is a group-N secret
  return SECRET_KEY_RE.test(key);
}

// A string value that LOOKS like a credential: long, high-entropy, or a recognised token prefix. Used to
// scrub a value that slipped into a payload even under a non-secret key name.
const TOKEN_VALUE_RE = /\b(sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|Bearer\s+[A-Za-z0-9._-]{16,}|eyJ[A-Za-z0-9._-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/;

function looksLikeCredential(value: string): boolean {
  if (TOKEN_VALUE_RE.test(value)) return true;
  // A bare high-entropy blob (>=32 chars, no spaces, mixed case+digits) — conservative catch-all.
  if (value.length >= 32 && !/\s/.test(value) && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value)) {
    return true;
  }
  return false;
}

/**
 * Recursively scrub credential material from an arbitrary JSON payload BEFORE it is written to any log
 * sink. A value under a secret-shaped key is always redacted; a string value that looks like a token is
 * redacted regardless of its key. Returns a NEW value (does not mutate the input).
 */
export function redactCredentialMaterial(input: unknown): unknown {
  if (typeof input === 'string') {
    return looksLikeCredential(input) ? REDACTED : input;
  }
  if (Array.isArray(input)) {
    return input.map((v) => redactCredentialMaterial(v));
  }
  if (input !== null && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (isSecretKey(k)) {
        out[k] = REDACTED; // a secret-shaped key: redact its value regardless of shape
      } else {
        out[k] = redactCredentialMaterial(v);
      }
    }
    return out;
  }
  return input; // number | boolean | null | undefined — nothing to redact
}

/** True if a scrubbed payload still contains any credential-looking material (the audit assertion). */
export function containsCredentialMaterial(input: unknown): boolean {
  if (typeof input === 'string') return looksLikeCredential(input);
  if (Array.isArray(input)) return input.some((v) => containsCredentialMaterial(v));
  if (input !== null && typeof input === 'object') {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (isSecretKey(k) && v !== REDACTED) return true;
      if (containsCredentialMaterial(v)) return true;
    }
  }
  return false;
}
