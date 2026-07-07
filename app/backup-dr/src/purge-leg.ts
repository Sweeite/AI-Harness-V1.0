// ISSUE-085 — the off-platform backup-PURGE leg of compliance erasure (NFR-DR.009 — the RECEIVE-LEG contract).
//
// C2 FR-2.MNT.017 (AC-2.MNT.017.2) RAISES the flag; C2 explicitly seams the mechanics to Phase 5. NFR-DR.009
// IS the receive-leg contract: an erased target's Personal data present in PRE-ERASURE off-platform snapshots is
// purged/expired within one dump-cycle (≤ the hourly cadence) OR confirmed clear at the next restore rehearsal —
// and completion (or a STILL-OPEN flag) is LOGGED, never silently dropped (#1: erased data must not reappear in
// a restored snapshot; #3: a still-open purge is loud, not silently carried forward).
//
// The concrete flag transport is unspecified in C2 by design — this module treats the PurgeFlag shape + the
// "received + actioned" semantics as the interface (coordinated with the ISSUE-082 raise-leg it consumes from).
//
// ⚠️ Residual owed-to-live: AF-137 (SPIKE) plants a real residue in a pre-erasure off-platform snapshot and
// asserts the flag clears it within the window. We build the receive→action→confirm→log LOGIC and prove it
// offline (fake the snapshot purge); the live spike is operator-present.

import { type PurgeFlag } from './types.ts';
import {
  type BackupDrStore,
  type PurgeFlagState,
} from './store.ts';

/** The purge driver — the seam over the actual off-platform snapshot expiry/rewrite (the live adapter deletes/
 *  expires the target's Personal data from pre-erasure snapshots in the client-owned store; a fake offline).
 *  It reports which pre-erasure snapshots still contained the target and whether they were cleared. */
export interface PurgeDriver {
  /** Purge/expire `target_ref`'s Personal data from all pre-erasure off-platform snapshots for `client_slug`
   *  (those taken at/before `erasure_effective_at`). Returns the clearance result. Must NEVER report cleared
   *  on a residue it did not actually purge (the #1 keystone — erased data must not survive in a snapshot). */
  purgeFromPreErasureSnapshots(input: {
    client_slug: string;
    target_ref: string;
    erasure_effective_at: string;
  }): Promise<PurgeDriverResult>;
}

export interface PurgeDriverResult {
  pre_erasure_snapshots_examined: number;
  snapshots_with_residue: number;
  snapshots_cleared: number; // must equal snapshots_with_residue for a clean clearance
  detail: string;
}

/** The outcome of actioning one purge flag (AC-NFR-DR.009.1/.2). `cleared` ⇒ every pre-erasure snapshot with the
 *  target's residue was purged within the window. `still_open` ⇒ residue remains → a LOGGED exception, surfaced
 *  at the next rehearsal/health-check, never silently carried forward or reported clear. */
export interface PurgeOutcome {
  flag_id: string;
  client_slug: string;
  status: 'cleared' | 'still_open';
  examined: number;
  residue_found: number;
  cleared: number;
  within_window: boolean; // purge completed within one dump-cycle of the erasure (≤ hourly cadence)?
  logged: true; // the outcome is ALWAYS logged — completion or a still-open flag (#3)
  detail: string;
}

/** Receive a purge flag raised by C2 (idempotent on flag_id) and record it OPEN in the store (NFR-DR.009). This
 *  is the receive half; `actionPurgeFlag` is the action half. Returns whether the flag was new. */
export async function receivePurgeFlag(store: BackupDrStore, flag: PurgeFlag): Promise<{ state: PurgeFlagState; new: boolean }> {
  const { new: isNew } = await store.receivePurgeFlag(flag);
  const state = await store.getPurgeFlag(flag.flag_id);
  if (!state) throw new Error(`purge flag '${flag.flag_id}' vanished after receive — invariant violated`);
  return { state, new: isNew };
}

/** One dump-cycle window in seconds — the hourly cadence bound (NFR-DR.001/009). A flag not cleared within this
 *  of the erasure is surfaced as a still-open exception at the next rehearsal/health-check (AC-NFR-DR.009.2). */
export const DUMP_CYCLE_SECONDS = 60 * 60; // ≤ hourly cadence

/** Action a received purge flag (AC-NFR-DR.009.1): purge the target from pre-erasure off-platform snapshots via
 *  the driver, confirm clearance, mark the flag cleared (or leave it OPEN + log), and report — ALWAYS logged. A
 *  driver that leaves residue (or throws) yields a STILL-OPEN outcome, never a silent "clear" (#1/#3). */
export async function actionPurgeFlag(
  store: BackupDrStore,
  driver: PurgeDriver,
  flag: PurgeFlag,
  serverNow: number,
): Promise<PurgeOutcome> {
  let result: PurgeDriverResult | null = null;
  let driverError: string | null = null;
  try {
    result = await driver.purgeFromPreErasureSnapshots({
      client_slug: flag.client_slug,
      target_ref: flag.target_ref,
      erasure_effective_at: flag.erasure_effective_at,
    });
  } catch (e) {
    driverError = e instanceof Error ? e.message : String(e);
  }

  const raisedAtSec = Math.floor(Date.parse(flag.raised_at) / 1000);
  const withinWindow = serverNow - raisedAtSec <= DUMP_CYCLE_SECONDS;

  if (!result) {
    // Driver failed — the flag stays OPEN and is logged loud (never reported clear on a failure — #1/#3).
    return {
      flag_id: flag.flag_id,
      client_slug: flag.client_slug,
      status: 'still_open',
      examined: 0,
      residue_found: 0,
      cleared: 0,
      within_window: withinWindow,
      logged: true,
      detail: `purge driver failed: ${driverError} — flag STILL OPEN, logged for the next rehearsal/health-check (NFR-DR.009 / AC-NFR-DR.009.2); erased data may still persist in a pre-erasure snapshot`,
    };
  }

  // logic-sweep fix: a bare `snapshots_cleared === snapshots_with_residue` treats an all-zeros
  // result (examined=0/residue=0/cleared=0) as CLEARED (0===0) — but that is exactly what a
  // silently-empty scan produces (wrong client_slug/target_ref, an empty query that did not throw).
  // Require the driver to have actually examined a snapshot before trusting a clearance, else the
  // flag stays OPEN + logged (never confirm off-platform erasure that was never proven — #1/#3).
  const fullyCleared =
    result.pre_erasure_snapshots_examined > 0 &&
    result.snapshots_cleared === result.snapshots_with_residue;
  if (fullyCleared) {
    await store.markPurgeCleared(flag.flag_id, new Date(serverNow * 1000).toISOString(), 'off-platform-purge-leg');
    return {
      flag_id: flag.flag_id,
      client_slug: flag.client_slug,
      status: 'cleared',
      examined: result.pre_erasure_snapshots_examined,
      residue_found: result.snapshots_with_residue,
      cleared: result.snapshots_cleared,
      within_window: withinWindow,
      logged: true,
      detail: `purge CLEARED — ${result.snapshots_cleared}/${result.snapshots_with_residue} pre-erasure snapshot(s) with residue purged${withinWindow ? ' within the dump-cycle window' : ' (LATE — logged)'} (NFR-DR.009 / AC-NFR-DR.009.1)`,
    };
  }

  // Residue remains — the flag stays OPEN and is a LOGGED exception (never silently cleared — #1/#3).
  return {
    flag_id: flag.flag_id,
    client_slug: flag.client_slug,
    status: 'still_open',
    examined: result.pre_erasure_snapshots_examined,
    residue_found: result.snapshots_with_residue,
    cleared: result.snapshots_cleared,
    within_window: withinWindow,
    logged: true,
    detail: `purge INCOMPLETE — ${result.snapshots_cleared}/${result.snapshots_with_residue} snapshot(s) cleared; residue REMAINS → flag STILL OPEN, logged for the next rehearsal/health-check (NFR-DR.009 / AC-NFR-DR.009.2)`,
  };
}

/** Sweep for still-open purge flags at a rehearsal/health-check (AC-NFR-DR.009.2). Any open flag past its
 *  dump-cycle window is surfaced as a LOGGED exception — never silently carried forward or reported clear. */
export async function openPurgeFlagExceptions(
  store: BackupDrStore,
  client_slug: string,
  serverNow: number,
): Promise<Array<{ flag_id: string; overdue: boolean; detail: string }>> {
  const open = await store.listOpenPurgeFlags(client_slug);
  return open.map((s) => {
    const raisedAtSec = Math.floor(Date.parse(s.flag.raised_at) / 1000);
    const overdue = serverNow - raisedAtSec > DUMP_CYCLE_SECONDS;
    return {
      flag_id: s.flag.flag_id,
      overdue,
      detail: overdue
        ? `purge flag '${s.flag.flag_id}' STILL OPEN past its dump-cycle window — LOGGED exception, erasure not confirmed complete off-platform (NFR-DR.009 / AC-NFR-DR.009.2)`
        : `purge flag '${s.flag.flag_id}' open, within window — will be actioned this dump cycle`,
    };
  });
}
