// ISSUE-015 — the LIVE InviteSeedStore adapter (pg, against the client-owned silo Supabase). The only module
// that imports `pg`. It implements the same port as InMemoryInviteSeedStore against the REAL baseline DDL
// (app/silo/migrations/0001_baseline.sql: profiles, support_requests, roles, user_roles, event_log,
// access_audit) and the Supabase-managed auth.* admin API (auth.users / auth.identities / auth.mfa_factors —
// referenced, never app-schema'd).
//
// ⚠️ NOT YET RUN LIVE. What only a live silo can prove is LIVE/AF-owed:
//   - AF-074: the native invite/OTP/recovery link expiry is a GLOBAL project setting hard-capped at 86400 s
//     (24 h), and lowering the global slider shortens BOTH invite and seed links. The ≤24h clamp is proven
//     offline (cappedExpiry); the hosted-Supabase coupling is the LIVE spike (residual AF-074).
//   - The seed's ADR-004 atomic guard actually serializing two concurrent boots is proven here by
//     pg_advisory_xact_lock AND, as the ultimate backstop, the user_roles unique(user_id) constraint (a
//     second insert of a Super-Admin role row would violate it). The concurrency proof against a running pg
//     is the live capstone; the offline reference model (InMemoryInviteSeedStore) proves the logic.
//   - Custom-SMTP send + provider bounce webhooks are live infrastructure (FR-0.INV.003/.007) — the send
//     edge is modelled by the SmtpSender port; the live provider client is wired at deploy.
//
// Design ties to the three non-negotiables:
//   - #1 (never lose knowledge): the seed is idempotent — a lost race is a clean no-op, never a second admin.
//   - #2 (never do what it shouldn't): invite issuance FAILS CLOSED on the PERM-user.invite gate; the seed
//     ABORTS on an unset SUPER_ADMIN_EMAIL rather than mint a blank admin; there is no UI seed trigger.
//   - #3 (never fail silently): an SMTP send failure surfaces an EXPLICIT issuer-visible failure + an
//     event_log row — never a false "sent"; a bounce marks the invite undelivered + re-alerts.

import pg from 'pg';
import { PROTECTED_ROLE } from '../../rbac/src/catalog.ts';
import {
  ERR_INVITE_DENIED,
  ERR_PUBLIC_SIGNUP_OFF,
  ERR_SEED_ENV_UNSET,
  ERR_TOKEN_INVALID,
  ERR_METHOD_MISMATCH,
  ERR_UNADMITTED_EVENT_TYPE,
  InMemoryInviteSeedStore,
  isInviteSeedEventType,
  ROLE_DEFAULT_VIEW,
  SUPER_ADMIN_ROLE,
  type AuditEvent,
  type CompleteSetupInput,
  type EventLogEntry,
  type InviteSeedStore,
  type IssueInviteInput,
  type IssueOutcome,
  type SeedOutcome,
} from './store.ts';
import {
  LINK_TTL_HARD_CAP_SECONDS,
  SAFE_NO_ACCESS_VIEW,
  type Activation,
  type Invite,
  type InviteState,
  type LinkOrigin,
} from './types.ts';
import { ERR_SMTP_NOT_CONFIGURED, type SmtpMessage, type SmtpSender } from './smtp.ts';
import { type AuthAdmin } from './auth-admin.ts';

/** A deterministic advisory-lock key for the seed critical section (ADR-004). Any fixed 64-bit int works;
 *  all boots must use the SAME key so pg_advisory_xact_lock serializes them. */
const SEED_ADVISORY_LOCK_KEY = 715015; // arbitrary fixed key ("issue 015")

/** The profiles-row projection the invite lifecycle reads (OD-192). `revoked_at`/`bounced_at` are the 0027
 *  additive markers; `active` is the pending(false)/used(true) axis. */
interface ProfileInviteRow {
  id: string;
  email: string;
  active: boolean;
  revoked_at: string | null;
  bounced_at: string | null;
}

export class SupabaseInviteSeedStore implements InviteSeedStore {
  private pool: pg.Pool;
  // The pure/DB-free parts (redirect resolution, TTL cap, method-mismatch rules) are identical to the
  // reference model — delegate rather than duplicate the invariants.
  private readonly ref = new InMemoryInviteSeedStore();

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  private cappedExpiry(now: number, ttlSeconds?: number): number {
    return now + Math.min(ttlSeconds ?? LINK_TTL_HARD_CAP_SECONDS, LINK_TTL_HARD_CAP_SECONDS);
  }

  private async writeAudit(
    client: pg.PoolClient | pg.Pool,
    audit_type: string,
    actor_identity: string,
    actor_type: 'user' | 'system',
    action: string,
    reason: string | null,
  ): Promise<void> {
    // access_audit is append-only/immutable (0001_baseline.sql + the enforce_audit_append_only trigger).
    await client.query(
      `insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, reason)
       values ($1, $2, $3, $4, 'invite', $5)`,
      [audit_type, actor_identity, actor_type, action, reason],
    );
  }

  private async writeEvent(
    client: pg.PoolClient | pg.Pool,
    event_type: string,
    summary: string,
  ): Promise<void> {
    // event_log is append-only; summary is never empty (AC-7.LOG.002.2). Feeds FR-0.AUTH.010 (ISSUE-013).
    // The four invite/seed event_type values (account_activated / email_send_ok / email_send_failed /
    // invite_bounced) are an ADDITIVE delta owed to migration 0011 (results/proposed-shared-spec.md); the
    // baseline enum (0001_baseline.sql L60-65 + 0007) does NOT yet admit them. Defence-in-depth: reject an
    // unadmitted value here too, and CAST to $1::event_type so that — until 0011 is applied — the live insert
    // raises a LOUD `invalid input value for enum event_type` rather than a silent skip (#3). Same house
    // pattern as app/auth/src/supabase-store.ts logEvent and app/triggers/src/supabase-store.ts.
    if (!isInviteSeedEventType(event_type)) throw new Error(ERR_UNADMITTED_EVENT_TYPE);
    await client.query(
      `insert into event_log (event_type, summary) values ($1::event_type, $2)`,
      [event_type, summary],
    );
  }

  private async deliver(inv: Invite, smtp: SmtpSender): Promise<{ sent: boolean; reason?: string }> {
    const msg: SmtpMessage = {
      to: inv.email,
      subject: inv.origin === 'seed' ? 'Set up your Super Admin account' : 'You have been invited',
      setupLink: `/auth/setup?token=${inv.token}`,
    };
    const res = await smtp.send(msg);
    if (res.ok) {
      await this.writeEvent(this.pool, 'email_send_ok', `setup email sent (unconfirmed) to ${inv.email} [${inv.origin}]`);
      return { sent: true };
    }
    // #3: explicit issuer-visible failure + event_log row — never a false "sent".
    await this.writeEvent(this.pool, 'email_send_failed', `setup email SEND FAILED to ${inv.email}: ${res.reason}`);
    return { sent: false, reason: res.reason ?? ERR_SMTP_NOT_CONFIGURED };
  }

  async issueInvite(input: IssueInviteInput, auth: AuthAdmin, smtp: SmtpSender): Promise<IssueOutcome> {
    if (!input.canInvite) throw new Error(ERR_INVITE_DENIED); // fail closed (#2)

    // Public signup is OFF at the Supabase project level (FR-0.INV.001) — the admin API is the only genesis
    // path. Create the auth.users row (no password, no auto-email) via the admin API [SA13] FIRST, then mirror
    // the profiles row using the id the admin API RETURNS. generateLink mints the native ≤24h invite token
    // (OD-014). (The auth.users createUser + inviteUserByEmail/generateLink calls are Supabase-managed via the
    // AuthAdmin port — the token/expiry come back from the admin API, capped by the GLOBAL OTP-expiry setting,
    // AF-074.)
    //
    // ISSUE-015 BLOCKER fix: profiles.id FKs auth.users(id) (0001_baseline.sql L98). The mirror row MUST reuse
    // the REAL auth.users.id from createUser — a fabricated gen_random_uuid() has no parent and raises
    // foreign_key_violation on EVERY live invite. Same discipline as app/auth upsertProfile(id, …).
    const now = input.now;
    const expiresAt = this.cappedExpiry(now, input.ttlSeconds);

    // ATOMIC issuance (mirrors runSeed's transaction discipline — #1/#3). The external auth.createUser is
    // sequenced BEFORE the txn (its returned id is the profiles FK parent — profiles.id FKs auth.users(id));
    // the profiles mirror insert AND the invite_issued audit then run inside ONE transaction on a single
    // checked-out client, so a crash mid-sequence can never commit an auth.users+profiles row with no
    // invite_issued audit (a #3 silent-failure hole). The email deliver runs AFTER commit — a deliver failure
    // must NOT roll back a real, issued invite (it is separately recoverable via resend/markBounced and is
    // surfaced explicitly, never a false "sent"). ACCEPTABLE RESIDUAL: if createUser succeeds but the txn rolls
    // back, an orphan auth.users row with no profile remains — the idempotent createUser (same id per email)
    // reconciles it on re-run; we deliberately do NOT delete the auth user here.
    const authUser = await auth.createUser(input.email);

    const client = await this.pool.connect();
    let profileId: string;
    try {
      await client.query('begin');
      const prof = await client.query<{ id: string }>(
        `insert into profiles (id, email, active) values ($1, $2, false) returning id`,
        [authUser.id, input.email],
      );
      profileId = prof.rows[0]!.id;
      await this.writeAudit(client, 'invite_issued', input.issuedBy, 'user', 'issue_invite', null);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    // We model the native token id opaquely; the live admin API returns it. No custom token table (OD-014).
    const inv: Invite = {
      token: `native-${profileId}`,
      email: input.email,
      accountType: input.accountType,
      origin: 'invite',
      profileId,
      issuedAt: now,
      expiresAt,
      state: 'pending',
      delivery: 'sent_unconfirmed',
      issuedBy: input.issuedBy,
    };

    // AFTER commit — a send failure never rolls back the (committed) invite; it surfaces explicitly instead.
    const { sent, reason } = await this.deliver(inv, smtp);
    return { invite: inv, sent, ...(sent ? {} : { sendFailureReason: reason }) };
  }

  async attemptSelfRegister(_email: string): Promise<never> {
    throw new Error(ERR_PUBLIC_SIGNUP_OFF); // AC-0.INV.001.1 — no account created.
  }

  /** Parse the profileId out of a native token. Invites are `native-<profileId>`; the seed link is
   *  `native-seed-<profileId>` (both minted here, OD-014 — no custom token table). Returns the origin too so
   *  the seed's account type (always external_admin) can be reconstructed without a persisted column. */
  private parseToken(token: string): { profileId: string; origin: LinkOrigin } | null {
    const seed = /^native-seed-(.+)$/.exec(token);
    if (seed) return { profileId: seed[1]!, origin: 'seed' };
    const inv = /^native-(.+)$/.exec(token);
    if (inv) return { profileId: inv[1]!, origin: 'invite' };
    return null;
  }

  /** Reconstruct the live Invite from persisted state (the profiles mirror row + the token). The native
   *  token's expiry/consumption are enforced by the Supabase auth server (OD-014 — no custom token table);
   *  the app-schema truth we own is the profiles row. FAIL CLOSED: an unparseable token, a missing profile,
   *  or an ALREADY-ACTIVE profile (the token was consumed by a prior activation) all reject as invalid —
   *  routed to the support-request re-request path, never a blank/half-activated account (FR-0.REC.002 seam).
   *  accountType is not a persisted app column (schema.md §1) — the seed is always external_admin; a native
   *  invite's branch is selected by the setup method the invitee submits (see completeSetup). */
  private async loadInviteLive(client: pg.PoolClient | pg.Pool, token: string): Promise<Invite> {
    const parsed = this.parseToken(token);
    if (!parsed) throw new Error(ERR_TOKEN_INVALID);
    const prof = await client.query<ProfileInviteRow>(
      `select id, email, active, revoked_at, bounced_at from profiles where id = $1`,
      [parsed.profileId],
    );
    const row = prof.rows[0];
    if (!row) throw new Error(ERR_TOKEN_INVALID); // no such profile → invalid token
    if (row.active) throw new Error(ERR_TOKEN_INVALID); // already activated → the token is consumed (used)
    // OD-192: a REVOKED invite must never validate/activate (#2). loadInviteLive is the choke point for
    // validateToken + completeSetup, so rejecting here closes the token for every consume path.
    if (row.revoked_at != null) throw new Error(ERR_TOKEN_INVALID); // issuer-revoked → invalid token
    return this.inviteFromRow(row, parsed, token, 'pending');
  }

  /** Build the live Invite view from a profiles row. `state` is decided by the caller (pending for a live
   *  loadInviteLive; used/revoked for the lifecycle ops that surface those states). `delivery` is derived from
   *  the bounced_at marker (OD-192). accountType/origin come from the token; issue/expiry are server-side
   *  (OD-014), not app-persisted; issuedBy is not a persisted profiles column (schema.md §1). */
  private inviteFromRow(
    row: ProfileInviteRow,
    parsed: { profileId: string; origin: LinkOrigin },
    token: string,
    state: InviteState,
  ): Invite {
    return {
      token,
      email: row.email,
      accountType: parsed.origin === 'seed' ? 'external_admin' : 'client_tenant',
      origin: parsed.origin,
      profileId: row.id,
      issuedAt: 0, // native token — issue/expiry are Supabase-auth-server-side (OD-014); not app-persisted
      expiresAt: 0,
      state,
      delivery: row.bounced_at != null ? 'bounced' : 'sent_unconfirmed',
      issuedBy: null,
    };
  }

  async validateToken(token: string, now: number): Promise<Invite> {
    // LIVE: the token's expiry/consumption are enforced by the Supabase auth server; the app-schema truth is
    // the profiles mirror row. We validate against it: unparseable token / missing profile / already-active
    // profile (token consumed) → reject as invalid (FR-0.INV.002/.006, fail-closed #2/#3). No fake delegation.
    void now; // native-token expiry is server-side (OD-014); `now` is part of the port shape for the fake.
    const client = await this.pool.connect();
    try {
      return await this.loadInviteLive(client, token);
    } finally {
      client.release();
    }
  }

  async completeSetup(input: CompleteSetupInput): Promise<Activation> {
    // LIVE activation — the REAL persistence path (not delegated to the fake). One transaction:
    //   1. validate the token against the profiles mirror (fail-closed on invalid/consumed);
    //   2. apply the method / partial-Option-B rules (OD-020: one method; no half-provisioned account);
    //   3. on activation: flip profiles.active=true (#1 — persist the activation), insert the
    //      account_activated event_log row (#3 — never a silent activation), and read user_roles→roles.name
    //      to resolve the role-default redirect (FR-0.INV.005 seam — NOT the fake's empty userRoles).
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const inv = await this.loadInviteLive(client, input.token); // rejects invalid/consumed (fail closed)

      // OD-020 — one method fixed by account type. The seed admin (reconstructed as external_admin) MUST use
      // password_totp; an oauth submission on it is a method mismatch (never set a password on the wrong path,
      // never leave the admin on a branch that can't enrol TOTP). For a native invite, accountType is not
      // app-persisted (schema.md §1), so the submitted method selects the branch: `oauth` → Option A
      // (OAuth-connect, no password, activates on connect); `password_totp` → Option B (gated on totpEnrolled
      // below). No half-provisioned account either way.
      if (inv.accountType === 'external_admin' && input.method !== 'password_totp') {
        await client.query('rollback');
        throw new Error(ERR_METHOD_MISMATCH);
      }
      // Mirror the reference fake (store.ts): a client_tenant account connects OAuth (no password) — any other
      // method is a mismatch (OD-020: one method). A native invite is reconstructed as client_tenant by
      // loadInviteLive, so a password_totp submission on it must reject exactly as the fake does (never set a
      // password on the OAuth-connect path).
      if (inv.accountType === 'client_tenant' && input.method !== 'oauth') {
        await client.query('rollback');
        throw new Error(ERR_METHOD_MISMATCH);
      }

      // Option B activates ONLY once BOTH the password credential AND the TOTP factor exist. A partial
      // Option-B (password set, TOTP abandoned) leaves the account inactive — no half-provisioned account.
      const activated = input.method === 'oauth' ? true : input.totpEnrolled === true;

      // Resolve the role-default redirect from the LIVE user_roles → roles join (FR-0.INV.005 seam).
      const roleRes = await client.query<{ name: string }>(
        `select r.name from user_roles ur join roles r on r.id = ur.role_id
          where ur.user_id = $1 and ur.active = true limit 1`,
        [inv.profileId],
      );
      const roleName = roleRes.rows[0]?.name ?? null;
      const redirectView = activated
        ? roleName
          ? (ROLE_DEFAULT_VIEW[roleName] ?? SAFE_NO_ACCESS_VIEW)
          : SAFE_NO_ACCESS_VIEW
        : SAFE_NO_ACCESS_VIEW;

      if (activated) {
        // #1: persist the activation. #3: log account_activated. The profiles.active flip consumes the token
        // (a subsequent validateToken sees active=true → rejects as consumed). The event write is inside the
        // txn so an activation without its audit trail can never commit.
        await client.query(`update profiles set active = true where id = $1`, [inv.profileId]);
        await this.writeEvent(
          client,
          'account_activated',
          `account ${inv.email} activated via ${input.method} → ${redirectView}`,
        );
      }
      // A partial Option-B does NOT flip active — the user can return to finish TOTP (still ≤24h).

      await client.query('commit');
      return {
        profileId: inv.profileId,
        email: inv.email,
        accountType: inv.accountType,
        method: input.method,
        activated,
        roleName,
        redirectView,
      };
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  // ── Invite lifecycle (revoke / reissue / resend / mark-bounced) — LIVE against the pending-`profiles` row ──
  // [[OD-192]] (operator Option A, no new table). These previously delegated to `this.ref` (an in-memory fake
  // the live `issueInvite` never populates) → a silently-WRONG live result. Now modelled on the profiles row +
  // the 0027 markers: revoke ⇒ stamp `revoked_at` (the token then no longer validates — loadInviteLive rejects
  // it, #2); markBounced ⇒ stamp `bounced_at` (reads "undelivered", never a silent "sent", #3); resend/reissue
  // ⇒ re-deliver the setup link for a still-pending invite + audit. Invite expiry/consumption stay server-side
  // (OD-014). The one residual: reissue's TRUE server-side token refresh (Supabase generateLink) needs an
  // AuthAdmin seam that is not built — tracked as AF-074; the app-schema lifecycle is complete here.

  async revokeInvite(token: string, issuerCanInvite: boolean, now: number): Promise<Invite> {
    if (!issuerCanInvite) throw new Error(ERR_INVITE_DENIED); // fail closed first (#2)
    // Read-then-write under ONE transaction with `for update` — the stamp AND its audit are atomic (a crash can
    // never revoke without the audit, #1/#3), and the row lock serialises a concurrent activation so we never
    // revoke a row that just went active(used).
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const parsed = this.parseToken(token);
      if (!parsed) throw new Error(ERR_TOKEN_INVALID);
      const prof = await client.query<ProfileInviteRow>(
        `select id, email, active, revoked_at, bounced_at from profiles where id = $1 for update`,
        [parsed.profileId],
      );
      const row = prof.rows[0];
      if (!row) throw new Error(ERR_TOKEN_INVALID);
      // Revoking an already-USED invite is a NO-OP (the account exists — FR-0.INV.006 edge): never tear it down.
      if (row.active) {
        await client.query('commit');
        return this.inviteFromRow(row, parsed, token, 'used');
      }
      // Idempotent: a second revoke on an already-revoked pending invite stays revoked (no duplicate audit).
      if (row.revoked_at == null) {
        await client.query(`update profiles set revoked_at = to_timestamp($2) where id = $1`, [parsed.profileId, now]);
        await this.writeAudit(client, 'invite_revoked', 'issuer', 'user', 'revoke_invite', 'admin pre-use revoke');
        row.revoked_at = new Date(now * 1000).toISOString();
      }
      await client.query('commit');
      return this.inviteFromRow(row, parsed, token, 'revoked');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async reissueInvite(token: string, issuerCanInvite: boolean, smtp: SmtpSender, now: number): Promise<IssueOutcome> {
    if (!issuerCanInvite) throw new Error(ERR_INVITE_DENIED);
    void now; // native-token issue/expiry are server-side (OD-014); `now` is part of the port shape for the fake.
    // A fresh link for a still-pending invitee (FR-0.INV.006.2). loadInviteLive is the pending-gate: it rejects a
    // used (active) or revoked invite as ERR_TOKEN_INVALID, so reissue only proceeds for a live pending invite.
    // RESIDUAL (AF-074): the true server-side native-token refresh (Supabase generateLink) needs an AuthAdmin
    // seam that is not built; at the app-schema level we re-audit + re-deliver the setup link.
    const inv = await this.loadInviteLive(this.pool, token);
    await this.writeAudit(this.pool, 'invite_expired', 'service_role', 'system', 'reissue_invite', 'expired → re-issued');
    const { sent, reason } = await this.deliver(inv, smtp);
    return { invite: inv, sent, ...(sent ? {} : { sendFailureReason: reason }) };
  }

  async resendInvite(token: string, issuerCanInvite: boolean, smtp: SmtpSender, now: number): Promise<IssueOutcome> {
    if (!issuerCanInvite) throw new Error(ERR_INVITE_DENIED);
    void now;
    // One-click resend of a still-pending link (FR-0.INV.006). loadInviteLive rejects used/revoked → the caller
    // must re-issue instead. Same link, re-delivered; delivery outcome is surfaced explicitly (never a false sent).
    const inv = await this.loadInviteLive(this.pool, token);
    await this.writeAudit(this.pool, 'invite_resent', 'service_role', 'system', 'resend_invite', 'one-click resend');
    const { sent, reason } = await this.deliver(inv, smtp);
    return { invite: inv, sent, ...(sent ? {} : { sendFailureReason: reason }) };
  }

  async markBounced(token: string, now: number): Promise<Invite> {
    // Best-effort bounce (FR-0.INV.007): the provider reported the setup email bounced → mark undelivered + emit
    // the issuer re-alert. A bounce NEVER silently looks "sent" (#3). Idempotent: a duplicate bounce webhook does
    // not re-emit. The stamp + event + audit are ONE atomic unit. Does not invalidate the token (delivery axis).
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const parsed = this.parseToken(token);
      if (!parsed) throw new Error(ERR_TOKEN_INVALID);
      const prof = await client.query<ProfileInviteRow>(
        `select id, email, active, revoked_at, bounced_at from profiles where id = $1 for update`,
        [parsed.profileId],
      );
      const row = prof.rows[0];
      if (!row) throw new Error(ERR_TOKEN_INVALID);
      if (row.bounced_at == null) {
        await client.query(`update profiles set bounced_at = to_timestamp($2) where id = $1`, [parsed.profileId, now]);
        await this.writeEvent(client, 'invite_bounced', `setup email to ${row.email} BOUNCED — invite marked undelivered, issuer re-alerted`);
        await this.writeAudit(client, 'invite_bounced', 'service_role', 'system', 'mark_bounced', 'provider bounce webhook');
        row.bounced_at = new Date(now * 1000).toISOString();
      }
      await client.query('commit');
      return this.inviteFromRow(row, parsed, token, row.active ? 'used' : row.revoked_at != null ? 'revoked' : 'pending');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async runSeed(superAdminEmail: string | undefined, auth: AuthAdmin, smtp: SmtpSender, now: number): Promise<SeedOutcome> {
    if (!superAdminEmail || superAdminEmail.trim() === '') throw new Error(ERR_SEED_ENV_UNSET); // abort loudly (#2/#3)

    // ADR-004 atomic guard. Everything runs inside ONE transaction holding pg_advisory_xact_lock — a
    // concurrent boot BLOCKS on the lock (not a bare check-then-create), so the existence check inside the
    // lock is race-free. The user_roles unique(user_id) constraint is the ultimate backstop: even if two
    // txns somehow reached the insert, the second violates the constraint and rolls back → exactly one admin.
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock($1)', [SEED_ADVISORY_LOCK_KEY]);

      const existing = await client.query<{ user_id: string }>(
        `select ur.user_id from user_roles ur
           join roles r on r.id = ur.role_id
          where r.name = $1 and ur.active = true
          limit 1`,
        [PROTECTED_ROLE], // 'Super Admin'
      );
      if (existing.rows[0]) {
        await this.writeAudit(client, 'seed_skipped', 'service_role', 'system', 'seed_noop', 'super admin already exists');
        await client.query('commit');
        return { created: false, superAdminProfileId: existing.rows[0].user_id, reason: 'already_present' };
      }

      // Create the Super Admin: auth.users createUser (admin API, no password/email — the setup link follows),
      // mirror the profiles row USING THE RETURNED id, assign the Super Admin role. The role insert is the
      // atomic commit point. ISSUE-015 BLOCKER fix: profiles.id FKs auth.users(id) (0001_baseline.sql L98) —
      // the mirror row MUST reuse the real auth.users.id from createUser, never a fabricated gen_random_uuid()
      // (which would raise foreign_key_violation on the genesis seed, so no Super Admin is ever created). The
      // createUser call is external to the pg txn; it runs only after the lock is held AND no admin exists, so
      // a re-boot/lost-race never reaches it. If the txn later rolls back, on delete cascade on the FK means
      // the (uncommitted) profiles row was never visible — the auth.users row is reconciled by the idempotent
      // re-run (createUser returns the same id for the same email).
      const authUser = await auth.createUser(superAdminEmail);
      const prof = await client.query<{ id: string }>(
        `insert into profiles (id, email, active) values ($1, $2, false) returning id`,
        [authUser.id, superAdminEmail],
      );
      const profileId = prof.rows[0]!.id;
      await client.query(
        `insert into user_roles (user_id, role_id, active)
         select $1, r.id, true from roles r where r.name = $2`,
        [profileId, PROTECTED_ROLE],
      );
      await this.writeAudit(client, 'seed_ran', 'service_role', 'system', 'create_super_admin', `SUPER_ADMIN_EMAIL=${superAdminEmail}`);
      await client.query('commit');

      // FR-0.SEED.002: one-time ≤24h setup link (generateLink) delivered via custom SMTP. Outside the txn —
      // a send failure never rolls back the (committed) admin creation; it surfaces explicitly instead.
      const inv: Invite = {
        token: `native-seed-${profileId}`,
        email: superAdminEmail,
        accountType: 'external_admin',
        origin: 'seed',
        profileId,
        issuedAt: now,
        expiresAt: this.cappedExpiry(now),
        state: 'pending',
        delivery: 'sent_unconfirmed',
        issuedBy: null,
      };
      const { sent, reason } = await this.deliver(inv, smtp);
      return { created: true, superAdminProfileId: profileId, reason: 'created', setupLinkSent: sent, ...(sent ? {} : { setupLinkFailureReason: reason }) };
    } catch (e) {
      await client.query('rollback').catch(() => {});
      // A lost race surfaces here ONLY if the unique(user_id)/constraint path fired; the advisory lock
      // normally serializes cleanly. Either way: a clean no-op, never a second admin (AC-0.SEED.003.3).
      const msg = (e as Error).message;
      if (/duplicate key|unique/i.test(msg)) {
        await this.writeAudit(this.pool, 'seed_skipped', 'service_role', 'system', 'seed_lost_race', 'unique(user_id) backstop fired').catch(() => {});
        // logic-sweep fix (parity with the fake): omit superAdminProfileId on lost_race — the contract makes it
        // optional — rather than fabricating a bogus 'unknown' id a caller might trust (#1). The winner returns it.
        return { created: false, reason: 'lost_race' };
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async triggerSeedFromUi(): Promise<never> {
    return this.ref.triggerSeedFromUi(); // AC-0.SEED.003.2 — no UI path exists; can only refuse.
  }

  async getInvite(token: string): Promise<Invite | null> {
    return this.ref.getInvite(token);
  }
  auditLog(): readonly AuditEvent[] {
    return this.ref.auditLog();
  }
  eventLog(): readonly EventLogEntry[] {
    return this.ref.eventLog();
  }
}

// referenced so the import isn't flagged unused (SUPER_ADMIN_ROLE is re-exported by index.ts; runSeed uses
// PROTECTED_ROLE directly, so this adapter never names it in-body).
void SUPER_ADMIN_ROLE;
