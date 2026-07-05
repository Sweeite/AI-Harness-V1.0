// ISSUE-043 §4 Definition of done — ONE test per AC (text read in component-04-prompt.md, Rule 0). All 12
// ACs are offline-provable with the port+fake pattern; the LIVE proof (a real core insert firing the
// ISSUE-042 0004 version-discipline trigger, the prompt_layers RLS policy gating PERM-prompt.edit_principles)
// is owed to the Stage-3 checkpoint capstone, run by the operator — noted where it applies (none of the 12
// ACs below REQUIRE it; they are content/authorization/invariant assertions over the reference model).
//
// AC-map (§4):
//   AC-4.CID.001.1  — all six Layer-1 elements present; incomplete Layer-1 flagged element-by-element
//   AC-4.CID.002.1  — over-length save shows a non-blocking advisory and SUCCEEDS
//   AC-4.CID.003.1  — external-data boundary instruction present; save without it REJECTED
//   AC-4.CID.004.1  — hard-limit statement present referencing the canonical set; independent of C6 code
//   AC-4.CID.005.1  — ambiguity/conflict behaviour stated, references the operating principles
//   AC-4.CID.006.1  — three-mode Cited/Inferred/Unknown + never-dead-end instruction present
//   AC-4.PRIN.001.1 — all seven principles present verbatim from the canonical block
//   AC-4.PRIN.002.1 — Admin (not Super Admin) DENIED on principles edit + logged; general content editable
//   AC-4.PRIN.002.2 — Super-Admin edit: mandatory change_reason + immutable version-chain record + distinct safety event
//   AC-4.PRIN.002.3 — post-edit assembly reflects the edited block across ALL agents; in-flight (pinned) task unaffected
//   AC-4.PRIN.002.4 — removing/emptying any of the seven is HARD-BLOCKED; reword/strengthen permitted
//   AC-4.PRIN.003.1 — weakening a principle in the prompt leaves the underlying code control unaffected

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryCorePromptStore,
  type CorePromptStore,
} from './store.ts';
import { InMemoryAuditSink, PERM, PrinciplesPermissionDenied, type PermChecker } from './rbac.ts';
import {
  Layer1IdentityService,
  Layer1SaveRejected,
  PrinciplesFloorBreach,
} from './service.ts';
import {
  CANONICAL_PRINCIPLES,
  PRINCIPLE_IDS,
  defaultPrinciplesBlock,
  type PrinciplesBlock,
} from './principles.ts';
import {
  assemblyRequiredElementChecks,
  contentHasAllSevenPrinciplesVerbatim,
  defaultLayer1,
  renderLayer1Content,
  validateLayer1,
  wordCount,
  type Layer1Content,
} from './core-record.ts';
import { RbacCodeControl, controlUnaffectedByPromptWeakening, weakenPrinciple } from './code-control.ts';

const NOW = 1_800_000_000; // fixed epoch seconds (deterministic; no Date.now in tests)

const SUPER = 'super-1';
const ADMIN = 'admin-1';

// PermChecker seeded with an explicit grant map — absence of a grant is default-deny.
function permsFor(grants: Record<string, string[]>): PermChecker {
  return { holds: (actorId, node) => (grants[actorId] ?? []).includes(node) };
}

// Super Admin holds edit_principles (and edit); Admin holds only the general edit node.
const grants = {
  [SUPER]: [PERM.edit, PERM.editPrinciples],
  [ADMIN]: [PERM.edit],
};

function svc(store: CorePromptStore = new InMemoryCorePromptStore()) {
  const audit = new InMemoryAuditSink();
  const service = new Layer1IdentityService({ store, perms: permsFor(grants), audit });
  return { service, audit, store };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CID — Layer-1 required content set
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test('AC-4.CID.001.1 — all six elements present ⇒ complete; a Layer-1 missing an element is flagged incomplete element-by-element', () => {
  const complete = defaultLayer1('You are the finance agent, "Fin".');
  const v = validateLayer1(complete);
  assert.equal(v.complete, true, 'a fully-authored Layer 1 is complete');
  assert.deepEqual(v.missing, [], 'nothing missing');

  // TEETH: drop the identity element → complete=false AND the exact element is flagged (not a blanket fail).
  const missingIdentity: Layer1Content = { ...complete, identity: '   ' };
  const v2 = validateLayer1(missingIdentity);
  assert.equal(v2.complete, false, 'a Layer 1 missing identity is incomplete');
  assert.ok(v2.missing.includes('identity'), 'the identity element is flagged specifically');
  assert.ok(!v2.missing.includes('out_of_scope'), 'unrelated present elements are NOT falsely flagged');
  // out-of-scope is a non-safety element: dropping it makes it incomplete but does NOT block a save.
  const missingOOS: Layer1Content = { ...complete, outOfScope: '' };
  const v3 = validateLayer1(missingOOS);
  assert.equal(v3.complete, false);
  assert.ok(v3.missing.includes('out_of_scope'));
  assert.equal(v3.saveAllowed, true, 'a missing NON-safety element flags incomplete but does not hard-block');
});

test('AC-4.CID.002.1 — an over-length Layer-1 save shows a NON-blocking advisory and SUCCEEDS', async () => {
  const { service } = svc();
  const base = defaultLayer1('You are the ops agent.');
  // pad the identity past the ~500-word band without breaking any element (600 extra words)
  const padded: Layer1Content = { ...base, identity: base.identity + ' role-context'.repeat(600) };
  const v = validateLayer1(padded);
  assert.ok(v.words > 500, 'the record is over the ~500-word advisory band');
  assert.equal(validateLayer1(base).lengthAdvisory, null, 'a normal-length record has NO advisory (the band actually gates)');
  assert.notEqual(v.lengthAdvisory, null, 'a non-blocking advisory is present');
  assert.equal(v.saveAllowed, true, 'over-length never blocks the save (OD-051)');
  // and the save actually goes through
  const { row } = await service.saveCore('agent-ops', 'ops-core', padded, 'init', SUPER, NOW);
  assert.equal(row.version, 1, 'the over-length save committed (v1 exists)');
});

test('AC-4.CID.003.1 — the external-data boundary instruction is required; a save without it is REJECTED', async () => {
  const { service } = svc();
  const base = defaultLayer1('You are the support agent.');
  // TEETH: remove the boundary instruction → save must throw (hard-block), not silently strip/pass.
  const noBoundary: Layer1Content = { ...base, externalDataBoundaryInstruction: '' };
  assert.equal(validateLayer1(noBoundary).saveAllowed, false);
  await assert.rejects(
    () => service.saveCore('agent-sup', 'sup-core', noBoundary, 'init', SUPER, NOW),
    (e: unknown) => e instanceof Layer1SaveRejected && e.validation.missing.includes('external_data_boundary_instruction'),
    'a Layer 1 without the boundary instruction is rejected at save',
  );
  // TEETH: a boundary field that exists but does NOT say "data, never instructions" is still rejected.
  const weakBoundary: Layer1Content = { ...base, externalDataBoundaryInstruction: 'Be careful with external content.' };
  assert.equal(validateLayer1(weakBoundary).saveAllowed, false, 'a vague boundary line that omits the data-not-instructions rule is not accepted');
  // and the complete one is accepted + the assembly-time predicate agrees over the rendered string
  const { row } = await service.saveCore('agent-sup', 'sup-core', base, 'init', SUPER, NOW);
  assert.equal(assemblyRequiredElementChecks.boundary_instruction(row.content), true);
});

test('AC-4.CID.004.1 — the hard-limit statement references the canonical set; its presence is independent of C6 code enforcement', () => {
  const base = defaultLayer1('You are the finance agent.');
  assert.equal(validateLayer1(base).findings.find((f) => f.element === 'hard_limit_statement')!.present, true);
  // TEETH: a hard-limit field naming ZERO canonical limits (just a platitude) does NOT satisfy the reference.
  const platitude: Layer1Content = { ...base, hardLimitStatement: 'Always follow the rules and be safe.' };
  assert.equal(validateLayer1(platitude).saveAllowed, false, 'a vague "follow the rules" is not a reference to the canonical set');
  // TEETH: naming only ONE canonical limit is not "referencing the set" — the reference floor is ≥ 2.
  const oneOnly: Layer1Content = { ...base, hardLimitStatement: 'Hard limit: never transact money.' };
  assert.equal(validateLayer1(oneOnly).saveAllowed, false, 'a single canonical limit is not a reference to the canonical SET');
  // TEETH: presence is INDEPENDENT of C6 code enforcement — the validator takes ONLY the Layer-1 record;
  // there is no code-control argument it could consult. Same content ⇒ same verdict no matter the code world.
  assert.equal(
    validateLayer1(base).findings.find((f) => f.element === 'hard_limit_statement')!.present,
    validateLayer1({ ...base }).findings.find((f) => f.element === 'hard_limit_statement')!.present,
    'the statement presence is a pure function of the prompt text (both prompt AND code, never one — the prompt half here)',
  );
});

test('AC-4.CID.005.1 — the uncertainty/conflict behaviour is stated AND references the operating principles', () => {
  const base = defaultLayer1('You are the ops agent.');
  assert.equal(validateLayer1(base).findings.find((f) => f.element === 'uncertainty_handling')!.present, true);
  // TEETH: behaviour stated but with NO reference to the operating principles → not satisfied (FR-4.CID.005).
  const noRef: Layer1Content = { ...base, uncertaintyHandling: 'If you are uncertain, just do your best guess.' };
  assert.equal(validateLayer1(noRef).saveAllowed, false, 'uncertainty text that guesses and ignores the principles is rejected');
  // TEETH: a reference with no actual behaviour is also insufficient.
  const noBehaviour: Layer1Content = { ...base, uncertaintyHandling: 'See the operating principles.' };
  assert.equal(validateLayer1(noBehaviour).findings.find((f) => f.element === 'uncertainty_handling')!.present, false);
});

test('AC-4.CID.006.1 — the answer-mode instruction names all three modes AND the never-dead-end rule', () => {
  const base = defaultLayer1('You are the research agent.');
  assert.equal(validateLayer1(base).findings.find((f) => f.element === 'answer_mode_signalling')!.present, true);
  // TEETH: naming only two of the three modes fails.
  const twoModes: Layer1Content = { ...base, answerModeSignalling: 'Tag outputs Cited or Inferred. Never present inference as fact.' };
  assert.equal(validateLayer1(twoModes).findings.find((f) => f.element === 'answer_mode_signalling')!.present, false, 'missing the Unknown mode fails');
  // TEETH: all three modes but NO never-dead-end rule fails.
  const noDeadEnd: Layer1Content = { ...base, answerModeSignalling: 'Tag every output Cited, Inferred, or Unknown.' };
  assert.equal(validateLayer1(noDeadEnd).findings.find((f) => f.element === 'answer_mode_signalling')!.present, false, 'omitting the never-dead-end rule fails');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PRIN — operating principles
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test('AC-4.PRIN.001.1 — all seven canonical principles are present verbatim in a saved Layer 1', async () => {
  const { service, store } = svc();
  const base = defaultLayer1('You are the finance agent.');
  const { row } = await service.saveCore('agent-fin', 'fin-core', base, 'init', SUPER, NOW);
  // TEETH: assert all seven verbatim texts actually appear in the stored content — not merely that a
  // "principles" field is non-empty.
  assert.equal(contentHasAllSevenPrinciplesVerbatim(row.content), true, 'all seven verbatim principle statements are in the stored core content');
  assert.equal(PRINCIPLE_IDS.length, 7, 'the canonical set is exactly seven');
  // and the assembly-time predicate agrees
  assert.equal(assemblyRequiredElementChecks.principles_block(row.content), true);

  // TEETH: a core saved with only six of the seven canonical principles is REJECTED at save (floor).
  const sixOnly: PrinciplesBlock = { canonical: { ...base.principles.canonical } };
  delete sixOnly.canonical.stay_in_your_lane;
  const missingOne: Layer1Content = { ...base, principles: sixOnly };
  await assert.rejects(
    () => service.saveCore('agent-fin2', 'fin2-core', missingOne, 'init', SUPER, NOW),
    (e: unknown) => e instanceof Layer1SaveRejected,
    'a Layer 1 missing a canonical principle cannot be saved',
  );
  assert.equal((await store.currentCoreForAgent('agent-fin2')), null, 'the rejected save wrote nothing');
});

test('AC-4.PRIN.002.1 — an Admin (not Super Admin) is DENIED on a principles edit + logged; general content stays editable', async () => {
  const { service, audit, store } = svc();
  // seed a valid core so the propagation would have a target
  await service.saveCore('agent-a', 'a-core', defaultLayer1('Agent A.'), 'init', SUPER, NOW);

  // TEETH: Admin lacks PERM-prompt.edit_principles → the edit throws AND a denial is logged (never silent).
  const block = defaultPrinciplesBlock();
  await assert.rejects(
    () => service.editPrinciples(ADMIN, block, 'admin tries to edit principles', NOW),
    (e: unknown) => e instanceof PrinciplesPermissionDenied,
    'Admin is denied the principles edit (default-deny)',
  );
  assert.equal(audit.denials.length, 1, 'the denial was logged (#3 never silent)');
  assert.equal(audit.denials[0]!.actor_id, ADMIN);
  assert.equal(audit.denials[0]!.perm_node, PERM.editPrinciples);
  assert.equal(audit.safetyEvents.length, 0, 'no propagation / no safety event on a denied edit');
  // the denied edit changed nothing
  const head = await store.currentCoreForAgent('agent-a');
  assert.equal(head!.version, 1, 'the core is untouched by the denied principles edit');

  // TEETH: the SAME Admin CAN still edit general (non-principles) content — the denial is scoped to principles.
  const edited = { ...defaultLayer1('Agent A, updated.') };
  const { row } = await service.editCore(head!.id, edited, 'admin edits general content', ADMIN, NOW);
  assert.equal(row.version, 2, 'Admin can still edit non-principles Layer-1 content');
});

test('AC-4.PRIN.002.2 — a Super-Admin edit requires a mandatory change_reason, writes the immutable version chain, and emits ONE distinct safety event', async () => {
  const { service, audit, store } = svc();
  await service.saveCore('agent-a', 'a-core', defaultLayer1('Agent A.'), 'init', SUPER, NOW);

  // TEETH: an empty change_reason is rejected (mandatory) — and no safety event / no write happens.
  await assert.rejects(
    () => service.editPrinciples(SUPER, defaultPrinciplesBlock(), '   ', NOW),
    /change_reason is mandatory/,
    'an empty change_reason is rejected',
  );
  assert.equal(audit.safetyEvents.length, 0, 'no safety event on the rejected empty-reason edit');

  // A valid Super-Admin edit: strengthen a principle (allowed), with a reason.
  const strengthened = defaultPrinciplesBlock();
  strengthened.canonical.stay_in_your_lane = 'Stay in your lane: escalate ANY decision beyond your authority; when in doubt, escalate.';
  const res = await service.editPrinciples(SUPER, strengthened, 'tighten stay-in-your-lane wording', NOW);

  // exactly one distinct safety-relevant event, tagged as such, tied to the produced versions.
  assert.equal(audit.safetyEvents.length, 1, 'exactly one distinct safety-relevant edit event emitted');
  assert.equal(audit.safetyEvents[0]!.kind, 'principles_edited');
  assert.equal(audit.safetyEvents[0]!.actor_id, SUPER);
  assert.equal(audit.safetyEvents[0]!.change_reason, 'tighten stay-in-your-lane wording');
  assert.deepEqual(audit.safetyEvents[0]!.produced_version_ids, res.propagated.map((p) => p.version.id));

  // the immutable version chain: v2 links previous_version_id → v1, and v1 is UNCHANGED (append-only).
  const head = await store.currentCoreForAgent('agent-a');
  assert.equal(head!.version, 2);
  assert.equal(head!.change_reason, 'tighten stay-in-your-lane wording');
  const v1 = await store.getVersion(head!.previous_version_id!);
  assert.equal(v1!.version, 1, 'the prior version is retained (nothing overwritten)');
  assert.ok(!v1!.content.includes('escalate ANY decision'), 'v1 content was NOT mutated in place');
});

test('AC-4.PRIN.002.3 — a saved principles edit propagates to EVERY agent’s Layer 1; an in-flight task pinned to the prior version is unaffected', async () => {
  const { service, store } = svc();
  // three agents, each with its OWN identity but the SAME canonical principles block
  await service.saveCore('agent-fin', 'fin-core', defaultLayer1('You are Fin, the finance agent.'), 'init', SUPER, NOW);
  await service.saveCore('agent-ops', 'ops-core', defaultLayer1('You are Ops, the operations agent.'), 'init', SUPER, NOW);
  await service.saveCore('agent-hr', 'hr-core', defaultLayer1('You are HR, the people agent.'), 'init', SUPER, NOW);

  // a task pins the CURRENT finance core version before the edit (ISSUE-042 pinning seam — here: capture the id)
  const pinnedForInFlightTask = (await store.currentCoreForAgent('agent-fin'))!.id;

  const edited = defaultPrinciplesBlock();
  edited.canonical.be_honest_about_what_you_know = 'Be honest: always signal Cited/Inferred/Unknown; never dead-end; and escalate an unknown that blocks the task.';
  const res = await service.editPrinciples(SUPER, edited, 'clarify honesty principle', NOW);

  // every agent got the edited block as its NEW head, and identity content is preserved per agent.
  assert.equal(res.propagated.length, 3, 'propagated to all three agents');
  for (const agent of ['agent-fin', 'agent-ops', 'agent-hr']) {
    const head = (await store.currentCoreForAgent(agent))!;
    assert.equal(head.version, 2, `${agent} advanced to v2`);
    assert.ok(head.content.includes('escalate an unknown that blocks the task'), `${agent} reflects the edited principle`);
  }
  const finHead = (await store.currentCoreForAgent('agent-fin'))!;
  assert.ok(finHead.content.includes('You are Fin'), 'per-agent identity content is preserved through the shared-block edit');
  const opsHead = (await store.currentCoreForAgent('agent-ops'))!;
  assert.ok(opsHead.content.includes('You are Ops'), 'ops keeps its own identity');

  // TEETH: the in-flight task pinned to the PRE-edit version still resolves the OLD block (unaffected).
  const pinnedRow = (await store.getVersion(pinnedForInFlightTask))!;
  assert.equal(pinnedRow.version, 1, 'the pinned version is still v1');
  assert.ok(!pinnedRow.content.includes('escalate an unknown that blocks the task'), 'the pinned (in-flight) version does NOT see the edit');
});

test('AC-4.PRIN.002.4 — a principles edit that removes or empties any of the seven is HARD-BLOCKED; reword/strengthen is permitted', async () => {
  const { service, audit, store } = svc();
  await service.saveCore('agent-a', 'a-core', defaultLayer1('Agent A.'), 'init', SUPER, NOW);

  // TEETH: emptying a canonical principle → floor breach, rejected BEFORE any write, nothing propagated.
  const emptied = defaultPrinciplesBlock();
  emptied.canonical.memory_is_context = '   ';
  await assert.rejects(
    () => service.editPrinciples(SUPER, emptied, 'try to gut memory principle', NOW),
    (e: unknown) => e instanceof PrinciplesFloorBreach && (e as PrinciplesFloorBreach).removed.includes('memory_is_context'),
    'emptying a canonical principle is hard-blocked',
  );
  // TEETH: deleting a canonical key entirely → also blocked.
  const dropped = defaultPrinciplesBlock();
  delete dropped.canonical.prefer_reversible;
  await assert.rejects(
    () => service.editPrinciples(SUPER, dropped, 'try to drop reversible principle', NOW),
    (e: unknown) => e instanceof PrinciplesFloorBreach,
    'deleting a canonical principle is hard-blocked',
  );
  assert.equal(audit.safetyEvents.length, 0, 'no safety event emitted on a blocked floor breach');
  assert.equal((await store.currentCoreForAgent('agent-a'))!.version, 1, 'no version written by a blocked edit');

  // reword/strengthen (non-empty) IS permitted and DOES propagate.
  const reworded = defaultPrinciplesBlock();
  reworded.canonical.prefer_reversible = 'Strongly prefer reversible actions; treat any irreversible action as requiring approval.';
  reworded.added = ['Deployment rule: never touch production data on a Friday without sign-off.'];
  const res = await service.editPrinciples(SUPER, reworded, 'strengthen reversibility + add deployment rule', NOW);
  assert.equal(res.propagated.length, 1);
  const head = (await store.currentCoreForAgent('agent-a'))!;
  assert.equal(head.version, 2, 'the reword/strengthen/add edit committed');
  assert.ok(head.content.includes('treat any irreversible action as requiring approval'), 'the strengthened wording is present');
  assert.ok(head.content.includes('never touch production data on a Friday'), 'the added deployment-specific principle is present');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PRIN.003 — statement, not enforcement
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test('AC-4.PRIN.003.1 — weakening/omitting a principle in the prompt leaves the mapped code control (RBAC) enforcing', () => {
  // "stay in your lane" maps to C1 RBAC. The RBAC control allows ONLY explicitly-granted actions.
  const rbac = new RbacCodeControl(new Set(['read_own_agent_config']));
  const original = defaultPrinciplesBlock();

  // Before weakening: an ungranted action is denied by the code control.
  assert.equal(rbac.decide('delete_client_records'), 'deny', 'RBAC denies an ungranted action');
  assert.equal(rbac.decide('read_own_agent_config'), 'allow', 'RBAC allows the granted action');

  // TEETH: weaken the prompt by DELETING the stay-in-your-lane principle entirely (bypassing the save
  // floor — the point of FR-4.PRIN.003 is: EVEN IF the prompt were weakened, the code control is unmoved).
  const weakened = weakenPrinciple(original, 'stay_in_your_lane');
  assert.equal(weakened.canonical.stay_in_your_lane, undefined, 'the prompt principle was gutted');

  // The code control's decision is IDENTICAL — it never consulted the prompt.
  assert.equal(rbac.decide('delete_client_records'), 'deny', 'RBAC STILL denies after the prompt is weakened');
  assert.equal(
    controlUnaffectedByPromptWeakening(rbac, 'delete_client_records', original, weakened),
    true,
    'the code control is provably independent of the prompt (the principle is not the enforcement path)',
  );
  // sanity: the rendered weakened content really lost the principle text, proving the weakening was real.
  const stayText = CANONICAL_PRINCIPLES.find((p) => p.id === 'stay_in_your_lane')!.text;
  const base = defaultLayer1('Agent.');
  const weakLayer: Layer1Content = { ...base, principles: weakened };
  assert.ok(!renderLayer1Content(weakLayer).includes(stayText), 'the weakened prompt no longer states the principle');
  assert.ok(wordCount(stayText) > 0);
});
