// ISSUE-010 — one test per AC in §4 Definition of done. Proved against the InMemoryConfigStore reference
// model + the redaction/keygroup helpers (offline; the live trigger/RLS proof is results/issue-010-capstone.sql).
//
// AC map:
//   AC-7.LOG.008.1  — complete-or-fail export over range + PERM-config.* key-prefix; PERM-compliance.download_records gate
//   AC-7.LOG.008.2  — retention honours the floor (never prunes a floor-window row); the run is logged
//   AC-7.LOG.008.3  — append-only + tamper-evident (a post-hoc edit is detected)
//   AC-7.LOG.008.4  — redaction-tombstone on actor_id (row + change data retained; integrity still passes)
//   AC-7.LOG.008.5  — no credential material ever appears (a SECRET key never produces a row)
//   AC-NFR-CMP.006.1 — service_role DELETE on the sink is rejected
//   AC-NFR-CMP.006.2 — service_role in-place UPDATE on the sink is rejected
//   AC-NFR-CMP.006.3 — each of the four audit sinks carries the BEFORE UPDATE OR DELETE trigger
//   AC-NFR-SEC.003.1 — a rendered secret returns presence + last-rotated only; the value is never returned
//   AC-NFR-SEC.003.2 — a log write carrying a token/secret is redacted before the row is written

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

import {
  InMemoryConfigStore,
  DOWNLOAD_RECORDS_PERM,
  ERR_DELETE_FORBIDDEN,
  ERR_UPDATE_FORBIDDEN,
  configKeyGroup,
  KEY_NODE_MAP,
  isSecretKey,
  redactCredentialMaterial,
  containsCredentialMaterial,
  REDACTED,
  type ConfigPermNode,
} from './index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
// epoch seconds helpers for deterministic timestamps
const DAY = 24 * 3600;
const YEAR = 365 * DAY;
const T0 = 1_700_000_000; // a fixed "now"

function seedRows(store: InMemoryConfigStore, now: number) {
  // three groups so key-prefix scoping is meaningful
  return Promise.all([
    store.appendAudit({ key: 'amber_zone_threshold', old_value: 0.7, new_value: 0.75, actor_id: 'user-A' }, now), // memory
    store.appendAudit({ key: 'injection_quarantine_threshold', old_value: null, new_value: 0.9, actor_id: 'user-B' }, now), // guardrails
    store.appendAudit({ key: 'auth.oauth_enabled', old_value: false, new_value: true, actor_id: 'user-A' }, now), // auth
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.LOG.008.1 — complete-or-fail export over range + key-prefix scope + download gate
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.LOG.008.1 — export is scoped, complete-or-fail, and download-gated', async () => {
  const store = new InMemoryConfigStore();
  await seedRows(store, T0);
  const range = { from: new Date((T0 - DAY) * 1000).toISOString(), to: new Date((T0 + DAY) * 1000).toISOString() };

  // Gated: without PERM-compliance.download_records the export is REJECTED (not a silent empty file).
  await assert.rejects(
    () =>
      store.exportAudit({
        ...range,
        callerConfigPerms: ['PERM-config.memory', 'PERM-config.guardrails', 'PERM-config.auth'],
        callerPerms: [], // no download perm
      }),
    /download_records/,
    'export without the download perm must be rejected',
  );

  // Key-prefix scope: a memory-only caller (with the download perm) gets ONLY the memory-group row.
  const memOnly = await store.exportAudit({
    ...range,
    callerConfigPerms: ['PERM-config.memory'],
    callerPerms: [DOWNLOAD_RECORDS_PERM],
  });
  assert.equal(memOnly.length, 1);
  assert.equal(memOnly[0]!.key, 'amber_zone_threshold');

  // Full-scope caller gets every row in range (completeness — no silent truncation).
  const all = await store.exportAudit({
    ...range,
    callerConfigPerms: ['PERM-config.memory', 'PERM-config.guardrails', 'PERM-config.auth'],
    callerPerms: [DOWNLOAD_RECORDS_PERM],
  });
  assert.equal(all.length, 3);

  // All-or-fail: a tampered in-scope row ABORTS the whole export (never a partial file).
  store._tamperInPlace(all[0]!.id, (r) => (r.new_value = 0.99));
  await assert.rejects(
    () =>
      store.exportAudit({
        ...range,
        callerConfigPerms: ['PERM-config.memory', 'PERM-config.guardrails', 'PERM-config.auth'],
        callerPerms: [DOWNLOAD_RECORDS_PERM],
      }),
    /ABORTED|tamper/,
    'a tampered in-scope row must abort the export, not silently truncate',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.LOG.008.2 — retention honours the floor; the run is logged
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.LOG.008.2 — retention never prunes a floor-window row and logs the run', async () => {
  const store = new InMemoryConfigStore();
  const floorYears = 7; // individual_deletion_audit_years default
  // one OLD row (well past the floor) and one RECENT row (inside the floor)
  const oldTs = T0 - 8 * YEAR;
  await store.appendAudit({ key: 'amber_zone_threshold', old_value: 0.7, new_value: 0.8, actor_id: 'u1' }, oldTs);
  await store.appendAudit({ key: 'confidence_floor', old_value: 0.5, new_value: 0.55, actor_id: 'u1' }, T0);

  const result = await store.runRetention(floorYears, T0);
  assert.equal(result.pruned, 1, 'the >8y-old row is pruned');
  assert.equal(result.floorProtected, 1, 'the inside-floor row is protected');
  assert.equal(store.auditLog.length, 1, 'only the floor-protected row remains');
  assert.equal(store.auditLog[0]!.key, 'confidence_floor');
  // the run is itself logged (never silent).
  assert.equal(store.retentionRuns.length, 1);
  assert.equal(store.retentionRuns[0]!.window_applied_years, floorYears);

  // A row exactly inside the floor is NEVER pruned even on a subsequent run.
  const again = await store.runRetention(floorYears, T0 + DAY);
  assert.equal(again.pruned, 0);
  assert.equal(store.auditLog.length, 1);

  // OD-180 whitelist contract: the retention run is the ONLY sanctioned delete path. A delete attempted
  // OUTSIDE a retention run is rejected with the exact 0005 trigger message (mirrors the DB whitelist).
  const surviving = store.auditLog[0]!.id;
  assert.throws(() => store.attemptNonRetentionDelete(surviving), new RegExp(ERR_DELETE_FORBIDDEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(store.auditLog.length, 1, 'the non-retention delete did not remove the row (it was rejected)');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.LOG.008.3 — append-only + tamper-evident (a post-hoc modification is detectable)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.LOG.008.3 — a post-hoc modification of a row is detectable', async () => {
  const store = new InMemoryConfigStore();
  const row = await store.appendAudit({ key: 'price_table', old_value: null, new_value: { x: 1 }, actor_id: 'u1' }, T0);
  assert.ok(store.verifyIntegrity(row), 'a freshly appended row passes the integrity check');
  assert.ok(store.integrityHolds());

  // simulate the out-of-band edit the DB trigger would have rejected
  store._tamperInPlace(row.id, (r) => (r.new_value = { x: 999 }));
  assert.equal(store.verifyIntegrity(row), false, 'the tampered row fails the integrity check (#3)');
  assert.equal(store.integrityHolds(), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.LOG.008.4 — redaction-tombstone on actor_id; row + change data retained; integrity still passes
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.LOG.008.4 — erasure redacts actor_id but retains the change record + passes integrity', async () => {
  const store = new InMemoryConfigStore();
  const r1 = await store.appendAudit({ key: 'amber_zone_threshold', old_value: 0.7, new_value: 0.75, actor_id: 'erase-me' }, T0);
  await store.appendAudit({ key: 'price_table', old_value: null, new_value: { a: 1 }, actor_id: 'keep-me' }, T0);

  const n = await store.redactActor('erase-me', T0 + DAY);
  assert.equal(n, 1, 'exactly the erased actor’s rows are tombstoned');

  const row = store.auditLog.find((x) => x.id === r1.id)!;
  assert.equal(row.actor_id, null, 'actor attribution scrubbed');
  assert.ok(row.redacted_at, 'redacted_at set (the one-way tombstone marker)');
  // the change record is RETAINED (a config change happened here).
  assert.equal(row.key, 'amber_zone_threshold');
  assert.equal(row.old_value, 0.7);
  assert.equal(row.new_value, 0.75);
  assert.ok(row.changed_at);
  // the tombstone is the sanctioned mutation — the integrity check STILL passes (not tampering).
  assert.ok(store.verifyIntegrity(row), 'the redaction-tombstone does not fail tamper-evidence (AC-7.LOG.008.4)');
  assert.ok(store.integrityHolds());
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.LOG.008.5 — no credential material ever appears; a SECRET key never produces a row
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.LOG.008.5 — a SECRET-class change never produces an audit row; no credential material lands', async () => {
  const store = new InMemoryConfigStore();
  // A SECRET key can never be audited (it is never UI-editable — config-edit-taxonomy rule 2).
  await assert.rejects(
    () => store.appendAudit({ key: 'ANTHROPIC_API_KEY', old_value: null, new_value: 'sk-should-never-store', actor_id: 'u1' }, T0),
    /SECRET/,
    'a SECRET key must be rejected before any row is written',
  );
  await assert.rejects(
    () => store.appendAudit({ key: 'slack_webhook_url', old_value: null, new_value: 'https://hooks…', actor_id: 'u1' }, T0),
    /SECRET/,
  );
  assert.equal(store.auditLog.length, 0, 'no row was written for a SECRET key');

  // A non-secret key whose payload accidentally carries token material is scrubbed BEFORE write.
  await store.appendAudit(
    { key: 'alert_routing_rules', old_value: null, new_value: { channel: 'ops', token: 'xoxb-1234567890abcdef' }, actor_id: 'u1' },
    T0,
  );
  assert.ok(store.noCredentialMaterial(), 'no credential material survives in any row');
  const written = store.auditLog[0]!.new_value as Record<string, unknown>;
  assert.equal(written.token, REDACTED, 'the token field is redacted');
  assert.equal(written.channel, 'ops', 'non-secret detail is retained');

  // SECRET keys are also barred from config_values entirely.
  await assert.rejects(() => store.putConfigValue('OPENAI_API_KEY', 'sk-x', 'u1', T0), /SECRET/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-NFR-CMP.006.1 — service_role DELETE on the sink is rejected
// ─────────────────────────────────────────────────────────────────────────────
test('AC-NFR-CMP.006.1 — DELETE on config_audit_log is rejected (append-only)', async () => {
  // The fake models the DB append-only trigger: there is NO delete method on the port, and the trigger’s
  // exact rejection message is asserted here (the live proof runs against the trigger in the capstone).
  // Assert the sink has no app/service DELETE path (only the privileged retention prune) and that the
  // trigger's forbidding message is the one the schema binds.
  const schema = readFileSync(join(HERE, '..', '..', 'silo', 'migrations', '0001_baseline.sql'), 'utf8');
  assert.match(schema, /raise exception 'audit sink %: DELETE forbidden \(append-only\)'/, 'the baseline trigger forbids DELETE');
  // Post-OD-180 the LIVE trigger definition is 0005: a DELETE is forbidden UNLESS the transaction set
  // app.retention_prune='on' (the retention-prune whitelist). The port's DELETE message names that GUC.
  const prune = readFileSync(join(HERE, '..', '..', 'silo', 'migrations', '0005_retention_prune_whitelist.sql'), 'utf8');
  assert.match(
    prune,
    /raise exception 'audit sink %: DELETE forbidden \(append-only; retention prune must set app\.retention_prune\)'/,
    'the 0005 trigger forbids DELETE unless the retention-prune GUC is set',
  );
  assert.match(prune, /current_setting\('app\.retention_prune', true\) = 'on'/, 'the whitelist keys off app.retention_prune');
  assert.equal(
    ERR_DELETE_FORBIDDEN,
    'audit sink config_audit_log: DELETE forbidden (append-only; retention prune must set app.retention_prune)',
    'the port exposes the exact 0005 trigger message for a non-retention service_role DELETE',
  );
  // belt-and-braces: 0001c revokes delete on the sink (incl. from service_role). Post-OD-180 the retention
  // job runs in the operator/migration-owner context, not the app's service_role grant; the GUC is the
  // second, explicit, per-transaction opt-in that makes a retention delete auditable-by-construction.
  const rls = readFileSync(join(HERE, '..', '..', 'silo', 'migrations', '0001c_rls.sql'), 'utf8');
  assert.match(rls, /revoke delete on[^;]*config_audit_log[^;]*from[^;]*service_role/i, 'delete is revoked on the sink from service_role');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-NFR-CMP.006.2 — service_role in-place UPDATE on the sink is rejected
// ─────────────────────────────────────────────────────────────────────────────
test('AC-NFR-CMP.006.2 — in-place UPDATE on config_audit_log is rejected (only the tombstone is allowed)', async () => {
  const schema = readFileSync(join(HERE, '..', '..', 'silo', 'migrations', '0001_baseline.sql'), 'utf8');
  assert.match(
    schema,
    /raise exception 'audit sink %: in-place UPDATE forbidden \(append-only \/ tamper-evident\)'/,
    'the trigger forbids a non-whitelisted UPDATE',
  );
  // the ONLY permitted UPDATE on config_audit_log is the one-way redaction-tombstone (new.redacted_at set).
  assert.match(schema, /new\.redacted_at is not null and old\.redacted_at is null/, 'the sole permitted UPDATE is the redaction-tombstone');
  assert.equal(
    ERR_UPDATE_FORBIDDEN,
    'audit sink config_audit_log: in-place UPDATE forbidden (append-only / tamper-evident)',
    'the port exposes the exact trigger message for a service_role UPDATE',
  );
  // the fake proves the sanctioned tombstone is accepted while an arbitrary content edit is caught (008.3).
  const store = new InMemoryConfigStore();
  const r = await store.appendAudit({ key: 'price_table', old_value: null, new_value: { a: 1 }, actor_id: 'a' }, T0);
  await store.redactActor('a', T0 + DAY); // sanctioned
  assert.ok(store.verifyIntegrity(store.auditLog.find((x) => x.id === r.id)!));
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-NFR-CMP.006.3 — each of the four audit sinks carries the BEFORE UPDATE OR DELETE trigger
// ─────────────────────────────────────────────────────────────────────────────
test('AC-NFR-CMP.006.3 — all four audit sinks carry the enforce_audit_append_only() trigger', () => {
  const schema = readFileSync(join(HERE, '..', '..', 'silo', 'migrations', '0001_baseline.sql'), 'utf8');
  for (const sink of ['event_log', 'guardrail_log', 'access_audit', 'config_audit_log']) {
    const re = new RegExp(
      `create trigger t_append_only before update or delete on ${sink}\\s+for each row execute function enforce_audit_append_only\\(\\)`,
      'i',
    );
    assert.match(schema, re, `${sink} must carry the BEFORE UPDATE OR DELETE append-only trigger`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-NFR-SEC.003.1 — a rendered secret returns presence + last-rotated only; the value is never returned
// ─────────────────────────────────────────────────────────────────────────────
test('AC-NFR-SEC.003.1 — the secret read path returns presence + last-rotated only, never a value', async () => {
  const store = new InMemoryConfigStore();
  await store.putSecretPresence({ key: 'ANTHROPIC_API_KEY', present: true, last_rotated: new Date(T0 * 1000).toISOString() });
  await store.putSecretPresence({ key: 'OPENAI_API_KEY', present: false, last_rotated: null });

  const rendered = await store.readSecretPresence('ANTHROPIC_API_KEY');
  assert.ok(rendered);
  // exactly three fields — key, present, last_rotated — and NO value field of any name.
  assert.deepEqual(Object.keys(rendered!).sort(), ['key', 'last_rotated', 'present']);
  assert.equal(rendered!.present, true);
  assert.ok(!('value' in (rendered as object)), 'no value ever crosses the boundary');

  // last_rotated null renders as "Unknown" by the caller (the store returns null, never a fabricated date).
  const unset = await store.readSecretPresence('OPENAI_API_KEY');
  assert.equal(unset!.last_rotated, null);

  // The boot gate: a required-but-not-present secret is reported missing (blocks boot — #3).
  const missing = await store.requiredMissingSecrets(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'SUPABASE_SERVICE_KEY']);
  assert.deepEqual(missing.sort(), ['OPENAI_API_KEY', 'SUPABASE_SERVICE_KEY'], 'absent OR present=false both block boot');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-NFR-SEC.003.2 — a log write carrying a token/secret is redacted before the row is written
// ─────────────────────────────────────────────────────────────────────────────
test('AC-NFR-SEC.003.2 — a payload carrying credential material is redacted pre-write', async () => {
  // direct helper behaviour
  const scrubbed = redactCredentialMaterial({
    ok: 'plain',
    nested: { authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef' },
    api_key: 'sk-deadbeefdeadbeefdeadbeef',
    list: ['xoxb-000000000000-abcdefabcdef', 'harmless'],
  });
  assert.ok(!containsCredentialMaterial(scrubbed), 'no credential material remains after redaction');
  assert.equal((scrubbed as any).nested.authorization, REDACTED);
  assert.equal((scrubbed as any).api_key, REDACTED);
  assert.deepEqual((scrubbed as any).list, [REDACTED, 'harmless']);
  assert.equal((scrubbed as any).ok, 'plain');

  // and end-to-end through the sink
  const store = new InMemoryConfigStore();
  await store.appendAudit(
    { key: 'connector.ghl.settings', old_value: null, new_value: { access_token: 'ghp_abcdefghijklmnopqrstuvwxyz012345' }, actor_id: 'u' },
    T0,
  );
  assert.ok(store.noCredentialMaterial());
});

// logic-sweep regression (redaction.ts:67 MINOR): the high-entropy catch-all required uppercase AND
// lowercase AND digit at once, so SINGLE-CASE credentials (a lowercase-hex API key, an all-caps base32
// OAuth/TOTP token) slipped through the value scrub and landed in the audit row raw, under a benign key
// name that isSecretKey does NOT catch. Both store.ts and supabase-store.ts route through the same
// redactCredentialMaterial → looksLikeCredential, so this one helper fix covers both adapters.
test('redaction scrubs SINGLE-CASE high-entropy credential blobs (logic-sweep redaction.ts:67)', () => {
  const lowerHex = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4'; // 48-char lowercase hex
  const upperBase32 = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP7654321ABCDEFGHI'; // all-caps base32-ish, 47 chars
  // Precondition: neither matches a recognised token PREFIX and both live under a NON-secret-shaped key,
  // so the value heuristic is the only thing that can catch them.
  const scrubbed = redactCredentialMaterial({ blob: lowerHex, other: upperBase32, ok: 'plain' }) as any;
  assert.equal(scrubbed.blob, REDACTED, 'a lowercase-hex credential must be redacted');
  assert.equal(scrubbed.other, REDACTED, 'an all-caps base32 credential must be redacted');
  assert.equal(scrubbed.ok, 'plain', 'a short benign value is untouched');
  assert.ok(!containsCredentialMaterial(scrubbed), 'no single-case credential survives the scrub');
});

// ─────────────────────────────────────────────────────────────────────────────
// Supporting invariants (not a numbered AC, but load-bearing for the ones above)
// ─────────────────────────────────────────────────────────────────────────────
test('key-prefix RLS scope: readConfigValue denies a key outside the caller’s group', async () => {
  const store = new InMemoryConfigStore();
  await store.putConfigValue('amber_zone_threshold', 0.75, 'u1', T0); // memory group
  // a caller holding only PERM-config.guardrails cannot read a memory-group key
  assert.equal(await store.readConfigValue('amber_zone_threshold', ['PERM-config.guardrails']), null);
  // the owning group can
  const row = await store.readConfigValue('amber_zone_threshold', ['PERM-config.memory']);
  assert.equal(row!.value, 0.75);
});

// The three uniform-prefix families + the auth.smtp_* carve-out (config-registry §§A/B/C/N).
const PREFIX_FAMILY_EXPECT: Array<[string, ConfigPermNode]> = [
  ['auth.oauth_enabled', 'PERM-config.auth'],
  ['auth.session_ttl_minutes', 'PERM-config.auth'],
  ['webhook.replay_window_seconds', 'PERM-config.auth'],
  ['support.stale_request_minutes', 'PERM-config.auth'],
  ['auth.smtp_host', 'PERM-config.infra'], // group-N secret shape → never auth; fails closed
  ['auth.smtp_bounce_webhook', 'PERM-config.infra'],
];

test('config_key_group maps EVERY registry key to its exact node (full coverage, not a sample)', () => {
  // Every explicit key in the authoritative map resolves to its recorded node.
  for (const [key, expected] of Object.entries(KEY_NODE_MAP) as Array<[string, ConfigPermNode]>) {
    assert.equal(configKeyGroup(key), expected, `configKeyGroup('${key}') must be ${expected}`);
  }
  // Every uniform-prefix probe resolves correctly.
  for (const [key, expected] of PREFIX_FAMILY_EXPECT) {
    assert.equal(configKeyGroup(key), expected, `configKeyGroup('${key}') must be ${expected}`);
  }
  // fail-closed default (OD-181): an unmapped key is Super-Admin-only infra.
  assert.equal(configKeyGroup('totally.unknown.key'), 'PERM-config.infra');
  assert.equal(configKeyGroup('brand_new_unlisted_knob'), 'PERM-config.infra');
});

test('config_key_group corrects the 8 keys the greedy-prefix heuristic previously cross-routed', () => {
  // These 8 keys were mis-routed by the removed content-prefix heuristic (rate_/cost_/risk_/anomaly_/
  // backoff_/price_table). Each must now land on its TRUE registry node — the RLS #2 leak is closed.
  const corrected: Array<[string, ConfigPermNode]> = [
    ['rate_alert_threshold', 'PERM-config.tools'], // was guardrails (rate_)
    ['backoff_initial_ms', 'PERM-config.tools'], // was loops (backoff_)
    ['backoff_max_ms', 'PERM-config.tools'], // was loops (backoff_)
    ['backoff_multiplier', 'PERM-config.tools'], // was loops (backoff_)
    ['anomaly_check_cadence', 'PERM-config.loops'], // was guardrails (anomaly_)
    ['cost_threshold_alert_limit', 'PERM-config.observability'], // was guardrails (cost_)
    ['risk_floor', 'PERM-config.proactive'], // was guardrails (risk_)
    ['risk_thresholds', 'PERM-config.proactive'], // was guardrails (risk_)
  ];
  for (const [key, expected] of corrected) {
    assert.equal(configKeyGroup(key), expected, `${key} must now route to ${expected}`);
  }
  // price_table also moved guardrails → observability (the enshrined-wrong expectation).
  assert.equal(configKeyGroup('price_table'), 'PERM-config.observability');
});

// The authoritative group-N secret set (config-registry §N) — env-var names + auth.smtp_* dotted secrets.
const GROUP_N_SECRETS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'INNGEST_API_KEY',
  'X_INTERNAL_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_WEBHOOK_URL',
  'GOHIGHLEVEL_WEBHOOK_SECRET',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY',
  'auth.smtp_host',
  'auth.smtp_port',
  'auth.smtp_user',
  'auth.smtp_pass',
  'auth.smtp_sender',
  'auth.smtp_bounce_webhook',
];

test('isSecretKey catches EVERY group-N secret (incl. GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY + auth.smtp_*)', () => {
  for (const secret of GROUP_N_SECRETS) {
    assert.ok(isSecretKey(secret), `isSecretKey('${secret}') must be true — a group-N secret must never be audited/stored`);
  }
  // still flags generic secret-shaped payload sub-keys
  assert.ok(isSecretKey('connector.google.client_secret'));
  // …and does NOT false-positive on normal config knobs
  assert.ok(!isSecretKey('memories_injected_per_task'));
  assert.ok(!isSecretKey('price_table'));
  assert.ok(!isSecretKey('rate_alert_threshold'));
  assert.ok(!isSecretKey('auth.oauth_enabled')); // a non-smtp auth key is NOT a secret
});

// logic-sweep regression (redaction.ts:49 BLOCKER): SECRET_KEY_RE false-positived on real NON-secret
// config_values knobs that merely contain a bare `token`/`key`/`secret`/`password` segment — six §F
// tools-group knobs (token_refresh_interval_minutes etc.) are LIVE/BOOT-editable ints/bools mapped to
// PERM-config.tools in KEY_NODE_MAP, NOT secrets. The false-positive made putConfigValue AND appendAudit
// THROW for these keys (the config-admin write path could not save them at all, and no audit row could be
// produced). NO key present in KEY_NODE_MAP is ever a secret — a config_values knob by construction.
test('isSecretKey never false-positives on a real KEY_NODE_MAP config knob (logic-sweep redaction.ts:49)', () => {
  // The six token_*/*_token_* knobs the sweep pinned as false-positives.
  const NON_SECRET_TOKEN_KNOBS = [
    'token_refresh_interval_minutes',
    'token_refresh_lead_minutes',
    'token_expiry_alert_days',
    'slack_token_rotation_enabled',
    'ghl_access_token_ttl',
    'ghl_refresh_token_max_idle',
  ];
  for (const key of NON_SECRET_TOKEN_KNOBS) {
    assert.ok(
      key in KEY_NODE_MAP,
      `precondition: '${key}' must be a config_values knob in KEY_NODE_MAP`,
    );
    assert.ok(
      !isSecretKey(key),
      `isSecretKey('${key}') must be false — a config_values knob is never a secret (write/audit would throw)`,
    );
  }
  // Belt-and-braces: EVERY key in the authoritative config_values map must classify non-secret, or its
  // config-admin write path (putConfigValue) and audit path (appendAudit) break by construction.
  for (const key of Object.keys(KEY_NODE_MAP)) {
    assert.ok(!isSecretKey(key), `isSecretKey('${key}') must be false — it is a KEY_NODE_MAP config knob`);
  }
});
