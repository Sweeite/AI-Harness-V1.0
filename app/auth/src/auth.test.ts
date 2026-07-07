// ISSUE-013 §9 — one test per §4 AC, proven against the in-memory reference model (InMemoryAuthStore +
// SessionManager + the FakeOAuthProvider double). Offline: the real OAuth-provider handshake and AF-073
// (HttpOnly) are live-checkpoint proofs; everything downstream of "the IdP returned an identity" is proven
// here. Deterministic: a fixed logical `now` (epoch seconds); no Date.now()/random.
//
// AC map:
//   AC-0.AUTH.001.1 — OAuth control is the primary/leading control when oauth_enabled & provider=google
//   AC-0.AUTH.001.2 — a valid Google sign-in establishes a session + mirrors the profile (→ role-default seam)
//   AC-0.AUTH.002.1 — oauth_enabled & no valid OAuth token → NO session granted
//   AC-0.AUTH.002.2 — the external-admin email+password path is a permitted non-OAuth path (present, gated)
//   AC-0.AUTH.003.1 — a provider change takes effect on the NEXT login with no deploy (and is toggle-gated)
//   AC-0.AUTH.004.1 — an Azure identity from a non-configured tenant is rejected
//   AC-0.AUTH.004.2 — an OAuth identity with an unverified email is rejected
//   AC-0.SESS.001.1 — a successful login issues an access JWT AND a refresh token
//   AC-0.SESS.002.1 — an access token older than access_token_ttl is rejected; a refresh is required
//   AC-0.SESS.003.1 — refresh rotation invalidates the prior token; reuse outside 10s revokes the session
//   AC-0.SESS.004.1 — an idle session past inactivity_timeout is refused at its next refresh
//   AC-0.SESS.005.1 — the session is in a cookie (never localStorage); HttpOnly OR the AF-073 fallback holds
//   AC-0.SESS.006.1 — a background task continues as service_role on benign expiry; user re-auth-prompted
//   AC-0.SESS.007.1 — expiry → re-auth prompt with page-state preserved and restored without data loss
//   AC-0.SESS.008.1 — getUser() denies a token whose session was logged out server-side (getClaims can't see it)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_AUTH_CONFIG, supabaseProviderSlug, validateAuthConfig, type AuthConfig } from './config.ts';
import {
  FakeOAuthProvider,
  evaluateIdentity,
  type HardeningPolicy,
  type IdpIdentity,
} from './oauth.ts';
import {
  SessionManager,
  REUSE_INTERVAL_SECONDS,
  verifyCookiePosture,
  buildReauthPrompt,
  type CookiePosture,
} from './session.ts';
import { InMemoryAuthStore, ERR_PROVIDER_TOGGLE_DENIED } from './store.ts';
import { oauthLogin, resolveLeadControl, clientTenantPaths } from './login.ts';

const NOW = 1_760_000_000; // fixed logical epoch seconds

function googleIdentity(over: Partial<IdpIdentity> = {}): IdpIdentity {
  return {
    provider: 'google',
    subject: 'user-goog-1',
    email: 'alice@client.example',
    email_verified: true,
    scopes: ['email', 'profile'],
    ...over,
  };
}

function azureIdentity(over: Partial<IdpIdentity> = {}): IdpIdentity {
  return {
    provider: 'azure',
    subject: 'user-az-1',
    email: 'bob@client.example',
    email_verified: true,
    tenant_id: 'tenant-CONFIGURED',
    xms_edov: true,
    scopes: ['email'],
    ...over,
  };
}

const GOOGLE_POLICY: HardeningPolicy = { oauth_enabled: true, provider: 'google' };
const AZURE_POLICY: HardeningPolicy = { oauth_enabled: true, provider: 'microsoft', azure_tenant_id: 'tenant-CONFIGURED' };

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.AUTH.001.1 — OAuth is the primary/leading login control
// ─────────────────────────────────────────────────────────────────────────────
// Modelled as: given oauth_enabled=true & provider=google, the resolved login surface leads with the
// OAuth control and routes to the google slug. TEETH: also assert it does NOT lead when oauth is disabled.
test('AC-0.AUTH.001.1 — OAuth leads the login surface; routed to the correct slug', async () => {
  const store = new InMemoryAuthStore({ oauth_enabled: true, oauth_provider: 'google' });
  const cfg = await store.getProviderConfig();
  // Assert the SHIPPED resolver (src/login.ts), not a re-implementation in the test (no tautology).
  assert.equal(resolveLeadControl(cfg), 'oauth');
  assert.equal(supabaseProviderSlug(cfg.oauth_provider), 'google');
  assert.equal(supabaseProviderSlug('microsoft'), 'azure'); // the microsoft→azure branch is real

  const disabled = new InMemoryAuthStore({ oauth_enabled: false, oauth_provider: 'google' });
  const dcfg = await disabled.getProviderConfig();
  assert.equal(resolveLeadControl(dcfg), 'password'); // not oauth-led when off
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.AUTH.001.2 — a valid Google sign-in establishes a session and lands the user
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0.AUTH.001.2 — valid Google sign-in establishes a session and mirrors the profile', async () => {
  const store = new InMemoryAuthStore();
  const sessions = new SessionManager(DEFAULT_AUTH_CONFIG);
  const idp = new FakeOAuthProvider();
  idp.seedIdentity(googleIdentity());
  const res = await oauthLogin({ provider: 'google', policy: GOOGLE_POLICY, idp, sessions, store, aal: 'aal2', now: NOW });

  assert.ok(res.ok, 'login should succeed');
  assert.equal(idp.routedSlug(), 'google'); // provider→slug branch exercised
  // a session record exists and the profile mirror was written (the auth.uid() → role-default seam)
  const rec = sessions.get(res.session_id);
  assert.ok(rec && rec.state === 'active');
  const prof = await store.readProfile(res.user_id, res.user_id);
  assert.ok(prof && prof.email === 'alice@client.example');
  // TEETH: sign_in_success + session_established were both logged (audit-trail completeness #3)
  const types = store.eventLog.map((e) => e.event_type);
  assert.ok(types.includes('sign_in_success') && types.includes('session_established'));
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.AUTH.002.1 — oauth_enabled & no valid token → no session
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0.AUTH.002.1 — a missing/invalid OAuth token grants no session', async () => {
  const store = new InMemoryAuthStore();
  const sessions = new SessionManager(DEFAULT_AUTH_CONFIG);
  const idp = new FakeOAuthProvider();
  idp.seedIdentity(null); // IdP returned no/invalid token
  const res = await oauthLogin({ provider: 'google', policy: GOOGLE_POLICY, idp, sessions, store, aal: 'aal2', now: NOW });

  assert.equal(res.ok, false);
  // TEETH: no session was minted and no profile was created — a rejected login leaks nothing.
  assert.equal(store.profiles.size, 0);
  assert.ok(store.eventLog.some((e) => e.event_type === 'sign_in_failure'));
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.AUTH.002.2 — the external-admin non-OAuth path is a distinct, permitted, gated path
// ─────────────────────────────────────────────────────────────────────────────
// This slice owns OAuth only (password path is ISSUE-014). The seam assertion: when oauth_enabled, a
// client-tenant user has ONLY the OAuth path; the password path is reserved to external admins. We prove
// the config-level distinction rather than the password mechanism (out of scope).
test('AC-0.AUTH.002.2 — password path is reserved to external admins, never client-tenant OAuth users', async () => {
  const store = new InMemoryAuthStore({ oauth_enabled: true });
  const cfg = await store.getProviderConfig();
  // client-tenant user: no password path is offered — the only path is OAuth. Assert the SHIPPED helper.
  const paths = clientTenantPaths(cfg);
  assert.deepEqual([...paths], ['oauth']);
  assert.ok(!paths.includes('password')); // TEETH: password is NOT a client-tenant path
  // TEETH: when OAuth is off, NO client-tenant path exists (never a silent password fallback #2).
  assert.deepEqual([...clientTenantPaths({ oauth_enabled: false })], []);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.AUTH.003.1 — a provider change takes effect on the NEXT login, no deploy; and is toggle-gated
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0.AUTH.003.1 — provider change affects the next login (no deploy) and is PERM-gated', async () => {
  const store = new InMemoryAuthStore({ oauth_enabled: true, oauth_provider: 'google' });

  // TEETH: an unauthorized edit is DENIED (default-deny PERM-auth.provider_toggle).
  await assert.rejects(
    () => store.setProviderConfig({ canToggleProvider: false }, { oauth_provider: 'microsoft' }, NOW),
    (e: Error) => e.message === ERR_PROVIDER_TOGGLE_DENIED,
  );
  // still google after the denied edit — the deny actually held
  assert.equal((await store.getProviderConfig()).oauth_provider, 'google');

  // an authorized edit persists; the NEXT login reads the new provider with no deploy step in between.
  await store.setProviderConfig({ canToggleProvider: true }, { oauth_provider: 'microsoft' }, NOW);
  const sessions = new SessionManager(DEFAULT_AUTH_CONFIG);
  const idp = new FakeOAuthProvider();
  idp.seedIdentity(azureIdentity());
  const cfg = await store.getProviderConfig();
  const res = await oauthLogin({
    provider: cfg.oauth_provider, // the login reads config at login time
    policy: { oauth_enabled: true, provider: cfg.oauth_provider, azure_tenant_id: 'tenant-CONFIGURED' },
    idp, sessions, store, aal: 'aal2', now: NOW,
  });
  assert.ok(res.ok);
  assert.equal(idp.routedSlug(), 'azure'); // the new provider was used
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.AUTH.004.1 — Azure identity from a non-configured tenant is rejected
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0.AUTH.004.1 — an Azure identity from the wrong tenant is rejected', async () => {
  const wrong = evaluateIdentity(AZURE_POLICY, azureIdentity({ tenant_id: 'tenant-ATTACKER' }));
  assert.equal(wrong.ok, false);
  assert.equal(wrong.ok === false && wrong.reason, 'wrong_tenant');
  // TEETH #1: an unpinned policy (no configured tenant) also rejects — fail-closed, no wildcard admit.
  const unpinned = evaluateIdentity({ oauth_enabled: true, provider: 'microsoft' }, azureIdentity());
  assert.equal(unpinned.ok, false);
  // TEETH #2: the CORRECT tenant is accepted — the rule is a match, not a blanket deny.
  const right = evaluateIdentity(AZURE_POLICY, azureIdentity());
  assert.ok(right.ok);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.AUTH.004.2 — unverified-email identity is rejected (both providers)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0.AUTH.004.2 — an unverified-email identity is rejected', async () => {
  const goog = evaluateIdentity(GOOGLE_POLICY, googleIdentity({ email_verified: false }));
  assert.equal(goog.ok, false);
  assert.equal(goog.ok === false && goog.reason, 'email_unverified');
  // Azure expresses "verified" via xms_edov — an unverified domain is rejected too.
  const az = evaluateIdentity(AZURE_POLICY, azureIdentity({ xms_edov: false }));
  assert.equal(az.ok, false);
  assert.equal(az.ok === false && az.reason, 'edov_unverified');
  // TEETH: a missing email scope (so email can't even be asserted) is also rejected.
  const noScope = evaluateIdentity(GOOGLE_POLICY, googleIdentity({ scopes: ['profile'] }));
  assert.equal(noScope.ok, false);
  assert.equal(noScope.ok === false && noScope.reason, 'missing_email_scope');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.SESS.001.1 — login issues an access JWT AND a refresh token
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0.SESS.001.1 — a session is an access JWT plus a rotating refresh token', () => {
  const sessions = new SessionManager(DEFAULT_AUTH_CONFIG);
  const { access, refresh } = sessions.establish('user-1', 'aal2', NOW);
  assert.equal(access.sub, 'user-1');
  assert.equal(access.expires_at, NOW + DEFAULT_AUTH_CONFIG.access_token_ttl);
  assert.equal(refresh.generation, 1);
  assert.ok(refresh.token.length > 0);
  assert.equal(access.session_id, refresh.session_id); // both belong to the one session
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.SESS.002.1 — access token older than TTL is rejected; a refresh is required
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0.SESS.002.1 — an expired access token is rejected and forces a refresh', () => {
  const sessions = new SessionManager(DEFAULT_AUTH_CONFIG);
  const { access } = sessions.establish('user-1', 'aal2', NOW);
  const ttl = DEFAULT_AUTH_CONFIG.access_token_ttl;
  // just before expiry: still valid
  assert.equal(sessions.getClaims(access, NOW + ttl - 1).valid, true);
  // at/after expiry: rejected
  const expired = sessions.getClaims(access, NOW + ttl);
  assert.equal(expired.valid, false);
  assert.equal(expired.reason, 'expired');
  assert.equal(sessions.getClaims(access, NOW + ttl + 5000).valid, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.SESS.003.1 — rotation invalidates the prior token; reuse outside 10s revokes the session
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0.SESS.003.1 — refresh rotation is single-use; out-of-window reuse revokes the whole session', () => {
  const sessions = new SessionManager(DEFAULT_AUTH_CONFIG);
  const { refresh: r1 } = sessions.establish('user-1', 'aal2', NOW);

  // rotate: r1 → r2 (new generation, new token, persisted)
  const out = sessions.refresh(r1, NOW + 100);
  assert.ok(out.ok);
  const r2 = out.ok ? out.refresh : null;
  assert.ok(r2 && r2.generation === 2 && r2.token !== r1.token);

  // reuse the PRIOR token well outside the 10s reuse interval → whole-session revocation
  const reuse = sessions.refresh(r1, NOW + 100 + REUSE_INTERVAL_SECONDS + 1);
  assert.equal(reuse.ok, false);
  assert.ok(reuse.ok === false && reuse.revoked && reuse.reason === 'reuse_detected');
  // TEETH: the session is now dead for EVERYONE — even the legitimate r2 no longer refreshes.
  const afterRevoke = sessions.refresh(r2!, NOW + 200);
  assert.equal(afterRevoke.ok, false);
  assert.ok(afterRevoke.ok === false && afterRevoke.revoked);

  // TEETH: within the 10s window a stale token is TOLERATED (race), not revoked — a fresh session.
  const s2 = new SessionManager(DEFAULT_AUTH_CONFIG);
  const { refresh: a1 } = s2.establish('user-2', 'aal2', NOW);
  const rot = s2.refresh(a1, NOW + 5);
  assert.ok(rot.ok);
  const raced = s2.refresh(a1, NOW + 5 + REUSE_INTERVAL_SECONDS); // exactly on the boundary → tolerated
  assert.ok(raced.ok, 'within the reuse interval the stale token is re-issued, not revoked');
});

// ─────────────────────────────────────────────────────────────────────────────
// logic-sweep regression (session.ts:191) — the reuse-interval race branch must NOT
// grant credentials on a FORGED token value. Only the genuine prior token is tolerated.
// ─────────────────────────────────────────────────────────────────────────────
test('logic-sweep — reuse-race branch rejects a forged lower-generation token (never issued)', () => {
  const sessions = new SessionManager(DEFAULT_AUTH_CONFIG);
  const { refresh: r1, session_id } = sessions.establish('user-1', 'aal2', NOW);

  // legitimate rotation gen1 → gen2 at t=100 (last_rotated_at=100)
  const rot = sessions.refresh(r1, NOW + 100);
  assert.ok(rot.ok);

  // attacker presents a forged handle with a LOWER generation, inside the 10s window.
  // It was NEVER an issued token — it must be refused (revoked), not honoured.
  const forged = { token: 'forged-never-issued', session_id, generation: 1 };
  const out = sessions.refresh(forged, NOW + 105);
  assert.equal(out.ok, false, 'a forged lower-generation token must not mint a valid access JWT');
  assert.ok(out.ok === false && out.revoked && out.reason === 'reuse_detected');

  // the genuine prior token r1, re-presented inside the window, is still tolerated (race).
  const s2 = new SessionManager(DEFAULT_AUTH_CONFIG);
  const { refresh: a1 } = s2.establish('user-2', 'aal2', NOW);
  const rot2 = s2.refresh(a1, NOW + 5);
  assert.ok(rot2.ok);
  const raced = s2.refresh(a1, NOW + 10);
  assert.ok(raced.ok, 'the genuine prior token is still tolerated within the reuse window');
});

// ─────────────────────────────────────────────────────────────────────────────
// logic-sweep regression (session.ts:198) — the reuse-interval race branch must still
// enforce the lifetime bounds; a time-boxed session must not leak a credential via the race.
// ─────────────────────────────────────────────────────────────────────────────
test('logic-sweep — reuse-race branch still refuses a session past its absolute time-box', () => {
  // absolute box small enough that a legit rotation lands just under it, then the race arrives just past it.
  const cfg: AuthConfig = { ...DEFAULT_AUTH_CONFIG, session_inactivity_timeout: 100000, session_absolute_timeout: 500 };
  const sessions = new SessionManager(cfg);
  const { refresh: r1 } = sessions.establish('user-1', 'aal2', NOW);

  // legit rotation at t=497 (< 500 box → passes); last_rotated_at=497, r1→r2.
  const rot = sessions.refresh(r1, NOW + 497);
  assert.ok(rot.ok);

  // present the stale prior token r1 at t=504: past the absolute box (504 > 500) but within 10s of last rotation.
  // The race branch must NOT re-issue — the session is time-boxed out.
  const raced = sessions.refresh(r1, NOW + 504);
  assert.equal(raced.ok, false, 'a session past its absolute time-box must not leak a credential via the reuse race');
  assert.ok(raced.ok === false && raced.reason === 'absolute_timeout');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.SESS.004.1 — an idle session past inactivity_timeout is refused at its next refresh
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0.SESS.004.1 — inactivity bound refuses the refresh (lazy, at refresh time)', () => {
  const cfg: AuthConfig = { ...DEFAULT_AUTH_CONFIG, session_inactivity_timeout: 1000, session_absolute_timeout: 100000 };
  const sessions = new SessionManager(cfg);
  const { refresh: r1 } = sessions.establish('user-1', 'aal2', NOW);

  // idle just under the bound → still refreshes
  const ok = sessions.refresh(r1, NOW + 1000);
  assert.ok(ok.ok);
  const r2 = ok.ok ? ok.refresh : null;

  // now idle PAST the bound → refused at next refresh, re-auth required
  const stale = sessions.refresh(r2!, NOW + 1000 + 1001);
  assert.equal(stale.ok, false);
  assert.ok(stale.ok === false && stale.reason === 'inactivity');

  // TEETH: the absolute time-box also binds independently.
  const cfg2: AuthConfig = { ...DEFAULT_AUTH_CONFIG, session_inactivity_timeout: 100000, session_absolute_timeout: 500 };
  const s2 = new SessionManager(cfg2);
  const { refresh: b1 } = s2.establish('user-2', 'aal2', NOW);
  const boxed = s2.refresh(b1, NOW + 501);
  assert.ok(boxed.ok === false && boxed.reason === 'absolute_timeout');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.SESS.005.1 — cookie not localStorage; HttpOnly OR the AF-073 fallback
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0.SESS.005.1 — session in a cookie (never localStorage); HttpOnly or the AF-073 fallback holds', () => {
  // HttpOnly posture: accepted.
  assert.ok(verifyCookiePosture({ storage: 'cookie', httpOnly: true, cspStrict: false, accessTokenTtl: 3600 }).ok);
  // AF-073 fallback: non-HttpOnly is OK ONLY with strict CSP + short TTL.
  assert.ok(verifyCookiePosture({ storage: 'cookie', httpOnly: false, cspStrict: true, accessTokenTtl: 600 }).ok);
  // TEETH: localStorage is rejected outright regardless of everything else.
  assert.equal(verifyCookiePosture({ storage: 'localStorage', httpOnly: true, cspStrict: true, accessTokenTtl: 300 }).ok, false);
  // TEETH: non-HttpOnly WITHOUT the fallback mitigations is rejected (no silent weak posture #2).
  assert.equal(verifyCookiePosture({ storage: 'cookie', httpOnly: false, cspStrict: false, accessTokenTtl: 600 }).ok, false);
  assert.equal(verifyCookiePosture({ storage: 'cookie', httpOnly: false, cspStrict: true, accessTokenTtl: 3600 }).ok, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.SESS.006.1 — benign expiry → task continues as service_role; user re-auth-prompted
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0.SESS.006.1 — a background task continues as service_role on benign expiry', async () => {
  const store = new InMemoryAuthStore();
  const sessions = new SessionManager(DEFAULT_AUTH_CONFIG);
  const { access, session_id } = sessions.establish('user-1', 'aal2', NOW);

  // the client access token expires mid-run (benign)
  assert.equal(sessions.getClaims(access, NOW + DEFAULT_AUTH_CONFIG.access_token_ttl).valid, false);
  // the already-running task continues — service_role, no auth.uid(), NOT halted (benign, not revocation)
  const ctx = sessions.continueBackgroundTask(session_id);
  assert.equal(ctx.role, 'service_role');
  assert.equal(ctx.auth_uid, null);
  assert.equal(ctx.halted, false); // TEETH: a benign expiry must NOT halt the task (that's ISSUE-020)
  await store.logEvent({ event_type: 'task_continuation', user_id: 'user-1', summary: 'continued as service_role', detail: { session_id } }, NOW);
  // and the user is prompted to re-auth on next interaction, with the note that the task continues
  const prompt = buildReauthPrompt('expired', { page: '/tasks' }, true);
  assert.equal(prompt.backgroundTaskContinues, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.SESS.007.1 — expiry → re-auth prompt, page state preserved and restored, no data loss
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0.SESS.007.1 — expiry surfaces a re-auth prompt that preserves and restores page state', () => {
  const pageState = { form: { title: 'draft', body: 'unsaved text' }, scroll: 420 };
  const prompt = buildReauthPrompt('expired', pageState, false);
  assert.equal(prompt.trigger, 'expired');
  // on successful re-auth the state is restored VERBATIM — deep-equal, nothing dropped (#1 no data loss).
  const restored = prompt.preservedState;
  assert.deepEqual(restored, pageState);
  // TEETH: the preserved state is the same object content even after a round-trip clone (no lossy serialise).
  const roundTripped = JSON.parse(JSON.stringify(prompt.preservedState));
  assert.deepEqual(roundTripped, pageState);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0.SESS.008.1 — getUser() denies a server-side-logged-out token that getClaims() still accepts
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0.SESS.008.1 — getUser() denies a server-side-logged-out token that getClaims() cannot see', () => {
  const sessions = new SessionManager(DEFAULT_AUTH_CONFIG);
  const { access, session_id } = sessions.establish('user-1', 'aal2', NOW);
  const midLife = NOW + 60; // token not yet expired

  // before logout: both paths accept a live token
  assert.equal(sessions.getClaims(access, midLife).valid, true);
  assert.equal(sessions.getUser(access, midLife).authenticated, true);

  // server-side logout — the local JWKS claims are UNCHANGED (getClaims still says valid)...
  sessions.serverLogout(session_id);
  assert.equal(sessions.getClaims(access, midLife).valid, true, 'getClaims cannot see server-side logout');
  // ...but getUser (the Auth round-trip) DENIES it — this is the whole point of FR-0.SESS.008 (#2).
  const gu = sessions.getUser(access, midLife);
  assert.equal(gu.authenticated, false);
  assert.equal(gu.reason, 'server_logout');
});

// ─────────────────────────────────────────────────────────────────────────────
// LIVE-ADAPTER DDL CONTRACT — the pg adapter (supabase-store.ts) must speak the REAL baseline DDL
// (app/silo/migrations/0001_baseline.sql). The in-memory fake is the reference model; these tests pin
// the SQL the live adapter emits to the real column names/casts so a fake-vs-DDL drift can't reappear.
// A fake pg pool captures every (sql, params) — no live DB. (MAJOR-1 config_values, MAJOR-2 event_type.)
// ─────────────────────────────────────────────────────────────────────────────
class CapturingPool {
  readonly calls: { sql: string; params: unknown[] }[] = [];
  private queued: unknown[][] = [];
  /** Queue the rows the NEXT query should return (FIFO). */
  queue(rows: unknown[]): void {
    this.queued.push(rows);
  }
  async query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    this.calls.push({ sql, params });
    return { rows: this.queued.shift() ?? [] };
  }
  /** Transaction-aware checkout: the client shares this pool's capture buffer + queued rows, so begin/commit
   *  and the wrapped upserts are all recorded in `calls` (setProviderConfig runs its two upserts in a txn). */
  async connect(): Promise<{ query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; release: () => void }> {
    return { query: (sql: string, params: unknown[] = []) => this.query(sql, params), release: () => {} };
  }
  async end(): Promise<void> {}
}

/** Build a SupabaseAuthStore whose pool is the capturing fake (bypasses the pg connect in the ctor). */
async function captureStore(): Promise<{ store: import('./supabase-store.ts').SupabaseAuthStore; pool: CapturingPool }> {
  const { SupabaseAuthStore } = await import('./supabase-store.ts');
  const pool = new CapturingPool();
  const store = new SupabaseAuthStore('postgresql://x/y?sslmode=disable');
  // swap the real pg pool for the capturing fake
  (store as unknown as { pool: CapturingPool }).pool = pool;
  return { store, pool };
}

test('live adapter: setProviderConfig writes config_values via the REAL DDL columns key/value (not config_key/config_value)', async () => {
  const { store, pool } = await captureStore();
  // getProviderConfig re-read at the end returns nothing → defaults; queue an empty read.
  pool.queue([]);
  await store.setProviderConfig({ canToggleProvider: true }, { oauth_enabled: false, oauth_provider: 'microsoft' }, NOW);

  const writes = pool.calls.filter((c) => /insert into config_values/i.test(c.sql));
  assert.equal(writes.length, 2, 'both keys upserted');
  for (const w of writes) {
    // REGRESSION GUARD (MAJOR-1): the real baseline is config_values(key text pk, value jsonb).
    assert.match(w.sql, /\bconfig_values\s*\(\s*key\s*,\s*value\s*\)/i, 'must insert (key, value)');
    assert.match(w.sql, /on conflict\s*\(\s*key\s*\)/i, 'must conflict on (key)');
    assert.match(w.sql, /\$1::jsonb/i, 'value is jsonb — cast so a bad literal fails loud');
    // the old wrong columns must be GONE — a regression to them fails here.
    // the old wrong COLUMN names (config_key / config_value) must be gone — but not the config_valueS TABLE.
    assert.doesNotMatch(w.sql, /config_key|config_value(?!s)/i, 'no config_key/config_value column (wrong)');
  }
});

test('live adapter: getProviderConfig reads config_values by the REAL columns key/value', async () => {
  const { store, pool } = await captureStore();
  pool.queue([
    { key: 'auth.oauth_enabled', value: true },
    { key: 'auth.oauth_provider', value: 'microsoft' },
  ]);
  const cfg = await store.getProviderConfig();
  assert.deepEqual(cfg, { oauth_enabled: true, oauth_provider: 'microsoft' });
  const read = pool.calls.find((c) => /select .* from config_values/i.test(c.sql));
  assert.ok(read);
  assert.match(read!.sql, /select\s+key\s*,\s*value\s+from config_values/i);
  assert.doesNotMatch(read!.sql, /config_key|config_value(?!s)/i);
});

test('live adapter: logEvent casts event_type to the enum so a value missing from the baseline fails LOUD (owed to migration 0007)', async () => {
  const { store, pool } = await captureStore();
  pool.queue([{ id: 'ev-1', created_at: '2025-01-01T00:00:00Z' }]);
  await store.logEvent(
    { event_type: 'reuse_detection_revocation', user_id: 'user-1', summary: 'revoked', detail: { session_id: 's1' } },
    NOW,
  );
  const ins = pool.calls.find((c) => /insert into event_log/i.test(c.sql));
  assert.ok(ins);
  // REGRESSION GUARD (MAJOR-2): the cast is what makes an unknown enum value raise, never silently skip (#3).
  assert.match(ins!.sql, /\$1::event_type/i, 'event_type must be cast to the enum');
  assert.match(ins!.sql, /::jsonb/i, 'payload cast to jsonb');
  assert.equal(ins!.params[0], 'reuse_detection_revocation');
});

// ── config validation sanity (not an AC, but guards the floor the shared-spec proposal cites) ──
test('config: access_token_ttl below the 300s floor is rejected; a raise is not', () => {
  assert.deepEqual(validateAuthConfig({ ...DEFAULT_AUTH_CONFIG, access_token_ttl: 299 }).length > 0, true);
  assert.deepEqual(validateAuthConfig({ ...DEFAULT_AUTH_CONFIG, access_token_ttl: 7200 }), []); // raise allowed
});
