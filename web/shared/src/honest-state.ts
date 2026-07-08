// ISSUE-087 §2/§4 — the honest-state view-state logic. NON-NEGOTIABLE #3 (never fail silently).
//
// The issue's load-bearing AC: "a forced failed/stale read in the shared component renders 'can't
// load'/'stale' and NEVER '0'/'✓'/all-green (NFR-OBS.011), unit-proven on the primitive so every
// surface inherits it." Also OD-198 ③: a surface must distinguish "authorization returned nothing"
// (RLS-denied → can't confirm) from "genuinely zero" — an RLS-denied read must never render all-clear.
//
// The discipline is encoded in PURE LOGIC here (proven in honest-state.test.ts with tsx --test) so the
// React HonestState / Metric components are only thin renderers that CANNOT reintroduce a false-healthy
// view: they render whatever resolveViewState() dictates, and resolveViewState() structurally forbids a
// healthy render on any non-ok read.

/** What a data read can return to the UI. `unknown` = "we could not confirm" (e.g. authz returned nothing,
 *  a poll was missed, a probe failed) — the case OD-198 ③ says must never collapse into a healthy zero. */
export type ReadResult<T> =
  | { kind: 'loading' }
  | { kind: 'ok'; data: T; asOf: string }
  | { kind: 'stale'; data: T; asOf: string } // last-known-good, explicitly labelled with its age
  | { kind: 'error'; message: string }
  | { kind: 'unknown'; message: string }; // can't-confirm (authz-empty / probe-failed / dropped poll)

export type ViewTone = 'loading' | 'ok' | 'stale' | 'error' | 'unknown';

/** The render descriptor a component consumes. Structurally, `healthy` is `true` ONLY for an ok read;
 *  `showData` is true ONLY for ok/stale — so no component can render a metric value or a healthy tick on
 *  a failed/loading/can't-confirm read. `banner` is the honest human label for every non-ok tone. */
export interface ViewState<T> {
  tone: ViewTone;
  /** true ⇒ the caller may render `data`. false ⇒ the caller MUST render the placeholder, not a value. */
  showData: boolean;
  data?: T;
  /** true only for `ok`; false for a confirmed-bad read; null for "can't confirm" (never a bare false-healthy). */
  healthy: boolean | null;
  /** The honest banner text for a non-ok tone (undefined for ok). Never null/empty on a non-ok read. */
  banner?: string;
  /** For stale/ok: when the shown data was last known good. */
  asOf?: string;
}

/** The placeholder a metric renders when a value MUST NOT be shown (loading/error/unknown). Never "0"/"✓". */
export const NO_VALUE = '—';

/**
 * Map a read result to its honest render descriptor. This is the single chokepoint that makes a
 * false-healthy render structurally impossible: every branch except `ok` sets healthy≠true and, for the
 * non-data tones, showData=false so the value cannot be printed.
 */
export function resolveViewState<T>(result: ReadResult<T>): ViewState<T> {
  switch (result.kind) {
    case 'ok':
      return { tone: 'ok', showData: true, data: result.data, healthy: true, asOf: result.asOf };
    case 'stale':
      // Last-known data is shown, but explicitly LABELLED stale and NOT reported healthy (#3).
      return {
        tone: 'stale',
        showData: true,
        data: result.data,
        healthy: false,
        banner: `Showing last-known data from ${result.asOf} — live updates paused. Refresh for the latest.`,
        asOf: result.asOf,
      };
    case 'error':
      return {
        tone: 'error',
        showData: false,
        healthy: false,
        banner: result.message || "Couldn't load this — retry.",
      };
    case 'unknown':
      // Can't-confirm: NOT healthy, NOT a confirmed-bad, and crucially NOT a zero. healthy=null.
      return {
        tone: 'unknown',
        showData: false,
        healthy: null,
        banner: result.message || "Can't confirm this right now.",
      };
    case 'loading':
      return { tone: 'loading', showData: false, healthy: null };
  }
}

/**
 * Render a single metric value honestly. Returns the formatted value ONLY when the view-state permits
 * showing data; otherwise the NO_VALUE placeholder. A caller literally cannot print "0"/"✓" on a
 * failed/loading/can't-confirm read by routing every metric through here.
 */
export function renderMetric<T>(vs: ViewState<T>, format: (data: T) => string): string {
  if (vs.showData && vs.data !== undefined) return format(vs.data);
  return NO_VALUE;
}

/**
 * The "is everything green?" summariser for status tiles. Returns a tri-state, NEVER a bare boolean, so
 * an unconfirmable read can't masquerade as all-clear: 'ok' | 'attention' | 'unconfirmed'.
 */
export function healthSummary<T>(vs: ViewState<T>): 'ok' | 'attention' | 'unconfirmed' {
  if (vs.healthy === true) return 'ok';
  if (vs.healthy === false) return 'attention';
  return 'unconfirmed';
}
