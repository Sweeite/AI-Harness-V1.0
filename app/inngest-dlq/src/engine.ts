// ISSUE-052 (C5 JOB) — the Inngest execution-engine REFERENCE MODEL. Pure + deterministic (a logical `now`,
// epoch seconds, is injected; no Date.now()/random). It models Inngest's semantics closely enough to PROVE the
// JOB acceptance criteria offline, driving the store.ts ports for its two live side effects (the task_queue
// projection + event_log). What it models, mapped to the FRs + the three non-negotiables:
//
//   FR-5.JOB.001/007 (#3)  register a step function per task type; NO total execution-time limit on a job; a
//                          per-step declared duration > the AF-018 2h cap is rejected LOUDLY (never silently run
//                          to fail on the platform). v1 hosting = cloud; self_hosted refused (OOS-028).
//   FR-5.JOB.002 (#1)      each step is a step.run; on failure ONLY that step retries; already-committed steps
//                          are memoized (their outputs preserved) and never re-run.
//   FR-5.JOB.003 (#2)      configurable exponential backoff per job type; a unique event id de-dups a
//                          re-delivered event so it never executes twice.
//   FR-5.JOB.004 (#2)      Inngest owns the retry loop; the engine MIRRORS its lifecycle into task_queue via the
//                          ProjectionSink. There is exactly one retry loop — here. task_queue never schedules a
//                          retry (structurally impossible: the projection port has no scheduler + a forbidden
//                          hook). A consequential step's side effect fires at most once per failure (idempotency
//                          key memo).
//   FR-5.JOB.005 (#1/#3)   fan-out dispatches N child jobs; the parent records which children were / weren't
//                          created; a partial dispatch is surfaced LOUDLY on event_log and reconciled / retried
//                          as a unit under idempotency — never silently partial.
//   FR-5.JOB.006 (#2/#3)   exceed the per-step retry ceiling -> DLQ with full error history + final reason; never
//                          auto-retried; human-only requeue/discard; a DLQ entry resident past a configurable age
//                          trips an escalating, recorded liveness heartbeat on event_log (the failure-handler is
//                          never silent).

import {
  type EngineConfig,
  type EventSink,
  type ProjectionSink,
  type DlqStore,
  type StepSpec,
  type JobInvocation,
  type JobRunResult,
  type JobProjection,
  type ErrorAttempt,
  type DlqEntry,
  type EngineEvent,
  DEFAULT_ENGINE_CONFIG,
  RETRY_DLQ_AUTHORITY,
  EVT_JOB_COMPLETED,
  EVT_JOB_FAILED,
  EVT_DLQ_HEARTBEAT,
  computeBackoffSeconds,
  resolveRetryPolicy,
  isoSeconds,
  ERR_SELF_HOSTED,
  ERR_STEP_CAP_EXCEEDED,
  ERR_NO_FUNCTION,
  ERR_DLQ_HUMAN_REQUIRED,
  ERR_DLQ_NOT_RESIDENT,
} from './store.ts';

/** A registered Inngest step function for a task type. In production the concrete step callbacks come from the
 *  GRP graph resolution at dispatch; the registry records that a task type HAS a function (FR-5.JOB.002). */
export interface RegisteredFunction {
  taskType: string;
}

// ── Fan-out types (FR-5.JOB.005). ────────────────────────────────────────────────────────────────────────────
export interface FanOutChild {
  childTaskId: string;
  taskType: string;
  /** the unique event id of the child job (dedup on reconcile / retry-as-a-unit). */
  eventId: string;
  /** the child's idempotency key — a re-dispatch of an already-created child is a no-op (#1 no duplicate). */
  idempotencyKey: string;
}
export interface FanOutResult {
  parentTaskId: string;
  created: string[]; // childTaskIds successfully dispatched (each its own tracked task)
  failed: { childTaskId: string; reason: string }[]; // children that were NOT created
  partial: boolean; // true iff any child failed to dispatch
}
/** The child-dispatch side effect (enqueue the child job). May throw to model a partial-dispatch failure. */
export type DispatchChild = (child: FanOutChild, now: number) => Promise<void>;

export interface ProvisioningPosture {
  hosting: EngineConfig['hosting'];
  retryDlqAuthority: typeof RETRY_DLQ_AUTHORITY;
  /** Inngest imposes no total job execution-time limit (AF-018). */
  jobExecutionTimeLimitSeconds: null;
  stepCapSeconds: number;
}

export class InngestEngine {
  private readonly functions = new Map<string, RegisteredFunction>();
  /** the step-memo / committed-output ledger, keyed by the CONSUMED idempotency key (GRP). A step whose key is
   *  present was already committed -> its output is reused, never re-executed (AC-5.JOB.002.1 / AC-5.JOB.004.2). */
  private readonly ledger = new Map<string, unknown>();
  /** processed event ids -> the terminal result. A re-delivered event returns the prior result WITHOUT
   *  re-executing (FR-5.JOB.003 unique-event-id dedup). */
  private readonly processedEvents = new Map<string, JobRunResult>();
  /** dispatched fan-out child idempotency keys — a reconcile never re-creates an already-created child (#1). */
  private readonly dispatchedChildKeys = new Set<string>();

  constructor(
    private readonly config: EngineConfig,
    private readonly projection: ProjectionSink,
    private readonly events: EventSink,
    private readonly dlq: DlqStore,
  ) {
    // FR-5.JOB.007 — v1 is cloud-hosted only. Refuse to stand up a self_hosted engine (OOS-028) rather than
    // pretend to provision infrastructure that is out of scope (#3).
    if (config.hosting === 'self_hosted') throw new Error(ERR_SELF_HOSTED);
  }

  /** Register the Inngest step function for a task type at boot (ADR-005). */
  registerFunction(taskType: string): void {
    this.functions.set(taskType, { taskType });
  }
  registeredFunctions(): string[] {
    return [...this.functions.keys()];
  }

  /** The provisioning posture the AC-5.JOB.007.1 / AC-NFR-INF.011.2 tests assert against. */
  provisioningPosture(): ProvisioningPosture {
    return {
      hosting: this.config.hosting,
      retryDlqAuthority: RETRY_DLQ_AUTHORITY, // single authority = Inngest
      jobExecutionTimeLimitSeconds: null, // no total execution-time limit (AF-018)
      stepCapSeconds: this.config.stepCapSeconds,
    };
  }

  /** Execute one job invocation with step-level retry + single-authority projection + DLQ on exhaustion. */
  async execute(job: JobInvocation, now: number): Promise<JobRunResult> {
    // FR-5.JOB.003 — unique-event-id de-duplication. A re-delivered event does NOT execute twice; it returns the
    // prior terminal result unchanged (#2 no double execution).
    const prior = this.processedEvents.get(job.eventId);
    if (prior) return { ...prior, outcome: 'deduplicated' };

    if (!this.functions.has(job.taskType)) throw new Error(ERR_NO_FUNCTION(job.taskType));

    // AF-018 build-time guard — reject a step that would exceed the per-step cap BEFORE running anything (#3).
    for (const step of job.steps) {
      if (step.maxDurationSeconds != null && step.maxDurationSeconds > this.config.stepCapSeconds) {
        throw new Error(ERR_STEP_CAP_EXCEEDED(step.step_id, step.maxDurationSeconds, this.config.stepCapSeconds));
      }
    }

    const policy = resolveRetryPolicy(this.config, job.taskType);
    const errorHistory: ErrorAttempt[] = [];
    const stepRunCounts: Record<string, number> = {};
    const reusedSteps: string[] = [];
    const scheduledBackoffs: number[] = [];
    let totalAttempts = 0;

    for (const step of job.steps) {
      let runCount = 0;
      stepRunCounts[step.step_id] = 0;

      // AC-5.JOB.002.1 / AC-5.JOB.004.2 — a step whose idempotency key is already committed is REUSED, not
      // re-executed. This covers (a) completed steps on a re-invocation/resume and (b) a crash-window retry where
      // the side effect committed before the completion record.
      if (this.ledger.has(step.idempotencyKey)) {
        reusedSteps.push(step.step_id);
        continue;
      }

      // The per-step retry loop — the SOLE retry authority (OD-058). Only THIS step retries; earlier committed
      // steps are untouched (their run counts stay 1).
      let stepAttempts = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        stepAttempts += 1;
        totalAttempts += 1;
        runCount += 1;
        stepRunCounts[step.step_id] = runCount;
        try {
          const output = await step.run();
          // Commit the output under the idempotency key (key-after-success at this layer — the durable
          // key-before-side-effect crash-window ordering is GRP's IdempotencyLedger; here the memo proves the
          // no-re-execute-on-retry contract).
          this.ledger.set(step.idempotencyKey, output);
          break; // step done -> move to the next step
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errorHistory.push({ attempt: totalAttempts, message, at: isoSeconds(now) });

          if (stepAttempts >= policy.maxAttempts) {
            // Retry ceiling hit for this step -> the JOB dead-letters (FR-5.JOB.006).
            const finalReason = `step '${step.step_id}' exhausted ${policy.maxAttempts} attempts: ${message}`;
            await this.deadLetter(job, errorHistory, finalReason, totalAttempts, now);
            const result: JobRunResult = {
              taskId: job.taskId,
              outcome: 'dead_lettered',
              attempts: totalAttempts,
              stepRunCounts,
              reusedSteps,
              scheduledBackoffs,
              errorHistory: errorHistory.map((e) => ({ ...e })),
            };
            this.processedEvents.set(job.eventId, result);
            return result;
          }

          // Schedule the next retry with exponential backoff (FR-5.JOB.003). Project the running lifecycle into
          // task_queue (OD-058 mirror): attempts + next_retry_at + status='running' + the appended error history.
          const backoff = computeBackoffSeconds(policy, stepAttempts);
          scheduledBackoffs.push(backoff);
          const nextRetryAt = isoSeconds(now + backoff);
          await this.projection.sync(job.taskId, {
            attempts: totalAttempts,
            next_retry_at: nextRetryAt,
            status: 'running',
            error: errorHistory.map((e) => ({ ...e })),
          });
          // loop -> the next attempt (models Inngest re-invoking the step after the backoff).
        }
      }
    }

    // All steps committed -> completed. Project the terminal lifecycle + emit the run-completion record.
    await this.projection.sync(job.taskId, {
      attempts: totalAttempts,
      next_retry_at: null,
      status: 'completed',
      error: errorHistory.map((e) => ({ ...e })),
    });
    await this.emit({
      task_id: job.taskId,
      event_type: EVT_JOB_COMPLETED,
      entity_ids: [job.taskId],
      summary: `job '${job.taskType}' (task ${job.taskId}) completed in ${totalAttempts} attempt(s)`,
      payload: { task_id: job.taskId, task_type: job.taskType, attempts: totalAttempts, reused_steps: reusedSteps },
    });

    const result: JobRunResult = {
      taskId: job.taskId,
      outcome: 'completed',
      attempts: totalAttempts,
      stepRunCounts,
      reusedSteps,
      scheduledBackoffs,
      errorHistory: errorHistory.map((e) => ({ ...e })),
    };
    this.processedEvents.set(job.eventId, result);
    return result;
  }

  /** Move a job to the DLQ: record the entry (full error history + final reason), project status='failed' with
   *  next_retry_at cleared (no scheduled retry — DLQ is terminal until a human acts), and emit the failure
   *  record. NEVER auto-retried (#2). */
  private async deadLetter(
    job: JobInvocation,
    errorHistory: ErrorAttempt[],
    finalReason: string,
    attempts: number,
    now: number,
  ): Promise<void> {
    const entry: DlqEntry = {
      task_id: job.taskId,
      task_type: job.taskType,
      error_history: errorHistory.map((e) => ({ ...e })),
      final_reason: finalReason,
      entered_at: isoSeconds(now),
      resolution: 'resident',
      resolved_by: null,
      resolved_at: null,
      last_heartbeat_at: null,
    };
    await this.dlq.add(entry);
    await this.projection.sync(job.taskId, {
      attempts,
      next_retry_at: null, // DLQ = no scheduled retry; a human must act (FR-5.JOB.006)
      status: 'failed',
      error: errorHistory.map((e) => ({ ...e })),
    });
    await this.emit({
      task_id: job.taskId,
      event_type: EVT_JOB_FAILED,
      entity_ids: [job.taskId],
      summary: `job '${job.taskType}' (task ${job.taskId}) dead-lettered after ${attempts} attempt(s): ${finalReason}`,
      payload: { task_id: job.taskId, task_type: job.taskType, attempts, final_reason: finalReason },
    });
  }

  // ── Fan-out (FR-5.JOB.005) ───────────────────────────────────────────────────────────────────────────────
  /** Dispatch multiple child jobs from one parent event, each its own tracked task (AC-5.JOB.005.1). A partial
   *  dispatch failure is DETECTED and surfaced LOUDLY (the parent records which children were / weren't created)
   *  — never silently partial (AC-5.JOB.005.2 / #1/#3). Reconcile the remainder with reconcileFanOut(). */
  async fanOut(
    parentTaskId: string,
    children: FanOutChild[],
    dispatch: DispatchChild,
    now: number,
  ): Promise<FanOutResult> {
    const created: string[] = [];
    const failed: { childTaskId: string; reason: string }[] = [];

    for (const child of children) {
      // Idempotency: an already-dispatched child is a no-op (counts as created, no duplicate side effect — #1).
      if (this.dispatchedChildKeys.has(child.idempotencyKey)) {
        created.push(child.childTaskId);
        continue;
      }
      try {
        await dispatch(child, now);
        this.dispatchedChildKeys.add(child.idempotencyKey);
        created.push(child.childTaskId);
      } catch (err) {
        failed.push({ childTaskId: child.childTaskId, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    const partial = failed.length > 0;
    if (partial) {
      // #3 — a partial fan-out is a LOUD, recorded condition; the parent records created vs not-created so the
      // missing children can be reconciled. Never a silent partial dispatch.
      await this.emit({
        task_id: parentTaskId,
        event_type: EVT_JOB_FAILED,
        entity_ids: [parentTaskId, ...failed.map((f) => f.childTaskId)],
        summary: `fan-out from task ${parentTaskId} is PARTIAL: ${created.length} child job(s) created, ${failed.length} FAILED to dispatch — reconciling, not silently partial`,
        payload: {
          parent_task_id: parentTaskId,
          created,
          failed,
          total: children.length,
        },
      });
    }

    return { parentTaskId, created, failed, partial };
  }

  /** Reconcile a partial fan-out: retry the fan-out AS A UNIT under idempotency — already-created children are
   *  skipped (their keys are committed), only the missing children are (re)dispatched (AC-5.JOB.005.2). */
  async reconcileFanOut(
    parentTaskId: string,
    children: FanOutChild[],
    dispatch: DispatchChild,
    now: number,
  ): Promise<FanOutResult> {
    // Re-running fanOut is safe: the dispatchedChildKeys guard makes already-created children no-ops, so only the
    // previously-failed children are actually dispatched. Same key across the retry -> no duplicate (#1).
    return this.fanOut(parentTaskId, children, dispatch, now);
  }

  // ── DLQ liveness heartbeat + human-only recovery (FR-5.JOB.006 / AC-5.JOB.006.2) ─────────────────────────────
  /** Sweep the DLQ: for every resident entry older than the configured age, EMIT an escalating, recorded
   *  heartbeat on event_log (like the FR-5.LOP.005 loop heartbeat — re-fires each sweep while still resident, not
   *  a one-shot a C7 pull could miss). Returns the task_ids escalated this sweep. The failure-handler never fails
   *  silently (#3). */
  async sweepDlq(now: number): Promise<string[]> {
    const resident = await this.dlq.listResident();
    const escalated: string[] = [];
    for (const entry of resident) {
      const ageSeconds = now - Math.floor(Date.parse(entry.entered_at) / 1000);
      if (ageSeconds <= this.config.dlqAgeThresholdSeconds) continue; // strictly older-than the threshold
      await this.emit({
        task_id: entry.task_id,
        event_type: EVT_DLQ_HEARTBEAT,
        entity_ids: [entry.task_id],
        summary: `DLQ entry for task ${entry.task_id} ('${entry.task_type}') has been resident ${ageSeconds}s (> ${this.config.dlqAgeThresholdSeconds}s) — escalating; an unattended DLQ is a loud condition, not auto-retried`,
        payload: {
          task_id: entry.task_id,
          task_type: entry.task_type,
          age_seconds: ageSeconds,
          threshold_seconds: this.config.dlqAgeThresholdSeconds,
          final_reason: entry.final_reason,
        },
      });
      await this.dlq.recordHeartbeat(entry.task_id, now);
      escalated.push(entry.task_id);
    }
    return escalated;
  }

  /** HUMAN-ONLY: requeue a dead-lettered task for re-execution. Requires an explicit human actor; there is no
   *  auto-path here (#2). Marks the DLQ entry requeued and resets the projection to 'pending' so the human's
   *  re-invocation runs. The caller re-invokes execute() with a FRESH eventId (a new delivery). */
  async requeueFromDlq(taskId: string, humanActor: string, now: number): Promise<DlqEntry> {
    if (typeof humanActor !== 'string' || humanActor.trim().length === 0) {
      throw new Error(ERR_DLQ_HUMAN_REQUIRED);
    }
    const entry = await this.dlq.get(taskId);
    if (!entry || entry.resolution !== 'resident') throw new Error(ERR_DLQ_NOT_RESIDENT(taskId));
    await this.dlq.markResolved(taskId, 'requeued', humanActor, now);
    // Reset the projection so the human-triggered re-run starts clean. attempts is preserved as audit context;
    // status returns to pending. next_retry_at cleared. The error history is RETAINED (#1 never lose it).
    const prior = await this.projection.read(taskId);
    await this.projection.sync(taskId, {
      attempts: prior?.attempts ?? entry.error_history.length,
      next_retry_at: null,
      status: 'pending',
      error: (prior?.error ?? entry.error_history).map((e) => ({ ...e })),
    });
    const updated = await this.dlq.get(taskId);
    return updated!;
  }

  /** HUMAN-ONLY: discard a dead-lettered task (no re-execution). Requires an explicit human actor. The
   *  projection stays 'failed'; the DLQ entry is recorded discarded (audit-preserved, never deleted — #1). */
  async discardFromDlq(taskId: string, humanActor: string, reason: string, now: number): Promise<DlqEntry> {
    if (typeof humanActor !== 'string' || humanActor.trim().length === 0) {
      throw new Error(ERR_DLQ_HUMAN_REQUIRED);
    }
    const entry = await this.dlq.get(taskId);
    if (!entry || entry.resolution !== 'resident') throw new Error(ERR_DLQ_NOT_RESIDENT(taskId));
    await this.dlq.markResolved(taskId, 'discarded', humanActor, now);
    await this.emit({
      task_id: taskId,
      event_type: EVT_JOB_FAILED,
      entity_ids: [taskId],
      summary: `DLQ entry for task ${taskId} discarded by ${humanActor}: ${reason || '(no reason given)'}`,
      payload: { task_id: taskId, discarded_by: humanActor, reason },
    });
    const updated = await this.dlq.get(taskId);
    return updated!;
  }

  private async emit(ev: EngineEvent): Promise<void> {
    await this.events.append(ev);
  }
}

export { DEFAULT_ENGINE_CONFIG };
