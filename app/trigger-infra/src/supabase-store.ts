// ISSUE-037 — the LIVE TriggerStore adapter (pg, against the client-owned silo Supabase). The only module
// that imports `pg`. Implements the same port as InMemoryTriggerStore against the real DDL.
//
// ⚠️ NOT YET RUN LIVE. Applying the proposed event_type additive delta (results/proposed-shared-spec.md)
// to a silo + a live run of these paths is a 💻 live-infra step owed to the operator / integration. This
// adapter is authored to the DDL so the seam is real + typechecks; InMemoryTriggerStore is the proven
// reference model. Do NOT claim these paths verified until a live run records evidence.
//
// SCHEMA HOMING (issue §5 + schema.md §4): there is NO dedicated trigger_config / watch_state /
// event_watermark table. Trigger definitions, default-set enable flags, watch state, and per-channel
// watermarks ALL ride in `tools.config` jsonb on a per-connector "trigger carrier" tool row (one per
// connector, `category='read'`, a stable name e.g. `<connector>__triggers`). This adapter reads/writes
// exactly that jsonb sub-tree via jsonb path ops, so it mirrors the InMemory fake's shapes. The dedup +
// watermark + delivery-sample state also lives there. The event_type values are the additive delta this
// slice owes (proposed-shared-spec.md); until applied, the `::event_type` cast below raises LOUDLY.

import pg from 'pg';
import type { Connector } from './seam.js';
import type {
  TriggerStore,
  DefaultTrigger,
  TriggerRule,
  WatchState,
  Watermark,
  DeliverySample,
  EventLogRow,
  AuditRow,
  NewEvent,
  NewAudit,
} from './store.js';
import { AUDIT_TYPE_TRIGGER_CONFIG } from './store.js';

/** The jsonb sub-tree shape under `tools.config` for a connector's trigger carrier row. Documented here
 *  so the live reads/writes and the InMemory fake agree on the exact shape (the anti-drift contract). */
interface TriggerConfigBlob {
  defaults?: DefaultTrigger[];
  rules?: TriggerRule[];
  watches?: WatchState[];
  watermarks?: Watermark[];
  deliverySample?: DeliverySample;
  seenEventIds?: string[]; // dedup ledger (bounded by the caller's replay window in practice)
}

export class SupabaseTriggerStore implements TriggerStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  /** The stable carrier-tool name that homes a connector's trigger config in tools.config. */
  private carrierName(connector: Connector): string {
    return `${connector}__triggers`;
  }

  private async readBlob(connector: Connector): Promise<TriggerConfigBlob> {
    const res = await this.pool.query<{ config: TriggerConfigBlob }>(
      `select config from tools where name = $1 and enabled = true order by version desc limit 1`,
      [this.carrierName(connector)],
    );
    return res.rows[0]?.config ?? {};
  }

  /** Merge a partial blob into tools.config via jsonb concatenation (||), scoped to the carrier row.
   *  Writes are last-writer-wins on the sub-key; the caller passes the full replacement array for a key. */
  private async writeBlob(connector: Connector, patch: Partial<TriggerConfigBlob>): Promise<void> {
    const res = await this.pool.query(
      `update tools set config = config || $2::jsonb, updated_at = now()
       where name = $1 and enabled = true`,
      [this.carrierName(connector), JSON.stringify(patch)],
    );
    if (res.rowCount === 0) {
      // The carrier tool must exist (provisioned via the connector registry, ISSUE-032). Its absence is a
      // real misconfiguration — fail LOUD, never silently no-op a config write (#3).
      throw new Error(`tools carrier '${this.carrierName(connector)}' not found — cannot persist trigger config (provisioning gap)`);
    }
  }

  async getDefaultTriggers(connector: Connector): Promise<DefaultTrigger[]> {
    return (await this.readBlob(connector)).defaults ?? [];
  }

  async setDefaultTriggerEnabled(connector: Connector, eventName: string, enabled: boolean, actor: string, now: number): Promise<void> {
    const blob = await this.readBlob(connector);
    const defaults = blob.defaults ?? [];
    const row = defaults.find((d) => d.eventName === eventName);
    if (!row) throw new Error(`trigger default '${eventName}' not found for connector ${connector}`);
    row.enabled = enabled;
    await this.writeBlob(connector, { defaults });
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

  async saveRule(rule: Omit<TriggerRule, 'id'>, actor: string, now: number): Promise<TriggerRule> {
    const blob = await this.readBlob(rule.connector);
    const rules = blob.rules ?? [];
    // A deterministic id from the persisted count — the DB is single-writer per carrier under the update.
    const full: TriggerRule = { id: `rule-${rules.length + 1}`, ...rule };
    rules.push(full);
    await this.writeBlob(rule.connector, { rules });
    await this.writeAudit(
      {
        audit_type: AUDIT_TYPE_TRIGGER_CONFIG,
        actor_identity: actor,
        actor_type: 'user',
        action: 'create_rule',
        target_type: 'trigger_rule',
        after_value: { id: full.id, connector: rule.connector, eventName: rule.eventName, taskName: rule.taskName },
        reason: `rule '${full.id}' on ${rule.connector}/${rule.eventName} → task '${rule.taskName}'`,
      },
      now,
    );
    return full;
  }

  async getRules(connector: Connector, eventName: string): Promise<TriggerRule[]> {
    const rules = (await this.readBlob(connector)).rules ?? [];
    return rules.filter((r) => r.eventName === eventName);
  }

  async seenEvent(connector: Connector, rawEventId: string): Promise<boolean> {
    const seen = (await this.readBlob(connector)).seenEventIds ?? [];
    return seen.includes(rawEventId);
  }
  async recordEvent(connector: Connector, rawEventId: string, _now: number): Promise<void> {
    const blob = await this.readBlob(connector);
    const seen = blob.seenEventIds ?? [];
    if (!seen.includes(rawEventId)) seen.push(rawEventId);
    await this.writeBlob(connector, { seenEventIds: seen });
  }

  async getWatches(): Promise<WatchState[]> {
    // Watches live per-connector; read every carrier row and flatten.
    const res = await this.pool.query<{ config: TriggerConfigBlob }>(
      `select config from tools where name like '%\\_\\_triggers' and enabled = true`,
    );
    return res.rows.flatMap((r) => r.config?.watches ?? []);
  }
  async upsertWatch(w: WatchState): Promise<void> {
    const blob = await this.readBlob(w.connector);
    const watches = blob.watches ?? [];
    // STABLE identity is (connector, kind) — channelId changes on every re-arm (mirror the fake).
    const i = watches.findIndex((x) => x.kind === w.kind);
    if (i >= 0) watches[i] = w;
    else watches.push(w);
    await this.writeBlob(w.connector, { watches });
  }
  async setWatchDegraded(connector: Connector, channelId: string, degraded: boolean): Promise<void> {
    const blob = await this.readBlob(connector);
    const watches = blob.watches ?? [];
    const w = watches.find((x) => x.channelId === channelId);
    if (!w) throw new Error(`watch ${connector}/${channelId} not found`);
    w.degraded = degraded;
    await this.writeBlob(connector, { watches });
  }

  async getWatermark(connector: Connector, channel: string): Promise<Watermark | undefined> {
    const wms = (await this.readBlob(connector)).watermarks ?? [];
    return wms.find((x) => x.channel === channel);
  }
  async setWatermark(connector: Connector, channel: string, position: string, now: number): Promise<void> {
    const blob = await this.readBlob(connector);
    const wms = blob.watermarks ?? [];
    const i = wms.findIndex((x) => x.channel === channel);
    const row: Watermark = { connector, channel, position, updatedAt: now };
    if (i >= 0) wms[i] = row;
    else wms.push(row);
    await this.writeBlob(connector, { watermarks: wms });
  }
  async getDeliverySample(connector: Connector): Promise<DeliverySample | undefined> {
    return (await this.readBlob(connector)).deliverySample;
  }

  async logEvent(row: NewEvent, _now: number): Promise<EventLogRow> {
    // append-only event_log. The ::event_type cast raises LOUDLY if the additive delta is not applied —
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
