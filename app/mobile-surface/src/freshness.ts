// ISSUE-079 — NFR-OBS.011 never-false-healthy, on the device most likely to be stale/offline (surface-12 #3).
//
// The single most dangerous view in the product is a confident "all clear" on a phone that couldn't actually
// confirm it. Every mobile tile/count/feed/list is rendered through these pure functions so a FAILED or STALE
// fetch reads "—" / "can't confirm" — NEVER a provisional "0" / "✓" / "all clear" / "Live". A genuine empty
// (the fetch succeeded and there is nothing) is distinct from a failed fetch and is the ONLY case that may read
// a confident "Nothing waiting".

/** The outcome of a fetch, carried alongside its data so rendering can be honest. */
export type FetchResult<T> =
  | { status: "ok"; data: T; fetchedAt: string }
  | { status: "stale"; data: T; fetchedAt: string } // last-known data, but we can't confirm it's current
  | { status: "loading" }
  | { status: "error"; message: string };

export const PLACEHOLDER = "—";
export const CANT_CONFIRM = "can't confirm";

/** A rendered scalar tile (e.g. a count / health score). `stale` carries the last value but flags it. */
export interface RenderedValue {
  display: string; // the string shown; "—" on error, never "0" on a failed fetch
  confident: boolean; // false ⇒ do not treat as a green/healthy signal
  stale: boolean;
  fetchedAt: string | null;
}

/** Render a numeric count. A failed fetch is "—" (never "0"); a stale fetch shows the value but confident=false. */
export function renderCount(r: FetchResult<number>): RenderedValue {
  switch (r.status) {
    case "ok":
      return { display: String(r.data), confident: true, stale: false, fetchedAt: r.fetchedAt };
    case "stale":
      return { display: String(r.data), confident: false, stale: true, fetchedAt: r.fetchedAt };
    case "loading":
      return { display: PLACEHOLDER, confident: false, stale: false, fetchedAt: null };
    case "error":
      return { display: PLACEHOLDER, confident: false, stale: false, fetchedAt: null };
  }
}

/**
 * Render the Home health tile. A failed OR stale health fetch NEVER renders green/healthy (#3): confident is
 * false and the display is "can't confirm", regardless of the last-known score. Only a fresh ok fetch may
 * render a healthy state.
 */
export function renderHealth(r: FetchResult<{ label: string; healthy: boolean }>): RenderedValue & { healthy: boolean } {
  switch (r.status) {
    case "ok":
      return { display: r.data.label, confident: true, stale: false, fetchedAt: r.fetchedAt, healthy: r.data.healthy };
    case "stale":
      // stale health is explicitly NOT green — labelled stale, never a fresh "all-green" (#3).
      return { display: `${r.data.label} (${CANT_CONFIRM} — stale)`, confident: false, stale: true, fetchedAt: r.fetchedAt, healthy: false };
    case "loading":
      return { display: PLACEHOLDER, confident: false, stale: false, fetchedAt: null, healthy: false };
    case "error":
      return { display: CANT_CONFIRM, confident: false, stale: false, fetchedAt: null, healthy: false };
  }
}

export type ListDisplay<T> =
  | { kind: "items"; items: T[]; stale: boolean; fetchedAt: string }
  | { kind: "empty"; message: string } // genuine confirmed-empty
  | { kind: "unconfirmed"; message: string } // could NOT confirm — never a false "all clear"
  | { kind: "loading" }
  | { kind: "error"; message: string };

/**
 * Render a list (queue / feed / alerts). A confirmed-empty ok fetch is the ONLY path to a confident empty
 * message; a stale/error/loading fetch is "unconfirmed"/"error"/"loading" — never a false "nothing here" (#3).
 * `emptyMessage` is the confident-empty copy (e.g. "No actions waiting"); `unconfirmedMessage` is the honest
 * fallback (e.g. "can't confirm queue state").
 */
export function renderList<T>(
  r: FetchResult<T[]>,
  emptyMessage: string,
  unconfirmedMessage: string,
): ListDisplay<T> {
  switch (r.status) {
    case "ok":
      return r.data.length === 0
        ? { kind: "empty", message: emptyMessage }
        : { kind: "items", items: r.data, stale: false, fetchedAt: r.fetchedAt };
    case "stale":
      // Stale data is shown (don't blank the screen) but a stale-and-empty list is NOT a confident empty.
      return r.data.length === 0
        ? { kind: "unconfirmed", message: unconfirmedMessage }
        : { kind: "items", items: r.data, stale: true, fetchedAt: r.fetchedAt };
    case "loading":
      return { kind: "loading" };
    case "error":
      return { kind: "error", message: r.message };
  }
}
