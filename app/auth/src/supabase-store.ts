// ISSUE-013 — the LIVE AuthStore adapter (pg, against the client-owned silo Supabase). It is the only
// module that imports `pg`. It implements the same port as InMemoryAuthStore against the real DDL:
// schema.md §1 `profiles` + the proposed 0006_profiles_mirror.sql owner-reads-own RLS, and §8 `event_log`.
//
// ⚠️ NOT YET RUN LIVE. Two live proofs are owed at the Stage-3 checkpoint:
//   (a) the real OAuth-provider handshake (Google/Microsoft IdP round-trip) — modelled offline by the
//       FakeOAuthProvider; the hardening LOGIC (oauth.ts) is proven, the transport is not.
//   (b) AF-073 (HttpOnly forced via @supabase/ssr without breaking client session reads) — a BROWSER
//       feasibility gate, resolved at the checkpoint or its documented fallback (non-HttpOnly + strict
//       CSP + short access-token TTL) applied. It gates FR-0.SESS.005 acceptance, not this adapter's shape.
// The InMemoryAuthStore is the proven reference model. Do NOT claim these code paths verified until the
// checkpoint records live evidence.
//
// postgres owner (RLS-bypass) vs authenticated (ADR-006 — runtime role = postgres owner per OD-193): the
// login-side upsert + the event_log writes + the task-continuation write run as the owner (RLS-bypass). The
// owner-reads-own guarantee is enforced by the 0006 RLS policy for `authenticated` callers (a user reading
// their OWN dashboard). This adapter is written for the owner (RLS-bypass) side (provisioning/runtime);
// readProfile is expressed with an explicit caller=target predicate so it is safe even if ever run under the
// owner (RLS-bypass) (defence in depth, #2).

import pg from 'pg';
import type { OAuthProvider } from './config.js';
import type { AuthStore, AuthEventRow, NewAuthEvent, ProfileRow } from './store.js';
import { ERR_PROVIDER_TOGGLE_DENIED } from './store.js';

export class SupabaseAuthStore implements AuthStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async upsertProfile(id: string, email: string, name: string | null, _now: number): Promise<ProfileRow> {
    // First login mirrors the identity; a repeat login keeps email current. created_at/last_active_at
    // default now() on insert. `active` defaults true (deactivation is C1's admin path, not here).
    const res = await this.pool.query<ProfileRow>(
      `insert into profiles (id, email, name)
       values ($1, $2, $3)
       on conflict (id) do update set email = excluded.email,
         name = coalesce(excluded.name, profiles.name)
       returning id, email, name, active, created_at, last_active_at`,
      [id, email, name],
    );
    return res.rows[0]!;
  }

  async readProfile(callerId: string, targetId: string): Promise<ProfileRow | null> {
    // Owner-reads-own mirrored in SQL (matches the 0006 policy predicate auth.uid() = id). Under
    // `authenticated`, RLS already scopes this; the explicit caller=target keeps it correct under any role.
    if (callerId !== targetId) return null;
    const res = await this.pool.query<ProfileRow>(
      `select id, email, name, active, created_at, last_active_at from profiles where id = $1`,
      [targetId],
    );
    return res.rows[0] ?? null;
  }

  async touchLastActive(id: string, now: number): Promise<void> {
    // Monotonic forward: greatest() guards against an out-of-order write regressing last_active_at.
    await this.pool.query(
      `update profiles
         set last_active_at = greatest(coalesce(last_active_at, to_timestamp($2)), to_timestamp($2))
       where id = $1`,
      [id, now],
    );
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await this.pool.query(`update profiles set active = $2 where id = $1`, [id, active]);
  }

  async logEvent(row: NewAuthEvent, _now: number): Promise<AuthEventRow> {
    // entity_ids is uuid[] in the DDL; the user_id (a uuid) is the natural entity. created_at defaults now().
    // event_type is CAST to ::event_type — the 7 auth event_type values this slice emits (sign_in_success,
    // sign_in_failure, session_established, identity_rejected, reuse_detection_revocation, task_continuation,
    // verification_failure) are NOT yet in the baseline enum (0001_baseline.sql L60-65); they are added by the
    // orchestrator-owned migration 0007 (see results/proposed-shared-spec.md). Until 0007 is applied this cast
    // makes an unknown value raise LOUD (invalid_text_representation) — never a silent skip (#3). payload is
    // jsonb, likewise ::jsonb so a malformed payload fails loud, not silently coerced.
    const entityIds = row.user_id ? [row.user_id] : [];
    const res = await this.pool.query<{ id: string; created_at: string }>(
      `insert into event_log (task_id, event_type, entity_ids, summary, payload)
       values (null, $1::event_type, $2, $3, $4::jsonb)
       returning id, created_at`,
      [row.event_type, entityIds, row.summary, JSON.stringify(row.detail)],
    );
    return { id: res.rows[0]!.id, created_at: res.rows[0]!.created_at, ...row };
  }

  async setProviderConfig(
    caller: { canToggleProvider: boolean },
    next: { oauth_enabled?: boolean; oauth_provider?: OAuthProvider },
    _now: number,
  ): Promise<{ oauth_enabled: boolean; oauth_provider: OAuthProvider }> {
    // FR-0.AUTH.003: the edit is gated by PERM-auth.provider_toggle (default-deny). The caller capability
    // is resolved by the C1 can() gate (ISSUE-018) upstream; this adapter refuses if it is not held (#2).
    if (!caller.canToggleProvider) throw new Error(ERR_PROVIDER_TOGGLE_DENIED);
    // The two keys live in config_values (auth.* → PERM-config.auth group per config-store keygroup).
    // The REAL DDL is config_values(key text primary key, value jsonb) — 0001_baseline.sql L626-631,
    // schema.md §12 — NOT config_key/config_value. Use key/value + `on conflict (key)`. value is jsonb, so
    // the ::jsonb cast makes a mismatched literal fail LOUD (never a silent coerce — #3).
    // logic-sweep fix (adapter MINOR, #1): the two upserts run in ONE transaction — when a caller sets BOTH
    // oauth_enabled AND oauth_provider, a crash between two autocommit upserts previously left the OAuth config
    // half-applied (enabled flipped, provider stale). BEGIN/COMMIT makes the pair all-or-nothing. (The audit
    // row for this edit remains ISSUE-086's config-admin write path, not this adapter's — see that issue.)
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      if (next.oauth_enabled !== undefined) {
        await client.query(
          `insert into config_values (key, value) values ('auth.oauth_enabled', $1::jsonb)
           on conflict (key) do update set value = excluded.value`,
          [JSON.stringify(next.oauth_enabled)],
        );
      }
      if (next.oauth_provider !== undefined) {
        await client.query(
          `insert into config_values (key, value) values ('auth.oauth_provider', $1::jsonb)
           on conflict (key) do update set value = excluded.value`,
          [JSON.stringify(next.oauth_provider)],
        );
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return this.getProviderConfig();
  }

  async getProviderConfig(): Promise<{ oauth_enabled: boolean; oauth_provider: OAuthProvider }> {
    const res = await this.pool.query<{ key: string; value: unknown }>(
      `select key, value from config_values
       where key in ('auth.oauth_enabled', 'auth.oauth_provider')`,
    );
    let oauth_enabled = true;
    let oauth_provider: OAuthProvider = 'google';
    for (const r of res.rows) {
      if (r.key === 'auth.oauth_enabled') oauth_enabled = r.value === true || r.value === 'true';
      if (r.key === 'auth.oauth_provider') oauth_provider = (r.value === 'microsoft' ? 'microsoft' : 'google');
    }
    return { oauth_enabled, oauth_provider };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
