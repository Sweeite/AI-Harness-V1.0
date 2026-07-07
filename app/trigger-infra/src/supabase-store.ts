// ISSUE-037 — the LIVE TriggerStore adapter (pg, against the client-owned silo Supabase). The only module
// that imports `pg`. Implements the same port as InMemoryTriggerStore against the real DDL.
//
// ⚠️ NOT YET RUN LIVE. Applying the 0018 event_type delta + the 0019/0020 connector-trigger-state tables to a
// silo + a live run of these paths is a 💻 live-infra step owed to the operator / integration. This adapter is
// authored to the DDL so the seam is real + typechecks; InMemoryTriggerStore is the proven reference model.
// Do NOT claim these paths verified until a live run records evidence (results/live-smoke.sql replays them).
//
// SCHEMA HOMING (OD-190, session 71): trigger runtime state has its OWN dedicated MUTABLE tables (migration
// 0019_connector_trigger_state) -- NOT `tools.config` jsonb. The prior homing (all state in tools.config,
// mutated in place) was a live-confirmed BLOCKER: `tools` is version-locked by the 0008
// enforce_tool_version_discipline trigger, so every in-place `config` write RAISES. OD-190 re-homed the state:
//   connector_triggers        -- default set (kind='default') + no-code rules (kind='rule')   (FR-3.TRIG.002/003)
//   connector_watches         -- watch/subscription liveness, keyed (connector,kind)          (FR-3.TRIG.005)
//   event_watermarks          -- per-channel reconciliation watermarks, keyed (connector,channel) (FR-3.TRIG.006)
//   connector_delivery_health -- per-connector rolling delivery sample, keyed (connector)      (FR-3.TRIG.006)
//   event_dedup_ledger        -- seen event ids, keyed (connector,event_id), idempotent receive (FR-3.TRIG.004)
// Every mutating method is a SINGLE atomic statement (an upsert / insert-on-conflict), which also fixes the
// review MAJOR (the old jsonb read-modify-write was a non-atomic lost-update over the whole array). The trigger
// runtime writes as service_role, which bypasses the 0002 default_deny RLS floor by design (ADR-006).

import pg from 'pg';
import type { Connector } from './seam.js';
import type {
  TriggerStore,
  DefaultTrigger,
  TriggerRule,
  TriggerCondition,
  WatchState,
  Watermark,
  DeliverySample,
  EventLogRow,
  AuditRow,
  NewEvent,
  NewAudit,
} from './store.js';
import { AUDIT_TYPE_TRIGGER_CONFIG } from './store.js';

export class SupabaseTriggerStore implements TriggerStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  // ── Default trigger set (connector_triggers where kind='default') — FR-3.TRIG.003 ──────────────────────
  async getDefaultTriggers(connector: Connector): Promise<DefaultTrigger[]> {
    const res = await this.pool.query<{ event_name: string; available_fields: string[]; enabled: boolean }>(
      `select event_name, available_fields, enabled
         from connector_triggers
        where connector = $1 and kind = 'default'
        order by event_name`,
      [connector],
    );
    return res.rows.map((r) => ({ eventName: r.event_name, availableFields: r.available_fields ?? [], enabled: r.enabled }));
  }

  async setDefaultTriggerEnabled(connector: Connector, eventName: string, enabled: boolean, actor: string, now: number): Promise<void> {
    // ATOMIC flip of the single default row (unique per (connector,event_name) via the kind='default' partial
    // index connector_triggers_default_uq, migration 0020). The default must already exist (provisioned/seeded);
    // toggling a non-existent default is a real misconfiguration — fail LOUD, never a silent no-op (#3).
    const res = await this.pool.query(
      `update connector_triggers
          set enabled = $3, updated_at = now()
        where connector = $1 and kind = 'default' and event_name = $2`,
      [connector, eventName, enabled],
    );
    if (res.rowCount === 0) {
      throw new Error(`trigger default '${eventName}' not found for connector ${connector} — cannot toggle a non-existent default`);
    }
    await this.writeAudit(
      {
        audit_type: AUDIT_TYPE_TRIGGER_CONFIG,
        actor_identity: actor,
        actor_type: 'user',
        action: enabled ? 'enable' : 'disable',
        target_type: 'trigger_default',
        after_value: { connector, eventName, enabled },
        reason: `default trigger '${eventName}' → ${enabled ? 'enabled' : 'disabled'}`,
      },
      now,
    );
  }

  // ── No-code rules (connector_triggers where kind='rule') — FR-3.TRIG.002 ───────────────────────────────
  async saveRule(rule: Omit<TriggerRule, 'id'>, actor: string, now: number): Promise<TriggerRule> {
    // ATOMIC single INSERT — the DB mints the id (gen_random_uuid). Rules are NOT unique per event (overlapping
    // rules all fire), so this is a plain insert of a new row, never an upsert.
    const res = await this.pool.query<{ id: string }>(
      `insert into connector_triggers (connector, kind, event_name, conditions, task_name, enabled)
       values ($1, 'rule', $2, $3::jsonb, $4, $5)
       returning id`,
      [rule.connector, rule.eventName, JSON.stringify(rule.conditions), rule.taskName, rule.enabled],
    );
    const full: TriggerRule = { id: res.rows[0]!.id, ...rule };
    await this.writeAudit(
      {
        audit_type: AUDIT_TYPE_TRIGGER_CONFIG,
        actor_identity: actor,
        actor_type: 'user',
        action: 'create_rule',
        target_type: 'trigger_rule',
        after_value: { id: full.id, connector: rule.connector, eventName: rule.eventName, taskName: rule.taskName, conditions: rule.conditions },
        reason: `rule '${full.id}' on ${rule.connector}/${rule.eventName} → task '${rule.taskName}' (${rule.conditions.length} condition(s))`,
      },
      now,
    );
    return full;
  }

  async getRules(connector: Connector, eventName: string): Promise<TriggerRule[]> {
    const res = await this.pool.query<{
      id: string;
      connector: string;
      event_name: string;
      conditions: TriggerCondition[];
      task_name: string;
      enabled: boolean;
    }>(
      `select id, connector, event_name, conditions, task_name, enabled
         from connector_triggers
        where connector = $1 and kind = 'rule' and event_name = $2
        order by id`,
      [connector, eventName],
    );
    return res.rows.map((r) => ({
      id: r.id,
      connector: r.connector as Connector,
      eventName: r.event_name,
      conditions: r.conditions ?? [],
      taskName: r.task_name,
      enabled: r.enabled,
    }));
  }

  // ── Dedup ledger (event_dedup_ledger) — FR-3.TRIG.004 ──────────────────────────────────────────────────
  async seenEvent(connector: Connector, rawEventId: string): Promise<boolean> {
    const res = await this.pool.query(
      `select 1 from event_dedup_ledger where connector = $1 and event_id = $2`,
      [connector, rawEventId],
    );
    return (res.rowCount ?? 0) > 0;
  }
  async recordEvent(connector: Connector, rawEventId: string, now: number): Promise<void> {
    // ATOMIC idempotent insert. A re-delivered (connector,event_id) is a no-op (on conflict do nothing) — the
    // pk (connector,event_id) is the dedup key. rowCount 1 = new, 0 = duplicate (mirrors the fake's Set.add).
    await this.pool.query(
      `insert into event_dedup_ledger (connector, event_id, seen_at)
       values ($1, $2, $3)
       on conflict (connector, event_id) do nothing`,
      [connector, rawEventId, now],
    );
  }

  // ── Watch liveness (connector_watches) — FR-3.TRIG.005 ─────────────────────────────────────────────────
  async getWatches(): Promise<WatchState[]> {
    const res = await this.pool.query<{
      connector: string;
      kind: string;
      channel_id: string;
      resource_id: string;
      expires_at: string;
      degraded: boolean;
    }>(`select connector, kind, channel_id, resource_id, expires_at, degraded from connector_watches`);
    return res.rows.map((r) => ({
      connector: r.connector as Connector,
      kind: r.kind,
      channelId: r.channel_id,
      resourceId: r.resource_id,
      expiresAt: Number(r.expires_at), // bigint arrives as string
      degraded: r.degraded,
    }));
  }
  async upsertWatch(w: WatchState): Promise<void> {
    // ATOMIC upsert on the STABLE identity (connector, kind) — channel_id/resource_id change on every re-arm, so
    // keying on channel_id would leak a row per re-arm + orphan the old expiry (#1). One watch per (connector,kind).
    await this.pool.query(
      `insert into connector_watches (connector, kind, channel_id, resource_id, expires_at, degraded, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (connector, kind) do update
         set channel_id = excluded.channel_id, resource_id = excluded.resource_id,
             expires_at = excluded.expires_at, degraded = excluded.degraded, updated_at = now()`,
      [w.connector, w.kind, w.channelId, w.resourceId, w.expiresAt, w.degraded],
    );
  }
  async setWatchDegraded(connector: Connector, channelId: string, degraded: boolean): Promise<void> {
    // The failing path identifies the watch by its CURRENT channelId (liveness.ts). ATOMIC single UPDATE; a
    // missing watch fails LOUD (never silently degrade a non-existent watch — #3).
    const res = await this.pool.query(
      `update connector_watches set degraded = $3, updated_at = now()
        where connector = $1 and channel_id = $2`,
      [connector, channelId, degraded],
    );
    if (res.rowCount === 0) {
      throw new Error(`watch ${connector}/${channelId} not found — cannot set degraded on a missing watch`);
    }
  }

  // ── Watermarks + delivery health (event_watermarks / connector_delivery_health) — FR-3.TRIG.006 ─────────
  async getWatermark(connector: Connector, channel: string): Promise<Watermark | undefined> {
    const res = await this.pool.query<{ connector: string; channel: string; position: string; updated_at: string }>(
      `select connector, channel, position, updated_at from event_watermarks where connector = $1 and channel = $2`,
      [connector, channel],
    );
    const r = res.rows[0];
    return r ? { connector: r.connector as Connector, channel: r.channel, position: r.position, updatedAt: Number(r.updated_at) } : undefined;
  }
  async setWatermark(connector: Connector, channel: string, position: string, now: number): Promise<void> {
    // ATOMIC upsert keyed on (connector, channel). High-churn — advances every sweep.
    await this.pool.query(
      `insert into event_watermarks (connector, channel, position, updated_at)
       values ($1, $2, $3, $4)
       on conflict (connector, channel) do update
         set position = excluded.position, updated_at = excluded.updated_at`,
      [connector, channel, position, now],
    );
  }
  async getDeliverySample(connector: Connector): Promise<DeliverySample | undefined> {
    const res = await this.pool.query<{ connector: string; success_rate: string; updated_at: string }>(
      `select connector, success_rate, updated_at from connector_delivery_health where connector = $1`,
      [connector],
    );
    const r = res.rows[0];
    return r ? { connector: r.connector as Connector, successRate: Number(r.success_rate), updatedAt: Number(r.updated_at) } : undefined;
  }

  // ── Sinks (event_log / access_audit) — unchanged homing (append-only C7 tables) ────────────────────────
  async logEvent(row: NewEvent, _now: number): Promise<EventLogRow> {
    // append-only event_log. The ::event_type cast raises LOUDLY if the 0018 additive delta is not applied —
    // the missing migration can NEVER hide behind a silent skip (#3).
    const res = await this.pool.query<EventLogRow>(
      `insert into event_log (task_id, event_type, entity_ids, summary, payload)
       values ($1, $2::event_type, $3::uuid[], $4, $5::jsonb)
       returning id, task_id, event_type, entity_ids, summary, payload, created_at`,
      [
        row.task_id,
        row.event_type,
        // entity_ids is uuid[] in the DDL; trigger entity ids are connector-native (not uuids) → they ride
        // in payload/summary, and entity_ids is the (possibly empty) set of real uuids only.
        row.entity_ids,
        row.summary,
        JSON.stringify(row.payload),
      ],
    );
    return res.rows[0]!;
  }

  async writeAudit(row: NewAudit, _now: number): Promise<AuditRow> {
    // The audit sink is the immutable C7 `access_audit` table (schema.md §1 L259 / 0001_baseline.sql L211) —
    // there is NO table named `audit`. Supply ALL four NOT-NULL columns (audit_type, actor_identity,
    // actor_type, action); connector/detail context rides in after_value (jsonb) + reason. actor_type is
    // cast to the pg enum LOUDLY — a bad member raises, never silently mislabels the trail (#3). Mirrors the
    // sibling precedent (app/webhook-auth, app/rbac supabase-store.ts).
    const res = await this.pool.query<{ id: string; created_at: string }>(
      `insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, after_value, reason)
       values ($1, $2, $3::actor_type, $4, $5, $6::jsonb, $7)
       returning id, created_at`,
      [
        row.audit_type,
        row.actor_identity,
        row.actor_type,
        row.action,
        row.target_type ?? null,
        row.after_value === undefined ? null : JSON.stringify(row.after_value),
        row.reason ?? null,
      ],
    );
    return { id: res.rows[0]!.id, created_at: res.rows[0]!.created_at, ...row };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
