// ISSUE-087 §4/§9 — the never-false-healthy proof (NFR-OBS.011 / OD-198 ③). Unit-proven on the pure
// logic so EVERY surface that renders through resolveViewState()/renderMetric() inherits the guarantee:
// a failed / stale / can't-confirm read can never render "0" / "✓" / all-green.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveViewState,
  renderMetric,
  healthSummary,
  NO_VALUE,
  type ReadResult,
} from './honest-state.ts';

const metric = (r: ReadResult<number>): string => renderMetric(resolveViewState(r), (n) => String(n));

test('a healthy read renders its value and reports healthy', () => {
  const vs = resolveViewState({ kind: 'ok', data: 0, asOf: '12:00' });
  assert.equal(vs.healthy, true);
  assert.equal(vs.showData, true);
  // A GENUINE, confirmed zero renders "0" — honesty cuts both ways: confirmed data shows.
  assert.equal(renderMetric(vs, (n) => String(n)), '0');
  assert.equal(healthSummary(vs), 'ok');
});

test('an ERROR read never renders a value and never reads healthy', () => {
  const r: ReadResult<number> = { kind: 'error', message: 'boom' };
  const vs = resolveViewState(r);
  assert.notEqual(vs.healthy, true, 'an errored read must never be healthy=true');
  assert.equal(vs.showData, false);
  assert.equal(metric(r), NO_VALUE, "an errored metric must render the placeholder, NOT '0'");
  assert.notEqual(metric(r), '0');
  assert.ok(vs.banner && vs.banner.length > 0, 'an errored read must carry an honest banner (#3)');
  assert.equal(healthSummary(vs), 'attention');
});

test("an UNKNOWN (can't-confirm) read is distinct from a healthy zero — OD-198 ③", () => {
  // This is the authz-returned-nothing / probe-failed case that must NOT collapse into all-clear.
  const r: ReadResult<number> = { kind: 'unknown', message: 'not permitted' };
  const vs = resolveViewState(r);
  assert.equal(vs.healthy, null, "can't-confirm is tri-state null, never a bare false-healthy");
  assert.equal(vs.showData, false);
  assert.equal(metric(r), NO_VALUE);
  assert.notEqual(metric(r), '0', 'a can\'t-confirm read must never look like a genuine zero');
  assert.equal(healthSummary(vs), 'unconfirmed');
});

test('a LOADING read shows no value and no health verdict', () => {
  const r: ReadResult<number> = { kind: 'loading' };
  const vs = resolveViewState(r);
  assert.equal(vs.healthy, null);
  assert.equal(vs.showData, false);
  assert.equal(metric(r), NO_VALUE);
  assert.equal(healthSummary(vs), 'unconfirmed');
});

test('a STALE read shows last-known data but is labelled and NOT healthy', () => {
  const r: ReadResult<number> = { kind: 'stale', data: 42, asOf: '11:55' };
  const vs = resolveViewState(r);
  assert.equal(vs.showData, true, 'stale still shows last-known data…');
  assert.equal(vs.healthy, false, '…but is never reported healthy');
  assert.equal(metric(r), '42');
  assert.ok(vs.banner && /last-known/i.test(vs.banner), 'stale must carry an as-of banner');
  assert.equal(healthSummary(vs), 'attention');
});

test('exhaustive: NO non-ok read is ever both healthy=true and shows a value', () => {
  const nonOk: ReadResult<number>[] = [
    { kind: 'error', message: 'x' },
    { kind: 'unknown', message: 'x' },
    { kind: 'loading' },
    { kind: 'stale', data: 7, asOf: 't' },
  ];
  for (const r of nonOk) {
    const vs = resolveViewState(r);
    assert.ok(!(vs.healthy === true), `${r.kind} must never be healthy=true`);
    // Only ok may render a green tick; a metric on any non-ok that hides data yields the placeholder.
    if (!vs.showData) assert.equal(renderMetric(vs, () => '✓'), NO_VALUE, `${r.kind} must not render a ✓`);
  }
});
