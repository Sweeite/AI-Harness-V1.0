// ISSUE-033 — the LIVE CredentialStore adapter (pg, against the client-owned silo Supabase). It is the
// only module that imports `pg`. It implements the same port as InMemoryCredentialStore against the
// REAL DDL (app/silo/migrations/0001_baseline.sql `connector_credentials`, schema.md §4 L386).
//
// ⚠️ NOT YET RUN LIVE. The atomic rotate-persist under real concurrency (the GHL 30s grace race,
// AF-089) is a build-time SPIKE/LOAD gate against a live silo — a 💻 live-infra step owed to the
// operator session. This adapter is authored to the DDL so the seam is real and typechecks; the
// InMemoryCredentialStore is the proven OFFLINE reference model. Do NOT claim these code paths verified
// until a live run records evidence.
//
// The three non-negotiables realised in SQL:
//   - rotatePersist is a SINGLE atomic UPDATE guarded by the optimistic-concurrency predicate
//       where refresh_token is not distinct from $expected_refresh_token
//     so two concurrent flights cannot both apply — the loser's UPDATE matches 0 rows and returns
//     `stale`, never clobbering the winner's freshly-rotated token (#1: never silently lose access).
//     Access + refresh + expiry + scopes + state all land in ONE statement = atomic all-or-nothing;
//     a crash mid-statement leaves the row untouched (no half-saved credential — AC-3.TOK.005.2).
//   - access_token/refresh_token are Vault-encrypted at rest, service_role decrypt only; this adapter
//     NEVER logs them (#2 / NFR-SEC.003). Callers redact via redact.ts before any observability sink.
//   - setState is an explicit, loud UPDATE (never a silent drop) — Layer-3 degrade (#3).

import pg from 'pg';
import type {
  CredentialRow,
  CredentialState,
  CredentialStore,
  PersistOutcome,
  RotatePersist,
} from './store.js';

export class SupabaseCredentialStore implements CredentialStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  private static readonly COLS =
    'id, connector, access_token, refresh_token, expires_at, scopes, state, created_at, updated_at';

  async getCredential(connector: string): Promise<CredentialRow | undefined> {
    const res = await this.pool.query<CredentialRow>(
      `select ${SupabaseCredentialStore.COLS} from connector_credentials
       where connector = $1 order by updated_at desc limit 1`,
      [connector],
    );
    return res.rows[0];
  }

  async rotatePersist(p: RotatePersist, _now: number): Promise<PersistOutcome> {
    // ONE atomic UPDATE, guarded by the optimistic-concurrency predicate. `is not distinct from` makes
    // NULL match NULL (a connector with no prior refresh token). A concurrent flight that already
    // rotated changed refresh_token, so this UPDATE matches 0 rows → `stale` (we did NOT persist; the
    // caller must not use its new access token). We target the newest row per connector.
    const updated = await this.pool.query<CredentialRow>(
      `update connector_credentials c
          set access_token = $2,
              refresh_token = $3,
              expires_at    = $4,
              scopes        = $5,
              state         = 'active',
              updated_at    = now()
        where c.id = (
              select id from connector_credentials
               where connector = $1 order by updated_at desc limit 1)
          and c.refresh_token is not distinct from $6
        returning ${SupabaseCredentialStore.COLS}`,
      [
        p.connector,
        p.new_access_token,
        p.new_refresh_token,
        p.new_expires_at,
        p.new_scopes,
        p.expected_refresh_token,
      ],
    );
    if (updated.rowCount === 1) {
      return { kind: 'persisted', row: updated.rows[0]! };
    }
    // 0 rows → either the guard failed (a concurrent rotation) or the row vanished. Re-read the live
    // row so the caller uses the authoritative persisted credential, never a half-applied one.
    const live = await this.getCredential(p.connector);
    if (!live) throw new Error(`connector_credentials: no credential for '${p.connector}' after a stale rotate-persist`);
    return { kind: 'stale', row: live };
  }

  async setState(connector: string, state: CredentialState, _now: number): Promise<CredentialRow> {
    const res = await this.pool.query<CredentialRow>(
      `update connector_credentials
          set state = $2, updated_at = now()
        where id = (select id from connector_credentials
                     where connector = $1 order by updated_at desc limit 1)
        returning ${SupabaseCredentialStore.COLS}`,
      [connector, state],
    );
    if (res.rowCount === 0) throw new Error(`connector_credentials: no credential for '${connector}' to set state`);
    return res.rows[0]!;
  }

  async dueForProactiveRefresh(now: number, leadSeconds: number): Promise<CredentialRow[]> {
    // Active, expiring credentials whose access token expires within the lead window. Non-expiring
    // (expires_at is null — Slack xoxb) are excluded by the `expires_at is not null` predicate
    // (AC-3.TOK.002.2). Soonest-expiry first. `now` is passed as epoch to keep the window math
    // caller-authoritative rather than trusting the DB clock (parity with the fake).
    const cutoffIso = new Date((now + leadSeconds) * 1000).toISOString();
    const res = await this.pool.query<CredentialRow>(
      `select ${SupabaseCredentialStore.COLS} from connector_credentials
        where state = 'active' and expires_at is not null and expires_at <= $1
        order by expires_at asc`,
      [cutoffIso],
    );
    return res.rows;
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
