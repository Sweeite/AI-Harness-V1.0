// ISSUE-047 — the C5 TRG dispatch logic: the freeze gate + the four trigger types + the verified-webhook
// ingress consumer + the at-least-once enqueue + the chained-trigger handoff. Every function that would
// DISPATCH (create a task, run a queued task, create a chained successor) routes through `assertNotFrozen`
// FIRST — that single choke point is exactly the AF-135 completeness claim (no dispatch path slips the gate).

import {
  type TriggerStore,
  type TaskRow,
  type TaskType,
  type VerifiedEvent,
  TriggerError,
  ERR_FROZEN,
  ERR_UNVERIFIED,
  ERR_INGEST_FAILURE,
  isTaskType,
} from './store.ts';
import { TriggerRegistry } from './registry.ts';

// Proposed additive event_type values (results/ schema delta; same change-control class as OD-170/OD-179).
// The C7 enum admits neither today — recorded as a shared-spec proposal, NOT edited into schema.md here.
export const EVT_FROZEN_BLOCKED = 'dispatch_frozen_blocked';
export const EVT_INGEST_FAILURE = 'ingest_failure';
// logic-sweep fix (triggers.ts:177): a POST-commit watermark-write failure is NOT an ingest failure (a row DID
// commit) — it is a distinct condition (a committed row left un-acknowledged => a controlled at-least-once
// duplicate on re-delivery). Recorded distinctly so the C7 event_log never lies "produced no task row" (#3).
export const EVT_WATERMARK_FAILURE = 'watermark_failure';

/** The reason a dispatch was allowed/blocked by the freeze gate. */
export type FreezeVerdict =
  | { frozen: false }
  | { frozen: true; reason: 'frozen_at_set' | 'settings_unresolvable'; frozen_at: string | null };

/**
 * THE freeze gate (FR-5.TRG.001 AC-5.TRG.001.3 + NFR-INF.012 AC-NFR-INF.012.1/.2). A LOCAL read of
 * deployment_settings.frozen_at (OD-162 — this client's own Supabase, no cross-deployment query). It FAILS
 * CLOSED two ways:
 *   (a) frozen_at is non-null  => frozen               (AC-NFR-INF.012.1)
 *   (b) the settings read is UNRESOLVABLE (throws)     => treated as frozen (AC-NFR-INF.012.2 — status
 *       ambiguity resolves to blocked, never to "assume open").
 * It is a read only — it never mutates. The caller (assertNotFrozen) is what blocks + logs.
 */
export async function evaluateFreeze(store: TriggerStore): Promise<FreezeVerdict> {
  let row;
  try {
    row = await store.readDeploymentSettings();
  } catch {
    // Ambiguity is not "probably fine" — a freeze we cannot confirm-absent is treated AS a freeze (#2/#3).
    return { frozen: true, reason: 'settings_unresolvable', frozen_at: null };
  }
  if (row.frozen_at !== null) {
    return { frozen: true, reason: 'frozen_at_set', frozen_at: row.frozen_at };
  }
  return { frozen: false };
}

/**
 * The dispatch-boundary guard every path calls FIRST. On a freeze it (1) creates/runs nothing, writes no new
 * data beyond the log, (2) logs the block to event_log (loud, never silent — #3), and (3) throws so the
 * caller cannot proceed. `pathLabel` names the dispatch path so the SPIKE can assert per-path coverage.
 */
export async function assertNotFrozen(
  store: TriggerStore,
  pathLabel: 'event' | 'scheduled' | 'human' | 'chained' | 'queue_dispatch',
  ctx: { task_id?: string | null; trigger_key?: string } = {},
): Promise<void> {
  const verdict = await evaluateFreeze(store);
  if (verdict.frozen) {
    await store.appendEvent({
      event_type: EVT_FROZEN_BLOCKED,
      task_id: ctx.task_id ?? null,
      summary: `Dispatch blocked by deployment freeze on the '${pathLabel}' path (${verdict.reason}).`,
      payload: {
        path: pathLabel,
        reason: verdict.reason,
        frozen_at: verdict.frozen_at,
        trigger_key: ctx.trigger_key ?? null,
      },
    });
    throw new TriggerError(ERR_FROZEN, `deployment is frozen — '${pathLabel}' dispatch blocked (${verdict.reason})`);
  }
}

// ── Trigger-type write path (FR-5.TRG.001 / AC-5.TRG.001.1-.2) ──────────────────────────────────────

export interface FireArgs {
  type: TaskType;
  task_name: string;
  payload: Record<string, unknown>;
  originating_user_id?: string | null;
  /** For a registry-defined trigger (event/scheduled), the config key — checked for enablement. */
  trigger_key?: string;
  registry?: TriggerRegistry;
}

/**
 * Create exactly one task_queue row for a firing trigger, stamping `type` + `payload` (AC-5.TRG.001.2). The
 * freeze gate is checked FIRST (AC-5.TRG.001.3). If a registry + trigger_key are supplied, a disabled/unknown
 * trigger creates NO task (AC-5.TRG.002.1). Rejects any non-enum type (AC-5.TRG.001.1).
 */
export async function fireTrigger(store: TriggerStore, args: FireArgs): Promise<TaskRow> {
  if (!isTaskType(args.type)) {
    throw new TriggerError('bad_task_type', `trigger type '${args.type}' is not one of scheduled|event|human|chained`);
  }
  // Registry gate (config-defined enablement) — a disabled/unknown trigger is inert.
  if (args.registry && args.trigger_key !== undefined && !args.registry.isActive(args.trigger_key)) {
    throw new TriggerError('trigger_disabled', `trigger '${args.trigger_key}' is not active (disabled or unknown)`);
  }
  // FREEZE GATE — before creating anything.
  const path = args.type === 'chained' ? 'chained' : args.type;
  await assertNotFrozen(store, path, { trigger_key: args.trigger_key });

  return store.insertTask({
    type: args.type,
    task_name: args.task_name,
    payload: args.payload,
    originating_user_id: args.originating_user_id ?? null,
    parent_task_id: null,
  });
}

// ── Queue-dispatch gate (a queued task dispatched to RUN — AC-5.TRG.001.3 "or the harness would dispatch a
//    queued task to run") ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatch an already-queued task to run. This is NOT a trigger firing — it's the run edge — but the freeze
 * amendment blocks it too ("no agent/loop runs"). Returns true if the task may run; throws (fails closed) if
 * frozen. The actual run is ISSUE-048/engine; this is only the gate.
 */
export async function dispatchQueuedTask(store: TriggerStore, taskId: string): Promise<boolean> {
  await assertNotFrozen(store, 'queue_dispatch', { task_id: taskId });
  return true;
}

// ── Verified-webhook ingress consumer + at-least-once enqueue (FR-5.TRG.003/005) ────────────────────

export interface IngestResult {
  ok: boolean;
  task?: TaskRow;
  /** Set when a verified event was NOT converted to a row: the ingest-failure was recorded + surfaced, and
   *  the event was NOT acknowledged (AC-5.TRG.005.1) — a re-delivery will retry. */
  ingest_failure?: boolean;
  /** logic-sweep fix (triggers.ts:177): set when the task row DID commit but the post-commit delivery watermark
   *  write failed. The committed row is kept (task is present), the failure is recorded distinctly, and the
   *  delivery is left un-acknowledged — a re-delivery is a CONTROLLED at-least-once duplicate, not a lost event. */
  watermark_failed?: boolean;
  /** Set when a re-delivered event was de-duplicated by the watermark (AC-5.TRG.005.2). */
  deduped?: boolean;
}

/**
 * Consume a verified event at the C3→C5 ingress seam and enqueue it at-least-once (FR-5.TRG.003 + FR-5.TRG.005).
 *   - It NEVER re-verifies: an unverified event is rejected here as a defence-in-depth stop (C0/C3 already
 *     rejected the real ones — AC-5.TRG.003.1); no task is created.
 *   - The freeze gate is checked FIRST (a verified event during a freeze creates nothing).
 *   - De-dup: a delivery_id already watermarked returns {deduped:true}, no second row (AC-5.TRG.005.2).
 *   - At-least-once: insert THEN watermark. If the insert throws, the watermark is NOT set (so the event is
 *     not acknowledged) AND a loud ingest-failure event is recorded (AC-5.TRG.005.1) — never a silent no-op.
 */
export async function ingestVerifiedEvent(store: TriggerStore, evt: VerifiedEvent): Promise<IngestResult> {
  if (!evt.verified) {
    // Defence-in-depth: the harness accepts a trigger ONLY from an already-verified webhook (FR-5.TRG.003).
    throw new TriggerError(ERR_UNVERIFIED, `event ${evt.delivery_id} is not verified — rejected at the C5 ingress seam`);
  }

  // De-dup on re-delivery (FR-5.GRP.003 seam) — before the freeze gate so a replay during a freeze that was
  // already delivered pre-freeze is a no-op, not a spurious block.
  if (await store.isDelivered(evt.delivery_id)) {
    return { ok: true, deduped: true };
  }

  // FREEZE GATE — a verified event during a freeze is blocked + logged, creates no row.
  await assertNotFrozen(store, 'event', { trigger_key: evt.delivery_id });

  // logic-sweep fix (triggers.ts:177): insert (pre-commit) and markDelivered (post-commit watermark) are two
  // INDEPENDENT, non-atomic writes to two tables — they must NOT share one catch. A pre-commit insert failure
  // means no row was produced (EVT_INGEST_FAILURE); a POST-commit watermark failure means a row DID commit and
  // must never be reported as "produced no task row" (that would be a lying event_log — #3). We therefore run
  // the insert in its own try, then the watermark in a SEPARATE try.
  let task: TaskRow;
  try {
    task = await store.insertTask({
      type: 'event',
      task_name: evt.task_name,
      payload: evt.payload,
      originating_user_id: null,
      parent_task_id: null,
    });
  } catch (e) {
    // AC-5.TRG.005.1 — a verified event that produced NO row is a recorded + surfaced ingest-failure, and is
    // NOT acknowledged (no watermark), so no verified event is silently lost. Re-throw class stays loud.
    await store.appendEvent({
      event_type: EVT_INGEST_FAILURE,
      task_id: null,
      summary: `Verified event ${evt.delivery_id} produced no task row — ingest failed, not acknowledged.`,
      payload: { delivery_id: evt.delivery_id, error: e instanceof Error ? e.message : String(e) },
    });
    return { ok: false, ingest_failure: true };
  }

  // Watermark ONLY after a committed row — accept→row is at-least-once (AC-5.TRG.005.2).
  try {
    await store.markDelivered(evt.delivery_id, task.id);
  } catch (e) {
    // logic-sweep fix (triggers.ts:177): the row IS committed but the watermark write failed. Record this as a
    // DISTINCT condition (NOT "produced no task row") and leave the delivery un-acknowledged. On re-delivery the
    // dedup (isDelivered) misses, so the event is re-inserted — a CONTROLLED at-least-once duplicate, not a
    // phantom lost event. We return ok:true with watermark_failed so the committed task is not disowned (#1/#3).
    await store.appendEvent({
      event_type: EVT_WATERMARK_FAILURE,
      task_id: task.id,
      summary: `Verified event ${evt.delivery_id} produced task ${task.id} but the delivery watermark failed — row kept, delivery NOT acknowledged (at-least-once re-delivery will duplicate).`,
      payload: { delivery_id: evt.delivery_id, task_id: task.id, error: e instanceof Error ? e.message : String(e) },
    });
    return { ok: true, task, watermark_failed: true };
  }
  return { ok: true, task };
}

// ── Chained-trigger-on-completion handoff (FR-5.TRG.004 / AC-5.TRG.004.1-.2, OD-059) ────────────────

/** A completed parent task, as this slice sees it for the chained handoff. `memory_retrieved` models the
 *  parent's own retrieved memory set (with per-memory clearance) — used ONLY to prove B does NOT inherit it. */
export interface CompletedParent {
  id: string;
  task_name: string;
  output: Record<string, unknown>;
  /** The parent's retrieved memories, tagged with the clearance tier they required. NEVER copied into B. */
  memory_retrieved?: Array<{ id: string; clearance: string }>;
}

export interface ChainSpec {
  /** The successor's task name + type (chained). */
  successor_name: string;
  /** The explicit handoff payload seeding B's FRESH envelope — the parent's relevant output, chosen by the
   *  chain config, NOT the whole parent envelope (OD-059). */
  handoff: Record<string, unknown>;
}

/**
 * A memory-retrieval function scoped to the SUCCESSOR (B's own entity scope + clearance — the C2 read flow).
 * B re-runs its OWN retrieval; it never receives A's memory_retrieved. Injected so the test can prove B's
 * memories come from B's retrieval and that no above-B-clearance memory of A's leaks in.
 */
export type ScopedRetrieval = (successorName: string) => Promise<Array<{ id: string; clearance: string }>>;

export interface ChainedTask {
  task: TaskRow;
  /** B's FRESH envelope: the handoff payload + a provenance link to A + B's OWN retrieved memories. */
  envelope: {
    handoff: Record<string, unknown>;
    provenance: { parent_task_id: string; parent_task_name: string };
    memory_retrieved: Array<{ id: string; clearance: string }>;
  };
}

/**
 * Fire the chained successor on a parent's successful completion (FR-5.TRG.004). B gets a FRESH envelope
 * seeded by the explicit handoff payload + a provenance link to A; B re-runs its OWN memory retrieval under
 * its OWN scope/clearance (OD-059) and NEVER inherits A's envelope or A's above-clearance memories. The
 * freeze gate is checked FIRST — a chained successor during a freeze is blocked + logged, created nothing.
 */
export async function fireChained(
  store: TriggerStore,
  parent: CompletedParent,
  spec: ChainSpec,
  retrieve: ScopedRetrieval,
): Promise<ChainedTask> {
  // FREEZE GATE — a chained successor is a dispatch path too (AF-135 completeness).
  await assertNotFrozen(store, 'chained', { task_id: parent.id });

  // B re-runs its OWN retrieval under B's scope — the ONLY source of B's memories. A's memory_retrieved is
  // never read here, so nothing of A's (least of all above-B-clearance memories) can leak into B (AC-5.TRG.004.2).
  const bMemories = await retrieve(spec.successor_name);

  const task = await store.insertTask({
    type: 'chained',
    task_name: spec.successor_name,
    payload: { ...spec.handoff }, // the explicit handoff payload — NOT A's full payload
    originating_user_id: null,
    parent_task_id: parent.id, // provenance link to A
  });

  return {
    task,
    envelope: {
      handoff: { ...spec.handoff },
      provenance: { parent_task_id: parent.id, parent_task_name: parent.task_name },
      memory_retrieved: bMemories,
    },
  };
}
