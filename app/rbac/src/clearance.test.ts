// ISSUE-019 — one test per AC in §4 Definition of done, proved against the InMemoryRbacStore reference model
// (offline; the live seed + grant/revoke-through-RLS proof is the ISSUE-019 capstone).
//
// AC map:
//   AC-1.CLR.001.1  — Restricted memory is never auto-injected (the tier's defining handling rule)
//   AC-1.CLR.002.1  — fresh deployment seeds each role's documented default clearances + scope
//   AC-1.CLR.003.1  — only-Standard user has no above-Standard access absent an explicit grant
//   AC-1.CLR.004.1  — a Finance-scoped Confidential clearance excludes a Confidential client-strategy memory
//   AC-1.CLR.005.1  — elapsed review, fail_closed=false → flagged + escalated, neither auto-revoked nor marked reviewed
//   AC-1.CLR.005.2  — elapsed review, fail_closed=true → auto-revoked, audited, still alerted (never silent)
//   AC-1.CLR.006.1  — a memory outside clearance is excluded BEFORE ranking (not ranked-then-hidden)
//   AC-1.RST.001.1  — Restricted cannot be set as a role default (per-individual only)
//   AC-1.RST.001.2  — a non-Super-Admin attempting to grant Restricted is denied
//   AC-1.RST.002.1  — a Restricted grant with no reason is rejected
//   AC-1.RST.002.2  — a Restricted grant writes an immutable audit record: granter, grantee, time, reason
//   AC-1.RST.002.3  — a revoked Restricted grant denies access on the user's next query
//   AC-1.RST.003.1  — a holder still gets no auto-injection; Restricted surfaces only via explicit audited access
//   OD-186          — a default scope token absent from entity_types fails the seed LOUD (portability guard)
//   FR-1.CLR.001    — the model does not hardcode exactly four tiers (custom-tier extension point)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRbacStore, RbacError } from './store.ts';
import { seedRoles } from './roles.ts';
import {
  isAutoInjectable,
  filterAutoInjectable,
  applyClearanceControl,
  sensitivityTiers,
  DEFAULT_CLEARANCES,
  FINANCE_ENTITY_TYPES,
  grantClearance,
  revokeClearance,
  hasClearanceFor,
  effectiveClearances,
  reviewOverdueClearances,
  confirmClearanceReview,
  grantRestricted,
  revokeRestricted,
  assertNoRestrictedRoleDefault,
  InMemoryAlertSink,
  ERR_REASON_REQUIRED,
  ERR_BAD_TIER,
  ERR_SCOPE_TOKEN_ABSENT,
} from './clearance.ts';
import { ERR_DENIED } from './store.ts';

// ── setup helpers ───────────────────────────────────────────────────────────────────────────────
async function roleId(store: InMemoryRbacStore, name: string): Promise<string> {
  return (await store.getRoleByName(name))!.id;
}
const T0 = '2026-01-01T00:00:00.000Z';
const NOW = '2026-07-06T00:00:00.000Z'; // >90 days after T0

/** A fresh seeded store with a Super Admin actor `sa` and (optionally) a user seated in `userRole`. Seeded role
 *  defaults are provisioned at NOW (fresh), so a review at NOW flags only the clearances a test deliberately
 *  grants in the past — the seeded defaults are legitimately in-scope for review but not yet overdue. */
async function seeded(userRole?: string, userId = 'u1'): Promise<{ store: InMemoryRbacStore; sa: string }> {
  const store = new InMemoryRbacStore();
  await seedRoles(store, undefined, NOW);
  const sa = 'sa-actor';
  await store.assignRole(sa, await roleId(store, 'Super Admin'));
  if (userRole) await store.assignRole(userId, await roleId(store, userRole));
  return { store, sa };
}

// ── AC-1.CLR.001.1 ────────────────────────────────────────────────────────────────────────────────
test('AC-1.CLR.001.1 — Restricted-tier content is never auto-injected', () => {
  assert.equal(isAutoInjectable('restricted'), false);
  assert.equal(isAutoInjectable('standard'), true);
  assert.equal(isAutoInjectable('confidential'), true);
  assert.equal(isAutoInjectable('personal'), true);
  const candidates = [
    { sensitivity: 'standard' as const, id: 'm1' },
    { sensitivity: 'restricted' as const, id: 'm2' },
  ];
  assert.deepEqual(filterAutoInjectable(candidates).map((c) => c.id), ['m1']); // restricted dropped
});

// ── AC-1.CLR.002.1 ────────────────────────────────────────────────────────────────────────────────
test('AC-1.CLR.002.1 — a fresh deployment seeds each role exactly its documented default clearances + scope', async () => {
  const store = new InMemoryRbacStore();
  await seedRoles(store);
  const tiersScopes = async (role: string) =>
    (await store.roleClearances(await roleId(store, role)))
      .map((c) => `${c.tier}:${c.entity_type_scope ?? 'Global'}`)
      .sort();

  assert.deepEqual(await tiersScopes('Super Admin'), ['confidential:Global', 'personal:Global']);
  assert.deepEqual(await tiersScopes('Admin'), ['confidential:Global', 'personal:Global']);
  assert.deepEqual(await tiersScopes('HR'), ['personal:Team Member']);
  assert.deepEqual(
    await tiersScopes('Finance'),
    FINANCE_ENTITY_TYPES.map((t) => `confidential:${t}`).sort(),
  );
  assert.deepEqual(await tiersScopes('Account Manager'), ['confidential:Client']);
  assert.deepEqual(await tiersScopes('Standard User'), []); // Standard implicit — no row
  // and no role default is ever Restricted (the enum can't hold it; assert the data too)
  for (const rows of Object.values(DEFAULT_CLEARANCES)) for (const r of rows) assert.notEqual(r.tier as string, 'restricted');
});

// ── AC-1.CLR.003.1 ────────────────────────────────────────────────────────────────────────────────
test('AC-1.CLR.003.1 — a Standard-only user has no above-Standard access absent an explicit grant', async () => {
  const { store } = await seeded('Standard User', 'std');
  assert.equal(await hasClearanceFor(store, 'std', 'standard', 'Client'), true); // implicit
  assert.equal(await hasClearanceFor(store, 'std', 'confidential', 'Invoice'), false);
  assert.equal(await hasClearanceFor(store, 'std', 'personal', 'Team Member'), false);
  assert.equal(await hasClearanceFor(store, 'std', 'restricted', 'Client'), false); // never via clearance
  assert.equal((await effectiveClearances(store, 'std')).length, 0);
});

// ── AC-1.CLR.004.1 ────────────────────────────────────────────────────────────────────────────────
test('AC-1.CLR.004.1 — a Finance-scoped Confidential clearance excludes a Confidential client-strategy memory', async () => {
  const { store } = await seeded('Finance', 'fin');
  assert.equal(await hasClearanceFor(store, 'fin', 'confidential', 'Invoice'), true); // in finance scope
  assert.equal(await hasClearanceFor(store, 'fin', 'confidential', 'Contract/Retainer'), true);
  assert.equal(await hasClearanceFor(store, 'fin', 'confidential', 'Client'), false); // client-strategy — excluded
});

// ── AC-1.CLR.005.1 ────────────────────────────────────────────────────────────────────────────────
test('AC-1.CLR.005.1 — elapsed review, fail_closed=false → flagged + escalated, neither auto-revoked nor marked reviewed', async () => {
  const { store, sa } = await seeded();
  const row = await grantClearance(store, sa, { userId: 'u9' }, 'confidential', 'Invoice', { grantedAt: T0 });
  const alert = new InMemoryAlertSink();
  const { flagged, revoked } = await reviewOverdueClearances(store, { now: NOW, cadenceDays: 90, failClosed: false }, alert);

  assert.deepEqual(flagged, [row.id]);
  assert.deepEqual(revoked, []);
  // NOT revoked — the row still exists...
  const still = (await store.listClearances()).find((c) => c.id === row.id);
  assert.ok(still, 'clearance must not be auto-revoked when fail_closed=false');
  // ...and NOT marked reviewed (last_reviewed_at untouched)
  assert.equal(still!.last_reviewed_at, null);
  // ...but loudly surfaced (alert + audit), never silent
  assert.equal(alert.alerts.length, 1);
  assert.equal(alert.alerts[0]!.kind, 'clearance_review_overdue');
  const flagAudit = (await store.audits()).find((a) => a.action === 'clearance-review-overdue' && a.target_entity_id === row.id);
  assert.ok(flagAudit);
  assert.equal(flagAudit!.actor_type, 'system'); // scheduler-attributed, never a false 'user' (#3)
});

// ── AC-1.CLR.005.2 ────────────────────────────────────────────────────────────────────────────────
test('AC-1.CLR.005.2 — elapsed review, fail_closed=true → auto-revoked, audited, and still alerted (never silent)', async () => {
  const { store, sa } = await seeded();
  const row = await grantClearance(store, sa, { userId: 'u9' }, 'confidential', 'Invoice', { grantedAt: T0 });
  const alert = new InMemoryAlertSink();
  const { flagged, revoked } = await reviewOverdueClearances(store, { now: NOW, cadenceDays: 90, failClosed: true }, alert);

  assert.deepEqual(revoked, [row.id]);
  assert.deepEqual(flagged, []);
  assert.equal((await store.listClearances()).find((c) => c.id === row.id), undefined); // gone
  assert.equal(alert.alerts.length, 1);
  assert.equal(alert.alerts[0]!.kind, 'clearance_auto_revoked'); // still alerted
  const auditRow = (await store.audits()).find((a) => a.action === 'clearance-auto-revoked' && a.target_entity_id === row.id);
  assert.ok(auditRow);
  assert.equal(auditRow!.actor_type, 'system'); // the scheduler is 'system', not a falsely-attributed 'user' (#3)
});

test('OD-187 — a role-DEFAULT clearance is NEVER auto-revoked by the review sweep (even long-overdue + fail_closed)', async () => {
  // Role defaults provisioned LONG ago (T0) → overdue by NOW. The old sweep would have hard-deleted the six
  // roles' baseline clearances fleet-wide (#1 access-loss); the OD-187 fix excludes role_id-scoped rows.
  const store = new InMemoryRbacStore();
  await seedRoles(store, undefined, T0);
  const defaultsBefore = (await store.listClearances()).filter((c) => c.role_id !== null);
  assert.ok(defaultsBefore.length >= 6, 'seed produced the role-default clearances');
  const alert = new InMemoryAlertSink();
  const { flagged, revoked } = await reviewOverdueClearances(store, { now: NOW, cadenceDays: 90, failClosed: true }, alert);
  assert.deepEqual([flagged, revoked, alert.alerts.length], [[], [], 0]); // nothing swept, nothing alerted
  const defaultsAfter = (await store.listClearances()).filter((c) => c.role_id !== null);
  assert.equal(defaultsAfter.length, defaultsBefore.length); // the role-baseline substrate is intact
});

test('AC-1.CLR.005 (not-yet-due) — a recently-reviewed clearance is neither flagged nor revoked', async () => {
  const { store, sa } = await seeded();
  const row = await grantClearance(store, sa, { userId: 'u9' }, 'confidential', 'Invoice', { grantedAt: T0 });
  await confirmClearanceReview(store, sa, row.id!, NOW); // reviewed at NOW → clock reset
  const alert = new InMemoryAlertSink();
  const { flagged, revoked } = await reviewOverdueClearances(store, { now: NOW, cadenceDays: 90, failClosed: true }, alert);
  assert.deepEqual([flagged, revoked, alert.alerts.length], [[], [], 0]);
});

// ── AC-1.CLR.006.1 ────────────────────────────────────────────────────────────────────────────────
test('AC-1.CLR.006.1 — a memory outside the requester clearance is excluded BEFORE ranking', async () => {
  const { store } = await seeded('Finance', 'fin');
  const candidates = [
    { id: 'in-scope', sensitivity: 'confidential' as const, entityType: 'Invoice' },
    { id: 'out-of-scope', sensitivity: 'confidential' as const, entityType: 'Client' },
    { id: 'std', sensitivity: 'standard' as const, entityType: 'Client' },
    { id: 'restricted', sensitivity: 'restricted' as const, entityType: 'Invoice' },
  ];
  const visible = await applyClearanceControl(store, 'fin', candidates);
  // the out-of-scope Confidential + the Restricted are absent from the set a ranker would ever see
  assert.deepEqual(visible.map((c) => c.id).sort(), ['in-scope', 'std']);
});

// ── AC-1.RST.001.1 ────────────────────────────────────────────────────────────────────────────────
test('AC-1.RST.001.1 — Restricted cannot be set as a role default (per-individual only)', async () => {
  // structural: no DEFAULT_CLEARANCES entry is Restricted, and the tier type only admits confidential|personal
  for (const [, rows] of Object.entries(DEFAULT_CLEARANCES)) {
    for (const r of rows) assert.ok(r.tier === 'confidential' || r.tier === 'personal');
  }
  // and there is no seeded sensitivity_clearances row of a Restricted tier for any role
  const store = new InMemoryRbacStore();
  await seedRoles(store);
  const all = await store.listClearances();
  assert.ok(all.every((c) => (c.tier as string) !== 'restricted'));
});

test('AC-1.RST.001.1(guard) — the runtime guard TRIPS if a Restricted role default is ever smuggled in', () => {
  assert.doesNotThrow(() => assertNoRestrictedRoleDefault()); // clean by construction
  // inject a bad entry to prove the guard has teeth, then restore (the array is the module singleton)
  DEFAULT_CLEARANCES['Standard User'].push({ tier: 'restricted' as unknown as 'confidential', entity_type_scope: null });
  try {
    assert.throws(() => assertNoRestrictedRoleDefault(), /Restricted default/);
  } finally {
    DEFAULT_CLEARANCES['Standard User'].pop();
  }
  assert.doesNotThrow(() => assertNoRestrictedRoleDefault()); // restored
});

// ── AC-1.RST.001.2 ────────────────────────────────────────────────────────────────────────────────
test('AC-1.RST.001.2 — a non-Super-Admin attempting to grant Restricted is denied + audited', async () => {
  const { store } = await seeded('Admin', 'adminUser'); // Admin lacks PERM-user.grant_restricted
  await assert.rejects(
    () => grantRestricted(store, 'adminUser', 'grantee', 'legit reason', { grantedAt: T0 }),
    (e: unknown) => e instanceof RbacError && e.reason === ERR_DENIED,
  );
  assert.ok((await store.audits()).some((a) => a.action === 'denied:grant-restricted'));
  assert.equal((await store.listRestricted()).length, 0); // nothing written
});

// ── AC-1.RST.002.1 ────────────────────────────────────────────────────────────────────────────────
test('AC-1.RST.002.1 — a Restricted grant with no reason is rejected', async () => {
  const { store, sa } = await seeded();
  for (const bad of ['', '   ']) {
    await assert.rejects(
      () => grantRestricted(store, sa, 'grantee', bad, { grantedAt: T0 }),
      (e: unknown) => e instanceof RbacError && e.reason === ERR_REASON_REQUIRED,
    );
  }
  assert.equal((await store.listRestricted()).length, 0);
});

// ── AC-1.RST.002.2 ────────────────────────────────────────────────────────────────────────────────
test('AC-1.RST.002.2 — a Restricted grant writes an immutable audit record: granter, grantee, time, reason', async () => {
  const { store, sa } = await seeded();
  const row = await grantRestricted(store, sa, 'grantee-x', 'board-only diligence', { grantedAt: T0, entityId: 'e1' });
  // the grant row captures granter/grantee/reason/time
  assert.equal(row.grantee_user_id, 'grantee-x');
  assert.equal(row.granter_user_id, sa);
  assert.equal(row.reason, 'board-only diligence');
  assert.equal(row.granted_at, T0);
  // and an access_audit record captures the same who/when/why
  const audit = (await store.audits()).find((a) => a.action === 'grant-restricted');
  assert.ok(audit);
  assert.equal(audit!.actor_identity, sa); // granter
  assert.equal(audit!.target_entity_id, 'grantee-x'); // grantee
  assert.equal(audit!.reason, 'board-only diligence'); // why
});

// ── AC-1.RST.002.3 ────────────────────────────────────────────────────────────────────────────────
test('AC-1.RST.002.3 — a revoked Restricted grant denies access on the user next query', async () => {
  const { store, sa } = await seeded();
  const row = await grantRestricted(store, sa, 'grantee-y', 'reason', { grantedAt: T0 });
  assert.equal((await store.activeRestricted('grantee-y')).length, 1); // active before revoke
  await revokeRestricted(store, sa, row.id!, NOW);
  assert.equal((await store.activeRestricted('grantee-y')).length, 0); // instant — next query sees none
  assert.ok((await store.audits()).some((a) => a.action === 'revoke-restricted' && a.target_entity_id === row.id));
});

// ── AC-1.RST.003.1 ────────────────────────────────────────────────────────────────────────────────
test('AC-1.RST.003.1 — a holder still gets no auto-injection; Restricted surfaces only via explicit audited access', async () => {
  const { store, sa } = await seeded('Standard User', 'holder');
  await grantRestricted(store, sa, 'holder', 'holds a live grant', { grantedAt: T0, entityType: 'Client' });
  assert.equal((await store.activeRestricted('holder')).length, 1); // the holder DOES hold the grant
  // ...yet automatic retrieval still excludes the Restricted memory entirely (grant is irrelevant to auto-inject)
  const candidates = [{ id: 'r', sensitivity: 'restricted' as const, entityType: 'Client' }];
  assert.deepEqual(filterAutoInjectable(candidates), []);
  assert.deepEqual(await applyClearanceControl(store, 'holder', candidates), []);
});

// ── OD-186 portability guard ────────────────────────────────────────────────────────────────────────
test('OD-186 — a default scope token absent from the deployment entity_types fails the seed LOUD', async () => {
  const store = new InMemoryRbacStore();
  const entityTypesMissingClient = ['Invoice', 'Contract/Retainer', 'Financial Period', 'Deal', 'Team Member']; // no "Client"
  await assert.rejects(
    () => seedRoles(store, entityTypesMissingClient),
    (e: unknown) => e instanceof RbacError && e.reason === ERR_SCOPE_TOKEN_ABSENT && /Client/.test((e as Error).message),
  );
});

// ── FR-1.CLR.001 extension point + grant guards ─────────────────────────────────────────────────────
test('FR-1.CLR.001 — the model does not hardcode exactly four tiers (custom tier via the extension point)', () => {
  const withCustom = sensitivityTiers(['legal_privilege']);
  assert.equal(withCustom.length, 5);
  assert.ok(withCustom.includes('legal_privilege'));
  assert.equal(isAutoInjectable('legal_privilege'), false); // unknown/custom → fail closed, never silently Standard
});

test('grantClearance rejects a non-grantable tier (Standard is implicit; Restricted is grantRestricted)', async () => {
  const { store, sa } = await seeded();
  for (const bad of ['standard', 'restricted']) {
    await assert.rejects(
      () => grantClearance(store, sa, { userId: 'u' }, bad as 'confidential', 'Invoice', { grantedAt: T0 }),
      (e: unknown) => e instanceof RbacError && e.reason === ERR_BAD_TIER,
    );
  }
});

test('grantClearance is explicit + audited; revokeClearance deletes the row (effective next query)', async () => {
  const { store, sa } = await seeded();
  const row = await grantClearance(store, sa, { userId: 'u2' }, 'personal', null, { grantedAt: T0 });
  assert.equal(await hasClearanceFor(store, 'u2', 'personal', 'anything'), true); // Global scope covers all types
  assert.ok((await store.audits()).some((a) => a.action === 'grant-clearance' && a.target_entity_id === 'u2'));
  await revokeClearance(store, sa, row.id!);
  assert.equal(await hasClearanceFor(store, 'u2', 'personal', 'anything'), false);
  assert.ok((await store.audits()).some((a) => a.action === 'revoke-clearance' && a.target_entity_id === row.id));
});

test('a non-Super-Admin cannot grant a clearance (default-deny + audited)', async () => {
  const { store } = await seeded('Admin', 'adminUser');
  await assert.rejects(
    () => grantClearance(store, 'adminUser', { userId: 'v' }, 'confidential', 'Invoice', { grantedAt: T0 }),
    (e: unknown) => e instanceof RbacError && e.reason === ERR_DENIED,
  );
  assert.ok((await store.audits()).some((a) => a.action === 'denied:grant-clearance'));
});
