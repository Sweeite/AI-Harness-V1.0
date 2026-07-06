// ISSUE-016 — the UI-SUPPORT-REQUESTS view-model + the "Trouble signing in?" intake-form model, plus the
// build-time a11y baseline the AC-NFR-A11Y.001 audit runs over. This module is PURE (no DOM, no I/O): it turns
// the support_requests rows into the ordered, a11y-annotated render model the surface-00 §UI-SUPPORT-REQUESTS
// spec mandates. Rendering it to actual DOM is the app-shell's job (ISSUE-013 owns UI-LOGIN); this slice owns
// the ordering rule (OD-106), the overdue computation (FR-0.REC.007), and the a11y contract for both.
//
// OD-106 default ordering (surface-00 L279/L349): OVERDUE pending pinned to the top, then everything NEWEST-
// FIRST. "Overdue" = a pending row whose created_at is older than support.stale_request_minutes (FR-0.REC.007).
//
// AC-NFR-A11Y.001 (observability.md L287-288): every action control is LABELLED; status is NEVER conveyed by
// colour alone — each status/overdue indicator carries a TEXT cue (and a shape/icon token) so a screen-reader
// or colour-blind operator perceives the true state. auditA11y() below is the offline audit the test asserts.

import type { SupportRequestRow, SupportStatus } from './store.ts';

// ── Status presentation: a TEXT label + a non-colour SHAPE cue per state (AC-NFR-A11Y.001.2) ────────
export interface StatusPresentation {
  status: SupportStatus;
  label: string; // human text — the state is readable, never colour-only
  shape: string; // a non-colour glyph/shape token (icon name) reinforcing the label
  ariaLabel: string; // screen-reader text
}
export const STATUS_PRESENTATION: Readonly<Record<SupportStatus, StatusPresentation>> = {
  pending: { status: 'pending', label: 'Pending', shape: 'dot-hollow', ariaLabel: 'Status: pending' },
  in_progress: { status: 'in_progress', label: 'In progress', shape: 'half-circle', ariaLabel: 'Status: in progress' },
  resolved: { status: 'resolved', label: 'Resolved', shape: 'check', ariaLabel: 'Status: resolved' },
};

/** A single row of the rendered queue, with its a11y annotations + overdue flag. */
export interface QueueRow {
  id: string;
  email: string;
  name: string;
  issue_description: string;
  status: SupportStatus;
  statusPresentation: StatusPresentation;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  overdue: boolean;
  overdueCue: string | null; // text cue when overdue (never colour-only) — null when not overdue
}

/** An action control offered on a row — each MUST carry a non-empty label (AC-NFR-A11Y.001.1). `permGate` is
 *  recorded so the shell renders the control only for holders (default-deny), but the label exists regardless. */
export interface ActionControl {
  action: 'pick_up' | 'resolve';
  label: string;
  ariaLabel: string;
  permGate: 'PERM-support.resolve';
  toStatus: SupportStatus;
}

/** The action controls available for a row given its current status (FR-0.REC.005 legal moves). A resolved row
 *  offers NO actions (immutable history). */
export function actionsFor(status: SupportStatus): ActionControl[] {
  if (status === 'pending') {
    return [{ action: 'pick_up', label: 'Pick up', ariaLabel: 'Pick up this request (set in progress)', permGate: 'PERM-support.resolve', toStatus: 'in_progress' }];
  }
  if (status === 'in_progress') {
    return [{ action: 'resolve', label: 'Resolve', ariaLabel: 'Resolve this request', permGate: 'PERM-support.resolve', toStatus: 'resolved' }];
  }
  return []; // resolved — immutable, no actions
}

/**
 * The default queue view model (OD-106): overdue pending pinned top, then newest-first. `staleMinutes` +
 * `now` drive the overdue computation (a pending row older than the threshold is overdue, FR-0.REC.007).
 * Pure sort — does not mutate the input.
 */
export function buildQueueView(rows: readonly SupportRequestRow[], now: string, staleMinutes: number): QueueRow[] {
  const cutoffMs = new Date(now).getTime() - staleMinutes * 60_000;
  const mapped: QueueRow[] = rows.map((r) => {
    const overdue = r.status === 'pending' && new Date(r.created_at).getTime() < cutoffMs;
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      issue_description: r.issue_description,
      status: r.status,
      statusPresentation: STATUS_PRESENTATION[r.status],
      assigned_to: r.assigned_to,
      created_at: r.created_at,
      updated_at: r.updated_at,
      overdue,
      overdueCue: overdue ? 'Overdue' : null,
    };
  });
  // OD-106: overdue first (pinned), then within each group newest-first by created_at.
  return mapped.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1; // overdue pinned to top
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime(); // newest-first
  });
}

// ── The queue non-data states (surface-00 L305-311). Error must NOT render an empty list (#3). ──────
export type QueueRenderState = 'loading' | 'ready' | 'empty' | 'error' | 'partial' | 'offline';
export interface QueueViewState {
  state: QueueRenderState;
  rows: QueueRow[];
  message: string | null; // the honest banner text for non-ready states (never a false "all clear")
  actionsEnabled: boolean; // offline/error ⇒ actions disabled so a resolve isn't mistaken as landed
}

/** Resolve the render state honestly: an ERROR never falls through to an empty list (which would falsely read
 *  "no one needs help", #3). Empty is only the genuine healthy zero-state. */
export function resolveQueueState(
  fetch: { ok: boolean; rows: SupportRequestRow[]; stale?: boolean; offline?: boolean },
  now: string,
  staleMinutes: number,
): QueueViewState {
  if (fetch.offline) {
    return { state: 'offline', rows: buildQueueView(fetch.rows, now, staleMinutes), message: 'Live updates paused — connectivity lost. Actions are disabled until reconnect.', actionsEnabled: false };
  }
  if (!fetch.ok) {
    return { state: 'error', rows: [], message: "Couldn't load support requests. Retry.", actionsEnabled: false };
  }
  const rows = buildQueueView(fetch.rows, now, staleMinutes);
  if (fetch.stale) {
    return { state: 'partial', rows, message: 'Live updates paused — showing data as of last refresh. Refresh for the latest.', actionsEnabled: true };
  }
  if (rows.length === 0) {
    return { state: 'empty', rows, message: 'No open support requests.', actionsEnabled: true };
  }
  return { state: 'ready', rows, message: null, actionsEnabled: true };
}

// ── The public "Trouble signing in?" intake-form model (FR-0.REC.002) ───────────────────────────────
export interface FormField {
  name: 'email' | 'name' | 'issue_description';
  label: string; // labelled control (AC-NFR-A11Y.001.1)
  ariaLabel: string;
  required: true;
  inputType: 'email' | 'text' | 'textarea';
}
export const TROUBLE_SIGNING_IN_FORM: readonly FormField[] = [
  { name: 'email', label: 'Your email', ariaLabel: 'Your email address', required: true, inputType: 'email' },
  { name: 'name', label: 'Your name', ariaLabel: 'Your name', required: true, inputType: 'text' },
  { name: 'issue_description', label: 'What went wrong?', ariaLabel: 'Describe the issue you are having signing in', required: true, inputType: 'textarea' },
];

/** FR-0.REC.001 — the login surface must expose the "Trouble signing in?" entry-point and NO self-service
 *  password reset. This is the canonical surface-model assertion: the login-page control inventory carries the
 *  support link and NEVER a "forgot password" / reset-link control. */
export const LOGIN_RECOVERY_CONTROLS = {
  troubleSigningIn: { label: 'Trouble signing in?', ariaLabel: 'Trouble signing in? Open a support request', opensModal: true as const },
  // Deliberately absent: no `forgotPassword` / `resetLink` control exists (FR-0.REC.001 / AC-0.REC.001.1).
} as const;

/** True iff the login surface offers a self-service password-reset control. MUST be false (AC-0.REC.001.1). */
export function hasSelfServiceReset(controls: Record<string, unknown>): boolean {
  return 'forgotPassword' in controls || 'resetLink' in controls || 'passwordReset' in controls;
}

// ── Build-time a11y audit (AC-NFR-A11Y.001) ─────────────────────────────────────────────────────────
export interface A11yFinding {
  rule: string;
  message: string;
}

/**
 * The offline a11y baseline audit for the UI-SUPPORT-REQUESTS surface + the intake form (the axe-class
 * build-time lint AC-NFR-A11Y.001 mandates, expressed over this slice's view model). Returns [] when the
 * baseline holds. Checks:
 *   (1) every status presentation carries a non-empty TEXT label AND a non-colour SHAPE cue (no colour-only
 *       status — AC-NFR-A11Y.001.2);
 *   (2) every overdue row carries a text cue (not colour-only);
 *   (3) every action control + form field carries a non-empty label AND ariaLabel (AC-NFR-A11Y.001.1);
 *   (4) the login surface exposes the labelled "Trouble signing in?" control and NO self-service reset.
 */
export function auditA11y(view: QueueViewState): A11yFinding[] {
  const findings: A11yFinding[] = [];

  // (1) status is never colour-only — each state has a text label + a shape token.
  for (const p of Object.values(STATUS_PRESENTATION)) {
    if (!p.label.trim()) findings.push({ rule: 'status-not-colour-only', message: `status '${p.status}' has no text label (AC-NFR-A11Y.001.2)` });
    if (!p.shape.trim()) findings.push({ rule: 'status-not-colour-only', message: `status '${p.status}' has no non-colour shape cue (AC-NFR-A11Y.001.2)` });
    if (!p.ariaLabel.trim()) findings.push({ rule: 'labelled-status', message: `status '${p.status}' has no aria-label (AC-NFR-A11Y.001.1)` });
  }

  // (2) overdue indicator carries a text cue.
  for (const row of view.rows) {
    if (row.overdue && !row.overdueCue) {
      findings.push({ rule: 'overdue-not-colour-only', message: `row '${row.id}' is overdue but carries no text cue (AC-NFR-A11Y.001.2)` });
    }
    // (3a) every action control on the row is labelled.
    for (const a of actionsFor(row.status)) {
      if (!a.label.trim()) findings.push({ rule: 'labelled-control', message: `action '${a.action}' on row '${row.id}' has no label (AC-NFR-A11Y.001.1)` });
      if (!a.ariaLabel.trim()) findings.push({ rule: 'labelled-control', message: `action '${a.action}' on row '${row.id}' has no aria-label (AC-NFR-A11Y.001.1)` });
    }
  }

  // (3b) every intake-form field is labelled.
  for (const f of TROUBLE_SIGNING_IN_FORM) {
    if (!f.label.trim()) findings.push({ rule: 'labelled-control', message: `form field '${f.name}' has no label (AC-NFR-A11Y.001.1)` });
    if (!f.ariaLabel.trim()) findings.push({ rule: 'labelled-control', message: `form field '${f.name}' has no aria-label (AC-NFR-A11Y.001.1)` });
  }

  // (4) the login surface carries the labelled support control and NO self-service reset.
  if (!LOGIN_RECOVERY_CONTROLS.troubleSigningIn.label.trim()) {
    findings.push({ rule: 'labelled-control', message: `the "Trouble signing in?" control has no label (AC-NFR-A11Y.001.1)` });
  }
  if (hasSelfServiceReset(LOGIN_RECOVERY_CONTROLS)) {
    findings.push({ rule: 'no-self-service-reset', message: `the login surface exposes a self-service reset control (AC-0.REC.001.1 forbids it)` });
  }

  return findings;
}
