// @harness/triggers — ISSUE-047 (C5 TRG task-entry boundary). Public surface: the TriggerStore port + the
// in-memory fake reference model, the four-trigger write path, the config-defined trigger registry, the
// verified-webhook ingress consumer + at-least-once enqueue, the chained-trigger handoff, and THE freeze
// gate (fail-closed at every dispatch boundary). Downstream: ISSUE-048 owns the task_queue lifecycle this
// slice writes `type`+`payload` into; ISSUE-049 owns the idempotency de-dup this slice seams to; ISSUE-083
// (C10 offboarding) SETS the freeze this slice enforces. Live pg adapter: supabase-store.ts.
//
// NO new migration in this slice (§5): task_queue is owned by ISSUE-048, deployment_settings is read-only
// here, event_log is written via the C7 sink. The freeze-block + ingest-failure `event_type` additions are a
// proposed additive enum delta recorded in results/ (same change-control class as OD-170/OD-179) — NOT edited
// into schema.md here (that is a shared file this parallel fan-out must not touch).
//
// The `check` CLI runs the offline build-time gates (no DB, no network):
//   (1) task_type completeness — exactly the four schema §5 enum values, no more/less (AC-5.TRG.001.1).
//   (2) freeze fail-closed default — a fresh (unfrozen) settings row allows dispatch; a set frozen_at AND an
//       unresolvable read both block (AC-NFR-INF.012.1/.2 structural check).
//   (3) event_type delta present — the two proposed additive values are declared here so the results/ delta
//       and the code agree (no drift between the proposal and what the gate emits).

export {
  TASK_TYPES,
  isTaskType,
  InMemoryTriggerStore,
  TriggerError,
  ERR_FROZEN,
  ERR_BAD_TYPE,
  ERR_UNVERIFIED,
  ERR_INGEST_FAILURE,
  type TaskType,
  type TaskRow,
  type DeploymentSettingsRow,
  type EventRow,
  type VerifiedEvent,
  type TriggerStore,
} from './store.ts';

export { TriggerRegistry, RegistryError, type TriggerDef } from './registry.ts';

export {
  evaluateFreeze,
  assertNotFrozen,
  fireTrigger,
  dispatchQueuedTask,
  ingestVerifiedEvent,
  fireChained,
  EVT_FROZEN_BLOCKED,
  EVT_INGEST_FAILURE,
  EVT_WATERMARK_FAILURE,
  type FreezeVerdict,
  type FireArgs,
  type IngestResult,
  type CompletedParent,
  type ChainSpec,
  type ScopedRetrieval,
  type ChainedTask,
} from './triggers.ts';

export { SupabaseTriggerStore } from './supabase-store.ts';

// ── Offline build-time `check` CLI ──────────────────────────────────────────────────────────────────
import { TASK_TYPES as _TASK_TYPES, InMemoryTriggerStore as _Store } from './store.ts';
import { evaluateFreeze as _evaluateFreeze, EVT_FROZEN_BLOCKED as _F, EVT_INGEST_FAILURE as _I } from './triggers.ts';

interface Finding {
  gate: string;
  ok: boolean;
  detail: string;
}

async function runChecks(): Promise<Finding[]> {
  const findings: Finding[] = [];

  // (1) task_type completeness — the schema §5 enum is exactly these four.
  const expected = ['scheduled', 'event', 'human', 'chained'];
  const gotSet = [..._TASK_TYPES].sort();
  const okTypes = JSON.stringify(gotSet) === JSON.stringify([...expected].sort());
  findings.push({ gate: 'task_type-completeness', ok: okTypes, detail: `types=${gotSet.join(',')}` });

  // (2) freeze fail-closed default.
  const s = new _Store();
  const unfrozen = await _evaluateFreeze(s);
  s._setFrozen('2026-07-05T00:00:00Z');
  const frozen = await _evaluateFreeze(s);
  s._setFrozen(null);
  s._setSettingsUnresolvable(true);
  const ambiguous = await _evaluateFreeze(s);
  const okFreeze = unfrozen.frozen === false && frozen.frozen === true && ambiguous.frozen === true;
  findings.push({
    gate: 'freeze-fail-closed',
    ok: okFreeze,
    detail: `unfrozen=${unfrozen.frozen} frozen=${frozen.frozen} ambiguous=${ambiguous.frozen}`,
  });

  // (3) event_type delta declared.
  const okDelta = _F === 'dispatch_frozen_blocked' && _I === 'ingest_failure';
  findings.push({ gate: 'event_type-delta', ok: okDelta, detail: `${_F},${_I}` });

  return findings;
}

if (process.argv[2] === 'check') {
  runChecks().then((findings) => {
    let allOk = true;
    for (const f of findings) {
      if (!f.ok) allOk = false;
      // eslint-disable-next-line no-console
      console.log(`${f.ok ? 'PASS' : 'FAIL'}  ${f.gate}  — ${f.detail}`);
    }
    if (!allOk) process.exit(1);
  });
}
