// ISSUE-061 — in-memory fakes for the routing seams (the reference models the live pg adapter must match). All
// deterministic (caller-supplied `now`); no Date.now/random. These mirror the DDL shapes: InMemoryPlanStore
// mirrors execution_plans (append-only versioned; unique task_type_name+version), InMemoryEventSink mirrors
// event_log's append-only shape, the queue fake mirrors task_queue's status transitions this slice touches.

import type {
  Classification,
  Classifier,
  EnvelopeSink,
  EventSink,
  ExecutionPlan,
  PlanOutcome,
  PlanStore,
  QueueGate,
  RoutingEvent,
  SecondarySink,
  TaskInput,
} from './routing.ts';

// ── execution_plans fake (co-owned w/ ISSUE-064; append-only versioned, unique (task_type_name, version)). ──
export class InMemoryPlanStore implements PlanStore {
  private seq = 0;
  readonly versions = new Map<string, { id: string; version: number; task_type_name: string; plan: ExecutionPlan; previous_version_id: string | null; created_at: string }>();
  readonly outcomes = new Map<string, { outcome: PlanOutcome; at: string }>();
  /** highest version seen per task_type_name (the unique-constraint enforcer). */
  private maxVersion = new Map<string, number>();

  async saveVersion(plan: ExecutionPlan, previousVersionId: string | null, now: number): Promise<{ id: string; version: number }> {
    this.seq += 1;
    const id = `plan-${String(this.seq).padStart(4, '0')}`;
    const version = (this.maxVersion.get(plan.task_type_name) ?? 0) + 1;
    this.maxVersion.set(plan.task_type_name, version);
    this.versions.set(id, {
      id,
      version,
      task_type_name: plan.task_type_name,
      plan: structuredClonePlan(plan),
      previous_version_id: previousVersionId,
      created_at: new Date(now * 1000).toISOString(),
    });
    return { id, version };
  }

  async recordOutcome(planVersionId: string, outcome: PlanOutcome, now: number): Promise<void> {
    if (!this.versions.has(planVersionId)) {
      throw new Error(`execution_plans: no such plan version '${planVersionId}'`);
    }
    this.outcomes.set(planVersionId, { outcome: { ...outcome, per_step: [...outcome.per_step] }, at: new Date(now * 1000).toISOString() });
  }

  async getVersion(id: string): Promise<{ id: string; version: number; plan: ExecutionPlan; previous_version_id: string | null } | null> {
    const v = this.versions.get(id);
    return v ? { id: v.id, version: v.version, plan: structuredClonePlan(v.plan), previous_version_id: v.previous_version_id } : null;
  }
}

/** A plan store whose recordOutcome ALWAYS throws — used to prove the ORC.007.2 secondary-sink path. */
export class FailingOutcomePlanStore extends InMemoryPlanStore {
  override async recordOutcome(): Promise<void> {
    throw new Error('simulated primary outcome-write failure');
  }
}

// ── envelope fake (C5 ISSUE-050 owns the real one; this only records the plan hand-off, ORC.005.3). ─────
export class InMemoryEnvelopeSink implements EnvelopeSink {
  readonly plans = new Map<string, ExecutionPlan>();
  setExecutionPlan(taskId: string, plan: ExecutionPlan): void {
    this.plans.set(taskId, structuredClonePlan(plan));
  }
}

// ── event_log fake (C7 ISSUE-011; append-only). ──────────────────────────────────────────────────
export class InMemoryEventSink implements EventSink {
  readonly events: RoutingEvent[] = [];
  async append(ev: RoutingEvent): Promise<void> {
    if (typeof ev.summary !== 'string' || ev.summary.trim().length === 0) {
      throw new Error('event_log: summary is required and non-empty (AC-7.LOG.002.2)');
    }
    this.events.push({ ...ev, entity_ids: [...ev.entity_ids], payload: { ...ev.payload } });
  }
  byType(t: RoutingEvent['event_type']): RoutingEvent[] {
    return this.events.filter((e) => e.event_type === t);
  }
}

/** An event sink that always throws — used to prove the safeAppend secondary-sink fallback. */
export class FailingEventSink implements EventSink {
  async append(): Promise<void> {
    throw new Error('simulated primary event_log write failure');
  }
}

// ── secondary sink fake (ORC.007.2 — distinct channel). ──────────────────────────────────────────
export class InMemorySecondarySink implements SecondarySink {
  readonly reports: { ev: RoutingEvent; cause: string; at: string }[] = [];
  async reportPrimaryFailure(ev: RoutingEvent, cause: unknown, now: number): Promise<void> {
    this.reports.push({ ev: { ...ev }, cause: String(cause), at: new Date(now * 1000).toISOString() });
  }
}

// ── task_queue fake (C5 ISSUE-048; the narrow slice the engine touches). ─────────────────────────
export interface QueueTask extends TaskInput {
  status: 'pending' | 'routing' | 'awaiting_clarification';
  created_at_s: number;
  /** When the clarification was RAISED (state-entry into awaiting_clarification), NOT queue-push time. The
   * staleness window (OD-077) is a human-RESPONSE window measured from here — a long queue wait must not eat it
   * (logic-sweep fix, fakes.ts:135). Null until the task enters awaiting_clarification. */
  clarification_raised_at_s: number | null;
}
export class InMemoryQueueGate implements QueueGate {
  readonly tasks: QueueTask[] = [];
  constructor(private readonly clarificationWindowSeconds = 24 * 3600) {}

  push(task: TaskInput, createdAtSeconds: number): void {
    this.tasks.push({ ...task, status: 'pending', created_at_s: createdAtSeconds, clarification_raised_at_s: null });
  }
  private find(id: string): QueueTask | undefined {
    return this.tasks.find((t) => t.task_id === id);
  }

  async front(): Promise<TaskInput | null> {
    const t = this.tasks.find((x) => x.status === 'pending');
    if (!t) return null;
    t.status = 'routing'; // dequeued for routing (the crash window opens here — ORC.001.3)
    return { task_id: t.task_id, task_name: t.task_name, payload: t.payload };
  }
  async returnToRoutable(taskId: string, _now: number): Promise<void> {
    const t = this.find(taskId);
    if (t) t.status = 'pending'; // idempotent re-route: never dequeued-but-unplanned
  }
  async setAwaitingClarification(taskId: string, now: number): Promise<void> {
    const t = this.find(taskId);
    if (t) {
      t.status = 'awaiting_clarification';
      // logic-sweep fix (fakes.ts:135): stamp WHEN the clarification was raised so the staleness window runs from
      // state-entry, not queue-push. A task that waited in the queue must still get its full response window (OD-077).
      t.clarification_raised_at_s = now;
    }
  }
  async escalateStaleClarifications(now: number): Promise<string[]> {
    const out: string[] = [];
    for (const t of this.tasks) {
      if (t.status !== 'awaiting_clarification') continue;
      // measure the human-response window from the RAISE time, not created_at_s (queue-push) — see fakes.ts:135 fix.
      const raisedAt = t.clarification_raised_at_s ?? t.created_at_s;
      if (now - raisedAt < this.clarificationWindowSeconds) continue;
      out.push(t.task_id); // NB: status intentionally UNCHANGED — never auto-proceeds (OD-077)
    }
    return out;
  }
}

// ── a deterministic classifier fake (production is a Sonnet call — AF-121). ───────────────────────
export class FixedClassifier implements Classifier {
  constructor(private readonly byTaskId: Map<string, Classification>) {}
  classify(task: TaskInput): Classification {
    const c = this.byTaskId.get(task.task_id);
    if (!c) throw new Error(`FixedClassifier: no classification wired for task '${task.task_id}'`);
    return { ...c, context: { entity_ids: [...c.context.entity_ids], memory_scope_hint: c.context.memory_scope_hint } };
  }
}

function structuredClonePlan(p: ExecutionPlan): ExecutionPlan {
  return {
    task_type_name: p.task_type_name,
    parallel: p.parallel,
    steps: p.steps.map((s) => ({ ...s, depends_on: [...s.depends_on] })),
  };
}
