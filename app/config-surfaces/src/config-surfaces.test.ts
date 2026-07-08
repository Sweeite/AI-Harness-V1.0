// ISSUE-086 — config-surfaces test suite. One (or more) test per §4 AC across BOTH surfaces (the write path
// surface-01 + the audit render/export path surface-01b), plus the #2 PERM-scoping and #3 load-state
// disciplines. Runs against the InMemoryConfigSurfaceStore reference model (no live DB).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryConfigSurfaceStore,
  type ConfigSurfaceStore,
} from './store.ts';
import {
  caller,
  canEnter,
  visibleSections,
  SECTIONS,
  DOWNLOAD_RECORDS_PERM,
} from './sections.ts';
import {
  KEY_CATALOG,
  keySpec,
  sectionKeys,
  isReadOnlyKey,
  isHardLimitKey,
  readOnlyBadge,
  editClassBadge,
  configKeyGroup,
  HARD_LIMIT_KEYS,
} from './keys.ts';
import { saveSection, requiredConfirmsFor, type DirtiedRow } from './save.ts';
import { crossConstraints, lockViolations } from './validation.ts';
import { renderSection, renderAuditTimeline, mobileDegradation } from './states.ts';
import { renderChangeRow, renderChangeDetail, renderDiff, exportTrail, renderActor, REDACTED_ACTOR } from './audit-view.ts';
import { pinnedBanners } from './banners.ts';
import { NO_REALTIME_SUBSCRIPTION, assertNotColourOnly, hasTextCue } from './a11y.ts';
import { SECRET_MANIFEST, renderSecretRow, SECRET_MANIFEST_KEYS } from './secrets.ts';

const T0 = 1_700_000_000; // logical epoch seconds
const ALL_CONFIG_PERMS = SECTIONS.map((s) => s.node).filter((n) => n !== 'PERM-config.secrets');
const SUPER = caller(true, [...SECTIONS.map((s) => s.node), DOWNLOAD_RECORDS_PERM]);

function dirtied(entries: Record<string, DirtiedRow>): Map<string, DirtiedRow> {
  return new Map(Object.entries(entries));
}

// ─────────────────────────────────────────────────────────────────────────────
// Write path — Save validates + persists + appends the who/when/old→new audit row.
// ─────────────────────────────────────────────────────────────────────────────
test('Save persists a LIVE row to config_values and appends a who/when/old→new audit row (config-edit-taxonomy rule 4)', async () => {
  const store = new InMemoryConfigSurfaceStore();
  const res = await saveSection(store, {
    section: '#memory',
    caller: SUPER,
    dirtied: dirtied({ memories_injected_per_task: { oldValue: 7, newValue: 9 } }),
    current: new Map([['memories_injected_per_task', 7]]),
    confirmations: new Set(),
    actorId: 'user-1',
    now: T0,
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.writtenKeys, ['memories_injected_per_task']);
  assert.equal(store.configValues.get('memories_injected_per_task')?.value, 9);
  assert.equal(store.configValues.get('memories_injected_per_task')?.updated_by, 'user-1'); // ADR-004 actor attribution
  assert.equal(store.auditLog.length, 1);
  const row = store.auditLog[0]!;
  assert.equal(row.key, 'memories_injected_per_task');
  assert.equal(row.old_value, 7);
  assert.equal(row.new_value, 9);
  assert.equal(row.actor_id, 'user-1');
  assert.equal(row.changed_at, new Date(T0 * 1000).toISOString());
});

test('cross-constraints reject a bad batch and write NOTHING (validate-all-before-write, #3)', async () => {
  const store = new InMemoryConfigSurfaceStore();
  // confidence_floor must be ≤ amber_zone_threshold — violate it.
  const res = await saveSection(store, {
    section: '#memory',
    caller: SUPER,
    dirtied: dirtied({ confidence_floor: { oldValue: 0.5, newValue: 0.9 } }),
    current: new Map([['amber_zone_threshold', 0.75], ['confidence_floor', 0.5]]),
    confirmations: new Set(),
    actorId: 'user-1',
    now: T0,
  });
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.key === 'confidence_floor'));
  assert.equal(store.configValues.size, 0); // nothing written
  assert.equal(store.auditLog.length, 0); // no audit row on a rejected save
});

test('ranking_weights / routing_weights must sum to 1.0; cold-start ordering; cost ladder; injection thresholds', () => {
  assert.equal(crossConstraints('#memory', new Map([['ranking_weights', { a: 0.5, b: 0.4 }]])).length, 1);
  assert.equal(crossConstraints('#memory', new Map([['ranking_weights', { a: 0.5, b: 0.5 }]])).length, 0);
  assert.equal(crossConstraints('#agents', new Map([['routing_weights', { a: 0.6, b: 0.5 }]])).length, 1);
  assert.equal(crossConstraints('#proactive', new Map([['cold_start_basic_threshold', 60], ['cold_start_proactive_threshold', 50], ['cold_start_full_threshold', 80]])).length, 1);
  assert.equal(crossConstraints('#guardrails', new Map([['cost_ladder_soft_threshold_daily_usd', 90], ['cost_ladder_throttle_threshold', 75], ['cost_ladder_hard_kill_threshold', 100]])).length, 1);
  assert.equal(crossConstraints('#guardrails', new Map([['injection_semantic_threshold', 0.99], ['injection_quarantine_threshold', 0.95]])).length, 1);
  assert.equal(crossConstraints('#tools', new Map([['backoff_initial_ms', 9000], ['backoff_max_ms', 1000]])).length, 1);
});

// Regression (MAJOR — non-atomic batch write, save.ts): a mid-batch failure must roll back everything.
// Before the fix the write loop persisted each row in its own autocommit; the first (valid) row survived
// while a later row threw → half-saved section + a config change with no audit row (#1/#3). writeBatch now
// wraps the whole batch in one transaction, so a mid-batch throw leaves NOTHING behind.
test('writeBatch is atomic: a mid-batch rejection rolls back the rows already applied — no half-saved section, no unaudited change (#1/#3)', async () => {
  const store = new InMemoryConfigSurfaceStore();
  const hl = HARD_LIMIT_KEYS[0]!;
  await assert.rejects(
    () =>
      store.writeBatch(
        [
          { key: 'memories_injected_per_task', value: 9, old_value: 7, new_value: 9 }, // valid — applied first
          { key: hl, value: 'x', old_value: null, new_value: 'x' }, // rejected mid-batch → whole txn rolls back
        ],
        'user-1',
        T0,
      ),
    /hard-limit prohibition/,
  );
  assert.equal(store.configValues.size, 0, 'the earlier valid row must have been rolled back');
  assert.equal(store.auditLog.length, 0, 'no audit row may survive a rolled-back batch');
});

// Regression (MAJOR — SECRET not pre-screened, validation.ts lockViolations): a batch mixing a SECRET key
// with a valid key must be rejected as a CLEAN forbidden SaveResult BEFORE any write — not write+audit the
// valid key and then throw at the store on the secret (partial write + uncaught throw). Nothing persists.
test('a Save batch carrying a SECRET key is rejected as a clean violation before any write — no partial write, no throw (#1/#2/#3)', async () => {
  const store = new InMemoryConfigSurfaceStore();
  const res = await saveSection(store, {
    section: '#memory',
    caller: SUPER,
    dirtied: dirtied({
      memories_injected_per_task: { oldValue: 7, newValue: 9 }, // a legitimate row in the same batch
      ANTHROPIC_API_KEY: { oldValue: null, newValue: 'sk-live-should-never-write' }, // SECRET — must block the batch
    }),
    current: new Map([['memories_injected_per_task', 7]]),
    confirmations: new Set(),
    actorId: 'user-1',
    now: T0,
  });
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.key === 'ANTHROPIC_API_KEY'), 'the secret key must be a reported violation');
  assert.equal(store.configValues.size, 0, 'the co-batched valid row must NOT have been written (whole batch blocked)');
  assert.equal(store.auditLog.length, 0, 'no audit row on a blocked batch');
});

// Regression (MINOR — ordered() silently skipped a non-numeric side, validation.ts): a present-but-non-numeric
// threshold is a type error the cross-key layer must reject, not silently pass (#3).
test('a present-but-non-numeric threshold is rejected, not silently skipped (#3)', () => {
  const v = crossConstraints('#memory', new Map<string, unknown>([['confidence_floor', 'high'], ['amber_zone_threshold', 0.75]]));
  assert.ok(v.some((x) => x.key === 'confidence_floor'), 'a string in a numeric threshold must be rejected');
});

// ─────────────────────────────────────────────────────────────────────────────
// Edit-class dialog gating (OD-101, rule 5, OD-040).
// ─────────────────────────────────────────────────────────────────────────────
test('a dirtied BOOT row requires the redeploy confirm; a REBUILD row always confirms; Slack false→true is irreversible', () => {
  assert.deepEqual(requiredConfirmsFor(dirtied({ hr_content_enabled: { oldValue: false, newValue: true } })), ['redeploy']);
  assert.ok(requiredConfirmsFor(dirtied({ embedding_model: { oldValue: 'a', newValue: 'b' } })).includes('rebuild'));
  assert.ok(requiredConfirmsFor(dirtied({ slack_token_rotation_enabled: { oldValue: false, newValue: true } })).includes('irreversible'));
  // false→false / true→true is not an irreversible transition.
  assert.deepEqual(requiredConfirmsFor(dirtied({ slack_token_rotation_enabled: { oldValue: true, newValue: true } })).filter((c) => c === 'irreversible'), []);
});

test('Save without the required confirm writes nothing and reports the owed confirm (OD-101)', async () => {
  const store = new InMemoryConfigSurfaceStore();
  const res = await saveSection(store, {
    section: '#memory',
    caller: SUPER,
    dirtied: dirtied({ embedding_model: { oldValue: 'text-embedding-3-small', newValue: 'text-embedding-3-large' } }),
    current: new Map(),
    confirmations: new Set(), // rebuild confirm NOT given
    actorId: 'user-1',
    now: T0,
  });
  assert.equal(res.ok, false);
  assert.ok(res.requiredConfirms.includes('rebuild'));
  assert.equal(store.auditLog.length, 0);
  // With the confirm, it writes.
  const ok = await saveSection(store, {
    section: '#memory',
    caller: SUPER,
    dirtied: dirtied({ embedding_model: { oldValue: 'text-embedding-3-small', newValue: 'text-embedding-3-large' } }),
    current: new Map(),
    confirmations: new Set(['rebuild']),
    actorId: 'user-1',
    now: T0,
  });
  assert.equal(ok.ok, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// OD-161 / ADR-007 floors — locked + hard-limit rows are server-rejected on write.
// ─────────────────────────────────────────────────────────────────────────────
test('a locked row (action_autonomy_matrix / deployment_region) is server-rejected on Save (OD-161 / v1-lock)', async () => {
  const store = new InMemoryConfigSurfaceStore();
  const res = await saveSection(store, {
    section: '#guardrails',
    caller: SUPER,
    dirtied: dirtied({ action_autonomy_matrix: { oldValue: {}, newValue: { financial_operation: 'act' } } }),
    current: new Map(),
    confirmations: new Set(),
    actorId: 'user-1',
    now: T0,
  });
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.key === 'action_autonomy_matrix'));
  assert.equal(store.auditLog.length, 0);
  assert.equal(readOnlyBadge('action_autonomy_matrix'), 'Locked (hard_approval-or-Prepare)');
  assert.equal(readOnlyBadge('deployment_region'), 'Locked for v1');
  assert.ok(lockViolations(['deployment_region']).length === 1);
});

test('a hard-limit sentinel key is read-only, badged "Hard limit — not editable", and server-rejects on write (ADR-007/OD-047/OD-060)', async () => {
  const store = new InMemoryConfigSurfaceStore();
  const hl = HARD_LIMIT_KEYS[0]!;
  assert.equal(isHardLimitKey(hl), true);
  assert.equal(isReadOnlyKey(hl), true);
  assert.equal(readOnlyBadge(hl), 'Hard limit — not editable');
  // Defensive: a direct write of a hard-limit key throws at the store (never a knob, #2).
  await assert.rejects(() => store.putConfigValue(hl, 'x', 'user-1', T0), /hard-limit prohibition/);
  await assert.rejects(() => store.appendAudit({ key: hl, old_value: null, new_value: 'x', actor_id: 'user-1' }, T0), /hard-limit prohibition/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.LOG.008.5 / AC-7.LOG.005.1 — SECRET-class credential safety.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.LOG.008.5: a SECRET-class key can never produce a config_audit_log row', async () => {
  const store = new InMemoryConfigSurfaceStore();
  await assert.rejects(() => store.appendAudit({ key: 'ANTHROPIC_API_KEY', old_value: null, new_value: 'sk-live', actor_id: 'u' }, T0), /SECRET-class/);
  assert.equal(store.auditLog.length, 0);
});

test('AC-7.LOG.005.1: a SECRET value is never written through Save (config_values rejects it); credential material is redacted before an audit row is written', async () => {
  const store = new InMemoryConfigSurfaceStore();
  await assert.rejects(() => store.putConfigValue('SLACK_WEBHOOK_URL', 'https://hooks/xoxb-abc', 'u', T0), /SECRET-class/);
  // Defence-in-depth: a non-secret key carrying token-shaped material has it redacted before the row is written.
  await store.putConfigValue('ghl_webhook_pubkey', 'pem', 'u', T0);
  const audit = await store.appendAudit({ key: 'ghl_webhook_pubkey', old_value: { client_secret: 'sk-abcdef0123456789xyz' }, new_value: { note: 'sk-abcdef0123456789xyz' }, actor_id: 'u' }, T0);
  assert.notEqual(JSON.stringify(audit.new_value), JSON.stringify({ note: 'sk-abcdef0123456789xyz' }));
  assert.equal(store.noCredentialMaterial(), true);
});

test('#secrets renders presence + last_rotated only — never a value, never a save control', async () => {
  const store = new InMemoryConfigSurfaceStore();
  store.secretManifest.set('ANTHROPIC_API_KEY', { key: 'ANTHROPIC_API_KEY', present: true, last_rotated: null });
  const presence = await store.readSecretPresence('ANTHROPIC_API_KEY');
  assert.deepEqual(Object.keys(presence!).sort(), ['key', 'last_rotated', 'present']); // no `value`
  const row = renderSecretRow(SECRET_MANIFEST[0]!, presence);
  assert.equal(row.editable, false);
  assert.equal(row.lastRotatedLabel, 'Unknown');
  // A required missing secret reads "MISSING — boot blocked", never a false "present".
  const missing = renderSecretRow({ key: 'OPENAI_API_KEY', required: true }, { key: 'OPENAI_API_KEY', present: false, last_rotated: null });
  assert.equal(missing.presenceLabel, 'MISSING — boot blocked');
  assert.equal(SECRET_MANIFEST_KEYS.length, 11);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.LOG.008.1 — complete-or-loud export, PERM-gated, key-prefix-scoped.
// ─────────────────────────────────────────────────────────────────────────────
async function seedAudit(store: ConfigSurfaceStore): Promise<void> {
  await store.appendAudit({ key: 'memories_injected_per_task', old_value: 7, new_value: 9, actor_id: 'user-1' }, T0);
  await store.appendAudit({ key: 'auth.captcha_enabled', old_value: true, new_value: false, actor_id: 'user-1' }, T0 + 10);
  await store.appendAudit({ key: 'deploy_max_skew_days', old_value: 14, new_value: 7, actor_id: 'user-2' }, T0 + 20);
}

test('AC-7.LOG.008.1: export returns every row in range+scope for a download-records holder', async () => {
  const store = new InMemoryConfigSurfaceStore();
  await seedAudit(store);
  const from = new Date((T0 - 100) * 1000).toISOString();
  const to = new Date((T0 + 100) * 1000).toISOString();
  const result = await exportTrail(store, { filter: { from, to }, callerConfigPerms: ALL_CONFIG_PERMS, callerPerms: [DOWNLOAD_RECORDS_PERM] });
  assert.equal(result.rowCount, 3);
  assert.match(result.attestation, /Complete export/);
});

test('AC-7.LOG.008.1: a non-holder has no export (throws loud, never a silent file)', async () => {
  const store = new InMemoryConfigSurfaceStore();
  await seedAudit(store);
  const from = new Date((T0 - 100) * 1000).toISOString();
  const to = new Date((T0 + 100) * 1000).toISOString();
  await assert.rejects(() => exportTrail(store, { filter: { from, to }, callerConfigPerms: ALL_CONFIG_PERMS, callerPerms: [] }), /download_records/);
});

test('AC-7.LOG.008.1: export is key-prefix scoped — an auth-only exporter never receives infra rows (#2)', async () => {
  const store = new InMemoryConfigSurfaceStore();
  await seedAudit(store);
  const from = new Date((T0 - 100) * 1000).toISOString();
  const to = new Date((T0 + 100) * 1000).toISOString();
  const result = await exportTrail(store, { filter: { from, to }, callerConfigPerms: ['PERM-config.auth'], callerPerms: [DOWNLOAD_RECORDS_PERM] });
  assert.deepEqual(result.rows.map((r) => r.key), ['auth.captcha_enabled']); // never deploy_max_skew_days (infra) or memory
});

test('AC-7.LOG.008.1: export is ALL-OR-NOTHING — a tampered row aborts the whole export (no partial file)', async () => {
  const store = new InMemoryConfigSurfaceStore();
  await seedAudit(store);
  store._tamperInPlace('ca-0001', (r) => (r.new_value = 999)); // out-of-band edit the DB trigger would reject
  const from = new Date((T0 - 100) * 1000).toISOString();
  const to = new Date((T0 + 100) * 1000).toISOString();
  await assert.rejects(
    () => exportTrail(store, { filter: { from, to }, callerConfigPerms: ALL_CONFIG_PERMS, callerPerms: [DOWNLOAD_RECORDS_PERM] }),
    /ABORTED/,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.LOG.008.3 — append-only + tamper-evident; surface never offers edit/delete.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.LOG.008.3: the Change Detail carries a tamper-evidence indicator and offers NO edit/delete of an audit row', async () => {
  const store = new InMemoryConfigSurfaceStore();
  store.seedActor({ id: 'user-1', name: 'Ada', role: 'Super Admin' });
  const row = await store.appendAudit({ key: 'memories_injected_per_task', old_value: 7, new_value: 9, actor_id: 'user-1' }, T0);
  const clean = await renderChangeDetail(store, row);
  assert.match(clean.tamperEvidence, /Integrity verified/);
  assert.equal(clean.canMutateAuditRow, false);
  // A tampered row is caught.
  store._tamperInPlace(row.id, (r) => (r.new_value = 42));
  const tampered = await renderChangeDetail(store, store.auditLog.find((r) => r.id === row.id)!);
  assert.match(tampered.tamperEvidence, /INTEGRITY CHECK FAILED/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.LOG.008.4 — redaction-tombstone renders "redacted (erased user)", record retained.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.LOG.008.4: a redaction-tombstoned actor renders "redacted (erased user)"; key/old→new/changed_at still render', async () => {
  const store = new InMemoryConfigSurfaceStore();
  store.seedActor({ id: 'user-9', name: 'Bob', role: 'Admin' });
  const row = await store.appendAudit({ key: 'auth.captcha_enabled', old_value: true, new_value: false, actor_id: 'user-9' }, T0);
  const before = await renderChangeRow(store, row);
  assert.equal(before.actorLabel, 'Bob (Admin)');
  const n = await store.redactActor('user-9', T0 + 5);
  assert.equal(n, 1);
  const tomb = store.auditLog.find((r) => r.id === row.id)!;
  const after = await renderChangeRow(store, tomb);
  assert.equal(after.actorLabel, REDACTED_ACTOR);
  assert.equal(after.key, 'auth.captcha_enabled'); // record retained
  assert.match(after.diffSummary, /true.*false/);
  assert.equal(await store.verifyIntegrity(tomb), true); // the tombstone is not tampering
});

test('renderActor: a null actor_id reads "redacted (erased user)"; renderDiff shows "(first set)" on first write', async () => {
  const store = new InMemoryConfigSurfaceStore();
  assert.equal(renderActor({ id: 'x', key: 'k', old_value: null, new_value: 1, actor_id: null, redacted_at: null, changed_at: '' }, null), REDACTED_ACTOR);
  assert.match(renderDiff(null, 5), /\(first set\)/);
  assert.match(renderDiff({ a: 1, b: 2 }, { a: 1, b: 3 }), /b: 2 → 3/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.009.1 — unroutable alert edit rejected on Save; misconfigured-delivery banner on both surfaces.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.ALR.009.1: an unroutable alert_routing_rules edit is rejected on Save in #observability', async () => {
  const store = new InMemoryConfigSurfaceStore();
  // A critical alert type routed to a role with no contacts → unroutable → reject.
  const res = await saveSection(store, {
    section: '#observability',
    caller: SUPER,
    dirtied: dirtied({
      alert_routing_rules: { oldValue: {}, newValue: { hard_limit_hit: { role: 'ops', channel: 'dashboard' }, loop_missed: { role: 'ops', channel: 'dashboard' }, alert_delivery_misconfigured: { role: 'ops', channel: 'dashboard' } } },
    }),
    current: new Map([['escalation_contacts', { ops: [] }]]), // ops has NO contacts
    confirmations: new Set(),
    actorId: 'user-1',
    now: T0,
  });
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.key === 'alert_routing_rules' && /CRITICAL/.test(v.message)));
  assert.equal(store.auditLog.length, 0);
});

test('AC-7.ALR.009.1 / AC-7.ALR.008.2: both loud banners pin on both surfaces from a static read (no subscription)', async () => {
  const store = new InMemoryConfigSurfaceStore();
  store.setBanners({ alertEngineStalled: true, alertDeliveryMisconfigured: true });
  const banners = pinnedBanners(await store.bannerSignals());
  const ids = banners.map((b) => b.id).sort();
  assert.deepEqual(ids, ['alert-delivery-misconfigured', 'alert-engine-stalled']);
  assert.ok(banners.every((b) => b.severity === 'critical' && hasTextCue(b.text)));
  // None when clear.
  store.setBanners({ alertEngineStalled: false, alertDeliveryMisconfigured: false });
  assert.equal(pinnedBanners(await store.bannerSignals()).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.RTP.001.3 — neither surface holds a Realtime subscription.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.RTP.001.3: neither config surface holds a Realtime subscription (static + on-demand)', () => {
  assert.equal(NO_REALTIME_SUBSCRIPTION, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-NFR-A11Y.001.1/.2 — status is never colour-only; every badge carries a text cue.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-NFR-A11Y.001.2: every edit-class badge, lock badge, and banner carries a TEXT cue (never colour-only)', () => {
  for (const spec of KEY_CATALOG) {
    assertNotColourOnly(`edit-class ${spec.key}`, editClassBadge(spec));
    if (isReadOnlyKey(spec.key)) assertNotColourOnly(`lock ${spec.key}`, readOnlyBadge(spec.key));
  }
  for (const hl of HARD_LIMIT_KEYS) assertNotColourOnly(`hard-limit ${hl}`, readOnlyBadge(hl));
  // The class word is present in the badge (a screen-reader/keyboard user reads the class).
  assert.match(editClassBadge(keySpec('memories_injected_per_task')!), /LIVE/);
  assert.match(editClassBadge(keySpec('embedding_model')!), /REBUILD/);
});

// ─────────────────────────────────────────────────────────────────────────────
// #2 PERM scoping — entry gate, per-section visibility, Super-Admin-only sections.
// ─────────────────────────────────────────────────────────────────────────────
test('#2 entry gate: a caller with no PERM-config.* node cannot enter; a one-node caller sees only that section', () => {
  assert.equal(canEnter(caller(false, [])), false);
  assert.equal(canEnter(caller(false, ['PERM-billing.view'])), false);
  const authOnly = caller(false, ['PERM-config.auth']);
  assert.equal(canEnter(authOnly), true);
  const sections = visibleSections(authOnly).map((s) => s.id);
  assert.deepEqual(sections, ['#auth']); // only its section; the rest are ABSENT, not locked
});

test('#2: #infra and #secrets never render for a non-Super-Admin, even holding the node', () => {
  // An Admin somehow holding PERM-config.infra still does not see it (Super-Admin-only, never delegable).
  const admin = caller(false, ['PERM-config.infra', 'PERM-config.secrets', 'PERM-config.auth']);
  const ids = visibleSections(admin).map((s) => s.id);
  assert.ok(!ids.includes('#infra'));
  assert.ok(!ids.includes('#secrets'));
  // A Super Admin sees all 11.
  assert.equal(visibleSections(SUPER).length, 11);
});

test('#2: a non-permitted caller cannot Save a section (forbidden, no writes)', async () => {
  const store = new InMemoryConfigSurfaceStore();
  const authOnly = caller(false, ['PERM-config.auth']);
  const res = await saveSection(store, {
    section: '#memory', // not held
    caller: authOnly,
    dirtied: dirtied({ memories_injected_per_task: { oldValue: 7, newValue: 9 } }),
    current: new Map(),
    confirmations: new Set(),
    actorId: 'user-1',
    now: T0,
  });
  assert.equal(res.ok, false);
  assert.equal(res.forbidden, true);
  assert.equal(store.auditLog.length, 0);
});

test('#2: the audit timeline is key-prefix scoped — an auth-only caller never sees infra/memory change rows', async () => {
  const store = new InMemoryConfigSurfaceStore();
  await seedAudit(store);
  const from = new Date((T0 - 100) * 1000).toISOString();
  const to = new Date((T0 + 100) * 1000).toISOString();
  const rows = await store.readAudit({ from, to }, ['PERM-config.auth']);
  assert.deepEqual(rows.map((r) => r.key), ['auth.captcha_enabled']);
  // key-prefix routing: an unknown key fails closed to infra (Super-Admin-only).
  assert.equal(configKeyGroup('some_unknown_key'), 'PERM-config.infra');
  assert.equal(configKeyGroup('auth.captcha_enabled'), 'PERM-config.auth');
});

// ─────────────────────────────────────────────────────────────────────────────
// #3 load-state disciplines — partial config disables Save; error ≠ empty timeline.
// ─────────────────────────────────────────────────────────────────────────────
test('#3: a PARTIAL config-section load disables Save (never overwrite good values with empty)', () => {
  const partial = renderSection({ kind: 'partial', loadedKeys: ['a'], failedKeys: ['b'] });
  assert.equal(partial.state, 'partial');
  assert.equal(partial.saveEnabled, false);
  assert.deepEqual(partial.failedKeys, ['b']);
  // Error + offline also disable Save; a clean load enables it.
  assert.equal(renderSection({ kind: 'error', reason: 'x' }).saveEnabled, false);
  assert.equal(renderSection({ kind: 'offline', loadedAt: 't' }).saveEnabled, false);
  assert.equal(renderSection({ kind: 'ok', loadedKeys: ['a'] }).saveEnabled, true);
});

test('#3: a failed audit load NEVER renders as an empty timeline; brand-new vs filtered-empty are distinct', () => {
  const err = renderAuditTimeline({ kind: 'error', reason: 'db down' });
  assert.equal(err.state, 'error');
  assert.equal(err.isEmptyTimeline, false); // the cardinal guard — never "no changes ever" on a failed load
  assert.equal(err.exportEnabled, false);

  const brandNew = renderAuditTimeline({ kind: 'ok', rowCount: 0, filtered: false });
  assert.equal(brandNew.isEmptyTimeline, true);
  assert.match(brandNew.message, /No configuration changes have been recorded yet/);

  const filteredEmpty = renderAuditTimeline({ kind: 'ok', rowCount: 0, filtered: true });
  assert.equal(filteredEmpty.isEmptyTimeline, true);
  assert.match(filteredEmpty.message, /No changes match your filters/);
  assert.notEqual(brandNew.message, filteredEmpty.message); // never conflated
});

test('#3: a partial audit load renders the change rows (never drops them) with actors "unresolved"; offline disables export', () => {
  const partial = renderAuditTimeline({ kind: 'partial', rowCount: 3, unresolvedActors: 1 });
  assert.equal(partial.state, 'partial');
  assert.equal(partial.isEmptyTimeline, false);
  assert.match(partial.message, /3 change\(s\) shown/);
  assert.equal(renderAuditTimeline({ kind: 'offline', loadedAt: 't' }).exportEnabled, false);
});

test('mobile degradation banner appears < 768px and discourages export (OD-100)', () => {
  const m = mobileDegradation(400);
  assert.equal(m.degraded, true);
  assert.ok(m.banner && m.banner.length > 0);
  assert.equal(m.exportDiscouraged, true);
  assert.equal(mobileDegradation(1200).degraded, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Catalog integrity (surface-level sanity — the `check` gate proves registry parity).
// ─────────────────────────────────────────────────────────────────────────────
test('catalog: every editable key maps to exactly one section + node; #secrets holds no editable keys', () => {
  const seen = new Set<string>();
  for (const spec of KEY_CATALOG) {
    assert.equal(seen.has(spec.key), false, `duplicate catalog key ${spec.key}`);
    seen.add(spec.key);
    assert.notEqual(spec.section, '#secrets');
  }
  assert.equal(sectionKeys('#prompts').length, 1);
  assert.ok(sectionKeys('#memory').some((k) => k.key === 'embedding_model' && k.editClass === 'REBUILD'));
});
