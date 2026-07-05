// ISSUE-074 — the LIVE CostMeter adapter (pg, against the client-owned silo Supabase). The only module that
// imports `pg`. It implements the same port as InMemoryCostMeterStore against the real DDL:
//   • event_log  (schema.md §8) — reads cost_tokens / cost_unknown / task_id / payload->>'model' / created_at.
//   • task_queue (schema.md §6) — left-outer join on task_id for `type` (the per-task-type aggregation).
//   • config_values (schema.md §12) — reads price_table + the cost_ladder_* keys (owned by ISSUE-010).
//   • notifications (schema.md §8) — writes ONE cost_threshold_breach row on a soft-rung breach.
//
// ⚠️ NOT YET RUN LIVE. This adapter is authored to the DDL so the seam is real and typechecks; the proven
// reference model is InMemoryCostMeterStore. The live proof (a real event_log spend series crossing each rung,
// the price_table re-base, the notification row) is owed to the ISSUE-074 Stage-3 checkpoint (results/
// issue-074-live-proof.md). Do NOT claim these paths verified until that evidence is recorded.
//
// Design notes tied to the three non-negotiables:
//   - cost_unknown is NEVER folded into 0: the estimator (shared pure code) surfaces it as unknownCount; this
//     adapter reads the sentinel column faithfully so a blind meter is detectable (#3).
//   - price_table is read from config_values on EVERY metering pass, so an operator edit re-bases with no
//     deploy (AC-7.COST.001.1 / AC-NFR-COST.005.2) — nothing is cached across the process.
//   - C7 NEVER throttles or kills: this adapter writes a notification (soft) and returns the C6 breach signal
//     (throttle/kill). There is deliberately no UPDATE to task_queue / no kill path here (NFR-COST.004).

import pg from 'pg';
import { estimate } from './estimator.ts';
import { evaluateLadder } from './ladder.ts';
import {
  UNATTRIBUTED_TASK_TYPE,
  COST_THRESHOLD_BREACH,
  LADDER_DEFAULTS,
  type EventLogCostRow,
  type PriceTable,
  type CostLadderConfig,
  type NotificationRow,
} from './types.ts';
import type { CostMeterStore, MeterResult, TaskTypeCost, WindowSpend } from './store.ts';
import type { EstimateResult } from './estimator.ts';

const DAY_SECONDS = 24 * 3600;
const WEEK_SECONDS = 7 * DAY_SECONDS;

export class SupabaseCostMeterStore implements CostMeterStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  /** Read the LIVE price_table from config_values (re-based on every call — no deploy, no cache). */
  private async readPriceTable(): Promise<PriceTable> {
    const res = await this.pool.query<{ value: PriceTable }>(
      `select value from config_values where key = 'price_table'`,
    );
    // A missing price_table means the meter cannot price anything — return an empty table so EVERY event reads
    // cost_unknown (a blind meter, surfaced), never a silent 0 (#3).
    return res.rows[0]?.value ?? {};
  }

  /** Read the four LIVE cost_ladder_* thresholds; fall back to the ADR-003 defaults for any absent key. */
  private async readLadderConfig(): Promise<CostLadderConfig> {
    const res = await this.pool.query<{ key: string; value: number }>(
      `select key, value::text::numeric as value from config_values
       where key in (
         'cost_ladder_soft_threshold_daily_usd',
         'cost_ladder_soft_threshold_weekly_usd',
         'cost_ladder_throttle_threshold',
         'cost_ladder_hard_kill_threshold'
       )`,
    );
    const cfg: CostLadderConfig = { ...LADDER_DEFAULTS };
    const mutable = cfg as unknown as Record<string, number>;
    for (const r of res.rows) {
      if (r.key in cfg) mutable[r.key] = Number(r.value);
    }
    return cfg;
  }

  /** Read event_log cost rows in a time window (exclusive lower, inclusive upper). */
  private async readEvents(fromIso: string, toIso: string): Promise<EventLogCostRow[]> {
    const res = await this.pool.query<EventLogCostRow>(
      `select id,
              task_id,
              event_type,
              cost_tokens,
              cost_unknown,
              payload->>'model' as model,
              created_at
       from event_log
       where created_at > $1 and created_at <= $2
       order by created_at asc, id asc`,
      [fromIso, toIso],
    );
    return res.rows.map((r) => ({
      ...r,
      // pg returns bigint as string; normalise to number|null (estimate-grade counts fit in a double).
      cost_tokens: r.cost_tokens === null ? null : Number(r.cost_tokens),
    }));
  }

  async estimateSpend(rows: readonly EventLogCostRow[]): Promise<EstimateResult> {
    const priceTable = await this.readPriceTable();
    return estimate(rows, priceTable);
  }

  async aggregateByTaskType(rows: readonly EventLogCostRow[]): Promise<TaskTypeCost[]> {
    const priceTable = await this.readPriceTable();
    // Resolve task_type for the rows' task_ids in one round-trip (the task_queue join).
    const ids = [...new Set(rows.map((r) => r.task_id).filter((x): x is string => x !== null))];
    const typeById = new Map<string, string>();
    if (ids.length > 0) {
      const res = await this.pool.query<{ id: string; type: string }>(
        `select id::text as id, type::text as type from task_queue where id = any($1::uuid[])`,
        [ids],
      );
      for (const r of res.rows) typeById.set(r.id, r.type);
    }
    const buckets = new Map<string, TaskTypeCost>();
    const { estimateEventCents } = await import('./estimator.ts');
    for (const row of rows) {
      const taskType = row.task_id !== null ? typeById.get(row.task_id) ?? UNATTRIBUTED_TASK_TYPE : UNATTRIBUTED_TASK_TYPE;
      let b = buckets.get(taskType);
      if (b === undefined) {
        b = { task_type: taskType, cents: 0, unknownCount: 0, eventCount: 0 };
        buckets.set(taskType, b);
      }
      b.eventCount += 1;
      const c = estimateEventCents(row, priceTable);
      if (c === null) b.unknownCount += 1;
      else b.cents += c;
    }
    return [...buckets.values()].sort((a, b) => a.task_type.localeCompare(b.task_type));
  }

  async windowSpend(now: number): Promise<WindowSpend> {
    const priceTable = await this.readPriceTable();
    const nowIso = new Date(now * 1000).toISOString();
    const dayIso = new Date((now - DAY_SECONDS) * 1000).toISOString();
    const weekIso = new Date((now - WEEK_SECONDS) * 1000).toISOString();
    const [daily, weekly] = await Promise.all([this.readEvents(dayIso, nowIso), this.readEvents(weekIso, nowIso)]);
    const d = estimate(daily, priceTable);
    const w = estimate(weekly, priceTable);
    return { dailyUsd: d.cents / 100, weeklyUsd: w.cents / 100, dailyUnknown: d.unknownCount, weeklyUnknown: w.unknownCount };
  }

  async meterAndEvaluate(now: number): Promise<MeterResult> {
    const cfg = await this.readLadderConfig();
    const window = await this.windowSpend(now);
    const nowIso = new Date(now * 1000).toISOString();
    const ladder = evaluateLadder(window.dailyUsd, window.weeklyUsd, cfg, nowIso);
    const written: NotificationRow[] = [];
    for (const breach of ladder.breaches) {
      if (breach.action === 'alert') {
        written.push(await this.writeCostBreachNotification(breach.window, breach.estimated_usd, breach.threshold_usd));
      }
      // throttle/kill: C7 only EMITS ladder.signals (enforced_by_c7=false); no task_queue mutation here.
    }
    return { window, ladder, notificationsWritten: written };
  }

  private async writeCostBreachNotification(window: 'daily' | 'weekly', estimatedUsd: number, thresholdUsd: number): Promise<NotificationRow> {
    const title = `Cost threshold breach (${window})`;
    const body = `Estimated ${window} spend $${estimatedUsd.toFixed(2)} exceeded the $${thresholdUsd.toFixed(2)} soft alert. Estimate-grade (never the vendor invoice).`;
    const res = await this.pool.query<NotificationRow>(
      `insert into notifications (type, severity, title, body)
       values ($1, 'warning', $2, $3)
       returning id::text as id, type, severity, title, body, created_at`,
      [COST_THRESHOLD_BREACH, title, body],
    );
    return res.rows[0]!;
  }

  async notifications(): Promise<NotificationRow[]> {
    const res = await this.pool.query<NotificationRow>(
      `select id::text as id, type, severity, title, body, created_at
       from notifications where type = $1 order by created_at asc`,
      [COST_THRESHOLD_BREACH],
    );
    return res.rows;
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
