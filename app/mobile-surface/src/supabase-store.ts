// ISSUE-079 — the LIVE pg adapter for MobileSurfaceStore. Authored to the 0001 baseline DDL (push_subscriptions,
// notifications, event_log, task_queue). Mobile is NOT a privilege boundary (ADR-006): in a live deployment
// these queries run under the VIEWER's RLS session, so the row filter is the SAME policy as desktop. The
// explicit recipient/originating_user_id predicates below compose WITH (never replace) RLS as defense-in-depth
// so a service_role / RLS-bypass connection (the agent path, the R10 smoke) cannot silently return every
// user's rows (#2), and every read refuses an identity-less call (requireIdentity). Where a table has no safe
// per-viewer column (event_log clearance; task_queue reviewer-visibility) the row filter remains RLS/producer-
// owned — see the per-method notes. Every method mirrors an InMemoryMobileSurfaceStore method 1:1. NOT
// exercised by the offline suite — proven by the R10 live smoke (results/live-smoke.sql, rolled back).
//
// The one net-new binding this OWNS is push_subscriptions: registerPushSubscription upserts on the
// unique(user_id, endpoint) constraint (a re-register from the same device refreshes last_seen, ADR-004-safe),
// and a write that returns no endpoint row is a FAILURE the caller renders as "push not enabled" (#3).

import type { Pool } from "pg";
import {
  type MobileSurfaceStore,
  type PushSubscriptionInput,
  type PushSubscriptionRow,
  type EventLogAppend,
  type NotificationRow,
  type ActivityRow,
  MobileError,
  ERR_PUSH_REGISTRATION_FAILED,
} from "./store.ts";

interface PushDbRow {
  id: string;
  user_id: string;
  endpoint: string;
  keys: Record<string, unknown>;
  platform: string | null;
  last_seen: Date;
}

function toPushRow(r: PushDbRow): PushSubscriptionRow {
  return {
    id: r.id,
    userId: r.user_id,
    endpoint: r.endpoint,
    keys: r.keys ?? {},
    platform: r.platform,
    lastSeen: r.last_seen.toISOString(),
  };
}

export class SupabaseMobileSurfaceStore implements MobileSurfaceStore {
  constructor(private readonly pool: Pool) {}

  /**
   * A read with no authenticated identity must NEVER run an unscoped query (#2). RLS is the primary boundary,
   * but on a service_role / RLS-bypass connection (the agent path and the R10 smoke) RLS does not apply — so a
   * missing viewer id would silently return EVERY user's rows. Fail closed instead: no identity → no read.
   */
  private requireIdentity(userId: string): string {
    if (!userId || userId.trim().length === 0) {
      throw new MobileError("no_identity", "read requires an authenticated viewer id — refusing an unscoped read (#2)");
    }
    return userId;
  }

  async registerPushSubscription(input: PushSubscriptionInput): Promise<PushSubscriptionRow> {
    if (!input.endpoint) {
      throw new MobileError(ERR_PUSH_REGISTRATION_FAILED, "registration returned no endpoint — push not enabled");
    }
    try {
      const { rows } = await this.pool.query<PushDbRow>(
        `insert into public.push_subscriptions (user_id, endpoint, keys, platform, last_seen)
         values ($1, $2, $3::jsonb, $4, now())
         on conflict (user_id, endpoint)
         do update set keys = excluded.keys, platform = excluded.platform, last_seen = now()
         returning id, user_id, endpoint, keys, platform, last_seen`,
        [input.userId, input.endpoint, JSON.stringify(input.keys ?? {}), input.platform],
      );
      const row = rows[0];
      if (!row || !row.endpoint) {
        throw new MobileError(ERR_PUSH_REGISTRATION_FAILED, "push_subscriptions upsert returned no endpoint row");
      }
      return toPushRow(row);
    } catch (e) {
      if (e instanceof MobileError) throw e;
      // Any DB failure is a registration failure the caller must surface as "push not enabled" (#3) — never
      // swallowed into a false "on".
      throw new MobileError(ERR_PUSH_REGISTRATION_FAILED, `push_subscriptions write failed: ${String(e)}`);
    }
  }

  async listPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
    const { rows } = await this.pool.query<PushDbRow>(
      `select id, user_id, endpoint, keys, platform, last_seen
         from public.push_subscriptions where user_id = $1 order by last_seen desc`,
      [userId],
    );
    return rows.map(toPushRow);
  }

  async appendEventLog(e: EventLogAppend): Promise<void> {
    await this.pool.query(
      `insert into public.event_log (event_type, entity_ids, summary, payload)
       values ($1, $2::uuid[], $3, $4::jsonb)`,
      [e.eventType, e.entityIds, e.summary, JSON.stringify(e.payload)],
    );
  }

  async markNotificationActioned(id: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `update public.notifications set read_state = 'actioned', actioned_at = now() where id = $1`,
      [id],
    );
    if (rowCount === 0) {
      // The row wasn't there (or RLS hid it) — fail loud rather than pretend the mark succeeded (#3).
      throw new MobileError("notification_not_found", `notification ${id} not found (or not visible under RLS)`);
    }
  }

  async homePendingApprovalCount(userId: string): Promise<number> {
    // Items awaiting approval the viewer can ACT ON. Reviewer-visibility (PERM-action.review node scope) is
    // RLS/producer-owned (C1/C6, ISSUE-056) — this app-side predicate composes WITH it as defense-in-depth so
    // RLS is not the sole boundary. The one scoping we can safely assert here without that policy: never count
    // the viewer's OWN originated tasks toward "you can approve N" (no-self-approval, #2 — open-question #4).
    // `is distinct from` keeps null/system-originated tasks counted.
    this.requireIdentity(userId);
    const { rows } = await this.pool.query<{ n: string }>(
      `select count(*)::text as n from public.task_queue
         where status = 'awaiting_approval' and originating_user_id is distinct from $1::uuid`,
      [userId],
    );
    return Number(rows[0]!.n);
  }

  async homeActiveAlertCount(userId: string): Promise<number> {
    // Defense-in-depth (#2): only the viewer's own notifications (recipient = viewer) or role-broadcasts
    // (recipient null — refined by role in the producer RLS). Never another user's directly-addressed alert.
    this.requireIdentity(userId);
    const { rows } = await this.pool.query<{ n: string }>(
      `select count(*)::text as n from public.notifications
         where read_state <> 'actioned' and (recipient = $1::uuid or recipient is null)`,
      [userId],
    );
    return Number(rows[0]!.n);
  }

  async listNotifications(userId: string): Promise<NotificationRow[]> {
    // Same defense-in-depth scope as homeActiveAlertCount (#2): recipient = viewer OR role-broadcast.
    this.requireIdentity(userId);
    const { rows } = await this.pool.query<{
      id: string;
      type: string;
      severity: string;
      title: string;
      read_state: NotificationRow["read_state"];
      actioned_at: Date | null;
    }>(
      `select id, type::text as type, severity, title, read_state, actioned_at
         from public.notifications
         where recipient = $1::uuid or recipient is null
         order by created_at desc`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      severity: r.severity,
      title: r.title,
      read_state: r.read_state,
      actioned_at: r.actioned_at ? r.actioned_at.toISOString() : null,
    }));
  }

  async listActivity(userId: string): Promise<ActivityRow[]> {
    // event_log carries NO per-viewer column — clearance+relevance scoping (§5) is entirely RLS/producer-owned
    // (C7) and cannot be safely narrowed app-side without a join we don't own. We at least refuse an
    // identity-less read (#2); the row-level clearance filter is owed to the producer issue's RLS policy.
    this.requireIdentity(userId);
    const { rows } = await this.pool.query<{
      id: string;
      summary: string;
      event_type: string;
      answer_mode: string | null;
      created_at: Date;
    }>(
      `select id, summary, event_type::text as event_type, answer_mode::text as answer_mode, created_at
         from public.event_log order by created_at desc`,
    );
    return rows.map((r) => ({
      id: r.id,
      summary: r.summary,
      eventType: r.event_type,
      answerMode: r.answer_mode,
      createdAt: r.created_at.toISOString(),
    }));
  }
}
