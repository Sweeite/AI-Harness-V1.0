// ISSUE-011 §8 step 8 — the alert-engine watchdog (FR-7.ALR.008 / NFR-OBS.004 / AF-118). "The watcher is
// watched." The alert-evaluation engine emits a periodic heartbeat; an INDEPENDENT watchdog (not the engine
// itself) detects a missed heartbeat and raises a CRITICAL alert into `notifications`, with the stalled
// condition carried on the mgmt-plane push. This is the extension point ISSUE-075 wires the seven rules onto.
//
// AF-118 build-time proof lives in the tests: the watchdog is driven by an INJECTED clock (not wall time),
// so a test can (a) stall the engine and confirm the watchdog fires, and (b) prove the watchdog's OWN
// liveness — it evaluates on demand from a separate driver, so it cannot itself silently stall unnoticed
// (its evaluate() is called by an external cadence, and a self-check surfaces if that cadence stops).

import type { HealthBitChannel, NotificationStore } from "./store.ts";
import type { NotificationInput } from "./types.ts";

/**
 * The heartbeat the alert-evaluation engine emits. The engine calls `beat()` each cycle; the watchdog reads
 * `lastBeatAt`. Deliberately a plain shared value object — the engine and the watchdog are SEPARATE (the
 * watchdog never calls the engine; it only observes the timestamp), which is the whole point of AC-7.ALR.008.1.
 */
export class AlertEngineHeartbeat {
  private lastBeatMs: number | null = null;
  /** The engine calls this each evaluation cycle. `nowMs` is server-authoritative (AF-120). */
  beat(nowMs: number): void {
    this.lastBeatMs = nowMs;
  }
  lastBeatAt(): number | null {
    return this.lastBeatMs;
  }
}

export interface WatchdogDeps {
  heartbeat: AlertEngineHeartbeat;
  notifications: NotificationStore;
  health: HealthBitChannel;
  /** How long past the last beat before the engine is declared stalled (ms). */
  stallAfterMs: number;
  /** Server-authoritative clock (injected → deterministic tests; AF-120). */
  now: () => number;
  /** Id generator for the raised notification. */
  newId: () => string;
}

export interface WatchdogVerdict {
  stalled: boolean;
  /** ms since the last beat, or null if the engine never beat. */
  sinceLastBeatMs: number | null;
  /** The notification raised this evaluation (only when a stall is newly detected). */
  raised?: NotificationInput;
}

/**
 * The INDEPENDENT watchdog. `evaluate()` is driven by a cadence OUTSIDE the alert engine (its own loop /
 * the CLI / a test driver). On a missed heartbeat it raises exactly one critical alert (latched — it does
 * not re-raise every tick) and sets the `alert_engine_stalled` health bit the mgmt-plane push carries, so a
 * fully-down silo still surfaces on the Super Admin grid (AC-7.ALR.008.2 / AC-NFR-OBS.004.2).
 */
export class AlertEngineWatchdog {
  private stalledLatched = false;

  constructor(private readonly deps: WatchdogDeps) {}

  async evaluate(): Promise<WatchdogVerdict> {
    const now = this.deps.now();
    const last = this.deps.heartbeat.lastBeatAt();
    const since = last === null ? null : now - last;

    // Never-beat OR beat too long ago → stalled. A never-started engine is itself a stall (#3 — the absence
    // of ANY heartbeat is the strongest silent-failure signal).
    const stalled = last === null ? true : since! > this.deps.stallAfterMs;

    if (!stalled) {
      // Engine is live again — clear the latch + the health bit (recovery is surfaced, not silent).
      if (this.stalledLatched) {
        this.stalledLatched = false;
        this.deps.health.set("alert_engine_stalled", false);
      }
      return { stalled: false, sinceLastBeatMs: since };
    }

    // Stalled. Raise once (latched) and set the health bit.
    if (this.stalledLatched) {
      return { stalled: true, sinceLastBeatMs: since };
    }
    this.stalledLatched = true;
    this.deps.health.set("alert_engine_stalled", true);

    const raised: NotificationInput = {
      type: "alert_engine_stalled",
      severity: "critical",
      title: "Alert engine stalled — the watcher is watched",
      body:
        last === null
          ? "The alert-evaluation engine has never emitted a heartbeat; the watchdog raised a critical alert."
          : `The alert-evaluation engine missed its heartbeat (${since} ms since last beat > ` +
            `${this.deps.stallAfterMs} ms threshold); the independent watchdog raised a critical alert.`,
      recipient_role: "super_admin", // routed to Super Admin; also carried on the mgmt-plane push
    };
    await this.deps.notifications.create(raised, this.deps.newId(), new Date(now).toISOString());
    return { stalled: true, sinceLastBeatMs: since, raised };
  }

  /** For the AF-118 self-liveness proof: has the watchdog latched a stall? */
  isLatched(): boolean {
    return this.stalledLatched;
  }
}

/**
 * AF-118 meta-check: the watchdog itself must not silently stall. This asserts the watchdog's evaluate()
 * cadence is alive by requiring a driver to record its own last-evaluation timestamp; if the DRIVER stops
 * evaluating, `watchdogSelfStalled` becomes true and can be surfaced out-of-band (the same pattern one level
 * up). Returns true when the watchdog's own evaluation loop has gone quiet longer than its budget.
 */
export function watchdogSelfStalled(
  lastEvaluateAtMs: number | null,
  nowMs: number,
  budgetMs: number,
): boolean {
  if (lastEvaluateAtMs === null) return true; // never evaluated → self-stalled
  return nowMs - lastEvaluateAtMs > budgetMs;
}
