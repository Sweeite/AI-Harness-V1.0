// ISSUE-033 §8 step 1 — the no-token-leak redaction boundary (FR-3.TOK.001 / NFR-SEC.003.1/.2).
//
// The three non-negotiables, #2 (never do something it shouldn't): a token that reaches an event_log /
// guardrail_log / UI response / env / config line is a secret leak. This module is the SINGLE boundary
// every log line and every UI-facing credential summary passes through. Two guarantees:
//   1. redactCredential(row) -> the ONLY shape a credential may be surfaced as: presence + last-rotated
//      metadata, NEVER the token material (NFR-SEC.003.1 — "surface presence/last-rotated only").
//   2. redact(anyValue) -> a defensive scrubber that walks an arbitrary log/observability payload and
//      replaces any recognised token material (a stored access/refresh token, or a value matching a
//      known vendor token prefix — xoxb/xoxe/ya29/GHL) with the redaction sentinel, so an accidental
//      `logFailure({ detail: JSON.stringify(row) })` still cannot emit a token (defence in depth, #3).
//
// Deterministic + pure — no I/O.

import type { CredentialRow } from './store.js';

export const REDACTED = '[REDACTED]';

/** The ONLY safe public shape of a credential (NFR-SEC.003.1 — presence + last-rotated only). No token
 *  field is present in the return type AT ALL, so a caller literally cannot render one by mistake. */
export interface CredentialPresence {
  connector: string;
  state: CredentialRow['state'];
  /** True iff an access token is on file — presence only, never the value. */
  has_access_token: boolean;
  /** True iff a refresh token is on file. */
  has_refresh_token: boolean;
  /** When the credential last changed (rotate/persist/state) — the "last-rotated" surface. */
  last_rotated_at: string;
  /** Access-token expiry (metadata; safe to surface — it is not secret material). */
  expires_at: string | null;
  scopes: string[] | null;
}

/** Map a stored credential to its ONLY surfaceable form. Token fields are dropped, not masked — they
 *  never enter the returned object (AC-NFR-SEC.003.1). */
export function redactCredential(row: CredentialRow): CredentialPresence {
  return {
    connector: row.connector,
    state: row.state,
    has_access_token: typeof row.access_token === 'string' && row.access_token.length > 0,
    has_refresh_token: typeof row.refresh_token === 'string' && row.refresh_token.length > 0,
    last_rotated_at: row.updated_at,
    expires_at: row.expires_at,
    scopes: row.scopes,
  };
}

// Known vendor token prefixes (dossiers: slack.md §2 xoxb/xoxe, google-gmail.md ya29 access, GHL JWT).
// A value starting with one of these is treated as token material and scrubbed on sight.
const TOKEN_PREFIXES = ['xoxb-', 'xoxe-', 'xoxe.xoxb-', 'ya29.', 'ghp_', '1//']; // 1// = Google refresh
// A key whose NAME implies a secret — scrubbed regardless of value shape.
const SECRET_KEY = /(access_?token|refresh_?token|client_?secret|\btoken\b|bearer|authorization)/i;

function looksLikeToken(v: string): boolean {
  return TOKEN_PREFIXES.some((p) => v.startsWith(p));
}

/** Defensive deep-scrub of an arbitrary payload before it is logged/emitted. Any string that either
 *  sits under a secret-looking key OR matches a known token prefix is replaced with [REDACTED]. This
 *  is the belt to redactCredential's braces — it means even a careless JSON.stringify of a raw row
 *  cannot leak a token to the observability plane (#3, defence in depth). Optionally, `knownTokens`
 *  (the exact stored token strings) are scrubbed by exact match too, catching opaque tokens with no
 *  recognisable prefix. */
export function redact(value: unknown, knownTokens: readonly string[] = []): unknown {
  const known = new Set(knownTokens.filter((t) => t && t.length > 0));
  const walk = (v: unknown, keyIsSecret: boolean): unknown => {
    if (typeof v === 'string') {
      if (keyIsSecret || looksLikeToken(v) || known.has(v)) return REDACTED;
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, false));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(val, SECRET_KEY.test(k));
      }
      return out;
    }
    return v;
  };
  return walk(value, false);
}

/** Assert a payload carries no token material (test/CI guard for AC-NFR-SEC.003.2). Returns the list of
 *  offending JSON-paths (empty = clean). Used by the redaction test to prove the no-leak invariant. */
export function findTokenLeaks(value: unknown, knownTokens: readonly string[] = []): string[] {
  const known = new Set(knownTokens.filter((t) => t && t.length > 0));
  const leaks: string[] = [];
  const walk = (v: unknown, path: string, keyIsSecret: boolean): void => {
    if (typeof v === 'string') {
      if (v === REDACTED) return;
      if (keyIsSecret || looksLikeToken(v) || known.has(v)) leaks.push(path || '(root)');
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`, false));
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        walk(val, path ? `${path}.${k}` : k, SECRET_KEY.test(k));
      }
    }
  };
  walk(value, '', false);
  return leaks;
}
