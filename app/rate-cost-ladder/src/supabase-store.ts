// ISSUE-058 — the LIVE pg adapter for GuardrailLogSink. Runs on the service_role/owner connection (the C6
// decision path runs as the owner and BYPASSES RLS by design — enforcement is code, ADR-007; no per-action
// RLS gate). NOT exercised by the offline suite — its behaviour is proven by the R10 live-adapter smoke
// (results/live-smoke.sql, rolled back). Mirrors InMemoryGuardrailLogSink 1:1: one append-only INSERT of a
// `rate_limit`-class guardrail_log row (schema.md §7; id/status/created_at DB-defaulted, status='pending').

import type { Pool } from 'pg';
import {
  assertLoudDraft,
  type GuardrailLogSink,
  type GuardrailLogRowDraft,
} from './store.ts';

export class SupabaseGuardrailLogSink implements GuardrailLogSink {
  constructor(private readonly pool: Pool) {}

  async writeRateLimitRow(row: GuardrailLogRowDraft): Promise<string> {
    // Same loud preconditions as the in-memory fake (1:1 parity): rate_limit-class only + non-empty description
    // (#3), and a null-or-canonical-UUID task_id — rejecting a malformed task_id here rather than letting the
    // `task_id uuid` column throw late and lose the row (#1).
    assertLoudDraft(row);
    // Append-only INSERT (schema.md §7). guardrail_type is a literal (parameterising an enum value is awkward
    // and this value is code-controlled, verified against the enum by index.ts `check`). A failed INSERT
    // throws — the caller (RateCostLadder.write) surfaces logWriteFailed rather than swallowing it (#3).
    const res = await this.pool.query<{ id: string }>(
      `insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
       values ($1, 'rate_limit', $2, $3, 'pending')
       returning id`,
      [row.taskId, row.description, row.actionBlocked],
    );
    if (res.rowCount === 0 || !res.rows[0]) {
      throw new Error('guardrail_log INSERT returned no id — the breach/rung was NOT recorded (#3).');
    }
    return res.rows[0].id;
  }
}
