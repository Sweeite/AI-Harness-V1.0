// ISSUE-076 — the LIVE config/seed adapter (pg, against the client-owned silo Supabase). The only module
// that imports `pg`. This slice creates NO table: it READS the two config surfaces (per-surface poll
// cadences + the headroom threshold) from config_values (schema.md §12) and READS the initial subscription
// seed rows (task_queue `awaiting_approval`, notifications) that the two Realtime subscriptions then track.
// The budget/degrade/lifecycle engine (ConnectionManager) is pure client state and is identical whether the
// config comes from this adapter or the in-memory fake — so the adapter only has to supply the config reads.
//
// ⚠️ NOT YET RUN LIVE. Authored to the DDL so the seam is real and typechecks; the InMemoryRealtimeConfig +
// ConnectionManager are the proven reference model. The only paths this adapter adds over the fake are the
// two config_values reads and the two seed reads — plain selects with NO client_slug predicate (ADR-001 §3,
// reconciliation #1 → AC-7.RTP.003.3). There is no writer here (this is a read/subscribe transport layer).
//
// Design notes tied to the three non-negotiables:
//   - #3 (never fail silently): a missing config key returns `undefined` (NOT 0 / NOT a silent freeze) so the
//     caller applies the documented default — an absent cadence never reads as "poll never".
//   - #2 (never do what it shouldn't): the two seed selects carry an intra-silo predicate ONLY
//     (status='awaiting_approval' on task_queue; none on notifications) — never a client_slug filter, which
//     would be a Pooled-model artefact ADR-001 §3 deletes.

import pg from 'pg';
import type { RealtimeConfigSource } from './store.ts';
import { surfaceSpec, type SurfaceId } from './surfaces.ts';
import { HEADROOM_THRESHOLD_KEY } from './surfaces.ts';

/** A seed row the approval-queue subscription starts from (task_queue in the awaiting_approval state). */
export interface ApprovalSeedRow {
  id: string;
  status: string;
  task_name: string;
  created_at: string;
}
/** A seed row the notification-centre subscription starts from (notifications). */
export interface NotificationSeedRow {
  id: string;
  type: string;
  severity: string;
  title: string;
  read_state: string;
  created_at: string;
}

export class SupabaseRealtimeConfig implements RealtimeConfigSource {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  // NOTE: RealtimeConfigSource is declared sync for the reference fake; the live reads are async, so the
  // client bootstraps by PRELOADING the config once (loadConfig) into a plain sync snapshot that satisfies
  // the port. This keeps the ConnectionManager engine free of async in its hot path (mount/degrade), while
  // a config edit takes effect on the next reload — LIVE, no code change (AC-7.RTP.002.2).
  private pollSnapshot = new Map<SurfaceId, number>();
  private thresholdSnapshot: number | undefined;

  /** Preload the per-surface cadence keys + the headroom threshold from config_values into the sync
   *  snapshot the port reads. Re-run to pick up a LIVE config edit (AC-7.RTP.002.1/.2). */
  async loadConfig(): Promise<void> {
    const next = new Map<SurfaceId, number>();
    for (const spec of ['health_metrics', 'event_log', 'memory_health', 'self_improvement', 'cost_tracking', 'agent_health'] as SurfaceId[]) {
      const key = surfaceSpec(spec).pollIntervalKey;
      if (!key) continue;
      const res = await this.pool.query<{ value: unknown }>(`select value from config_values where key = $1`, [key]);
      const raw = res.rows[0]?.value;
      // config_values.value is jsonb; a numeric cadence may arrive as number or numeric-string. Unset → skip
      // (the default applies) — NEVER coerce a missing key to 0 (#3).
      if (raw !== undefined && raw !== null) {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (Number.isFinite(n) && n > 0) next.set(spec, n);
      }
    }
    const t = await this.pool.query<{ value: unknown }>(`select value from config_values where key = $1`, [HEADROOM_THRESHOLD_KEY]);
    const traw = t.rows[0]?.value;
    this.thresholdSnapshot = traw === undefined || traw === null ? undefined : Number(traw);
    this.pollSnapshot = next;
  }

  pollIntervalSeconds(surface: SurfaceId): number | undefined {
    return this.pollSnapshot.get(surface);
  }
  headroomThreshold(): number | undefined {
    return this.thresholdSnapshot;
  }

  /** The approval-queue subscription's seed read: task_queue rows in the awaiting_approval state. The
   *  predicate is intra-silo (status) — NO client_slug (AC-7.RTP.003.3). */
  async seedApprovalQueue(): Promise<ApprovalSeedRow[]> {
    const res = await this.pool.query<ApprovalSeedRow>(
      `select id, status, task_name, created_at
         from task_queue
        where status = 'awaiting_approval'
        order by created_at asc`,
    );
    return res.rows;
  }

  /** The notification-centre subscription's seed read: the notifications table (no client_slug predicate). */
  async seedNotifications(): Promise<NotificationSeedRow[]> {
    const res = await this.pool.query<NotificationSeedRow>(
      `select id, type, severity, title, read_state, created_at
         from notifications
        order by created_at desc`,
    );
    return res.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
