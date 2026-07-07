// ISSUE-017 §9 — the end-to-end AC battery. Every AC-0.WHK.* and AC-NFR-SEC.008.* is proven here
// against the InMemoryWebhookStore reference model, valid/tampered/replayed per connector. This IS
// the primary verification layer (test-strategy.md); the live per-connector confirmation is owed at
// onboarding (OD-172). Deterministic: a fixed logical `now`; no Date.now()/random in assertions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { verifyWebhook } from './verify.js';
import { InMemoryWebhookStore } from './store.js';
import { DEFAULT_WEBHOOK_CONFIG, SECRET_KIND, validateWebhookConfig, type WebhookConfig } from './config.js';
import { ingress, parseThenVerifyIngress, reserialisationDiffers, type InboundRequest } from './rawBody.js';
import { verifyGhl, ghlSigningInput } from './verifiers/ghl.js';
import { rotateSecret, retireOldVersions } from './rotation.js';
import { mintEndpointToken, webhookPath, isValidEndpointToken } from './obscurity.js';
import {
  generateEd25519Pair,
  generateRsaJwks,
  generateSlackSigningSecret,
  mintRs256Jwt,
  signEd25519,
  signSlackHeaders,
} from './fixtures.js';

const NOW = 1_760_000_000; // fixed logical epoch seconds
const TOKEN = 'deploytoken000000000000'; // stand-in endpoint obscurity token

// ── harness: a fully-seeded store for one connector, plus a request builder ─────────
function ghlSetup() {
  const store = new InMemoryWebhookStore();
  const pair = generateEd25519Pair();
  store.seedSecret({
    connector: 'ghl',
    secret_kind: SECRET_KIND.ghl_ed25519_public_key,
    secret_value: pair.publicKeyPem,
    secret_version: 1,
    active: true,
    rotated_at: null,
  });
  const body = Buffer.from(JSON.stringify({ id: 'evt-ghl-1', type: 'ContactCreate' }), 'utf8');
  const sig = signEd25519(pair.privateKey, ghlSigningInput(body));
  const req: InboundRequest = { raw: body, headers: { 'x-ghl-signature': sig }, sourceIp: '203.0.113.7' };
  return { store, pair, body, sig, req };
}

function slackSetup() {
  const store = new InMemoryWebhookStore();
  const secret = generateSlackSigningSecret();
  store.seedSecret({
    connector: 'slack',
    secret_kind: SECRET_KIND.slack_signing,
    secret_value: secret,
    secret_version: 1,
    active: true,
    rotated_at: null,
  });
  const body = Buffer.from(JSON.stringify({ type: 'event_callback', event: { type: 'message' } }), 'utf8');
  const ts = String(NOW);
  const req: InboundRequest = { raw: body, headers: signSlackHeaders(secret, ts, body), sourceIp: '203.0.113.9' };
  return { store, secret, body, ts, req };
}

function googleSetup(aud = 'https://deploy.example/pubsub-push') {
  const store = new InMemoryWebhookStore();
  const rsa = generateRsaJwks();
  store.seedSecret({
    connector: 'google',
    secret_kind: SECRET_KIND.google_expected_audience,
    secret_value: aud,
    secret_version: 1,
    active: true,
    rotated_at: null,
  });
  const body = Buffer.from(JSON.stringify({ message: { messageId: 'msg-1', data: 'e30=' } }), 'utf8');
  const jwt = mintRs256Jwt(rsa.privateKey, rsa.kid, { aud, exp: NOW + 600, iat: NOW - 10, iss: 'https://accounts.google.com' });
  const req: InboundRequest = { raw: body, headers: { authorization: `Bearer ${jwt}` }, sourceIp: '203.0.113.11' };
  const deps = { store, cfg: DEFAULT_WEBHOOK_CONFIG, endpointToken: TOKEN, now: NOW, googleJwks: async () => rsa.jwks };
  return { store, rsa, body, jwt, aud, req, deps };
}

function deps(store: InMemoryWebhookStore, cfg: WebhookConfig = DEFAULT_WEBHOOK_CONFIG) {
  return { store, cfg, endpointToken: TOKEN, now: NOW };
}

// ── AC-0.WHK.001.1 — invalid/absent signature → 401, no payload processing ──────────
test('AC-0.WHK.001.1 — absent signature → 401 + no downstream payload', async () => {
  const { store } = ghlSetup();
  const req: InboundRequest = { raw: Buffer.from('{}', 'utf8'), headers: {}, sourceIp: '203.0.113.7' };
  const out = await verifyWebhook('ghl', req, deps(store));
  assert.equal(out.status, 401);
  assert.equal(out.verifiedPayload, undefined);
  assert.equal(store.eventLog.filter((e) => e.event_type === 'webhook_verified').length, 0);
});

test('AC-0.WHK.001.1 — happy path → 200 + verified payload handed off', async () => {
  const { store, req } = ghlSetup();
  const out = await verifyWebhook('ghl', req, deps(store));
  assert.equal(out.status, 200);
  assert.deepEqual(out.verifiedPayload, { id: 'evt-ghl-1', type: 'ContactCreate' });
});

// ── AC-0.WHK.002.1 — GHL Ed25519 fails → 401 + prompt_injection ─────────────────────
test('AC-0.WHK.002.1 — tampered GHL body fails Ed25519 → 401 + prompt_injection log', async () => {
  const { store, sig } = ghlSetup();
  const tampered = Buffer.from(JSON.stringify({ id: 'evt-ghl-1', type: 'ContactDELETE' }), 'utf8');
  const req: InboundRequest = { raw: tampered, headers: { 'x-ghl-signature': sig }, sourceIp: '203.0.113.7' };
  const out = await verifyWebhook('ghl', req, deps(store));
  assert.equal(out.status, 401);
  const gl = store.guardrailLog.at(-1)!;
  assert.equal(gl.guardrail_type, 'prompt_injection');
  assert.equal(gl.action_blocked, true);
});

// ── AC-0.WHK.002.2 — legacy X-WH-Signature-only after cutoff → rejected ──────────────
test('AC-0.WHK.002.2 — legacy X-WH-Signature-only after 2026-07-01 → rejected', async () => {
  const { store, body } = ghlSetup();
  const req: InboundRequest = { raw: body, headers: { 'x-wh-signature': 'legacy-rsa-sig' }, sourceIp: '203.0.113.7' };
  // NOW (2025-10-09) predates the 2026-07-01 cutoff; assert against a post-cutoff clock.
  const postCutoff = Math.floor(Date.parse('2026-07-02T00:00:00Z') / 1000);
  const out = await verifyWebhook('ghl', req, { ...deps(store), now: postCutoff });
  assert.equal(out.status, 401);
  assert.match(store.guardrailLog.at(-1)!.description, /legacy X-WH-Signature/);
});

// ── AC-0.WHK.003.1 — Google wrong JWT audience → 401 + log ──────────────────────────
test('AC-0.WHK.003.1 — Google push with wrong audience → 401 + log', async () => {
  const { store, rsa, body } = googleSetup();
  const wrong = mintRs256Jwt(rsa.privateKey, rsa.kid, { aud: 'https://attacker.example/x', exp: NOW + 600 });
  const req: InboundRequest = { raw: body, headers: { authorization: `Bearer ${wrong}` }, sourceIp: '203.0.113.11' };
  const out = await verifyWebhook('google', req, { store, cfg: DEFAULT_WEBHOOK_CONFIG, endpointToken: TOKEN, now: NOW, googleJwks: async () => rsa.jwks });
  assert.equal(out.status, 401);
  assert.match(store.guardrailLog.at(-1)!.description, /audience mismatch/);
});

test('AC-0.WHK.003.x — Google valid push → 200', async () => {
  const { deps: d, req } = googleSetup();
  const out = await verifyWebhook('google', req, d);
  assert.equal(out.status, 200);
});

// ── AC-0.WHK.004.1 — Slack stale timestamp → rejected as replay BEFORE signature ─────
test('AC-0.WHK.004.1 — Slack timestamp > 5 min old → rejected as replay pre-signature', async () => {
  const { store, secret, body } = slackSetup();
  const staleTs = String(NOW - 301); // just past the 300s window
  const req: InboundRequest = { raw: body, headers: signSlackHeaders(secret, staleTs, body), sourceIp: '203.0.113.9' };
  const out = await verifyWebhook('slack', req, deps(store));
  assert.equal(out.status, 401);
  assert.match(store.guardrailLog.at(-1)!.description, /replay window/);
});

// ── AC-0.WHK.004.2 — Slack valid ts, mismatched signature → 401 + log ───────────────
test('AC-0.WHK.004.2 — Slack valid timestamp but bad signature → 401 + log', async () => {
  const { store, body, ts } = slackSetup();
  const req: InboundRequest = {
    raw: body,
    headers: { 'x-slack-request-timestamp': ts, 'x-slack-signature': 'v0=deadbeef' },
    sourceIp: '203.0.113.9',
  };
  const out = await verifyWebhook('slack', req, deps(store));
  assert.equal(out.status, 401);
  assert.equal(store.guardrailLog.at(-1)!.guardrail_type, 'prompt_injection');
});

test('AC-0.WHK.004.x — Slack valid → 200', async () => {
  const { store, req } = slackSetup();
  const out = await verifyWebhook('slack', req, deps(store));
  assert.equal(out.status, 200);
});

// ── AC-0.WHK.005.1 — parse-then-verify fails the spec (raw body before parse) ────────
test('AC-0.WHK.005.1 — parse-then-verify FAILS a genuinely-valid signature', async () => {
  const { pair } = ghlSetup();
  // A body whose re-serialisation differs from the raw bytes (extra whitespace / key order).
  const raw = Buffer.from('{ "id":"evt-ghl-1",  "type":"ContactCreate" }', 'utf8');
  assert.equal(reserialisationDiffers(raw), true, 'fixture must have non-canonical JSON');
  const sig = signEd25519(pair.privateKey, ghlSigningInput(raw));
  const good = ingress({ raw, headers: { 'x-ghl-signature': sig } });
  const bad = parseThenVerifyIngress({ raw, headers: { 'x-ghl-signature': sig } });
  const keys = [{ version: 1, value: pair.publicKeyPem }];
  assert.equal(verifyGhl(good, keys, NOW).ok, true, 'raw-first ingress verifies');
  assert.equal(verifyGhl(bad, keys, NOW).ok, false, 'parse-then-verify FAILS the same signature (the spec violation)');
});

// ── AC-0.WHK.005.2 — 4th failure/source/hour → Super-Admin alert + source identified + throttle ──
test('AC-0.WHK.005.2 — 4 failures from one source → alert, source identified, auto-throttle', async () => {
  const { store, sig } = ghlSetup();
  const tampered = Buffer.from(JSON.stringify({ id: 'x', type: 'y' }), 'utf8');
  const badReq: InboundRequest = { raw: tampered, headers: { 'x-ghl-signature': sig }, sourceIp: '198.51.100.5' };
  let last;
  for (let i = 0; i < 4; i++) last = await verifyWebhook('ghl', badReq, deps(store)); // threshold 3 → alert on 4th
  assert.equal(store.alerts.length, 1, 'exactly one alert at the 4th failure');
  assert.equal(last!.alerted, true);
  const alert = store.alerts[0]!;
  assert.equal(alert.connector, 'ghl');
  assert.match(alert.source_id, /ghl:.*:198\.51\.100\.5/, 'source identified by connector+token+IP');
  assert.equal(await store.isThrottled(alert.source_id, NOW), true, 'source auto-throttled');
});

// ── AC-0.WHK.006.1 — endpoint carries a per-deployment token ─────────────────────────
test('AC-0.WHK.006.1 — webhook URL embeds a per-deployment random token', () => {
  const token = mintEndpointToken();
  assert.equal(isValidEndpointToken(token), true);
  const path = webhookPath('slack', token);
  assert.match(path, new RegExp(`/webhooks/slack/${token}$`));
  assert.notEqual(mintEndpointToken(), mintEndpointToken(), 'tokens are per-deployment random');
});

// ── AC-0.WHK.007.1 — dual-accept rotation: both verify in-window; only new after ─────
test('AC-0.WHK.007.1 — during rotation window old AND new verify; after window only new', async () => {
  const store = new InMemoryWebhookStore();
  const oldPair = generateEd25519Pair();
  store.seedSecret({
    connector: 'ghl',
    secret_kind: SECRET_KIND.ghl_ed25519_public_key,
    secret_value: oldPair.publicKeyPem,
    secret_version: 1,
    active: true,
    rotated_at: null,
  });
  const body = Buffer.from(JSON.stringify({ id: 'evt-rot', type: 'X' }), 'utf8');
  const oldSig = signEd25519(oldPair.privateKey, ghlSigningInput(body));

  // Rotate in a new key (dual-accept window begins).
  const newPair = generateEd25519Pair();
  const rot = await rotateSecret(store, 'ghl', SECRET_KIND.ghl_ed25519_public_key, newPair.publicKeyPem, NOW);
  assert.deepEqual(rot.activeVersions, [1, 2], 'both versions active during the window');
  const newSig = signEd25519(newPair.privateKey, ghlSigningInput(body));

  // Both the old- and new-signed webhook verify during the window (distinct event ids to avoid replay).
  const oldReq: InboundRequest = { raw: body, headers: { 'x-ghl-signature': oldSig }, sourceIp: '203.0.113.7' };
  const newBody = Buffer.from(JSON.stringify({ id: 'evt-rot-2', type: 'X' }), 'utf8');
  const newSig2 = signEd25519(newPair.privateKey, ghlSigningInput(newBody));
  const newReq: InboundRequest = { raw: newBody, headers: { 'x-ghl-signature': newSig2 }, sourceIp: '203.0.113.7' };
  assert.equal((await verifyWebhook('ghl', oldReq, deps(store))).status, 200, 'old secret verifies in-window');
  assert.equal((await verifyWebhook('ghl', newReq, deps(store))).status, 200, 'new secret verifies in-window');

  // After the window: retire the old version; now only the new verifies.
  const later = NOW + DEFAULT_WEBHOOK_CONFIG.secret_rotation_window + 1;
  await retireOldVersions(store, 'ghl', SECRET_KIND.ghl_ed25519_public_key, later);
  const oldBody3 = Buffer.from(JSON.stringify({ id: 'evt-rot-3', type: 'X' }), 'utf8');
  const oldSig3 = signEd25519(oldPair.privateKey, ghlSigningInput(oldBody3));
  const oldReq3: InboundRequest = { raw: oldBody3, headers: { 'x-ghl-signature': oldSig3 }, sourceIp: '203.0.113.7' };
  assert.equal((await verifyWebhook('ghl', oldReq3, { ...deps(store), now: later })).status, 401, 'retired secret no longer verifies');
  assert.ok(store.audit.some((a) => a.action === 'webhook_secret_rotated'), 'rotation audited');
  assert.ok(store.audit.some((a) => a.action === 'webhook_secret_retired'), 'retirement audited');
});

// ── AC-0.WHK.008.1 — replayed verified event ID within window → dropped + logged ─────
test('AC-0.WHK.008.1 — verified webhook replayed within window → dropped, no re-trigger', async () => {
  const { store, req } = ghlSetup();
  const first = await verifyWebhook('ghl', req, deps(store));
  assert.equal(first.status, 200);
  const second = await verifyWebhook('ghl', req, deps(store)); // same event id, in window
  assert.equal(second.status, 200);
  assert.match(second.note, /dropped \(replay\)/);
  assert.equal(store.eventLog.filter((e) => e.event_type === 'webhook_verified').length, 1, 'only one accept — replay created no new work');
  assert.equal(store.eventLog.filter((e) => e.event_type === 'webhook_replay_dropped').length, 1);
});

// ── logic-sweep regression (ghl.ts:70) — two DISTINCT signed events with empty-string ids must NOT
//    collide as replays. `??` only coalesces null/undefined, so a body with `id: ""` used to yield
//    eventId "" for every such event → replay key `ghl::` collapses → the second genuinely-new
//    signed event is silently dropped (a #1 knowledge-loss). Each empty-id body must instead fall
//    back to its per-body signature-derived id so distinct bodies get distinct keys.
test('logic-sweep — two distinct signed GHL events with empty-string id do NOT collide as replays', async () => {
  const store = new InMemoryWebhookStore();
  const pair = generateEd25519Pair();
  store.seedSecret({
    connector: 'ghl',
    secret_kind: SECRET_KIND.ghl_ed25519_public_key,
    secret_value: pair.publicKeyPem,
    secret_version: 1,
    active: true,
    rotated_at: null,
  });
  // Two genuinely-distinct events, both carrying an empty-string id (as GHL may emit — `id` is not a
  // documented dedup field; deliveryId/webhookId are). Distinct bodies → distinct signatures.
  const bodyA = Buffer.from(JSON.stringify({ id: '', type: 'ContactCreate' }), 'utf8');
  const bodyB = Buffer.from(JSON.stringify({ id: '', type: 'OpportunityCreate' }), 'utf8');
  const sigA = signEd25519(pair.privateKey, ghlSigningInput(bodyA));
  const sigB = signEd25519(pair.privateKey, ghlSigningInput(bodyB));
  const reqA: InboundRequest = { raw: bodyA, headers: { 'x-ghl-signature': sigA }, sourceIp: '203.0.113.7' };
  const reqB: InboundRequest = { raw: bodyB, headers: { 'x-ghl-signature': sigB }, sourceIp: '203.0.113.7' };

  const first = await verifyWebhook('ghl', reqA, deps(store));
  assert.equal(first.status, 200);
  const second = await verifyWebhook('ghl', reqB, deps(store));
  assert.equal(second.status, 200);
  // Event B is a new event, NOT a replay of A — it must not be dropped.
  assert.doesNotMatch(second.note ?? '', /dropped \(replay\)/, 'distinct empty-id event B must not be treated as a replay');
  assert.equal(
    store.eventLog.filter((e) => e.event_type === 'webhook_verified').length,
    2,
    'both distinct empty-id events accepted — neither silently lost',
  );
  assert.equal(store.eventLog.filter((e) => e.event_type === 'webhook_replay_dropped').length, 0);
});

// ── AC-0.WHK.008.2 — verified flood over accept_rate_limit → throttled ──────────────
test('AC-0.WHK.008.2 — verified webhooks over accept_rate_limit → source throttled', async () => {
  const { store, secret, body } = slackSetup();
  const cfg = validateWebhookConfig({ ...DEFAULT_WEBHOOK_CONFIG, accept_rate_limit: 3 });
  // Distinct valid timestamps (all in-window) so each is a fresh verified accept, same source.
  let throttledSeen = false;
  for (let i = 0; i < 5; i++) {
    const ts = String(NOW - i); // all within the 300s window
    const req: InboundRequest = { raw: body, headers: signSlackHeaders(secret, ts, body), sourceIp: '203.0.113.9' };
    const out = await verifyWebhook('slack', req, { store, cfg, endpointToken: TOKEN, now: NOW });
    if (out.status === 429) throttledSeen = true;
  }
  assert.equal(throttledSeen, true, 'source throttled once over accept_rate_limit=3');
  assert.ok(store.eventLog.some((e) => e.event_type === 'webhook_rate_throttled'));
});

// ── AC-NFR-SEC.008.1 — invalid/absent sig → 401, logged, (past threshold) alerted, no task ──
test('AC-NFR-SEC.008.1 — unverified webhook: 401 + logged + no downstream task', async () => {
  const { store } = slackSetup();
  const req: InboundRequest = { raw: Buffer.from('{}', 'utf8'), headers: {}, sourceIp: '198.51.100.9' };
  const out = await verifyWebhook('slack', req, deps(store));
  assert.equal(out.status, 401);
  assert.equal(out.verifiedPayload, undefined);
  assert.equal(store.guardrailLog.length, 1);
  assert.equal(store.eventLog.filter((e) => e.event_type === 'webhook_verified').length, 0, 'no downstream task created');
});

// ── AC-NFR-SEC.008.2 — replayed webhook → deduplicated, does not re-trigger work ────
test('AC-NFR-SEC.008.2 — replayed Google push does not re-trigger work', async () => {
  const { deps: d, req, store } = googleSetup();
  await verifyWebhook('google', req, d);
  const again = await verifyWebhook('google', req, d);
  assert.match(again.note, /dropped \(replay\)/);
  assert.equal(store.eventLog.filter((e) => e.event_type === 'webhook_verified').length, 1);
});

// ── config validation guards (registry ranges) ─────────────────────────────────────
test('config validation rejects out-of-range values (registry ranges, #3 never silent-clamp)', () => {
  assert.throws(() => validateWebhookConfig({ ...DEFAULT_WEBHOOK_CONFIG, replay_window_seconds: 30 }), /replay_window_seconds/);
  assert.throws(() => validateWebhookConfig({ ...DEFAULT_WEBHOOK_CONFIG, replay_cache_window: 100, replay_window_seconds: 300 }), /replay_cache_window/);
  assert.throws(() => validateWebhookConfig({ ...DEFAULT_WEBHOOK_CONFIG, accept_rate_limit: 0 }), /accept_rate_limit/);
  assert.doesNotThrow(() => validateWebhookConfig(DEFAULT_WEBHOOK_CONFIG));
});
