// ISSUE-012 — one test per AC in §4 Definition of done. Proved against the InMemoryManagementStore reference
// model + the pure ingest / staleness / reporter / contract helpers (offline; NO live DB). The live
// ingest/staleness/rotation proofs against the real mgmt Supabase are the orchestrator's capstone
// (results/live-owed.md) — supabase-store.ts mirrors this fake 1:1 and is NOT exercised here.
//
// Every test has TEETH: it asserts the FR invariant AND a negative/counter-case (the thing that MUST NOT
// happen). The reporter→ingest→store seam, the absence-of-signal staleness detector (AF-118), the
// server-authoritative window math (AF-120), and the internal_token lifecycle are all offline-proven.
//
// AC map (§4):
//   AC-10.MGT.001.1 — one client_registry row holds identity; no app table carries client_slug
//   AC-10.MGT.001.2 — a lifecycle event transitions status + timestamps it; a bad transition is refused
//   AC-10.MGT.001.3 — internal_token is encrypted at rest (stored ≠ plaintext, round-trips)
//   AC-10.MGT.002.1 — valid-token push updates client_registry.core_version + the health store
//   AC-10.MGT.002.2 — invalid/missing token → rejected + logged + alerted (no anonymous ingest)
//   AC-10.MGT.002.3 — mgmt plane reads its own push-fed store; there is NO pull path
//   AC-10.MGT.003.1 — fleet status sources only operational metadata; a business-data field is rejected
//   AC-10.MGT.003.2 — inspect-a-client = click-through into the client deployment (railway_url), no mirror
//   AC-10.MGT.004.1 — minted token is dual-stored (encrypted mgmt copy + Railway) and authenticates a push
//   AC-10.MGT.004.2 — rotation updates both stores; a partial (Railway side fails) is surfaced, not silent
//   AC-10.MGT.004.3 — revoke → the token can no longer authenticate
//   AC-7.MGM.001.1  — the reporter snapshot carries ONLY allow-listed fields; a business field is dropped
//   AC-7.MGM.001.2  — the model is push, never pull (reporter emits; mgmt never initiates)
//   AC-7.MGM.001.3  — every push attempt AND failure is logged to the deployment-LOCAL event_log
//   AC-7.MGM.002.1  — a deployment that stops pushing flips to stale/unreachable within the window
//   AC-7.MGM.002.2  — a stale deployment raises a cross-deployment alert, never rendered healthy
//   AC-7.MGM.002.3  — the evaluator runs on an independent heartbeat; a stalled evaluator self-surfaces (AF-118)
//   AC-7.MGM.002.4  — window math is server-authoritative; a skewed reporter clock cannot look fresh (AF-120)
//   AC-7.MGM.003.1  — the health grid renders one card per deployment from pushed operational metadata
//   AC-7.MGM.003.2  — a card's click-through routes into the client deployment, not a mgmt-plane copy
//   AC-7.MGM.004.1  — a critical alert in any deployment surfaces on the cross-deployment alert surface
//   AC-7.MGM.004.2  — the CI/CD panel shows per-deployment core_version + last-push status
//   AC-7.MGM.005.1  — backup-health is visible sourced from the Management API; no business data crosses
//   AC-7.MGM.005.2  — the cost overview is labelled estimate-grade, never billed/actual
//   AC-NFR-SEC.002.1 — the push payload contains only allow-listed fields and zero business-data fields
//   AC-NFR-SEC.002.2 — an ingest without a valid internal_token is rejected, logged, AND alerted
//   AC-NFR-SEC.002.3 — see-inside-a-client = navigate into the client's own deployment under its RBAC
//   AC-NFR-INF.010.1 — an interval tick OR a significant event pushes an operational snapshot
//   AC-NFR-INF.010.2 — an ingest without a valid per-deployment token is rejected + logged + alerted
//   AC-NFR-OBS.006.1 — a last-push older than the window reads stale/unreachable + alert, never carried-green
//   AC-NFR-OBS.006.2 — staleness uses server-authoritative time on an independent heartbeat (AF-120/AF-118)
//   AC-NFR-OBS.006.3 — a frozen silo reads intentionally-quiet, not dead/failed

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryManagementStore,
  deriveKeyFromSecret,
  decryptToken,
  mintToken,
  handleIngest,
  NO_PULL_PATH,
  REJECT_NO_TOKEN,
  REJECT_INVALID_TOKEN,
  REJECT_BUSINESS_DATA,
  pushHealthSnapshot,
  evaluateLiveness,
  StalenessEvaluator,
  healthGridCard,
  crossDeploymentAlerts,
  ciCdRow,
  backupHealthCard,
  costOverviewRow,
  ManagementError,
  ERR_BAD_TRANSITION,
  OPERATIONAL_METADATA_FIELDS,
  type AlertSink,
  type IngestLogSink,
  type IngestRequest,
  type LocalEventLog,
  type IngestTransport,
  type ClientRegistryRow,
  type DeploymentHealthRow,
} from './index.ts';

// ── test fixtures ─────────────────────────────────────────────────────────────────────────────────
const KEY = deriveKeyFromSecret('issue-012-offline-reference-key');
const T0 = 1_700_000_000; // a fixed server "now" (epoch seconds)
const WINDOW = 900; // deployment_staleness_window default = 15 min

/** A recording alert sink + log sink so a test can assert a rejection was BOTH logged and alerted. */
function sinks() {
  const alerts: Array<{ kind: string; slug: string | null; detail: string }> = [];
  const logs: Array<{ level: string; event: string; slug: string | null }> = [];
  const alert: AlertSink = { raise: (a) => alerts.push({ kind: a.kind, slug: a.slug, detail: a.detail }) };
  const log: IngestLogSink = { append: (e) => logs.push({ level: e.level, event: e.event, slug: e.slug }) };
  return { alert, log, alerts, logs };
}

/** A local event_log recorder for the reporter side (the deployment's own dashboard). */
function localLog() {
  const entries: Array<{ event_type: string; level: string; detail: string }> = [];
  const log: LocalEventLog = { append: (e) => entries.push({ event_type: e.event_type, level: e.level, detail: e.detail }) };
  return { log, entries };
}

/** A store with one registered, activated client holding a known plaintext token. */
async function seeded(token = mintToken()): Promise<{ store: InMemoryManagementStore; slug: string; token: string }> {
  const store = new InMemoryManagementStore(KEY);
  const slug = 'acme';
  await store.registerClient({ client_slug: slug, client_name: 'Acme Co', railway_url: 'https://acme.up.railway.app', plaintextToken: token, now: T0 });
  await store.transitionStatus(slug, 'active', T0);
  return { store, slug, token };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FR-10.MGT.001 — client_registry + status lifecycle + encrypted internal_token
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-10.MGT.001.1 — exactly one client_registry row holds identity; client_slug is UNIQUE (no second home)', async () => {
  const { store, slug } = await seeded();
  const rows = await store.listClients();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.client_slug, slug);
  assert.equal(rows[0]!.status, 'active');
  // TEETH: a duplicate client_slug is refused — there can be only ONE home of client identity (ADR-001 §3).
  await assert.rejects(
    () => store.registerClient({ client_slug: slug, client_name: 'Impostor', plaintextToken: mintToken(), now: T0 }),
    (e: Error) => e instanceof ManagementError && e.reason === 'duplicate_slug',
  );
});

test('AC-10.MGT.001.2 — a lifecycle event transitions status + timestamps it; an illegal jump is refused', async () => {
  const { store, slug } = await seeded();
  const off = await store.transitionStatus(slug, 'offboarding', T0 + 10);
  assert.equal(off.status, 'offboarding');
  assert.equal(off.offboarding_initiated_at, new Date((T0 + 10) * 1000).toISOString()); // timestamped
  const frozen = await store.transitionStatus(slug, 'frozen', T0 + 20);
  assert.equal(frozen.status, 'frozen');
  assert.equal(frozen.offboarding_at, new Date((T0 + 20) * 1000).toISOString());
  // TEETH: status can never drift silently — a non-allowed transition (initialising direct→frozen) is refused.
  const fresh = await store.registerClient({ client_slug: 'beta', client_name: 'Beta', plaintextToken: mintToken(), now: T0 });
  assert.equal(fresh.status, 'initialising');
  await assert.rejects(
    () => store.transitionStatus('beta', 'frozen', T0),
    (e: Error) => e instanceof ManagementError && e.reason === ERR_BAD_TRANSITION,
  );
});

test('AC-10.MGT.001.3 — internal_token is encrypted at rest (stored ≠ plaintext; round-trips; no surface leak)', async () => {
  const { store, slug, token } = await seeded();
  const stored = store._storedToken(slug)!;
  assert.ok(stored, 'a stored (encrypted) token exists');
  // TEETH: the at-rest value is NOT the plaintext anywhere in the record …
  assert.notEqual(stored.ciphertext, token);
  assert.ok(!JSON.stringify(stored).includes(token), 'the plaintext appears nowhere in the stored record');
  // … yet it authentically round-trips under the key (real AEAD, not a fake).
  assert.equal(decryptToken(stored, KEY), token);
  // … and a wrong key cannot recover it (authenticated encryption fails loud, never mis-decrypts).
  assert.throws(() => decryptToken(stored, deriveKeyFromSecret('wrong-key')));
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FR-10.MGT.002 — the ingest endpoint (bearer auth + write + no-pull)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-10.MGT.002.1 — a valid-token push updates client_registry.core_version + the health store', async () => {
  const { store, slug, token } = await seeded();
  const { alert, log } = sinks();
  const req: IngestRequest = { bearer: token, payload: { core_version: '1.4.0', health_score: 0.92, queue_depth: 3 }, delivery_id: 'd-1' };
  const out = await handleIngest(req, store, { alert, log }, T0 + 5);
  assert.equal(out.ok, true);
  // registry.core_version updated …
  assert.equal((await store.getClientBySlug(slug))!.core_version, '1.4.0');
  // … and deployment_health upserted with the pushed operational metadata.
  const h = (await store.getHealth(slug))!;
  assert.equal(h.core_version, '1.4.0');
  assert.equal(h.health_score, 0.92);
  assert.equal(h.queue_depth, 3);
  // TEETH: the push NEVER moves server-authoritative status (OD-162) — it stays 'active', not reporter-set.
  assert.equal((await store.getClientBySlug(slug))!.status, 'active');
});

test('AC-10.MGT.002.2 — an invalid/missing token push is rejected + logged + alerted (no anonymous ingest)', async () => {
  const { store } = await seeded();
  // (a) absent token → 401, logged, alerted, and NOTHING written.
  {
    const { alert, log, alerts, logs } = sinks();
    const out = await handleIngest({ bearer: null, payload: { health_score: 1 }, delivery_id: 'd-anon' }, store, { alert, log }, T0);
    assert.equal(out.ok, false);
    assert.equal((out as { status: number }).status, 401);
    assert.equal((out as { reason: string }).reason, REJECT_NO_TOKEN);
    assert.ok(logs.some((l) => l.event === 'ingest.reject.no_token'), 'the rejection is LOGGED');
    assert.ok(alerts.some((a) => a.kind === 'ingest_unauthenticated'), 'the rejection is ALERTED');
  }
  // (b) a forged/invalid token → 401 likewise; and no health row was ever created.
  {
    const { alert, log, alerts, logs } = sinks();
    const out = await handleIngest({ bearer: 'it_forged', payload: { health_score: 1 }, delivery_id: 'd-forged' }, store, { alert, log }, T0);
    assert.equal(out.ok, false);
    assert.equal((out as { reason: string }).reason, REJECT_INVALID_TOKEN);
    assert.ok(logs.some((l) => l.event === 'ingest.reject.invalid_token'));
    assert.ok(alerts.some((a) => a.kind === 'ingest_invalid_token'));
  }
  // TEETH: neither rejected push left a trace in the health store — no anonymous ingest ever lands.
  assert.equal((await store.listHealth()).length, 0);
});

test('AC-10.MGT.002.3 — the mgmt plane reads its own push-fed store; there is NO pull path', async () => {
  const { store, slug, token } = await seeded();
  const { alert, log } = sinks();
  await handleIngest({ bearer: token, payload: { health_score: 0.5 }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  // The plane answers "what is this deployment's status?" from its OWN store, never by calling the client.
  assert.equal((await store.getHealth(slug))!.health_score, 0.5);
  // TEETH: the superseded pull reference is documented as retired — the module exposes no client-fetch path.
  assert.match(NO_PULL_PATH.supersededReference, /L1170-1190/);
  assert.match(NO_PULL_PATH.rule, /push-only/);
  assert.equal(typeof (handleIngest as unknown as Record<string, unknown>)['pull'], 'undefined');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FR-10.MGT.003 — push-only; a map, not a warehouse
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-10.MGT.003.1 — fleet status sources ONLY operational metadata; a business-data field is rejected at the boundary', async () => {
  const { store, token } = await seeded();
  const { alert, log, alerts, logs } = sinks();
  // A rogue reporter smuggles business data (memory text + a customer email) alongside a legit field.
  const rogue = { health_score: 0.9, memory_text: 'client secret', customer_email: 'a@b.com' } as unknown as Record<string, unknown>;
  const out = await handleIngest({ bearer: token, payload: rogue, delivery_id: 'd-rogue' }, store, { alert, log }, T0);
  assert.equal(out.ok, false);
  assert.equal((out as { status: number }).status, 400);
  assert.equal((out as { reason: string }).reason, REJECT_BUSINESS_DATA);
  // It is rejected LOUD (logged + alerted), never silently dropped-and-accepted.
  assert.ok(logs.some((l) => l.event === 'ingest.reject.business_data'));
  assert.ok(alerts.some((a) => a.kind === 'boundary_business_data'));
  // TEETH: NOTHING landed — not even the one legit field on that push. The whole business-tainted push is refused.
  assert.equal((await store.listHealth()).length, 0);
});

test('AC-10.MGT.003.2 — inspect-a-client is a click-through into the client deployment, not a mgmt-plane mirror', async () => {
  const { store, slug } = await seeded();
  const registry = (await store.getClientBySlug(slug))!;
  const health = await store.getHealth(slug);
  const card = healthGridCard(registry, health, evaluateLiveness(registry, health, T0, WINDOW));
  // The click-through route is the CLIENT's own deployment URL (its RBAC governs it), never a mgmt copy.
  assert.equal(card.click_through_url, 'https://acme.up.railway.app');
  // TEETH: the card carries no business-data field — only operational metadata keys are present.
  const cardKeys = Object.keys(card);
  const businessLeak = cardKeys.filter((k) => /memory|entity|message|email|content|secret/i.test(k));
  assert.deepEqual(businessLeak, []);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FR-10.MGT.004 — internal_token lifecycle (mint, dual-store, rotate, revoke)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-10.MGT.004.1 — a minted token is dual-stored (encrypted mgmt copy) and authenticates the push', async () => {
  const { store, slug, token } = await seeded();
  // The mgmt-DB copy is encrypted (the Railway env copy is the plaintext the deployment holds) …
  assert.equal(decryptToken(store._storedToken(slug)!, KEY), token);
  // … and that same token authenticates an ingest push.
  const client = await store.authenticate(token);
  assert.equal(client!.client_slug, slug);
  // TEETH: a token that was never minted for any client authenticates NOBODY.
  assert.equal(await store.authenticate(mintToken()), null);
});

test('AC-10.MGT.004.2 — rotation updates both stores; a partial (Railway side fails) is SURFACED, not silent', async () => {
  const { store, slug, token } = await seeded();
  // (a) happy path: the Railway-side dual-update succeeds → ok, and the OLD token no longer authenticates.
  let railwayToken: string | null = null;
  const okResult = await store.rotateToken(slug, async (t) => { railwayToken = t; }, T0 + 100);
  assert.equal(okResult.ok, true);
  assert.equal(await store.authenticate(token), null); // old token retired
  assert.ok(railwayToken, 'the Railway side received the new token');
  const c = await store.authenticate(railwayToken!);
  assert.equal(c!.client_slug, slug); // new token authenticates — both stores agree
  // (b) TEETH: if the Railway side THROWS, the rotation is a PARTIAL and is surfaced (ok:false), never
  //     reported as success — push auth must never silently break (AC-10.MGT.004.2).
  const partial = await store.rotateToken(slug, async () => { throw new Error('railway env write failed'); }, T0 + 200);
  assert.equal(partial.ok, false);
  assert.match(partial.detail, /partial/i);
});

test('AC-10.MGT.004.3 — a revoked token can no longer authenticate', async () => {
  const { store, slug, token } = await seeded();
  assert.ok(await store.authenticate(token)); // authenticates before revoke
  await store.revokeToken(slug, T0 + 50);
  // TEETH: the once-valid token is now inert — a torn-down deployment cannot keep pushing.
  assert.equal(await store.authenticate(token), null);
  // and an ingest with the revoked token is rejected as invalid.
  const { alert, log } = sinks();
  const out = await handleIngest({ bearer: token, payload: { health_score: 1 }, delivery_id: 'd-rev' }, store, { alert, log }, T0 + 60);
  assert.equal(out.ok, false);
  assert.equal((out as { reason: string }).reason, REJECT_INVALID_TOKEN);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FR-7.MGM.001 — the outbound health-reporter (allow-list at source + local logging + push-not-pull)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-7.MGM.001.1 — the reporter snapshot carries ONLY allow-listed fields; a business-data field is dropped before send', async () => {
  const { token } = await seeded();
  const { log, entries } = localLog();
  let sent: Record<string, unknown> | null = null;
  const transport: IngestTransport = { post: async (b) => { sent = b.payload as Record<string, unknown>; return { accepted: true, detail: 'ok' }; } };
  const raw = { health_score: 0.8, queue_depth: 2, memory_text: 'client business content', customer_ssn: '000-00-0000' };
  const out = await pushHealthSnapshot(raw, { bearer: token, push_interval_s: 30 }, transport, log, 'interval', T0);
  assert.equal(out.accepted, true);
  // TEETH: the business-data keys NEVER left the silo — the transmitted payload has only operational keys.
  assert.ok(sent, 'a payload was sent');
  const sentKeys = Object.keys(sent!);
  assert.ok(!sentKeys.includes('memory_text') && !sentKeys.includes('customer_ssn'), 'business data was dropped, not sent');
  assert.ok(sentKeys.every((k) => (OPERATIONAL_METADATA_FIELDS as readonly string[]).includes(k)));
  // and the drop is recorded locally (visible on the deployment's own dashboard).
  assert.ok(entries.some((e) => /dropped non-operational field/.test(e.detail)));
});

test('AC-7.MGM.001.2 — the model is push, never pull (the reporter emits; the mgmt plane never initiates)', async () => {
  const { token } = await seeded();
  const { log } = localLog();
  let posted = false;
  const transport: IngestTransport = { post: async () => { posted = true; return { accepted: true, detail: 'ok' }; } };
  await pushHealthSnapshot({ health_score: 1 }, { bearer: token, push_interval_s: 30 }, transport, log, 'event', T0);
  assert.equal(posted, true); // the deployment PUSHED
  // TEETH: the architectural rule the whole seam rests on — the plane reads its store, never calls a client.
  assert.match(NO_PULL_PATH.rule, /never calls a client endpoint/i);
});

test('AC-7.MGM.001.3 — every push attempt AND failure is logged to the deployment-LOCAL event_log', async () => {
  const { token } = await seeded();
  // (a) an UNREACHABLE management plane (transport throws) — the attempt AND the failure are both logged locally.
  {
    const { log, entries } = localLog();
    const transport: IngestTransport = { post: async () => { throw new Error('connection refused'); } };
    const out = await pushHealthSnapshot({ health_score: 1 }, { bearer: token, push_interval_s: 30 }, transport, log, 'interval', T0);
    assert.equal(out.accepted, false);
    assert.ok(entries.some((e) => e.event_type === 'health_push.attempt'), 'the attempt is logged');
    assert.ok(entries.some((e) => e.event_type === 'health_push.failure' && e.level === 'error'), 'the failure is logged (surfaced on OUR dashboard)');
  }
  // (b) TEETH: a management-plane REJECTION (accepted:false) is ALSO logged as a failure — not swallowed.
  {
    const { log, entries } = localLog();
    const transport: IngestTransport = { post: async () => ({ accepted: false, detail: 'token rotated away' }) };
    const out = await pushHealthSnapshot({ health_score: 1 }, { bearer: token, push_interval_s: 30 }, transport, log, 'interval', T0);
    assert.equal(out.accepted, false);
    assert.ok(entries.some((e) => e.event_type === 'health_push.failure'), 'a rejection surfaces locally, never invisibly');
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FR-7.MGM.002 — push staleness (stale, not silently green) — the #3 posture
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-7.MGM.002.1 — a deployment that stops pushing flips to stale/unreachable within the window', async () => {
  const { store, slug, token } = await seeded();
  const { alert, log } = sinks();
  await handleIngest({ bearer: token, payload: { health_score: 1 }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  const registry = (await store.getClientBySlug(slug))!;
  const health = await store.getHealth(slug);
  // Just inside the window → still fresh.
  assert.equal(evaluateLiveness(registry, health, T0 + WINDOW - 1, WINDOW).liveness, 'fresh');
  // TEETH: once the last push is older than the window, it is NO LONGER fresh — it flips stale, then unreachable.
  assert.equal(evaluateLiveness(registry, health, T0 + WINDOW + 1, WINDOW).liveness, 'stale');
  assert.equal(evaluateLiveness(registry, health, T0 + WINDOW * 2 + 1, WINDOW).liveness, 'unreachable');
});

test('AC-7.MGM.002.2 — a stale deployment raises a cross-deployment alert; it is never rendered healthy', async () => {
  const { store, slug, token } = await seeded();
  const { alert, log } = sinks();
  await handleIngest({ bearer: token, payload: { health_score: 1 }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  const registry = (await store.getClientBySlug(slug))!;
  const health = await store.getHealth(slug);
  const stale = evaluateLiveness(registry, health, T0 + WINDOW + 100, WINDOW);
  assert.equal(stale.alert, true); // an alert IS raised
  // and the cross-deployment alert surface picks it up.
  const alerts = crossDeploymentAlerts([{ health, liveness: stale }]);
  assert.ok(alerts.some((a) => a.kind === 'stale'));
  // TEETH: a stale card must not read as the last-known-green — a never-reported deployment likewise alerts.
  assert.notEqual(stale.liveness, 'fresh');
  const neverReported = evaluateLiveness(registry, null, T0 + WINDOW + 100, WINDOW);
  assert.equal(neverReported.liveness, 'never-reported');
  assert.equal(neverReported.alert, true); // absence of any signal is itself surfaced, not a phantom green
});

test('AC-7.MGM.002.3 — the evaluator runs on an independent heartbeat; a stalled evaluator self-surfaces (AF-118)', async () => {
  const { store, slug, token } = await seeded();
  const { alert, log } = sinks();
  await handleIngest({ bearer: token, payload: { health_score: 1 }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  const registry = (await store.getClientBySlug(slug))!;
  const health = await store.getHealth(slug);
  const evalr = new StalenessEvaluator();
  const HB = 120; // evaluator's own heartbeat window
  // Before it ever runs, the evaluator itself reads NOT-alive (a dark detector is a surfaced meta-condition).
  assert.equal(evalr.evaluatorLiveness(T0, HB).alive, false);
  assert.equal(evalr.evaluatorLiveness(T0, HB).alert, true);
  // After a sweep, it reads alive; the sweep records its own heartbeat.
  const { sweep } = evalr.sweep([{ registry, health }], T0, WINDOW);
  assert.equal(sweep.evaluated, 1);
  assert.equal(evalr.evaluatorLiveness(T0 + HB - 1, HB).alive, true);
  // TEETH: if the evaluator then STOPS sweeping past its own heartbeat window, THAT is surfaced (meta-#3) —
  //        the stale-detector cannot go dark unnoticed.
  const stalled = evalr.evaluatorLiveness(T0 + HB + 1, HB);
  assert.equal(stalled.alive, false);
  assert.equal(stalled.alert, true);
  assert.match(stalled.detail, /AF-118/);
});

test('AC-7.MGM.002.4 — window math is server-authoritative; a skewed reporter clock cannot look fresh (AF-120)', async () => {
  const { store, slug, token } = await seeded();
  const { alert, log } = sinks();
  // A reporter with a FAST clock tries to assert a future last_migrated_at — but last_push_at is stamped by
  // the STORE at ingest on SERVER time, not by anything in the payload.
  await handleIngest({ bearer: token, payload: { last_migrated_at: new Date((T0 + 10_000) * 1000).toISOString() }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  const health = (await store.getHealth(slug))!;
  assert.equal(health.last_push_at, new Date(T0 * 1000).toISOString()); // SERVER time, not the reporter's +10000s
  const registry = (await store.getClientBySlug(slug))!;
  // TEETH: evaluated well past the window on server time, the deployment reads STALE — the reporter's fast
  //        clock (and its future-dated payload field) cannot make a dead deployment look fresh.
  const card = evaluateLiveness(registry, health, T0 + WINDOW + 500, WINDOW);
  assert.equal(card.liveness, 'stale');
  assert.equal(card.age_seconds, WINDOW + 500); // measured from the SERVER-stamped last_push_at only
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FR-7.MGM.003 — deployment health grid (read contract)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-7.MGM.003.1 — the health grid renders one card per deployment from pushed operational metadata', async () => {
  const store = new InMemoryManagementStore(KEY);
  for (const [slug, name] of [['acme', 'Acme'], ['beta', 'Beta']] as const) {
    await store.registerClient({ client_slug: slug, client_name: name, railway_url: `https://${slug}.app`, plaintextToken: mintToken(), now: T0 });
    await store.transitionStatus(slug, 'active', T0);
  }
  const cards = [];
  for (const r of await store.listClients()) {
    const h = await store.getHealth(r.client_slug);
    cards.push(healthGridCard(r, h, evaluateLiveness(r, h, T0, WINDOW)));
  }
  // One card per deployment.
  assert.equal(cards.length, 2);
  assert.deepEqual(new Set(cards.map((c) => c.client_slug)), new Set(['acme', 'beta']));
  // TEETH: a deployment that never pushed still renders (as never-reported), never silently vanishes from the grid.
  assert.ok(cards.every((c) => c.liveness === 'never-reported'));
  assert.ok(cards.every((c) => c.health_score === null)); // no invented health for an un-pushed deployment
});

test('AC-7.MGM.003.2 — a card click-through routes into the client deployment, not a mgmt-plane copy', async () => {
  const { store, slug } = await seeded();
  const r = (await store.getClientBySlug(slug))!;
  const card = healthGridCard(r, await store.getHealth(slug), evaluateLiveness(r, null, T0, WINDOW));
  assert.equal(card.click_through_url, r.railway_url); // routes to the client's own deployment
  // TEETH: a client with NO railway_url has no fabricated mgmt-plane destination — the route is null, not a mirror.
  await store.registerClient({ client_slug: 'nourl', client_name: 'NoUrl', railway_url: null, plaintextToken: mintToken(), now: T0 });
  const r2 = (await store.getClientBySlug('nourl'))!;
  const card2 = healthGridCard(r2, null, evaluateLiveness(r2, null, T0, WINDOW));
  assert.equal(card2.click_through_url, null);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FR-7.MGM.004 — cross-deployment alerts + CI/CD status
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-7.MGM.004.1 — a critical alert in any deployment surfaces on the cross-deployment alert surface', async () => {
  const { store, slug, token } = await seeded();
  const { alert, log } = sinks();
  await handleIngest({ bearer: token, payload: { alert_counts: { critical: 2, warning: 1 } }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  const r = (await store.getClientBySlug(slug))!;
  const h = await store.getHealth(slug);
  const alerts = crossDeploymentAlerts([{ health: h, liveness: evaluateLiveness(r, h, T0, WINDOW) }]);
  assert.ok(alerts.some((a) => a.kind === 'critical' && a.count === 2 && a.client_slug === slug));
  // TEETH: a deployment with ZERO alerts contributes nothing (no phantom alert) — the surface is not padded.
  const { store: s2, slug: s2slug, token: t2 } = await seeded();
  await handleIngest({ bearer: t2, payload: { alert_counts: {} }, delivery_id: 'd-2' }, s2, sinks(), T0);
  const r2 = (await s2.getClientBySlug(s2slug))!;
  const h2 = await s2.getHealth(s2slug);
  const alerts2 = crossDeploymentAlerts([{ health: h2, liveness: evaluateLiveness(r2, h2, T0, WINDOW) }]);
  assert.equal(alerts2.length, 0);
});

test('AC-7.MGM.004.2 — the CI/CD panel shows per-deployment core_version + last-push status', async () => {
  const { store, slug, token } = await seeded();
  const { alert, log } = sinks();
  await handleIngest({ bearer: token, payload: { core_version: '2.0.1', plugin_version: 'p-9', last_migrated_at: '2026-01-01T00:00:00.000Z' }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  const r = (await store.getClientBySlug(slug))!;
  const h = await store.getHealth(slug);
  const fresh = ciCdRow(r, h, evaluateLiveness(r, h, T0 + 10, WINDOW));
  assert.equal(fresh.core_version, '2.0.1');
  assert.equal(fresh.plugin_version, 'p-9');
  assert.equal(fresh.push_failing, false); // a fresh deployment is not push-failing
  // TEETH: once the deployment goes stale, the SAME CI/CD row reports push_failing — last-push status is real,
  //        not a static "green" carried forward.
  const stale = ciCdRow(r, h, evaluateLiveness(r, h, T0 + WINDOW + 100, WINDOW));
  assert.equal(stale.push_failing, true);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FR-7.MGM.005 — backup-health + estimate-grade cost overview
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-7.MGM.005.1 — backup-health is visible, sourced from the Management API; no business data crosses', async () => {
  const { store, slug, token } = await seeded();
  const { alert, log } = sinks();
  await handleIngest({ bearer: token, payload: { backup_health: { last_backup_at: '2026-07-01T00:00:00.000Z', status: 'ok' } }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  const r = (await store.getClientBySlug(slug))!;
  const card = backupHealthCard(r, await store.getHealth(slug));
  assert.equal(card.source, 'supabase-management-api'); // sourced from the infra-plane Management API
  assert.deepEqual(card.backup_health, { last_backup_at: '2026-07-01T00:00:00.000Z', status: 'ok' });
  // TEETH: a deployment that pushed no backup-health shows null, never a fabricated "healthy" default.
  await store.registerClient({ client_slug: 'nobkp', client_name: 'NoBkp', plaintextToken: mintToken(), now: T0 });
  const card2 = backupHealthCard((await store.getClientBySlug('nobkp'))!, null);
  assert.equal(card2.backup_health, null);
});

test('AC-7.MGM.005.2 — the cost overview is labelled estimate-grade, never billed/actual', async () => {
  const { store, slug, token } = await seeded();
  const { alert, log } = sinks();
  await handleIngest({ bearer: token, payload: { cost_to_date: 1234.5 }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  const r = (await store.getClientBySlug(slug))!;
  const row = costOverviewRow(r, await store.getHealth(slug));
  assert.equal(row.cost_to_date, 1234.5);
  // TEETH: the grade is ALWAYS 'estimate' (ADR-003) — a cost figure can never be presented as billed/actual.
  assert.equal(row.grade, 'estimate');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// NFR-SEC.002 — the management-plane boundary
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-NFR-SEC.002.1 — the push payload contains only allow-listed fields and zero business-data fields', async () => {
  const { store, token } = await seeded();
  // A clean, fully-operational payload is accepted …
  const clean = Object.fromEntries(OPERATIONAL_METADATA_FIELDS.map((f) => [f, f === 'alert_counts' || f === 'connector_rollup' || f === 'backup_health' ? {} : f === 'log_write_failing' ? false : f.includes('version') || f.includes('migrated') ? 'x' : 1]));
  const ok = await handleIngest({ bearer: token, payload: clean, delivery_id: 'd-clean' }, store, sinks(), T0);
  assert.equal(ok.ok, true);
  // TEETH: adding a SINGLE business-data field to an otherwise-clean payload flips accept → reject.
  const tainted = { ...clean, entity_content: 'business data' };
  const rej = await handleIngest({ bearer: token, payload: tainted, delivery_id: 'd-tainted' }, store, sinks(), T0);
  assert.equal(rej.ok, false);
  assert.equal((rej as { reason: string }).reason, REJECT_BUSINESS_DATA);
});

test('AC-NFR-SEC.002.2 — an ingest without a valid internal_token is rejected, logged, AND alerted', async () => {
  const { store } = await seeded();
  const { alert, log, alerts, logs } = sinks();
  const out = await handleIngest({ bearer: 'it_not_a_real_token', payload: { health_score: 1 }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  assert.equal(out.ok, false);
  // All three of the three-non-negotiables posture: rejected (#2), logged + alerted (#3, never silent).
  assert.ok(logs.length > 0, 'logged');
  assert.ok(alerts.length > 0, 'alerted');
  // TEETH: a VALID token on the same store is accepted — the rejection is specific to the bad credential,
  //        not a blanket outage.
  const { token } = await seeded();
  const store2 = (await seeded(token)).store;
  const good = await handleIngest({ bearer: token, payload: { health_score: 1 }, delivery_id: 'd-2' }, store2, sinks(), T0);
  assert.equal(good.ok, true);
});

test('AC-NFR-SEC.002.3 — see-inside-a-client navigates into the client deployment under its own RBAC (no mirror)', async () => {
  const { store, slug } = await seeded();
  const r = (await store.getClientBySlug(slug))!;
  const card = healthGridCard(r, await store.getHealth(slug), evaluateLiveness(r, null, T0, WINDOW));
  // The only route "inside" is the client's own deployment URL — the mgmt plane holds no business-data mirror.
  assert.equal(card.click_through_url, r.railway_url);
  // TEETH: the mgmt store exposes no method that returns client business data — getHealth returns operational
  //        metadata only, and the health row's keys are exactly the operational set (+ mgmt-owned bookkeeping).
  const h = (await (async () => { await store.transitionStatus(slug, 'active', T0); return store.getHealth(slug); })());
  const bookkeeping = new Set(['client_slug', 'last_push_at', 'updated_at']);
  if (h) {
    for (const k of Object.keys(h)) {
      assert.ok((OPERATIONAL_METADATA_FIELDS as readonly string[]).includes(k) || bookkeeping.has(k), `health field ${k} is operational or bookkeeping, never business data`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// NFR-INF.010 — health-reporter push + internal_token-authed ingest
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-NFR-INF.010.1 — an interval tick OR a significant event pushes an operational snapshot', async () => {
  const { token } = await seeded();
  const { log } = localLog();
  const triggers: string[] = [];
  const transport: IngestTransport = { post: async () => ({ accepted: true, detail: 'ok' }) };
  const a = await pushHealthSnapshot({ health_score: 1 }, { bearer: token, push_interval_s: 30 }, transport, log, 'interval', T0);
  const b = await pushHealthSnapshot({ health_score: 1 }, { bearer: token, push_interval_s: 30 }, transport, log, 'event', T0 + 5);
  triggers.push(a.trigger, b.trigger);
  // Both cadences fire a push — the model is interval AND event-driven (NFR-INF.010).
  assert.deepEqual(triggers, ['interval', 'event']);
  assert.ok(a.attempted && b.attempted);
  // TEETH: the two pushes carry DISTINCT delivery ids, so an interval push and an event push never collide
  //        into one idempotency slot (each is its own delivery).
  assert.notEqual(a.delivery_id, b.delivery_id);
});

test('AC-NFR-INF.010.2 — an ingest without a valid per-deployment token is rejected + logged + alerted', async () => {
  const { store } = await seeded();
  const { alert, log, alerts, logs } = sinks();
  const out = await handleIngest({ bearer: null, payload: { health_score: 1 }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  assert.equal(out.ok, false);
  assert.equal((out as { status: number }).status, 401);
  assert.ok(logs.some((l) => l.level === 'warn'));
  assert.ok(alerts.length > 0);
  // TEETH: idempotency does not rescue an unauthenticated push — re-sending the same delivery_id is still rejected.
  const retry = await handleIngest({ bearer: null, payload: { health_score: 1 }, delivery_id: 'd-1' }, store, sinks(), T0 + 1);
  assert.equal(retry.ok, false);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// NFR-OBS.006 — management-plane staleness (server-authoritative, frozen ≠ dead)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-NFR-OBS.006.1 — a last-push older than the window reads stale/unreachable + alert, never carried-green', async () => {
  const { store, slug, token } = await seeded();
  const { alert, log } = sinks();
  await handleIngest({ bearer: token, payload: { health_score: 0.99 }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  const r = (await store.getClientBySlug(slug))!;
  const h = await store.getHealth(slug);
  const card = evaluateLiveness(r, h, T0 + WINDOW + 1, WINDOW);
  // TEETH: despite the last snapshot being a perfect 0.99 health_score, once it ages past the window the card
  //        does NOT carry that green forward — it reads stale and alerts.
  assert.equal(card.liveness, 'stale');
  assert.equal(card.alert, true);
  assert.equal(h!.health_score, 0.99); // the stored value is fine; freshness is what failed
});

test('AC-NFR-OBS.006.2 — staleness uses server-authoritative time on an independent heartbeat (AF-120/AF-118)', async () => {
  const { store, slug, token } = await seeded();
  const { alert, log } = sinks();
  await handleIngest({ bearer: token, payload: { health_score: 1 }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  const r = (await store.getClientBySlug(slug))!;
  const h = (await store.getHealth(slug))!;
  // age is computed purely from serverNow − store-stamped last_push_at.
  const c1 = evaluateLiveness(r, h, T0 + 300, WINDOW);
  assert.equal(c1.age_seconds, 300);
  // TEETH: the same store row evaluated at TWO different server times yields two different ages from the ONE
  //        server-stamped timestamp — no reporter clock enters the math (a reporter clock is never a parameter).
  const c2 = evaluateLiveness(r, h, T0 + 600, WINDOW);
  assert.equal(c2.age_seconds, 600);
  assert.notEqual(c1.age_seconds, c2.age_seconds);
});

test('AC-NFR-OBS.006.3 — a frozen silo reads intentionally-quiet, not dead/failed', async () => {
  const { store, slug, token } = await seeded();
  const { alert, log } = sinks();
  await handleIngest({ bearer: token, payload: { health_score: 1 }, delivery_id: 'd-1' }, store, { alert, log }, T0);
  const active = (await store.getClientBySlug(slug))!;
  const h = await store.getHealth(slug);
  // While active, a long-quiet silo alerts (unreachable) …
  const activeCard = evaluateLiveness(active, h, T0 + WINDOW * 5, WINDOW);
  assert.equal(activeCard.alert, true);
  // … but once server-authoritatively transitioned to frozen, the SAME long silence reads frozen-quiet, no alert.
  await store.transitionStatus(slug, 'frozen', T0 + 100);
  const frozen = (await store.getClientBySlug(slug))!;
  const frozenCard = evaluateLiveness(frozen, h, T0 + WINDOW * 5, WINDOW);
  assert.equal(frozenCard.liveness, 'frozen-quiet');
  assert.equal(frozenCard.alert, false); // intentionally quiet, NOT a dead-deployment alert
  // TEETH: frozen ≠ dead reads status from the REGISTRY (server-authoritative), never a reporter-asserted value.
  assert.equal(frozenCard.status, 'frozen');
});
