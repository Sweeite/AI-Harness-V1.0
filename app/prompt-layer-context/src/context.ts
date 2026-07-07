// ISSUE-044 §8 steps 2-7 — the Layer-2 business-context + Layer-4 task-instruction CONTENT contracts and
// their pure invariants. This module is DB-agnostic: it owns the *semantics* the FRs pin down, and is the
// reference model the in-memory fake (store.ts) and the live pg adapter (supabase-store.ts) both obey.
//
// Rule-0 sources (open ONLY these — Context manifest, §6):
//   - component-04-prompt.md FR-4.BIZ.001 (Layer 2 shared per-deployment business identity),
//     FR-4.BIZ.002 (explicit static-vs-dynamic split — a field is exactly one; dynamic resolves at
//     assembly, not boot), FR-4.BIZ.003 (dynamic-field set declared in config; live values from an
//     operator-editable store; staleness surfaced past a freshness threshold — never silently current, #3);
//     FR-4.TSK.001 (Layer-4 = instruction+parameters+constraints+EXPLICIT output format; a missing format
//     is flagged incomplete), FR-4.TSK.002 (task templates with parameter slots instantiate to a complete
//     Layer 4 with ALL slots filled), FR-4.TSK.003 (task templates are versioned assets — inherited from
//     ISSUE-042, exercised in store.ts / the version machinery).
//   - schema.md §5 — prompt_layers rows (layer='business' | 'task_template'); dynamic_field_values
//     (field_name, field_value, last_updated).
//   - ADR-003 (cost) — the dynamic Layer-2 + freshness threshold is a token/freshness lever, not a gate.
//
// The prompt_layers table + prompt_layer_kind enum + the dynamic_field_values TABLE + the version/rollback
// machinery are ISSUE-042's (this slice consumes them, never re-implements). This slice owns the
// declaration + staleness semantics of dynamic_field_values, and the business/task CONTENT contracts.

// ── Layer-2 business identity fields — FR-4.BIZ.001, cites design L2411–2415, L841–850 ──────────────
// The shared per-deployment business-context content. These are the field NAMES that make up a Layer-2
// record; the SAME record is used across every agent in the deployment (AC-4.BIZ.001.1 — shared block).
export const BUSINESS_FIELDS = [
  'name',
  'description',
  'tone',
  'tool_stack',
  'approval_rules',
  'comms_preferences',
  'operating_hours',
  'escalation_paths',
] as const;

export type BusinessField = (typeof BUSINESS_FIELDS)[number];

export function isBusinessField(v: string): v is BusinessField {
  return (BUSINESS_FIELDS as readonly string[]).includes(v);
}

// ── FR-4.BIZ.002 — the explicit static-vs-dynamic classification ────────────────────────────────────
// A field is classified static (baked from deployment config at boot) OR dynamic (resolved at assembly,
// each session, from the operator-editable store) — exactly one, never both, never neither.
export type FieldClass = 'static' | 'dynamic';

/**
 * A deployment's Layer-2 classification: the declared dynamic-field set (config key
 * `business_context.dynamic_fields`). Every field NOT in this set is static. `classify` is total over any
 * field name — the split is exhaustive (AC-4.BIZ.002.1: a field, when read, is one or the other).
 */
export class Layer2Classification {
  private readonly dynamic: ReadonlySet<string>;

  /**
   * @param dynamicFields the config-declared dynamic Layer-2 field names (e.g. `current_quarter_goals`,
   *   `active_campaigns`, `this_week_priorities`). A name may be a BUSINESS_FIELD or a deployment-declared
   *   extra field. A duplicate name is a config error (a field cannot be listed twice). An empty string is
   *   rejected (a dynamic field must have a resolvable key).
   */
  constructor(dynamicFields: readonly string[]) {
    const seen = new Set<string>();
    for (const f of dynamicFields) {
      if (f == null || f.trim() === '') {
        throw new Error('a declared dynamic field name must be non-empty (business_context.dynamic_fields)');
      }
      if (seen.has(f)) {
        throw new Error(`dynamic field '${f}' declared twice — a field is classified exactly once (FR-4.BIZ.002)`);
      }
      seen.add(f);
    }
    this.dynamic = seen;
  }

  /** The declared dynamic-field set, sorted for determinism. */
  dynamicFields(): string[] {
    return [...this.dynamic].sort();
  }

  isDynamic(field: string): boolean {
    return this.dynamic.has(field);
  }

  /** Total classification: every field is exactly static or dynamic (AC-4.BIZ.002.1). */
  classify(field: string): FieldClass {
    return this.dynamic.has(field) ? 'dynamic' : 'static';
  }
}

// ── FR-4.BIZ.003 — dynamic-field value + staleness surfacing ────────────────────────────────────────
// A dynamic field's live value comes from the operator-editable dynamic_field_values store (keyed by the
// declared field name), read at ASSEMBLY (not from static config). Three cases the resolver must make
// observable to the operator, never silently:
//   - present + fresh  → the value is injected as current.
//   - present + stale  → last_updated older than the freshness threshold → staleness SURFACED (#3).
//   - absent/unset     → omitted/empty, the gap observable — never a stale baked-in value stands in.

/** A row of the operator-editable dynamic_field_values store (schema §5). `null` value = declared but unset. */
export interface DynamicFieldValue {
  field_name: string;
  field_value: string | null;
  /** epoch seconds when the operator last set this value (mirrors the `last_updated timestamptz`). */
  last_updated: number;
}

export type DynamicFieldState = 'present_fresh' | 'present_stale' | 'unset';

/**
 * The resolution of a single declared dynamic field for assembly. This is what ISSUE-053 reads at
 * assembly time; this slice defines the resolution + the staleness/omission semantics it must obey.
 */
export interface ResolvedDynamicField {
  field_name: string;
  /** The value to inject, or null when unset (AC-4.BIZ.003.2 — omitted/empty, never a stale baked value). */
  value: string | null;
  state: DynamicFieldState;
  /** True iff `state==='present_stale'` — the operator MUST be shown this (AC-4.BIZ.003.3, required not optional). */
  stale: boolean;
  /** age in seconds of the value at resolution time (now - last_updated); null when unset. */
  age_seconds: number | null;
  last_updated: number | null;
}

/**
 * Resolve ONE config-declared dynamic field against the operator-editable store at assembly time.
 * @param fieldName    the declared dynamic-field key.
 * @param stored       the row from dynamic_field_values for this key, or null/undefined if never set.
 * @param freshnessThresholdSeconds  `dynamic_field_freshness_threshold` — a value older than this is stale.
 * @param now          assembly time (epoch seconds).
 *
 * AC-4.BIZ.003.1 — the value is read from the store (this call is the read); it is NOT the static-config value.
 * AC-4.BIZ.003.2 — a declared field with no value set (missing row OR row with null value) resolves to
 *   `value:null, state:'unset'` — the field is omitted/empty and the gap is observable (state !== present).
 * AC-4.BIZ.003.3 — a present value whose age exceeds the threshold resolves `stale:true` — surfaced,
 *   required not optional; it is never returned looking like a fresh/current value (#3).
 */
export function resolveDynamicField(
  fieldName: string,
  stored: DynamicFieldValue | null | undefined,
  freshnessThresholdSeconds: number,
  now: number,
): ResolvedDynamicField {
  if (freshnessThresholdSeconds <= 0 || !Number.isFinite(freshnessThresholdSeconds)) {
    throw new Error(`dynamic_field_freshness_threshold must be a positive finite number of seconds (got ${freshnessThresholdSeconds})`);
  }
  // Unset: no row, or a row whose value is null/empty. Either way the field carries no live value.
  if (stored == null || stored.field_value == null || stored.field_value === '') {
    return {
      field_name: fieldName,
      value: null,
      state: 'unset',
      stale: false,
      age_seconds: null,
      last_updated: stored?.last_updated ?? null,
    };
  }
  const age = now - stored.last_updated;
  const stale = age > freshnessThresholdSeconds;
  return {
    field_name: fieldName,
    value: stored.field_value,
    state: stale ? 'present_stale' : 'present_fresh',
    stale,
    age_seconds: age,
    last_updated: stored.last_updated,
  };
}

// ── FR-4.TSK.001 — the Layer-4 task content contract ────────────────────────────────────────────────
// Layer 4 carries: instruction, parameters, constraints, and an EXPLICITLY specified expected output
// format. Output format is ALWAYS specified — never left implicit. A Layer 4 with no output_format is
// flagged incomplete (AC-4.TSK.001.1).
export interface Layer4Task {
  instruction: string;
  parameters: Record<string, string>;
  constraints: string[];
  /** The explicit expected output format. Empty/whitespace/absent ⇒ the Layer 4 is INCOMPLETE. */
  output_format: string;
}

export interface Layer4Validation {
  complete: boolean;
  /** The reasons it is incomplete; empty when complete. */
  problems: string[];
}

/**
 * Validate a Layer-4 record. The load-bearing rule (AC-4.TSK.001.1): an explicit expected output format
 * MUST be present; a Layer 4 with no specified output format is flagged incomplete — never silently
 * accepted as if a default format were assumed.
 */
export function validateLayer4(task: {
  instruction?: string | null;
  output_format?: string | null;
}): Layer4Validation {
  const problems: string[] = [];
  if (task.instruction == null || task.instruction.trim() === '') {
    problems.push('instruction is required (FR-4.TSK.001)');
  }
  if (task.output_format == null || task.output_format.trim() === '') {
    // The #3-adjacent rule: output format is never implicit. A missing format is a LOUD incompleteness,
    // not a silent "assume prose".
    problems.push('explicit expected output format is required — a Layer 4 with no output format is incomplete (AC-4.TSK.001.1)');
  }
  return { complete: problems.length === 0, problems };
}

// ── FR-4.TSK.002 — task templates (stored) → instantiate to a complete Layer 4 ──────────────────────
// A task template is a prompt_layers row with layer='task_template' holding parameter SLOTS written
// `{slot_name}`. Instantiating it with runtime parameters fills every slot to produce a complete Layer 4;
// a slot with no supplied parameter is a LOUD failure (never a half-filled prompt with a raw `{slot}` leak).

const SLOT_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/** The distinct slot names a template body references, in first-seen order. */
export function templateSlots(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(SLOT_RE)) {
    const name = m[1]!;
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

export interface TaskTemplate {
  /** The instruction body with `{slot}` markers. */
  instruction: string;
  /** The output-format body; MAY also carry slots. Must be non-empty per FR-4.TSK.001 once instantiated. */
  output_format: string;
  constraints: string[];
}

/**
 * Instantiate a task template with runtime parameters → a complete Layer 4 (AC-4.TSK.002.1: ALL slots
 * filled). Every `{slot}` across instruction, output_format, and constraints must have a supplied value;
 * a missing slot value throws (no raw `{slot}` ever survives into the produced Layer 4). Extra unused
 * parameters are allowed (a template need not consume every runtime param).
 */
export function instantiateTemplate(
  template: TaskTemplate,
  params: Record<string, string>,
): Layer4Task {
  const bodies = [template.instruction, template.output_format, ...template.constraints];
  const required = new Set<string>();
  for (const b of bodies) for (const s of templateSlots(b)) required.add(s);

  const missing = [...required].filter((s) => !(s in params) || params[s] == null);
  if (missing.length > 0) {
    throw new Error(
      `task template instantiation missing parameter(s) for slot(s): ${missing.sort().join(', ')} — a Layer 4 must have ALL slots filled (AC-4.TSK.002.1)`,
    );
  }

  const fill = (body: string): string => body.replace(SLOT_RE, (_m, name: string) => params[name]!);

  const filled: Layer4Task = {
    instruction: fill(template.instruction),
    output_format: fill(template.output_format),
    constraints: template.constraints.map(fill),
    parameters: { ...params },
  };
  // Belt-and-braces: no raw TEMPLATE slot may survive a fill pass (guards a regex/logic gap in `fill`).
  // logic-sweep fix (context.ts:264): scan the ORIGINAL template bodies with the slot matcher (the same
  // source `templateSlots`/`required` derive from) — every such slot was already proven present in `params`
  // above, so any slot the fill pass fails to substitute is a genuine leak. The previous guard re-scanned
  // the POST-FILL bodies, where a `{word}` coming from an operator-supplied PARAMETER VALUE (e.g. a theme
  // name or a JSON snippet) is indistinguishable from an unfilled slot, and was falsely rejected.
  const surviving = bodies.flatMap((b) => templateSlots(b)).find((name) => !(name in params));
  if (surviving !== undefined) {
    throw new Error(`unfilled slot leaked into an instantiated Layer 4 — refusing to produce a half-filled prompt: {${surviving}}`);
  }
  // logic-sweep fix (context.ts:254): the all-slots-filled gate accepts an EMPTY-string slot value (''
  // is not null), so a template can instantiate with a blank instruction/output_format and slip past —
  // producing a Layer 4 that validateLayer4 flags incomplete. instantiateTemplate advertises a COMPLETE
  // Layer 4 (FR-4.TSK.001), so validate the assembled result and fail LOUD rather than hand back an
  // incomplete one with no explicit output format (the 'assume prose' silent gap #3, AC-4.TSK.001.1).
  const validation = validateLayer4(filled);
  if (!validation.complete) {
    throw new Error(
      `task template instantiation produced an INCOMPLETE Layer 4 — refusing to return it: ${validation.problems.join('; ')}`,
    );
  }
  return filled;
}
