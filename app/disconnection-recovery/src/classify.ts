// ISSUE-038 (C3 DSC) — the pure, deterministic kernels of the connector disconnection + recovery lifecycle.
// No I/O, no Date.now/Math.random (house discipline: the caller passes `nowMs`). Every kernel here is fail-safe:
// an unknown/ambiguous input resolves to the LOUDER / WIDER outcome, never to a silent "nothing wrong" (#3), and
// no kernel ever emits token material (#2, FR-3.TOK.001). The store (store.ts) wires these to persistence + audit.

// ── FR-3.DSC.001 — detection + classification (system-wide vs individual). ─────────────────────────────
export const DISCONNECTION_CAUSES = ['failed_call', 'dead_refresh', 'revocation'] as const;
export type DisconnectionCause = (typeof DISCONNECTION_CAUSES)[number];

export const DISCONNECTION_SCOPES = ['system_wide', 'individual'] as const;
export type DisconnectionScope = (typeof DISCONNECTION_SCOPES)[number];

/** A raw failure signal fed to detection. `affectedUserId` is set iff the failure is scoped to ONE user's grant
 * (an individual OAuth lapse); it is null/absent for a connector-level failure that hits the whole deployment. */
export interface DisconnectionSignal {
  connector: string;
  cause: DisconnectionCause;
  affectedUserId?: string | null;
}

/**
 * Classify a failure as system-wide vs individual (FR-3.DSC.001 → AC-3.DSC.001.1).
 *
 * Rule (deterministic):
 *   • `dead_refresh` → ALWAYS system-wide. The dead token is the connector's SHARED refresh credential
 *     (connector_credentials is per-connector, not per-user, in this schema) — its death stalls every user's work,
 *     so it must surface to an admin who can reconnect, regardless of who tripped it.
 *   • `revocation` / `failed_call` WITH an `affectedUserId` → individual (that one user's grant lapsed).
 *   • anything else (no user scope, or an unrecognized/ambiguous shape) → system-wide.
 *
 * FAIL-SAFE: the default is the WIDER blast radius (system-wide → the non-dismissible admin modal + admin reconnect
 * authority), never a silent drop and never the narrower "individual" guess that could leave a real outage showing
 * only a banner nobody with authority sees.
 */
export function classifyScope(sig: DisconnectionSignal): DisconnectionScope {
  if (sig.cause === 'dead_refresh') return 'system_wide';
  if ((sig.cause === 'revocation' || sig.cause === 'failed_call') && typeof sig.affectedUserId === 'string' && sig.affectedUserId.length > 0) {
    return 'individual';
  }
  return 'system_wide';
}

// ── FR-3.DSC.002 — surfacing behaviour + reconnect authority. ───────────────────────────────────────────
// C3 DEFINES the behaviour + authority + non-dismissibility here; C7 (ISSUE-078) renders the pixels.
export type ReconnectAuthority = 'admin' | 'affected_user' | 'none';
export interface SurfaceDecision {
  kind: 'modal' | 'banner' | 'none';
  dismissible: boolean;
  canReconnect: boolean;
  reconnectAuthority: ReconnectAuthority;
  reason: string;
}

/** The admin roles that hold system-wide reconnect authority (RBAC role names; homed in C1/ISSUE-018). */
export const ADMIN_ROLES: readonly string[] = ['Super Admin', 'Admin'] as const;
export function isAdminRole(role: string | null | undefined): boolean {
  return role != null && ADMIN_ROLES.includes(role);
}

/**
 * Decide what a given viewer sees for a disconnection (FR-3.DSC.002 → AC-3.DSC.002.1/.2).
 *   • system-wide + Admin/Super-Admin  → NON-dismissible modal, can reconnect (authority = admin).
 *   • system-wide + standard user      → banner (informational, not a modal; cannot reconnect).
 *   • individual + the affected user    → NON-dismissible modal, can reconnect their OWN grant (authority = affected_user).
 *   • individual + an admin (not the affected user) → banner (they see it but the affected user reconnects).
 *   • individual + any other user       → none (genuinely not their concern — the ONE correct silent case).
 *
 * A disconnection modal/banner is NEVER user-dismissible (`dismissible:false`): it must be resolved or explicitly
 * deferred (deferral is recorded but does NOT stop the escalation clock — see store.defer / escalationDue).
 * FAIL-SAFE: an unknown/blank viewer role on a system-wide outage still gets a banner (never `none`).
 */
export function surfaceFor(
  scope: DisconnectionScope,
  viewerRole: string | null | undefined,
  opts: { isAffectedUser?: boolean; viewerUserId?: string | null; affectedUserId?: string | null } = {},
): SurfaceDecision {
  const admin = isAdminRole(viewerRole);
  // Prefer computing affected-ness from identities (viewerUserId === affectedUserId) so a caller cannot accidentally
  // hide an individual lapse from its own owner by forgetting the flag; fall back to the explicit flag if supplied.
  const isAffectedUser =
    opts.isAffectedUser ?? (opts.viewerUserId != null && opts.affectedUserId != null && opts.viewerUserId === opts.affectedUserId);
  if (scope === 'system_wide') {
    if (admin) {
      return {
        kind: 'modal',
        dismissible: false,
        canReconnect: true,
        reconnectAuthority: 'admin',
        reason: 'system-wide connector outage — an admin must reconnect (non-dismissible modal, FR-3.DSC.002)',
      };
    }
    return {
      kind: 'banner',
      dismissible: false,
      canReconnect: false,
      reconnectAuthority: 'none',
      reason: 'system-wide connector outage — informational banner for a standard user (an admin reconnects)',
    };
  }
  // individual lapse
  if (isAffectedUser) {
    return {
      kind: 'modal',
      dismissible: false,
      canReconnect: true,
      reconnectAuthority: 'affected_user',
      reason: 'your connector authorization lapsed — reconnect your own grant (non-dismissible modal)',
    };
  }
  if (admin) {
    return {
      kind: 'banner',
      dismissible: false,
      canReconnect: false,
      reconnectAuthority: 'none',
      reason: 'an individual user connector lapse — visible to admins; the affected user reconnects',
    };
  }
  return { kind: 'none', dismissible: false, canReconnect: false, reconnectAuthority: 'none', reason: 'not the viewer’s connector lapse' };
}

// ── FR-3.DSC.004 — the escalation clock (persisted; deferral does not stop it; honoured across restart). ─
/** The durable disconnection record shape (mirrors the 0034 connector_disconnection_state row; ms epochs so the
 * kernels stay Date-free). `detectedAtMs` + `escalationWindowMs` are a SNAPSHOT persisted at detection, so the
 * clock is deterministic across a runtime restart (AC-3.DSC.004.2) — it never re-reads a live CFG or wall clock. */
export interface DisconnectionRecord {
  id: string;
  connector: string;
  scope: DisconnectionScope;
  affectedUserId: string | null;
  cause: DisconnectionCause;
  status: 'open' | 'resolved' | 'escalated';
  detectedAtMs: number;
  escalationWindowMs: number;
  deferredAtMs: number | null;
  escalatedAtMs: number | null;
  resolvedAtMs: number | null;
}

/**
 * Is this disconnection due to escalate (FR-3.DSC.004 → AC-3.DSC.004.1/.2)? True iff it is still OPEN, has not
 * already escalated, and the window measured from the PERSISTED `detectedAtMs` has elapsed. It deliberately IGNORES
 * `deferredAtMs`: deferring the modal must NOT stop the clock — an unresolved disconnection escalates even if an
 * admin dismissed the prompt (the NFR-OBS.007 "a thing that is waiting must never be forgotten" keystone).
 */
export function escalationDue(rec: DisconnectionRecord, nowMs: number): boolean {
  return rec.status === 'open' && rec.escalatedAtMs === null && nowMs - rec.detectedAtMs >= rec.escalationWindowMs;
}

// ── FR-3.DSC.005 — connector health-panel data (NO token material; missing/stale → warning, never a blank). ─
export interface ConnectorHealthInput {
  connector: string;
  /** connector_credentials.state — 'active' | 'degraded' | 'revoked' | 'expired'; anything else (incl. null) → unknown. */
  state: string | null;
  lastSuccessfulCallMs: number | null;
  expiresAtMs: number | null;
  /** null when no rate_limit_tracker row exists for the connector (shown as a warning, not headroom=0). */
  rate: { callLimit: number; callsMade: number; resetAtMs: number } | null;
}

export type HealthStatus = 'connected' | 'degraded' | 'revoked' | 'expired' | 'unknown';

export interface ConnectorHealthPanel {
  connector: string;
  status: HealthStatus;
  lastSuccessfulCall: number | null; // ms epoch, echoed for the dashboard
  tokenExpiryCountdownMs: number | null; // expiresAt - now; null when unknown (warned)
  rateHeadroom: number | null; // callLimit - callsMade; null when unknown (warned)
  /** every reason a value is missing/stale/degraded — NEVER a blank tile that reads as healthy (#3 false-healthy). */
  warnings: string[];
}

const STATE_TO_STATUS: Record<string, HealthStatus> = {
  active: 'connected',
  degraded: 'degraded',
  revoked: 'revoked',
  expired: 'expired',
};

/**
 * Build the health-panel row for each connector (FR-3.DSC.005 → AC-3.DSC.005.1). Emits status / last-successful-call
 * / token-expiry countdown / rate headroom, and NEVER any token material. The load-bearing invariant is
 * never-false-healthy: a missing state resolves to `unknown` (NOT `connected`), a missing last-call / expiry / rate
 * row becomes an explicit warning (NOT a blank or a fabricated 0 that reads as fine).
 */
/** A health read whose last successful call is older than this is flagged STALE even if the state reads 'active' —
 * the spec's never-false-healthy rule covers stale-but-present data, not just missing data. Overridable per call. */
export const DEFAULT_HEALTH_STALENESS_MS = 60 * 60 * 1000; // 1h

export function healthPanel(inputs: readonly ConnectorHealthInput[], nowMs: number, stalenessThresholdMs: number = DEFAULT_HEALTH_STALENESS_MS): ConnectorHealthPanel[] {
  return inputs.map((c) => {
    const warnings: string[] = [];
    const status: HealthStatus = c.state != null && c.state in STATE_TO_STATUS ? STATE_TO_STATUS[c.state]! : 'unknown';
    if (status === 'unknown') warnings.push(`connector state unknown ('${String(c.state)}') — not reported as connected`);
    if (status === 'degraded') warnings.push('connector is degraded — reconnect required');
    if (status === 'revoked') warnings.push('connector authorization revoked');
    if (status === 'expired') warnings.push('connector credential expired');

    if (c.lastSuccessfulCallMs == null) {
      warnings.push('no successful call recorded — health may be stale');
    } else if (nowMs - c.lastSuccessfulCallMs > stalenessThresholdMs) {
      // present-but-ancient last call: do NOT let a stale reading pass as freshly-healthy (#3 false-healthy).
      warnings.push(`last successful call is stale (${Math.round((nowMs - c.lastSuccessfulCallMs) / 60000)} min ago) — health may not reflect the live connector`);
    }

    let tokenExpiryCountdownMs: number | null = null;
    if (c.expiresAtMs == null) {
      warnings.push('token expiry unknown');
    } else {
      tokenExpiryCountdownMs = c.expiresAtMs - nowMs;
      if (tokenExpiryCountdownMs <= 0) warnings.push('token has expired');
    }

    let rateHeadroom: number | null = null;
    if (c.rate == null) {
      warnings.push('rate-limit headroom unknown (no tracker row)');
    } else {
      rateHeadroom = c.rate.callLimit - c.rate.callsMade;
      if (rateHeadroom <= 0) warnings.push('rate-limit headroom exhausted');
    }

    return { connector: c.connector, status, lastSuccessfulCall: c.lastSuccessfulCallMs, tokenExpiryCountdownMs, rateHeadroom, warnings };
  });
}

// ── FR-3.DSC.006 — alerts (expiry < window → owner; undeliverable → surfaced). ──────────────────────────
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CredentialExpiryInput {
  connector: string;
  scope: DisconnectionScope;
  affectedUserId: string | null; // owner of an individual grant
  expiresAtMs: number | null;
}

export interface ExpiryAlert {
  connector: string;
  recipientId: string | null; // the resolved owner (see alertRecipient); null → unresolved, itself a warning
  expiresAtMs: number;
  daysLeft: number;
  unresolvedRecipient: boolean;
}

/**
 * Resolve WHO an alert goes to. An individual grant's owner is the affected user; a system-wide connector's "owner"
 * is the admin who holds reconnect authority (the caller supplies the admin recipient). Returns null (never guesses)
 * when neither is available — the caller must surface an unresolved recipient rather than silently dropping the alert.
 */
export function alertRecipient(scope: DisconnectionScope, affectedUserId: string | null, adminOwnerId: string | null): string | null {
  if (scope === 'individual') return affectedUserId ?? null;
  return adminOwnerId ?? null;
}

/**
 * The connectors whose refresh token expires within `alertDays` (FR-3.DSC.006 → AC-3.DSC.006.1). A null expiry is
 * NOT silently skipped as "fine" — it is surfaced as an alert with `unresolvedRecipient`/expiry-unknown handling by
 * the store; here we return only the datable ones (expiry known + within the window), leaving unknown-expiry warnings
 * to the health panel (which already flags 'token expiry unknown').
 */
export function expiringSoon(
  creds: readonly CredentialExpiryInput[],
  alertDays: number,
  adminOwnerId: string | null,
  nowMs: number,
): ExpiryAlert[] {
  const windowMs = alertDays * MS_PER_DAY;
  const out: ExpiryAlert[] = [];
  for (const c of creds) {
    if (c.expiresAtMs == null) continue; // expiry-unknown is a health-panel warning, not an expiry alert
    const remaining = c.expiresAtMs - nowMs;
    if (remaining <= windowMs) {
      const recipientId = alertRecipient(c.scope, c.affectedUserId, adminOwnerId);
      out.push({
        connector: c.connector,
        recipientId,
        expiresAtMs: c.expiresAtMs,
        daysLeft: Math.floor(remaining / MS_PER_DAY),
        unresolvedRecipient: recipientId == null,
      });
    }
  }
  return out;
}
