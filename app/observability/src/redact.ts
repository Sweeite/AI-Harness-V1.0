// ISSUE-011 §8 step 3 — FR-7.LOG.005 / AC-7.LOG.005.1 / NFR-OBS: tokens and secrets NEVER appear in the
// log. This is the #2-touching redaction invariant enforced at the write boundary (consistent with the C3
// token-non-disclosure invariant FR-3.TOK.*). A payload that WOULD carry a credential is scrubbed BEFORE
// write — redaction is not best-effort-after-the-fact; it is a precondition of the write API.

const REDACTED = "[REDACTED]";

/**
 * Field-name patterns that name a credential. Case-insensitive substring match — deliberately broad, since
 * a false-positive redaction is safe (#2: better to over-redact than leak) while a miss is a #2 breach.
 */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /\bpwd\b/i,
  /api[_-]?key/i,
  /\bapikey\b/i,
  /access[_-]?key/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /credential/i,
  /authorization/i,
  /\bauth\b/i,
  /bearer/i,
  /signing[_-]?key/i,
  /webhook[_-]?url/i, // a Slack webhook URL embeds a secret path
  /\bcookie\b/i,
  /session[_-]?id/i,
  /refresh[_-]?token/i,
];

/**
 * Value-shape patterns that look like credential material even under an innocent key (defence in depth):
 * bearer tokens, JWTs, common vendor key prefixes, long high-entropy hex/base64 blobs.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /^bearer\s+\S+/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/, // JWT
  /\b(sk|pk|rk|xoxb|xoxp|ghp|gho|ghs|AKIA)[-_][A-Za-z0-9]{16,}/, // vendor key prefixes
  /\bxox[bpasr]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /\b[A-Fa-f0-9]{40,}\b/, // long hex (SHA/HMAC/keys)
];

function keyLooksSecret(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((p) => p.test(key));
}

function valueLooksSecret(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((p) => p.test(value));
}

/**
 * Recursively redact any credential-bearing field or credential-shaped string value. Returns a NEW object;
 * the input is never mutated. Non-plain values (numbers, booleans, null) pass through; strings are scanned
 * for secret shapes; objects/arrays are walked.
 */
export function redactPayload(value: unknown): unknown {
  return redactInner(value, false);
}

function redactInner(value: unknown, parentKeyIsSecret: boolean): unknown {
  if (parentKeyIsSecret) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return valueLooksSecret(value) ? REDACTED : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redactInner(v, false));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactInner(v, keyLooksSecret(k));
    }
    return out;
  }
  return REDACTED; // functions/symbols/bigints — never persist raw
}

/** Redact a free-text summary string (value-shape only — the human narrative keeps its words). */
export function redactSummary(summary: string): string {
  return valueLooksSecret(summary) ? summary.replace(secretRunGlobal, REDACTED) : summary;
}

// Same value-shapes, global, for in-string replacement in a summary.
const secretRunGlobal = new RegExp(
  SECRET_VALUE_PATTERNS.map((p) => p.source).join("|"),
  "gi",
);

/**
 * True if a value (as-provided, before redaction) contains any credential material a secret-named field
 * would carry OR a credential-shaped string value, at any depth. Used by the token-no-leak audit
 * (AC-7.LOG.005.1) to decide whether a payload NEEDS redaction. Note: this flags a secret-named key even
 * when its value is innocuous — so it must run on the ORIGINAL payload, not the redacted one (a redacted
 * payload legitimately RETAINS the secret-named key with a `[REDACTED]` value; use `containsSecretValue`
 * for the post-redaction survivor check).
 */
export function containsCredential(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return valueLooksSecret(value);
  if (typeof value === "number" || typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.some((v) => containsCredential(v));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => keyLooksSecret(k) || containsCredential(v),
    );
  }
  return true; // functions/symbols/bigints — treat as unsafe-to-persist
}

/**
 * True if any actual credential-shaped VALUE survives (regardless of key name). This is the post-redaction
 * survivor check: after redaction a secret-named key is fine (its value is `[REDACTED]`); what must NEVER
 * remain is a real token/secret VALUE. This is the assertion the write path uses before persisting.
 */
export function containsSecretValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value !== REDACTED && valueLooksSecret(value);
  if (typeof value === "number" || typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.some((v) => containsSecretValue(v));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) => containsSecretValue(v));
  }
  return true; // functions/symbols/bigints — never persist raw
}
