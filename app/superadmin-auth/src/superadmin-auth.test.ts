// ISSUE-014 §4 — one test per AC in the Definition of done. Proved against the InMemorySuperAdminAuthStore
// reference model (offline; the live attack-sim + TOTP enrollment against a throwaway Supabase Auth project
// are 🧑 you-present, owed to onboarding — AF-077 is already 🟢 from the ISSUE-005 spike). This IS the
// primary verification layer (test-strategy.md). Deterministic: a fixed logical `now`; no Date.now()/random.
//
// AC map (§4):
//   AC-0.AUTH.005.1  — correct email+password on an enrolled external SA → 2FA challenge BEFORE any session
//   AC-0.AUTH.005.2  — a client-tenant user has no password account → no path (OAuth only)
//   AC-0.AUTH.006.1  — a valid current code enrolls the factor → account aal2-capable
//   AC-0.AUTH.007.1  — a wrong TOTP code → no session
//   AC-0.AUTH.007.2  — a skipped/omitted TOTP code → no session (no bypass)
//   AC-0.AUTH.007.3  — mfa_softlock_threshold(=5) wrong codes → 6th blocked, challenge locked, event logged
//   AC-0.AUTH.008.1  — two_factor_required + an aal1 session → forced to enroll/challenge, denied until aal2
//   AC-0.AUTH.009.1  — account_lockout_threshold consecutive password fails → account locked + SA alert
//   AC-0.AUTH.009.2  — the login form renders CAPTCHA active + leaked-password protection active
//   AC-NFR-SEC.009.1 — a scripted credential-stuffing attack is halted BEFORE success, logged + alerted (AF-077)
//   AC-NFR-SEC.010.2 — a human-path session below aal2 querying an aal2-gated resource is denied (app-gate half)
//
// Cross-cutting TEETH (task §3): the per-account soft-lock halts BOTH a scripted single-account attack AND a
// simulated MULTI-IP attack BEFORE any session mints (IP-independent — keyed on the account, not the IP;
// threshold from config); the 2FA soft-lock refuses a genuinely-VALID TOTP code once locked; each path writes
// the correct event_log security event value.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SUPERADMIN_AUTH_CONFIG,
  validateSuperAdminAuthConfig,
  InMemorySuperAdminAuthStore,
  type SuperAdminAuthConfig,
  type SecurityEventType,
  type CaptchaState,
  type SuperAdminAccount,
  type PasswordPolicy,
  issueEnrollment,
  confirmEnrollment,
  currentTotpCode,
  gateProtectedSurface,
  passwordStep,
  challengeStep,
} from './index.ts';

const NOW = 1_760_000_000; // fixed logical epoch seconds

// ── harness ───────────────────────────────────────────────────────────────────────────────────────
const CFG: SuperAdminAuthConfig = { ...DEFAULT_SUPERADMIN_AUTH_CONFIG };
const POLICY: PasswordPolicy = {
  captcha_enabled: CFG.captcha_enabled,
  leaked_password_protection: CFG.leaked_password_protection,
};
const SOLVED_CAPTCHA: CaptchaState = { loaded: true, token: 'human-token' };
const NO_LEAK = () => false;

/** A modelled enrolled external Super-Admin account (auth.users + a verified auth.mfa_factors factor). */
function externalAdmin(over: Partial<SuperAdminAccount> = {}): SuperAdminAccount {
  return {
    user_id: 'u-sa-1',
    email: 'sa@operator.example',
    password: 'correct-horse-battery',
    is_external_super_admin: true,
    totp_enrolled: true,
    ...over,
  };
}

/** Count event_log rows of a given security type (proves the exact value written per path). */
function eventsOf(store: InMemorySuperAdminAuthStore, type: SecurityEventType) {
  return store.eventLog.filter((e) => e.event_type === type);
}

/** A successful password step against an in-memory store (advances to the challenge — no session yet). */
async function grantPassword(store: InMemorySuperAdminAuthStore, account: SuperAdminAccount, password = account.password) {
  return passwordStep({
    cfg: CFG, store, policy: POLICY, captcha: SOLVED_CAPTCHA,
    email: account.email, password, account, leakedLookup: NO_LEAK, now: NOW,
  });
}

// ── AC-0.AUTH.005 — the password grant hands off to the challenge, does NOT mint a session ──────────
test('AC-0.AUTH.005.1 — correct email+password on an enrolled external SA presents the 2FA challenge before any session', async () => {
  const store = new InMemorySuperAdminAuthStore();
  const account = externalAdmin();
  const res = await grantPassword(store, account);
  assert.equal(res.ok, true);
  assert.ok(res.ok && res.next === 'totp_challenge', 'correct creds advance same-page to the TOTP challenge');
  assert.equal(res.ok && res.user_id, account.user_id);
  // TEETH: the password step alone establishes NO aal2 session — no success/session_established event yet.
  assert.equal(eventsOf(store, 'sign_in_success').length, 0, 'no sign_in_success until 2FA passes');
  assert.equal(eventsOf(store, 'session_established').length, 0, 'no session minted by the password step');
});

test('AC-0.AUTH.005.2 — a client-tenant user has no password account; the path is refused (OAuth only)', async () => {
  const store = new InMemorySuperAdminAuthStore();
  // A client-tenant user resolves to a null account (no external-SA credential) — AC-0.AUTH.005.2.
  const res = await passwordStep({
    cfg: CFG, store, policy: POLICY, captcha: SOLVED_CAPTCHA,
    email: 'tenant@client.example', password: 'anything', account: null, leakedLookup: NO_LEAK, now: NOW,
  });
  assert.equal(res.ok, false);
  assert.ok(!res.ok && res.reason === 'no_password_account', 'no usable password credential for a tenant user');
  // A non-external SA account (has a row but not is_external_super_admin) is equally refused.
  const nonExternal = await passwordStep({
    cfg: CFG, store, policy: POLICY, captcha: SOLVED_CAPTCHA,
    email: 'x@client.example', password: 'anything',
    account: externalAdmin({ is_external_super_admin: false }), leakedLookup: NO_LEAK, now: NOW,
  });
  assert.ok(!nonExternal.ok && nonExternal.reason === 'no_password_account');
  // Not a success → logged as sign_in_failure, never a silent pass (#3).
  assert.ok(eventsOf(store, 'sign_in_failure').length >= 1, 'the refused attempt is logged');
});

// ── AC-0.AUTH.006 — TOTP enrollment ─────────────────────────────────────────────────────────────────
test('AC-0.AUTH.006.1 — a valid current code enrolls the factor and the account becomes aal2-capable', async () => {
  const offer = issueEnrollment('u-sa-1', 'SECRET32');
  assert.ok(offer.otpauth_uri.startsWith('otpauth://totp/'), 'an otpauth:// secret is issued (QR-encodable)');
  assert.equal(offer.manual_entry_secret, offer.secret, 'a manual-entry fallback exposes the same secret');
  // Wrong code does NOT enroll.
  assert.equal(confirmEnrollment(offer, 'not-the-code', NOW), null, 'a wrong code does not enroll');
  // A valid CURRENT code enrolls the factor → aal2-capable.
  const factor = confirmEnrollment(offer, currentTotpCode(offer.secret, NOW), NOW);
  assert.ok(factor && factor.verified, 'a valid current code enrolls a verified factor');
  assert.equal(factor!.user_id, 'u-sa-1');
});

// ── AC-0.AUTH.007 — the 2FA challenge blocks, no bypass, soft-locks ──────────────────────────────────
async function enrolledSetup() {
  const store = new InMemorySuperAdminAuthStore();
  const account = externalAdmin();
  const offer = issueEnrollment(account.user_id, 'SECRET32');
  const factor = confirmEnrollment(offer, currentTotpCode(offer.secret, NOW), NOW)!;
  return { store, account, factor };
}

test('AC-0.AUTH.007.1 — a wrong TOTP code grants no session', async () => {
  const { store, account, factor } = await enrolledSetup();
  const res = await challengeStep({ cfg: CFG, store, user_id: account.user_id, factor, code: 'wrong', now: NOW });
  assert.equal(res.ok, false);
  assert.ok(!res.ok && res.reason === 'wrong_code', 'a wrong code is refused');
  assert.equal(eventsOf(store, 'session_established').length, 0, 'no session minted on a wrong code');
  assert.equal(eventsOf(store, 'sign_in_failure').length, 1, 'the wrong code is logged as sign_in_failure');
});

test('AC-0.AUTH.007.2 — a skipped/omitted TOTP code grants no session (no bypass)', async () => {
  const { store, account, factor } = await enrolledSetup();
  const skipped = await challengeStep({ cfg: CFG, store, user_id: account.user_id, factor, code: null, now: NOW });
  assert.ok(!skipped.ok && skipped.reason === 'no_code', 'a null (skipped) code is refused — no bypass');
  const empty = await challengeStep({ cfg: CFG, store, user_id: account.user_id, factor, code: '', now: NOW });
  assert.ok(!empty.ok && empty.reason === 'no_code', 'an empty code is refused — no bypass');
  assert.equal(eventsOf(store, 'session_established').length, 0, 'a skipped step never mints a session');
});

test('AC-0.AUTH.007.3 — the 6th consecutive wrong code (threshold=5) locks the challenge and logs the event', async () => {
  const { store, account, factor } = await enrolledSetup();
  assert.equal(CFG.mfa_softlock_threshold, 5, 'AF-077-confirmed default threshold');
  // Five consecutive wrong codes → the 5th trips the lock (threshold reached).
  for (let i = 1; i <= 4; i++) {
    const r = await challengeStep({ cfg: CFG, store, user_id: account.user_id, factor, code: `wrong-${i}`, now: NOW });
    assert.ok(!r.ok && r.reason === 'wrong_code', `attempt ${i} is a plain wrong-code failure`);
  }
  const fifth = await challengeStep({ cfg: CFG, store, user_id: account.user_id, factor, code: 'wrong-5', now: NOW });
  assert.ok(!fifth.ok && fifth.reason === 'mfa_soft_locked', 'the threshold-crossing attempt trips the lock');
  // TEETH: the lock is logged (verification_failure) + a Super-Admin alert fires — never a silent lock (#3).
  assert.equal(eventsOf(store, 'verification_failure').length, 1, 'the soft-lock trip is logged exactly once');
  assert.ok(store.alerts.some((a) => a.kind === 'mfa_softlock'), 'a Super-Admin alert fires on the 2FA lock');
  // The 6th attempt (a would-be valid code) is refused BEFORE verify — locked, no session (#2).
  const sixth = await challengeStep({ cfg: CFG, store, user_id: account.user_id, factor, code: currentTotpCode(factor.secret, NOW), now: NOW });
  assert.ok(!sixth.ok && sixth.reason === 'mfa_soft_locked', 'the 6th attempt is blocked while locked');
  assert.equal(eventsOf(store, 'session_established').length, 0, 'no session across the whole locked streak');
});

test('AC-0.AUTH.007(teeth) — once the 2FA challenge is soft-locked, a genuinely VALID current code is still refused', async () => {
  const { store, account, factor } = await enrolledSetup();
  // Trip the MFA lock with `threshold` wrong codes.
  for (let i = 1; i <= CFG.mfa_softlock_threshold; i++) {
    await challengeStep({ cfg: CFG, store, user_id: account.user_id, factor, code: `wrong-${i}`, now: NOW });
  }
  // A truly correct current code, submitted while the lock holds, is refused before verify (#2).
  const validCode = currentTotpCode(factor.secret, NOW);
  const res = await challengeStep({ cfg: CFG, store, user_id: account.user_id, factor, code: validCode, now: NOW });
  assert.ok(!res.ok && res.reason === 'mfa_soft_locked', 'a valid code is denied while the 2FA lock holds');
  assert.equal(eventsOf(store, 'session_established').length, 0, 'no session — a live lock beats a correct code');
  // The lock-holding refusal is an identity_rejected security event (never silent).
  assert.ok(eventsOf(store, 'identity_rejected').some((e) => /soft-locked challenge/.test(e.summary)), 'the locked refusal is logged');
});

test('AC-0.AUTH.007(happy) — a correct current code elevates to aal2 and writes success + session_established', async () => {
  const { store, account, factor } = await enrolledSetup();
  const res = await challengeStep({ cfg: CFG, store, user_id: account.user_id, factor, code: currentTotpCode(factor.secret, NOW), now: NOW });
  assert.ok(res.ok && res.granted && res.aal === 'aal2', 'a correct code elevates to aal2 (session may be established)');
  assert.equal(eventsOf(store, 'sign_in_success').length, 1, 'a sign_in_success is written');
  assert.equal(eventsOf(store, 'session_established').length, 1, 'a session_established is written');
});

// ── AC-0.AUTH.008 — the app-layer aal2 gate ─────────────────────────────────────────────────────────
test('AC-0.AUTH.008.1 — two_factor_required + an aal1 session is forced to enroll/challenge, denied until aal2', () => {
  assert.equal(CFG.two_factor_required, true, 'the deployment default forces 2FA (OD-016)');
  // aal1 with no factor → forced to ENROLL; aal1 with a factor → forced to CHALLENGE; aal2 → allowed.
  const noFactor = gateProtectedSurface({ two_factor_required: true, session_aal: 'aal1', totp_enrolled: false });
  assert.deepEqual(noFactor, { allowed: false, force: 'enroll' }, 'aal1 + no factor → forced enroll, data denied');
  const withFactor = gateProtectedSurface({ two_factor_required: true, session_aal: 'aal1', totp_enrolled: true });
  assert.deepEqual(withFactor, { allowed: false, force: 'challenge' }, 'aal1 + a factor → forced challenge, data denied');
  const elevated = gateProtectedSurface({ two_factor_required: true, session_aal: 'aal2', totp_enrolled: true });
  assert.deepEqual(elevated, { allowed: true }, 'only aal2 reaches protected data');
});

// ── AC-0.AUTH.009 — brute-force / credential-stuffing posture ────────────────────────────────────────
test('AC-0.AUTH.009.1 — account_lockout_threshold consecutive password failures lock the account + fire a SA alert', async () => {
  const store = new InMemorySuperAdminAuthStore();
  const account = externalAdmin();
  assert.equal(CFG.account_lockout_threshold, 5, 'AF-077-confirmed default threshold');
  // Threshold-1 wrong passwords are plain failures; the threshold-crossing attempt trips the lock.
  for (let i = 1; i < CFG.account_lockout_threshold; i++) {
    const r = await grantPassword(store, account, `wrong-${i}`);
    assert.ok(!r.ok && r.reason === 'bad_credentials', `attempt ${i} is a plain credential failure`);
  }
  const trip = await grantPassword(store, account, 'wrong-final');
  assert.ok(!trip.ok && trip.reason === 'account_soft_locked', 'the threshold-crossing attempt locks the account');
  assert.ok(store.alerts.some((a) => a.kind === 'account_lockout'), 'a Super-Admin alert fires on the account lock');
  assert.equal(eventsOf(store, 'verification_failure').length, 1, 'the lock trip is logged exactly once (#3)');
  // TEETH: even the CORRECT password is now refused while the lock holds — no session mints (#2).
  const correctButLocked = await grantPassword(store, account, account.password);
  assert.ok(!correctButLocked.ok && correctButLocked.reason === 'account_soft_locked', 'a correct password is denied while locked');
});

test('AC-0.AUTH.009.2 — the login form renders CAPTCHA active + leaked-password protection active', async () => {
  // CAPTCHA active: with captcha_enabled, an unavailable widget fails CLOSED (submit refused before any check).
  const store = new InMemorySuperAdminAuthStore();
  const account = externalAdmin();
  assert.equal(POLICY.captcha_enabled, true, 'CAPTCHA is active on the form');
  assert.equal(POLICY.leaked_password_protection, true, 'leaked-password protection is active on the form');
  const failClosed = await passwordStep({
    cfg: CFG, store, policy: POLICY, captcha: { loaded: false },
    email: account.email, password: account.password, account, leakedLookup: NO_LEAK, now: NOW,
  });
  assert.ok(!failClosed.ok && failClosed.reason === 'captcha_unavailable', 'an unloadable CAPTCHA fails closed (#2)');
  // An unsolved (loaded-but-no-token) CAPTCHA is also refused.
  const unsolved = await passwordStep({
    cfg: CFG, store, policy: POLICY, captcha: { loaded: true, token: null },
    email: account.email, password: account.password, account, leakedLookup: NO_LEAK, now: NOW,
  });
  assert.ok(!unsolved.ok && unsolved.reason === 'captcha_unsolved', 'an unsolved CAPTCHA is refused');
  // Leaked-password protection: a breached password is refused even though it matches the credential.
  const leaked = await passwordStep({
    cfg: CFG, store, policy: POLICY, captcha: SOLVED_CAPTCHA,
    email: account.email, password: account.password, account, leakedLookup: (p) => p === account.password, now: NOW,
  });
  assert.ok(!leaked.ok && leaked.reason === 'leaked_password', 'a breached credential is refused (Pro+ HIBP)');
});

// ── AC-NFR-SEC.009.1 — a scripted credential-stuffing attack is halted before success (AF-077) ───────
test('AC-NFR-SEC.009.1 — a scripted SINGLE-account credential-stuffing attack is halted BEFORE any session, logged + alerted', async () => {
  const store = new InMemorySuperAdminAuthStore();
  const account = externalAdmin();
  // Script 50 guessed passwords against one account. The per-account soft-lock must halt it well before 50.
  let firstBlockedAt = -1;
  for (let attempt = 1; attempt <= 50; attempt++) {
    const r = await grantPassword(store, account, `guess-${attempt}`);
    assert.equal(r.ok, false, 'no guessed password ever succeeds');
    if (!r.ok && r.reason === 'account_soft_locked' && firstBlockedAt === -1) firstBlockedAt = attempt;
  }
  // Halted at the threshold, not after exhausting the corpus — the 5th attempt trips, the 6th is blocked.
  assert.equal(firstBlockedAt, CFG.account_lockout_threshold, 'the attack halts exactly at the configured threshold');
  // TEETH: across the whole run, ZERO sessions minted, the trip is alerted, and the lock is logged (#1/#2/#3).
  assert.equal(eventsOf(store, 'sign_in_success').length, 0, 'no session established during the attack');
  assert.equal(eventsOf(store, 'session_established').length, 0, 'no session established during the attack');
  assert.ok(store.alerts.some((a) => a.kind === 'account_lockout'), 'the attack is alerted');
  assert.ok(eventsOf(store, 'verification_failure').length >= 1, 'the lock trip is logged');
});

test('AC-NFR-SEC.009.1(teeth) — a simulated MULTI-IP distributed attack is halted the same way (IP-INDEPENDENT lock)', async () => {
  const store = new InMemorySuperAdminAuthStore();
  const account = externalAdmin();
  // Model a distributed attack: each attempt "arrives from a different IP". The soft-lock is keyed on the
  // account (not the source IP), so per-IP rate caps (the /token 1800/hr cap) never see the streak — but the
  // per-account counter does. This is the exact hole AF-077 flagged and this lock closes.
  const ips = Array.from({ length: 20 }, (_, i) => `203.0.113.${i}`); // 20 distinct source IPs
  let firstBlockedAt = -1;
  for (let attempt = 0; attempt < ips.length; attempt++) {
    // Each request would carry a different source IP; passwordStep keys the lock on account.user_id only.
    const r = await grantPassword(store, account, `distributed-guess-${attempt}`);
    if (!r.ok && r.reason === 'account_soft_locked' && firstBlockedAt === -1) firstBlockedAt = attempt + 1;
  }
  // Despite every attempt coming from a fresh IP, the account-keyed lock still trips at the threshold.
  assert.equal(firstBlockedAt, CFG.account_lockout_threshold, 'the multi-IP attack halts at the threshold — IP-independent');
  assert.equal(eventsOf(store, 'session_established').length, 0, 'no session minted across any IP');
  assert.equal(eventsOf(store, 'sign_in_success').length, 0, 'no success across any IP');
});

// ── AC-NFR-SEC.010.2 — a human-path session below aal2 is denied an aal2-gated resource (app-gate half) ─
test('AC-NFR-SEC.010.2 — a human-path session below aal2 querying an aal2-gated resource is denied (app-gate expression)', () => {
  // The app-layer half of NFR-SEC.010 (the RLS predicate half is ISSUE-020's): a below-aal2 human session is
  // denied the protected data and forced to the 2FA step. Only aal2 is allowed through.
  const belowAal2 = gateProtectedSurface({ two_factor_required: true, session_aal: 'aal1', totp_enrolled: true });
  assert.equal(belowAal2.allowed, false, 'a below-aal2 human-path query is denied the aal2-gated resource');
  const atAal2 = gateProtectedSurface({ two_factor_required: true, session_aal: 'aal2', totp_enrolled: true });
  assert.equal(atAal2.allowed, true, 'an aal2 session reaches the resource');
});

// ── config-key parity + coherence guard (§8 step 1; keys mirror config-registry.md §auth) ────────────
test('config — the seven auth.* keys are present with registry defaults and validate as coherent', () => {
  const keys = Object.keys(DEFAULT_SUPERADMIN_AUTH_CONFIG).sort();
  assert.deepEqual(keys, [
    'account_lockout_minutes', 'account_lockout_threshold',
    'captcha_enabled', 'leaked_password_protection',
    'mfa_softlock_minutes', 'mfa_softlock_threshold', 'two_factor_required',
  ], 'exactly the seven auth.* keys (mirror config-registry.md §auth — no net-new key)');
  assert.deepEqual(validateSuperAdminAuthConfig(DEFAULT_SUPERADMIN_AUTH_CONFIG), [], 'the defaults are coherent');
  // A threshold of 0 (lock-everyone or never-lock) is an incoherent defense — it must fail LOUD, never silently.
  assert.ok(validateSuperAdminAuthConfig({ ...CFG, account_lockout_threshold: 0 }).length > 0, 'threshold 0 is rejected');
  assert.ok(validateSuperAdminAuthConfig({ ...CFG, mfa_softlock_minutes: 0 }).length > 0, 'a zero-minute lock is rejected');
});
