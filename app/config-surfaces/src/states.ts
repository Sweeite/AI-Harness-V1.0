// ISSUE-086 — the five load states for both surfaces (surface-01 §States, surface-01b §States), with the two
// #3 disciplines the surfaces exist to uphold:
//   (A) surface-01 config section: a PARTIAL load (some rows failed) DISABLES Save — never let a save
//       overwrite good config_values with empty because a row failed to load (#1); an ERROR/OFFLINE section
//       also disables Save.
//   (B) surface-01b audit timeline: a failed load NEVER renders as an empty timeline ("no changes ever") —
//       the single most dangerous state on the audit surface (a false-empty audit view could mask a
//       lost/unreachable store). The genuine Empty state further distinguishes "brand-new, no changes yet"
//       from "permitted-but-filtered-empty" — never conflating "you can't see any" with "none exist" (#3).

export type LoadState = 'loading' | 'ok' | 'empty' | 'error' | 'partial' | 'offline';

// ── (A) surface-01 config section ──────────────────────────────────────────────────────────────────────
export type SectionLoad =
  | { kind: 'loading' }
  | { kind: 'ok'; loadedKeys: readonly string[] } // every row loaded (loadedKeys may be empty only if section truly has 0 keys)
  | { kind: 'error'; reason: string }
  | { kind: 'partial'; loadedKeys: readonly string[]; failedKeys: readonly string[] }
  | { kind: 'offline'; loadedAt: string };

export interface SectionRender {
  state: LoadState;
  /** Save is enabled ONLY in a fully-loaded, online state — never on partial/error/offline (#1). */
  saveEnabled: boolean;
  /** Per-key value column marker for rows that failed to load in a partial state ("— (load error)"). */
  failedKeys: readonly string[];
  message: string;
}

export function renderSection(load: SectionLoad): SectionRender {
  switch (load.kind) {
    case 'loading':
      return { state: 'loading', saveEnabled: false, failedKeys: [], message: 'Loading configuration…' };
    case 'ok':
      return {
        state: load.loadedKeys.length === 0 ? 'empty' : 'ok',
        saveEnabled: load.loadedKeys.length > 0, // an empty section (schema gap) renders no Save
        failedKeys: [],
        message: load.loadedKeys.length === 0 ? 'No configuration keys found for this section. Contact support.' : 'loaded',
      };
    case 'error':
      // Save disabled until a successful load; values shown may be stale.
      return { state: 'error', saveEnabled: false, failedKeys: [], message: `Failed to load configuration. ${load.reason} [Retry]` };
    case 'partial':
      // The cardinal #1 discipline: a partial load disables Save so a good value is never overwritten with empty.
      return {
        state: 'partial',
        saveEnabled: false,
        failedKeys: [...load.failedKeys],
        message: 'Some rows failed to load (shown as "— (load error)"). Save is disabled until all rows load.',
      };
    case 'offline':
      return {
        state: 'offline',
        saveEnabled: false,
        failedKeys: [],
        message: `You are viewing config values loaded at ${load.loadedAt}. Changes cannot be saved until connectivity is restored.`,
      };
  }
}

// ── (B) surface-01b audit timeline ──────────────────────────────────────────────────────────────────────
export type AuditLoad =
  | { kind: 'loading' }
  | { kind: 'ok'; rowCount: number; filtered: boolean } // filtered=true when any filter is active
  | { kind: 'partial'; rowCount: number; unresolvedActors: number } // rows loaded but actor/desc resolution failed
  | { kind: 'error'; reason: string }
  | { kind: 'offline'; loadedAt: string };

export interface AuditRender {
  state: LoadState;
  /** True ONLY for a genuine, confirmed no-rows result — NEVER on error/offline (the #3 false-empty guard). */
  isEmptyTimeline: boolean;
  /** Export is available only from a confirmed-live, complete read — disabled offline (compliance). */
  exportEnabled: boolean;
  message: string;
}

export function renderAuditTimeline(load: AuditLoad): AuditRender {
  switch (load.kind) {
    case 'loading':
      // Never a false "no changes" before data resolves.
      return { state: 'loading', isEmptyTimeline: false, exportEnabled: false, message: 'Loading the config change history…' };
    case 'ok':
      if (load.rowCount === 0) {
        // Genuine empty — distinguish brand-new from permitted-but-filtered-empty; never a bare blank, and
        // never conflate "you can't see any" with "none exist".
        return {
          state: 'empty',
          isEmptyTimeline: true,
          exportEnabled: true,
          message: load.filtered
            ? 'No changes match your filters.'
            : 'No configuration changes have been recorded yet — changes appear here as config is edited on the Config Admin.',
        };
      }
      return { state: 'ok', isEmptyTimeline: false, exportEnabled: true, message: 'loaded' };
    case 'partial':
      // Rows loaded but actor/description resolution failed — render the change rows (the audit FACT), mark
      // actors "unresolved"; NEVER drop the change row (a missing actor name must not hide that a change occurred).
      return {
        state: 'partial',
        isEmptyTimeline: false,
        exportEnabled: true,
        message: `${load.rowCount} change(s) shown; ${load.unresolvedActors} actor(s) could not be resolved ("actor unresolved").`,
      };
    case 'error':
      // The cardinal #3 case: a failed load reads "couldn't load", NEVER an empty timeline implying no changes.
      return {
        state: 'error',
        isEmptyTimeline: false,
        exportEnabled: false,
        message: `Couldn't load the config change history. ${load.reason} [Retry]`,
      };
    case 'offline':
      return {
        state: 'offline',
        isEmptyTimeline: false,
        exportEnabled: false, // a compliance export must be a confirmed-live, complete read
        message: `last loaded ${load.loadedAt} — you're offline; export unavailable.`,
      };
  }
}

// ── mobile graceful-degradation banner (OD-100) ─────────────────────────────────────────────────────────
const MOBILE_BREAKPOINT_PX = 768;

export interface MobileDegradation {
  degraded: boolean;
  banner: string | null;
  /** On a narrow viewport a compliance export is discouraged/degraded (surface-01b §Mobile). */
  exportDiscouraged: boolean;
}

export function mobileDegradation(viewportPx: number): MobileDegradation {
  if (viewportPx < MOBILE_BREAKPOINT_PX) {
    return {
      degraded: true,
      banner: 'Config Admin is optimised for desktop. Some features may be limited on this device.',
      exportDiscouraged: true,
    };
  }
  return { degraded: false, banner: null, exportDiscouraged: false };
}
