// ISSUE-016 — the LIVE pg adapter for the SupportStore port. Authored to the ISSUE-008 baseline DDL
// (0001_baseline.sql L107-116: support_requests + support_status). It is the reference model
// (InMemorySupportStore) realised against the real silo. NOT exercised by the offline suite — its behaviour is
// proven by the ISSUE-016 live capstone (RLS boundary applied, the public-INSERT / gated-read policy live, the
// status machine + stale sweep against real rows). Every method mirrors an InMemory method 1:1.
//
// RLS SEAM (results/proposed-shared-spec.md): the DB enforces the public-INSERT-only + PERM-gated-read/update
// boundary via the proposed support_requests RLS policies. This adapter therefore runs its READS/UPDATES under
// the authenticated caller's JWT (so the RLS SELECT/UPDATE policy applies), and its INSERT under the anon/
// public role (the intake is pre-auth). The `authz.can()` pre-check here mirrors that boundary in-app so a
// denial is surfaced with a machine reason (#3) rather than an opaque empty result set — defence in depth, not
// a substitute for the DB policy.
//
// The transition() UPDATE is guarded in SQL by a WHERE clause that re-asserts the legal from-status in the same
// statement (status = <from>), so a concurrent double-transition serializes at the row lock and at most one
// wins — the resolved-is-immutable + legal-move invariants hold under concurrency, not just in the fake.

import type { Pool } from 'pg';
import { PERM_SUPPORT_VIEW, PERM_SUPPORT_RESOLVE, type SupportAuthz } from './authz.ts';
import {
  type SupportStore,
  type SupportRequestRow,
  type SupportStatus,
  type StatusTransition,
  SupportError,
  ERR_DENIED,
  ERR_EMPTY_FIELD,
  ERR_NO_SUCH_REQUEST,
  ERR_ILLEGAL_TRANSITION,
  ERR_IMMUTABLE,
  isLegalTransition,
} from './store.ts';

const SELECT_COLS = `id, email, name, issue_description, status, assigned_to, created_at, updated_at`;

export class SupabaseSupportStore implements SupportStore {
  constructor(
    private pool: Pool,
    private authz: SupportAuthz,
  ) {}

  private async requireView(actorId: string): Promise<void> {
    if (!(await this.authz.can(actorId, PERM_SUPPORT_VIEW))) {
      throw new SupportError(ERR_DENIED, `PERM-support.view required to read the support queue (AC-0.REC.003.1)`);
    }
  }
  private async requireResolve(actorId: string): Promise<void> {
    if (!(await this.authz.can(actorId, PERM_SUPPORT_RESOLVE))) {
      throw new SupportError(ERR_DENIED, `PERM-support.resolve required to transition a support request (FR-0.REC.005)`);
    }
  }

  async insertRequest(input: { email: string; name: string; issue_description: string }, now: string): Promise<SupportRequestRow> {
    // App-layer mirror of the three NOT NULL text columns (the DB would reject NULL; we reject empty so a
    // whitespace-only submission is never a silent no-op — #3). PUBLIC — no authz gate (pre-auth intake).
    for (const [field, value] of [['email', input.email], ['name', input.name], ['issue_description', input.issue_description]] as const) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new SupportError(ERR_EMPTY_FIELD, `support_requests.${field} is NOT NULL — a blank '${field}' is rejected (FR-0.REC.002)`);
      }
    }
    const { rows } = await this.pool.query<SupportRequestRow>(
      `insert into support_requests (email, name, issue_description, status, created_at, updated_at)
       values ($1, $2, $3, 'pending', $4, $4)
       returning ${SELECT_COLS}`,
      [input.email.trim(), input.name.trim(), input.issue_description.trim(), now],
    );
    return rows[0]!;
  }

  async listRequests(actorId: string): Promise<SupportRequestRow[]> {
    await this.requireView(actorId);
    const { rows } = await this.pool.query<SupportRequestRow>(
      `select ${SELECT_COLS} from support_requests order by created_at desc`,
    );
    return rows;
  }

  async getRequest(actorId: string, id: string): Promise<SupportRequestRow | null> {
    await this.requireView(actorId);
    const { rows } = await this.pool.query<SupportRequestRow>(
      `select ${SELECT_COLS} from support_requests where id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async transition(actorId: string, id: string, to: SupportStatus, now: string): Promise<SupportRequestRow> {
    await this.requireResolve(actorId);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // Row-lock the current state so a concurrent transition serializes here.
      const cur = await client.query<{ status: SupportStatus }>(
        `select status from support_requests where id = $1 for update`,
        [id],
      );
      const current = cur.rows[0];
      if (!current) {
        await client.query('rollback');
        throw new SupportError(ERR_NO_SUCH_REQUEST, `support request '${id}' not found`);
      }
      if (current.status === 'resolved') {
        await client.query('rollback');
        throw new SupportError(ERR_IMMUTABLE, `support request '${id}' is resolved — history is immutable (FR-0.REC.005)`);
      }
      if (!isLegalTransition(current.status, to)) {
        await client.query('rollback');
        throw new SupportError(ERR_ILLEGAL_TRANSITION, `illegal transition ${current.status}→${to} (FR-0.REC.005)`);
      }
      // Params: $1=id, $2=now, $3=to (new status), $4=from (guard). assigned_to is set to the actor only on
      // pending→in_progress (the pick-up). The `and status = $4` guard re-asserts the legal from-state in the
      // same statement (ADR-004 pattern): a racing transition that already moved the row updates 0 rows.
      const upd = await client.query<SupportRequestRow>(
        `update support_requests
            set status = $3::support_status,
                assigned_to = case when $3 = 'in_progress' then $5::uuid else assigned_to end,
                updated_at = $2
          where id = $1 and status = $4::support_status
          returning ${SELECT_COLS}`,
        [id, now, to, current.status, actorId],
      );
      if (upd.rowCount === 0) {
        await client.query('rollback');
        throw new SupportError(ERR_ILLEGAL_TRANSITION, `transition ${current.status}→${to} lost a race (FR-0.REC.005)`);
      }
      // Append the immutable actor+timestamp history row (access_audit; audit_type='support_status_transition').
      await client.query(
        `insert into access_audit (audit_type, actor_identity, actor_type, target_entity_id, target_type, action, before_value, after_value, created_at)
         values ('support_status_transition', $1, 'user', $2, 'support_request', $3, jsonb_build_object('status', $4::text), jsonb_build_object('status', $5::text), $6)`,
        [actorId, id, `transition:${current.status}->${to}`, current.status, to, now],
      );
      await client.query('commit');
      return upd.rows[0]!;
    } catch (e) {
      try { await client.query('rollback'); } catch { /* already rolled back */ }
      throw e;
    } finally {
      client.release();
    }
  }

  async transitionsFor(actorId: string, id: string): Promise<StatusTransition[]> {
    await this.requireView(actorId);
    const { rows } = await this.pool.query<{ before_value: { status: SupportStatus }; after_value: { status: SupportStatus }; actor_identity: string; created_at: string }>(
      `select before_value, after_value, actor_identity, created_at
         from access_audit
        where audit_type = 'support_status_transition' and target_entity_id = $1
        order by created_at asc`,
      [id],
    );
    return rows.map((r) => ({
      request_id: id,
      from_status: r.before_value.status,
      to_status: r.after_value.status,
      actor_id: r.actor_identity,
      at: r.created_at,
    }));
  }

  async pendingOlderThan(cutoff: string): Promise<SupportRequestRow[]> {
    // System read (service_role, no auth.uid()) — the stale sweep runs off the RLS path (ADR-006). Read-only.
    const { rows } = await this.pool.query<SupportRequestRow>(
      `select ${SELECT_COLS} from support_requests where status = 'pending' and created_at < $1 order by created_at asc`,
      [cutoff],
    );
    return rows;
  }
}
