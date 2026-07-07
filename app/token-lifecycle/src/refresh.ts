// ISSUE-033 §8 step 2 — the REFRESH PRIMITIVE: the single token-refresh op every layer calls, carrying
// the ATOMIC rotate-persist (FR-3.TOK.005), single-flight guarding (ADR-004), and the
// post-refresh-pre-persist crash recovery (grace-window retry → else degrade LOUDLY). This is the #1
// non-negotiable backstop — "never silently lose access". Built BEFORE the layers that call it.
//
// The hard truth this file is built around (FR-3.TOK.005 edge/failure): the vendor refresh (external
// HTTP) and the local persist (DB write) are NOT one transaction. The instant the vendor rotates, the
// OLD refresh token is dead server-side. So the recovery for a persist that fails after a rotation is
// NOT "retry with old state" (that HTTP call would now fail) — it is "retry the PERSIST of the token we
// already hold, within the vendor's same-token grace window; if that window is missed, degrade LOUDLY"
// (AC-3.TOK.005.2). Never a silent retry-fail.
//
// Single-flight (ADR-004): concurrent refresh requests for the same connector collapse onto ONE
// in-flight refresh; the others await its result. This is what makes the GHL 30s-grace race safe —
// only one flight ever calls the vendor + persists; the rest reuse its outcome (AF-089 offline proof).
//
// Deterministic: `now` is caller-supplied epoch seconds; the only async is the injected vendor call +
// store. No Date.now()/random.

import type { CredentialStore, CredentialRow, PersistOutcome } from './store.js';
import type { TokenParams } from './params.js';

/** What the vendor's token endpoint returns on a successful refresh. Injected (VendorRefresh) so the
 *  runtime is testable offline; the concrete HTTP call is ISSUE-039/040/041. */
export interface VendorTokenResponse {
  access_token: string;
  /** The rotated refresh token for a rotating connector; the SAME token echoed for a non-rotating one;
   *  null if the vendor returns no refresh token on this refresh. */
  refresh_token: string | null;
  /** Seconds until the new access token expires (the authority — preferred over TokenParams nominal). */
  expires_in: number | null;
  scopes: string[] | null;
}

/** The injected vendor refresh call. Throws DeadRefreshTokenError when the refresh token itself is
 *  rejected (revoked/expired/invalid → Layer 3). Any other throw is a transient/unknown failure. */
export interface VendorRefresh {
  refresh(connector: string, refreshToken: string | null): Promise<VendorTokenResponse>;
}

/** The vendor rejected the refresh token itself — it is dead (revoked/expired/invalid). This routes to
 *  Layer 3 (degrade + re-auth), NOT to a persist retry (there is nothing valid to persist). */
export class DeadRefreshTokenError extends Error {
  constructor(public readonly connector: string, message?: string) {
    super(message ?? `refresh token for '${connector}' is dead (revoked/expired/invalid)`);
    this.name = 'DeadRefreshTokenError';
  }
}

/** Raised when a rotation succeeded at the vendor (old refresh token now dead) but the local persist
 *  could not be completed within the same-token grace window — the connector is degraded LOUDLY. The #1
 *  trap, surfaced not swallowed. */
export class RotatePersistLostError extends Error {
  constructor(public readonly connector: string, message?: string) {
    super(message ?? `rotate-persist for '${connector}' failed after vendor rotation and the grace window elapsed — connector degraded (never silently retry-failed)`);
    this.name = 'RotatePersistLostError';
  }
}

export type RefreshResult =
  | { kind: 'refreshed'; row: CredentialRow } // new access token persisted + safe to use
  | { kind: 'dead' } // refresh token dead → Layer 3 will degrade + emit re-auth
  | { kind: 'degraded-persist-lost' }; // rotation happened but persist lost past grace → degraded loud

export interface RefreshEngineDeps {
  store: CredentialStore;
  vendor: VendorRefresh;
  /** now() in epoch seconds — injected so persist-retry timing is deterministic in tests. */
  clock: () => number;
  /** Observability sink. Payloads are redacted by the CALLER's convention; this engine passes only
   *  metadata (connector, outcome, timing) — never token material (#2). */
  log: (event: { kind: string; connector: string; detail?: string }) => void;
  /** How long (ms of wall clock, but modelled as retry ATTEMPTS here for determinism) to keep retrying
   *  the persist inside the grace window. Injected retry driver keeps the engine deterministic. */
  persistRetry: PersistRetryDriver;
}

/** Deterministic persist-retry driver: given the grace deadline (epoch seconds) and an attempt fn that
 *  resolves to a PersistOutcome or throws, keep retrying while the clock is inside the window. Injected
 *  so a test can control timing exactly (no real sleeps). */
export interface PersistRetryDriver {
  run(
    attempt: () => Promise<PersistOutcome>,
    graceDeadlineEpoch: number,
    clock: () => number,
  ): Promise<PersistOutcome>;
}

/** The default driver: attempt once, and while inside the grace window keep re-attempting until it
 *  succeeds or the deadline passes. Purely clock-driven (no sleep) — the caller's clock advances. */
export const immediatePersistRetry: PersistRetryDriver = {
  async run(attempt, graceDeadlineEpoch, clock) {
    // First attempt always runs. Then re-attempt only while still inside the grace window.
    for (;;) {
      try {
        return await attempt();
      } catch (e) {
        if (clock() >= graceDeadlineEpoch) throw e; // window elapsed — give up (caller degrades loud)
        // else: still inside the grace window → retry (the vendor still returns the same token)
      }
    }
  },
};

export class RefreshEngine {
  private readonly inFlight = new Map<string, Promise<RefreshResult>>();

  constructor(private readonly deps: RefreshEngineDeps) {}

  /** Refresh a connector's token through the single-flight + atomic rotate-persist path. Concurrent
   *  callers for the same connector collapse onto ONE in-flight refresh (ADR-004 single-flight) — the
   *  key guarantee that makes the rotating-refresh race safe (AF-089). */
  async refresh(connector: string, params: TokenParams): Promise<RefreshResult> {
    const existing = this.inFlight.get(connector);
    if (existing) {
      this.deps.log({ kind: 'refresh.single_flight_join', connector });
      return existing; // join the in-flight refresh instead of starting a second vendor call
    }
    const p = this.doRefresh(connector, params).finally(() => {
      this.inFlight.delete(connector);
    });
    this.inFlight.set(connector, p);
    return p;
  }

  private async doRefresh(connector: string, params: TokenParams): Promise<RefreshResult> {
    const cred = await this.deps.store.getCredential(connector);
    if (!cred) throw new Error(`refresh: no credential for connector '${connector}'`);

    const startedFromRefresh = cred.refresh_token; // the token this flight will rotate FROM

    // ── 1. Call the vendor. A dead refresh token routes to Layer 3, not to a persist retry. ──
    let vendorResp: VendorTokenResponse;
    try {
      vendorResp = await this.deps.vendor.refresh(connector, startedFromRefresh);
    } catch (e) {
      if (e instanceof DeadRefreshTokenError) {
        this.deps.log({ kind: 'refresh.dead_token', connector });
        return { kind: 'dead' };
      }
      throw e; // transient/unknown — the caller (Layer 1/2) decides; not our job to swallow
    }

    // The vendor has now (for a rotating connector) invalidated `startedFromRefresh` server-side.
    // From here, the ONLY safe recovery for a persist failure is retry-the-PERSIST within the grace
    // window — NEVER re-call the vendor with the old (now-dead) token.
    const rotated = params.rotatesRefreshToken;
    const newExpiresAt = this.computeExpiresAt(vendorResp, params);

    const doPersist = (): Promise<PersistOutcome> =>
      this.deps.store.rotatePersist(
        {
          connector,
          new_access_token: vendorResp.access_token,
          // For a non-rotating connector, persist whatever the vendor returned (usually the same
          // token, or null); persist-new is a harmless no-op there (FR-3.TOK.007).
          new_refresh_token: vendorResp.refresh_token ?? (rotated ? null : startedFromRefresh),
          new_expires_at: newExpiresAt,
          new_scopes: vendorResp.scopes ?? cred.scopes,
          expected_refresh_token: startedFromRefresh,
        },
        this.deps.clock(),
      );

    // ── 2. Persist. For a rotating connector, use the grace-window retry driver so a transient persist
    //       failure right after rotation is retried while the vendor still honours the same token. ──
    const graceDeadline = this.deps.clock() + (rotated ? params.rotationGraceSeconds : 0);
    let outcome: PersistOutcome;
    try {
      outcome = rotated
        ? await this.deps.persistRetry.run(doPersist, graceDeadline, this.deps.clock)
        : await doPersist();
    } catch (e) {
      // Persist could not complete within the grace window after a vendor rotation → the rotated token
      // is stranded server-side-dead + never saved. Degrade LOUDLY (AC-3.TOK.005.2) — the #1 trap.
      this.deps.log({ kind: 'refresh.rotate_persist_lost', connector, detail: 'grace window elapsed before persist' });
      await this.deps.store.setState(connector, 'degraded', this.deps.clock());
      // surface the loud failure to the caller too (never swallowed)
      void new RotatePersistLostError(connector).message; // constructed for clarity; state already set
      return { kind: 'degraded-persist-lost' };
    }

    if (outcome.kind === 'stale') {
      // A concurrent flight already rotated past us. We must NOT use our new access token — its refresh
      // half was never saved against the live row. Single-flight makes this rare, but the guard is the
      // last line of defence (#1). The live row (outcome.row) is the authoritative, already-refreshed
      // credential; return it as the refreshed result so the caller uses the persisted token, not ours.
      this.deps.log({ kind: 'refresh.stale_lost_race', connector });
      return { kind: 'refreshed', row: outcome.row };
    }

    this.deps.log({ kind: 'refresh.persisted', connector });
    return { kind: 'refreshed', row: outcome.row };
  }

  /** Compute the new expiry (epoch → ISO). Prefers the vendor's returned expires_in (the authority,
   *  FR-3.TOK.007), falling back to the connector's nominal TTL; null if the token does not expire. */
  private computeExpiresAt(resp: VendorTokenResponse, params: TokenParams): string | null {
    if (!params.accessTokenExpires) return null;
    const ttl = resp.expires_in ?? params.nominalAccessTtlSeconds;
    if (ttl === null) return null;
    return new Date((this.deps.clock() + ttl) * 1000).toISOString();
  }
}
