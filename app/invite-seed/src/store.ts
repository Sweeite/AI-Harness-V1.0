// ISSUE-015 — the InviteSeedStore PORT + in-memory FAKE reference model (house port+fake pattern, cf.
// app/hard-limits/store.ts, app/rbac/store.ts). The fake IS the reference model the live pg adapter
// (supabase-store.ts) must match against the baseline DDL (0001_baseline.sql: profiles, support_requests,
// roles, user_roles, event_log, access_audit).
//
// It owns the CODE half of invite + seed genesis:
//   - invite issuance (native ≤24h token, OD-014 — NO custom token table) gated on PERM-user.invite,
//     public-signup OFF (FR-0.INV.001/.002); send via the SmtpSender with EXPLICIT send-failure surfacing
//     (FR-0.INV.003) — a failed send never yields a false "sent";
//   - the setup flow (validate token server-side → method by account type; Option A OAuth-connect no
//     password; Option B password→TOTP; partial Option-B does NOT activate) (FR-0.INV.004);
//   - activation → role-default redirect (writes the profiles mirror row, reads user_roles — C1 seam)
//     (FR-0.INV.005);
//   - the invite lifecycle: expire/re-issue, pre-use revoke (revoking a USED invite is a no-op), one-click
//     resend — all access_audit-logged (FR-0.INV.006);
//   - best-effort bounce surfacing → mark undelivered + re-alert issuer (FR-0.INV.007, primary control is
//     the send-side guard; full reconciliation OOS-015);
//   - the SEED: create the first Super Admin from SUPER_ADMIN_EMAIL under an ATOMIC guard (ADR-004:
//     pg_advisory_xact_lock + the user_roles unique(user_id) constraint — NOT a bare check-then-create), so
//     concurrent boots mint EXACTLY ONE admin; abort loudly if the env is unset; no UI re-trigger
//     (FR-0.SEED.001/.002/.003).
//
// It does NOT own: OAuth mechanics / password submission / TOTP factor logic / session (ISSUE-013/014 — this
// slice WIRES to those seams), the PERM-user.invite node definition + can() gate (ISSUE-018 — consumed here),
// role assignment + per-role default-view definition (C1/ISSUE-018 — read only to route), UI-USER-MGMT
// rendering (ISSUE-021), the support_requests table DDL (ISSUE-016 — the setup error state links into it).

// Cross-package binding to the RBAC role catalog (ISSUE-013/018). The repo has no npm workspace / path
// alias wiring for the `@harness/*` bare specifier (every sibling's `@harness/*` mention is a comment, not a
// runtime import), and editing a root workspace/tsconfig file is out of bounds for this fan-out slice. So we
// bind to the leaf catalog module by relative path — `PROTECTED_ROLE` IS the seeded Super Admin role name,
// making this slice's Super-Admin identity a single source of truth with the role catalog (AF-080 non-drift).
// catalog.ts is a pure leaf (no `pg`), so this adds no DB coupling at import time.
import { PROTECTED_ROLE } from '../../rbac/src/catalog.ts';
import {
  LINK_TTL_HARD_CAP_SECONDS,
  SAFE_NO_ACCESS_VIEW,
  type AccountType,
  type Activation,
  type Invite,
  type LinkOrigin,
  type SetupMethod,
} from './types.ts';
import {
  ERR_SMTP_NOT_CONFIGURED,
  type SmtpMessage,
  type SmtpSender,
} from './smtp.ts';
import { type AuthAdmin } from './auth-admin.ts';

// PROTECTED_ROLE from @harness/rbac IS the seeded Super Admin role name — single source of truth, so this
// slice can never drift from the role catalog (AF-080 non-drift discipline).
export const SUPER_ADMIN_ROLE = PROTECTED_ROLE; // 'Super Admin'

// ── error surfaces (the exact messages a test asserts, mirroring what the live silo raises) ───────────────
export const ERR_SEED_ENV_UNSET =
  'SUPER_ADMIN_EMAIL is not set — the seed ABORTS (it will never create a blank/guessable admin). ' +
  'Set the deployment env and re-run (FR-0.SEED.001 / #2/#3).';

export const ERR_INVITE_DENIED =
  'PERM-user.invite denied — only an Admin/Super Admin may issue, revoke, or resend an invite ' +
  '(default-deny; the node + can() gate are homed in ISSUE-018).';

export const ERR_PUBLIC_SIGNUP_OFF =
  'self-registration is not permitted — accounts are invite-only (public signup toggle OFF; ' +
  'FR-0.INV.001 / AC-0.INV.001.1).';

export const ERR_TOKEN_INVALID =
  'setup token is invalid, expired, used, or revoked — no setup occurs; request a new link ' +
  '(routes to the support-request intake, FR-0.REC.002 seam). Never a blank/half-activated account.';

export const ERR_METHOD_MISMATCH =
  'setup method does not match the account type (OD-020: one method) — a client-tenant user connects OAuth ' +
  '(no password); an external admin sets password+TOTP.';

/** The per-role default-view routing table (FR-0.INV.005 seam). The authoritative definition is C1's; this
 *  is the C0-visible redirect map. A role absent here (or a null role) lands on the safe no-access view. */
// The six seeded roles are @harness/rbac's ROLES (catalog.ts): Super Admin, Admin, Finance, HR, Account
// Manager, Standard User. A role absent here (or a null role) lands on the safe no-access view.
export const ROLE_DEFAULT_VIEW: Readonly<Record<string, string>> = Object.freeze({
  'Super Admin': '/admin/overview',
  Admin: '/admin/overview',
  Finance: '/dashboard/finance',
  HR: '/dashboard/hr',
  'Account Manager': '/dashboard/overview',
  'Standard User': '/dashboard/home',
});

/** An access_audit row (0001_baseline.sql access_audit — append-only, immutable). We write the subset the
 *  invite/seed lifecycle produces: invite-issued/expired/revoked/resend, seed-ran/seed-skipped. */
export interface AuditEvent {
  id: string;
  audit_type: string; // e.g. 'invite_issued', 'invite_revoked', 'seed_ran', 'seed_skipped'
  actor_identity: string; // issuer email / 'service_role' for the seed
  actor_type: 'user' | 'system';
  action: string;
  target_type: string | null;
  reason: string | null;
  created_at: string;
}

/** The `event_type` enum values THIS slice writes into the append-only `event_log` sink. The live column is
 *  a Postgres ENUM (`type event_type`, 0001_baseline.sql L60-65, extended in 0007) — a value outside the
 *  admitted set raises `invalid input value for enum event_type` against the real silo. NONE of these four
 *  are in the baseline/0007 enum yet — they are an ADDITIVE delta owed to migration 0011 (documented in
 *  results/proposed-shared-spec.md; the orchestrator authors it). We freeze the set HERE so the in-memory
 *  fake fails closed on any unadmitted value exactly as the live enum would — the offline guard that makes
 *  the fake-vs-live enum drift impossible to pass (house pattern: `isTaskType` in app/triggers/src/store.ts,
 *  the AuthEventType union in app/auth/src/store.ts). Keep this list in LOCKSTEP with the 0011 delta. */
export const INVITE_SEED_EVENT_TYPES = [
  'account_activated', // FR-0.INV.005 — an account activated via setup completion.
  'email_send_ok', // FR-0.INV.003 — a setup email was sent (unconfirmed).
  'email_send_failed', // FR-0.INV.003 — a setup email send FAILED (#3, explicit).
  'invite_bounced', // FR-0.INV.007 — a provider bounce marked the invite undelivered.
] as const;
export type InviteSeedEventType = (typeof INVITE_SEED_EVENT_TYPES)[number];
/** Fail-closed guard mirroring the live Postgres enum: is `v` an admitted `event_type` value? */
export function isInviteSeedEventType(v: string): v is InviteSeedEventType {
  return (INVITE_SEED_EVENT_TYPES as readonly string[]).includes(v);
}

/** Raised when an `event_type` NOT in the admitted set is written — the offline mirror of the live enum's
 *  `invalid input value for enum event_type`. This is what turns a fake-vs-live enum drift from a silent
 *  green test into a LOUD offline failure (#3). */
export const ERR_UNADMITTED_EVENT_TYPE =
  'event_type is not an admitted invite/seed value — it is not in the live Postgres event_type enum ' +
  '(0001_baseline.sql + 0007 + the 0011 additive delta in results/proposed-shared-spec.md). A write of an ' +
  'unadmitted value would raise `invalid input value for enum event_type` against the real silo (#3).';

/** An event_log row (0001_baseline.sql event_log — append-only). Activation + email send success/failure
 *  feed FR-0.AUTH.010 completeness (owned by ISSUE-013); this slice emits the C0 events. */
export interface EventLogEntry {
  id: string;
  event_type: InviteSeedEventType; // admitted set only — the fake rejects anything else (mirrors the live enum)
  summary: string; // plain-English; never empty (mirrors AC-7.LOG.002.2)
  created_at: string;
}

/** The outcome of an invite-issuance attempt — the invite plus the send result surfaced to the issuer. */
export interface IssueOutcome {
  invite: Invite;
  /** true iff the email actually went out (send-side). false ⇒ an explicit, issuer-visible failure. */
  sent: boolean;
  /** present iff !sent — the explicit failure the issuer sees (never a false "sent", #3). */
  sendFailureReason?: string;
}

/** The outcome of a seed run — created (this boot won the atomic guard) or skipped (a Super Admin exists /
 *  a concurrent boot won). Never throws on a lost race — a lost race is a clean no-op (FR-0.SEED.003). */
export interface SeedOutcome {
  created: boolean;
  /** the seeded Super Admin profile id (present whether created here or already-present). */
  superAdminProfileId: string;
  /** 'created' | 'already_present' | 'lost_race' — the three no-second-admin outcomes. */
  reason: 'created' | 'already_present' | 'lost_race';
  /** the send result of the one-time setup link (only attempted on the winning creation). */
  setupLinkSent?: boolean;
  setupLinkFailureReason?: string;
}

export interface IssueInviteInput {
  email: string;
  accountType: AccountType;
  /** the issuer's profile id (the caller has already passed the PERM-user.invite can() gate — see canInvite). */
  issuedBy: string;
  /** whether the caller holds PERM-user.invite. The node + can() live in ISSUE-018; this slice consumes the
   *  boolean gate result and fails closed if false (#2). */
  canInvite: boolean;
  /** requested TTL in seconds; CLAMPED to LINK_TTL_HARD_CAP_SECONDS (AF-074) — never silently exceeded. */
  ttlSeconds?: number;
  now: number; // epoch seconds (deterministic)
}

export interface CompleteSetupInput {
  token: string;
  method: SetupMethod;
  /** Option-B only: whether the TOTP factor was actually enrolled. A false here (password set, TOTP
   *  abandoned) must NOT activate the account (FR-0.INV.004 edge — no half-provisioned account). */
  totpEnrolled?: boolean;
  now: number;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PORT. Async so the pg adapter matches. Every invariant a live silo enforces is enforced here.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface InviteSeedStore {
  /** FR-0.INV.001/.002/.003: issue a native ≤24h invite, gated on PERM-user.invite, public-signup OFF.
   *  Creates the auth.users row via the admin API (`auth`) FIRST and reuses its id for the profiles mirror
   *  (FK to auth.users(id) — never a fabricated id); delivers via SMTP with EXPLICIT send-failure surfacing.
   *  Fails closed if !canInvite. */
  issueInvite(input: IssueInviteInput, auth: AuthAdmin, smtp: SmtpSender): Promise<IssueOutcome>;

  /** FR-0.INV.001: self-registration is always rejected (no account created). */
  attemptSelfRegister(email: string): Promise<never>;

  /** FR-0.INV.002/.006: validate a setup token server-side — expired/used/revoked all reject (invalid). */
  validateToken(token: string, now: number): Promise<Invite>;

  /** FR-0.INV.004/.005: complete setup on a valid token → activate + resolve role-default redirect. A
   *  partial Option-B (totpEnrolled=false) does NOT activate. Method must match the account type (OD-020). */
  completeSetup(input: CompleteSetupInput): Promise<Activation>;

  /** FR-0.INV.006: revoke an outstanding invite pre-use (audited). Revoking a USED invite is a no-op. */
  revokeInvite(token: string, issuerCanInvite: boolean, now: number): Promise<Invite>;

  /** FR-0.INV.006/.002: re-issue a fresh ≤24h link for an expired/revoked invite (audited). */
  reissueInvite(token: string, issuerCanInvite: boolean, smtp: SmtpSender, now: number): Promise<IssueOutcome>;

  /** FR-0.INV.006: one-click resend of a still-pending invite (audited). */
  resendInvite(token: string, issuerCanInvite: boolean, smtp: SmtpSender, now: number): Promise<IssueOutcome>;

  /** FR-0.INV.007: mark an invite undelivered on a provider bounce + re-alert the issuer (best-effort). */
  markBounced(token: string, now: number): Promise<Invite>;

  /** FR-0.SEED.001/.002/.003: run the seed. Aborts loudly if SUPER_ADMIN_EMAIL is unset. Creates the first
   *  Super Admin under the ADR-004 atomic guard — the auth.users row via the admin API (`auth`), its returned
   *  id reused for the profiles mirror (FK to auth.users(id)); a lost race is a clean no-op (never a second
   *  admin). */
  runSeed(superAdminEmail: string | undefined, auth: AuthAdmin, smtp: SmtpSender, now: number): Promise<SeedOutcome>;

  /** There is NO UI path to the seed (FR-0.SEED.003 / AC-0.SEED.003.2) — this always refuses. */
  triggerSeedFromUi(): Promise<never>;

  getInvite(token: string): Promise<Invite | null>;
  auditLog(): readonly AuditEvent[];
  eventLog(): readonly EventLogEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the reference model. Deterministic; `now` (epoch seconds) is caller-supplied.
// The atomic seed guard is modelled with a single-threaded critical-section token so a test can drive two
// concurrent runs and prove exactly-one — mirroring pg_advisory_xact_lock + the user_roles unique(user_id)
// backstop the live adapter relies on (ADR-004).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryInviteSeedStore implements InviteSeedStore {
  private seq = 0;
  readonly invites = new Map<string, Invite>();
  /** profiles mirror rows (subset): id → {email, active}. */
  readonly profiles = new Map<string, { email: string; active: boolean }>();
  /** user_roles (subset): profileId → roleName. The unique(user_id) constraint = one row per profile. */
  readonly userRoles = new Map<string, string>();
  private readonly audit: AuditEvent[] = [];
  private readonly events: EventLogEntry[] = [];
  /** the ADR-004 atomic-guard latch: true while a seed critical section is in flight (advisory-lock model). */
  private seedLockHeld = false;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  private writeAudit(e: Omit<AuditEvent, 'id' | 'created_at'>, now: number): void {
    this.audit.push({ id: this.nextId('aud'), created_at: this.iso(now), ...e });
  }
  private writeEvent(event_type: string, summary: string, now: number): void {
    // Enum guard — the live `event_log.event_type` column is a Postgres ENUM; a value outside the admitted
    // set raises `invalid input value for enum event_type` against the real silo. The fake mirrors that
    // fail-closed behaviour so a fake-vs-live enum drift can NEVER pass offline (#3). Defence-in-depth: the
    // internal callers pass admitted literals, but a value drifting to an unadmitted string must still throw.
    if (!isInviteSeedEventType(event_type)) throw new Error(ERR_UNADMITTED_EVENT_TYPE);
    if (!summary || summary.trim() === '') throw new Error('event_log.summary must not be empty (AC-7.LOG.002.2)');
    this.events.push({ id: this.nextId('evt'), event_type, summary, created_at: this.iso(now) });
  }

  /** AF-074: clamp any requested TTL down to the 24h hard cap. Never silently exceed it. */
  private cappedExpiry(now: number, ttlSeconds?: number): number {
    const requested = ttlSeconds ?? LINK_TTL_HARD_CAP_SECONDS;
    const bounded = Math.min(requested, LINK_TTL_HARD_CAP_SECONDS);
    return now + bounded;
  }

  private setupLink(token: string): string {
    return `/auth/setup?token=${token}`; // UI-INVITE-SETUP entry (reused for the seed admin).
  }

  private async deliver(inv: Invite, smtp: SmtpSender, now: number): Promise<{ sent: boolean; reason?: string }> {
    const msg: SmtpMessage = {
      to: inv.email,
      subject: inv.origin === 'seed' ? 'Set up your Super Admin account' : 'You have been invited',
      setupLink: this.setupLink(inv.token),
    };
    const res = await smtp.send(msg);
    if (res.ok) {
      inv.delivery = 'sent_unconfirmed';
      this.writeEvent('email_send_ok', `setup email sent (unconfirmed) to ${inv.email} [${inv.origin}]`, now);
      return { sent: true };
    }
    inv.delivery = 'send_failed';
    // Explicit issuer-visible failure event — never a silent drop (#3 / AC-0.INV.003.1).
    this.writeEvent('email_send_failed', `setup email SEND FAILED to ${inv.email}: ${res.reason}`, now);
    return { sent: false, reason: res.reason ?? ERR_SMTP_NOT_CONFIGURED };
  }

  private mintInvite(
    email: string,
    accountType: AccountType,
    origin: LinkOrigin,
    issuedBy: string | null,
    now: number,
    ttlSeconds: number | undefined,
    profileId: string,
  ): Invite {
    const inv: Invite = {
      token: this.nextId('tok'),
      email,
      accountType,
      origin,
      profileId,
      issuedAt: now,
      expiresAt: this.cappedExpiry(now, ttlSeconds),
      state: 'pending',
      delivery: 'sent_unconfirmed',
      issuedBy,
    };
    this.invites.set(inv.token, inv);
    return inv;
  }

  async issueInvite(input: IssueInviteInput, auth: AuthAdmin, smtp: SmtpSender): Promise<IssueOutcome> {
    // FAIL CLOSED on the permission gate (#2). The node + can() are ISSUE-018's; we consume the boolean.
    if (!input.canInvite) throw new Error(ERR_INVITE_DENIED);

    // Public signup is OFF — an admin-issued invite is the ONLY genesis path (FR-0.INV.001). Create the
    // auth.users row via the admin API FIRST; its returned id IS the profiles-mirror primary key (profiles.id
    // FKs auth.users(id) — 0001_baseline.sql L98). Reusing it (never a fabricated gen_random_uuid()) is what
    // guarantees the mirror row always has a real auth.users parent (the ISSUE-015 BLOCKER fix). Mirror row is
    // inactive until activation (FR-1.USR.002 deactivation ≠ delete semantics apply).
    const authUser = await auth.createUser(input.email);
    const profileId = authUser.id;
    this.profiles.set(profileId, { email: input.email, active: false });

    const inv = this.mintInvite(
      input.email,
      input.accountType,
      'invite',
      input.issuedBy,
      input.now,
      input.ttlSeconds,
      profileId,
    );
    this.writeAudit(
      { audit_type: 'invite_issued', actor_identity: input.issuedBy, actor_type: 'user', action: 'issue_invite', target_type: 'invite', reason: null },
      input.now,
    );

    const { sent, reason } = await this.deliver(inv, smtp, input.now);
    return { invite: inv, sent, ...(sent ? {} : { sendFailureReason: reason }) };
  }

  async attemptSelfRegister(_email: string): Promise<never> {
    // No public signup path exists — this entry point can only refuse (AC-0.INV.001.1). No account created.
    throw new Error(ERR_PUBLIC_SIGNUP_OFF);
  }

  /** Lazily fold an elapsed-TTL pending invite into 'expired' so validation/state are consistent. */
  private refreshExpiry(inv: Invite, now: number): void {
    if (inv.state === 'pending' && now >= inv.expiresAt) inv.state = 'expired';
  }

  async validateToken(token: string, now: number): Promise<Invite> {
    const inv = this.invites.get(token);
    if (!inv) throw new Error(ERR_TOKEN_INVALID);
    this.refreshExpiry(inv, now);
    // Expired / used / revoked all reject as invalid — routed to the support-request re-request path, never a
    // blank/half-activated account (FR-0.INV.006 / FR-0.REC.002 seam).
    if (inv.state !== 'pending') throw new Error(ERR_TOKEN_INVALID);
    return inv;
  }

  async completeSetup(input: CompleteSetupInput): Promise<Activation> {
    const inv = await this.validateToken(input.token, input.now); // rejects expired/used/revoked

    // OD-020: one method, fixed by account type. A client-tenant user connects OAuth (no password); an
    // external admin sets password+TOTP. A mismatch is rejected (never set a password on a client user).
    if (inv.accountType === 'client_tenant' && input.method !== 'oauth') throw new Error(ERR_METHOD_MISMATCH);
    if (inv.accountType === 'external_admin' && input.method !== 'password_totp') throw new Error(ERR_METHOD_MISMATCH);

    // Option B (external admin): the account activates ONLY once BOTH the password credential AND the TOTP
    // factor are established. A partial Option-B (password set, TOTP abandoned) leaves the account inactive —
    // no half-provisioned account (FR-0.INV.004 edge). TOTP factor logic itself is ISSUE-014; we gate on the
    // enrolled boolean it reports back.
    const activated = inv.accountType === 'client_tenant' ? true : input.totpEnrolled === true;

    const roleName = this.userRoles.get(inv.profileId) ?? null;
    const redirectView = activated
      ? (roleName ? (ROLE_DEFAULT_VIEW[roleName] ?? SAFE_NO_ACCESS_VIEW) : SAFE_NO_ACCESS_VIEW)
      : SAFE_NO_ACCESS_VIEW;

    if (activated) {
      // Activate the profiles mirror row and consume the token (FR-0.INV.005). The token can never re-activate.
      const prof = this.profiles.get(inv.profileId);
      if (prof) prof.active = true;
      inv.state = 'used';
      this.writeEvent('account_activated', `account ${inv.email} activated via ${input.method} → ${redirectView}`, input.now);
    }
    // A partial Option-B does NOT consume the token — the user can return to finish TOTP (still ≤24h).

    return {
      profileId: inv.profileId,
      email: inv.email,
      accountType: inv.accountType,
      method: input.method,
      activated,
      roleName,
      redirectView,
    };
  }

  async revokeInvite(token: string, issuerCanInvite: boolean, now: number): Promise<Invite> {
    if (!issuerCanInvite) throw new Error(ERR_INVITE_DENIED);
    const inv = this.invites.get(token);
    if (!inv) throw new Error(ERR_TOKEN_INVALID);
    this.refreshExpiry(inv, now);
    // Revoking an already-USED invite is a NO-OP (the account already exists — FR-0.INV.006 edge). We do not
    // error and we do not tear down the account; we just leave the used state and log nothing new.
    if (inv.state === 'used') return inv;
    inv.state = 'revoked';
    this.writeAudit(
      { audit_type: 'invite_revoked', actor_identity: 'issuer', actor_type: 'user', action: 'revoke_invite', target_type: 'invite', reason: 'admin pre-use revoke' },
      now,
    );
    return inv;
  }

  async reissueInvite(token: string, issuerCanInvite: boolean, smtp: SmtpSender, now: number): Promise<IssueOutcome> {
    if (!issuerCanInvite) throw new Error(ERR_INVITE_DENIED);
    const old = this.invites.get(token);
    if (!old) throw new Error(ERR_TOKEN_INVALID);
    // logic-sweep fix: reissue is only for an expired/revoked invite (port doc L206) — a USED invite already
    // backs an active account, so re-minting a fresh setup link would be an unpermitted re-setup path (#2) and
    // would leave the used token + a fresh live token coexisting for the same profile. Reject it, mirroring
    // revokeInvite's used-invite no-op.
    if (old.state === 'used') throw new Error(ERR_TOKEN_INVALID);
    // A fresh ≤24h link for the SAME invitee/profile (FR-0.INV.006.2). The old token is retired.
    if (old.state === 'pending') old.state = 'expired';
    const fresh = this.mintInvite(old.email, old.accountType, old.origin, old.issuedBy, now, undefined, old.profileId);
    this.writeAudit(
      { audit_type: 'invite_expired', actor_identity: old.issuedBy ?? 'service_role', actor_type: old.issuedBy ? 'user' : 'system', action: 'reissue_invite', target_type: 'invite', reason: 'expired → re-issued' },
      now,
    );
    const { sent, reason } = await this.deliver(fresh, smtp, now);
    return { invite: fresh, sent, ...(sent ? {} : { sendFailureReason: reason }) };
  }

  async resendInvite(token: string, issuerCanInvite: boolean, smtp: SmtpSender, now: number): Promise<IssueOutcome> {
    if (!issuerCanInvite) throw new Error(ERR_INVITE_DENIED);
    const inv = this.invites.get(token);
    if (!inv) throw new Error(ERR_TOKEN_INVALID);
    this.refreshExpiry(inv, now);
    // One-click resend of a still-pending link (FR-0.INV.006). If it has expired, the caller should re-issue.
    if (inv.state !== 'pending') throw new Error(ERR_TOKEN_INVALID);
    this.writeAudit(
      { audit_type: 'invite_resent', actor_identity: inv.issuedBy ?? 'service_role', actor_type: inv.issuedBy ? 'user' : 'system', action: 'resend_invite', target_type: 'invite', reason: 'one-click resend' },
      now,
    );
    const { sent, reason } = await this.deliver(inv, smtp, now);
    return { invite: inv, sent, ...(sent ? {} : { sendFailureReason: reason }) };
  }

  async markBounced(token: string, now: number): Promise<Invite> {
    const inv = this.invites.get(token);
    if (!inv) throw new Error(ERR_TOKEN_INVALID);
    // Best-effort bounce (FR-0.INV.007): the provider reported the setup email bounced → mark undelivered +
    // re-alert the issuer. Full reconciliation is OOS-015. A bounce never silently looks "sent".
    inv.delivery = 'bounced';
    this.writeEvent('invite_bounced', `setup email to ${inv.email} BOUNCED — invite marked undelivered, issuer re-alerted`, now);
    this.writeAudit(
      { audit_type: 'invite_bounced', actor_identity: inv.issuedBy ?? 'service_role', actor_type: inv.issuedBy ? 'user' : 'system', action: 'mark_bounced', target_type: 'invite', reason: 'provider bounce webhook' },
      now,
    );
    return inv;
  }

  /** Does a Super Admin already exist? (a user_roles row for the Super Admin role). */
  private superAdminExists(): string | null {
    for (const [profileId, roleName] of this.userRoles) {
      if (roleName === SUPER_ADMIN_ROLE) return profileId;
    }
    return null;
  }

  async runSeed(superAdminEmail: string | undefined, auth: AuthAdmin, smtp: SmtpSender, now: number): Promise<SeedOutcome> {
    // FR-0.SEED.001: env unset → ABORT LOUDLY. Never create a blank/guessable admin (#2/#3).
    if (!superAdminEmail || superAdminEmail.trim() === '') throw new Error(ERR_SEED_ENV_UNSET);

    // ADR-004 atomic guard (advisory-lock model). A second run that arrives while the lock is held loses the
    // race cleanly — it does NOT bare-check-then-create. On the live adapter this is pg_advisory_xact_lock +
    // the user_roles unique(user_id) constraint as the ultimate backstop.
    if (this.seedLockHeld) {
      // A concurrent run cannot acquire the lock → clean no-op, never a second admin (AC-0.SEED.003.3).
      const existing = this.superAdminExists();
      this.writeAudit(
        { audit_type: 'seed_skipped', actor_identity: 'service_role', actor_type: 'system', action: 'seed_lost_race', target_type: 'user', reason: 'atomic guard held by concurrent boot' },
        now,
      );
      return { created: false, superAdminProfileId: existing ?? 'unknown', reason: 'lost_race' };
    }

    this.seedLockHeld = true;
    try {
      // Inside the critical section: the existence check is now race-free (the lock serializes boots).
      const existing = this.superAdminExists();
      if (existing) {
        // Super Admin present → exit, no-op (AC-0.SEED.003.1: re-boot mints no second admin).
        this.writeAudit(
          { audit_type: 'seed_skipped', actor_identity: 'service_role', actor_type: 'system', action: 'seed_noop', target_type: 'user', reason: 'super admin already exists' },
          now,
        );
        return { created: false, superAdminProfileId: existing, reason: 'already_present' };
      }

      // Create the first Super Admin (no password, no auto-email — the setup link follows). The auth.users row
      // is created via the admin API and its returned id IS the profiles-mirror primary key (profiles.id FKs
      // auth.users(id) — never a fabricated id; the ISSUE-015 BLOCKER fix). Assign the role; the
      // unique(user_id) constraint makes the role assignment itself the atomic commit point.
      const authUser = await auth.createUser(superAdminEmail);
      const profileId = authUser.id;
      this.profiles.set(profileId, { email: superAdminEmail, active: false });
      this.userRoles.set(profileId, SUPER_ADMIN_ROLE);
      this.writeAudit(
        { audit_type: 'seed_ran', actor_identity: 'service_role', actor_type: 'system', action: 'create_super_admin', target_type: 'user', reason: `SUPER_ADMIN_EMAIL=${superAdminEmail}` },
        now,
      );

      // FR-0.SEED.002: one-time ≤24h setup link via generateLink, delivered via custom SMTP (reuses the
      // invite path). Send-failure is surfaced; recovery is a deliberate env-change re-run (no UI trigger).
      const inv = this.mintInvite(superAdminEmail, 'external_admin', 'seed', null, now, undefined, profileId);
      const { sent, reason } = await this.deliver(inv, smtp, now);

      return {
        created: true,
        superAdminProfileId: profileId,
        reason: 'created',
        setupLinkSent: sent,
        ...(sent ? {} : { setupLinkFailureReason: reason }),
      };
    } finally {
      this.seedLockHeld = false;
    }
  }

  async triggerSeedFromUi(): Promise<never> {
    // There is deliberately NO UI path to the seed (AC-0.SEED.003.2) — this can only refuse. The only
    // re-trigger is a deliberate deployment env change (guarded by the existence check).
    throw new Error(
      'the seed has no UI trigger (AC-0.SEED.003.2) — recovery is a deliberate deployment env-change re-run ' +
        'only, guarded by the existence check (FR-0.SEED.003).',
    );
  }

  async getInvite(token: string): Promise<Invite | null> {
    return this.invites.get(token) ?? null;
  }
  auditLog(): readonly AuditEvent[] {
    return this.audit;
  }
  eventLog(): readonly EventLogEntry[] {
    return this.events;
  }

  /** Test/seam helper: assign a role to a profile (role assignment is C1's; this mirrors the user_roles row
   *  the redirect reads). Enforces the unique(user_id) one-role-per-user constraint (OD-029). */
  assignRole(profileId: string, roleName: string): void {
    this.userRoles.set(profileId, roleName);
  }

  /** Test/seam helper: drive a raw event_log write through the SAME enum guard the live Postgres enum
   *  enforces. A value outside INVITE_SEED_EVENT_TYPES throws ERR_UNADMITTED_EVENT_TYPE here exactly as the
   *  live silo would raise `invalid input value for enum event_type` — this is what makes a fake-vs-live enum
   *  drift a LOUD offline failure (a test can prove an unadmitted value is rejected). */
  _writeEventForTest(event_type: string, summary: string, now: number): void {
    this.writeEvent(event_type, summary, now);
  }
}
