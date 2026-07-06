// ISSUE-050 (C5 ENV) — the LIVE TaskHistoryStore adapter (pg, against the client-owned silo Supabase). The
// only module that imports `pg`. It implements the same TaskHistoryStore port as InMemoryTaskHistoryStore
// against the REAL baseline DDL (app/silo/migrations/0001_baseline.sql):
//
//   create table task_history (
//     id          uuid primary key default gen_random_uuid(),
//     task_id     uuid not null references task_queue(id) on delete cascade,
//     step_index  int not null,
//     full_output jsonb not null,
//     created_at  timestamptz not null default now(),
//     unique (task_id, step_index)
//   );
//
// ⚠️ NOT YET RUN LIVE. The UNIQUE(task_id, step_index) `on conflict do nothing` first-write-wins behaviour,
// the FK-cascade, and the retention lifetime (AF-115) are proven by the operator at the Stage-4 checkpoint (a
// 💻 full/live env). This adapter is authored to the DDL so the seam is real and typechecks;
// InMemoryTaskHistoryStore is the proven reference model. Do NOT claim these paths verified until the live run
// records evidence.
//
// The three non-negotiables:
//   #1 no delete method exists here either — the port has none. retain() uses `on conflict do nothing`, so a
//      re-retain never OVERWRITES a retained original with different data. Originals are never dropped.
//   #3 retain() fails closed: a DB error propagates; the caller (ContextEnvelopeManager.appendStepOutput)
//      then never appends/summarises/advances (no silent lossy compression).

import pg from 'pg';
import type { TaskHistoryStore } from './store.ts';

export class SupabaseTaskHistoryStore implements TaskHistoryStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async retain(taskId: string, stepIndex: number, fullOutput: unknown): Promise<void> {
    // UNIQUE(task_id, step_index): `on conflict do nothing` mirrors the fake's first-write-wins — never an
    // overwrite of an already-retained original (#1). full_output is `jsonb not null`.
    await this.pool.query(
      `insert into task_history (task_id, step_index, full_output)
       values ($1, $2, $3::jsonb)
       on conflict (task_id, step_index) do nothing`,
      [taskId, stepIndex, JSON.stringify(fullOutput ?? null)],
    );
  }

  async getOriginal(taskId: string, stepIndex: number): Promise<unknown | null> {
    const res = await this.pool.query<{ full_output: unknown }>(
      `select full_output from task_history where task_id = $1 and step_index = $2`,
      [taskId, stepIndex],
    );
    return res.rows[0] ? res.rows[0].full_output : null;
  }

  async listOriginals(taskId: string): Promise<Array<{ step_index: number; full_output: unknown }>> {
    const res = await this.pool.query<{ step_index: number; full_output: unknown }>(
      `select step_index, full_output from task_history where task_id = $1 order by step_index asc`,
      [taskId],
    );
    return res.rows.map((r) => ({ step_index: r.step_index, full_output: r.full_output }));
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
