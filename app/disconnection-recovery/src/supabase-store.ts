// ISSUE-038 (C3 DSC) — the LIVE pg adapter (client-owned silo Supabase). The only module that imports `pg`.
// Implements the SAME DisconnectionStore port as the in-memory reference model, against the REAL DDL:
//   • connector_credentials  (0001 baseline) — marked state='degraded' on detection; read (metadata only) for health.
//   • connector_disconnection_state + connector_disconnection_paused_tasks (0034/0035) — the durable substrate.
//   • event_log / access_audit (0001) — the #3-never-silent sinks.
//
// ⚠️ NOT YET RUN LIVE (R10). Authored to the DDL so the seam is real + typechecks; the in-memory reference model is
// the proven contract. Do NOT claim these paths verified until the live-adapter smoke records evidence
// (results/live-smoke.sql, rolled back vs the silo — operator's morning pass). Silo migration head must be ≥ 0035.
//
// FAIL-SAFE, LIVE-SPECIFIC (the class the offline fake cannot see, per R10):
//   • the escalation clock reads the PERSISTED detected_at + escalation_window from the row (never re-computes from a
//     live CFG / wall clock) — extract(epoch …) → ms, then the SAME escalationDue() kernel decides. Restart-safe.
//   • detect is idempotent under a race: select the open row; if absent INSERT; a concurrent insert trips the 0035
//     partial-unique index (unique_violation) → we re-select rather than duplicating the open disconnection.
//   • NO token material is ever selected (health reads state/expires_at/scopes only — never access_token/refresh_token).

import pg from 'pg';
import {
  escalationDue,
  healthPanel,
  type ConnectorHealthInput,
  type ConnectorHealthPanel,
  type DisconnectionRecord,
  type DisconnectionScope,
  type DisconnectionSignal,
  classifyScope,
  type DisconnectionCause,
} from './classify.ts';
import {
  DEFAULT_ESCALATION_WINDOW_MS,
  ERR_NO_SUCH_DISCONNECTION,
  EVT_CONNECTOR_DISCONNECTED,
  EVT_CONNECTOR_ESCALATED,
  EVT_CONNECTOR_RECONNECTED,
  type AuditSink,
  type DisconnectionAudit,
  type DisconnectionEvent,
  type DisconnectionStore,
  type EscalationRecord,
  type EventSink,
  type PausedTaskRow,
  type ResumeAuthzCheck,
  type ResumeReport,
} from './store.ts';

/** A minimal query seam so the adapter is unit-testable against a fake connector_disconnection_state/paused_tasks
 * without a live pool (the SQL-shaping logic is proven offline; the actual DB round-trips are the R10 smoke). */
export type QueryExec = <R extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;

interface RawRecord {
  id: string;
  connector: string;
  scope: DisconnectionScope;
  affected_user_id: string | null;
  cause: string;
  status: 'open' | 'resolved' | 'escalated';
  detected_secs: string; // extract(epoch from detected_at)
  window_secs: string; // extract(epoch from escalation_window)
  deferred_secs: string | null;
  escalated_secs: string | null;
  resolved_secs: string | null;
}

function toRecord(r: RawRecord): DisconnectionRecord {
  return {
    id: r.id,
    connector: r.connector,
    scope: r.scope,
    affectedUserId: r.affected_user_id,
    cause: r.cause as DisconnectionCause,
    status: r.status,
    detectedAtMs: Math.round(Number(r.detected_secs) * 1000),
    escalationWindowMs: Math.round(Number(r.window_secs) * 1000),
    deferredAtMs: r.deferred_secs == null ? null : Math.round(Number(r.deferred_secs) * 1000),
    escalatedAtMs: r.escalated_secs == null ? null : Math.round(Number(r.escalated_secs) * 1000),
    resolvedAtMs: r.resolved_secs == null ? null : Math.round(Number(r.resolved_secs) * 1000),
  };
}

const SELECT_COLS = `id, connector, scope::text as scope, affected_user_id::text as affected_user_id, cause,
  status::text as status,
  extract(epoch from detected_at) as detected_secs,
  extract(epoch from escalation_window) as window_secs,
  extract(epoch from deferred_at) as deferred_secs,
  extract(epoch from escalated_at) as escalated_secs,
  extract(epoch from resolved_at) as resolved_secs`;

export class SupabaseDisconnectionStore implements DisconnectionStore {
  private pool: pg.Pool | null = null;
  private readonly exec: QueryExec;
  constructor(
    connectionString: string,
    private readonly sinks: { audit: AuditSink; events: EventSink },
    deps: { queryExec?: QueryExec } = {},
  ) {
    if (deps.queryExec) {
      this.exec = deps.queryExec;
    } else {
      const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
      const pool = new pg.Pool({ connectionString, ssl });
      this.pool = pool;
      this.exec = (text, params) => pool.query(text, params);
    }
  }

  private async selectOpen(connector: string, scope: DisconnectionScope, affectedUserId: string | null): Promise<DisconnectionRecord | null> {
    const res = await this.exec<RawRecord>(
      `select ${SELECT_COLS} from connector_disconnection_state
        where status = 'open' and connector = $1 and scope = $2::disconnection_scope
          and affected_user_id is not distinct from $3::uuid
        limit 1`,
      [connector, scope, affectedUserId],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async detect(sig: DisconnectionSignal, detectedAtMs: number, escalationWindowMs = DEFAULT_ESCALATION_WINDOW_MS): Promise<DisconnectionRecord> {
    const scope = classifyScope(sig);
    const affectedUserId = scope === 'individual' ? sig.affectedUserId ?? null : null;
    // Mark the SHARED connector credential degraded ONLY for a system-wide outage (metadata write only; never touches
    // token columns). An individual grant lapse must not false-degrade the shared per-connector credential for
    // everyone (there is no per-user credential row) — see the in-memory store for the same guard.
    if (scope === 'system_wide') {
      await this.exec(`update connector_credentials set state = 'degraded', updated_at = now() where connector = $1`, [sig.connector]);
    }

    const existing = await this.selectOpen(sig.connector, scope, affectedUserId);
    if (existing) return existing;

    try {
      const iso = new Date(detectedAtMs).toISOString();
      const res = await this.exec<RawRecord>(
        `insert into connector_disconnection_state (connector, scope, affected_user_id, cause, status, detected_at, escalation_window)
         values ($1, $2::disconnection_scope, $3::uuid, $4, 'open', $5::timestamptz, make_interval(secs => $6))
         returning ${SELECT_COLS}`,
        [sig.connector, scope, affectedUserId, sig.cause, iso, escalationWindowMs / 1000],
      );
      const rec = toRecord(res.rows[0]!);
      await this.sinks.events.appendEvent(
        { eventType: EVT_CONNECTOR_DISCONNECTED, summary: `connector '${sig.connector}' disconnected (${scope}, cause=${sig.cause})`, payload: { connector: sig.connector, scope, cause: sig.cause, affected_user_id: affectedUserId, disconnection_id: rec.id } },
        detectedAtMs,
      );
      return rec;
    } catch (err) {
      // a concurrent insert tripped the 0035 partial-unique index — re-select the open row (idempotent, no dup).
      if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
        const raced = await this.selectOpen(sig.connector, scope, affectedUserId);
        if (raced) return raced;
      }
      throw err;
    }
  }

  async pauseTask(disconnectionId: string, taskId: string, nowMs: number): Promise<void> {
    const iso = new Date(nowMs).toISOString();
    const res = await this.exec(
      `insert into connector_disconnection_paused_tasks (disconnection_id, task_id, paused_at)
       values ($1::uuid, $2::uuid, $3::timestamptz)
       on conflict (disconnection_id, task_id) do nothing`,
      [disconnectionId, taskId, iso],
    );
    // only audit an actual pause (not an idempotent no-op).
    if ((res.rowCount ?? 0) > 0) {
      await this.sinks.audit.appendAudit(
        { auditType: 'connector_pause', actorIdentity: 'system', action: 'pause_task', reason: `paused by disconnection ${disconnectionId}`, taskId },
        nowMs,
      );
    }
  }

  async pausedTasks(disconnectionId: string): Promise<PausedTaskRow[]> {
    const res = await this.exec<{ task_id: string; paused_secs: string; resumed_secs: string | null; resume_halted: boolean }>(
      `select task_id::text as task_id, extract(epoch from paused_at) as paused_secs,
              extract(epoch from resumed_at) as resumed_secs, resume_halted
         from connector_disconnection_paused_tasks where disconnection_id = $1::uuid order by paused_at`,
      [disconnectionId],
    );
    return res.rows.map((r) => ({
      disconnectionId,
      taskId: r.task_id,
      pausedAtMs: Math.round(Number(r.paused_secs) * 1000),
      resumedAtMs: r.resumed_secs == null ? null : Math.round(Number(r.resumed_secs) * 1000),
      resumeHalted: r.resume_halted,
    }));
  }

  async resumeOnReconnect(disconnectionId: string, recheck: ResumeAuthzCheck, nowMs: number): Promise<ResumeReport> {
    const rec = await this.get(disconnectionId);
    if (!rec) throw new Error(ERR_NO_SUCH_DISCONNECTION(disconnectionId));
    const report: ResumeReport = { disconnectionId, resumed: [], halted: [] };
    const pending = (await this.pausedTasks(disconnectionId)).filter((p) => p.resumedAtMs === null && !p.resumeHalted);
    const iso = new Date(nowMs).toISOString();

    for (const p of pending) {
      const outcome = await recheck(p.taskId);
      if (outcome.action === 'halt_and_quarantine') {
        await this.exec(`update connector_disconnection_paused_tasks set resume_halted = true where disconnection_id = $1::uuid and task_id = $2::uuid`, [disconnectionId, p.taskId]);
        report.halted.push({ taskId: p.taskId, detail: outcome.detail });
        await this.sinks.audit.appendAudit({ auditType: 'resume_halt_escalated', actorIdentity: 'system', action: 'halt_and_quarantine', reason: outcome.detail, taskId: p.taskId, connector: rec.connector }, nowMs);
        // AC-3.DSC.003.2 — halts AND escalates (loud Super-Admin escalation, not a bare log).
        await this.sinks.events.appendEvent({ eventType: EVT_CONNECTOR_ESCALATED, summary: `resume of task ${p.taskId} HALTED + escalated — authorization revoked mid-task (quarantined for review)`, payload: { kind: 'resume_halt', task_id: p.taskId, disconnection_id: disconnectionId, connector: rec.connector, detail: outcome.detail } }, nowMs);
        continue;
      }
      await this.exec(`update connector_disconnection_paused_tasks set resumed_at = $3::timestamptz where disconnection_id = $1::uuid and task_id = $2::uuid`, [disconnectionId, p.taskId, iso]);
      report.resumed.push(p.taskId);
      await this.sinks.audit.appendAudit({ auditType: 'connector_resume', actorIdentity: 'system', action: 'resume_task', reason: `auto-resumed on reconnect of ${rec.connector}`, taskId: p.taskId, connector: rec.connector }, nowMs);
    }

    await this.exec(`update connector_disconnection_state set status = 'resolved', resolved_at = $2::timestamptz, updated_at = now() where id = $1::uuid`, [disconnectionId, iso]);
    // only un-degrade the SHARED credential for a system-wide outage (individual never degraded it — see detect).
    if (rec.scope === 'system_wide') {
      await this.exec(`update connector_credentials set state = 'active', updated_at = now() where connector = $1`, [rec.connector]);
    }
    await this.sinks.events.appendEvent(
      { eventType: EVT_CONNECTOR_RECONNECTED, summary: `connector '${rec.connector}' reconnected — ${report.resumed.length} resumed, ${report.halted.length} halted+escalated`, payload: { connector: rec.connector, disconnection_id: disconnectionId, resumed: report.resumed, halted: report.halted } },
      nowMs,
    );
    return report;
  }

  async defer(disconnectionId: string, nowMs: number): Promise<void> {
    const iso = new Date(nowMs).toISOString();
    const res = await this.exec(`update connector_disconnection_state set deferred_at = $2::timestamptz, updated_at = now() where id = $1::uuid`, [disconnectionId, iso]);
    if ((res.rowCount ?? 0) === 0) throw new Error(ERR_NO_SUCH_DISCONNECTION(disconnectionId));
  }

  async escalationSweep(nowMs: number): Promise<EscalationRecord[]> {
    // Select all OPEN rows, decide with the SAME kernel as the fake (using the persisted detected_at/window), then
    // escalate. We do NOT trust a bare `now() - detected_at >= window` in SQL alone — routing the decision through
    // escalationDue() keeps the live path byte-identical to the proven offline contract (R10 fake-vs-live parity).
    const res = await this.exec<RawRecord>(`select ${SELECT_COLS} from connector_disconnection_state where status = 'open'`);
    const out: EscalationRecord[] = [];
    const iso = new Date(nowMs).toISOString();
    for (const raw of res.rows) {
      const rec = toRecord(raw);
      if (!escalationDue(rec, nowMs)) continue;
      const upd = await this.exec(
        `update connector_disconnection_state set status = 'escalated', escalated_at = $2::timestamptz, updated_at = now()
          where id = $1::uuid and status = 'open' and escalated_at is null`,
        [rec.id, iso],
      );
      if ((upd.rowCount ?? 0) === 0) continue; // another sweep won the race — not double-escalated
      out.push({ disconnectionId: rec.id, connector: rec.connector, scope: rec.scope, escalatedAtMs: nowMs });
      await this.sinks.events.appendEvent(
        { eventType: EVT_CONNECTOR_ESCALATED, summary: `connector '${rec.connector}' disconnection UNRESOLVED past ${Math.round(rec.escalationWindowMs / 3600000)}h — escalated to Super Admin`, payload: { kind: 'window_unresolved', connector: rec.connector, disconnection_id: rec.id, scope: rec.scope, detected_at_ms: rec.detectedAtMs, deferred: rec.deferredAtMs != null } },
        nowMs,
      );
    }
    return out;
  }

  async openDisconnections(): Promise<DisconnectionRecord[]> {
    const res = await this.exec<RawRecord>(`select ${SELECT_COLS} from connector_disconnection_state where status = 'open' order by detected_at`);
    return res.rows.map(toRecord);
  }

  async get(disconnectionId: string): Promise<DisconnectionRecord | null> {
    const res = await this.exec<RawRecord>(`select ${SELECT_COLS} from connector_disconnection_state where id = $1::uuid`, [disconnectionId]);
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  /**
   * FR-3.DSC.005 — assemble the health-panel rows LIVE from connector_credentials + rate_limit_tracker and run the
   * pure kernel. Reads ONLY metadata (state/expires_at) — NEVER access_token/refresh_token (#2). rate_limit_tracker
   * has one row per (connector, window_label); we pick the SMALLEST-headroom window per connector (the binding limit),
   * so the panel shows the true tightest headroom, not an arbitrary window. `lastSuccessfulCallMs` has no dedicated
   * column in the current schema → it is passed as null (the kernel warns 'no successful call recorded', never a
   * false-healthy blank); sourcing it from a per-connector last-success signal is tracked as an ISSUE-078 render
   * follow-up (OD-198-class), not silently faked here.
   */
  async healthPanelLive(nowMs: number, stalenessThresholdMs?: number): Promise<ConnectorHealthPanel[]> {
    const creds = await this.exec<{ connector: string; state: string | null; expires_secs: string | null }>(
      `select connector, state::text as state, extract(epoch from expires_at) as expires_secs from connector_credentials`,
    );
    const rates = await this.exec<{ connector: string; call_limit: number; calls_made: number; reset_secs: string }>(
      `select connector, call_limit, calls_made, extract(epoch from reset_at) as reset_secs from rate_limit_tracker`,
    );
    // pick the tightest (smallest headroom) rate window per connector.
    const tightest = new Map<string, { callLimit: number; callsMade: number; resetAtMs: number }>();
    for (const r of rates.rows) {
      const headroom = r.call_limit - r.calls_made;
      const cur = tightest.get(r.connector);
      if (!cur || headroom < cur.callLimit - cur.callsMade) tightest.set(r.connector, { callLimit: r.call_limit, callsMade: r.calls_made, resetAtMs: Math.round(Number(r.reset_secs) * 1000) });
    }
    const inputs: ConnectorHealthInput[] = creds.rows.map((c) => ({
      connector: c.connector,
      state: c.state,
      lastSuccessfulCallMs: null,
      expiresAtMs: c.expires_secs == null ? null : Math.round(Number(c.expires_secs) * 1000),
      rate: tightest.get(c.connector) ?? null,
    }));
    return healthPanel(inputs, nowMs, stalenessThresholdMs);
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}

// ── the LIVE #3-never-silent sink (event_log + access_audit). Wiring this makes the audit trail smokeable (R10). ──
// The store emits the four CANONICAL event_type values (added additively in migration 0036); this sink writes them
// straight through — an unknown event_type would throw at the DB (fail-loud), never be silently dropped. access_audit
// carries the pause/resume/halt trail (audit_type is free text). This is the class the R10 smoke exercises.
export class SupabaseDisconnectionSinks implements AuditSink, EventSink {
  private pool: pg.Pool | null = null;
  private readonly exec: QueryExec;
  /** service_role task identity recorded as the actor_type on the append-only access_audit rows. */
  constructor(connectionString: string, deps: { queryExec?: QueryExec } = {}) {
    if (deps.queryExec) {
      this.exec = deps.queryExec;
    } else {
      const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
      const pool = new pg.Pool({ connectionString, ssl });
      this.pool = pool;
      this.exec = (text, params) => pool.query(text, params);
    }
  }
  async appendEvent(row: DisconnectionEvent, nowMs: number): Promise<void> {
    await this.exec(
      `insert into event_log (event_type, entity_ids, summary, payload, created_at)
       values ($1::event_type, array[]::uuid[], $2, $3::jsonb, $4::timestamptz)`,
      [row.eventType, row.summary, JSON.stringify(row.payload), new Date(nowMs).toISOString()],
    );
  }
  async appendAudit(row: DisconnectionAudit, nowMs: number): Promise<void> {
    await this.exec(
      `insert into access_audit (audit_type, actor_identity, actor_type, action, reason, path_context, created_at)
       values ($1, $2, 'system'::actor_type, $3, $4, $5, $6::timestamptz)`,
      [row.auditType, row.actorIdentity, row.action, row.reason, row.taskId ?? row.connector ?? null, new Date(nowMs).toISOString()],
    );
  }
  async close(): Promise<void> {
    await this.pool?.end();
  }
}

export { SupabaseDisconnectionStore as default };
