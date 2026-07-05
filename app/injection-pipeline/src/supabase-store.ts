// ISSUE-059 — the LIVE InjectionPipeline adapter (pg, against the client-owned silo Supabase). The only
// module that imports `pg`. It implements the same port as InMemoryInjectionPipeline against the real DDL:
//   - guardrail_log (schema.md §7 — append-only; table + invariant OWNED BY ISSUE-060; we only INSERT
//     prompt_injection rows and UPDATE (a) status/reviewed_by/reviewed_at on resolution [forward status
//     transition] and (b) escalated_at on staleness [the OD-182 monotonic escalation stamp: status unchanged,
//     escalated_at NULL→now(), nothing else moves] — both permitted by the widened enforce_audit_append_only()).
//   - injection_quarantine (schema.md §7 — NET-NEW; the table + its FK to guardrail_log(id) LAND IN THE
//     ISSUE-060 migration 0009_guardrails, NOT here — this slice authors NO migration, per its build order).
//   - task_queue.status (schema.md §5 — flip to 'flagged' via FR-6.ESC.001, owned by ISSUE-056; we only SET
//     it on quarantine).
//
// ⚠️ NOT YET RUN LIVE. The injection_quarantine table does not exist until 0009_guardrails (ISSUE-060)
// applies; the guardrail_log append-only trigger actually permitting the resolution UPDATE while rejecting a
// content DELETE, the FK actually binding a quarantine row to its log row, and the task flip actually pausing
// the run are proven at the C6 integration checkpoint AFTER 0009 lands — NOT by this package. This adapter is
// authored to the DDL so the seam is real and typechecks; InMemoryInjectionPipeline is the proven reference
// model. Do NOT claim these paths verified until the checkpoint records evidence.
//
// The non-negotiables at the SQL layer:
//   #1 — a quarantine NEVER issues a DELETE/UPDATE that clears quarantined_content. Discard sets
//        human_decision='discard' + reviewed_by/at; the content column is never touched.
//   #2 — sanitize() returns wrapped=null on quarantine; the caller (harness) gets no payload to inject.
//   #3 — every match INSERTs a prompt_injection row; a stale review UPDATEs escalated_at (loud, not silent).

import pg from 'pg';
import { validateConfig, type InjectionConfig } from './config.ts';
import { regexScan, PATTERN_LIBRARY_VERSION, type RegexMatch } from './patterns.ts';
import { wrapExternalData } from './boundary.ts';
import type { SemanticScorer } from './semantic.ts';
import type {
  InjectionPipeline,
  PipelineOutcome,
  QuarantineRow,
  SanitizeRequest,
  TaskStatus,
} from './store.ts';

export class SupabaseInjectionPipeline implements InjectionPipeline {
  private pool: pg.Pool;
  private readonly config: Readonly<InjectionConfig>;
  private readonly scorer: SemanticScorer | undefined;

  constructor(connectionString: string, config: InjectionConfig, scorer?: SemanticScorer) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
    this.config = validateConfig(config);
    this.scorer = scorer;
  }

  async sanitize(req: SanitizeRequest): Promise<PipelineOutcome> {
    const { read } = req;
    const regexMatches = regexScan(read.content);

    let semanticScore: number | null = null;
    if (this.config.injection_semantic_detection_enabled) {
      if (!this.scorer) throw new Error('injection_semantic_detection_enabled=true but no SemanticScorer wired (#3)');
      semanticScore = this.scorer(read.content);
    }

    const regexHigh = regexMatches.some((m) => m.highConfidence);
    const regexScoreComponent = regexHigh ? 0.96 : regexMatches.length > 0 ? 0.5 : 0;
    const score = Math.min(1, Math.max(regexScoreComponent, semanticScore ?? 0));
    const shouldQuarantine = score >= this.config.injection_quarantine_threshold || regexHigh;

    const descriptors = this.descriptors(regexMatches, semanticScore);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const logIds: string[] = [];
      for (const d of descriptors) {
        const res = await client.query<{ id: string }>(
          `insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
           values ($1, 'prompt_injection', $2, $3, 'pending')
           returning id`,
          [read.task_id, this.describe(read, d, shouldQuarantine), shouldQuarantine],
        );
        logIds.push(res.rows[0]!.id);
      }

      if (!shouldQuarantine) {
        await client.query('commit');
        return {
          wrapped: wrapExternalData(read.content, read.provenance),
          quarantined: false,
          quarantineId: null,
          logIds,
          score,
          regexMatches,
          semanticScore,
        };
      }

      // Quarantine: RETAIN content (never machine-discarded, #1); the FK binds it to its log row. The
      // injection_quarantine table lands in 0009_guardrails (ISSUE-060) — this INSERT is authored to that DDL.
      const qres = await client.query<{ id: string }>(
        `insert into injection_quarantine
           (guardrail_log_id, quarantined_content, source_tool, source_record_id)
         values ($1, $2, $3, $4)
         returning id`,
        [logIds[0]!, read.content, read.provenance.source_tool, read.provenance.source_record_id ?? null],
      );
      // Pause + flag the task (FR-6.ESC.001, owned by ISSUE-056). No further step runs until resolved.
      if (read.task_id) {
        await client.query(`update task_queue set status = 'flagged' where id = $1`, [read.task_id]);
      }
      await client.query('commit');
      return {
        wrapped: null, // WITHHELD (#2)
        quarantined: true,
        quarantineId: qres.rows[0]!.id,
        logIds,
        score,
        regexMatches,
        semanticScore,
      };
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  private descriptors(regexMatches: RegexMatch[], semanticScore: number | null) {
    const d = regexMatches.map((m) => ({ patternId: m.patternId, literal: m.literal }));
    if (semanticScore !== null && semanticScore >= this.config.injection_semantic_threshold && regexMatches.length === 0) {
      d.push({ patternId: 'semantic-similarity', literal: `semantic score ${semanticScore.toFixed(2)}` });
    }
    return d;
  }

  private describe(read: SanitizeRequest['read'], d: { patternId: string; literal: string }, quarantined: boolean): string {
    return JSON.stringify({
      source_tool: read.provenance.source_tool,
      source_record_id: read.provenance.source_record_id ?? null,
      matched_pattern: d.patternId,
      matched_literal: d.literal,
      trigger_excerpt: read.content.slice(0, 200),
      action: quarantined ? 'quarantined' : 'sanitised',
      pattern_library_version: PATTERN_LIBRARY_VERSION,
    });
  }

  async reviewDiscard(quarantineId: string, reviewer: string, _now: number): Promise<QuarantineRow> {
    // Human-only discard: record who/when; the content column is NEVER touched (#1).
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const res = await client.query<QuarantineRow>(
        `update injection_quarantine
           set human_decision = 'discard', reviewed_by = $2, reviewed_at = now()
         where id = $1 and human_decision is null
         returning *`,
        [quarantineId, reviewer],
      );
      if (res.rowCount === 0) throw new Error(`quarantine ${quarantineId} not found or already resolved`);
      const row = res.rows[0]!;
      await client.query(
        `update guardrail_log set status = 'rejected', reviewed_by = $2, reviewed_at = now() where id = $1`,
        [row.guardrail_log_id, reviewer],
      );
      await client.query('commit');
      return row;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async reviewInclude(quarantineId: string, reviewer: string, _now: number): Promise<{ row: QuarantineRow; wrapped: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const res = await client.query<QuarantineRow>(
        `update injection_quarantine
           set human_decision = 'approved_safe', reviewed_by = $2, reviewed_at = now()
         where id = $1 and human_decision is null
         returning *`,
        [quarantineId, reviewer],
      );
      if (res.rowCount === 0) throw new Error(`quarantine ${quarantineId} not found or already resolved`);
      const row = res.rows[0]!;
      await client.query(
        `update guardrail_log set status = 'approved', reviewed_by = $2, reviewed_at = now() where id = $1`,
        [row.guardrail_log_id, reviewer],
      );
      await client.query('commit');
      const wrapped = wrapExternalData(row.quarantined_content, {
        source_tool: row.source_tool,
        timestamp: new Date().toISOString(),
        source_record_id: row.source_record_id ?? undefined,
      });
      return { row, wrapped };
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async escalateStale(timeoutSeconds: number, _now: number): Promise<QuarantineRow[]> {
    // Every review un-actioned past the timeout escalates (FR-6.ESC.004). The PRIMARY injection_quarantine
    // escalation commits FIRST and on its own — a stale quarantine must ALWAYS be escalatable so the retained
    // content is never silently abandoned (#1/#3). escalated_at set once (won't re-fire — AC-6.ESC.004.2).
    const client = await this.pool.connect();
    let rows: QuarantineRow[];
    try {
      await client.query('begin');
      const res = await client.query<QuarantineRow>(
        `update injection_quarantine
           set escalated_at = now()
         where human_decision is null
           and escalated_at is null
           and created_at < now() - ($1 || ' seconds')::interval
         returning *`,
        [String(timeoutSeconds)],
      );
      await client.query('commit');
      rows = res.rows;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }

    // MIRROR (defense-in-depth, best-effort): stamp the guardrail_log row so the audit trail shows the
    // escalation (loud, #3). This is the OD-182 (B) monotonic-escalation-stamp UPDATE — escalated_at-only,
    // status unchanged (stays 'pending'), the widened enforce_audit_append_only() trigger permits it. Each
    // mirror runs in its OWN statement/txn and its failure is SWALLOWED so a single rejected mirror can NEVER
    // roll back the primary quarantine escalation already committed above (a stale quarantine always escalates).
    for (const row of rows) {
      const mirror = await this.pool.connect();
      try {
        await mirror.query(
          `update guardrail_log set escalated_at = now() where id = $1 and escalated_at is null`,
          [row.guardrail_log_id],
        );
      } catch {
        // Best-effort audit mirror — never a gate on the safety-critical escalation of retained content.
      } finally {
        mirror.release();
      }
    }
    return rows;
  }

  taskStatus(_taskId: string): TaskStatus | undefined {
    // The live adapter would SELECT task_queue.status; kept out of the async port shape used by callers that
    // need a synchronous read. The reference model (InMemoryInjectionPipeline) is the authority for tests.
    return undefined;
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
