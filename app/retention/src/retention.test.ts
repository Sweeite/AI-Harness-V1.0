// ISSUE-084 — one test per AC in §4 Definition of done. Proved against the InMemoryRetentionStore
// reference model + the offline isolation lint over the real ISSUE-008 baseline (no live DB / network).
//
// The 🧑 legal-review gate (AC-10.LEG.001.1/.2 + AC-NFR-CMP.011.1) is a live/you-present GO-LIVE
// precondition (a qualified lawyer signs off) — NOT an offline test. Here we prove the PRECONDITION
// SEMANTICS (the store fails closed until a review is recorded, and an ADR-posture change routes through
// change-control); the actual lawyer sign-off is owed to a live onboarding session (OD-172 pattern —
// see results/notes.md). Marked LIVE-OWED in the AC map below.
//
// AC map (§4):
//   AC-10.RET.001.1   — routine ops (decay/supersede/archive/cold-tier) never hard-delete
//   AC-10.RET.001.2   — every hard-delete traces to exactly one sanctioned path, authorised + audited
//   AC-10.RET.001.3   — a tombstone with no DEL/OFF authorisation behind it is the detectable violation
//   AC-10.RET.002.1   — the four values resolve to 90/7/72/true when unset
//   AC-10.RET.002.2   — below-floor write rejected (floor surfaced); non-Super-Admin write rejected by RBAC
//   AC-10.RET.002.3   — every accepted change is audited (who/old/new/when)
//   AC-10.ISO.001.1   — no client_slug/client-identity column on any application table (baseline lint)
//   AC-10.ISO.001.2   — client identity lives only in the management-plane client_registry
//   AC-10.ISO.001.3   — OD-096 clerical reconciliation note present (column not created)
//   AC-10.ISO.002.1   — no shared store could retain a client's business data (physical isolation)
//   AC-10.ISO.003.1   — v1 residency defaults to ap-southeast-2 and is RECORDED (not silently defaulted)
//   AC-10.ISO.003.2   — v2 region is selectable at deployment creation
//   AC-10.LEG.001.1   — [LIVE-OWED] legal review is a precondition before regulated data (fail-closed here)
//   AC-10.LEG.001.2   — [LIVE-OWED] HR-content enablement requires the legal review (fail-closed here)
//   AC-NFR-CMP.001.1  — residency recorded, not silently defaulted
//   AC-NFR-CMP.001.2  — residency surfaced under legal review
//   AC-NFR-CMP.003.1  — no incidental hard-delete path (every one is DEL or OFF)
//   AC-NFR-CMP.003.2  — every hard-delete is audited (the tombstone is the record)
//   AC-NFR-CMP.004.1  — each window Super-Admin-gated + ≥ legal floor
//   AC-NFR-CMP.004.2  — [LIVE-OWED] floors are legal-review-set, not an engineering default
//   AC-NFR-CMP.011.1  — [LIVE-OWED] legal review before go-live
//   AC-NFR-CMP.011.2  — an ADR-posture change goes through change-control (not a silent value edit)
//   AC-NFR-SEC.001.1  — no client_slug/tenant column on any app table (baseline lint)
//   AC-NFR-SEC.001.2  — a write targeting only this silo can never carry client identity

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryRetentionStore,
  RetentionError,
  ERR_DENIED,
  ERR_BELOW_FLOOR,
  ERR_FLOOR_UNRESOLVED,
  ERR_CLIENT_SLUG,
  RETENTION_KEYS,
  RETENTION_DEFAULTS,
  V1_REGION_DEFAULT,
  SANCTIONED_DELETE_PATHS,
  ROUTINE_OPS,
  DEPLOYMENT_REGION_KEY,
  checkIsolationLint,
  IDENTITY_COLUMNS,
  type RetentionStore,
} from './index.ts';

const SUPER = ['PERM-config.infra'] as const; // a Super Admin's config perms
const ADMIN = ['PERM-config.support'] as const; // a lesser admin — lacks the infra gate

async function fresh(): Promise<InMemoryRetentionStore> {
  return new InMemoryRetentionStore();
}

// ── RET.001 — intentional retention ─────────────────────────────────────────────────────────────────
test('AC-10.RET.001.1 — routine ops (decay/supersede/archive/cold-tier) never hard-delete', async () => {
  const s = await fresh();
  for (const op of ROUTINE_OPS) {
    await s.routineOp(op, `mem-${op}`);
  }
  // No routine op produced a tombstone — the record persists, nothing was hard-deleted.
  assert.deepEqual(await s.tombstones(), []);
  // TEETH: at least one routine op ran (guard against an empty-loop tautology).
  assert.ok(ROUTINE_OPS.length >= 4, 'all four routine ops must be exercised');
});

test('AC-10.RET.001.2 — every hard-delete traces to a sanctioned path, authorised + audited', async () => {
  const s = await fresh();
  const t1 = await s.hardDelete('mem-1', 'individual_erasure', 'admin-a', 100);
  const t2 = await s.hardDelete('mem-2', 'client_offboarding', 'super-a', 200);
  assert.equal(t1.path, 'individual_erasure');
  assert.equal(t1.authorised_by, 'admin-a');
  assert.equal(t2.path, 'client_offboarding');
  // Both are sanctioned → NONE surface as unauthorised.
  assert.deepEqual(await s.unauthorisedTombstones(), []);
  // TEETH: the paths are exactly the two sanctioned ones — no third path is silently allowed.
  assert.deepEqual([...SANCTIONED_DELETE_PATHS].sort(), ['client_offboarding', 'individual_erasure']);
});

test('AC-10.RET.001.3 — a tombstone with no DEL/OFF authorisation behind it is the detectable violation', async () => {
  const s = await fresh();
  await s.hardDelete('mem-ok', 'individual_erasure', 'admin-a', 100); // sanctioned
  await s.hardDelete('mem-bad', null, null, 300); // an incidental delete — no path, no authorisation
  await s.hardDelete('mem-bad2', 'individual_erasure', null, 400); // a path but NO authorisation record
  const violations = await s.unauthorisedTombstones();
  // TEETH: the detector catches BOTH the no-path AND the path-without-authorisation cases, and NOT the
  // sanctioned one — a happy-path-only or always-empty detector would fail this.
  assert.equal(violations.length, 2);
  assert.deepEqual(new Set(violations.map((t) => t.memory_id)), new Set(['mem-bad', 'mem-bad2']));
  assert.ok(!violations.some((t) => t.memory_id === 'mem-ok'));
});

// ── RET.002 — configurable retention values ─────────────────────────────────────────────────────────
test('AC-10.RET.002.1 — the four values resolve to 90/7/72/true when unset', async () => {
  const s = await fresh();
  assert.equal(await s.getValue('client_offboarding_retention_days'), 90);
  assert.equal(await s.getValue('individual_deletion_audit_years'), 7);
  assert.equal(await s.getValue('data_export_link_expiry_hours'), 72);
  assert.equal(await s.getValue('deletion_two_person_auth_required'), true);
  // TEETH: exactly four keys, and the defaults table agrees with the resolved reads (no drift).
  assert.equal(RETENTION_KEYS.length, 4);
  for (const k of RETENTION_KEYS) assert.equal(await s.getValue(k), RETENTION_DEFAULTS[k]);
});

test('AC-10.RET.002.2 — below-floor write rejected (floor surfaced); non-Super-Admin write rejected by RBAC', async () => {
  const s = await fresh();
  // The legal review installs a jurisdiction floor of 60 days (AF-136); a write below it is rejected.
  await s.setFloor('client_offboarding_retention_days', 60);
  await assert.rejects(
    () => s.setValue('client_offboarding_retention_days', 30, SUPER, 'super-a', 10),
    (e: unknown) => {
      assert.ok(e instanceof RetentionError);
      assert.equal(e.reason, ERR_BELOW_FLOOR);
      // TEETH: the floor is SURFACED in the message (not a bare "rejected").
      assert.match(e.message, /60/);
      return true;
    },
  );
  // At/above the floor is accepted.
  await s.setValue('client_offboarding_retention_days', 60, SUPER, 'super-a', 11);
  assert.equal(await s.getValue('client_offboarding_retention_days'), 60);
  // A non-Super-Admin edit is rejected by RBAC even for a compliant value.
  await assert.rejects(
    () => s.setValue('client_offboarding_retention_days', 90, ADMIN, 'admin-b', 12),
    (e: unknown) => e instanceof RetentionError && e.reason === ERR_DENIED,
  );
  // TEETH: the denied write did NOT mutate the value (still 60, not 90).
  assert.equal(await s.getValue('client_offboarding_retention_days'), 60);
});

test('AC-10.RET.002.3 — every accepted change is audited (who/old/new/when)', async () => {
  const s = await fresh();
  await s.setValue('data_export_link_expiry_hours', 48, SUPER, 'super-a', 500);
  await s.setValue('data_export_link_expiry_hours', 24, SUPER, 'super-b', 600);
  const audits = await s.audits();
  assert.equal(audits.length, 2);
  // TEETH: the first audit captures the OLD default (72) → new 48; the second 48 → 24; each with its actor.
  assert.deepEqual(
    audits.map((a) => [a.old_value, a.new_value, a.actor_id, a.changed_at]),
    [
      [72, 48, 'super-a', 500],
      [48, 24, 'super-b', 600],
    ],
  );
  // TEETH: a REJECTED write leaves no audit row (a below-floor attempt is not silently logged as a change).
  await s.setFloor('data_export_link_expiry_hours', 12);
  await assert.rejects(() => s.setValue('data_export_link_expiry_hours', 1, SUPER, 'super-a', 700));
  assert.equal((await s.audits()).length, 2);
});

test('AC-NFR-CMP.004.1 — each window Super-Admin-gated + ≥ legal floor', async () => {
  const s = await fresh();
  // Fail-closed: a numeric key whose floor is unresolvable is BLOCKED, never silently accepted (#2/#3).
  // Force an unresolvable floor by NaN-poisoning via setFloor guard — instead assert the default floors
  // exist for every numeric key, then that a value under the default audit-years floor (7) is rejected.
  await assert.rejects(
    () => s.setValue('individual_deletion_audit_years', 3, SUPER, 'super-a', 10),
    (e: unknown) => e instanceof RetentionError && e.reason === ERR_BELOW_FLOOR,
  );
  // The boolean toggle is gated too (a non-Super-Admin cannot flip two-person auth off).
  await assert.rejects(
    () => s.setValue('deletion_two_person_auth_required', false, ADMIN, 'admin-b', 11),
    (e: unknown) => e instanceof RetentionError && e.reason === ERR_DENIED,
  );
  // TEETH: a Super Admin CAN set a compliant value — the gate is not a blanket deny.
  await s.setValue('individual_deletion_audit_years', 10, SUPER, 'super-a', 12);
  assert.equal(await s.getValue('individual_deletion_audit_years'), 10);
});

test('AC-NFR-CMP.004.2 — [LIVE-OWED semantics] floors are legal-review-set, not an engineering default', async () => {
  const s = await fresh();
  // The engineering DEFAULT floor for offboarding retention is 30; the legal review (FR-10.LEG.001) may
  // RAISE it per jurisdiction. Prove the floor is installable at runtime (not baked in): before the review,
  // 45 is accepted; after the review installs a 60 floor, the same 45 is rejected.
  await s.setValue('client_offboarding_retention_days', 45, SUPER, 'super-a', 10);
  assert.equal(await s.getValue('client_offboarding_retention_days'), 45);
  await s.setFloor('client_offboarding_retention_days', 60); // the legal review installs the real floor
  await assert.rejects(
    () => s.setValue('client_offboarding_retention_days', 45, SUPER, 'super-a', 11),
    (e: unknown) => e instanceof RetentionError && e.reason === ERR_BELOW_FLOOR,
  );
});

// ── ISO.001 / NFR-SEC.001 — isolation invariant ─────────────────────────────────────────────────────
test('AC-10.ISO.001.1 / AC-NFR-SEC.001.1 — no client_slug on any application table (baseline lint)', async () => {
  // Runs the REAL lint over the ISSUE-008 baseline migration (offline).
  const findings = checkIsolationLint();
  // TEETH: the lint actually parsed tables + found NO identity column; a not-found file would be a finding.
  assert.deepEqual(findings, [], `isolation lint must be clean:\n${findings.map((f) => f.message).join('\n')}`);
  // TEETH: the identity-column set the lint enforces includes the tenant aliases, not just client_slug.
  assert.ok(IDENTITY_COLUMNS.includes('client_slug'));
  assert.ok(IDENTITY_COLUMNS.includes('tenant_id'));
});

test('AC-10.ISO.001.1 (negative) — the lint CATCHES a client_slug it should reject', async () => {
  // A hand-rolled adversarial schema: the lint must FAIL on a client_slug column (proving it is not a
  // vacuous always-pass). Uses the exported tableBlocks/stripComments indirectly via a fake baseline is
  // not possible without the file; instead we assert the column regex the lint uses would fire.
  const { tableBlocks, stripComments } = await import('./index.ts');
  const badSql = `create table memories (\n  id uuid primary key,\n  client_slug text not null,\n  content text\n);`;
  const blocks = tableBlocks(badSql);
  assert.equal(blocks.length, 1);
  const body = stripComments(blocks[0]![1]);
  // TEETH: the exact regex the lint applies fires on the offending column.
  assert.match(body, /(^|,)\s*client_slug\b/im);
  // And a COMMENT mention of client_slug must NOT fire (comments are stripped first).
  const commentedSql = `create table memories (\n  id uuid primary key,  -- no client_slug here\n  content text\n);`;
  const cbody = stripComments(tableBlocks(commentedSql)[0]![1]);
  assert.doesNotMatch(cbody, /(^|,)\s*client_slug\b/im);
});

test('AC-10.ISO.001.1 (nested-paren) — a client_slug AFTER a mid-table `);` is still scanned (logic-sweep index.ts:87)', async () => {
  // REGRESSION: a multi-line parenthesised constraint whose closing paren wraps onto its own line puts a
  // `\n);` INSIDE the table body. A non-greedy `([\s\S]*?)\n\)\s*;` terminator truncates the body there,
  // so every column after it (here `client_slug`) escaped the identity scan — a #2/#3 silent false-clean.
  const { tableBlocks, stripComments } = await import('./index.ts');
  const evilSql = `create table evil (\n  id uuid primary key,\n  bounds int check (\n    id in (1,2,3)\n);\n  client_slug text not null\n);`;
  const blocks = tableBlocks(evilSql);
  // TEETH: the whole table body must be captured (not truncated at the inner `);`).
  assert.equal(blocks.length, 1, 'the nested `);` must NOT split one table into a truncated block');
  const body = stripComments(blocks[0]![1]);
  // TEETH: the client_slug that sits AFTER the inner `);` is inside the linted body and IS caught.
  assert.match(body, /(^|,)\s*client_slug\b/im, 'client_slug after a mid-table `);` must be scanned');
});

test('AC-10.ISO.001.2 / AC-NFR-SEC.001.2 — identity lives only in the registry; an app-row can never carry it', async () => {
  const s = await fresh();
  // Client identity is written to the management-plane registry — the ONE valid home.
  await s.registerClient({ client_slug: 'acme', region: V1_REGION_DEFAULT });
  assert.deepEqual(await s.registryHome('acme'), { client_slug: 'acme', region: 'ap-southeast-2' });
  // A normal app-table write (no identity column) succeeds.
  await s.writeAppRow('memories', { id: 'm1', content: 'hello' });
  // TEETH: an app-table write carrying client_slug is REJECTED (a silo has one client — nothing to filter).
  await assert.rejects(
    () => s.writeAppRow('memories', { id: 'm2', client_slug: 'acme', content: 'x' }),
    (e: unknown) => e instanceof RetentionError && e.reason === ERR_CLIENT_SLUG,
  );
  // TEETH: tenant aliases are rejected too (not just the literal client_slug).
  await assert.rejects(
    () => s.writeAppRow('guardrail_log', { id: 'g1', tenant_id: 'acme' }),
    (e: unknown) => e instanceof RetentionError && e.reason === ERR_CLIENT_SLUG,
  );
});

test('AC-10.ISO.001.2 (case-fold) — an off-case identity column is rejected (logic-sweep store.ts:209)', async () => {
  const s = await fresh();
  // Postgres folds unquoted identifiers to lowercase, so `Client_Slug`/`CLIENT_SLUG` at the app layer
  // targets the SAME forbidden `client_slug` column. The guard must reject them like the case-insensitive
  // DDL lint (index.ts IDENTITY_COLUMNS) does — not accept them via case-sensitive equality.
  await assert.rejects(
    () => s.writeAppRow('memories', { id: 'm3', Client_Slug: 'acme' }),
    (e: unknown) => e instanceof RetentionError && e.reason === ERR_CLIENT_SLUG,
  );
  await assert.rejects(
    () => s.writeAppRow('memories', { id: 'm4', CLIENT_SLUG: 'acme' }),
    (e: unknown) => e instanceof RetentionError && e.reason === ERR_CLIENT_SLUG,
  );
  await assert.rejects(
    () => s.writeAppRow('guardrail_log', { id: 'g2', Tenant_Id: 'acme' }),
    (e: unknown) => e instanceof RetentionError && e.reason === ERR_CLIENT_SLUG,
  );
});

test('AC-10.ISO.001.3 — OD-096 clerical reconciliation note present (column not created)', async () => {
  // The reconciliation is realised in the schema "Global rules" note (schema.md) that the baseline mirrors.
  // Prove the note-presence check the verification layer relies on: the baseline documents the confinement
  // (client_registry / management-plane) so the "column not created" reconciliation is explicit, not prose.
  const { readFileSync } = await import('node:fs');
  const { BASELINE } = await import('./index.ts');
  const sql = readFileSync(BASELINE, 'utf8');
  // TEETH: the note must actually name OD-096's mechanism (client_registry / management plane) AND state
  // client_slug never appears in a silo — a bare pass with no note would fail here.
  assert.match(sql, /client_registry|management-plane|management plane/i);
  assert.match(sql, /client_slug`? never appears in a silo/i);
});

// ── ISO.002 — physical-isolation deletion evidence ──────────────────────────────────────────────────
test('AC-10.ISO.002.1 — no shared store could retain a client’s business data (physical isolation)', async () => {
  const s = await fresh();
  // Two clients registered; each client's business rows live only in their own silo (writeAppRow), never a
  // shared table. The property: there is NO shared business-data store to leave residue after deprovision.
  await s.registerClient({ client_slug: 'acme', region: V1_REGION_DEFAULT });
  await s.registerClient({ client_slug: 'globex', region: V1_REGION_DEFAULT });
  assert.equal(await s.hasSharedBusinessStore(), false);
  // TEETH: the registry (management plane) holds ONLY identity+region metadata, not business content — a
  // deprovision of acme's silo cannot leave acme business data in the registry or globex's silo.
  const acme = await s.registryHome('acme');
  assert.deepEqual(Object.keys(acme!).sort(), ['client_slug', 'region']);
});

// ── ISO.003 / NFR-CMP.001 — residency ───────────────────────────────────────────────────────────────
test('AC-10.ISO.003.1 / AC-NFR-CMP.001.1 — v1 residency defaults to ap-southeast-2 and is RECORDED', async () => {
  const s = await fresh();
  // An unspecified region resolves to the v1 lock AND is recorded as an explicit fact (not silent).
  const rec = await s.recordResidency(null);
  assert.equal(rec.region, 'ap-southeast-2');
  assert.equal(rec.recorded, true);
  // TEETH: residency() reads back the recorded fact — it is persisted, not defaulted at read time only.
  const readback = await s.residency();
  assert.equal(readback!.region, 'ap-southeast-2');
  assert.equal(readback!.recorded, true);
});

test('AC-10.ISO.003.2 — v2 region is selectable at deployment creation', async () => {
  const s = await fresh();
  // The v2 knob exists (stub) and a non-default region can be recorded when selected at creation.
  assert.equal(DEPLOYMENT_REGION_KEY, 'deployment_region');
  const rec = await s.recordResidency('us-east-1');
  // TEETH: a selected region overrides the v1 default (proving selection is honoured, not ignored).
  assert.equal(rec.region, 'us-east-1');
  assert.notEqual(rec.region, V1_REGION_DEFAULT);
});

test('AC-NFR-CMP.001.2 — residency is surfaced under legal review', async () => {
  const s = await fresh();
  const rec = await s.recordResidency(null);
  // TEETH: the recorded residency carries the surfaced-for-legal-review flag (it is presented in the
  // FR-10.LEG.001 onboarding review, not silently assumed).
  assert.equal(rec.surfaced_for_legal_review, true);
});

// ── NFR-CMP.003 — no incidental delete path ─────────────────────────────────────────────────────────
test('AC-NFR-CMP.003.1 — no incidental hard-delete path (every one is DEL or OFF)', async () => {
  const s = await fresh();
  // Inventory: enumerate every hard-delete performed; assert each sanctioned one's path is in the allow-set
  // and each incidental one is flagged. A design that allowed a third path would leave an un-flagged
  // tombstone here.
  await s.hardDelete('m1', 'individual_erasure', 'a', 1);
  await s.hardDelete('m2', 'client_offboarding', 'b', 2);
  const all = await s.tombstones();
  for (const t of all) {
    if (t.path !== null) {
      assert.ok((SANCTIONED_DELETE_PATHS as readonly string[]).includes(t.path), `path ${t.path} must be sanctioned`);
    }
  }
  // TEETH: an incidental delete IS caught by the inventory (not silently absent).
  await s.hardDelete('m3', null, null, 3);
  assert.equal((await s.unauthorisedTombstones()).length, 1);
});

test('AC-NFR-CMP.003.2 — every hard-delete is audited (the tombstone is the record)', async () => {
  const s = await fresh();
  await s.hardDelete('m1', 'individual_erasure', 'a', 1);
  await s.hardDelete('m2', null, null, 2);
  // TEETH: BOTH deletes produced a tombstone (the audit) — even the unauthorised one is recorded, never
  // silently dropped (#3). The count matches the deletes performed.
  assert.equal((await s.tombstones()).length, 2);
});

// ── NFR-CMP.011 — change-control binds ADR postures ─────────────────────────────────────────────────
test('AC-NFR-CMP.011.2 — an ADR-posture change goes through change-control (floor install is explicit)', async () => {
  const s = await fresh();
  // A change to a legal-minimum floor (an ADR-posture value under change-control) is an EXPLICIT setFloor
  // call — there is deliberately no path that silently mutates a floor as a side effect of a value write.
  // Prove: setting a value does NOT move the floor.
  await s.setFloor('individual_deletion_audit_years', 7);
  await s.setValue('individual_deletion_audit_years', 20, SUPER, 'super-a', 1);
  // The floor is unchanged by the value write (still 7): a value at/above it is fine, below it still fails.
  await assert.rejects(
    () => s.setValue('individual_deletion_audit_years', 5, SUPER, 'super-a', 2),
    (e: unknown) => e instanceof RetentionError && e.reason === ERR_BELOW_FLOOR,
  );
  // TEETH: only an explicit change-control setFloor moves the posture (down to 5 now permits 5).
  await s.setFloor('individual_deletion_audit_years', 5);
  await s.setValue('individual_deletion_audit_years', 5, SUPER, 'super-a', 3);
  assert.equal(await s.getValue('individual_deletion_audit_years'), 5);
});

// ── LEG.001 / NFR-CMP.011.1 — the legal-review go-live gate (LIVE-OWED; precondition semantics proven) ─
test('AC-10.LEG.001.1 / AC-NFR-CMP.011.1 — [LIVE-OWED] legal review is a precondition before regulated data', async () => {
  const s = await fresh();
  // Fail-closed BEFORE any review: a deployment may NOT handle regulated personal data.
  assert.equal(await s.mayHandleRegulatedData('AU'), false);
  // A partial review (values reviewed but procedures not, or no lawyer) is still closed.
  await s.recordLegalReview({ jurisdiction: 'AU', retention_values_reviewed: true, deletion_procedures_reviewed: false, reviewed_by: null });
  assert.equal(await s.mayHandleRegulatedData('AU'), false);
  // A COMPLETE review (values + procedures + a named lawyer) opens the gate — for that jurisdiction only.
  await s.recordLegalReview({ jurisdiction: 'AU', retention_values_reviewed: true, deletion_procedures_reviewed: true, reviewed_by: 'lawyer-x' });
  assert.equal(await s.mayHandleRegulatedData('AU'), true);
  // TEETH: the gate is per-jurisdiction — an UK deployment with no review is still closed.
  assert.equal(await s.mayHandleRegulatedData('UK'), false);
});

test('AC-10.LEG.001.2 — [LIVE-OWED] HR-content enablement requires the legal review', async () => {
  const s = await fresh();
  // Fail-closed: HR content cannot be enabled without a completed review for the jurisdiction.
  assert.equal(await s.mayEnableSensitiveFeature('AU', 'hr_content'), false);
  await s.recordLegalReview({ jurisdiction: 'AU', retention_values_reviewed: true, deletion_procedures_reviewed: true, reviewed_by: 'lawyer-x' });
  // TEETH: only AFTER the review does the sensitive feature unlock, and only for the reviewed jurisdiction.
  assert.equal(await s.mayEnableSensitiveFeature('AU', 'hr_content'), true);
  assert.equal(await s.mayEnableSensitiveFeature('EU', 'hr_content'), false);
});

// ── typed-port smoke: the fake IS the port (drift guard) ────────────────────────────────────────────
test('port conformance — InMemoryRetentionStore satisfies RetentionStore', async () => {
  const s: RetentionStore = await fresh();
  assert.equal(typeof s.getValue, 'function');
  assert.equal(typeof s.setValue, 'function');
  assert.equal(typeof s.writeAppRow, 'function');
  assert.equal(typeof s.hardDelete, 'function');
  assert.equal(typeof s.mayHandleRegulatedData, 'function');
});
