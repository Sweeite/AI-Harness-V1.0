// ISSUE-034 (C3 RL) — the LIVE RateLimiter adapter (pg, against the client-owned silo Supabase). The only
// module that imports `pg`. It implements the same port as InMemoryRateLimiter against the real baseline DDL
// (app/silo/migrations/0001_baseline.sql: rate_limit_tracker, idempotency_ledger).
//
// ⚠️ NOT YET RUN LIVE. The tracker source-of-truth under concurrent writers, the persisted-queue restart
// durability, the conservative-header reconciliation, and the halt-escalate INSERT landing on event_log are
// proven by the operator at the Stage-4 checkpoint (a 💻 full/live env). This adapter is authored to the DDL
// so the seam is real and typechecks; InMemoryRateLimiter is the proven reference model. Do NOT claim these
// paths verified until the live run records evidence.
//
// ── SHARED-SPEC DEPENDENCIES (applied SERIALLY by the orchestrator; see results/proposed-shared-spec.md) ──
//   (a) The 95% deferral queue is a NEW table `rate_limit_deferred` — described in the proposed-shared-spec
//       (this slice may not author a create-table migration). Until it exists, the queue methods below would
//       reject at the DB; the fake proves the CONTRACT.
//   (b) The 4 rate-limit event_type enum values (rate_limit_throttled / _paused / _backoff / _halt_escalated)
//       are NOT in the baseline `event_type` enum — an additive enum delta is described in the shared-spec.
//       Until applied, the event_log INSERT below would reject.
//
// Design notes tied to the three non-negotiables:
//   #1 the persisted queue is a TABLE (survives restart); a deferred write re-consults idempotency_ledger on
//      drain so nothing double-fires and nothing is dropped.
//   #2 a high-risk/irreversible rate-limited call HALTS + escalates — never joins the auto-retry path.
//   #3 every tier decision (throttle/pause/backoff/halt) INSERTs a loud event_log row.

import pg from 'pg';
import {
  DEFAULT_RATE_LIMIT_CONFIG,
  ERR_LIMIT_ABOVE_CAP,
  ERR_NO_TRACKER,
  isHighRisk,
  type CallContext,
  type DecideOpts,
  type DeferredCallRow,
  type DossierCap,
  type DrainOutcome,
  type EventSink,
  type IdempotencyGuard,
  type RateLimitConfig,
  type RateLimitTrackerRow,
  type RateLimiter,
  type TierDecision,
} from './store.ts';

// The baseline rate_limit_tracker stores window_duration as an `interval`; we project it to seconds on read
// (extract(epoch ...)) so the row shape matches RateLimitTrackerRow.window_duration_seconds one place.
const TRACKER_COLS = `id, connector, window_label, window_start,
  extract(epoch from window_duration)::int as window_duration_seconds,
  call_limit, calls_made, reset_at, updated_at`;

export class SupabaseRateLimiter implements RateLimiter {
  private pool: pg.Pool;

  constructor(
    connectionString: string,
    private readonly sink: EventSink,
    private readonly guard: IdempotencyGuard,
    private readonly config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
    private readonly dossierCaps: readonly DossierCap[] = [],
  ) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async ensureWindow(
    connector: string,
    windowLabel: string,
    callLimit: number,
    windowDurationSeconds: number,
    _now: number,
  ): Promise<RateLimitTrackerRow> {
    if (!Number.isInteger(callLimit) || callLimit <= 0) {
      throw new Error('rate_limit_tracker: call_limit must be a positive integer (FR-3.RL.001)');
    }
    const cap = this.dossierCaps.find((c) => c.connector === connector && c.windowLabel === windowLabel);
    if (cap && callLimit > cap.cap) {
      throw new Error(ERR_LIMIT_ABOVE_CAP(connector, windowLabel, callLimit, cap.cap));
    }
    // FR-3.RL.008: upsert on the unique(connector, window_label) key — a config change governs the NEXT call
    // (no redeploy). calls_made / window_start / reset_at are preserved on an existing row (limit change only).
    const res = await this.pool.query<RateLimitTrackerRow>(
      `insert into rate_limit_tracker
         (connector, window_label, window_start, window_duration, call_limit, calls_made, reset_at)
       values ($1, $2, now(), ($3 || ' seconds')::interval, $4, 0, now() + ($3 || ' seconds')::interval)
       on conflict (connector, window_label) do update
         set call_limit = excluded.call_limit,
             window_duration = excluded.window_duration,
             updated_at = now()
       returning ${TRACKER_COLS}`,
      [connector, windowLabel, String(windowDurationSeconds), callLimit],
    );
    return res.rows[0]!;
  }

  async getTracker(connector: string, windowLabel: string): Promise<RateLimitTrackerRow | null> {
    const res = await this.pool.query<RateLimitTrackerRow>(
      `select ${TRACKER_COLS} from rate_limit_tracker where connector = $1 and window_label = $2`,
      [connector, windowLabel],
    );
    return res.rows[0] ?? null;
  }

  async reconcileHeader(
    connector: string,
    windowLabel: string,
    vendorRemaining: number,
    _now: number,
  ): Promise<RateLimitTrackerRow> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const cur = await client.query<RateLimitTrackerRow>(
        `select ${TRACKER_COLS} from rate_limit_tracker where connector = $1 and window_label = $2 for update`,
        [connector, windowLabel],
      );
      const row = cur.rows[0];
      if (!row) throw new Error(ERR_NO_TRACKER(connector, windowLabel));
      const trackerRemaining = row.call_limit - row.calls_made;
      if (vendorRemaining < trackerRemaining) {
        // AC-3.RL.002.2: conservative value wins → bump calls_made so remaining == vendorRemaining; LOG it.
        const newCallsMade = row.call_limit - vendorRemaining;
        const upd = await client.query<RateLimitTrackerRow>(
          `update rate_limit_tracker set calls_made = $3, updated_at = now()
           where connector = $1 and window_label = $2 returning ${TRACKER_COLS}`,
          [connector, windowLabel, newCallsMade],
        );
        await this.sink.append({
          event_type: 'rate_limit_throttled',
          connector,
          window_label: windowLabel,
          summary: `Vendor header reports ${vendorRemaining} remaining < tracker's ${trackerRemaining}; reconciled conservatively (calls_made ${row.calls_made}→${newCallsMade}).`,
          payload: {
            reason: 'header_divergence',
            vendor_remaining: vendorRemaining,
            tracker_remaining_before: trackerRemaining,
            calls_made_before: row.calls_made,
            calls_made_after: newCallsMade,
          },
        });
        await client.query('commit');
        return upd.rows[0]!;
      }
      await client.query('commit');
      return row;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async decide(ctx: CallContext, now: number, opts: DecideOpts = {}): Promise<TierDecision> {
    // Atomic source-of-truth check+increment: lock the tracker row FOR UPDATE so concurrent workers can't
    // both read headroom and over-call (FR-3.RL.002 / #3). Roll the window if reset_at has passed.
    if (opts.vendorRemaining !== undefined) {
      await this.reconcileHeader(ctx.connector, ctx.windowLabel, opts.vendorRemaining, now);
    }
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const cur = await client.query<RateLimitTrackerRow>(
        `select ${TRACKER_COLS} from rate_limit_tracker where connector = $1 and window_label = $2 for update`,
        [ctx.connector, ctx.windowLabel],
      );
      let row = cur.rows[0];
      if (!row) throw new Error(ERR_NO_TRACKER(ctx.connector, ctx.windowLabel));

      // Roll the window forward if expired.
      if (now * 1000 >= Date.parse(row.reset_at)) {
        const rolled = await client.query<RateLimitTrackerRow>(
          `update rate_limit_tracker
             set window_start = now(), reset_at = now() + window_duration, calls_made = 0, updated_at = now()
           where connector = $1 and window_label = $2 returning ${TRACKER_COLS}`,
          [ctx.connector, ctx.windowLabel],
        );
        row = rolled.rows[0]!;
      }

      const highRisk = isHighRisk(ctx);
      const usageAfter = (row.calls_made + 1) / row.call_limit;
      const atCeiling = row.calls_made >= row.call_limit || usageAfter >= this.config.pauseThreshold;

      // FR-3.RL.006 — high-risk/irreversible halt-escalate (precedence; excluded from auto-retry).
      if (highRisk && (opts.is429 === true || atCeiling)) {
        await client.query('commit');
        await this.sink.append({
          event_type: 'rate_limit_halt_escalated',
          connector: ctx.connector,
          window_label: ctx.windowLabel,
          summary: `High-risk/irreversible action on '${ctx.connector}' was rate-limited — HALTED and escalated; NOT auto-retried (FR-3.RL.006).`,
          payload: {
            reason: opts.is429 ? '429' : 'ceiling',
            risk_level: ctx.riskLevel,
            irreversible: ctx.irreversible,
            urgency: ctx.urgency,
            calls_made: row.calls_made,
            call_limit: row.call_limit,
          },
        });
        return { tier: 'halt-escalate', escalationEmitted: true, row };
      }

      // FR-3.RL.005 — low-risk 429 → backoff (Retry-After exact, else exponential+jitter capped).
      if (opts.is429 === true) {
        await client.query('commit');
        const delayMs = this.backoffDelayMs(opts);
        const source = opts.retryAfterSeconds !== undefined ? 'retry-after' : 'exponential';
        await this.sink.append({
          event_type: 'rate_limit_backoff',
          connector: ctx.connector,
          window_label: ctx.windowLabel,
          summary: `429 on '${ctx.connector}' — backing off ${delayMs}ms (${source}) before retry.`,
          payload: {
            delay_ms: delayMs,
            source,
            retry_after_seconds: opts.retryAfterSeconds ?? null,
            attempt: opts.backoffAttempt ?? 0,
          },
        });
        return { tier: 'backoff', delayMs, source, row };
      }

      // FR-3.RL.004 — 95% pause + persisted enqueue (urgent proceeds within remaining headroom).
      if (usageAfter >= this.config.pauseThreshold) {
        if (ctx.urgency === 'urgent' && row.calls_made < row.call_limit) {
          const inc = await client.query<RateLimitTrackerRow>(
            `update rate_limit_tracker set calls_made = calls_made + 1, updated_at = now()
             where connector = $1 and window_label = $2 returning ${TRACKER_COLS}`,
            [ctx.connector, ctx.windowLabel],
          );
          await client.query('commit');
          return { tier: 'proceed', row: inc.rows[0]! };
        }
        // NB: an irreversible/billed write never reaches here — it halt-escalates above (FR-3.RL.006
        // precedence). Only reads + idempotent/retryable writes (carrying a key) are queued; a queued write
        // re-consults the idempotency guard on drain (FR-3.RL.004.2).
        const enq = await client.query<DeferredCallRow>(
          `insert into rate_limit_deferred
             (connector, window_label, run_after, risk_level, irreversible, urgency, idempotency_key, enqueued_at)
           values ($1, $2, $3, $4, $5, $6, $7, now())
           returning id, connector, window_label, run_after, risk_level, irreversible, urgency,
                     idempotency_key, enqueued_at, drained_at`,
          [
            ctx.connector,
            ctx.windowLabel,
            row.reset_at,
            ctx.riskLevel,
            ctx.irreversible,
            ctx.urgency,
            ctx.idempotencyKey ?? null,
          ],
        );
        await client.query('commit');
        const deferred = enq.rows[0]!;
        const pend = await this.pool.query<{ n: string }>(
          `select count(*)::text as n from rate_limit_deferred where drained_at is null`,
        );
        const queuedCount = Number(pend.rows[0]!.n);
        await this.sink.append({
          event_type: 'rate_limit_paused',
          connector: ctx.connector,
          window_label: ctx.windowLabel,
          summary: `Usage ≥95% on '${ctx.connector}' — paused a non-critical call and queued it for post-reset (${queuedCount} pending).`,
          payload: { queue_id: deferred.id, run_after: deferred.run_after, queued_count: queuedCount },
        });
        return { tier: 'queued', queueId: deferred.id, runAfter: deferred.run_after, row };
      }

      // FR-3.RL.003 — 80% throttle background; urgent proceeds.
      if (usageAfter >= this.config.alertThreshold) {
        if (ctx.urgency === 'urgent') {
          const inc = await client.query<RateLimitTrackerRow>(
            `update rate_limit_tracker set calls_made = calls_made + 1, updated_at = now()
             where connector = $1 and window_label = $2 returning ${TRACKER_COLS}`,
            [ctx.connector, ctx.windowLabel],
          );
          await client.query('commit');
          return { tier: 'throttled', deferred: false, row: inc.rows[0]! };
        }
        await client.query('commit');
        await this.sink.append({
          event_type: 'rate_limit_throttled',
          connector: ctx.connector,
          window_label: ctx.windowLabel,
          summary: `Usage ≥80% on '${ctx.connector}' — throttling a background call; urgent calls still proceed (FR-3.RL.003).`,
          payload: {
            usage_fraction: usageAfter,
            threshold: this.config.alertThreshold,
            urgency: ctx.urgency,
            deferred: true,
          },
        });
        return { tier: 'throttled', deferred: true, row };
      }

      // Below 80% — proceed, count the call.
      const inc = await client.query<RateLimitTrackerRow>(
        `update rate_limit_tracker set calls_made = calls_made + 1, updated_at = now()
         where connector = $1 and window_label = $2 returning ${TRACKER_COLS}`,
        [ctx.connector, ctx.windowLabel],
      );
      await client.query('commit');
      return { tier: 'proceed', row: inc.rows[0]! };
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  private backoffDelayMs(opts: DecideOpts): number {
    if (opts.retryAfterSeconds !== undefined) return opts.retryAfterSeconds * 1000;
    const attempt = opts.backoffAttempt ?? 0;
    const base = this.config.backoffInitialMs * Math.pow(this.config.backoffMultiplier, attempt);
    const capped = Math.min(base, this.config.backoffMaxMs);
    const jitter = opts.jitter ?? Math.random();
    const withJitter = capped + jitter * capped;
    return Math.min(Math.round(withJitter), this.config.backoffMaxMs);
  }

  async pendingDeferred(connector?: string): Promise<DeferredCallRow[]> {
    const res = connector
      ? await this.pool.query<DeferredCallRow>(
          `select id, connector, window_label, run_after, risk_level, irreversible, urgency,
                  idempotency_key, enqueued_at, drained_at
           from rate_limit_deferred where drained_at is null and connector = $1 order by enqueued_at asc`,
          [connector],
        )
      : await this.pool.query<DeferredCallRow>(
          `select id, connector, window_label, run_after, risk_level, irreversible, urgency,
                  idempotency_key, enqueued_at, drained_at
           from rate_limit_deferred where drained_at is null order by enqueued_at asc`,
        );
    return res.rows;
  }

  async drainDue(now: number): Promise<DrainOutcome[]> {
    // Claim due rows atomically (FOR UPDATE SKIP LOCKED) so concurrent drainers never double-fire a write.
    const client = await this.pool.connect();
    let due: DeferredCallRow[];
    try {
      await client.query('begin');
      const pick = await client.query<DeferredCallRow>(
        `select id, connector, window_label, run_after, risk_level, irreversible, urgency,
                idempotency_key, enqueued_at, drained_at
         from rate_limit_deferred
         where drained_at is null and run_after <= now()
         order by enqueued_at asc
         for update skip locked`,
      );
      due = pick.rows;
      // Mark them drained inside the same tx (the write re-fire itself is decided below, outside the lock).
      if (due.length > 0) {
        await client.query(
          `update rate_limit_deferred set drained_at = now() where id = any($1::uuid[])`,
          [due.map((d) => d.id)],
        );
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => {});
      client.release();
      throw err;
    }
    client.release();

    const outcomes: DrainOutcome[] = [];
    for (const d of due) {
      if (d.idempotency_key) {
        // AC-3.RL.004.2: re-consult the idempotency guard before re-firing a WRITE.
        const outcome = await this.guard.commitIntent(d.idempotency_key, d.connector, now);
        if (outcome.kind === 'suppressed') {
          outcomes.push({ kind: 'suppressed', row: { ...d, drained_at: new Date(now * 1000).toISOString() }, priorResult: outcome.result });
          continue;
        }
      }
      outcomes.push({ kind: 'fired', row: { ...d, drained_at: new Date(now * 1000).toISOString() } });
    }
    return outcomes;
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
