// ISSUE-078 — poll-cadence resolution (AC-7.RTP.002.1) + the honest freshness state (AC-7.RTP.004.2). Both
// surfaces POLL (they are NOT the two Realtime surfaces, FR-7.RTP.001) — so the connection indicator is only
// ever Polling / Reconnecting, NEVER "Live" (a polled surface labelled "Live" would be a false-healthy claim,
// NFR-OBS.011).

/** The honest connection indicator (NFR-OBS.011): a polled surface never reads "Live". */
export type ConnectionState = "polling" | "reconnecting";

/** Resolve a surface's poll interval from client config, applying the documented default on absence
 *  (AC-7.RTP.002.1). A present-but-invalid value (≤0 / NaN / below the 5 s floor) is NOT silently accepted —
 *  it throws, because a silently-clamped cadence would poll on a value the operator never set (#3). */
export function resolvePollIntervalSeconds(configValue: number | null | undefined, defaultSeconds: number): number {
  if (configValue === null || configValue === undefined) return defaultSeconds; // documented default on absence
  if (typeof configValue !== "number" || !Number.isFinite(configValue)) {
    throw new Error(`poll interval must be a finite number, got ${String(configValue)}`);
  }
  if (configValue < 5) {
    // FR-7.RTP.002 range floor is ≥5 s. A sub-floor value is a config error surfaced loud, not clamped.
    throw new Error(`poll interval ${configValue}s is below the 5 s floor (FR-7.RTP.002) — reject, never clamp`);
  }
  return configValue;
}

export type Freshness = "fresh" | "refreshing" | "stale";

export interface FreshnessResult {
  freshness: Freshness;
  connection: ConnectionState;
  ageSeconds: number;
  /** The honest last-updated label — never blank, so the user always knows the as-of time. */
  label: string;
}

/** Compute a panel's freshness from its last successful poll vs its cadence, on SERVER-authoritative time
 *  (a stale client clock must not make a stale panel look current — the surface-05/06 discipline). A panel
 *  whose last good poll is older than `staleFactor`× its cadence is STALE and says so (AC-7.RTP.004.2); a
 *  fresh panel currently mid-poll reads "refreshing". */
export function pollFreshness(
  lastPollAtEpochS: number | null,
  serverNowEpochS: number,
  cadenceSeconds: number,
  opts: { currentlyPolling?: boolean; reconnecting?: boolean; staleFactor?: number } = {},
): FreshnessResult {
  const staleFactor = opts.staleFactor ?? 2;
  const connection: ConnectionState = opts.reconnecting ? "reconnecting" : "polling";
  if (lastPollAtEpochS === null) {
    // Never yet polled — NOT "fresh". Loading is handled by the panel-state machine; here we report unknown
    // age honestly rather than a reassuring 0.
    return { freshness: "stale", connection, ageSeconds: Infinity, label: "never updated — awaiting first poll" };
  }
  const age = Math.max(0, serverNowEpochS - lastPollAtEpochS);
  if (age > cadenceSeconds * staleFactor) {
    return {
      freshness: "stale",
      connection,
      ageSeconds: age,
      label: `stale — last updated ${age}s ago; retrying`,
    };
  }
  if (opts.currentlyPolling) {
    return { freshness: "refreshing", connection, ageSeconds: age, label: `refreshing… (last updated ${age}s ago)` };
  }
  return { freshness: "fresh", connection, ageSeconds: age, label: `updated ${age}s ago` };
}

/** AC-NFR-OBS.011.2 — returning from offline: the surface must RE-FETCH before re-enabling actions. This
 *  gate returns whether actions may be enabled given the current freshness + whether a fresh re-fetch has
 *  completed since reconnect. A stale view NEVER re-enables actions. */
export function actionsEnabledAfterReconnect(freshness: Freshness, refetchedSinceReconnect: boolean): boolean {
  if (freshness === "stale") return false; // never act on a stale-but-green screen
  return refetchedSinceReconnect;
}
