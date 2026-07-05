// ISSUE-011 §8 steps 3 + 5 — the append-only event_log write API + the out-of-band write-failure path.
//   step 3 (FR-7.LOG.002/004/005): populate `summary` (plain-English, never empty), redact `payload`
//           (no token/secret ever), capture `duration_ms`, resolve `cost_tokens` with the cost_unknown
//           sentinel distinct from a genuine 0.
//   step 5 (AC-7.LOG.003.2 / NFR-OBS.002 / AF-119): a failed write does NOT silently proceed — it records
//           to the out-of-band degraded sink AND sets the `log-write-failing` health bit the mgmt-plane
//           push carries, so the failure surfaces even when the silo DB is unreachable.

import { COST_UNKNOWN, isEventType } from "./types.ts";
import type { CostColumns, CostInput, EventLogInput, EventLogRow } from "./types.ts";
import { InvalidEventType, EventLogWriteFailure } from "./store.ts";
import type { DegradedSink, EventLogStore, HealthBitChannel } from "./store.ts";
import { redactPayload, redactSummary, containsSecretValue } from "./redact.ts";

/** A monotonic-ish id + server-authoritative clock, injectable so tests are deterministic (AF-120: the
 *  writer stamps created_at from the SERVER clock, never a caller/reporter-asserted time). */
export interface WriterClock {
  now(): Date;
  newId(): string;
}

/** Resolve the caller's cost input into the two schema columns (AC-7.LOG.004.1 / NFR-OBS.013). */
export function resolveCost(cost: CostInput | null | undefined): CostColumns {
  if (cost === COST_UNKNOWN) return { cost_tokens: null, cost_unknown: true };
  if (cost === null || cost === undefined) return { cost_tokens: null, cost_unknown: false };
  if (!Number.isFinite(cost) || cost < 0) {
    // A non-finite/negative cost is un-computable — record cost_unknown, NEVER a silent 0 (#3).
    return { cost_tokens: null, cost_unknown: true };
  }
  // A genuine number (0 = genuinely costless; N>0 = measured, estimate-grade per ADR-003, rounded up).
  return { cost_tokens: Math.ceil(cost), cost_unknown: false };
}

export class EmptySummary extends Error {
  constructor(eventType: string) {
    super(`event_log.summary is empty for '${eventType}' — a summary is required (AC-7.LOG.002.2)`);
    this.name = "EmptySummary";
  }
}

export interface EventWriterDeps {
  store: EventLogStore;
  degraded: DegradedSink;
  health: HealthBitChannel;
  clock: WriterClock;
}

export interface WriteResult {
  ok: boolean;
  row?: EventLogRow;
  /** Set when the write failed and the out-of-band path was taken (AC-7.LOG.003.2). */
  degraded?: boolean;
}

/**
 * The event-write API. Builds a schema-faithful, redacted, cost-resolved row and appends it. On a substrate
 * failure it takes the out-of-band path (degraded sink + health bit) and returns {ok:false, degraded:true}
 * — the failure is surfaced, never swallowed.
 */
export class EventWriter {
  constructor(private readonly deps: EventWriterDeps) {}

  async write(input: EventLogInput): Promise<WriteResult> {
    // Validate BEFORE any substrate call — these are caller errors, surfaced loudly (not swallowed).
    if (!isEventType(input.event_type)) throw new InvalidEventType(input.event_type);
    const summary = (input.summary ?? "").trim();
    if (summary.length === 0) throw new EmptySummary(input.event_type);

    const cost = resolveCost(input.cost);
    // FR-7.LOG.005 / #2 — redact BEFORE write; a payload that WOULD carry a credential is scrubbed.
    const payload =
      input.payload === undefined || input.payload === null
        ? null
        : (redactPayload(input.payload) as Record<string, unknown>);

    const row: EventLogRow = {
      id: this.deps.clock.newId(),
      task_id: input.task_id ?? null,
      event_type: input.event_type,
      entity_ids: input.entity_ids ?? null,
      summary: redactSummary(summary),
      payload,
      duration_ms: input.duration_ms ?? null,
      cost_tokens: cost.cost_tokens,
      cost_unknown: cost.cost_unknown,
      answer_mode: input.answer_mode ?? null,
      redacted_at: null,
      created_at: this.deps.clock.now().toISOString(), // server-authoritative (AF-120)
    };

    // Belt-and-braces #2 assertion: the row we are about to persist must carry no surviving credential VALUE
    // (a redacted secret-named key with a `[REDACTED]` value is fine; a real token/secret value is not).
    if (containsSecretValue(row.payload) || containsSecretValue(row.summary)) {
      // This should be impossible after redaction; if it ever fired it would be a redaction-logic bug,
      // surfaced loudly rather than persisting a secret.
      throw new Error("redaction invariant breached: credential material survived redaction (FR-7.LOG.005)");
    }

    try {
      await this.deps.store.append(row);
      return { ok: true, row };
    } catch (err) {
      // AC-7.LOG.003.2 / NFR-OBS.002 / AF-119 — the write failed. Do NOT proceed silently. Record the
      // failure out-of-band (a path that does NOT depend on the DB that just failed) and set the health
      // bit the mgmt-plane push carries, so the Super Admin grid sees it even with the silo DB down.
      const reason = err instanceof EventLogWriteFailure ? err.message : `unexpected: ${(err as Error).message}`;
      this.deps.degraded.record({
        at: this.deps.clock.now().toISOString(),
        reason,
        event_type: row.event_type,
        summary: row.summary,
      });
      this.deps.health.set("log_write_failing", true); // latch — stays visible until a successful write clears it
      return { ok: false, degraded: true };
    }
  }
}

/** A default clock backed by crypto.randomUUID + the real wall clock (used by the live path / CLI). */
export function systemClock(): WriterClock {
  return {
    now: () => new Date(),
    newId: () => cryptoRandomUUID(),
  };
}

function cryptoRandomUUID(): string {
  // Node 20 exposes globalThis.crypto.randomUUID.
  return globalThis.crypto.randomUUID();
}
