// ISSUE-033 §8 step 1 — the CredentialStore PORT + in-memory FAKE reference model for the token
// lifecycle. Every live side effect on `connector_credentials` the TOK runtime performs — reading a
// credential to decrypt at call time, the ATOMIC rotate-persist of a refreshed (access + rotated
// refresh) pair, the Layer-3 state=degraded transition, and the Layer-1 "which tokens expire soon"
// query — routes through this port, so the runtime (refresh.ts / layers.ts) stays unit-testable with
// NO live DB (the house port+fake pattern — cf. app/connector-runtime/src/store.ts,
// app/rbac/src/store.ts). The in-memory fake below is the test double AND the reference model: it
// enforces every invariant the DB (baseline migration 0001 `connector_credentials`) enforces, exactly
// as the CHECK / NOT NULL / enum would — so a test cannot pass offline while the live pg adapter would
// throw (the session-69/71 fake-vs-live drift class the verifier hunts).
//
// Faithful to the DDL in app/silo/migrations/0001_baseline.sql L323-333 (schema.md §4 L386):
//   create table connector_credentials (
//     id uuid pk, connector text not null, access_token text not null, refresh_token text,
//     expires_at timestamptz, scopes text[], state credential_state not null default 'active',
//     created_at timestamptz not null default now(), updated_at timestamptz not null default now());
//   credential_state = enum ('active','degraded','revoked','expired')   (baseline L45)
//
// The row shape + the CredentialState enum are OWNED by ISSUE-032 (@harness/connector-runtime) — this
// slice reads/writes that same table, so it IMPORTS the type (single source of truth, no re-declare).
//
// Determinism: a logical `now` (epoch seconds) is supplied by the caller; no Date.now()/random — the
// same house discipline as the sibling, so time-dependent tests (expiry window, grace window) are exact.

import { CREDENTIAL_STATES, type CredentialRow, type CredentialState } from '@harness/connector-runtime';

export { CREDENTIAL_STATES };
export type { CredentialRow, CredentialState };

// ── The atomic rotate-persist unit (FR-3.TOK.005) ────────────────────────────────────────────────
// The single write that persists a refresh outcome. For a rotating connector it carries BOTH the new
// access token AND the new refresh token; both land in ONE atomic write, keyed on the credential's
// prior refresh token so a lost race (another flight already rotated) is detected as a no-op rather
// than clobbering a newer credential. `expected_refresh_token` = the refresh token this flight
// started from; the persist only applies if the stored row still carries it (optimistic concurrency,
// the fake's analogue of the DB `where refresh_token is not distinct from $expected` guard).
export interface RotatePersist {
  connector: string;
  new_access_token: string;
  /** The freshly-issued refresh token to store. For a NON-rotating connector (Google normal refresh),
   *  pass the same refresh token back — persist-new is then a harmless no-op (FR-3.TOK.007). */
  new_refresh_token: string | null;
  new_expires_at: string | null;
  new_scopes: string[] | null;
  /** The refresh token this flight read before calling the vendor — the optimistic-concurrency guard. */
  expected_refresh_token: string | null;
}

/** Outcome of an atomic rotate-persist (FR-3.TOK.005 / AC-3.TOK.005.1/.2). */
export type PersistOutcome =
  | { kind: 'persisted'; row: CredentialRow } // the atomic write applied — new access+refresh are live
  | { kind: 'stale'; row: CredentialRow }; // another flight already rotated past our expected token; we
// MUST NOT use our new access token (its refresh half was never saved against the live row) — the
// caller treats this as "someone else won the single-flight race" and re-reads, never as success.

// ── The port. Sync-shaped in the fake but modelled async for the DB adapter (house convention). ────
export interface CredentialStore {
  /** Read the current credential for a connector (newest row). The runtime decrypts at call time; the
   *  redaction boundary (redact.ts) guarantees this token never reaches a log/UI/env/config. */
  getCredential(connector: string): Promise<CredentialRow | undefined>;

  /** ATOMIC rotate-persist (FR-3.TOK.005): write new access + new refresh (+ expiry/scopes) in ONE
   *  step, guarded by the expected prior refresh token, and re-assert state=active. Returns `stale`
   *  (a no-op) if the stored refresh token no longer matches `expected_refresh_token` — i.e. a
   *  concurrent flight already rotated. NEVER partially applies (no half-saved credential — #1). */
  rotatePersist(p: RotatePersist, now: number): Promise<PersistOutcome>;

  /** Move a connector to a terminal/degraded credential state (Layer-3, FR-3.TOK.004). Loud, explicit,
   *  never silent. Returns the updated row. */
  setState(connector: string, state: CredentialState, now: number): Promise<CredentialRow>;

  /** Layer-1 (FR-3.TOK.002): the connectors whose access token expires within `leadSeconds` of `now`
   *  AND are still `active` AND actually expire (expires_at not null — non-expiring xoxb is skipped).
   *  Ordered soonest-expiry-first so the job renews the most-urgent first. */
  dueForProactiveRefresh(now: number, leadSeconds: number): Promise<CredentialRow[]>;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the test double AND the reference model. Enforces the DDL's NOT NULL (access_token,
// connector, state), the credential_state enum domain, and the atomic all-or-nothing rotate-persist.
// ───────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryCredentialStore implements CredentialStore {
  private seq = 0;
  readonly rows: CredentialRow[] = [];

  private nextId(): string {
    this.seq += 1;
    return `cred-${String(this.seq).padStart(4, '0')}`;
  }
  private stamp(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  /** Test seam: seed a credential the way an OAuth grant / ISSUE-032 storage would (FR-3.TOK.001). */
  seed(row: Omit<CredentialRow, 'id' | 'created_at' | 'updated_at'>, now: number): CredentialRow {
    if (!row.connector || row.connector.trim() === '') {
      throw new Error('connector_credentials: connector is NOT NULL (baseline L325)');
    }
    if (!row.access_token || row.access_token.trim() === '') {
      throw new Error('connector_credentials: access_token is NOT NULL (baseline L326)');
    }
    if (!CREDENTIAL_STATES.includes(row.state)) {
      throw new Error(`connector_credentials: state '${String(row.state)}' out of enum {${CREDENTIAL_STATES.join(',')}} (baseline L45)`);
    }
    const ts = this.stamp(now);
    const full: CredentialRow = { id: this.nextId(), created_at: ts, updated_at: ts, ...row };
    this.rows.push(full);
    return full;
  }

  private currentRowFor(connector: string): CredentialRow | undefined {
    // Newest row for a connector (the live credential). The live adapter mirrors this with
    // `order by updated_at desc limit 1` (cf. connector-runtime supabase-store getCredential).
    const matches = this.rows.filter((r) => r.connector === connector);
    if (matches.length === 0) return undefined;
    return matches.reduce((a, b) => (b.updated_at >= a.updated_at ? b : a));
  }

  async getCredential(connector: string): Promise<CredentialRow | undefined> {
    return this.currentRowFor(connector);
  }

  async rotatePersist(p: RotatePersist, now: number): Promise<PersistOutcome> {
    const row = this.currentRowFor(p.connector);
    if (!row) throw new Error(`connector_credentials: no credential for connector '${p.connector}' to rotate-persist`);
    if (!p.new_access_token || p.new_access_token.trim() === '') {
      throw new Error('connector_credentials: rotate-persist new_access_token is NOT NULL (baseline L326)');
    }
    // Optimistic-concurrency guard — the fake's analogue of the DB
    //   update ... where refresh_token is not distinct from $expected
    // Two NULLs match (a connector with no prior refresh token). A mismatch = a concurrent flight
    // already rotated past us; we DID NOT persist, so our new access token must not be used (#1).
    const matches = row.refresh_token === p.expected_refresh_token;
    if (!matches) {
      return { kind: 'stale', row };
    }
    // ATOMIC: access + refresh + expiry + scopes + state=active all land together, or not at all.
    // (In-memory this is a single synchronous field assignment block = no interleaving = atomic.)
    row.access_token = p.new_access_token;
    row.refresh_token = p.new_refresh_token;
    row.expires_at = p.new_expires_at;
    row.scopes = p.new_scopes;
    row.state = 'active'; // a successful refresh re-asserts health
    row.updated_at = this.stamp(now);
    return { kind: 'persisted', row };
  }

  async setState(connector: string, state: CredentialState, now: number): Promise<CredentialRow> {
    if (!CREDENTIAL_STATES.includes(state)) {
      throw new Error(`connector_credentials: state '${String(state)}' out of enum {${CREDENTIAL_STATES.join(',')}} (baseline L45)`);
    }
    const row = this.currentRowFor(connector);
    if (!row) throw new Error(`connector_credentials: no credential for connector '${connector}' to set state`);
    row.state = state;
    row.updated_at = this.stamp(now);
    return row;
  }

  async dueForProactiveRefresh(now: number, leadSeconds: number): Promise<CredentialRow[]> {
    const cutoff = now + leadSeconds; // epoch seconds
    const due = this.rows.filter((r) => {
      if (r.state !== 'active') return false; // only healthy connectors are proactively refreshed
      if (r.expires_at === null) return false; // non-expiring (Slack xoxb) is skipped (FR-3.TOK.002 branch)
      const exp = Date.parse(r.expires_at) / 1000;
      return exp <= cutoff;
    });
    // soonest-expiry-first
    return due.sort((a, b) => Date.parse(a.expires_at!) - Date.parse(b.expires_at!));
  }
}
