// ISSUE-046 §4 Definition of done — ONE test per AC (text read in component-04-prompt.md, Rule 0).
//
// AC-map:
//   AC-4.OPT.001.1 — a completed task's outcome is attributable to the prompt version(s) in force at its
//                    assembly; the version identity is captured, not lost. Editing a layer to a new version
//                    and running a new task attributes THAT task to the new version; neither identity is
//                    lost. Proven here on the reference model (the end-to-end outcome-record path is C5
//                    FR-5.ASM.009 / ISSUE-053; this slice proves the identity is present + stable). → test 1
//   AC-4.OPT.002.1 — an updated dynamic-field value appears in the next session's Layer 2 with NO redeploy
//                    or reboot (fresh read at assembly). → test 2
//   AC-4.OPT.003.1 — the editing workflow supports the compression discipline (word-count + OD-051
//                    advisory) and NEVER blocks a save for length — compression is enabled, not gated. → test 3
//
// AF-111 (build-time EVAL, NOT a launch gate): the version-bucketed outcome substrate this slice makes
// queryable is exercised in test 1 (the roll-up discriminates versions); whether the deltas exceed noise on
// real task history is the EVAL owed to a deployment with history (feasibility-register block O) — not
// provable offline and NOT faked here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryPromptOptimisationStore,
  type VersionAttribution,
} from './store.ts';
import { compressionAffordance, saveBlockedForLength, wordCount, LAYER1_WORD_TARGET_MAX } from './editor.ts';

const NOW = 1_800_000_000; // fixed epoch seconds (deterministic; no Date.now in tests)
const iso = (n: number) => new Date(n * 1000).toISOString();

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AC-4.OPT.001.1 — version-to-outcome attribution: identity captured, not lost; distinct versions
// attribute distinctly; the substrate is version-bucketable (AF-111).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-4.OPT.001.1 — a task outcome is attributable to the prompt version(s) in force at assembly, and editing to a new version attributes a new task to the new version without losing either identity', async () => {
  const store = new InMemoryPromptOptimisationStore();

  // Task A assembled on core version 3 (pl-core-v3), business version 1 (pl-biz-v1).
  const attrA: VersionAttribution = {
    task_id: 'task-A',
    slots: { core: { version_id: 'pl-core-v3', version: 3 }, business: { version_id: 'pl-biz-v1', version: 1 } },
    captured_at: iso(NOW),
  };
  await store.captureAttribution(attrA);
  await store.recordOutcome({ task_id: 'task-A', outcome: 'failure', cost: 900, recorded_at: iso(NOW + 10) });

  // The core layer is edited → a NEW version (pl-core-v4). Task B assembled AFTER the edit runs on v4.
  const attrB: VersionAttribution = {
    task_id: 'task-B',
    slots: { core: { version_id: 'pl-core-v4', version: 4 }, business: { version_id: 'pl-biz-v1', version: 1 } },
    captured_at: iso(NOW + 100),
  };
  await store.captureAttribution(attrB);
  await store.recordOutcome({ task_id: 'task-B', outcome: 'success', cost: 500, recorded_at: iso(NOW + 110) });

  // (a) Each outcome is attributable to the version in force at ITS assembly — identity captured, not lost.
  const backA = await store.getAttribution('task-A');
  const backB = await store.getAttribution('task-B');
  assert.equal(backA?.slots.core?.version, 3, 'task-A must attribute to core v3');
  assert.equal(backB?.slots.core?.version, 4, 'task-B must attribute to core v4');
  assert.equal(backA?.slots.core?.version_id, 'pl-core-v3');
  assert.equal(backB?.slots.core?.version_id, 'pl-core-v4');

  // (b) The substrate is version-bucketed so a builder can ask "which version produced better outcomes"
  //     (AF-111). The two core versions bucket DISTINCTLY — never conflated.
  const coreBuckets = await store.outcomesByVersion('core');
  const v3 = coreBuckets.find((b) => b.version_id === 'pl-core-v3');
  const v4 = coreBuckets.find((b) => b.version_id === 'pl-core-v4');
  assert.ok(v3 && v4, 'both core versions must appear as distinct buckets');
  assert.equal(v3.failures, 1, 'core v3 bucket = the failing task-A');
  assert.equal(v3.successes, 0);
  assert.equal(v4.successes, 1, 'core v4 bucket = the succeeding task-B');
  assert.equal(v4.failures, 0);
  assert.equal(v3.meanCost, 900);
  assert.equal(v4.meanCost, 500);
  // Teeth: the two versions are genuinely separated (a bug that conflated them would collapse to one bucket).
  assert.equal(coreBuckets.length, 2, 'two distinct core versions ⇒ exactly two core buckets');

  // (c) The business layer, UNCHANGED across both tasks, buckets BOTH outcomes to the one version — the
  //     shared version is correctly attributed twice (not lost, not duplicated as a phantom version).
  const bizBuckets = await store.outcomesByVersion('business');
  assert.equal(bizBuckets.length, 1, 'business v1 unchanged ⇒ a single bucket');
  assert.equal(bizBuckets[0]!.total, 2, 'both tasks ran on business v1');
  assert.equal(bizBuckets[0]!.successes, 1);
  assert.equal(bizBuckets[0]!.failures, 1);

  // (d) Identity is NEVER lost after the fact: a later edit (v5) does not mutate task-A/B's captured pins.
  await store.captureAttribution({
    task_id: 'task-C',
    slots: { core: { version_id: 'pl-core-v5', version: 5 } },
    captured_at: iso(NOW + 200),
  });
  assert.equal((await store.getAttribution('task-A'))?.slots.core?.version, 3, 'task-A pin unchanged by a later edit');
  assert.equal((await store.getAttribution('task-B'))?.slots.core?.version, 4, 'task-B pin unchanged by a later edit');

  // (e) TEETH — the pin is captured ONCE (OD-050): a re-capture is rejected, never a silent overwrite of the
  //     version in force.
  await assert.rejects(
    () => store.captureAttribution({ task_id: 'task-A', slots: { core: { version_id: 'pl-core-v9', version: 9 } }, captured_at: iso(NOW + 300) }),
    /already captured/,
    're-capturing a task pin must be rejected (immutable, captured once at assembly)',
  );
  // ...and the original identity survived the rejected re-capture.
  assert.equal((await store.getAttribution('task-A'))?.slots.core?.version, 3);

  // (f) TEETH — a versionless outcome is a lost signal (#3): recording an outcome for a task with NO
  //     captured attribution is rejected loud, never silently dropped.
  await assert.rejects(
    () => store.recordOutcome({ task_id: 'task-ghost', outcome: 'success', recorded_at: iso(NOW) }),
    /no version attribution was captured/,
    'an outcome with no captured version identity must be rejected, not dropped',
  );

  // (g) TEETH — a malformed pin (no core / empty version_id / non-positive version) is rejected: the
  //     stable identity is mandatory (a coreless or empty pin is a lost identity).
  await assert.rejects(
    () => store.captureAttribution({ task_id: 't-nocore', slots: { business: { version_id: 'pl-biz-v1', version: 1 } }, captured_at: iso(NOW) }),
    /missing the required core slot/,
    'a pin with no core slot must be rejected',
  );
  await assert.rejects(
    () => store.captureAttribution({ task_id: 't-empty', slots: {}, captured_at: iso(NOW) }),
    /no version identity/,
    'an empty pin must be rejected',
  );
  await assert.rejects(
    () => store.captureAttribution({ task_id: 't-blank', slots: { core: { version_id: '  ', version: 1 } }, captured_at: iso(NOW) }),
    /empty version_id/,
    'a blank version_id must be rejected',
  );
  await assert.rejects(
    () => store.captureAttribution({ task_id: 't-badv', slots: { core: { version_id: 'pl-core-v1', version: 0 } }, captured_at: iso(NOW) }),
    /invalid version/,
    'a non-positive version must be rejected',
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AC-4.OPT.002.1 — dynamic Layer-2 fresh injection: an updated value appears next session, no redeploy.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-4.OPT.002.1 — an updated dynamic-field value appears in the next assembled Layer 2 without a redeploy or reboot (fresh read at assembly)', async () => {
  const store = new InMemoryPromptOptimisationStore();
  const declared = ['current_goal', 'active_campaign'];

  // Session 1: seed the values and assemble Layer 2.
  await store.putDynamicField('current_goal', 'Ship Q3 launch', NOW);
  await store.putDynamicField('active_campaign', 'Spring promo', NOW);
  const s1 = await store.assembleDynamicLayer2(declared, NOW + 1);
  assert.equal(s1.find((f) => f.field_name === 'current_goal')?.field_value, 'Ship Q3 launch');
  assert.equal(s1.find((f) => f.field_name === 'active_campaign')?.field_value, 'Spring promo');

  // The operator updates a value BETWEEN sessions — NO redeploy, NO reboot; just an upsert into the store.
  await store.putDynamicField('current_goal', 'Ship Q4 launch', NOW + 1000);

  // Session 2 (next assembly): the NEW value is present, read FRESH — the changed field flipped, the
  // untouched one stayed. Teeth: assert the exact new string AND that the stale value is gone.
  const s2 = await store.assembleDynamicLayer2(declared, NOW + 1001);
  const goal2 = s2.find((f) => f.field_name === 'current_goal');
  assert.equal(goal2?.field_value, 'Ship Q4 launch', 'the updated value must appear on the next assembly');
  assert.notEqual(goal2?.field_value, 'Ship Q3 launch', 'the stale baked value must NOT survive (fresh read, not a snapshot)');
  assert.equal(s2.find((f) => f.field_name === 'active_campaign')?.field_value, 'Spring promo', 'the untouched field is unchanged');

  // Teeth: prove there is no baked snapshot — a value updated AFTER an assembly object was already produced
  // still appears on the SUBSEQUENT assembly (each assemble re-reads current state).
  await store.putDynamicField('active_campaign', 'Summer promo', NOW + 2000);
  const s3 = await store.assembleDynamicLayer2(declared, NOW + 2001);
  assert.equal(s3.find((f) => f.field_name === 'active_campaign')?.field_value, 'Summer promo');
  // ...and the previously-produced s2 object was NOT retroactively mutated (fresh read ⇒ immutable snapshots).
  assert.equal(s2.find((f) => f.field_name === 'active_campaign')?.field_value, 'Spring promo');

  // A declared-but-unset field resolves to null (surfaced, not dropped) — never silently omitted.
  const s4 = await store.assembleDynamicLayer2([...declared, 'this_week_priority'], NOW + 2001);
  assert.equal(s4.length, 3, 'every declared field is surfaced, including an unset one');
  assert.equal(s4.find((f) => f.field_name === 'this_week_priority')?.field_value, null);

  // Staleness surfacing (ISSUE-044's threshold, surfaced here): a value older than the threshold is flagged
  // stale; a fresh one is not. current_goal was last set at NOW+1000; assemble far later with a 100s window.
  const s5 = await store.assembleDynamicLayer2(['current_goal'], NOW + 1000 + 500, 100);
  assert.equal(s5[0]!.stale, true, 'a value older than the freshness threshold is flagged stale');
  const s6 = await store.assembleDynamicLayer2(['current_goal'], NOW + 1000 + 50, 100);
  assert.equal(s6[0]!.stale, false, 'a value within the freshness window is not stale');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AC-4.OPT.003.1 — compression discipline: word-count + advisory supported; a save is NEVER blocked for
// length (compression is enabled, not mandated by a gate).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-4.OPT.003.1 — the editing workflow supports the compression discipline (word-count + OD-051 advisory) and never blocks a save for length', async () => {
  // A core layer well over the advisory band.
  const longCore = Array.from({ length: LAYER1_WORD_TARGET_MAX + 250 }, (_, i) => `w${i}`).join(' ');
  const aff = compressionAffordance({ content: longCore, isCore: true });

  // (a) The word-count is surfaced and correct (the compression discipline's primary readout).
  assert.equal(aff.words, LAYER1_WORD_TARGET_MAX + 250);
  assert.equal(aff.words, wordCount(longCore), 'the affordance word count matches wordCount()');

  // (b) The OD-051 advisory is surfaced when over the band — and names compression (the maintained discipline).
  assert.ok(aff.advisory, 'over the band ⇒ a non-blocking advisory is surfaced');
  assert.match(aff.advisory!, /compress/i, 'the advisory frames the compression discipline');
  assert.equal(aff.overBand, true);

  // (c) THE LOAD-BEARING GUARANTEE — the save is NEVER blocked for length, no matter how far over.
  assert.equal(aff.saveAllowedForLength, true, 'compression is enabled, not a gate — the save is always permitted for length');
  assert.equal(saveBlockedForLength(longCore, true), false, 'no length gate exists — the save is not blocked');

  // Teeth: even at an absurd length the save is still permitted (a gate would flip this).
  const absurd = Array.from({ length: 10_000 }, (_, i) => `w${i}`).join(' ');
  assert.equal(saveBlockedForLength(absurd, true), false, 'even a 10k-word core is not blocked for length (no gate)');
  assert.equal(compressionAffordance({ content: absurd, isCore: true }).saveAllowedForLength, true);

  // (d) Within the band: NO advisory (the advisory is a genuine over-band signal, not always-on noise).
  const shortCore = 'You are a helpful, bounded assistant.';
  const shortAff = compressionAffordance({ content: shortCore, isCore: true });
  assert.equal(shortAff.advisory, null, 'within the band ⇒ no advisory (the advisory is a real signal, not always-on)');
  assert.equal(shortAff.overBand, false);
  assert.equal(shortAff.saveAllowedForLength, true);

  // (e) The band is a Layer-1 target: a NON-core layer over the same length gets NO advisory (teeth against
  //     an over-eager advisory that fired on every layer).
  const nonCoreAff = compressionAffordance({ content: longCore, isCore: false });
  assert.equal(nonCoreAff.advisory, null, 'the advisory band applies to Layer 1 (core) only');
  assert.equal(nonCoreAff.overBand, false);
  assert.equal(nonCoreAff.saveAllowedForLength, true);

  // (f) wordCount edge: empty / whitespace-only content is zero words (not 1) — a real counter, not a naive split.
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount('   \n  '), 0);
  assert.equal(wordCount('one'), 1);
  assert.equal(wordCount('  spaced   out  words '), 3);
});
