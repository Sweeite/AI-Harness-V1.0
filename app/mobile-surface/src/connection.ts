// ISSUE-079 — FR-7.RTP.001/004 the two-Realtime cap + the honest Live/Reconnecting/Polling indicator.
//
// The design's hard cap: exactly TWO Realtime/WebSocket surfaces product-wide. On mobile these are the
// Approval queue (backed by `task_queue`) and the Alerts/notification centre (backed by `notifications`) — the
// exact two tables in the 0023 supabase_realtime publication. Every other mobile screen POLLS; chat async
// results return on poll + a notification nudge, NOT a third socket (AC-7.RTP.001.3). The connection indicator
// is mandatory on every screen and NEVER lies: a socket that connected but is silently frozen must not read
// "Live" (the #3 failure 0023 was written to prevent), and on reconnect the surface RE-FETCHES before it
// re-enables any action (a soft-run item may have auto-run server-side while the phone was offline —
// AC-7.RTP.004.2 / AC-NFR-OBS.011.2).

// ── the two Realtime surfaces (≡ the 0023 supabase_realtime publication; guarded by index.ts `check`) ──
export const REALTIME_SURFACES = [
  { surface: "UI-MOBILE-APPROVALS", table: "task_queue" },
  { surface: "UI-MOBILE-ALERTS", table: "notifications" },
] as const;

export type MobileSurfaceId =
  | "UI-MOBILE-HOME"
  | "UI-MOBILE-APPROVALS"
  | "UI-MOBILE-ACTIVITY"
  | "UI-MOBILE-CHAT"
  | "UI-MOBILE-COMMAND-MENU"
  | "UI-MOBILE-ALERTS";

const REALTIME_SET: ReadonlySet<MobileSurfaceId> = new Set(
  REALTIME_SURFACES.map((r) => r.surface as MobileSurfaceId),
);

/** Is this surface allowed a Realtime socket? Only the two capped surfaces — everything else polls. */
export function isRealtimeSurface(surface: MobileSurfaceId): boolean {
  return REALTIME_SET.has(surface);
}

/** Would opening a socket for this surface breach the two-socket cap? (AC-7.RTP.001.3 — chat gets no third.) */
export function pollsOnly(surface: MobileSurfaceId): boolean {
  return !isRealtimeSurface(surface);
}

// ── the honest connection indicator (FR-7.RTP.004) ────────────────────────────────────────────────
export type ConnectionState = "live" | "reconnecting" | "polling" | "offline";

export interface ConnectionInputs {
  /** Is a Realtime socket for this surface currently open at the transport layer? */
  socketOpen: boolean;
  /** Has the socket received a change/heartbeat within the freshness window? A connected-but-silent socket is
   *  NOT "live" (the 0023 silent-freeze bug: a subscription with no publication rows connects but never fires). */
  heartbeatFresh: boolean;
  /** Is the device online at all? */
  online: boolean;
  /** Is this a Realtime-capped surface? A polling surface can never be "live". */
  realtime: boolean;
}

/**
 * The pure indicator rule. It NEVER reports "live" on a stale/frozen socket or a polling surface (#3):
 *   offline device                         → "offline"
 *   Realtime surface, socket open + fresh   → "live"
 *   Realtime surface, socket open but stale  → "reconnecting" (connected ≠ live — the 0023 lesson)
 *   Realtime surface, socket down (online)   → "reconnecting"
 *   polling surface (online)                 → "polling"
 */
export function connectionState(i: ConnectionInputs): ConnectionState {
  if (!i.online) return "offline";
  if (!i.realtime) return "polling";
  if (i.socketOpen && i.heartbeatFresh) return "live";
  return "reconnecting";
}

/**
 * AC-7.RTP.004.2 / AC-NFR-OBS.011.2 — on return from a non-live state a surface must RE-FETCH before it
 * re-enables any action. Actions are enabled ONLY when the connection is confirmed live/polling AND a fresh
 * fetch has completed since the last disruption. A blind approve against a stale queue is forbidden (#3).
 */
export function canEnableActions(state: ConnectionState, refetchedSinceReconnect: boolean): boolean {
  if (state === "offline" || state === "reconnecting") return false;
  return refetchedSinceReconnect;
}

/**
 * AC-7.RTP.004.1 — teardown on unmount. Returns the teardown plan: a Realtime surface must close its socket;
 * a polling surface must clear its timer. Modelled as a pure descriptor the shell executes (no dangling
 * socket/timer keeps consuming the two-socket budget after the screen is gone).
 */
export function teardownPlan(surface: MobileSurfaceId): { closeSocket: boolean; clearPollTimer: boolean } {
  const realtime = isRealtimeSurface(surface);
  return { closeSocket: realtime, clearPollTimer: !realtime };
}
