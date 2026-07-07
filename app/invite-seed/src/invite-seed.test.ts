// ISSUE-015 — offline proof of every AC in §4 (component-00-login.md INV + SEED). The InMemoryInviteSeedStore
// is the reference model; each test names the AC it proves. AF-074's live coupling is residual (LIVE-owed);
// the ≤24h clamp is proven here offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryInviteSeedStore,
  ERR_INVITE_DENIED,
  ERR_PUBLIC_SIGNUP_OFF,
  ERR_SEED_ENV_UNSET,
  ERR_TOKEN_INVALID,
  ERR_METHOD_MISMATCH,
  ERR_UNADMITTED_EVENT_TYPE,
  INVITE_SEED_EVENT_TYPES,
  isInviteSeedEventType,
} from './store.ts';
import { InMemorySmtpSender, ERR_SMTP_NOT_CONFIGURED } from './smtp.ts';
import { InMemoryAuthAdmin } from './auth-admin.ts';
import { LINK_TTL_HARD_CAP_SECONDS, SAFE_NO_ACCESS_VIEW } from './types.ts';

const T0 = 1_700_000_000;

function fresh() {
  return { store: new InMemoryInviteSeedStore(), auth: new InMemoryAuthAdmin(), smtp: new InMemorySmtpSender() };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-0.INV.001.1 — public signup OFF; self-registration creates no account.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-0.INV.001.1 — self-registration is refused, no account created', async () => {
  const { store } = fresh();
  await assert.rejects(() => store.attemptSelfRegister('stranger@example.com'), (e: Error) => e.message === ERR_PUBLIC_SIGNUP_OFF);
  assert.equal(store.profiles.size, 0, 'no profile row created by a self-register attempt');
});

test('AC-0.INV.001.1 — issuance fails closed without PERM-user.invite (#2)', async () => {
  const { store, auth, smtp } = fresh();
  await assert.rejects(
    () => store.issueInvite({ email: 'x@example.com', accountType: 'client_tenant', issuedBy: 'nobody', canInvite: false, now: T0 }, auth, smtp),
    (e: Error) => e.message === ERR_INVITE_DENIED,
  );
  assert.equal(store.invites.size, 0, 'no invite minted without the permission gate');
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-0.INV.002.1 — an issued invite expires ≤24h and is delivered via custom SMTP. (AF-074 offline portion.)
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-0.INV.002.1 — issued invite expires ≤24h and is sent via SMTP', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.issueInvite({ email: 'i@example.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  assert.ok(out.sent, 'delivered via SMTP');
  assert.ok(out.invite.expiresAt - out.invite.issuedAt <= LINK_TTL_HARD_CAP_SECONDS, 'link TTL ≤ 24h');
  assert.equal(smtp.sent.length, 1, 'exactly one email went out');
});

test('AC-0.INV.002.1 — a requested >24h TTL is clamped down to the 24h hard cap (AF-074)', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.issueInvite({ email: 'i@example.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, ttlSeconds: 72 * 3600, now: T0 }, auth, smtp);
  assert.equal(out.invite.expiresAt - out.invite.issuedAt, LINK_TTL_HARD_CAP_SECONDS, '72h request clamped to 24h — never silently exceeded');
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-0.INV.003.1 — SMTP not configured → issuer sees an EXPLICIT failure, never a false "sent" (#3).
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-0.INV.003.1 — SMTP not configured surfaces an explicit send failure', async () => {
  const { store, auth } = fresh();
  const smtp = new InMemorySmtpSender({ notConfigured: true });
  const out = await store.issueInvite({ email: 'i@example.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  assert.equal(out.sent, false, 'not reported as sent');
  assert.equal(out.sendFailureReason, ERR_SMTP_NOT_CONFIGURED, 'explicit, issuer-visible failure reason');
  assert.ok(store.eventLog().some((e) => e.event_type === 'email_send_failed'), 'send failure recorded in event_log (#3)');
  assert.equal(out.invite.delivery, 'send_failed', 'invite marked send_failed, never sent_unconfirmed');
});

test('AC-0.INV.003.1 — a throttled provider also surfaces explicitly (not a false "sent")', async () => {
  const { store, auth } = fresh();
  const smtp = new InMemorySmtpSender({ throttled: true });
  const out = await store.issueInvite({ email: 'i@example.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  assert.equal(out.sent, false);
  assert.ok(out.sendFailureReason && out.sendFailureReason.length > 0);
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-0.INV.004.1 — external admin completes Option B → password + TOTP → account activates.
// AC-0.INV.004.2 — client-tenant user completes Option A → OAuth connected, activates, NO password.
// + edge: partial Option-B (TOTP abandoned) must NOT activate.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-0.INV.004.1 — external admin Option B (password+TOTP) activates', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.issueInvite({ email: 'admin@corp.com', accountType: 'external_admin', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  const act = await store.completeSetup({ token: out.invite.token, method: 'password_totp', totpEnrolled: true, now: T0 + 60 });
  assert.equal(act.activated, true, 'activates once BOTH password and TOTP established');
  assert.equal(store.profiles.get(act.profileId)?.active, true, 'profiles mirror row activated');
  assert.equal((await store.getInvite(out.invite.token))?.state, 'used', 'token consumed');
});

test('AC-0.INV.004.1 edge — partial Option-B (TOTP abandoned) does NOT activate (no half-provisioned account)', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.issueInvite({ email: 'admin@corp.com', accountType: 'external_admin', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  const act = await store.completeSetup({ token: out.invite.token, method: 'password_totp', totpEnrolled: false, now: T0 + 60 });
  assert.equal(act.activated, false, 'password set but TOTP abandoned → NOT active');
  assert.equal(store.profiles.get(act.profileId)?.active, false, 'mirror row stays inactive');
  assert.equal((await store.getInvite(out.invite.token))?.state, 'pending', 'token not consumed — user can return to finish');
});

test('AC-0.INV.004.2 — client-tenant Option A (OAuth) activates with no password', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.issueInvite({ email: 'user@client.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  const act = await store.completeSetup({ token: out.invite.token, method: 'oauth', now: T0 + 60 });
  assert.equal(act.activated, true, 'OAuth connect activates');
  assert.equal(act.method, 'oauth', 'no password path');
});

test('AC-0.INV.004 — method must match account type (OD-020: one method)', async () => {
  const { store, auth, smtp } = fresh();
  const cli = await store.issueInvite({ email: 'user@client.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  await assert.rejects(() => store.completeSetup({ token: cli.invite.token, method: 'password_totp', totpEnrolled: true, now: T0 + 60 }), (e: Error) => e.message === ERR_METHOD_MISMATCH);
  const adm = await store.issueInvite({ email: 'a@corp.com', accountType: 'external_admin', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  await assert.rejects(() => store.completeSetup({ token: adm.invite.token, method: 'oauth', now: T0 + 60 }), (e: Error) => e.message === ERR_METHOD_MISMATCH);
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-0.INV.005.1 — activated account with role R lands on R's default view. + null-role safe landing.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-0.INV.005.1 — activation redirects to the role-default view', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.issueInvite({ email: 'u@client.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  store.assignRole(out.invite.profileId, 'Account Manager'); // role assignment is C1's; we read it to route
  const act = await store.completeSetup({ token: out.invite.token, method: 'oauth', now: T0 + 60 });
  assert.equal(act.roleName, 'Account Manager');
  assert.equal(act.redirectView, '/dashboard/overview', "lands on the Account Manager role-default view");
});

test('AC-0.INV.005.1 — no role assigned → safe no-access landing (never a blank/guessed destination)', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.issueInvite({ email: 'u@client.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  const act = await store.completeSetup({ token: out.invite.token, method: 'oauth', now: T0 + 60 });
  assert.equal(act.roleName, null);
  assert.equal(act.redirectView, SAFE_NO_ACCESS_VIEW);
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-0.INV.006.1 — revoking an unused invite means the link no longer activates; action is logged.
// AC-0.INV.006.2 — re-issuing an expired invite delivers a fresh ≤24h link.
// + edge: revoking a USED invite is a no-op.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-0.INV.006.1 — revoked invite no longer activates, and the revoke is audit-logged', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.issueInvite({ email: 'u@client.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  await store.revokeInvite(out.invite.token, true, T0 + 10);
  await assert.rejects(() => store.completeSetup({ token: out.invite.token, method: 'oauth', now: T0 + 20 }), (e: Error) => e.message === ERR_TOKEN_INVALID);
  assert.ok(store.auditLog().some((a) => a.audit_type === 'invite_revoked'), 'revoke audit-logged');
});

test('AC-0.INV.006.1 edge — revoking an already-used invite is a no-op (account exists)', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.issueInvite({ email: 'u@client.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  await store.completeSetup({ token: out.invite.token, method: 'oauth', now: T0 + 60 }); // now 'used'
  const after = await store.revokeInvite(out.invite.token, true, T0 + 120);
  assert.equal(after.state, 'used', 'revoke of a used invite leaves it used (no-op) — account preserved (#1)');
  assert.equal(store.profiles.get(out.invite.profileId)?.active, true, 'the activated account is not torn down');
});

test('AC-0.INV.006.1 — revoke fails closed without PERM-user.invite', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.issueInvite({ email: 'u@client.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  await assert.rejects(() => store.revokeInvite(out.invite.token, false, T0 + 10), (e: Error) => e.message === ERR_INVITE_DENIED);
});

test('AC-0.INV.006.2 — re-issuing an expired invite delivers a fresh ≤24h link', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.issueInvite({ email: 'u@client.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  // let it expire
  const past = T0 + LINK_TTL_HARD_CAP_SECONDS + 1;
  await assert.rejects(() => store.validateToken(out.invite.token, past), (e: Error) => e.message === ERR_TOKEN_INVALID);
  const re = await store.reissueInvite(out.invite.token, true, smtp, past);
  assert.ok(re.sent, 'fresh link delivered');
  assert.notEqual(re.invite.token, out.invite.token, 'a NEW token');
  assert.ok(re.invite.expiresAt - re.invite.issuedAt <= LINK_TTL_HARD_CAP_SECONDS, 'fresh link ≤24h');
  assert.equal((await store.getInvite(out.invite.token))?.state, 'expired', 'old token retired');
});

test('AC-0.INV.006 — one-click resend of a still-pending invite is audit-logged', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.issueInvite({ email: 'u@client.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  const r = await store.resendInvite(out.invite.token, true, smtp, T0 + 30);
  assert.ok(r.sent);
  assert.ok(store.auditLog().some((a) => a.audit_type === 'invite_resent'), 'resend audit-logged');
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-0.INV.007.1 — a provider bounce marks the invite undelivered and re-alerts the issuer.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-0.INV.007.1 — a bounce marks the invite undelivered and re-alerts (never a false "sent")', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.issueInvite({ email: 'u@client.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp);
  assert.equal(out.invite.delivery, 'sent_unconfirmed', 'post-send state is honest: unconfirmed, not delivered');
  const bounced = await store.markBounced(out.invite.token, T0 + 300);
  assert.equal(bounced.delivery, 'bounced', 'marked undelivered on bounce');
  assert.ok(store.eventLog().some((e) => e.event_type === 'invite_bounced'), 'bounce surfaced in event_log (re-alert)');
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-0.SEED.001.1 — SUPER_ADMIN_EMAIL set + no existing Super Admin → exactly one Super Admin created.
// + edge: env unset aborts loudly.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-0.SEED.001.1 — seed creates exactly one Super Admin from SUPER_ADMIN_EMAIL', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.runSeed('boss@corp.com', auth, smtp, T0);
  assert.equal(out.created, true);
  assert.equal(out.reason, 'created');
  const admins = [...store.userRoles.values()].filter((r) => r === 'Super Admin').length;
  assert.equal(admins, 1, 'exactly one Super Admin');
  assert.equal(store.profiles.get(out.superAdminProfileId)?.email, 'boss@corp.com');
});

test('AC-0.SEED.001.1 edge — env unset aborts loudly (never a blank/guessable admin) (#2/#3)', async () => {
  const { store, auth, smtp } = fresh();
  await assert.rejects(() => store.runSeed(undefined, auth, smtp, T0), (e: Error) => e.message === ERR_SEED_ENV_UNSET);
  await assert.rejects(() => store.runSeed('   ', auth, smtp, T0), (e: Error) => e.message === ERR_SEED_ENV_UNSET);
  assert.equal(store.userRoles.size, 0, 'no admin created on an unset env');
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-0.SEED.002.1 — seed setup email carries a one-time ≤24h link via custom SMTP.
// AC-0.SEED.002.2 — recovery is a deliberate env-change re-run only (no UI trigger).
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-0.SEED.002.1 — seed sends a one-time ≤24h setup link via custom SMTP', async () => {
  const { store, auth, smtp } = fresh();
  const out = await store.runSeed('boss@corp.com', auth, smtp, T0);
  assert.equal(out.setupLinkSent, true, 'setup link delivered via SMTP');
  const inv = [...store.invites.values()].find((i) => i.origin === 'seed');
  assert.ok(inv, 'a seed setup invite exists');
  assert.ok(inv!.expiresAt - inv!.issuedAt <= LINK_TTL_HARD_CAP_SECONDS, 'seed link ≤24h (AF-074)');
  assert.equal(inv!.accountType, 'external_admin', 'seed admin is external_admin (password+TOTP)');
});

test('AC-0.SEED.002.1 — seed setup-link SMTP failure is surfaced, not silent (#3)', async () => {
  const { store, auth } = fresh();
  const smtp = new InMemorySmtpSender({ notConfigured: true });
  const out = await store.runSeed('boss@corp.com', auth, smtp, T0);
  assert.equal(out.created, true, 'the admin is still created (creation committed before the send)');
  assert.equal(out.setupLinkSent, false, 'the send failure is surfaced');
  assert.ok(out.setupLinkFailureReason, 'explicit failure reason for the operator');
});

test('AC-0.SEED.002.2 — recovery is env-change re-run only; there is no UI trigger', async () => {
  const { store } = fresh();
  await assert.rejects(() => store.triggerSeedFromUi(), /no UI trigger/);
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-0.SEED.003.1 — re-boot with an existing Super Admin creates no second admin.
// AC-0.SEED.003.2 — no UI surface can trigger the seed.
// AC-0.SEED.003.3 — two concurrent first-boot seed runs create exactly one Super Admin (atomic guard).
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-0.SEED.003.1 — re-boot with an existing Super Admin is a no-op', async () => {
  const { store, auth, smtp } = fresh();
  const first = await store.runSeed('boss@corp.com', auth, smtp, T0);
  const second = await store.runSeed('boss@corp.com', auth, smtp, T0 + 100); // re-boot
  assert.equal(second.created, false);
  assert.equal(second.reason, 'already_present');
  assert.equal(second.superAdminProfileId, first.superAdminProfileId, 'same admin, not a new one');
  assert.equal([...store.userRoles.values()].filter((r) => r === 'Super Admin').length, 1);
  assert.ok(store.auditLog().some((a) => a.audit_type === 'seed_skipped'), 'seed_skipped audited');
});

test('AC-0.SEED.003.2 — no UI surface can trigger the seed', async () => {
  const { store } = fresh();
  await assert.rejects(() => store.triggerSeedFromUi(), /AC-0\.SEED\.003\.2/);
});

test('AC-0.SEED.003.3 — two concurrent first-boot seed runs mint exactly one Super Admin (ADR-004 guard)', async () => {
  const { store, auth, smtp } = fresh();
  const results = await Promise.all([
    store.runSeed('boss@corp.com', auth, smtp, T0),
    store.runSeed('boss@corp.com', auth, smtp, T0),
    store.runSeed('boss@corp.com', auth, smtp, T0),
  ]);
  const created = results.filter((r) => r.created).length;
  const admins = [...store.userRoles.values()].filter((r) => r === 'Super Admin').length;
  assert.equal(created, 1, 'exactly one run wins the atomic guard');
  assert.equal(admins, 1, 'exactly one Super Admin exists — the others are clean no-ops (not a second admin)');
  assert.ok(results.some((r) => r.reason === 'lost_race' || r.reason === 'already_present'), 'losers no-op cleanly');
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// Cross-cutting: an invalid/expired/used/revoked token always rejects (routes to support intake, never a
// blank/half-activated account) — the FR-0.REC.002 seam.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('cross-cut — an unknown token is invalid (routes to re-request, no account)', async () => {
  const { store } = fresh();
  await assert.rejects(() => store.validateToken('nope', T0), (e: Error) => e.message === ERR_TOKEN_INVALID);
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// ENUM DRIFT GUARD (#3) — the fake mirrors the live `event_type` Postgres ENUM. A value NOT in the admitted
// set must be REJECTED offline, exactly as the live silo raises `invalid input value for enum event_type`.
// Without this the four invite/seed event literals (absent from 0001_baseline.sql L60-65 + 0007, owed to
// migration 0011) could pass green offline while every live invite/seed run throws. These tests FAIL if the
// fake ever admits an unadmitted value or if any of the four literals the real flows write drops out of the
// admitted set — so the drift can never again hide behind an in-memory-only test suite.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('enum-drift — the fake REJECTS an unadmitted event_type (mirrors the live Postgres enum)', () => {
  const { store } = fresh();
  assert.throws(
    () => store._writeEventForTest('not_a_real_event_type', 'should never land', T0),
    (e: Error) => e.message === ERR_UNADMITTED_EVENT_TYPE,
    'an event_type outside the admitted set must throw offline, as the live enum would',
  );
  assert.equal(store.eventLog().length, 0, 'the unadmitted event was NOT recorded');
});

test('enum-drift — a baseline-enum value the invite/seed slice does NOT own is also rejected', () => {
  const { store } = fresh();
  // `task_started` IS in the live event_type enum but is NOT an invite/seed value — this slice must not write
  // it. The admitted set is scoped to THIS slice's four values, not the whole enum.
  assert.throws(() => store._writeEventForTest('task_started', 'wrong slice', T0), (e: Error) => e.message === ERR_UNADMITTED_EVENT_TYPE);
});

test('enum-drift — every event the real flows emit is in the admitted set (no drift)', async () => {
  const { store, auth, smtp } = fresh();
  // Exercise the flows that write each of the four values: email_send_ok, email_send_failed, invite_bounced,
  // account_activated — then assert nothing landed outside the admitted set.
  const ok = await store.issueInvite({ email: 'ok@x.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, smtp); // email_send_ok
  await store.markBounced(ok.invite.token, T0 + 10); // invite_bounced
  await store.completeSetup({ token: ok.invite.token, method: 'oauth', now: T0 + 20 }); // account_activated
  const failSmtp = new InMemorySmtpSender({ notConfigured: true });
  await store.issueInvite({ email: 'fail@x.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 }, auth, failSmtp); // email_send_failed
  const emitted = new Set(store.eventLog().map((e) => e.event_type));
  for (const t of emitted) {
    assert.ok(isInviteSeedEventType(t), `emitted event_type '${t}' is in the admitted set (no fake-vs-live drift)`);
  }
  assert.ok(emitted.has('email_send_ok') && emitted.has('email_send_failed') && emitted.has('invite_bounced') && emitted.has('account_activated'), 'all four invite/seed events were exercised');
});

test('enum-drift — the admitted set is exactly the four invite/seed values owed to migration 0011', () => {
  assert.deepEqual(
    [...INVITE_SEED_EVENT_TYPES].sort(),
    ['account_activated', 'email_send_failed', 'email_send_ok', 'invite_bounced'],
    'the admitted set MUST stay in lockstep with the migration-0011 additive delta (proposed-shared-spec.md)',
  );
});
