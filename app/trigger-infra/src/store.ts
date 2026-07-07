// ISSUE-037 §5/§8 — the TriggerStore PORT + the in-memory FAKE reference model.
//
// Every live side effect of the C3 trigger layer goes through this port so the pipeline (parser.ts /
// config.ts / liveness.ts) stays unit-testable with NO live DB — the house port+fake pattern (cf.
// app/connector-runtime/src/store.ts, app/webhook-auth/src/store.ts). The in-memory fake below is the
// test double AND the reference model: it enforces every invariant the real DDL enforces, so it cannot
// pass offline where the live supabase-store.ts would throw (the session-69/71 fake-vs-live drift class).
//
// SCHEMA HOMING (OD-190, session 71): trigger runtime state has its OWN dedicated MUTABLE tables (migration
// 0019_connector_trigger_state) — NOT `tools.config` jsonb. The prior homing (all state in tools.config,
// mutated in place) was a live-confirmed BLOCKER: `tools` is version-locked by the 0008 version-discipline
// trigger, so every in-place `config` write RAISES. The tables are: connector_triggers (defaults kind='default'
// + rules kind='rule'), connector_watches (keyed (connector,kind)), event_watermarks (keyed (connector,channel)),
// connector_delivery_health (keyed connector), event_dedup_ledger (keyed (connector,event_id)). This fake MODELS
// those keys/constraints exactly — a dedup insert is idempotent on (connector,event_id), a watch upserts on
// (connector,kind), a default is unique per (connector,event_name) — so the fake CANNOT pass offline where the
// live DDL would reject (the session-69/71 fake-vs-live drift class).
//
// SINKS: event_log (append-only, C7) and audit — this slice WRITES the trigger-lifecycle rows (inbound
// volume, parse/verify failures, trigger firings, re-arm success/fail, detected/reconciled gaps) and
// audits config + enable/disable changes. The event_type values it needs are NOT yet in the schema.md
// L60 enum — recorded in results/proposed-shared-spec.md as an additive change-control delta (same class
// as OD-179). Until applied, the live adapter's `::event_type` cast raises LOUDLY — never a silent skip.

import type { Connector } from './seam.js';

// ── event_type values this slice writes (additive delta — results/proposed-shared-spec.md) ───────────
// Listed as a const so a typo can't silently write a different label than the migration adds.
export const EVT_TRIGGER_INBOUND = 'trigger_inbound' as const; // an inbound verified event received + parsed
export const EVT_TRIGGER_PARSE_FAILED = 'trigger_parse_failed' as const; // malformed payload rejected (#3, AC.001.2)
export const EVT_TRIGGER_FIRED = 'trigger_fired' as const; // a rule matched → task launched (AC.002.1)
export const EVT_WATCH_REARMED = 'watch_rearmed' as const; // a watch re-armed before lapse (AC.005.1)
export const EVT_WATCH_REARM_FAILED = 'watch_rearm_failed' as const; // re-arm failed/missed → degraded (AC.005.2)
export const EVT_EVENT_GAP_DETECTED = 'event_gap_detected' as const; // delivery gap detected (AC.006.1/.3)
export const EVT_EVENT_GAP_RECONCILED = 'event_gap_reconciled' as const; // gap re-read + re-ingested (AC.006.1)
export const EVT_DELIVERY_DEGRADED = 'delivery_degraded' as const; // 2xx rate near auto-disable (AC.006.2)
export const EVT_RECONCILE_SWEEP_FAILED = 'reconcile_sweep_failed' as const; // the sweep itself could not run (#3)

export const TRIGGER_EVENT_TYPES = [
  EVT_TRIGGER_INBOUND,
  EVT_TRIGGER_PARSE_FAILED,
  EVT_TRIGGER_FIRED,
  EVT_WATCH_REARMED,
  EVT_WATCH_REARM_FAILED,
  EVT_EVENT_GAP_DETECTED,
  EVT_EVENT_GAP_RECONCILED,
  EVT_DELIVERY_DEGRADED,
  EVT_RECONCILE_SWEEP_FAILED,
] as const;
export type TriggerEventType = (typeof TRIGGER_EVENT_TYPES)[number];

// ── A normalized event — the parser's output (FR-3.TRIG.001) ─────────────────────────────────────────
// The connector parser turns the opaque verified payload into this shape for trigger evaluation. Fields
// external content lives in are BOUNDARY-TAGGED per ADR-007 (this is untrusted external data): `fields`
// is never treated as instructions, only matched against by condition rules. `boundary_tagged` marks it.
export interface NormalizedEvent {
  connector: Connector;
  /** The connector's event-name (e.g. ghl `ContactCreate`, slack `message`, gmail `new_email`). */
  eventName: string;
  /** The connector's per-delivery id — dedup key (deliveryId / event_id / message id). */
  rawEventId: string;
  /** Flat, string-keyed match fields extracted by the parser (e.g. { tag: 'vip', channel: 'C123' }).
   *  EXTERNAL, UNTRUSTED content — matched against, never executed (ADR-007 boundary tag). */
  fields: Record<string, string>;
  /** ADR-007: this content crossed the trust boundary from an external system. Always true here. */
  boundary_tagged: true;
}

// ── Trigger definition + config (persisted in connector_triggers; OD-190) ─────────────────────────────
export type TriggerConditionOp = 'eq' | 'neq' | 'exists' | 'in';

/** A single condition clause matched against a NormalizedEvent.fields entry. Missing-field semantics:
 *  `exists` false-if-absent; `eq`/`neq`/`in` on an absent field → NO match (never a throw — the event is
 *  simply not for this rule). A rule that references a field NO event of its eventName can carry is a
 *  save-time validation error (see config.ts validateRule), not a runtime surprise. */
export interface TriggerCondition {
  field: string;
  op: TriggerConditionOp;
  /** Required for eq/neq; for `in` a comma-joined set; ignored for `exists`. */
  value?: string;
}

/** A default trigger shipped with a connector (FR-3.TRIG.003) — event name + the fields it can carry. */
export interface DefaultTrigger {
  eventName: string;
  /** The match-fields this event type is documented to carry — used to VALIDATE user rules at save. */
  availableFields: readonly string[];
  /** Whether this default trigger is enabled for THIS deployment. A disabled trigger fires nothing. */
  enabled: boolean;
}

/** A user-authored no-code rule (FR-3.TRIG.002): event + conditions → task. */
export interface TriggerRule {
  id: string;
  connector: Connector;
  eventName: string;
  conditions: TriggerCondition[];
  /** The task this rule launches on a match (the C5 seam — this slice hands off the name + fields). */
  taskName: string;
  enabled: boolean;
}

// ── Watch / subscription state (FR-3.TRIG.005) — persisted in connector_watches, keyed (connector,kind) ─
/** One expiring push subscription / watch channel. Only the Google family expires (Gmail Pub/Sub ~7d;
 *  Drive files 1d / changes 7d; Calendar bounded). Slack Events + GHL app-webhook do NOT expire → they
 *  carry NO watch row and the re-arm job skips them (FR-3.TRIG.005 branch). */
export interface WatchState {
  connector: Connector;
  /** Which watch family: gmail | drive_files | drive_changes | calendar. */
  kind: string;
  channelId: string;
  resourceId: string;
  /** Epoch seconds the watch lapses. The re-arm job acts when now >= expiresAt - lead. */
  expiresAt: number;
  /** True once a re-arm has failed/lapsed — the connector is degraded until re-armed (AC.005.2). */
  degraded: boolean;
}

// ── Per-channel delivery watermark (FR-3.TRIG.006) — persisted in event_watermarks, keyed (connector,channel)
/** The persisted high-water mark per channel: Slack `ts` per channel; Gmail `historyId`. A sweep re-reads
 *  from here; a watermark that never advances while events are expected is the never-arriving-webhook
 *  signal (OD-104(a)). */
export interface Watermark {
  connector: Connector;
  channel: string; // slack channel id / gmail 'default'
  /** The last successfully-ingested position (slack `ts` / gmail `historyId`), as an opaque string. */
  position: string;
  updatedAt: number;
}

// ── Delivery-health sample (FR-3.TRIG.006 Slack 2xx-rate monitor) ────────────────────────────────────
export interface DeliverySample {
  connector: Connector;
  /** Rolling 2xx delivery rate in [0,1] over the trailing window (Slack auto-disables <0.05 fail over 60m,
   *  i.e. >95% FAILURE → we flag as we APPROACH it). */
  successRate: number;
  updatedAt: number;
}

// ── Sink rows (event_log / audit) ────────────────────────────────────────────────────────────────────
export interface EventLogRow {
  id: string;
  task_id: string | null;
  event_type: TriggerEventType;
  entity_ids: string[];
  summary: string; // never empty (AC-7.LOG.002.2)
  payload: unknown;
  created_at: string;
}
export type NewEvent = Omit<EventLogRow, 'id' | 'created_at'>;

// The audit sink is the immutable C7 `access_audit` table (schema.md §1 L259 / 0001_baseline.sql L211).
// This row mirrors that DDL EXACTLY so the fake cannot accept a field the live insert would reject
// (the session-69/71 fake-vs-live drift class). NOT-NULL columns are audit_type / actor_identity /
// actor_type / action; the rest are optional. `actor_type` is the pg enum ('user'|'agent'|'system',
// enum L41) — a trigger config change is an Admin/authorized-principal action, i.e. actor_type 'user'
// (the RBAC gate upstream), or 'system' for a machine-driven toggle.
export type ActorType = 'user' | 'agent' | 'system';
export const ACTOR_TYPES: readonly ActorType[] = ['user', 'agent', 'system'] as const;

/** A stable audit_type classifier for every trigger config / enable-disable / rule change. */
export const AUDIT_TYPE_TRIGGER_CONFIG = 'trigger_config_change' as const;

export interface AuditRow {
  id: string;
  audit_type: string; // stable classifier — 'trigger_config_change' for this slice
  actor_identity: string; // the Admin/authorized principal identity (RBAC-gated upstream)
  actor_type: ActorType; // 'user' | 'agent' | 'system' (access_audit.actor_type enum)
  action: string; // the concrete verb: enable | disable | create_rule (…)
  target_type?: string; // e.g. 'trigger_default' | 'trigger_rule' — the object class touched
  after_value?: unknown; // the resulting config (rides in jsonb) — carries connector/detail context
  reason?: string; // human-readable detail of the change
  created_at: string;
}
export type NewAudit = Omit<AuditRow, 'id' | 'created_at'>;

// ── The port. Sync in the fake, async-modelled for the DB adapter. ───────────────────────────────────
export interface TriggerStore {
  // Default trigger set + toggles (FR-3.TRIG.003)
  getDefaultTriggers(connector: Connector): Promise<DefaultTrigger[]>;
  /** Flip a default trigger's enabled flag (Admin-gated; audited by the caller). */
  setDefaultTriggerEnabled(connector: Connector, eventName: string, enabled: boolean, actor: string, now: number): Promise<void>;

  // No-code rules (FR-3.TRIG.002)
  saveRule(rule: Omit<TriggerRule, 'id'>, actor: string, now: number): Promise<TriggerRule>;
  getRules(connector: Connector, eventName: string): Promise<TriggerRule[]>;

  // Dedup (FR-3.TRIG.004) — defence-in-depth against a re-delivered event C0 already deduped.
  /** Returns true if this rawEventId was already seen for the connector (suppress re-fire). */
  seenEvent(connector: Connector, rawEventId: string): Promise<boolean>;
  recordEvent(connector: Connector, rawEventId: string, now: number): Promise<void>;

  // Watch state (FR-3.TRIG.005)
  getWatches(): Promise<WatchState[]>;
  upsertWatch(w: WatchState): Promise<void>;
  setWatchDegraded(connector: Connector, channelId: string, degraded: boolean): Promise<void>;

  // Watermarks + delivery health (FR-3.TRIG.006)
  getWatermark(connector: Connector, channel: string): Promise<Watermark | undefined>;
  setWatermark(connector: Connector, channel: string, position: string, now: number): Promise<void>;
  getDeliverySample(connector: Connector): Promise<DeliverySample | undefined>;

  // Sinks — `now` (epoch seconds) supplied by the caller; the fake NEVER reads a wall clock (house
  // determinism discipline). In the live adapter created_at defaults to now() at the DB.
  logEvent(row: NewEvent, now: number): Promise<EventLogRow>;
  writeAudit(row: NewAudit, now: number): Promise<AuditRow>;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fake — test double AND reference model. Deterministic: caller supplies a logical `now`
// (epoch seconds); NO Date.now()/random (house discipline — cf. connector-runtime store).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryTriggerStore implements TriggerStore {
  private seq = 0;
  readonly events: EventLogRow[] = [];
  readonly audits: AuditRow[] = [];
  readonly rules: TriggerRule[] = [];
  readonly defaults = new Map<string, DefaultTrigger[]>(); // key: connector
  readonly watches: WatchState[] = [];
  readonly watermarks: Watermark[] = [];
  readonly deliverySamples: DeliverySample[] = [];
  private readonly seenKeys = new Set<string>();

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }
  private stamp(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  // ── seeding helpers (test setup; mirror what provisioning writes into connector_triggers / delivery_health) ──
  seedDefaults(connector: Connector, defs: DefaultTrigger[]): void {
    this.defaults.set(connector, defs.map((d) => ({ ...d })));
  }
  seedDeliverySample(s: DeliverySample): void {
    // connector_delivery_health CHECK (success_rate >= 0 and success_rate <= 1) — the live insert would reject
    // an out-of-range rate; the fake must too (fake-vs-live drift). connector is the pk → upsert-by-connector.
    if (s.successRate < 0 || s.successRate > 1) {
      throw new Error(`connector_delivery_health: success_rate ${s.successRate} out of [0,1] (CHECK)`);
    }
    const i = this.deliverySamples.findIndex((x) => x.connector === s.connector);
    if (i >= 0) this.deliverySamples[i] = { ...s };
    else this.deliverySamples.push({ ...s });
  }

  async getDefaultTriggers(connector: Connector): Promise<DefaultTrigger[]> {
    return (this.defaults.get(connector) ?? []).map((d) => ({ ...d }));
  }

  async setDefaultTriggerEnabled(
    connector: Connector,
    eventName: string,
    enabled: boolean,
    actor: string,
    now: number,
  ): Promise<void> {
    const list = this.defaults.get(connector);
    const row = list?.find((d) => d.eventName === eventName);
    if (!row) {
      throw new Error(`trigger default '${eventName}' not found for connector ${connector} — cannot toggle a non-existent default`);
    }
    row.enabled = enabled;
    await this.writeAudit(
      {
        audit_type: AUDIT_TYPE_TRIGGER_CONFIG,
        actor_identity: actor,
        actor_type: 'user', // an Admin/authorized principal flips the default (RBAC-gated upstream)
        action: enabled ? 'enable' : 'disable',
        target_type: 'trigger_default',
        after_value: { connector, eventName, enabled },
        reason: `default trigger '${eventName}' → ${enabled ? 'enabled' : 'disabled'}`,
      },
      now,
    );
  }

  async saveRule(rule: Omit<TriggerRule, 'id'>, actor: string, now: number): Promise<TriggerRule> {
    // connector_triggers CHECK (kind <> 'rule' or task_name is not null): a rule MUST name a task. The live
    // insert would violate the CHECK on an empty taskName — the fake must reject it too (fake-vs-live drift).
    if (!rule.taskName || rule.taskName.trim() === '') {
      throw new Error("connector_triggers: a rule must name a task (CHECK kind<>'rule' or task_name is not null)");
    }
    const full: TriggerRule = { id: this.nextId('rule'), ...rule, conditions: rule.conditions.map((c) => ({ ...c })) };
    this.rules.push(full);
    await this.writeAudit(
      {
        audit_type: AUDIT_TYPE_TRIGGER_CONFIG,
        actor_identity: actor,
        actor_type: 'user', // an Admin/authorized principal authors the rule (RBAC-gated upstream)
        action: 'create_rule',
        target_type: 'trigger_rule',
        after_value: { id: full.id, connector: rule.connector, eventName: rule.eventName, taskName: rule.taskName, conditions: rule.conditions },
        reason: `rule '${full.id}' on ${rule.connector}/${rule.eventName} → task '${rule.taskName}' (${rule.conditions.length} condition(s))`,
      },
      now,
    );
    return { ...full, conditions: full.conditions.map((c) => ({ ...c })) };
  }

  async getRules(connector: Connector, eventName: string): Promise<TriggerRule[]> {
    return this.rules
      .filter((r) => r.connector === connector && r.eventName === eventName)
      .map((r) => ({ ...r, conditions: r.conditions.map((c) => ({ ...c })) }));
  }

  private seenKey(connector: Connector, rawEventId: string): string {
    return `${connector}::${rawEventId}`;
  }
  async seenEvent(connector: Connector, rawEventId: string): Promise<boolean> {
    return this.seenKeys.has(this.seenKey(connector, rawEventId));
  }
  async recordEvent(connector: Connector, rawEventId: string, _now: number): Promise<void> {
    this.seenKeys.add(this.seenKey(connector, rawEventId));
  }

  async getWatches(): Promise<WatchState[]> {
    return this.watches.map((w) => ({ ...w }));
  }
  async upsertWatch(w: WatchState): Promise<void> {
    // Keyed on the STABLE watch identity (connector, kind) — NOT channelId, which CHANGES on every re-arm
    // (a re-arm mints a fresh channel). Keying on channelId would leak a new row per re-arm and orphan the
    // old expiry — a #1 silent-loss/duplication bug. One watch per (connector, kind) family.
    const i = this.watches.findIndex((x) => x.connector === w.connector && x.kind === w.kind);
    if (i >= 0) this.watches[i] = { ...w };
    else this.watches.push({ ...w });
  }
  async setWatchDegraded(connector: Connector, channelId: string, degraded: boolean): Promise<void> {
    const w = this.watches.find((x) => x.connector === connector && x.channelId === channelId);
    if (!w) throw new Error(`watch ${connector}/${channelId} not found — cannot set degraded on a missing watch`);
    w.degraded = degraded;
  }

  async getWatermark(connector: Connector, channel: string): Promise<Watermark | undefined> {
    const w = this.watermarks.find((x) => x.connector === connector && x.channel === channel);
    return w ? { ...w } : undefined;
  }
  async setWatermark(connector: Connector, channel: string, position: string, now: number): Promise<void> {
    const i = this.watermarks.findIndex((x) => x.connector === connector && x.channel === channel);
    const row: Watermark = { connector, channel, position, updatedAt: now };
    if (i >= 0) this.watermarks[i] = row;
    else this.watermarks.push(row);
  }
  async getDeliverySample(connector: Connector): Promise<DeliverySample | undefined> {
    const s = this.deliverySamples.find((x) => x.connector === connector);
    return s ? { ...s } : undefined;
  }

  async logEvent(row: NewEvent, now: number): Promise<EventLogRow> {
    if (!row.summary || row.summary.trim() === '') {
      // Mirrors the schema.md event_log.summary NOT-NULL + never-empty rule (AC-7.LOG.002.2). A live
      // insert of an empty summary would violate the CHECK — the fake must reject it too (#3).
      throw new Error('event_log: summary must be non-empty (AC-7.LOG.002.2)');
    }
    if (!TRIGGER_EVENT_TYPES.includes(row.event_type)) {
      throw new Error(
        `event_log: event_type '${String(row.event_type)}' is not a trigger-slice value — the live ::event_type cast would raise (proposed-shared-spec delta)`,
      );
    }
    const full: EventLogRow = { id: this.nextId('evt'), created_at: this.stamp(now), ...row };
    this.events.push(full);
    return { ...full };
  }

  async writeAudit(row: NewAudit, now: number): Promise<AuditRow> {
    // Enforce the access_audit DDL invariants the live insert enforces (0001_baseline.sql L211): the four
    // NOT-NULL columns must be present + non-empty, and actor_type must be a member of the pg enum. The fake
    // must NEVER accept a row the live DDL would reject (the fake-vs-live drift class).
    if (!row.audit_type || row.audit_type.trim() === '') {
      throw new Error('access_audit: audit_type is NOT NULL (0001_baseline.sql L213)');
    }
    if (!row.actor_identity || row.actor_identity.trim() === '') {
      throw new Error('access_audit: actor_identity is NOT NULL (0001_baseline.sql L214)');
    }
    if (!ACTOR_TYPES.includes(row.actor_type)) {
      throw new Error(
        `access_audit: actor_type '${String(row.actor_type)}' is not a member of the actor_type enum (user|agent|system, 0001_baseline.sql L41)`,
      );
    }
    if (!row.action || row.action.trim() === '') {
      throw new Error('access_audit: action is NOT NULL (0001_baseline.sql L218)');
    }
    const full: AuditRow = { id: this.nextId('aud'), created_at: this.stamp(now), ...row };
    this.audits.push(full);
    return { ...full };
  }
}
