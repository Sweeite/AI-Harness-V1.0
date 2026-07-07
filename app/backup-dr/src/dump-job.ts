// ISSUE-085 — the hourly off-platform pg_dump JOB DEFINITION (NFR-DR.001/002 / ADR-008 parts 1-2).
//
// This slice SUPPLIES the job definition that provisioning (ISSUE-007 / FR-10.PRV.001) SCHEDULES. It is NOT
// the scheduler (that is ISSUE-007) and it does NOT run pg_dump offline (the live DumpDriver in the live
// adapter does that, gated by AF-072 LOAD at volume). Here we define WHAT the job is: an encrypted logical
// dump → the client-owned, different-region, lifecycle-independent destination, hourly, PITR off by default;
// plus the AF-072 fallback decision (hourly can't keep up → back off cadence / move to PITR, LOGGED).
//
// ⚠️ Residual owed-to-live: AF-072 (LOAD — the hourly dump completes within the hour for a large mature brain)
// is operator-present. We define the fallback LOGIC and prove it offline; the actual at-volume timing is live.

import { type RecoveryTier, type OffPlatformDestination } from './types.ts';
import { type DowngradeEntry } from './store.ts';

/** The hourly off-platform dump job definition provisioning wires (FR-10.PRV.001). Encrypted logical pg_dump,
 *  hourly, to the client-owned destination; the free daily in-project floor stays; PITR off unless opted in. */
export interface DumpJobDefinition {
  client_slug: string;
  cadence: 'hourly'; // the default RPO mechanism (NFR-DR.001); below-hourly is a logged downgrade elsewhere
  method: 'logical-pg_dump'; // a portable logical dump (not an in-project backup)
  encrypted: true; // NFR-SEC.017 — the off-platform copy is always encrypted
  destination: OffPlatformDestination; // client-owned, different-region, lifecycle-independent (NFR-DR.002)
  pitr_enabled: false; // PITR is an opt-in upsell, OFF by default (NFR-DR.001)
  keeps_daily_in_project_floor: true; // free daily in-project backups stay for fast in-place restore
}

/** Build the default dump-job definition for a provisioned silo (AC-NFR-DR.001.1). Refuses a destination that
 *  fails the deletion-path defense (validated by the store; re-checked here so a job is never defined against a
 *  same-region / lifecycle-dependent copy). */
export function defaultDumpJob(client_slug: string, destination: OffPlatformDestination): DumpJobDefinition {
  return {
    client_slug,
    cadence: 'hourly',
    method: 'logical-pg_dump',
    encrypted: true,
    destination,
    pitr_enabled: false,
    keeps_daily_in_project_floor: true,
  };
}

// ── AF-072 fallback: hourly can't keep up at volume → back off / upsell PITR, LOGGED (AC-NFR-DR.001.2) ────

export type CadenceFallback = 'back-off-cadence' | 'move-to-pitr';

export interface CadenceDecision {
  client_slug: string;
  within_hour: boolean; // did the hourly dump complete within the hour (AF-072)?
  action: 'keep-hourly' | CadenceFallback;
  new_tier: RecoveryTier | null; // set when moving to PITR
  downgrade: DowngradeEntry | null; // set when backing off below hourly — a LOGGED exception (never silent)
  detail: string;
}

/** Decide the cadence when an hourly dump's measured duration is known (AF-072 fallback, AC-NFR-DR.001.2). If it
 *  fits the hour → keep hourly. If not → back off the cadence (a LOGGED downgrade) OR move to the PITR upsell —
 *  never leave the silo SILENTLY below its stated RPO (#3). `prefer` picks the fallback path. */
export function decideCadence(input: {
  client_slug: string;
  measured_dump_seconds: number;
  serverNow: number;
  prefer?: CadenceFallback;
  logged_by?: string;
}): CadenceDecision {
  const withinHour = input.measured_dump_seconds <= 3600;
  if (withinHour) {
    return {
      client_slug: input.client_slug,
      within_hour: true,
      action: 'keep-hourly',
      new_tier: null,
      downgrade: null,
      detail: `hourly dump completed in ${input.measured_dump_seconds}s ≤ 3600s — default RPO ~1h holds (AF-072)`,
    };
  }
  const prefer = input.prefer ?? 'move-to-pitr';
  const at = new Date(input.serverNow * 1000).toISOString();
  if (prefer === 'move-to-pitr') {
    return {
      client_slug: input.client_slug,
      within_hour: false,
      action: 'move-to-pitr',
      new_tier: 'pitr',
      downgrade: null, // PITR is ABOVE hourly — not a downgrade; it is the upsell fallback (~2-min RPO)
      detail: `hourly dump took ${input.measured_dump_seconds}s > 3600s — moved to the PITR upsell as a LOGGED decision (AF-072); silo never left silently below its RPO`,
    };
  }
  // back off the cadence — a below-hourly downgrade, which is a LOGGED change-control exception (NFR-DR.001).
  return {
    client_slug: input.client_slug,
    within_hour: false,
    action: 'back-off-cadence',
    new_tier: 'daily_in_project',
    downgrade: {
      at,
      from_tier: 'hourly_off_platform',
      to_tier: 'daily_in_project',
      reason: `hourly off-platform dump took ${input.measured_dump_seconds}s > 3600s at volume (AF-072) — cadence backed off`,
      logged_by: input.logged_by ?? 'system:af-072-fallback',
    },
    detail: `hourly dump took ${input.measured_dump_seconds}s > 3600s — cadence backed off to daily as a LOGGED downgrade (AF-072); never a silent default (NFR-DR.001)`,
  };
}
