// ISSUE-033 §8 step 8 — offline proof of EVERY AC-* in §4 Definition of Done. Runs against the
// InMemoryCredentialStore reference model (which mirrors the connector_credentials DDL) + injected
// vendor/clock, so all timing (expiry window, grace window, single-flight race) is deterministic.
//
// The verifier's #1 hunt is fake-vs-live drift: the fake enforces the same NOT NULL / enum / atomic
// all-or-nothing rotate-persist the pg adapter's SQL enforces, so a test cannot pass here while the
// live adapter would throw. Where an AC rests on a LIVE spike (AF-089 GHL concurrency under real pg
// row-locking), the offline concurrency/property portion is proven here and the live portion is listed
// as residual (owed-to-live) — NOT faked.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryCredentialStore, type CredentialRow } from './store.js';
import {
  RefreshEngine,
  type VendorRefresh,
  type VendorTokenResponse,
  type PersistRetryDriver,
  immediatePersistRetry,
  DeadRefreshTokenError,
} from './refresh.js';
import { TokenLayers, RefreshMetric, type ReauthSignal } from './layers.js';
import {
  GOOGLE_TOKEN_PARAMS,
  GHL_TOKEN_PARAMS,
  slackTokenParams,
  SLACK_TOKEN_PARAMS_DEFAULT,
  detectCapApproach,
  REFRESH_TOKEN_CAP_APPROACH_THRESHOLD,
  type TokenParams,
  type TokenCapWarning,
} from './params.js';
import { redact, redactCredential, findTokenLeaks, REDACTED } from './redact.js';

// ── Test harness helpers ────────────────────────────────────────────────────────────────────────
const T0 = 1_700_000_000; // fixed epoch base (seconds)

/** A mutable clock the tests advance by hand — determinism, no real time. */
function makeClock(start = T0): { now: () => number; set: (t: number) => void; advance: (d: number) => void } {
  let t = start;
  return { now: () => t, set: (x) => (t = x), advance: (d) => (t += d) };
}

/** A programmable vendor: each refresh pops the next scripted response (or throws a scripted error). */
function scriptedVendor(script: Array<VendorTokenResponse | Error>): VendorRefresh & { calls: number } {
  let i = 0;
  return {
    calls: 0,
    async refresh(_connector, _token): Promise<VendorTokenResponse> {
      this.calls += 1;
      const next = script[i++];
      if (next === undefined) throw new Error('vendor script exhausted');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

function iso(epoch: number): string {
  return new Date(epoch * 1000).toISOString();
}

function collectLog() {
  const events: Array<{ kind: string; connector: string; detail?: string }> = [];
  return { log: (e: { kind: string; connector: string; detail?: string }) => events.push(e), events };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FR-3.TOK.001 / NFR-SEC.003 — credentials never leak; only presence/last-rotated surfaced
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('AC-3.TOK.001.2 / AC-NFR-SEC.003.1 — redactCredential surfaces presence + last-rotated only, never the token', () => {
  const store = new InMemoryCredentialStore();
  const row = store.seed(
    { connector: 'ghl', access_token: 'secret-access-xyz', refresh_token: 'secret-refresh-abc', expires_at: iso(T0 + 3600), scopes: ['read'], state: 'active' },
    T0,
  );
  const surfaced = redactCredential(row);
  // presence + metadata only
  assert.equal(surfaced.connector, 'ghl');
  assert.equal(surfaced.state, 'active');
  assert.equal(surfaced.has_access_token, true);
  assert.equal(surfaced.has_refresh_token, true);
  assert.equal(surfaced.last_rotated_at, row.updated_at);
  // NO token field exists on the surfaced object at all
  const json = JSON.stringify(surfaced);
  assert.ok(!json.includes('secret-access-xyz'), 'access token must not appear in the surfaced form');
  assert.ok(!json.includes('secret-refresh-abc'), 'refresh token must not appear in the surfaced form');
  assert.ok(!('access_token' in surfaced), 'no access_token key on the presence view');
  assert.ok(!('refresh_token' in surfaced), 'no refresh_token key on the presence view');
});

test('AC-NFR-SEC.003.2 — the defensive redactor scrubs token material from an arbitrary log payload', () => {
  const store = new InMemoryCredentialStore();
  const row = store.seed(
    { connector: 'slack', access_token: 'xoxb-99887766', refresh_token: 'xoxe-1-secret', expires_at: null, scopes: null, state: 'active' },
    T0,
  );
  // A careless payload that stuffs the raw row + a vendor token by prefix + under a secret-named key.
  const payload = {
    connector: 'slack',
    note: 'refresh ok',
    raw: row, // the whole credential row (access_token/refresh_token fields)
    Authorization: 'Bearer ya29.LEAKYTOKEN',
    nested: { access_token: 'xoxb-should-scrub', harmless: 'hello world' },
  };
  const known = [row.access_token, row.refresh_token].filter((t): t is string => !!t);
  // Before redaction, leaks are detectable.
  assert.ok(findTokenLeaks(payload, known).length > 0, 'raw payload should contain leaks');
  // After redaction, none remain.
  const cleaned = redact(payload, known);
  assert.deepEqual(findTokenLeaks(cleaned, known), [], 'redacted payload must contain no token material');
  const cleanJson = JSON.stringify(cleaned);
  assert.ok(!cleanJson.includes('xoxb-99887766'));
  assert.ok(!cleanJson.includes('xoxe-1-secret'));
  assert.ok(!cleanJson.includes('ya29.LEAKYTOKEN'));
  assert.ok(cleanJson.includes(REDACTED));
  assert.ok(cleanJson.includes('hello world'), 'non-secret data is preserved');
});

test('AC-3.TOK.001.1 — the store never yields a token except via the runtime read path (fake models encrypted-at-rest boundary)', async () => {
  // The reference model exposes the token only through getCredential (the runtime call-time decrypt);
  // there is no other accessor. The redaction boundary is the only surfacing path (asserted above).
  const store = new InMemoryCredentialStore();
  store.seed({ connector: 'google', access_token: 'ya29.aaa', refresh_token: '1//rrr', expires_at: iso(T0 + 3600), scopes: null, state: 'active' }, T0);
  const cred = await store.getCredential('google');
  assert.ok(cred);
  // A surfaced form of what a health panel would render carries no token.
  assert.deepEqual(findTokenLeaks(redactCredential(cred!)), []);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FR-3.TOK.005 — atomic rotate-persist (the #1 backstop) + AF-089 concurrency (offline portion)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

function ghlEngine(store: InMemoryCredentialStore, clock: ReturnType<typeof makeClock>, vendor: VendorRefresh, retry: PersistRetryDriver = immediatePersistRetry, log = collectLog().log) {
  return new RefreshEngine({ store, vendor, clock: clock.now, log, persistRetry: retry });
}

test('AC-3.TOK.005.1 — a GHL refresh persists rotated access+refresh atomically before the new access token is usable', async () => {
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  store.seed({ connector: 'ghl', access_token: 'old-access', refresh_token: 'old-refresh', expires_at: iso(T0 + 60), scopes: ['crm'], state: 'active' }, T0);
  const vendor = scriptedVendor([{ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 86399, scopes: ['crm'] }]);
  const engine = ghlEngine(store, clock, vendor);

  const res = await engine.refresh('ghl', GHL_TOKEN_PARAMS);
  assert.equal(res.kind, 'refreshed');
  const row = await store.getCredential('ghl');
  // BOTH halves landed together — atomic. The old refresh token is gone (single-use rotated).
  assert.equal(row!.access_token, 'new-access');
  assert.equal(row!.refresh_token, 'new-refresh');
  assert.equal(row!.state, 'active');
  // expiry came from the vendor's expires_in (the authority), not a constant
  assert.equal(row!.expires_at, iso(clock.now() + 86399));
});

test('AC-3.TOK.005.2 — persist fails after vendor rotation but recovers within the grace window (no half-saved credential)', async () => {
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  store.seed({ connector: 'ghl', access_token: 'old-a', refresh_token: 'old-r', expires_at: iso(T0 + 60), scopes: null, state: 'active' }, T0);
  const vendor = scriptedVendor([{ access_token: 'new-a', refresh_token: 'new-r', expires_in: 86399, scopes: null }]);

  // A retry driver that fails the persist ONCE (simulating a post-rotation crash) then succeeds, while
  // the clock stays inside the 30s grace window.
  let attempts = 0;
  const flakyRetry: PersistRetryDriver = {
    async run(attempt, deadline, now) {
      for (;;) {
        attempts += 1;
        if (attempts === 1) {
          // simulate the persist crashing right after rotation, still inside the grace window
          if (now() >= deadline) throw new Error('grace elapsed');
          clock.advance(5); // 5s < 30s grace — still recoverable
          continue;
        }
        return attempt(); // second attempt succeeds
      }
    },
  };
  const engine = ghlEngine(store, clock, vendor, flakyRetry);
  const res = await engine.refresh('ghl', GHL_TOKEN_PARAMS);
  assert.equal(res.kind, 'refreshed');
  const row = await store.getCredential('ghl');
  assert.equal(row!.access_token, 'new-a');
  assert.equal(row!.refresh_token, 'new-r'); // the rotated token WAS persisted — access not lost (#1)
  assert.equal(row!.state, 'active');
  assert.ok(attempts >= 2, 'the persist was retried inside the grace window');
});

test('AC-3.TOK.005.2 — persist lost past the grace window degrades LOUDLY, never silently retry-fails', async () => {
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  store.seed({ connector: 'ghl', access_token: 'old-a', refresh_token: 'old-r', expires_at: iso(T0 + 60), scopes: null, state: 'active' }, T0);
  const vendor = scriptedVendor([{ access_token: 'new-a', refresh_token: 'new-r', expires_in: 86399, scopes: null }]);
  const log = collectLog();

  // A retry driver that never succeeds and lets the clock run past the 30s grace window.
  const alwaysFailPastGrace: PersistRetryDriver = {
    async run(attempt, deadline, now) {
      for (;;) {
        try {
          // force a persist failure to exercise the recovery loop
          throw new Error('persist crash');
        } catch (e) {
          if (now() >= deadline) throw e; // window elapsed → give up (engine degrades loud)
          clock.advance(31); // jump PAST the 30s grace window
        }
      }
      // (unreachable — kept for shape parity with immediatePersistRetry)
      return attempt();
    },
  };
  const engine = new RefreshEngine({ store, vendor, clock: clock.now, log: log.log, persistRetry: alwaysFailPastGrace });
  const res = await engine.refresh('ghl', GHL_TOKEN_PARAMS);
  assert.equal(res.kind, 'degraded-persist-lost');
  const row = await store.getCredential('ghl');
  assert.equal(row!.state, 'degraded', 'connector degraded loudly'); // #1/#3 — surfaced, not swallowed
  assert.ok(log.events.some((e) => e.kind === 'refresh.rotate_persist_lost'), 'the loss was logged loudly');
});

test('AF-089 (offline concurrency portion) — single-flight collapses concurrent GHL refreshes to ONE vendor call + ONE rotation', async () => {
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  store.seed({ connector: 'ghl', access_token: 'old-a', refresh_token: 'old-r', expires_at: iso(T0 + 60), scopes: null, state: 'active' }, T0);
  // If single-flight fails, a second vendor call would be scripted; we provide only ONE response so a
  // second call would throw 'script exhausted' and fail the test.
  const vendor = scriptedVendor([{ access_token: 'new-a', refresh_token: 'new-r', expires_in: 86399, scopes: null }]);
  const log = collectLog();
  const engine = ghlEngine(store, clock, vendor, immediatePersistRetry, log.log);

  // Fire N concurrent refreshes for the same connector.
  const results = await Promise.all(Array.from({ length: 8 }, () => engine.refresh('ghl', GHL_TOKEN_PARAMS)));
  // All succeed, exactly one vendor call happened (single-flight), the row rotated exactly once.
  assert.ok(results.every((r) => r.kind === 'refreshed'));
  assert.equal(vendor.calls, 1, 'exactly one vendor refresh — the others joined the in-flight one');
  assert.ok(log.events.filter((e) => e.kind === 'refresh.single_flight_join').length >= 1, 'concurrent callers joined');
  const row = await store.getCredential('ghl');
  assert.equal(row!.refresh_token, 'new-r');
});

test('rotate-persist optimistic-concurrency guard rejects a stale flight (loser never clobbers the winner)', async () => {
  // Direct store-level proof that mirrors the live SQL `where refresh_token is not distinct from $expected`.
  const store = new InMemoryCredentialStore();
  store.seed({ connector: 'ghl', access_token: 'a0', refresh_token: 'r0', expires_at: iso(T0 + 60), scopes: null, state: 'active' }, T0);
  // Flight A (winner) rotates r0 → r1.
  const a = await store.rotatePersist({ connector: 'ghl', new_access_token: 'a1', new_refresh_token: 'r1', new_expires_at: iso(T0 + 86399), new_scopes: null, expected_refresh_token: 'r0' }, T0 + 1);
  assert.equal(a.kind, 'persisted');
  // Flight B started from r0 too, but arrives late — its expected token no longer matches → stale no-op.
  const b = await store.rotatePersist({ connector: 'ghl', new_access_token: 'a2', new_refresh_token: 'r2', new_expires_at: iso(T0 + 86399), new_scopes: null, expected_refresh_token: 'r0' }, T0 + 2);
  assert.equal(b.kind, 'stale');
  const row = await store.getCredential('ghl');
  assert.equal(row!.refresh_token, 'r1', "the winner's token survived; the loser did not clobber it");
});

test('logic-sweep — a NON-rotating connector persist blip is TRANSIENT (re-throws), NOT a rotate-persist-lost degrade', async () => {
  // Regression for the wrong-branch bug in doRefresh: for a non-rotating connector (Google) nothing
  // rotated, so a transient persist failure (deadlock/connection blip) leaves the old access+refresh
  // tokens fully valid vendor-side — a retry would succeed. It must therefore surface as a transient,
  // retryable throw (like a transient vendor failure), NOT fall into the rotate-persist-lost catch that
  // degrades the connector + returns 'degraded-persist-lost' (which the layer escalates to a human
  // re-auth + task pause for reason 'rotate_persist_lost' — needless work-halt from a recoverable error).
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  store.seed({ connector: 'google', access_token: 'ya29.old', refresh_token: '1//keep-me', expires_at: iso(T0 + 60), scopes: ['gmail.readonly'], state: 'active' }, T0);
  const vendor = scriptedVendor([{ access_token: 'ya29.new', refresh_token: null, expires_in: 3600, scopes: ['gmail.readonly'] }]);
  const log = collectLog();
  // A store whose rotatePersist throws a transient blip (no rotation happened — Google doesn't rotate).
  const blip = new Error('deadlock detected');
  const flakyStore = Object.assign(Object.create(Object.getPrototypeOf(store)), store, {
    rotatePersist: async (): Promise<never> => {
      throw blip;
    },
  });
  const engine = new RefreshEngine({ store: flakyStore, vendor, clock: clock.now, log: log.log, persistRetry: immediatePersistRetry });

  // CORRECT behaviour: the transient blip propagates to the caller (retryable), it is NOT swallowed
  // into a terminal degrade.
  await assert.rejects(engine.refresh('google', GOOGLE_TOKEN_PARAMS), /deadlock detected/);
  // The connector was NOT degraded (nothing rotated; a retry can still succeed).
  const row = await store.getCredential('google');
  assert.equal(row!.state, 'active', 'a non-rotating persist blip must NOT degrade the connector');
  assert.ok(!log.events.some((e) => e.kind === 'refresh.rotate_persist_lost'), 'a non-rotating blip is not a rotate-persist-lost event');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FR-3.TOK.007/008/009 — per-connector params drive the SAME engine (no per-connector code branch)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('AC-3.TOK.007.1 — Google refresh renews access and RETAINS the refresh token (no rotation)', async () => {
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  store.seed({ connector: 'google', access_token: 'ya29.old', refresh_token: '1//keep-me', expires_at: iso(T0 + 60), scopes: ['gmail.readonly'], state: 'active' }, T0);
  // Google returns a new access token but NO new refresh token (echoes null) on a normal refresh.
  const vendor = scriptedVendor([{ access_token: 'ya29.new', refresh_token: null, expires_in: 3600, scopes: ['gmail.readonly'] }]);
  const engine = ghlEngine(store, clock, vendor);
  const res = await engine.refresh('google', GOOGLE_TOKEN_PARAMS);
  assert.equal(res.kind, 'refreshed');
  const row = await store.getCredential('google');
  assert.equal(row!.access_token, 'ya29.new');
  assert.equal(row!.refresh_token, '1//keep-me', 'the existing refresh token is retained (persist-new is a no-op)');
  assert.equal(row!.expires_at, iso(clock.now() + 3600)); // ~1h from vendor expires_in
});

// AC-3.TOK.007.2 — the 100-token cap is DETECTED and SURFACED (loud warning) BEFORE the oldest refresh
// token is silently invalidated. Behavioural, not a constant-equals-constant tautology: we exercise the
// detect function across below/near/at the cap AND prove the warning fires strictly before the eviction
// point via the layer's emit seam. The 100 is Google-scoped; a non-capped vendor is a no-op.

test('AC-3.TOK.007.2 — comfortably below the cap surfaces NOTHING (no false alarm)', () => {
  // 80/100 → 20 free slots, well above the 10-slot approach threshold → no warning.
  assert.equal(detectCapApproach(80, GOOGLE_TOKEN_PARAMS), null);
  assert.equal(detectCapApproach(0, GOOGLE_TOKEN_PARAMS), null);
  // exactly one slot above the threshold boundary (91 free = 91 → remaining 91? no: 100-89=11) is still clear
  assert.equal(detectCapApproach(89, GOOGLE_TOKEN_PARAMS), null, '11 free slots > threshold → still quiet');
});

test('AC-3.TOK.007.2 — APPROACHING the cap surfaces a loud warning', () => {
  // 90/100 → exactly 10 free slots = at the approach threshold → surface.
  const w = detectCapApproach(90, GOOGLE_TOKEN_PARAMS);
  assert.ok(w, 'a warning is surfaced at the approach threshold');
  assert.equal(w!.connector, 'google');
  assert.equal(w!.count, 90);
  assert.equal(w!.cap, 100);
  assert.equal(w!.remaining, 10);
  assert.equal(w!.atCap, false, 'approaching, not yet at the cap — still time to act');
});

test('AC-3.TOK.007.2 (TEETH) — the warning fires BEFORE the silent-invalidation point, never after it silently', () => {
  // Walk the count up to the cap. The invalidation point is count === cap (100): the 101st token
  // silently evicts the oldest. Prove that a warning has ALREADY fired by the time we reach the cap,
  // i.e. there exists a surfaced warning strictly before eviction — the whole point of AC-3.TOK.007.2.
  const cap = GOOGLE_TOKEN_PARAMS.refreshTokenCapPerAccount!;
  let firstWarnAt: number | null = null;
  for (let count = 0; count <= cap; count++) {
    const w = detectCapApproach(count, GOOGLE_TOKEN_PARAMS);
    if (w && firstWarnAt === null) firstWarnAt = count;
  }
  assert.notEqual(firstWarnAt, null, 'a warning must fire somewhere before the cap');
  assert.ok(firstWarnAt! < cap, `the warning (@${firstWarnAt}) fires BEFORE the cap (${cap}) — before the oldest is silently invalidated`);
  // And it fires with slack to act: at least `threshold` slots of runway remained when it first fired.
  assert.ok(cap - firstWarnAt! >= REFRESH_TOKEN_CAP_APPROACH_THRESHOLD - 1, 'the warning leaves runway to re-consent/prune before eviction');
});

test('AC-3.TOK.007.2 — AT/OVER the cap escalates (atCap) — the silent-invalidation point is announced', () => {
  const at = detectCapApproach(100, GOOGLE_TOKEN_PARAMS);
  assert.ok(at);
  assert.equal(at!.atCap, true, 'at the cap the oldest is being evicted — escalated');
  assert.equal(at!.remaining, 0);
  const over = detectCapApproach(103, GOOGLE_TOKEN_PARAMS);
  assert.ok(over);
  assert.equal(over!.atCap, true);
  assert.ok(over!.remaining < 0, 'over the cap → negative remaining, oldest already evicted');
});

test('AC-3.TOK.007.2 — a non-capped connector (GHL / Slack) is a no-op (only Google caps)', () => {
  // Even at an absurd count, a connector with refreshTokenCapPerAccount === null surfaces nothing.
  assert.equal(GHL_TOKEN_PARAMS.refreshTokenCapPerAccount, null);
  assert.equal(detectCapApproach(999, GHL_TOKEN_PARAMS), null);
  assert.equal(detectCapApproach(999, SLACK_TOKEN_PARAMS_DEFAULT), null);
});

test('AC-3.TOK.007.2 — the TokenLayers seam EMITS the loud warning + logs it, carrying no token material (#2)', async () => {
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  const vendor = scriptedVendor([]);
  const engine = ghlEngine(store, clock, vendor);
  const { l, capWarnings, log } = layers(store, clock, engine);

  // Below threshold → nothing emitted.
  assert.equal(l.surfaceCapApproach(50, GOOGLE_TOKEN_PARAMS), null);
  assert.equal(capWarnings.length, 0, 'no emit when comfortably below the cap');

  // Approaching → one loud emit + a log line, BEFORE any silent invalidation.
  const w = l.surfaceCapApproach(95, GOOGLE_TOKEN_PARAMS);
  assert.ok(w);
  assert.equal(capWarnings.length, 1, 'the approach was surfaced through the emit seam');
  assert.equal(capWarnings[0]!.count, 95);
  assert.equal(capWarnings[0]!.remaining, 5);
  assert.ok(log.events.some((e) => e.kind === 'tok.cap_approach'), 'the approach was logged loudly');

  // At the cap → escalated log kind.
  l.surfaceCapApproach(100, GOOGLE_TOKEN_PARAMS);
  assert.ok(log.events.some((e) => e.kind === 'tok.cap_reached'), 'reaching the cap escalates the log kind');

  // The emitted warning carries only non-secret counters — no token material ever (#2).
  assert.deepEqual(findTokenLeaks(capWarnings[0]), []);

  // A non-capped connector through the same seam is a no-op (no extra emit).
  const before = capWarnings.length;
  assert.equal(l.surfaceCapApproach(999, GHL_TOKEN_PARAMS), null);
  assert.equal(capWarnings.length, before, 'GHL (no cap) emits nothing through the layer seam');
});

test('AC-3.TOK.008.1 — GHL params mark rotating refresh + the 30s grace, driving mandatory atomic persist', () => {
  assert.equal(GHL_TOKEN_PARAMS.rotatesRefreshToken, true);
  assert.equal(GHL_TOKEN_PARAMS.rotationGraceSeconds, 30);
  assert.equal(GHL_TOKEN_PARAMS.accessTokenExpires, true);
});

test('AC-3.TOK.009.1 — default Slack (xoxb) is non-expiring: proactive refresh SKIPS it', async () => {
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  // xoxb credential: expires_at null (non-expiring).
  store.seed({ connector: 'slack', access_token: 'xoxb-abc', refresh_token: null, expires_at: null, scopes: null, state: 'active' }, T0);
  assert.equal(SLACK_TOKEN_PARAMS_DEFAULT.accessTokenExpires, false);
  assert.equal(SLACK_TOKEN_PARAMS_DEFAULT.rotatesRefreshToken, false);
  // The proactive query excludes non-expiring credentials.
  const due = await store.dueForProactiveRefresh(clock.now(), 30 * 60);
  assert.equal(due.length, 0, 'a non-expiring xoxb token is not due for proactive refresh');
});

test('AC-3.TOK.009.2 — Slack with rotation enabled atomically persists the rotated xoxe refresh token', async () => {
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  const params = slackTokenParams(true);
  assert.equal(params.rotatesRefreshToken, true);
  assert.equal(params.accessTokenExpires, true);
  store.seed({ connector: 'slack', access_token: 'xoxe.xoxb-old', refresh_token: 'xoxe-1-old', expires_at: iso(T0 + 60), scopes: null, state: 'active' }, T0);
  const vendor = scriptedVendor([{ access_token: 'xoxe.xoxb-new', refresh_token: 'xoxe-1-new', expires_in: 43200, scopes: null }]);
  const engine = ghlEngine(store, clock, vendor);
  const res = await engine.refresh('slack', params);
  assert.equal(res.kind, 'refreshed');
  const row = await store.getCredential('slack');
  assert.equal(row!.refresh_token, 'xoxe-1-new', 'the rotated Slack refresh token was persisted');
  assert.equal(row!.expires_at, iso(clock.now() + 43200));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FR-3.TOK.002 — Layer 1 proactive job
// ═══════════════════════════════════════════════════════════════════════════════════════════════

function layers(store: InMemoryCredentialStore, clock: ReturnType<typeof makeClock>, engine: RefreshEngine, metric = new RefreshMetric()) {
  const signals: ReauthSignal[] = [];
  const capWarnings: TokenCapWarning[] = [];
  const log = collectLog();
  const l = new TokenLayers({
    store,
    engine,
    clock: clock.now,
    emitReauth: (s) => signals.push(s),
    emitCapWarning: (w) => capWarnings.push(w),
    log: log.log,
    metric,
  });
  return { l, signals, capWarnings, metric, log };
}

test('AC-3.TOK.002.1 — a token expiring within the lead window is refreshed before expiry; AC-3.TOK.002.2 — a non-expiring one is skipped', async () => {
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  // Expiring GHL token, 10 min to expiry (< 30 min lead) → due.
  store.seed({ connector: 'ghl', access_token: 'a', refresh_token: 'r', expires_at: iso(T0 + 10 * 60), scopes: null, state: 'active' }, T0);
  // Non-expiring Slack xoxb → skipped.
  store.seed({ connector: 'slack', access_token: 'xoxb', refresh_token: null, expires_at: null, scopes: null, state: 'active' }, T0);
  // A distant Google token, 2h to expiry (> 30 min lead) → not yet due.
  store.seed({ connector: 'google', access_token: 'ya29', refresh_token: '1//r', expires_at: iso(T0 + 2 * 3600), scopes: null, state: 'active' }, T0);

  const vendor = scriptedVendor([{ access_token: 'a2', refresh_token: 'r2', expires_in: 86399, scopes: null }]);
  const engine = ghlEngine(store, clock, vendor);
  const paramsFor = (c: string): TokenParams => (c === 'ghl' ? GHL_TOKEN_PARAMS : c === 'google' ? GOOGLE_TOKEN_PARAMS : SLACK_TOKEN_PARAMS_DEFAULT);

  const { l, metric } = layers(store, clock, engine);
  const out = await l.proactivePass(30 * 60, paramsFor);
  // Only GHL was due and refreshed.
  assert.equal(out.length, 1);
  assert.equal(out[0]!.connector, 'ghl');
  assert.equal(out[0]!.result.kind, 'refreshed');
  const ghl = await store.getCredential('ghl');
  assert.equal(ghl!.refresh_token, 'r2'); // renewed before expiry
  assert.equal(metric.snapshot().automatic, 1);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FR-3.TOK.003 — Layer 2 reactive refresh + retry-once
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('AC-3.TOK.003.1 — on a 401, the runtime refreshes and retries the call exactly once → success', async () => {
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  store.seed({ connector: 'ghl', access_token: 'stale', refresh_token: 'r', expires_at: iso(T0 + 60), scopes: null, state: 'active' }, T0);
  const vendor = scriptedVendor([{ access_token: 'fresh', refresh_token: 'r2', expires_in: 86399, scopes: null }]);
  const engine = ghlEngine(store, clock, vendor);
  const { l, metric } = layers(store, clock, engine);

  let callCount = 0;
  const call = async (): Promise<{ status: number; value?: string }> => {
    callCount += 1;
    return callCount === 1 ? { status: 401 } : { status: 200, value: 'ok' };
  };
  const res = await l.callWithReactiveRefresh('ghl', GHL_TOKEN_PARAMS, call);
  assert.equal(res.ok, true);
  assert.equal(res.value, 'ok');
  assert.equal(callCount, 2, 'the call was retried exactly once');
  assert.equal(vendor.calls, 1, 'refreshed exactly once');
  assert.equal(metric.snapshot().automatic, 1, 'a Layer-2 win counts as an automatic resolution');
});

test('AC-3.TOK.003.2 — a second 401 after refresh fails the call and degrades — no further auto-retry (no loop)', async () => {
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  store.seed({ connector: 'ghl', access_token: 'stale', refresh_token: 'r', expires_at: iso(T0 + 60), scopes: null, state: 'active' }, T0);
  const vendor = scriptedVendor([{ access_token: 'fresh', refresh_token: 'r2', expires_in: 86399, scopes: null }]);
  const engine = ghlEngine(store, clock, vendor);
  const { l, signals, metric } = layers(store, clock, engine);

  let callCount = 0;
  const call = async (): Promise<{ status: number }> => {
    callCount += 1;
    return { status: 401 }; // always 401, even after a good refresh
  };
  const res = await l.callWithReactiveRefresh('ghl', GHL_TOKEN_PARAMS, call);
  assert.equal(res.ok, false);
  assert.equal(callCount, 2, 'exactly one retry — NOT a retry loop');
  const row = await store.getCredential('ghl');
  assert.equal(row!.state, 'degraded');
  assert.equal(signals.length, 1, 'a re-auth signal was emitted');
  assert.equal(signals[0]!.pauseDependentTasks, true);
  assert.equal(metric.snapshot().manual, 1);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FR-3.TOK.004 — Layer 3 dead-token → degraded + pause/re-auth signal
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('AC-3.TOK.004.1 — a dead refresh token moves the connector to degraded and emits the pause + re-auth signal (tasks pause, not fail)', async () => {
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  store.seed({ connector: 'ghl', access_token: 'a', refresh_token: 'dead-r', expires_at: iso(T0 + 10 * 60), scopes: null, state: 'active' }, T0);
  // The vendor rejects the refresh token itself → DeadRefreshTokenError.
  const vendor = scriptedVendor([new DeadRefreshTokenError('ghl')]);
  const engine = ghlEngine(store, clock, vendor);
  const { l, signals, metric } = layers(store, clock, engine);

  const out = await l.proactivePass(30 * 60, () => GHL_TOKEN_PARAMS);
  assert.equal(out[0]!.result.kind, 'dead');
  const row = await store.getCredential('ghl');
  assert.equal(row!.state, 'degraded');
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.connector, 'ghl');
  assert.equal(signals[0]!.reason, 'dead_refresh_token');
  assert.equal(signals[0]!.pauseDependentTasks, true, 'dependent tasks pause (ISSUE-038 resumes on re-auth), not fail');
  assert.equal(metric.snapshot().manual, 1);
  // The emitted signal must carry no token material (#2).
  assert.deepEqual(findTokenLeaks(signals[0]), []);
});

test('AC-3.TOK.004.2 (emit half) — the emitted signal is exactly what ISSUE-038 consumes to pause + one-click re-auth', async () => {
  // This slice owns the EMIT; the auto-resume of paused tasks is realised + proven in ISSUE-038.
  const store = new InMemoryCredentialStore();
  const clock = makeClock();
  store.seed({ connector: 'ghl', access_token: 'a', refresh_token: 'dead', expires_at: iso(T0 + 60), scopes: null, state: 'active' }, T0);
  const vendor = scriptedVendor([new DeadRefreshTokenError('ghl')]);
  const engine = ghlEngine(store, clock, vendor);
  const { l, signals } = layers(store, clock, engine);
  await l.proactivePass(30 * 60, () => GHL_TOKEN_PARAMS);
  const s = signals[0]!;
  assert.deepEqual(Object.keys(s).sort(), ['connector', 'emitted_at', 'pauseDependentTasks', 'reason'].sort());
  assert.equal(typeof s.emitted_at, 'string');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FR-3.TOK.006 — automatic-vs-manual metric
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('AC-3.TOK.006.1 — the automatic-resolution ratio is reported and visible', () => {
  const m = new RefreshMetric();
  assert.equal(m.automaticRatio(), 1, 'no activity yet → 1.0 (nothing has needed a human)');
  m.recordAutomatic();
  m.recordAutomatic();
  m.recordAutomatic();
  m.recordManual();
  const snap = m.snapshot();
  assert.equal(snap.automatic, 3);
  assert.equal(snap.manual, 1);
  assert.equal(snap.ratio, 0.75);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Fake-vs-live drift guard — the fake enforces the DDL's NOT NULL + enum exactly
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('fake enforces connector_credentials NOT NULL (access_token, connector) + credential_state enum, mirroring the DDL', () => {
  const store = new InMemoryCredentialStore();
  assert.throws(() => store.seed({ connector: '', access_token: 'a', refresh_token: null, expires_at: null, scopes: null, state: 'active' }, T0), /connector is NOT NULL/);
  assert.throws(() => store.seed({ connector: 'x', access_token: '', refresh_token: null, expires_at: null, scopes: null, state: 'active' }, T0), /access_token is NOT NULL/);
  // @ts-expect-error deliberately out-of-enum state
  assert.throws(() => store.seed({ connector: 'x', access_token: 'a', refresh_token: null, expires_at: null, scopes: null, state: 'bogus' }, T0), /out of enum/);
  // rotate-persist also refuses an empty new access token (mirrors the live NOT NULL).
  store.seed({ connector: 'ghl', access_token: 'a', refresh_token: 'r', expires_at: null, scopes: null, state: 'active' }, T0);
  assert.rejects(() => store.rotatePersist({ connector: 'ghl', new_access_token: '', new_refresh_token: 'r2', new_expires_at: null, new_scopes: null, expected_refresh_token: 'r' }, T0), /new_access_token is NOT NULL/);
});
