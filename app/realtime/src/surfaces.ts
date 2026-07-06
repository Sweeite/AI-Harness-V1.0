// ISSUE-076 — the surface catalogue: the fixed, enumerated set of dashboard surfaces and their
// declared freshness transport. This is the load-bearing DOCS artifact behind NFR-OBS.014 /
// AC-7.RTP.001.3: the set of Realtime surfaces is a *closed, named list of exactly two* — the code
// cannot open a third by accident because a surface's transport is a property of its catalogue entry,
// not a per-callsite decision.
//
// Faithful to:
//   • FR-7.RTP.001 / NFR-OBS.014 — exactly two Realtime surfaces: approval queue + notification centre.
//   • FR-7.RTP.002 — the six polled surfaces + their documented default cadences (schema.md §12 config_values;
//     component-07 FR-7.RTP.002 L434–436): health 30s, event log 60s, memory health 5m, self-improvement
//     10m, cost tracking 5m, agent health 60s. Each cadence is read from config; the default applies unset.

/** The freshness transport a surface is *entitled to*. Two surfaces declare `realtime`; the rest `poll`.
 *  This is the entitlement (design intent), distinct from the runtime `FreshnessMode` a surface currently
 *  holds — a `realtime`-entitled surface can be running in `polling` mode after a degrade/reconnect. */
export type Transport = 'realtime' | 'poll';

/** The runtime freshness state a surface reports to the UI — an HONEST indicator (FR-7.RTP.004 /
 *  AC-NFR-PERF.011.1). A view is NEVER shown "live" while stale. */
export type FreshnessMode = 'live' | 'reconnecting' | 'polling';

/** The stable id of every dashboard surface this contract governs. */
export type SurfaceId =
  // ── the TWO Realtime (trust-critical) surfaces ──
  | 'approval_queue'
  | 'notification_centre'
  // ── the polled surfaces (FR-7.RTP.002) ──
  | 'health_metrics'
  | 'event_log'
  | 'memory_health'
  | 'self_improvement'
  | 'cost_tracking'
  | 'agent_health';

export interface SurfaceSpec {
  id: SurfaceId;
  transport: Transport;
  /** For polled surfaces: the config_values key its cadence is read from (FR-7.RTP.002). */
  pollIntervalKey?: string;
  /** For polled surfaces: the documented default cadence in SECONDS, applied when the key is unset. */
  defaultPollSeconds?: number;
  /** True for the two trust-critical surfaces (approval queue + notifications) — they are prioritised for
   *  live connections and are the LAST to degrade to polling (FR-7.RTP.003 / AC-NFR-PERF.011.2). */
  trustCritical?: boolean;
}

// The two Realtime surfaces — named, closed. Adding a third here is the ONLY way to open another Realtime
// surface, and the build-time check (index.ts) + AC-7.RTP.001.3 test assert the count is exactly two.
export const REALTIME_SURFACES: readonly SurfaceId[] = ['approval_queue', 'notification_centre'] as const;

// The documented per-surface poll cadences (component-07 FR-7.RTP.002 L434–436). Values in SECONDS.
export const SURFACE_CATALOGUE: readonly SurfaceSpec[] = [
  { id: 'approval_queue', transport: 'realtime', trustCritical: true },
  { id: 'notification_centre', transport: 'realtime', trustCritical: true },
  { id: 'health_metrics', transport: 'poll', pollIntervalKey: 'polling_interval_health_metrics_s', defaultPollSeconds: 30 },
  { id: 'event_log', transport: 'poll', pollIntervalKey: 'polling_interval_event_log_s', defaultPollSeconds: 60 },
  { id: 'memory_health', transport: 'poll', pollIntervalKey: 'polling_interval_memory_health_s', defaultPollSeconds: 300 },
  { id: 'self_improvement', transport: 'poll', pollIntervalKey: 'polling_interval_self_improvement_s', defaultPollSeconds: 600 },
  { id: 'cost_tracking', transport: 'poll', pollIntervalKey: 'polling_interval_cost_tracking_s', defaultPollSeconds: 300 },
  { id: 'agent_health', transport: 'poll', pollIntervalKey: 'polling_interval_agent_health_s', defaultPollSeconds: 60 },
] as const;

const CATALOGUE_BY_ID = new Map<SurfaceId, SurfaceSpec>(SURFACE_CATALOGUE.map((s) => [s.id, s]));

export function surfaceSpec(id: SurfaceId): SurfaceSpec {
  const s = CATALOGUE_BY_ID.get(id);
  if (!s) throw new Error(`unknown surface '${id}' — not in the catalogue (a surface must be declared to exist)`);
  return s;
}

/** The config_values key for the per-silo degrade headroom threshold (CFG in §5; LIVE, int 1–100, default 80). */
export const HEADROOM_THRESHOLD_KEY = 'realtime_connection_headroom_threshold' as const;
export const HEADROOM_THRESHOLD_DEFAULT = 80;

/** The per-silo Realtime concurrent-connection ceiling (Supabase Free ~200 / Pro ~500). Per SILO — the
 *  budget is scoped to one client's own Supabase project (ADR-001 §7), never global (FR-7.RTP.003). */
export type SiloTier = 'free' | 'pro';
export const SILO_CAP: Record<SiloTier, number> = { free: 200, pro: 500 };
