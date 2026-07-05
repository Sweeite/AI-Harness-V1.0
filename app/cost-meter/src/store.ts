// ISSUE-074 — the CostMeter PORT + in-memory fake (the house port+fake pattern, cf. app/config-store,
// app/observability, app/webhook-auth). Every read of event_log/task_queue/config_values and the single write
// to notifications goes through this port so the meter logic is unit-testable with NO live DB. The in-memory
// fake is BOTH the test double AND the reference model the live pg adapter (supabase-store.ts) must match.
//
// The meter is a READER + SIGNALLER (NFR-COST.004 — C7 meters, C6 decides, C5 executes):
//   • estimate      — token→$ over a set of event_log rows × the LIVE price_table (FR-7.COST.001).
//   • aggregateByTaskType — cost grouped by task_queue.type, from the FIRST task (FR-7.COST.002).
//   • windowSpend   — the running per-deployment daily/weekly $ meter over the estimator output.
//   • evaluateAndAct — the four-rung ladder: on a soft rung WRITE the cost_threshold_breach notification;
//                      on throttle/kill EMIT the C6 breach signal (never throttle/kill here).
// Invariants enforced in the fake EXACTLY as the runtime must (so a fake test proves the live contract):
//   1. A cost_unknown event is NEVER counted as $0 — it surfaces in `unknownCount` (AC-7.LOG.004.1 / #3).
//   2. A price_table edit re-bases the NEXT estimate (LIVE, no deploy — AC-7.COST.001.1/AC-NFR-COST.005.2):
//      the fake reads the table fresh on every estimate.
//   3. The aggregation buckets an event with no resolvable task_type under UNATTRIBUTED_TASK_TYPE — never
//      drops it (a lost cost figure is #1/#3).
//   4. The ladder never skips or silences a rung, and C7 NEVER enforces (enforced_by_c7=false on every
//      signal it emits — AC-NFR-COST.004.1/.2).

import { estimate, estimateEventCents, type EstimateResult } from './estimator.ts';
import { evaluateLadder, type LadderEvaluation } from './ladder.ts';
import {
  UNATTRIBUTED_TASK_TYPE,
  COST_THRESHOLD_BREACH,
  type EventLogCostRow,
  type TaskTypeRow,
  type PriceTable,
  type CostLadderConfig,
  type NotificationInput,
  type NotificationRow,
} from './types.ts';

export interface TaskTypeCost {
  task_type: string;
  cents: number;
  unknownCount: number;
  eventCount: number;
}

export interface WindowSpend {
  dailyUsd: number;
  weeklyUsd: number;
  dailyUnknown: number; // events in the daily window whose cost was un-computable (blind-meter signal)
  weeklyUnknown: number;
}

/** The result of a metering pass: the window spend, the ladder outcome, and any notification rows written. */
export interface MeterResult {
  window: WindowSpend;
  ladder: LadderEvaluation;
  notificationsWritten: NotificationRow[];
}

// The port. Sync-modelled in the fake; async in the DB adapter.
export interface CostMeterStore {
  /** Estimate total spend over event_log rows × the LIVE price_table (read fresh each call → re-bases). */
  estimateSpend(rows: readonly EventLogCostRow[]): Promise<EstimateResult>;

  /** Per-task-type cost aggregation (FR-7.COST.002). Joins each event to task_queue.type; an event with no
   *  resolvable task_type buckets under UNATTRIBUTED_TASK_TYPE (never dropped). Groupable/queryable output. */
  aggregateByTaskType(rows: readonly EventLogCostRow[]): Promise<TaskTypeCost[]>;

  /** The running per-deployment daily + weekly $ meter as of `now` (epoch seconds), over all events in scope. */
  windowSpend(now: number): Promise<WindowSpend>;

  /** Run the ladder against the current window spend: soft rung → write a cost_threshold_breach notification;
   *  throttle/kill → emit the C6 breach signal (C7 never enforces). Returns the meter result. */
  meterAndEvaluate(now: number): Promise<MeterResult>;

  /** The notifications this meter has written (the soft-rung alerts). Read-back for assertions/surfaces. */
  notifications(): Promise<NotificationRow[]>;
}

const DAY_SECONDS = 24 * 3600;
const WEEK_SECONDS = 7 * DAY_SECONDS;

// ───────────────────────────────────────────────────────────────────────────────
// In-memory fake — the reference model. Deterministic: a logical `now` (epoch seconds) is passed in; the
// config (price_table + ladder thresholds) is a live map the test can EDIT between calls to prove re-basing.
// ───────────────────────────────────────────────────────────────────────────────
export class InMemoryCostMeterStore implements CostMeterStore {
  readonly events: EventLogCostRow[] = [];
  readonly taskTypes = new Map<string, string>(); // task_id → task_type (the task_queue join)
  private priceTable: PriceTable;
  private ladderCfg: CostLadderConfig;
  private readonly notes: NotificationRow[] = [];
  private noteSeq = 0;

  constructor(priceTable: PriceTable, ladderCfg: CostLadderConfig, seed: readonly EventLogCostRow[] = []) {
    this.priceTable = priceTable;
    this.ladderCfg = ladderCfg;
    for (const e of seed) this.events.push(e);
  }

  // ── config mutation (models a LIVE config_values edit — no deploy) ──
  /** Edit the LIVE price_table. The NEXT estimate re-bases (AC-7.COST.001.1 / AC-NFR-COST.005.2). */
  setPriceTable(pt: PriceTable): void {
    this.priceTable = pt;
  }
  /** Edit the LIVE ladder thresholds per-deployment (AC-7.COST.003.1 / AC-NFR-COST.001.1). */
  setLadderConfig(cfg: CostLadderConfig): void {
    this.ladderCfg = cfg;
  }

  // ── ingestion helpers (model event_log appends + the task_queue join; this slice READS these) ──
  addEvent(e: EventLogCostRow): void {
    this.events.push(e);
  }
  addTaskType(row: TaskTypeRow): void {
    this.taskTypes.set(row.task_id, row.task_type);
  }

  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  // ── FR-7.COST.001 — estimate over a set of rows × the LIVE table (read fresh → re-bases) ──
  async estimateSpend(rows: readonly EventLogCostRow[]): Promise<EstimateResult> {
    return estimate(rows, this.priceTable); // reads this.priceTable at call time → a prior setPriceTable re-bases
  }

  // ── FR-7.COST.002 — per-task-type aggregation (from the first task; groupable) ──
  async aggregateByTaskType(rows: readonly EventLogCostRow[]): Promise<TaskTypeCost[]> {
    const buckets = new Map<string, TaskTypeCost>();
    for (const row of rows) {
      const taskType = row.task_id !== null ? this.taskTypes.get(row.task_id) ?? UNATTRIBUTED_TASK_TYPE : UNATTRIBUTED_TASK_TYPE;
      let b = buckets.get(taskType);
      if (b === undefined) {
        b = { task_type: taskType, cents: 0, unknownCount: 0, eventCount: 0 };
        buckets.set(taskType, b);
      }
      b.eventCount += 1;
      const c = estimateEventCents(row, this.priceTable);
      if (c === null) b.unknownCount += 1; // never a silent 0 within a bucket either
      else b.cents += c;
    }
    // Deterministic order (task_type asc) so the output is stable/queryable.
    return [...buckets.values()].sort((a, b) => a.task_type.localeCompare(b.task_type));
  }

  // ── the running per-deployment daily + weekly $ meter ──
  async windowSpend(now: number): Promise<WindowSpend> {
    const dayCutoff = (now - DAY_SECONDS) * 1000;
    const weekCutoff = (now - WEEK_SECONDS) * 1000;
    const nowMs = now * 1000;
    const inWindow = (row: EventLogCostRow, cutoff: number): boolean => {
      const t = Date.parse(row.created_at);
      return t > cutoff && t <= nowMs;
    };
    const daily = this.events.filter((e) => inWindow(e, dayCutoff));
    const weekly = this.events.filter((e) => inWindow(e, weekCutoff));
    const d = estimate(daily, this.priceTable);
    const w = estimate(weekly, this.priceTable);
    return {
      dailyUsd: d.cents / 100,
      weeklyUsd: w.cents / 100,
      dailyUnknown: d.unknownCount,
      weeklyUnknown: w.unknownCount,
    };
  }

  // ── the four-rung ladder: soft → alert (write notification); throttle/kill → C6 breach signal ──
  async meterAndEvaluate(now: number): Promise<MeterResult> {
    const window = await this.windowSpend(now);
    const ladder = evaluateLadder(window.dailyUsd, window.weeklyUsd, this.ladderCfg, this.iso(now));
    const written: NotificationRow[] = [];
    for (const breach of ladder.breaches) {
      if (breach.action === 'alert') {
        // The soft rung: WRITE the cost_threshold_breach notification (FR-7.COST.004 → AC-7.COST.004.1).
        written.push(this.writeCostBreachNotification(breach.window, breach.estimated_usd, breach.threshold_usd, now));
      }
      // breach.action === 'signal' rungs (throttle/kill): C7 EMITS the signal only (already in ladder.signals);
      // C7 does NOT throttle or kill here (NFR-COST.004). No enforcement code exists in this module by design.
    }
    return { window, ladder, notificationsWritten: written };
  }

  private writeCostBreachNotification(window: 'daily' | 'weekly', estimatedUsd: number, thresholdUsd: number, now: number): NotificationRow {
    this.noteSeq += 1;
    const input: NotificationInput = {
      type: COST_THRESHOLD_BREACH,
      severity: 'warning',
      title: `Cost threshold breach (${window})`,
      body: `Estimated ${window} spend $${estimatedUsd.toFixed(2)} exceeded the $${thresholdUsd.toFixed(2)} soft alert. Estimate-grade (never the vendor invoice).`,
    };
    const row: NotificationRow = { ...input, id: `note-${String(this.noteSeq).padStart(4, '0')}`, created_at: this.iso(now) };
    this.notes.push(row);
    return row;
  }

  async notifications(): Promise<NotificationRow[]> {
    return this.notes.map((n) => ({ ...n }));
  }
}
