// ISSUE-021 — AUD spine + AF-081 agent-path completeness + FR-1.USR.004 gated activity view tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryUserMgmtStore,
  UserMgmtError,
  ERR_DENIED,
  ERR_AUDIT_CONTRACT,
  NODE_VIEW_ACTIVITY,
} from './store.ts';
import { recordSensitiveAccess, viewUserActivity, type SensitiveAccess } from './lifecycle.ts';

function base() {
  const store = new InMemoryUserMgmtStore();
  store.setUser('admin', { active: true, nodes: [NODE_VIEW_ACTIVITY] });
  store.setUser('target', { active: true });
  return store;
}

// ── AC-1.AUD.001.1 — a Personal-tier injection produces an immutable audit record ───────────────────
test('AC-1.AUD.001.1 — a Personal-tier memory injection writes an audit record', async () => {
  const store = base();
  const row = await recordSensitiveAccess(store, {
    actorIdentity: 'target',
    actorType: 'user',
    tier: 'personal',
    action: 'injection',
    entityId: 'mem-1',
    entityType: 'Memory',
    pathContext: 'retrieval',
  });
  assert.ok(row, 'an audit row is written for a Personal injection');
  assert.equal(row!.audit_type, 'access');
  assert.equal(row!.action, 'personal-injection');
  const audits = await store.listAudits();
  assert.equal(audits.length, 1);
});

// ── AC-1.AUD.001.2 — an agent (service_role) reading Restricted is audited (agent path covered) ──────
test('AC-1.AUD.001.2 — an agent reading a Restricted memory is audited with originating_user_id', async () => {
  const store = base();
  const row = await recordSensitiveAccess(store, {
    actorIdentity: 'agent:specialist-3',
    actorType: 'agent',
    tier: 'restricted',
    action: 'read',
    entityId: 'mem-9',
    entityType: 'Memory',
    pathContext: 'agent-task:t-77',
    originatingUserId: 'target',
  });
  assert.ok(row, 'agent-path Restricted read is audited');
  assert.equal(row!.actor_type, 'agent');
  assert.equal(row!.originating_user_id, 'target', 'the human the agent acts for is attributed (AF-081)');
});

// ── AF-081 — the agent path has no DB backstop: an unattributed sensitive agent access is IMPOSSIBLE ──
test('AF-081 — a service_role Personal/Restricted access WITHOUT originating_user_id is rejected (fail loud)', async () => {
  const store = base();
  const bad: SensitiveAccess = {
    actorIdentity: 'agent:x',
    actorType: 'agent',
    tier: 'restricted',
    action: 'read',
    entityId: 'mem-1',
    entityType: 'Memory',
    pathContext: 'agent-task:t-1',
    // originatingUserId deliberately missing
  };
  await assert.rejects(() => recordSensitiveAccess(store, bad), (e: UserMgmtError) => e.reason === ERR_AUDIT_CONTRACT);
  assert.equal((await store.listAudits()).length, 0, 'no partial/unattributed audit row is written');
});

test('AF-081 — an empty path_context on a sensitive access is rejected (no un-attributable access)', async () => {
  const store = base();
  await assert.rejects(
    () =>
      recordSensitiveAccess(store, {
        actorIdentity: 'target',
        actorType: 'user',
        tier: 'personal',
        action: 'read',
        entityId: 'mem-1',
        entityType: 'Memory',
        pathContext: '   ',
      }),
    (e: UserMgmtError) => e.reason === ERR_AUDIT_CONTRACT,
  );
});

test('FR-1.AUD.001 (scope) — a Standard/Confidential access needs no per-access audit (returns null, no over-audit)', async () => {
  const store = base();
  const std = await recordSensitiveAccess(store, { actorIdentity: 'target', actorType: 'user', tier: 'standard', action: 'read', entityId: 'm', entityType: 'Memory', pathContext: 'x' });
  const conf = await recordSensitiveAccess(store, { actorIdentity: 'target', actorType: 'user', tier: 'confidential', action: 'read', entityId: 'm', entityType: 'Memory', pathContext: 'x' });
  assert.equal(std, null);
  assert.equal(conf, null);
  assert.equal((await store.listAudits()).length, 0);
});

test('AF-081 (completeness sweep) — every Personal/Restricted access across both paths produces exactly one row', async () => {
  const store = base();
  const accesses: SensitiveAccess[] = [
    { actorIdentity: 'target', actorType: 'user', tier: 'personal', action: 'read', entityId: 'a', entityType: 'Memory', pathContext: 'ui' },
    { actorIdentity: 'target', actorType: 'user', tier: 'restricted', action: 'read', entityId: 'b', entityType: 'Memory', pathContext: 'ui' },
    { actorIdentity: 'agent:1', actorType: 'agent', tier: 'personal', action: 'injection', entityId: 'c', entityType: 'Memory', pathContext: 'task', originatingUserId: 'target' },
    { actorIdentity: 'agent:1', actorType: 'agent', tier: 'restricted', action: 'write', entityId: 'd', entityType: 'Memory', pathContext: 'task', originatingUserId: 'target' },
  ];
  for (const a of accesses) await recordSensitiveAccess(store, a);
  const audits = await store.listAudits();
  assert.equal(audits.length, 4, 'no sensitive access is unlogged (human + agent paths both covered)');
  assert.equal(audits.filter((x) => x.actor_type === 'agent').length, 2, 'both agent-path accesses are covered');
});

// ── AC-1.AUD.002.1 — an RBAC mutation audit captures actor, (target), before/after, timestamp ────────
test('AC-1.AUD.002.1 — a role/node mutation audit record captures actor, target, before/after, and timestamp', async () => {
  const store = base();
  // The node-toggle SCENARIO itself lives in ISSUE-018 (toggleNode); this asserts the FR-1.AUD.002 CONTENT
  // contract this slice owns — the record produced by any RBAC mutation must carry all required fields.
  const row = await store.appendAudit({
    audit_type: 'rbac',
    actor_identity: 'admin',
    action: 'grant-node',
    target_type: 'role',
    target_entity_id: 'role-editor',
    before_value: { granted: false },
    after_value: { granted: true },
    reason: 'PERM-memory.write',
  });
  assert.equal(row.actor_identity, 'admin', 'actor captured');
  assert.equal(row.target_type, 'role');
  assert.equal(row.target_entity_id, 'role-editor', '(role, node) target captured');
  assert.deepEqual(row.before_value, { granted: false }, 'before captured');
  assert.deepEqual(row.after_value, { granted: true }, 'after captured');
  assert.ok(row.created_at, 'timestamp captured');
});

// ── AC-1.USR.004.1 — gated, read-only activity view; Personal/Restricted redacted unless cleared ─────
test('AC-1.USR.004.1 — an Admin views a user activity log (read-only) and it is itself audited', async () => {
  const store = base();
  // the target performed some recorded actions
  await recordSensitiveAccess(store, { actorIdentity: 'target', actorType: 'user', tier: 'personal', action: 'read', entityId: 'm1', entityType: 'Memory', pathContext: 'ui' });
  const before = (await store.listAudits()).length;
  const entries = await viewUserActivity(store, 'admin', 'target', { viewerCleared: true });
  assert.ok(entries.length >= 1, 'the user recorded actions are surfaced');
  assert.ok(entries.every((e) => typeof e.action === 'string'), 'read-only projection');
  const after = (await store.listAudits()).length;
  assert.equal(after, before + 1, 'the view itself is audited');
});

test('FR-1.USR.004 (deny) — viewing activity without PERM-user.view_activity is denied', async () => {
  const store = base();
  store.setUser('nobody', { active: true, nodes: [] });
  await assert.rejects(() => viewUserActivity(store, 'nobody', 'target'), (e: UserMgmtError) => e.reason === ERR_DENIED);
});

test('FR-1.USR.004 (redaction) — a Personal/Restricted access entry is redacted for an un-cleared viewer', async () => {
  const store = base();
  await recordSensitiveAccess(store, { actorIdentity: 'target', actorType: 'user', tier: 'restricted', action: 'read', entityId: 'secret', entityType: 'Memory', pathContext: 'ui' });
  const uncleared = await viewUserActivity(store, 'admin', 'target', { viewerCleared: false });
  const sensitive = uncleared.find((e) => e.redacted);
  assert.ok(sensitive, 'the sensitive access entry is present but redacted');
  assert.equal(sensitive!.action, '[redacted]');
  assert.equal(sensitive!.target_entity_id, null, 'the entity id is hidden from an un-cleared viewer');

  const cleared = await viewUserActivity(store, 'admin', 'target', { viewerCleared: true });
  const revealed = cleared.find((e) => e.action === 'restricted-read');
  assert.ok(revealed, 'a cleared viewer sees the real entry');
});

// ── §9 immutability (offline surface) — access_audit is append-only; reads return copies ─────────────
test('immutability (offline) — the store exposes no update/delete of an audit row; reads are copies', async () => {
  const store = base();
  await store.appendAudit({ audit_type: 'rbac', actor_identity: 'admin', action: 'x', target_type: null, target_entity_id: null, reason: null });
  // The UserMgmtStore port has appendAudit + listAudits ONLY — no mutate/delete method exists (append-only by
  // construction; the DB trigger enforces it at the table, proven by the R10 live-smoke.sql).
  const store2 = store as unknown as Record<string, unknown>;
  assert.equal(store2['updateAudit'], undefined, 'no update-audit method');
  assert.equal(store2['deleteAudit'], undefined, 'no delete-audit method');
  // Mutating the returned rows must not corrupt the store's copy (#1 — no accidental in-place edit path).
  const rows = await store.listAudits();
  rows[0]!.action = 'TAMPERED';
  const reread = await store.listAudits();
  assert.equal(reread[0]!.action, 'x', 'the stored audit row is unchanged by mutating a read copy');
});
