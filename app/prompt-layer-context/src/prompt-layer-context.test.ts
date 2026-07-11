// ISSUE-044 §4 Definition of done — ONE test per AC (text read in component-04-prompt.md, Rule 0). All 8
// ACs are offline-provable with the port+fake pattern + the migration-text gate. The LIVE proof (rows
// landing under the prompt_layers RLS policy, the ISSUE-042 0004 version-discipline trigger firing on a
// task_template edit, dynamic_field_values reads/writes under RLS) is owed to the Stage-3 checkpoint
// capstone, run by the operator — noted where it applies.
//
// AC map:
//   AC-4.BIZ.001.1 — the SAME Layer-2 business content is used across every agent in a deployment.
//   AC-4.BIZ.002.1 — every Layer-2 field classifies static OR dynamic (exactly one); dynamic resolves at
//                    assembly, not boot.
//   AC-4.BIZ.003.1 — a config-declared dynamic field's value is read from the operator-editable store at
//                    assembly (not from static config).
//   AC-4.BIZ.003.2 — a dynamic field with no value set is omitted/empty (never a stale baked value); the
//                    gap is observable to the operator.
//   AC-4.BIZ.003.3 — a dynamic field past dynamic_field_freshness_threshold has its staleness SURFACED
//                    (required, not optional) — never silently presented as current (#3).
//   AC-4.TSK.001.1 — a Layer 4 with no explicit output format is flagged incomplete.
//   AC-4.TSK.002.1 — a task template with parameter slots instantiates to a complete Layer 4 (ALL slots filled).
//   AC-4.TSK.003.1 — a task-template edit follows version-on-change + mandatory change_reason + non-destructive rollback.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  Layer2Classification,
  instantiateTemplate,
  resolveDynamicField,
  validateLayer4,
  type TaskTemplate,
} from './context.ts';
import {
  InMemoryContentStore,
  InMemoryDynamicFieldStore,
} from './store.ts';
import { BUSINESS_LAYER_NAME, BusinessContextService } from './business-context.ts';
import { runCheck } from './index.ts';

const NOW = 1_800_000_000; // fixed epoch seconds (deterministic; no Date.now in tests)
const HOUR = 3600;
const DAY = 86_400;

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');

// A freshness threshold of one day (in seconds) — the CFG stub `dynamic_field_freshness_threshold`.
const FRESH_1D = DAY;

function bizService(opts: {
  dynamicFields: string[];
  threshold?: number;
}) {
  const content = new InMemoryContentStore();
  const dynamicValues = new InMemoryDynamicFieldStore();
  const classification = new Layer2Classification(opts.dynamicFields);
  const svc = new BusinessContextService({
    content,
    dynamicValues,
    classification,
    freshnessThresholdSeconds: opts.threshold ?? FRESH_1D,
  });
  return { content, dynamicValues, classification, svc };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// BIZ — Layer 2 business context
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test('AC-4.BIZ.001.1 — the SAME Layer-2 business record is read for every agent in a deployment (shared block)', async () => {
  const { content, svc } = bizService({ dynamicFields: [] });
  const rec = await content.createContent(
    { layer: 'business', name: BUSINESS_LAYER_NAME, content: 'Acme Co. — friendly tone.', change_reason: 'init', created_by: 'admin' },
    NOW,
  );

  // Assemble Layer 2 "for" three different agents. There is no per-agent parameter — the business record is
  // keyed (business, BUSINESS_LAYER_NAME, agent_id=null) so every agent resolves the identical version id.
  const forFinance = await svc.assemble(NOW);
  const forSupport = await svc.assemble(NOW);
  const forSales = await svc.assemble(NOW);

  assert.equal(forFinance.business_version_id, rec.id);
  assert.equal(forSupport.business_version_id, rec.id);
  assert.equal(forSales.business_version_id, rec.id);
  assert.equal(forFinance.static_content, 'Acme Co. — friendly tone.');

  // TEETH: the record is stored with agent_id=null (deployment-shared, not per-agent). A per-agent record
  // would defeat the shared-block invariant — assert the stored row is not agent-keyed.
  assert.equal(content.rows[0]!.agent_id, null);
  // TEETH: only ONE business record exists — a deployment cannot have divergent business content per agent.
  const businessRows = content.rows.filter((r) => r.layer === 'business');
  assert.equal(businessRows.length, 1);
});

test('AC-4.BIZ.002.1 — every Layer-2 field classifies static OR dynamic (exactly one); dynamic resolves at assembly not boot', async () => {
  const c = new Layer2Classification(['current_quarter_goals', 'active_campaigns']);

  // A declared field is dynamic; an undeclared one is static. The split is TOTAL and EXCLUSIVE.
  assert.equal(c.classify('current_quarter_goals'), 'dynamic');
  assert.equal(c.classify('active_campaigns'), 'dynamic');
  assert.equal(c.classify('tone'), 'static');
  assert.equal(c.classify('operating_hours'), 'static');
  // A never-heard-of field is still classified (static) — no field is left unclassified.
  assert.equal(c.classify('some_field_nobody_declared'), 'static');

  // TEETH: a field is EXACTLY one — never both. isDynamic and (classify==='static') must be mutually exclusive.
  for (const f of ['current_quarter_goals', 'tone', 'x']) {
    const isDyn = c.isDynamic(f);
    const isStatic = c.classify(f) === 'static';
    assert.equal(isDyn, !isStatic, `field ${f} must be exactly one of static/dynamic`);
  }

  // TEETH: a field declared twice is a config error (not silently de-duped into a valid classification).
  assert.throws(() => new Layer2Classification(['a', 'a']), /declared twice/);
  // TEETH: an empty declared field name is rejected (a dynamic field needs a resolvable key).
  assert.throws(() => new Layer2Classification(['']), /non-empty/);

  // "resolves at assembly, not boot": the value comes from the assembly-time store read, not a boot config.
  // Prove the dynamic field carries NO value until the operator sets one at runtime.
  const store = new InMemoryDynamicFieldStore();
  const atBoot = resolveDynamicField('current_quarter_goals', await store.read('current_quarter_goals'), FRESH_1D, NOW);
  assert.equal(atBoot.value, null); // nothing baked at boot
  await store.set('current_quarter_goals', 'Ship v2', NOW);
  const atAssembly = resolveDynamicField('current_quarter_goals', await store.read('current_quarter_goals'), FRESH_1D, NOW);
  assert.equal(atAssembly.value, 'Ship v2'); // resolved at assembly from the live store
});

test('AC-4.BIZ.003.1 — a declared dynamic field is read from the operator-editable store at assembly (not static config)', async () => {
  const { dynamicValues, svc } = bizService({ dynamicFields: ['this_week_priorities'] });
  await dynamicValues.set('this_week_priorities', 'Close Q3 books', NOW);

  const assembled = await svc.assemble(NOW);
  const field = assembled.dynamic.find((d) => d.field_name === 'this_week_priorities');
  assert.ok(field);
  assert.equal(field.value, 'Close Q3 books');
  assert.equal(field.state, 'present_fresh');

  // TEETH: the value must track the LIVE store — edit it and re-assemble; the new value flows through with
  // no rebuild/reboot. A static-config read would still show the old value.
  await dynamicValues.set('this_week_priorities', 'Kick off Q4 planning', NOW + HOUR);
  const reassembled = await svc.assemble(NOW + HOUR);
  const field2 = reassembled.dynamic.find((d) => d.field_name === 'this_week_priorities');
  assert.equal(field2!.value, 'Kick off Q4 planning');
});

test('AC-4.BIZ.003.2 — an unset dynamic field is omitted/empty (never a stale baked value) and the gap is observable', async () => {
  const { dynamicValues, svc } = bizService({ dynamicFields: ['active_campaigns', 'this_week_priorities'] });
  // Only ONE of the two declared fields is set; the other is never given a value.
  await dynamicValues.set('this_week_priorities', 'Do the thing', NOW);

  const assembled = await svc.assemble(NOW);
  const unset = assembled.dynamic.find((d) => d.field_name === 'active_campaigns');
  assert.ok(unset);
  assert.equal(unset.value, null);        // omitted/empty
  assert.equal(unset.state, 'unset');
  assert.equal(unset.stale, false);       // an unset field is not "stale" — it is absent

  // TEETH: the gap is OBSERVABLE — the assembled report surfaces the unset field explicitly.
  assert.deepEqual(assembled.unset.map((d) => d.field_name), ['active_campaigns']);

  // TEETH: an explicitly-nulled value (operator cleared it) is ALSO treated as unset — never resurrecting a
  // prior baked-in value silently.
  await dynamicValues.set('this_week_priorities', null, NOW + HOUR);
  const after = await svc.assemble(NOW + HOUR);
  const cleared = after.dynamic.find((d) => d.field_name === 'this_week_priorities');
  assert.equal(cleared!.value, null);
  assert.equal(cleared!.state, 'unset');
});

test('AC-4.BIZ.003.3 — a value past the freshness threshold surfaces staleness (required) and is never silently current (#3)', async () => {
  const { dynamicValues, svc } = bizService({ dynamicFields: ['current_quarter_goals'], threshold: FRESH_1D });
  // Set the value, then assemble a WEEK later — well past the one-day threshold.
  await dynamicValues.set('current_quarter_goals', 'Grow ARR 20%', NOW);
  const assembled = await svc.assemble(NOW + 7 * DAY);

  const field = assembled.dynamic.find((d) => d.field_name === 'current_quarter_goals');
  assert.ok(field);
  assert.equal(field.value, 'Grow ARR 20%');   // the value is still present…
  assert.equal(field.stale, true);              // …but flagged stale
  assert.equal(field.state, 'present_stale');   // NOT 'present_fresh' — never dressed up as current
  assert.equal(field.age_seconds, 7 * DAY);

  // TEETH: the service surfaces the stale field in its required staleness list (not optional).
  assert.deepEqual(assembled.stale.map((d) => d.field_name), ['current_quarter_goals']);

  // TEETH: a value INSIDE the threshold is NOT flagged stale — the boundary must actually discriminate.
  const fresh = await svc.assemble(NOW + HOUR);
  assert.equal(fresh.dynamic[0]!.stale, false);
  assert.equal(fresh.dynamic[0]!.state, 'present_fresh');
  assert.equal(fresh.stale.length, 0);

  // TEETH: exactly-at-threshold is fresh; one second past is stale (boundary is `age > threshold`).
  await dynamicValues.set('current_quarter_goals', 'v', NOW);
  assert.equal(resolveDynamicField('current_quarter_goals', await dynamicValues.read('current_quarter_goals'), FRESH_1D, NOW + FRESH_1D).stale, false);
  assert.equal(resolveDynamicField('current_quarter_goals', await dynamicValues.read('current_quarter_goals'), FRESH_1D, NOW + FRESH_1D + 1).stale, true);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// TSK — Layer 4 task instruction + templates
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test('AC-4.TSK.001.1 — a Layer 4 with no explicit output format is flagged incomplete', () => {
  // Missing output format → incomplete.
  const noFmt = validateLayer4({ instruction: 'Summarise the report.', output_format: '' });
  assert.equal(noFmt.complete, false);
  assert.ok(noFmt.problems.some((p) => /output format/i.test(p)));

  // Whitespace-only output format is ALSO incomplete (not a sneaky "present" value).
  const wsFmt = validateLayer4({ instruction: 'Summarise.', output_format: '   ' });
  assert.equal(wsFmt.complete, false);

  // Null/undefined output format is incomplete.
  assert.equal(validateLayer4({ instruction: 'Do it', output_format: null }).complete, false);
  assert.equal(validateLayer4({ instruction: 'Do it' }).complete, false);

  // TEETH: a Layer 4 WITH an explicit output format is complete — the check must not reject everything.
  const ok = validateLayer4({ instruction: 'Summarise the report.', output_format: 'A 3-bullet markdown list.' });
  assert.equal(ok.complete, true);
  assert.deepEqual(ok.problems, []);

  // TEETH: a missing instruction is also incomplete (the contract is instruction + explicit format).
  assert.equal(validateLayer4({ instruction: '', output_format: 'JSON' }).complete, false);
});

test('AC-4.TSK.002.1 — a task template with parameter slots instantiates to a complete Layer 4 with ALL slots filled', () => {
  const template: TaskTemplate = {
    instruction: 'Reconcile the {month} ledger for {entity}.',
    output_format: 'A table of {entity} discrepancies for {month}.',
    constraints: ['Flag anything over {threshold} dollars.'],
  };

  const layer4 = instantiateTemplate(template, { month: 'March', entity: 'Acme LLC', threshold: '500' });
  assert.equal(layer4.instruction, 'Reconcile the March ledger for Acme LLC.');
  assert.equal(layer4.output_format, 'A table of Acme LLC discrepancies for March.');
  assert.deepEqual(layer4.constraints, ['Flag anything over 500 dollars.']);

  // TEETH: no raw `{slot}` marker survives ANYWHERE in the produced Layer 4.
  const allText = [layer4.instruction, layer4.output_format, ...layer4.constraints].join(' ');
  assert.ok(!/\{[a-zA-Z_]/.test(allText), 'no unfilled slot marker may survive');

  // TEETH: a MISSING slot value is a LOUD failure — never a half-filled prompt leaking `{month}`.
  assert.throws(
    () => instantiateTemplate(template, { entity: 'Acme LLC', threshold: '500' }),
    /missing parameter.*month/,
  );

  // TEETH: the produced Layer 4 with a filled output format is a COMPLETE Layer 4 (passes TSK.001 validation).
  assert.equal(validateLayer4(layer4).complete, true);

  // Extra unused params are allowed (a template need not consume every runtime parameter).
  const ok2 = instantiateTemplate(template, { month: 'April', entity: 'Beta', threshold: '10', unused: 'x' });
  assert.equal(ok2.instruction, 'Reconcile the April ledger for Beta.');
});

test('AC-4.TSK.002.1 — instantiateTemplate never hands back an INCOMPLETE Layer 4 (empty output format is a LOUD failure, not silent)', () => {
  // logic-sweep [MAJOR] context.ts:254 — instantiateTemplate promised a COMPLETE Layer 4 but only
  // enforced that every slot HAS a supplied value; it never checked the value was non-empty nor validated
  // the assembled result. An empty-string param ('' is not null) passed the all-slots-filled gate and
  // produced a Layer 4 that validateLayer4 flags incomplete — exactly the 'assume prose' silent gap (#3)
  // FR-4.TSK.001/AC-4.TSK.001.1 exists to prevent.

  // (a) An empty-string slot value for the output-format slot must NOT yield a silent, incomplete Layer 4.
  assert.throws(
    () =>
      instantiateTemplate(
        { instruction: 'Do {x}', output_format: '{fmt}', constraints: [] },
        { x: 'go', fmt: '' },
      ),
    /output format/i,
    'an empty output_format slot value must be rejected LOUD, never returned as a complete Layer 4',
  );

  // (b) A template authored with a blank output_format (no slots at all) is likewise incomplete and rejected.
  assert.throws(
    () => instantiateTemplate({ instruction: 'Do the thing.', output_format: '', constraints: [] }, {}),
    /output format/i,
    'a blank output_format must be rejected — a Layer 4 with no explicit output format is incomplete',
  );

  // (c) Whatever instantiateTemplate DOES return is always a complete Layer 4 by validateLayer4 (its own sibling rule).
  const good = instantiateTemplate(
    { instruction: 'Do {x}', output_format: 'A {x} report.', constraints: [] },
    { x: 'go' },
  );
  assert.equal(validateLayer4(good).complete, true);
});

test('AC-4.TSK.002.1 — a supplied parameter VALUE that itself contains braces is NOT mistaken for an unfilled slot leak', () => {
  // logic-sweep [MINOR] context.ts:264 — the belt-and-braces leak guard re-scanned the FILLED bodies with
  // /\{[a-zA-Z_][a-zA-Z0-9_]*\}/ and could not tell an unfilled slot from operator-supplied brace content
  // in a parameter value. Every slot IS supplied here, so this is a legitimate, complete instantiation.
  const template: TaskTemplate = {
    instruction: 'Use theme {t}.',
    output_format: 'A {t} styled report.',
    constraints: [],
  };
  const layer4 = instantiateTemplate(template, { t: '{dark}' });
  assert.equal(layer4.instruction, 'Use theme {dark}.');
  assert.equal(layer4.output_format, 'A {dark} styled report.');

  // A genuinely-unfilled slot (a template body carrying a `{slot}` that fill left behind) must STILL throw.
  // Simulate via a param value that re-introduces a DIFFERENT slot name that no fill pass will touch: the
  // guard must not police that (it is a value, not a slot), so this stays a legitimate instantiation too.
  const withJson = instantiateTemplate(
    { instruction: 'Emit {payload}', output_format: 'json {payload}', constraints: [] },
    { payload: '{"k": "v"}' },
  );
  assert.equal(withJson.instruction, 'Emit {"k": "v"}');
});

test('AC-4.TSK.003.1 — a task-template edit follows version-on-change + mandatory change_reason + non-destructive rollback', async () => {
  const store = new InMemoryContentStore();

  // v1
  const v1 = await store.createContent(
    { layer: 'task_template', name: 'reconcile', content: 'Reconcile {month}.', change_reason: 'initial template', created_by: 'admin' },
    NOW,
  );
  assert.equal(v1.version, 1);
  assert.equal(v1.previous_version_id, null);

  // Edit → a NEW version (never overwrite). Mandatory change_reason.
  const v2 = await store.appendVersion(v1.id, { content: 'Reconcile {month} and {quarter}.', change_reason: 'add quarter slot', created_by: 'admin' }, NOW + HOUR);
  assert.equal(v2.version, 2);
  assert.equal(v2.previous_version_id, v1.id);

  // TEETH: v1 is UNTOUCHED — the prior version row still holds its original content (append-only, #1).
  const stillV1 = await store.getVersion(v1.id);
  assert.equal(stillV1!.content, 'Reconcile {month}.');
  assert.equal(stillV1!.version, 1);

  // TEETH: an empty change_reason is REJECTED (mandatory, non-empty).
  await assert.rejects(
    () => store.appendVersion(v2.id, { content: 'x', change_reason: '   ' }, NOW + 2 * HOUR),
    /change_reason is mandatory/,
  );

  // TEETH: a stale edit (editing v1 when v2 is the head) is rejected — no lost update.
  await assert.rejects(
    () => store.appendVersion(v1.id, { content: 'y', change_reason: 'stale edit' }, NOW + 2 * HOUR),
    /stale edit/,
  );

  // Non-destructive rollback → append a NEW version whose content = v1's; history retained in full.
  const v3 = await store.rollbackTo(v1.id, 'roll back to v1 wording', 'admin', NOW + 3 * HOUR);
  assert.equal(v3.version, 3);
  assert.equal(v3.content, 'Reconcile {month}.'); // = v1 content
  assert.equal(v3.previous_version_id, v2.id);    // forward-linked from the head, not a rewrite

  // TEETH: rollback did NOT delete/rewrite history — all three versions remain, v2 intact.
  const hist = await store.history({ layer: 'task_template', name: 'reconcile' });
  assert.deepEqual(hist.map((r) => r.version), [1, 2, 3]);
  assert.equal(hist[1]!.content, 'Reconcile {month} and {quarter}.'); // v2 preserved

  // TEETH: this store rejects authoring a core/memory layer — those are ISSUE-043/045, not this slice.
  await assert.rejects(
    () => store.createContent({ layer: 'core' as never, name: 'x', content: 'y', change_reason: 'z', created_by: 'a' }, NOW),
    /only 'business' \| 'task_template'/,
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Build-time gate — the offline schema-shape check (no DB) this slice's adapters are authored to.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test('check gate — dynamic_field_values + prompt_layers baseline shapes present; no own migration shipped', () => {
  const findings = runCheck(SILO_MIGRATIONS);
  assert.deepEqual(findings, [], `check gate found drift: ${JSON.stringify(findings, null, 2)}`);
});

// REGRESSION (Session 86 latent drift): the no-own-migration gate must key off THIS slice's package slug,
// NOT the "0044" issue number as a migration prefix. Migration numbers are sequential and unrelated to issue
// numbers — 0044_conflict_consolidation_event_types.sql is ISSUE-028's, not this slice's — so a same-numbered
// unrelated migration must NOT trigger the gate, while a genuinely slug-named stray still MUST.
test('check gate — no-own-migration keys off package slug, not the issue-number prefix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plc-migrations-'));
  try {
    // Decoys: an unrelated migration that happens to be numbered 0044 (ISSUE-028's real one), plus another
    // sequential number. Neither is authored by this slice → the gate must stay silent.
    writeFileSync(join(dir, '0044_conflict_consolidation_event_types.sql'), '-- ISSUE-028, not this slice\n');
    writeFileSync(join(dir, '0047_some_other_slice.sql'), '-- unrelated\n');
    const clean = runCheck(dir).filter((f) => f.gate === 'no-own-migration');
    assert.deepEqual(clean, [], `no-own-migration false-positived on an unrelated migration: ${JSON.stringify(clean)}`);

    // Positive control: a migration carrying this slice's slug is a real violation and MUST be caught.
    writeFileSync(join(dir, '0048_prompt_layer_context_stray.sql'), '-- this slice must not ship this\n');
    const dirty = runCheck(dir).filter((f) => f.gate === 'no-own-migration');
    assert.equal(dirty.length, 1, `expected the slug-named stray to trip the gate, got: ${JSON.stringify(dirty)}`);
    assert.match(dirty[0]?.message ?? '', /0048_prompt_layer_context_stray\.sql/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
