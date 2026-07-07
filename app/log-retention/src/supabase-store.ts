// ISSUE-077 — the LIVE pg adapters for the C7 retention/export/tombstone ports, authored to the ISSUE-008
// 0001_baseline DDL (app/silo/migrations/0001_baseline.sql). This is the ONLY module that imports `pg`.
//
// ⚠️ NOT YET RUN LIVE in this offline half. The InMemory* stores (store.ts) are the proven reference model;
// these adapters are the thin translation so the seam is real and typechecks. They will be exercised against a
// real silo Supabase at integration time. Every guarantee the fakes enforce is enforced at the substrate:
//   - the t_append_only trigger rejects any UPDATE except the whitelisted null→non-null redacted_at scrub, and
//     any DELETE except inside a `set local app.retention_prune='on'` transaction (OD-180 / migration 0005);
//   - the guardrail_log redaction-tombstone requires a `redacted_at` column — an ADDITIVE ALTER owed to the
//     orchestrator (see results/proposed-shared-spec.md); this adapter is authored assuming it lands.
//
// Isolation (#2): every table here is a CLIENT-SILO table (schema.md §7/§8) — this reads/writes the silo DB
// (DATABASE_URL), never the management plane. No `client_slug` column exists (OD-067 / FR-10.ISO.001).

import pg from "pg";
import type { EventLogRow, GuardrailLogRow } from "./types.ts";
import { AppendOnlyViolation, type EventLogStore, type GuardrailLogStore } from "./store.ts";

// Postgres error codes we translate to the port's typed errors.
const RESTRICT_VIOLATION = "P0001"; // RAISE EXCEPTION from the append-only trigger

export class SupabaseEventLogStore implements EventLogStore {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async all(): Promise<EventLogRow[]> {
    const { rows } = await this.pool.query<EventLogRow>(
      `select id, task_id, event_type, entity_ids, summary, payload, duration_ms, cost_tokens,
              cost_unknown, answer_mode, redacted_at, created_at
         from event_log order by created_at asc`,
    );
    return rows;
  }

  async redactTombstone(id: string, redactedAt: string): Promise<void> {
    // The ONE whitelisted mutation — the trigger permits null→non-null redacted_at + the in-place scrub.
    try {
      await this.pool.query(
        `update event_log
            set summary = '[redacted]', entity_ids = null, payload = null, redacted_at = $2
          where id = $1 and redacted_at is null`,
        [id, redactedAt],
      );
    } catch (e) {
      if ((e as { code?: string }).code === RESTRICT_VIOLATION) throw new AppendOnlyViolation("event_log", "UPDATE");
      throw e;
    }
  }

  async prune(id: string): Promise<void> {
    // The retention path — permitted ONLY inside a retention-prune transaction (OD-180 / migration 0005).
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local app.retention_prune = 'on'");
      await client.query(`delete from event_log where id = $1`, [id]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      if ((e as { code?: string }).code === RESTRICT_VIOLATION) throw new AppendOnlyViolation("event_log", "DELETE");
      throw e;
    } finally {
      client.release();
    }
  }
}

export class SupabaseGuardrailLogStore implements GuardrailLogStore {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async all(): Promise<GuardrailLogRow[]> {
    const { rows } = await this.pool.query<GuardrailLogRow>(
      `select id, task_id, guardrail_type, description, action_blocked, status, reviewed_by,
              reviewed_at, escalated_at, redacted_at, created_at
         from guardrail_log order by created_at asc`,
    );
    return rows;
  }

  async inRange(fromIso: string, toIso: string): Promise<GuardrailLogRow[]> {
    const { rows } = await this.pool.query<GuardrailLogRow>(
      `select id, task_id, guardrail_type, description, action_blocked, status, reviewed_by,
              reviewed_at, escalated_at, redacted_at, created_at
         from guardrail_log
        where created_at >= $1 and created_at <= $2
        order by created_at asc`,
      [fromIso, toIso],
    );
    return rows;
  }

  async countInRange(fromIso: string, toIso: string): Promise<number> {
    // An INDEPENDENT count(*) — the export reconciles inRange().length against this (all-or-nothing, AF-133).
    const { rows } = await this.pool.query<{ n: string }>(
      `select count(*)::text as n from guardrail_log where created_at >= $1 and created_at <= $2`,
      [fromIso, toIso],
    );
    return Number(rows[0]?.n ?? "0");
  }

  async redactTombstone(id: string, redactedAt: string): Promise<void> {
    try {
      await this.pool.query(
        `update guardrail_log set description = '[redacted]', redacted_at = $2 where id = $1 and redacted_at is null`,
        [id, redactedAt],
      );
    } catch (e) {
      if ((e as { code?: string }).code === RESTRICT_VIOLATION) throw new AppendOnlyViolation("guardrail_log", "UPDATE");
      throw e;
    }
  }

  async prune(id: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local app.retention_prune = 'on'");
      await client.query(`delete from guardrail_log where id = $1`, [id]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      if ((e as { code?: string }).code === RESTRICT_VIOLATION) throw new AppendOnlyViolation("guardrail_log", "DELETE");
      throw e;
    } finally {
      client.release();
    }
  }

  async rewriteContent(id: string, description: string): Promise<void> {
    // There is NO legal in-place content rewrite — the BEFORE-UPDATE trigger rejects it. Authored ONLY so the
    // seam is real. Distinguish the two 0-vs-1-row outcomes so we never fabricate a tamper signal (finding M11):
    let res: { rowCount: number | null };
    try {
      res = await this.pool.query(`update guardrail_log set description = $2 where id = $1`, [id, description]);
    } catch (e) {
      // An EXISTING row trips the per-row BEFORE-UPDATE append-only trigger → RESTRICT_VIOLATION. That is the
      // real, correct rejection of a live-audit content rewrite.
      if ((e as { code?: string }).code === RESTRICT_VIOLATION) throw new AppendOnlyViolation("guardrail_log", "in-place content REWRITE");
      throw e;
    }
    // No exception → the UPDATE matched 0 rows, so the per-row trigger never fired. This is a missing/wrong id,
    // NOT an attempted tamper — report it as such (mirrors the fake's distinct message), don't cry "REWRITE".
    if (res.rowCount === 0) throw new AppendOnlyViolation("guardrail_log", "REWRITE of a nonexistent row");
    // rowCount>0 with no trigger exception = the trigger unexpectedly permitted a content rewrite (can't-happen).
    throw new AppendOnlyViolation("guardrail_log", "in-place content REWRITE");
  }
}
