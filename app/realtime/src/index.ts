// @harness/realtime — ISSUE-076 (C7 client-side data-freshness contract). Public surface: the surface
// catalogue + freshness types, the RealtimeContract port (RealtimeConfigSource + ConnectionManager), the
// in-memory fake reference model (InMemoryRealtimeConfig), the live config/seed adapter, and the two pure
// resolvers (effectivePollSeconds / effectiveThresholdPercent). Consumers: the approval queue (ISSUE-056)
// and notification centre (ISSUE-073) ride the two Realtime subscriptions; the ops/mobile dashboards
// (ISSUE-078/079) render the freshness indicator + the degrade health signal this contract emits. This
// slice stops at the transport/freshness contract — the panels themselves render in Phase 3.
//
// The `check` CLI runs the offline build-time gate (no DB, no network) that NFR-OBS.014 / AC-7.RTP.001.3
// demand: the set of Realtime surfaces is EXACTLY two (approval_queue + notification_centre) and every
// other catalogued surface is a polled surface with a config key + a documented default cadence.

import { fileURLToPath } from 'node:url';

import {
  SURFACE_CATALOGUE,
  REALTIME_SURFACES,
  HEADROOM_THRESHOLD_KEY,
  HEADROOM_THRESHOLD_DEFAULT,
  SILO_CAP,
  surfaceSpec,
  type SurfaceId,
  type SurfaceSpec,
  type Transport,
  type FreshnessMode,
  type SiloTier,
} from './surfaces.ts';
import {
  ConnectionManager,
  InMemoryRealtimeConfig,
  effectivePollSeconds,
  effectiveThresholdPercent,
  realtimeFilterFor,
  ERR_THIRD_REALTIME,
  type RealtimeConfigSource,
  type RealtimeFilter,
  type DegradeHealthSignal,
} from './store.ts';
import {
  SupabaseRealtimeConfig,
  type ApprovalSeedRow,
  type NotificationSeedRow,
} from './supabase-store.ts';

export {
  // catalogue + types
  SURFACE_CATALOGUE,
  REALTIME_SURFACES,
  HEADROOM_THRESHOLD_KEY,
  HEADROOM_THRESHOLD_DEFAULT,
  SILO_CAP,
  surfaceSpec,
  type SurfaceId,
  type SurfaceSpec,
  type Transport,
  type FreshnessMode,
  type SiloTier,
  // port + fake + resolvers
  ConnectionManager,
  InMemoryRealtimeConfig,
  effectivePollSeconds,
  effectiveThresholdPercent,
  realtimeFilterFor,
  ERR_THIRD_REALTIME,
  type RealtimeConfigSource,
  type RealtimeFilter,
  type DegradeHealthSignal,
  // live adapter
  SupabaseRealtimeConfig,
  type ApprovalSeedRow,
  type NotificationSeedRow,
};

interface Finding {
  gate: string;
  message: string;
}

/** The build-time cap gate: exactly two Realtime surfaces, every other surface polled with a cadence key +
 *  documented default. This is the offline expression of AC-7.RTP.001.3 / AC-NFR-OBS.014.1 — a third
 *  Realtime surface (or a polled surface missing its config wiring) fails the build. */
function checkTwoRealtimeSurfaces(): Finding[] {
  const findings: Finding[] = [];

  // 1. Exactly two Realtime-entitled surfaces in the catalogue.
  const realtime = SURFACE_CATALOGUE.filter((s) => s.transport === 'realtime').map((s) => s.id);
  if (realtime.length !== 2) {
    findings.push({ gate: 'two-realtime', message: `catalogue has ${realtime.length} Realtime surfaces, expected exactly 2 (NFR-OBS.014) — [${realtime.join(', ')}]` });
  }

  // 2. …and they are exactly the two named trust-critical surfaces (no drift in WHICH two).
  const expected = new Set(REALTIME_SURFACES);
  for (const id of realtime) {
    if (!expected.has(id)) findings.push({ gate: 'two-realtime', message: `surface '${id}' is Realtime-entitled but is not one of the two named surfaces (approval_queue, notification_centre)` });
  }
  for (const id of REALTIME_SURFACES) {
    const spec = SURFACE_CATALOGUE.find((s) => s.id === id);
    if (!spec) findings.push({ gate: 'two-realtime', message: `named Realtime surface '${id}' is missing from the catalogue` });
    else if (spec.transport !== 'realtime') findings.push({ gate: 'two-realtime', message: `named Realtime surface '${id}' is catalogued as '${spec.transport}', not 'realtime'` });
    else if (!spec.trustCritical) findings.push({ gate: 'two-realtime', message: `named Realtime surface '${id}' must be trust-critical (prioritised, last to degrade — AC-NFR-PERF.011.2)` });
  }

  // 3. Every OTHER surface is polled with a config key + a documented default cadence (FR-7.RTP.002).
  for (const s of SURFACE_CATALOGUE) {
    if (s.transport === 'poll') {
      if (!s.pollIntervalKey) findings.push({ gate: 'poll-wiring', message: `polled surface '${s.id}' has no config key — its cadence cannot be read from config (AC-7.RTP.002.1)` });
      if (s.defaultPollSeconds === undefined || s.defaultPollSeconds <= 0) findings.push({ gate: 'poll-wiring', message: `polled surface '${s.id}' has no positive default cadence — an unset key would have no fallback (AC-7.RTP.002.1)` });
      if (s.trustCritical) findings.push({ gate: 'poll-wiring', message: `polled surface '${s.id}' is marked trust-critical but only the two Realtime surfaces may be` });
    }
  }

  // 4. The two Realtime filters carry NO client_slug predicate (AC-7.RTP.003.3).
  for (const id of REALTIME_SURFACES) {
    const f = realtimeFilterFor(id);
    const cols = f.predicate ? [f.predicate.column] : [];
    if (cols.some((c) => c.toLowerCase().includes('client_slug'))) {
      findings.push({ gate: 'no-client-slug', message: `Realtime filter for '${id}' references client_slug — forbidden inside a single-tenant silo (ADR-001 §3, reconciliation #1)` });
    }
  }

  return findings;
}

function runCheck(): Finding[] {
  const findings = checkTwoRealtimeSurfaces();
  const realtime = SURFACE_CATALOGUE.filter((s) => s.transport === 'realtime').map((s) => s.id);
  const polled = SURFACE_CATALOGUE.filter((s) => s.transport === 'poll').map((s) => s.id);
  if (findings.length === 0) {
    console.log(`✓ realtime check: exactly 2 Realtime surfaces [${realtime.join(', ')}] · ${polled.length} polled surfaces each config-keyed with a documented default · no Realtime filter depends on client_slug · headroom default ${HEADROOM_THRESHOLD_DEFAULT}%.`);
  } else {
    console.error(`✗ realtime check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

// Only run the CLI when invoked directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}
