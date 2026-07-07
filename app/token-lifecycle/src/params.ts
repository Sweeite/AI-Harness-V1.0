// ISSUE-033 §8 step 3 — the three per-connector token PARAMETER SETS (FR-3.TOK.007 Google / .008 GHL /
// .009 Slack), fed to the GENERIC refresh engine as DATA. There is NO per-connector token code branch:
// the engine reads these fields to decide rotate-vs-not, expiring-vs-not, and the grace window. This is
// the FR-3.CONN.002 spine proof at the token layer — a new connector adds one TokenParams record, not a
// code path. The concrete OAuth provisioning + endpoint wiring for each connector is ISSUE-039/040/041;
// this slice defines ONLY the token-lifecycle parameters those instances inherit.
//
// Every vendor fact cites the DOSSIER (not the design doc) per the operating protocol.

export interface TokenParams {
  connector: string;
  /** Does the refresh token ROTATE (become single-use, invalidating the prior) on each refresh?
   *  true  -> the atomic rotate-persist arm (FR-3.TOK.005) is MANDATORY (GHL always; Slack if xoxe on).
   *  false -> a normal refresh keeps the same refresh token; persist-new is a harmless no-op (Google). */
  rotatesRefreshToken: boolean;
  /** Does the access token EXPIRE (and thus need proactive/reactive refresh at all)?
   *  false -> non-expiring (Slack xoxb default); the Layer-1 job SKIPS it (FR-3.TOK.002 branch /
   *  AC-3.TOK.009.1) and there is no refresh chain to maintain. */
  accessTokenExpires: boolean;
  /** The vendor's same-token grace window (seconds) during which a racing/retried refresh returns the
   *  SAME rotated token — the window inside which a post-refresh-pre-persist crash can safely retry the
   *  persist (FR-3.TOK.005 / AC-3.TOK.005.2). 0 = no documented grace (retry is not safe → degrade). */
  rotationGraceSeconds: number;
  /** Nominal access-token lifetime (seconds) — advisory; the engine ALWAYS trusts the vendor's returned
   *  expires_in over this constant (FR-3.TOK.007 "use returned expires_in, not a constant"). Present so
   *  a connector whose vendor omits expires_in has a documented fallback. */
  nominalAccessTtlSeconds: number | null;
  /** Optional per-account refresh-token cap to watch (Google 100/account/client — surface BEFORE the
   *  oldest is silently invalidated, AC-3.TOK.007.2). null = no documented cap (GHL / Slack). */
  refreshTokenCapPerAccount: number | null;
}

// ── FR-3.TOK.007 — Google (Gmail/Drive/Calendar). Dossier google-gmail.md §2 L61-70. ───────────────
// ~1h access; refresh does NOT rotate on normal refresh (L65); 100-token/account/client cap (L67-68).
export const GOOGLE_TOKEN_PARAMS: TokenParams = {
  connector: 'google',
  rotatesRefreshToken: false, // L65 — persist-new is a harmless no-op (AC-3.TOK.007.1)
  accessTokenExpires: true,
  rotationGraceSeconds: 0, // no rotation → grace window is not applicable
  nominalAccessTtlSeconds: 3600, // ~1h; engine still prefers the returned expires_in
  refreshTokenCapPerAccount: 100, // L67-68 — surface approach before silent invalidation (AC-3.TOK.007.2)
};

// ── FR-3.TOK.008 — GHL. Dossier gohighlevel.md §2 L59-63; AF-003 F5. ───────────────────────────────
// ~24h access (expires_in 86399); single-use ROTATING refresh (old invalidated each use, L60-61);
// 30s same-token concurrency grace (L60). The canonical rotate-persist case → AF-089.
export const GHL_TOKEN_PARAMS: TokenParams = {
  connector: 'ghl',
  rotatesRefreshToken: true, // L60-61 — atomic rotate-persist MANDATORY (AC-3.TOK.008.1)
  accessTokenExpires: true,
  rotationGraceSeconds: 30, // L60 — the 30s same-token window (AF-089 concurrency correctness)
  nominalAccessTtlSeconds: 86399, // ~24h
  refreshTokenCapPerAccount: null, // none documented
};

// ── FR-3.TOK.009 — Slack. Dossier slack.md §2 L56-59; OD-040 (rotation OFF by default). ─────────────
// Default xoxb is NON-EXPIRING → proactive refresh skipped (AC-3.TOK.009.1). Rotation is opt-in
// (CFG-slack_token_rotation_enabled=false); when ON → 12h xoxe access + rotating xoxe-1- refresh that
// MUST be atomically persisted each rotation (AC-3.TOK.009.2).
export function slackTokenParams(rotationEnabled: boolean): TokenParams {
  return {
    connector: 'slack',
    rotatesRefreshToken: rotationEnabled, // L57 — only when the opt-in is on
    accessTokenExpires: rotationEnabled, // xoxb non-expiring by default; xoxe expires (12h) when on
    rotationGraceSeconds: 0, // no documented same-token grace for Slack rotation
    nominalAccessTtlSeconds: rotationEnabled ? 43200 : null, // 12h when rotating; null = non-expiring
    refreshTokenCapPerAccount: null, // none documented (slack.md §2 L59)
  };
}

/** Default Slack params = rotation OFF (OD-040 / CFG-slack_token_rotation_enabled default false). */
export const SLACK_TOKEN_PARAMS_DEFAULT: TokenParams = slackTokenParams(false);

// ── FR-3.TOK.007 AC-3.TOK.007.2 — the 100-refresh-token cap DETECT-AND-SURFACE mechanism. ──────────
// Google silently invalidates the OLDEST refresh token once a Google account/OAuth-client passes 100
// live refresh tokens (google-gmail.md §2 L67-68). That silent invalidation is a #1 (lose access) that
// arrives with NO error — it is exactly the "fails silently" (#3) the top-bar forbids. So the runtime
// must WATCH the live count against the cap and SURFACE a loud warning as the count APPROACHES the cap,
// BEFORE the oldest is invalidated — turning a silent loss into an announced, actionable one.
//
// This is a PURE function of (count, params): no I/O, deterministic. The engine/layer feeds it the live
// per-account refresh-token count (the count is sourced live — that live sourcing + the unused-CLIENT
// deletion watch is the AF-107 residual; the surfacing MECHANISM proven offline is THIS). A connector
// with no documented cap (refreshTokenCapPerAccount === null: GHL, Slack) is a no-op — only Google caps.

/** How close to the cap counts as "approaching" — surface the warning once the number of FREE slots
 *  left drops to this or below. 10 slots (i.e. at 90/100 for the Google cap) gives the operator room to
 *  re-consent / prune stale grants before slot 101 silently evicts the oldest token. */
export const REFRESH_TOKEN_CAP_APPROACH_THRESHOLD = 10;

/** The loud signal emitted when a per-account refresh-token count approaches (or has reached) the vendor
 *  cap — surfaced BEFORE the oldest token would be silently invalidated (AC-3.TOK.007.2). Carries only
 *  non-secret counters (#2 — no token material ever). */
export interface TokenCapWarning {
  connector: string;
  /** The live per-account refresh-token count that triggered the warning. */
  count: number;
  /** The vendor cap being approached (100 for Google). */
  cap: number;
  /** Slots left before the oldest token is silently invalidated (cap - count; 0 or negative = at/over
   *  the cap, oldest already being evicted). */
  remaining: number;
  /** true once count >= cap — the silent-invalidation point is reached/passed (escalated severity). */
  atCap: boolean;
}

/**
 * AC-3.TOK.007.2 — detect approach to a per-account refresh-token cap and, if approaching, return the
 * loud warning to surface BEFORE the oldest token is silently invalidated. Pure; returns `null` when:
 *   - the connector has no documented cap (`refreshTokenCapPerAccount === null`) → no-op, and
 *   - the count is comfortably below the approach threshold → nothing to surface.
 * Returns a `TokenCapWarning` the moment free slots fall to `threshold` or fewer — which, because
 * `threshold >= 1`, always fires at least one slot BEFORE `count === cap` (the invalidation point), so
 * the warning provably precedes the silent loss.
 *
 * @param count     the live per-account/-client refresh-token count for this connector
 * @param params    the connector's TokenParams (supplies `refreshTokenCapPerAccount`)
 * @param threshold free-slots-remaining at/below which to surface (default REFRESH_TOKEN_CAP_APPROACH_THRESHOLD)
 */
export function detectCapApproach(
  count: number,
  params: TokenParams,
  threshold: number = REFRESH_TOKEN_CAP_APPROACH_THRESHOLD,
): TokenCapWarning | null {
  const cap = params.refreshTokenCapPerAccount;
  if (cap === null) return null; // no documented cap (GHL / Slack) → nothing to watch
  const remaining = cap - count;
  if (remaining > threshold) return null; // comfortably below the cap → nothing to surface
  return {
    connector: params.connector,
    count,
    cap,
    remaining,
    atCap: count >= cap,
  };
}
