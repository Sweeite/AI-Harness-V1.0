// ISSUE-059 — the InjectionPipeline PORT + in-memory fake reference model (the house port+fake pattern,
// cf. app/config-store store.ts, app/observability). Every live side effect (the prompt_injection
// guardrail_log write, the injection_quarantine retain, the task pause+flag, the review resolution, the
// staleness escalation) goes through this port so the 4-step pipeline stays unit-testable with NO live DB.
// The in-memory fake is BOTH the test double AND the reference model the live pg adapter (supabase-store.ts)
// must match, authored to the injection_quarantine DDL (schema.md §7 Guardrails) + the guardrail_log write
// contract (ISSUE-060 owns the guardrail_log table + append-only invariant; this slice WRITES prompt_injection
// rows against it).
//
// The four steps, in order (FR-6.INJ.001, the single ordered entry point sanitize()):
//   1a  regex tripwires (FR-6.INJ.002) — ALWAYS ON.
//   1b  semantic scan (FR-6.INJ.003)   — OFF at boot; flag-only above injection_semantic_threshold.
//   2   <external_data> boundary wrap (FR-6.INJ.004) — sanitize-then-tag-then-inject ordering.
//   3   log (FR-6.INJ.005) — EVERY match writes exactly one prompt_injection guardrail_log row.
//   4   quarantine (FR-6.INJ.006) — above injection_quarantine_threshold OR a high-confidence literal when
//       semantic is off (OD-066): RETAIN content (never machine-discarded, #1), pause + set flagged, route
//       to a human; human-only discard/include; escalate a stale review (#3).
//
// The non-negotiables enforced in the fake EXACTLY as the DB/contract would (so a test against the fake
// proves the contract the live silo must uphold):
//   #1 — quarantined_content is RETAINED, never machine-deleted. There is deliberately NO port method that
//        deletes a quarantine row; discard is a HUMAN decision recorded on the row, content stays.
//   #2 — a quarantined read NEVER reaches a prompt without an explicit human include; detection is a signal,
//        the safety property is that quarantined content is held out of the task by code.
//   #3 — every match is logged (never silently passed); a stale review escalates (never silently abandoned).

import { validateConfig, type InjectionConfig } from './config.ts';
import { regexScan, PATTERN_LIBRARY_VERSION, type RegexMatch } from './patterns.ts';
import { wrapExternalData, isBoundaryWrapped, type Provenance } from './boundary.ts';
import type { SemanticScorer } from './semantic.ts';

// ── guardrail_log (schema.md §7 — table + append-only owned by ISSUE-060; we write prompt_injection rows) ─
export type GuardrailType =
  | 'hard_limit'
  | 'approval_gate'
  | 'anomaly'
  | 'rate_limit'
  | 'prompt_injection';

export interface GuardrailLogRow {
  id: string;
  task_id: string | null;
  guardrail_type: GuardrailType; // always 'prompt_injection' from this slice
  description: string; // source tool+record, matched pattern, action taken (FR-6.INJ.005)
  action_blocked: boolean; // true iff the read was quarantined (held out of the task)
  status: 'pending' | 'approved' | 'rejected' | 'modified';
  reviewed_by: string | null;
  reviewed_at: string | null;
  escalated_at: string | null;
  created_at: string;
}

// ── injection_quarantine (schema.md §7 — net-new; lands in the ISSUE-060 0009_guardrails migration) ─
export type QuarantineDecision = 'discard' | 'approved_safe'; // null = pending
export interface QuarantineRow {
  id: string;
  guardrail_log_id: string; // FK → guardrail_log(id)
  quarantined_content: string; // NEVER machine-discarded (#1)
  source_tool: string;
  source_record_id: string | null;
  human_decision: QuarantineDecision | null; // null = pending
  reviewed_by: string | null;
  reviewed_at: string | null;
  escalated_at: string | null;
  created_at: string;
}

/** The task-state seam (FR-6.ESC.001, owned by ISSUE-056): a quarantine pauses the task + sets `flagged`. */
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'flagged';

/** Provenance of the tool read entering the pipeline (from the connector runtime, ISSUE-032). */
export interface ToolRead {
  task_id: string | null;
  content: string;
  provenance: Provenance;
}

/** The outcome of running the 4-step pipeline on one tool read. */
export interface PipelineOutcome {
  /** The <external_data>-wrapped payload the harness may inject — PRESENT iff not quarantined. */
  wrapped: string | null;
  /** True iff the read was quarantined (held out of the task, task flagged). */
  quarantined: boolean;
  /** The quarantine row id, if quarantined. */
  quarantineId: string | null;
  /** The guardrail_log row ids written this run (one per distinct match). */
  logIds: string[];
  /** The combined signal score used against the quarantine bar (regex-derived + semantic). */
  score: number;
  /** The regex matches (the always-on deterministic layer). */
  regexMatches: RegexMatch[];
  /** The semantic score if the scan ran (else null — scan OFF at boot). */
  semanticScore: number | null;
}

export interface SanitizeRequest {
  read: ToolRead;
  /** epoch seconds — deterministic clock (house discipline; no Date.now()). */
  now: number;
}

export const ERR_QUARANTINE_NO_DELETE =
  'injection_quarantine: content is retained, never machine-discarded (ADR-007 §4 / #1) — discard is a human-only decision recorded on the row';
export const ERR_INCLUDE_WITHOUT_APPROVAL =
  'injection_quarantine: task never proceeds with quarantined content without explicit human approval (AC-6.INJ.006.2)';
/** Raised by the fake's modelled guardrail_log append-only trigger when an in-place UPDATE is not one of the
 *  two whitelisted mutations (forward status transition OR the OD-182 monotonic escalation stamp). Mirrors the
 *  live `enforce_audit_append_only()` exception so a rejected mutation fails the SAME way fake-side as DDL-side. */
export const ERR_GUARDRAIL_LOG_APPEND_ONLY =
  "audit sink guardrail_log: in-place UPDATE forbidden (append-only / tamper-evident)";

// ── the modelled guardrail_log append-only trigger (fake == live DDL) ────────────────────────────────────
// The live `enforce_audit_append_only()` (app/silo/migrations/0001_baseline.sql L688) fires BEFORE UPDATE on
// guardrail_log and permits ONLY a whitelisted in-place mutation. Per OD-182 the DDL trigger is being WIDENED
// to permit, in addition to the forward status transition, a MONOTONIC escalation stamp. The fake MUST model
// the EXACT widened rule so a test against the fake proves the mutation the live silo will actually accept —
// otherwise the fake hides drift the verifier caught (the fake previously had NO trigger at all).
//
// Permitted UPDATEs (everything else throws):
//   (A) Forward status transition — old.status='pending' → new.status ∈ {approved,rejected,modified};
//       description, task_id, guardrail_type unchanged.
//   (B) OD-182 monotonic escalation stamp — old.escalated_at IS NULL and new.escalated_at IS NOT NULL;
//       status UNCHANGED (stays 'pending'); description/task_id/guardrail_type/reviewed_by/reviewed_at
//       UNCHANGED; action_blocked unchanged OR false→true. No other column may move.
/** Validate an in-place guardrail_log mutation against the OD-182-widened append-only rule; throw if forbidden.
 *  `next` is the fully-formed post-image; `prev` is the current row. Returns nothing — mutating is the caller's
 *  job AFTER this gate passes (as the DB does the mutation only when the BEFORE-trigger returns NEW). */
export function enforceGuardrailLogAppendOnly(prev: GuardrailLogRow, next: GuardrailLogRow): void {
  // Columns that must NEVER move in ANY permitted UPDATE.
  if (next.id !== prev.id || next.task_id !== prev.task_id || next.guardrail_type !== prev.guardrail_type
      || next.description !== prev.description || next.created_at !== prev.created_at) {
    throw new Error(ERR_GUARDRAIL_LOG_APPEND_ONLY);
  }
  // (A) forward status transition (the review-resolution path).
  const forwardStatus =
    prev.status === 'pending'
    && (next.status === 'approved' || next.status === 'rejected' || next.status === 'modified');
  if (forwardStatus) return;

  // (B) OD-182 monotonic escalation stamp (the staleness path). Status stays 'pending'; only escalated_at
  //     (and optionally action_blocked false→true) moves; reviewed_by/reviewed_at are untouched.
  const escalationStamp =
    prev.escalated_at === null
    && next.escalated_at !== null
    && next.status === prev.status // unchanged (stays 'pending')
    && next.reviewed_by === prev.reviewed_by
    && next.reviewed_at === prev.reviewed_at
    && (next.action_blocked === prev.action_blocked || (prev.action_blocked === false && next.action_blocked === true));
  if (escalationStamp) return;

  throw new Error(ERR_GUARDRAIL_LOG_APPEND_ONLY);
}

// The port. Sync-shaped in the fake, async-modelled for the DB adapter.
export interface InjectionPipeline {
  /** The single ordered entry point (FR-6.INJ.001) the harness invokes between tool-read and AI-call. */
  sanitize(req: SanitizeRequest): Promise<PipelineOutcome>;

  /** A human reviewer's discard decision (FR-6.INJ.006.2): logged who/when; content STAYS retained (#1). */
  reviewDiscard(quarantineId: string, reviewer: string, now: number): Promise<QuarantineRow>;
  /** A human reviewer's include decision (FR-6.INJ.006.2): admits the content ONLY after explicit approval. */
  reviewInclude(quarantineId: string, reviewer: string, now: number): Promise<{ row: QuarantineRow; wrapped: string }>;

  /** Escalate every quarantine review un-actioned past the timeout (FR-6.ESC.004 / AC-6.INJ.006.4). */
  escalateStale(timeoutSeconds: number, now: number): Promise<QuarantineRow[]>;

  /** The current task status (the fake tracks it; the live adapter reads task_queue). */
  taskStatus(taskId: string): TaskStatus | undefined;
}

// ───────────────────────────────────────────────────────────────────────────────
// In-memory fake — the reference model. Deterministic: a logical `now` (epoch seconds) is supplied by the
// caller; no Date.now()/random. The semantic scorer is injected and only ever consulted when the config
// flag is on (the OFF-by-default guarantee is enforced HERE, not in the scorer).
// ───────────────────────────────────────────────────────────────────────────────
export class InMemoryInjectionPipeline implements InjectionPipeline {
  private seq = 0;
  readonly config: Readonly<InjectionConfig>;
  private readonly scorer: SemanticScorer | undefined;

  readonly guardrailLog: GuardrailLogRow[] = [];
  readonly quarantine: QuarantineRow[] = [];
  /** task_id → status (the C5 task_queue mirror; a quarantine flips it to `flagged`). */
  readonly taskStates = new Map<string, TaskStatus>();

  constructor(config: InjectionConfig, scorer?: SemanticScorer) {
    this.config = validateConfig(config);
    this.scorer = scorer;
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  taskStatus(taskId: string): TaskStatus | undefined {
    return this.taskStates.get(taskId);
  }

  // ── the single ordered 4-step entry point (FR-6.INJ.001) ──
  async sanitize(req: SanitizeRequest): Promise<PipelineOutcome> {
    const { read, now } = req;

    // Step 1a — regex tripwires, ALWAYS ON (FR-6.INJ.002).
    const regexMatches = regexScan(read.content);

    // Step 1b — semantic scan, ONLY if enabled (OFF at boot, FR-6.INJ.003 / AC-6.INJ.003.1). Flag-only.
    let semanticScore: number | null = null;
    if (this.config.injection_semantic_detection_enabled) {
      // A deployment that turns the scan on without wiring a scorer is a config error, not a silent no-op (#3).
      if (!this.scorer) {
        throw new Error(
          'injection_semantic_detection_enabled=true but no SemanticScorer wired — refusing to run a blind semantic scan (#3)',
        );
      }
      semanticScore = this.scorer(read.content);
    }

    // Combined signal score. Regex contributes a deterministic high-confidence weight; the semantic score is
    // ADDITIVE (never the sole driver of quarantine, AC-6.INJ.003.2). Cap at 1.
    const regexHigh = regexMatches.some((m) => m.highConfidence);
    const regexScoreComponent = regexHigh ? 0.96 : regexMatches.length > 0 ? 0.5 : 0;
    const score = Math.min(1, Math.max(regexScoreComponent, semanticScore ?? 0));

    // Decide quarantine: above the quarantine bar OR a high-confidence literal when semantic is off (OD-066).
    // The deterministic layer STANDS ALONE with semantic off (AC-6.INJ.006.3).
    const quarantineByScore = score >= this.config.injection_quarantine_threshold;
    const quarantineByLiteral = regexHigh; // a high-confidence literal quarantines on the regex layer alone
    const shouldQuarantine = quarantineByScore || quarantineByLiteral;

    // Step 3 — log EVERY match (FR-6.INJ.005): exactly one prompt_injection row per distinct match, plus a
    // synthetic "semantic" match row when the semantic scan alone crossed the flag bar with no regex hit.
    const logIds: string[] = [];
    const matchDescriptors = this.buildMatchDescriptors(regexMatches, semanticScore);
    for (const md of matchDescriptors) {
      const row = this.appendGuardrailLog(read, md, shouldQuarantine, now);
      logIds.push(row.id);
    }

    if (!shouldQuarantine) {
      // Step 2 — boundary-wrap ordering (FR-6.INJ.004): a clean (or merely flagged-not-quarantined) read is
      // wrapped in <external_data> before it may reach a prompt. Un-tagged tool content never reaches a
      // prompt layer (AC-6.INJ.001.1 / AC-6.INJ.004.1 / AC-NFR-SEC.007.1).
      const wrapped = wrapExternalData(read.content, read.provenance);
      return {
        wrapped,
        quarantined: false,
        quarantineId: null,
        logIds,
        score,
        regexMatches,
        semanticScore,
      };
    }

    // Step 4 — quarantine (FR-6.INJ.006): RETAIN content, pause + flag the task, route to a human. The
    // wrapped payload is WITHHELD (null) — the task never proceeds with quarantined content (#2).
    const logRowId = logIds[0] ?? this.appendGuardrailLog(read, matchDescriptors[0] ?? { patternId: 'unknown', literal: 'unknown', highConfidence: false }, true, now).id;
    const qrow: QuarantineRow = {
      id: this.nextId('quar'),
      guardrail_log_id: logRowId,
      quarantined_content: read.content, // RETAINED — never machine-discarded (#1)
      source_tool: read.provenance.source_tool,
      source_record_id: read.provenance.source_record_id ?? null,
      human_decision: null, // pending a human
      reviewed_by: null,
      reviewed_at: null,
      escalated_at: null,
      created_at: this.iso(now),
    };
    this.quarantine.push(qrow);

    // Pause + set flagged via FR-6.ESC.001 (owned by ISSUE-056). No further step runs until the flag resolves.
    if (read.task_id) this.taskStates.set(read.task_id, 'flagged');

    return {
      wrapped: null, // WITHHELD — quarantined content never reaches a prompt without human include (#2)
      quarantined: true,
      quarantineId: qrow.id,
      logIds,
      score,
      regexMatches,
      semanticScore,
    };
  }

  /** Assemble the per-match descriptors that each get exactly one guardrail_log row (FR-6.INJ.005). */
  private buildMatchDescriptors(
    regexMatches: RegexMatch[],
    semanticScore: number | null,
  ): Array<{ patternId: string; literal: string; highConfidence: boolean }> {
    const descriptors = regexMatches.map((m) => ({ patternId: m.patternId, literal: m.literal, highConfidence: m.highConfidence }));
    // If the semantic scan flagged (>= its threshold) and there was NO regex hit, that is itself a match to
    // log — a semantic-only flag is never silently unlogged (#3).
    if (
      semanticScore !== null &&
      semanticScore >= this.config.injection_semantic_threshold &&
      regexMatches.length === 0
    ) {
      descriptors.push({ patternId: 'semantic-similarity', literal: `semantic score ${semanticScore.toFixed(2)}`, highConfidence: false });
    }
    return descriptors;
  }

  private appendGuardrailLog(
    read: ToolRead,
    match: { patternId: string; literal: string; highConfidence: boolean },
    quarantined: boolean,
    now: number,
  ): GuardrailLogRow {
    const row: GuardrailLogRow = {
      id: this.nextId('glog'),
      task_id: read.task_id,
      guardrail_type: 'prompt_injection',
      description: JSON.stringify({
        source_tool: read.provenance.source_tool,
        source_record_id: read.provenance.source_record_id ?? null,
        matched_pattern: match.patternId,
        matched_literal: match.literal,
        trigger_excerpt: read.content.slice(0, 200),
        action: quarantined ? 'quarantined' : 'sanitised',
        pattern_library_version: PATTERN_LIBRARY_VERSION,
      }),
      action_blocked: quarantined,
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      escalated_at: null,
      created_at: this.iso(now),
    };
    this.guardrailLog.push(row);
    return row;
  }

  private mustQuarantine(id: string): QuarantineRow {
    const row = this.quarantine.find((q) => q.id === id);
    if (!row) throw new Error(`no such quarantine row ${id}`);
    return row;
  }

  // ── human review (FR-6.INJ.006.2) — human-only decisions, content always retained ──
  async reviewDiscard(quarantineId: string, reviewer: string, now: number): Promise<QuarantineRow> {
    const row = this.mustQuarantine(quarantineId);
    if (row.human_decision !== null) throw new Error(`quarantine ${quarantineId} already resolved (${row.human_decision})`);
    // Discard = the task continues WITHOUT the content — but the content is RETAINED (#1). We record the
    // human decision (who/when) on the row; we NEVER delete quarantined_content.
    row.human_decision = 'discard';
    row.reviewed_by = reviewer;
    row.reviewed_at = this.iso(now);
    this.resolveLog(row, 'rejected', reviewer, now); // the read stays blocked (not admitted)
    return row;
  }

  async reviewInclude(quarantineId: string, reviewer: string, now: number): Promise<{ row: QuarantineRow; wrapped: string }> {
    const row = this.mustQuarantine(quarantineId);
    if (row.human_decision !== null) throw new Error(`quarantine ${quarantineId} already resolved (${row.human_decision})`);
    // Include = manually approved safe. ONLY now may the content be admitted — and only via the boundary
    // wrap (it is still external data). Explicit human approval is the sole path (AC-6.INJ.006.2 / #2).
    row.human_decision = 'approved_safe';
    row.reviewed_by = reviewer;
    row.reviewed_at = this.iso(now);
    this.resolveLog(row, 'approved', reviewer, now);
    const wrapped = wrapExternalData(row.quarantined_content, {
      source_tool: row.source_tool,
      timestamp: this.iso(now),
      source_record_id: row.source_record_id ?? undefined,
    });
    return { row, wrapped };
  }

  private resolveLog(qrow: QuarantineRow, status: 'approved' | 'rejected', reviewer: string, now: number): void {
    const log = this.guardrailLog.find((l) => l.id === qrow.guardrail_log_id);
    if (log) {
      // Route through the modelled append-only trigger (fake == live DDL): a forward status transition is the
      // permitted (A) mutation. Build the post-image, let the trigger accept/reject, THEN apply (as the DB does).
      const next: GuardrailLogRow = { ...log, status, reviewed_by: reviewer, reviewed_at: this.iso(now) };
      enforceGuardrailLogAppendOnly(log, next); // throws if this were not a whitelisted mutation
      Object.assign(log, next);
    }
  }

  // ── staleness (FR-6.ESC.004 / AC-6.INJ.006.4) — never silently abandoned ──
  async escalateStale(timeoutSeconds: number, now: number): Promise<QuarantineRow[]> {
    const escalated: QuarantineRow[] = [];
    for (const row of this.quarantine) {
      if (row.human_decision !== null) continue; // already resolved
      if (row.escalated_at !== null) continue; // already escalated (don't loop silently — AC-6.ESC.004.2)
      const ageSeconds = now - Math.floor(Date.parse(row.created_at) / 1000);
      if (ageSeconds < timeoutSeconds) continue;
      // PRIMARY: stamp the quarantine escalation FIRST and unconditionally. A stale quarantine must ALWAYS be
      // escalatable — the retained content can never be silently abandoned (#1/#3), so this stamp is never
      // gated on the audit-mirror below.
      row.escalated_at = this.iso(now);
      escalated.push(row);
      // MIRROR (defense-in-depth, best-effort): also stamp the guardrail_log row so the audit trail shows the
      // escalation (never silent, #3). This is the OD-182 (B) monotonic-escalation-stamp UPDATE. It is routed
      // through the modelled append-only trigger — and if the trigger REJECTS it, we swallow the mirror error
      // so a single rejected mirror can NEVER roll back the primary quarantine escalation just stamped above.
      this.mirrorEscalationBestEffort(row.guardrail_log_id, now);
    }
    return escalated;
  }

  /** Best-effort audit mirror of an escalation onto the guardrail_log row (OD-182 (B)). Isolated + catching so
   *  a rejected mirror never unwinds the primary injection_quarantine escalation (a stale quarantine must
   *  ALWAYS escalate, #1/#3). */
  private mirrorEscalationBestEffort(guardrailLogId: string, now: number): void {
    try {
      const log = this.guardrailLog.find((l) => l.id === guardrailLogId);
      if (!log) return;
      const next: GuardrailLogRow = { ...log, escalated_at: this.iso(now) };
      // Route through the modelled append-only trigger (fake == live DDL). OD-182 (B) permits the stamp iff
      // escalated_at was NULL and status/description/etc are unchanged; an already-stamped (non-monotonic) or
      // otherwise-frozen row is REJECTED here — and that rejection is swallowed below, never a rollback.
      enforceGuardrailLogAppendOnly(log, next);
      Object.assign(log, next);
    } catch {
      // Swallow: the primary quarantine escalation already stands. The mirror is audit best-effort — never a
      // gate on the safety-critical escalation of retained content.
    }
  }

  // ── test/contract hook — the retain-not-discard invariant made explicit (#1) ──
  /** There is deliberately no delete-quarantine method on the port. This hook proves the contract: any
   * attempt to machine-discard quarantined content throws (mirrors ADR-007 §4 — discard is human-only). */
  attemptMachineDiscard(_quarantineId: string): never {
    throw new Error(ERR_QUARANTINE_NO_DELETE);
  }

  /** True iff EVERY quarantine row still retains its content (the #1 sink-wide assertion). */
  allContentRetained(): boolean {
    return this.quarantine.every((q) => typeof q.quarantined_content === 'string' && q.quarantined_content.length >= 0);
  }
}

export { isBoundaryWrapped };
