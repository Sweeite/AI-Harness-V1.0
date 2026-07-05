// ISSUE-046 (C4 OPT) — the PromptOptimisation PORT + the in-memory fake (the house port+fake pattern,
// cf. app/prompt-store/src/store.ts, app/config-store/src/store.ts, app/webhook-auth/src/store.ts). Every
// live side effect of the three optimisation slices goes through this port so the logic is unit-testable
// with NO live DB. The in-memory fake is BOTH the test double AND the reference model that the live pg
// adapter (supabase-store.ts) must match against the DDL.
//
// This slice consumes ISSUE-042's stable version identity (prompt_layers.id + version) and ISSUE-044's
// dynamic_field_values table; it OWNS neither. It owns three behaviours:
//   • FR-4.OPT.001 — version-to-outcome ATTRIBUTION. The pinned prompt version(s) in force at a task's
//     assembly are captured (a VersionAttribution) so a completed task's outcome attributes to the version.
//     C4 owns the required-fields capture contract + the "identity is never lost" invariant; C5
//     FR-5.ASM.009 (ISSUE-053) writes the actual completion/outcome record. This store is the reference
//     model that guarantees the version identity is present, stable, and per-version-bucketable.
//   • FR-4.OPT.002 — dynamic Layer-2 FRESH injection. The declared dynamic fields' live values are read
//     FRESH at each assembly from dynamic_field_values (never a static-config baked snapshot), so an
//     updated value appears on the NEXT session's Layer 2 with no redeploy/reboot. ISSUE-044 owns the
//     field declaration + value-source + staleness semantics; this slice owns the fresh-per-session read.
//   • FR-4.OPT.003 — compression discipline. Owned in editor.ts (a non-blocking word-count advisory), not
//     a persisted side effect — no store surface.
//
// Faithful to schema.md §5:
//   prompt_layers (id, layer, name, content, agent_id, enabled, version, previous_version_id,
//     change_reason, created_at, created_by) — READ-ONLY here, owned by ISSUE-042. This slice reads the
//     (id, version) identity only.
//   dynamic_field_values (field_name primary key, field_value, last_updated) — read fresh at assembly for
//     OPT.002; table + semantics owned by ISSUE-042/044.
//
// Invariants the fake enforces EXACTLY as the DB would, so a test against the fake proves the contract the
// live silo must uphold:
//   1. A VersionAttribution captured for a task is IMMUTABLE and NEVER LOST once recorded — the version
//      identity in force at assembly survives regardless of any later edit publishing N+1 (#1 — never lose
//      knowledge). A second capture for the same task_id is rejected (the pin is captured once, at assembly).
//   2. Distinct prompt versions attribute DISTINCTLY: two tasks assembled on different versions of the same
//      layer bucket to different versions; version-bucketed outcome reads never conflate them.
//   3. An attribution's captured version id must reference a prompt_layers row that existed at capture time
//      (a dangling/empty pin is a lost identity — rejected). The core slot is required in a pin (a task with
//      no resolved core cannot have run — FR-4.LYR.004 halts it upstream).
//   4. dynamic_field_values reads are FRESH: assembleDynamicLayer2 re-reads the current value each call;
//      there is no cached/baked snapshot path. Updating a field then re-assembling yields the new value.
//   5. An outcome is attributed to a task's captured versions ONLY — recording an outcome for a task with no
//      captured attribution is rejected (an outcome with no version identity is exactly the lost signal #3
//      forbids — fail loud, never silently drop the attribution).

// ── The stable version identity this slice attributes (a subset of the prompt_layers row — ISSUE-042) ──
/** A prompt layer's stable identity as captured at assembly. Never its content — identity, not payload. */
export interface VersionRef {
  /** prompt_layers.id — the immutable per-version row id (the stable identity, ISSUE-042). */
  version_id: string;
  /** prompt_layers.version — the monotonic version number within the asset's chain. */
  version: number;
}

/** The four positional prompt slots (FR-4.LYR.001 fixed order). Core is always required in a pin. */
export type LayerSlot = 'core' | 'business' | 'memory' | 'task';
export const LAYER_SLOTS: readonly LayerSlot[] = ['core', 'business', 'memory', 'task'] as const;

/**
 * The version(s) in force at a task's assembly — the OPT.001 capture unit. C5's assembly (FR-5.ASM.002 pin
 * point, ISSUE-053) hands these version ids in; this is the required-fields contract they must satisfy.
 */
export interface VersionAttribution {
  task_id: string;
  /** version identity per resolved slot; a slot absent from the task (e.g. no memory) is omitted. */
  slots: Partial<Record<LayerSlot, VersionRef>>;
  captured_at: string; // ISO — the assembly moment (immutable once set)
}

/** A completed task's recorded outcome (the signal the attribution buckets). C5 FR-5.ASM.009 writes it;
 * this slice reads it back bucketed by version to feed the AF-111 EVAL + the C7 signals. */
export type TaskOutcome = 'success' | 'failure';

export interface OutcomeRecord {
  task_id: string;
  outcome: TaskOutcome;
  /** an optional numeric cost/quality measure the AF-111 EVAL compares across versions (e.g. tokens). */
  cost?: number;
  recorded_at: string; // ISO
}

/** A version-bucketed outcome roll-up — what the AF-111 EVAL + C7 version-performance dashboards read. */
export interface VersionOutcomeBucket {
  version_id: string;
  version: number;
  slot: LayerSlot;
  total: number;
  successes: number;
  failures: number;
  /** mean cost over the recorded outcomes that carried a cost (undefined if none did). */
  meanCost: number | undefined;
}

// ── dynamic_field_values (schema §5) — read FRESH at assembly for OPT.002 ──
export interface DynamicFieldValue {
  field_name: string;
  field_value: string | null;
  last_updated: string; // ISO
}

/** One resolved Layer-2 dynamic field as injected into an assembled prompt (fresh at assembly). */
export interface InjectedDynamicField {
  field_name: string;
  field_value: string | null;
  last_updated: string;
  /** true when last_updated is older than the freshness threshold (staleness surfaced — OD-052/ISSUE-044).
   * The threshold itself is ISSUE-044's config; this slice only surfaces the flag when handed one. */
  stale: boolean;
}

// ── The port. Sync in the fake; modelled async for the DB adapter. ──
export interface PromptOptimisationStore {
  // ── OPT.001 — version-to-outcome attribution ──
  /** Capture the pinned version identity in force at a task's assembly. Rejects a re-capture, an empty pin,
   * or a missing core slot (identity must be present + captured once). FR-4.OPT.001 / AC-4.OPT.001.1. */
  captureAttribution(attr: VersionAttribution): Promise<VersionAttribution>;
  /** Read back the immutable attribution for a task (null if none captured). */
  getAttribution(task_id: string): Promise<VersionAttribution | null>;
  /** Record a completed task's outcome. REJECTS a task with no captured attribution (no version identity =
   * lost signal, #3). The outcome attributes to the versions captured at THAT task's assembly. */
  recordOutcome(rec: OutcomeRecord): Promise<OutcomeRecord>;
  /** Roll up recorded outcomes bucketed by the version(s) in force — the AF-111 EVAL / C7-signal substrate.
   * Optionally scope to one slot. Distinct versions bucket distinctly (never conflated). */
  outcomesByVersion(slot?: LayerSlot): Promise<VersionOutcomeBucket[]>;

  // ── OPT.002 — dynamic Layer-2 fresh injection ──
  /** Operator-editable upsert of a dynamic field value (ISSUE-044's write path calls this on Save). */
  putDynamicField(field_name: string, field_value: string | null, now: number): Promise<DynamicFieldValue>;
  /** Assemble Layer 2 by reading the declared fields' CURRENT values FRESH — never a baked snapshot. An
   * updated value appears on the next call with no redeploy/reboot (FR-4.OPT.002 / AC-4.OPT.002.1).
   * `freshnessThresholdSeconds` (ISSUE-044's config) flags staleness; omit to skip the flag. */
  assembleDynamicLayer2(
    declaredFields: readonly string[],
    now: number,
    freshnessThresholdSeconds?: number,
  ): Promise<InjectedDynamicField[]>;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the test double AND the reference model. Deterministic: a logical `now` (epoch seconds)
// is supplied by the caller; no Date.now()/random (house discipline — testable, resumable). Captured
// attributions are append-only + immutable: once recorded, an entry is never mutated or dropped.
// ───────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryPromptOptimisationStore implements PromptOptimisationStore {
  // task_id → the immutable version identity captured at assembly (OPT.001).
  private readonly attributions = new Map<string, VersionAttribution>();
  // task_id → its recorded outcome (one per task).
  private readonly outcomes = new Map<string, OutcomeRecord>();
  // field_name → current value (OPT.002 — the dynamic_field_values table).
  private readonly dynamicFields = new Map<string, DynamicFieldValue>();

  /** A frozen deep copy of an attribution's slots, so an entry can never be mutated after capture (#1). */
  private freezeAttribution(attr: VersionAttribution): VersionAttribution {
    const slots: Partial<Record<LayerSlot, VersionRef>> = {};
    for (const slot of LAYER_SLOTS) {
      const ref = attr.slots[slot];
      if (ref) slots[slot] = { version_id: ref.version_id, version: ref.version };
    }
    return Object.freeze({ task_id: attr.task_id, slots: Object.freeze(slots), captured_at: attr.captured_at });
  }

  async captureAttribution(attr: VersionAttribution): Promise<VersionAttribution> {
    if (this.attributions.has(attr.task_id)) {
      // The pin is captured ONCE, at assembly (FR-4.STO.006 / OD-050). A re-capture would risk overwriting
      // the version identity in force — never lose knowledge (#1). Fail loud.
      throw new Error(
        `attribution for task '${attr.task_id}' already captured — the version pin is captured once at assembly and is immutable (FR-4.OPT.001 / OD-050)`,
      );
    }
    const presentSlots = LAYER_SLOTS.filter((s) => attr.slots[s]);
    if (presentSlots.length === 0) {
      // An empty pin is a lost identity — a task that ran must have resolved at least a core layer.
      throw new Error(
        `attribution for task '${attr.task_id}' has no version identity — at least the core slot must be pinned (FR-4.LYR.004 / AC-4.OPT.001.1)`,
      );
    }
    if (!attr.slots.core) {
      // Core is required at assembly (FR-4.LYR.004 halts a coreless assembly upstream); an attribution
      // without it is malformed.
      throw new Error(
        `attribution for task '${attr.task_id}' is missing the required core slot (FR-4.LYR.004)`,
      );
    }
    for (const slot of presentSlots) {
      const ref = attr.slots[slot]!;
      if (!ref.version_id || ref.version_id.trim() === '') {
        throw new Error(`attribution for task '${attr.task_id}' slot '${slot}' has an empty version_id — the stable identity is required (FR-4.OPT.001)`);
      }
      if (!Number.isInteger(ref.version) || ref.version < 1) {
        throw new Error(`attribution for task '${attr.task_id}' slot '${slot}' has an invalid version ${ref.version} — must be a positive integer (schema §5 version int)`);
      }
    }
    const frozen = this.freezeAttribution(attr);
    this.attributions.set(attr.task_id, frozen);
    return frozen;
  }

  async getAttribution(task_id: string): Promise<VersionAttribution | null> {
    return this.attributions.get(task_id) ?? null;
  }

  async recordOutcome(rec: OutcomeRecord): Promise<OutcomeRecord> {
    if (!this.attributions.has(rec.task_id)) {
      // An outcome with no captured version identity cannot be attributed — that is exactly the lost signal
      // #3 forbids. C5 FR-5.ASM.009 always captures the pin before the task runs; a missing one is a bug,
      // surfaced loud rather than silently dropped.
      throw new Error(
        `cannot record an outcome for task '${rec.task_id}': no version attribution was captured at its assembly (the outcome would have no version identity — FR-4.OPT.001 / #3)`,
      );
    }
    if (this.outcomes.has(rec.task_id)) {
      throw new Error(`task '${rec.task_id}' already has a recorded outcome (a completed task records once)`);
    }
    const stored: OutcomeRecord = { task_id: rec.task_id, outcome: rec.outcome, cost: rec.cost, recorded_at: rec.recorded_at };
    this.outcomes.set(rec.task_id, stored);
    return { ...stored };
  }

  async outcomesByVersion(slot?: LayerSlot): Promise<VersionOutcomeBucket[]> {
    // Bucket every recorded outcome by the version(s) in force at its task's assembly. A single outcome
    // contributes to one bucket per pinned slot — so a version can be compared to a sibling version on the
    // same slot (the AF-111 discrimination question). Distinct version_ids NEVER conflate (invariant 2).
    const buckets = new Map<string, VersionOutcomeBucket & { costSum: number; costN: number }>();
    for (const [task_id, outcome] of this.outcomes) {
      const attr = this.attributions.get(task_id);
      if (!attr) continue; // unreachable — recordOutcome guarantees one — defensive.
      for (const s of LAYER_SLOTS) {
        if (slot && s !== slot) continue;
        const ref = attr.slots[s];
        if (!ref) continue;
        const key = `${s}::${ref.version_id}`;
        let b = buckets.get(key);
        if (!b) {
          b = { version_id: ref.version_id, version: ref.version, slot: s, total: 0, successes: 0, failures: 0, meanCost: undefined, costSum: 0, costN: 0 };
          buckets.set(key, b);
        }
        b.total += 1;
        if (outcome.outcome === 'success') b.successes += 1;
        else b.failures += 1;
        if (typeof outcome.cost === 'number') {
          b.costSum += outcome.cost;
          b.costN += 1;
        }
      }
    }
    return [...buckets.values()].map((b) => ({
      version_id: b.version_id,
      version: b.version,
      slot: b.slot,
      total: b.total,
      successes: b.successes,
      failures: b.failures,
      meanCost: b.costN > 0 ? b.costSum / b.costN : undefined,
    }));
  }

  // ── OPT.002 — dynamic Layer-2 fresh injection ──
  async putDynamicField(field_name: string, field_value: string | null, now: number): Promise<DynamicFieldValue> {
    const row: DynamicFieldValue = { field_name, field_value, last_updated: new Date(now * 1000).toISOString() };
    this.dynamicFields.set(field_name, row); // upsert — the operator-editable per-deployment store (OD-052).
    return { ...row };
  }

  async assembleDynamicLayer2(
    declaredFields: readonly string[],
    now: number,
    freshnessThresholdSeconds?: number,
  ): Promise<InjectedDynamicField[]> {
    // FRESH READ (invariant 4 / AC-4.OPT.002.1): each call re-reads the CURRENT value from the store. There
    // is deliberately NO cached/baked snapshot — an updated value is visible on the very next assembly with
    // no redeploy/reboot. A declared field with no value row yet resolves to null (surfaced, not dropped).
    return declaredFields.map((field_name) => {
      const row = this.dynamicFields.get(field_name);
      const field_value = row?.field_value ?? null;
      const last_updated = row?.last_updated ?? new Date(0).toISOString();
      let stale = false;
      if (freshnessThresholdSeconds !== undefined && row) {
        const ageSeconds = now - Date.parse(row.last_updated) / 1000;
        stale = ageSeconds > freshnessThresholdSeconds;
      } else if (freshnessThresholdSeconds !== undefined && !row) {
        stale = true; // a never-set field is maximally stale when a threshold is in force.
      }
      return { field_name, field_value, last_updated, stale };
    });
  }
}
