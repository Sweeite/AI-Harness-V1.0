// ISSUE-036 — the in-memory OptEventSink fake = the test double AND the reference model. It enforces the
// SAME constraint the live event_log DDL + trigger enforce, so it cannot pass offline while the live
// adapter would throw (fake-vs-live discipline):
//   • event_type MUST be one of the two OPT values (OPT_EVENT_TYPES) — the live enum will reject any
//     other value once the additive delta lands (results/proposed-shared-spec.md); the fake rejects it
//     here too, LOUD (#3).
//   • summary MUST be non-empty (event_log.summary is NOT NULL, AC-7.LOG.002.2) — rejected here too.
//   • event_log is APPEND-ONLY (baseline trigger t_append_only): the fake exposes no delete/update path.

import { OPT_EVENT_TYPES, type OptEvent, type OptEventSink } from './store.js';

export class InMemoryOptEventSink implements OptEventSink {
  readonly events: OptEvent[] = [];

  async append(ev: OptEvent): Promise<void> {
    // Mirror the DDL constraints the live INSERT would hit (so a bad event fails offline, not just live).
    if (!OPT_EVENT_TYPES.includes(ev.event_type)) {
      throw new Error(
        `event_log: event_type '${String(ev.event_type)}' not in the OPT-admitted set {${OPT_EVENT_TYPES.join(', ')}} — the baseline enum would reject it (additive delta owed)`,
      );
    }
    if (!ev.summary || ev.summary.trim() === '') {
      throw new Error('event_log: summary must be non-empty (NOT NULL — AC-7.LOG.002.2)');
    }
    // Append-only: push, never mutate a prior row.
    this.events.push({ ...ev, payload: { ...ev.payload } });
  }

  /** Test aid: events of a given type. */
  of(type: OptEvent['event_type']): OptEvent[] {
    return this.events.filter((e) => e.event_type === type);
  }
}
