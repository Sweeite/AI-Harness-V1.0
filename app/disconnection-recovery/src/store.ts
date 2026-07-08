// ISSUE-038 (C3 DSC) — the disconnection-recovery store: the durable-state port, the in-memory reference model, and
// the two orchestrations the ACs turn on — resume-on-reconnect (with the FR-1.RLS.007 re-check at the consequential
// side-effect boundary) and the escalation sweep (NFR-OBS.007 escalate-don't-abandon). The live pg adapter
// (supabase-store.ts) implements the SAME port against the 0034/0035 tables.
//
// Persistence is the load-bearing property: the paused-task set (AC-3.DSC.003.3) and the escalation clock
// (AC-3.DSC.004.2) must survive a runtime restart. The in-memory fake models "durable rows" as an EXTERNAL backing
// object so a "restart" is simply a NEW store instance over the SAME backing — proving recovery without a DB.

import {
  classifyScope,
  escalationDue,
  type DisconnectionCause,
  type DisconnectionRecord,
  type DisconnectionScope,
  type DisconnectionSignal,
  type ExpiryAlert,
} from './classify.ts';

// ── CFG defaults (registered with the ISSUE-010 config store; §8 step 2). ───────────────────────────────
export const CFG_DISCONNECTION_ESCALATION_WINDOW = 'connector_disconnection_escalation_window' as const;
export const CFG_TOKEN_EXPIRY_ALERT_DAYS = 'token_expiry_alert_days' as const;
export const DEFAULT_ESCALATION_WINDOW_HOURS = 24; // FR-3.DSC.004 default 24h
export const DEFAULT_TOKEN_EXPIRY_ALERT_DAYS = 7; // FR-3.DSC.006 default 7d
export const DEFAULT_ESCALATION_WINDOW_MS = DEFAULT_ESCALATION_WINDOW_HOURS * 60 * 60 * 1000;

/** The CFG keys + defaults this slice owns, exposed so the ISSUE-010 config store can register them (§8 step 2). */
export const CONFIG_DEFAULTS: readonly (readonly [string, number])[] = [
  [CFG_DISCONNECTION_ESCALATION_WINDOW, DEFAULT_ESCALATION_WINDOW_HOURS],
  [CFG_TOKEN_EXPIRY_ALERT_DAYS, DEFAULT_TOKEN_EXPIRY_ALERT_DAYS],
] as const;

// ── the CANONICAL event_type values this slice writes to event_log (added additively in migration 0036). The store
//    emits these coarse categories; finer detail rides in the payload. The `check` gate verifies they exist in the
//    live enum so a live write never throws on an unknown event_type (the fake-passes-offline class). ─────────────
export const EVT_CONNECTOR_DISCONNECTED = 'connector_disconnected' as const;
export const EVT_CONNECTOR_RECONNECTED = 'connector_reconnected' as const;
export const EVT_CONNECTOR_ESCALATED = 'connector_escalated' as const;
export const EVT_CONNECTOR_ALERT = 'connector_alert' as const;
export const CONNECTOR_EVENT_TYPES: readonly string[] = [EVT_CONNECTOR_DISCONNECTED, EVT_CONNECTOR_RECONNECTED, EVT_CONNECTOR_ESCALATED, EVT_CONNECTOR_ALERT] as const;

// ── durable paused-task record (mirrors 0034 connector_disconnection_paused_tasks). ─────────────────────
export interface PausedTaskRow {
  disconnectionId: string;
  taskId: string;
  pausedAtMs: number;
  resumedAtMs: number | null;
  resumeHalted: boolean;
}

// ── audit + event sinks (#3 never-silent — pause/resume/escalation/alert are all recorded before anything else). ──
export interface DisconnectionAudit {
  auditType: string; // 'connector_pause' | 'connector_resume' | 'resume_halted' | ...
  actorIdentity: string;
  action: string;
  reason: string;
  taskId?: string;
  connector?: string;
}
export interface DisconnectionEvent {
  eventType: string; // 'connector_disconnected' | 'connector_reconnected' | 'connector_escalated' | 'alert_sent' | 'alert_delivery_failed'
  summary: string;
  payload: Record<string, unknown>;
}
export interface AuditSink {
  appendAudit(row: DisconnectionAudit, nowMs: number): Promise<void>;
}
export interface EventSink {
  appendEvent(row: DisconnectionEvent, nowMs: number): Promise<void>;
}

// ── FR-3.DSC.006.2 — alert delivery: an undeliverable alert is SURFACED, never silently dropped. ────────
/** Attempt to deliver an expiry alert to its owner. Returns delivered:false + a reason on failure. */
export type AlertDelivery = (alert: ExpiryAlert) => Promise<{ delivered: boolean; reason?: string }>;

/**
 * Emit an expiry alert (FR-3.DSC.006.1) and record the delivery outcome (FR-3.DSC.006.2). A resolved recipient +
 * successful delivery emits `alert_sent`; an UNRESOLVED recipient or a FAILED delivery emits `alert_delivery_failed`
 * — the failure is surfaced on the event log, never masked as "sent". Returns true iff delivered.
 */
export async function sendExpiryAlert(events: EventSink, alert: ExpiryAlert, deliver: AlertDelivery, nowMs: number): Promise<boolean> {
  if (alert.unresolvedRecipient) {
    await events.appendEvent(
      { eventType: EVT_CONNECTOR_ALERT, summary: `expiry alert for '${alert.connector}' has no resolved recipient — surfaced, not dropped`, payload: { outcome: 'unresolved_recipient', connector: alert.connector, days_left: alert.daysLeft } },
      nowMs,
    );
    return false;
  }
  const outcome = await deliver(alert);
  if (outcome.delivered) {
    await events.appendEvent(
      { eventType: EVT_CONNECTOR_ALERT, summary: `expiry alert for '${alert.connector}' sent to ${alert.recipientId} (${alert.daysLeft}d left)`, payload: { outcome: 'sent', connector: alert.connector, recipient_id: alert.recipientId, days_left: alert.daysLeft } },
      nowMs,
    );
    return true;
  }
  await events.appendEvent(
    { eventType: EVT_CONNECTOR_ALERT, summary: `expiry alert for '${alert.connector}' FAILED delivery — surfaced (${outcome.reason ?? 'unknown'})`, payload: { outcome: 'delivery_failed', connector: alert.connector, recipient_id: alert.recipientId, reason: outcome.reason ?? 'unknown' } },
    nowMs,
  );
  return false;
}

/** Collects audit + event rows in memory for tests / a reference deployment. */
export class InMemorySinks implements AuditSink, EventSink {
  readonly audits: (DisconnectionAudit & { atMs: number })[] = [];
  readonly events: (DisconnectionEvent & { atMs: number })[] = [];
  async appendAudit(row: DisconnectionAudit, nowMs: number): Promise<void> {
    this.audits.push({ ...row, atMs: nowMs });
  }
  async appendEvent(row: DisconnectionEvent, nowMs: number): Promise<void> {
    this.events.push({ ...row, atMs: nowMs });
  }
}

// ── the resume-time authorization re-check seam (FR-1.RLS.007, consumed from @harness/rls-enforcement). ──
// This slice does NOT author the RLS re-check — it CALLS it at the resume side-effect boundary. The seam is injected
// so the package is unit-testable and does not hard-depend on rls-enforcement's pool. The real wiring passes
// rls-enforcement's guardBoundary; a task whose relied-on authz was revoked returns 'halt_and_quarantine'.
export type ResumeAuthzOutcome = { action: 'proceed' | 'halt_and_quarantine'; detail: string };
export type ResumeAuthzCheck = (taskId: string) => Promise<ResumeAuthzOutcome>;

/** A default re-check for tasks whose next step is NOT a consequential side effect (or when no authz context is
 * threaded): proceed. The real caller supplies a check that binds the originating user + relied-on grants. */
export const alwaysProceed: ResumeAuthzCheck = async () => ({ action: 'proceed', detail: 'no consequential boundary' });

export interface ResumeReport {
  disconnectionId: string;
  resumed: string[]; // task ids auto-resumed
  halted: { taskId: string; detail: string }[]; // task ids halted-and-escalated at the re-check (revoked authz)
}

export interface EscalationRecord {
  disconnectionId: string;
  connector: string;
  scope: DisconnectionScope;
  escalatedAtMs: number;
}

// ── the port. ───────────────────────────────────────────────────────────────────────────────────────────
export interface DisconnectionStore {
  /** FR-3.DSC.001 — mark the connector degraded + persist an OPEN disconnection record (idempotent: re-detecting an
   * already-open outage returns the existing record, never a second row). Classifies system-wide vs individual. */
  detect(sig: DisconnectionSignal, detectedAtMs: number, escalationWindowMs?: number): Promise<DisconnectionRecord>;

  /** FR-3.DSC.003.3 — persist a task into a disconnection's paused set (idempotent). */
  pauseTask(disconnectionId: string, taskId: string, nowMs: number): Promise<void>;

  /** The persisted paused set for a disconnection (recovered across restart). */
  pausedTasks(disconnectionId: string): Promise<PausedTaskRow[]>;

  /** FR-3.DSC.003.1/.2 — on reconnect, auto-resume every not-yet-resumed paused task, re-checking authorization at
   * the consequential boundary FIRST; a revoked authz halts-and-escalates (does NOT act). Writes pause/resume audit.
   * Closes the disconnection (resolved) once processed. */
  resumeOnReconnect(disconnectionId: string, recheck: ResumeAuthzCheck, nowMs: number): Promise<ResumeReport>;

  /** FR-3.DSC.002 — record an admin deferral of the modal. Recorded, but does NOT stop the escalation clock. */
  defer(disconnectionId: string, nowMs: number): Promise<void>;

  /** FR-3.DSC.004.1 / NFR-OBS.007 — escalate every OPEN disconnection past its (persisted) window to Super Admin.
   * Persists escalated_at + emits a loud event; never auto-clears. Idempotent (an already-escalated one is skipped). */
  escalationSweep(nowMs: number): Promise<EscalationRecord[]>;

  /** Open disconnections (for surfacing). */
  openDisconnections(): Promise<DisconnectionRecord[]>;

  /** A single record by id (null if absent). */
  get(disconnectionId: string): Promise<DisconnectionRecord | null>;
}

// ── the durable backing (what a real DB row set looks like; the fake persists here so a "restart" re-reads it). ──
export interface DisconnectionBacking {
  records: DisconnectionRecord[];
  paused: PausedTaskRow[];
  /** connector → the degraded flag the detection sets (mirrors connector_credentials.state='degraded'). */
  degraded: Set<string>;
  seq: number;
}
export function newBacking(): DisconnectionBacking {
  return { records: [], paused: [], degraded: new Set(), seq: 0 };
}

export const ERR_NO_SUCH_DISCONNECTION = (id: string) => `disconnection-recovery: no disconnection record '${id}'`;

// ── the in-memory reference model. ──────────────────────────────────────────────────────────────────────
export class InMemoryDisconnectionStore implements DisconnectionStore {
  constructor(
    private readonly backing: DisconnectionBacking,
    private readonly sinks: { audit: AuditSink; events: EventSink },
  ) {}

  private nextId(prefix: string): string {
    this.backing.seq += 1;
    return `${prefix}-${String(this.backing.seq).padStart(4, '0')}`;
  }

  async detect(sig: DisconnectionSignal, detectedAtMs: number, escalationWindowMs = DEFAULT_ESCALATION_WINDOW_MS): Promise<DisconnectionRecord> {
    const scope = classifyScope(sig);
    const affectedUserId = scope === 'individual' ? sig.affectedUserId ?? null : null;
    // idempotent: an already-open record for this (connector, scope, affected user) is returned, not duplicated.
    const existing = this.backing.records.find(
      (r) => r.status === 'open' && r.connector === sig.connector && r.scope === scope && r.affectedUserId === affectedUserId,
    );
    // Mark the SHARED connector credential degraded ONLY for a system-wide outage. An individual grant lapse must NOT
    // flip the shared per-connector credential (there is no per-user credential row) — doing so would false-degrade
    // the whole connector's health for every other user over one person's problem (contradicting the classification).
    if (scope === 'system_wide') this.backing.degraded.add(sig.connector);
    if (existing) return { ...existing };

    const rec: DisconnectionRecord = {
      id: this.nextId('dsc'),
      connector: sig.connector,
      scope,
      affectedUserId,
      cause: sig.cause as DisconnectionCause,
      status: 'open',
      detectedAtMs,
      escalationWindowMs,
      deferredAtMs: null,
      escalatedAtMs: null,
      resolvedAtMs: null,
    };
    this.backing.records.push(rec);
    await this.sinks.events.appendEvent(
      {
        eventType: EVT_CONNECTOR_DISCONNECTED,
        summary: `connector '${sig.connector}' disconnected (${scope}, cause=${sig.cause})`,
        payload: { connector: sig.connector, scope, cause: sig.cause, affected_user_id: affectedUserId, disconnection_id: rec.id },
      },
      detectedAtMs,
    );
    return { ...rec };
  }

  async pauseTask(disconnectionId: string, taskId: string, nowMs: number): Promise<void> {
    const rec = this.backing.records.find((r) => r.id === disconnectionId);
    if (!rec) throw new Error(ERR_NO_SUCH_DISCONNECTION(disconnectionId));
    const already = this.backing.paused.find((p) => p.disconnectionId === disconnectionId && p.taskId === taskId);
    if (already) return; // idempotent
    this.backing.paused.push({ disconnectionId, taskId, pausedAtMs: nowMs, resumedAtMs: null, resumeHalted: false });
    await this.sinks.audit.appendAudit(
      { auditType: 'connector_pause', actorIdentity: 'system', action: 'pause_task', reason: `paused by disconnection ${disconnectionId}`, taskId, connector: rec.connector },
      nowMs,
    );
  }

  async pausedTasks(disconnectionId: string): Promise<PausedTaskRow[]> {
    return this.backing.paused.filter((p) => p.disconnectionId === disconnectionId).map((p) => ({ ...p }));
  }

  async resumeOnReconnect(disconnectionId: string, recheck: ResumeAuthzCheck, nowMs: number): Promise<ResumeReport> {
    const rec = this.backing.records.find((r) => r.id === disconnectionId);
    if (!rec) throw new Error(ERR_NO_SUCH_DISCONNECTION(disconnectionId));
    const report: ResumeReport = { disconnectionId, resumed: [], halted: [] };

    for (const p of this.backing.paused.filter((p) => p.disconnectionId === disconnectionId && p.resumedAtMs === null && !p.resumeHalted)) {
      // FR-3.DSC.003.2 — re-check authorization at the consequential side-effect boundary BEFORE acting. A revoked
      // authz halts-and-escalates rather than resuming (the ADR-006 containment point).
      const outcome = await recheck(p.taskId);
      if (outcome.action === 'halt_and_quarantine') {
        p.resumeHalted = true;
        report.halted.push({ taskId: p.taskId, detail: outcome.detail });
        await this.sinks.audit.appendAudit(
          { auditType: 'resume_halt_escalated', actorIdentity: 'system', action: 'halt_and_quarantine', reason: outcome.detail, taskId: p.taskId, connector: rec.connector },
          nowMs,
        );
        // AC-3.DSC.003.2 — the revoked task halts AND ESCALATES (does not merely log): raise a loud Super-Admin
        // escalation for the quarantined task. The paused-task row's resume_halted=true is its durable review marker.
        await this.sinks.events.appendEvent(
          {
            eventType: EVT_CONNECTOR_ESCALATED,
            summary: `resume of task ${p.taskId} HALTED + escalated — authorization revoked mid-task (quarantined for review)`,
            payload: { kind: 'resume_halt', task_id: p.taskId, disconnection_id: disconnectionId, connector: rec.connector, detail: outcome.detail },
          },
          nowMs,
        );
        continue;
      }
      p.resumedAtMs = nowMs;
      report.resumed.push(p.taskId);
      await this.sinks.audit.appendAudit(
        { auditType: 'connector_resume', actorIdentity: 'system', action: 'resume_task', reason: `auto-resumed on reconnect of ${rec.connector}`, taskId: p.taskId, connector: rec.connector },
        nowMs,
      );
    }

    // reconnect closes the disconnection (resolved). The shared connector credential is only un-degraded for a
    // system-wide outage (individual lapses never degraded it — see detect). Halted tasks remain quarantined
    // (resume_halted=true) with their own escalation raised above; the reconnect event reports the halted set.
    rec.status = 'resolved';
    rec.resolvedAtMs = nowMs;
    if (rec.scope === 'system_wide') this.backing.degraded.delete(rec.connector);
    await this.sinks.events.appendEvent(
      {
        eventType: EVT_CONNECTOR_RECONNECTED,
        summary: `connector '${rec.connector}' reconnected — ${report.resumed.length} task(s) resumed, ${report.halted.length} halted+escalated`,
        payload: { connector: rec.connector, disconnection_id: disconnectionId, resumed: report.resumed, halted: report.halted },
      },
      nowMs,
    );
    return report;
  }

  async defer(disconnectionId: string, nowMs: number): Promise<void> {
    const rec = this.backing.records.find((r) => r.id === disconnectionId);
    if (!rec) throw new Error(ERR_NO_SUCH_DISCONNECTION(disconnectionId));
    rec.deferredAtMs = nowMs; // recorded; escalationDue() ignores it — the clock keeps running.
  }

  async escalationSweep(nowMs: number): Promise<EscalationRecord[]> {
    const out: EscalationRecord[] = [];
    for (const rec of this.backing.records) {
      if (!escalationDue(rec, nowMs)) continue;
      rec.status = 'escalated';
      rec.escalatedAtMs = nowMs;
      out.push({ disconnectionId: rec.id, connector: rec.connector, scope: rec.scope, escalatedAtMs: nowMs });
      await this.sinks.events.appendEvent(
        {
          eventType: EVT_CONNECTOR_ESCALATED,
          summary: `connector '${rec.connector}' disconnection UNRESOLVED past ${Math.round(rec.escalationWindowMs / 3600000)}h — escalated to Super Admin`,
          payload: { kind: 'window_unresolved', connector: rec.connector, disconnection_id: rec.id, scope: rec.scope, detected_at_ms: rec.detectedAtMs, deferred: rec.deferredAtMs != null },
        },
        nowMs,
      );
    }
    return out;
  }

  async openDisconnections(): Promise<DisconnectionRecord[]> {
    return this.backing.records.filter((r) => r.status === 'open').map((r) => ({ ...r }));
  }

  async get(disconnectionId: string): Promise<DisconnectionRecord | null> {
    const rec = this.backing.records.find((r) => r.id === disconnectionId);
    return rec ? { ...rec } : null;
  }
}
