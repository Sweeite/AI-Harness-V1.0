// ISSUE-016 — the SupportStore PORT + in-memory fake reference model (the house port+fake pattern, cf.
// app/rbac, app/retention, app/hard-limits). Every live side effect of the REC area routes through this port
// so the intake, the status machine, notification, and the stale sweep stay unit-testable with NO live DB.
// The in-memory fake is BOTH the test double AND the reference model the live pg adapter (supabase-store.ts)
// must match 1:1.
//
// FAKE-VS-LIVE DISCIPLINE — the fake mirrors the ISSUE-008 baseline DDL (0001_baseline.sql L107-116) EXACTLY
// so it cannot pass offline while the live adapter would throw against real DDL:
//   support_requests(id uuid pk, email text NOT NULL, name text NOT NULL, issue_description text NOT NULL,
//                    status support_status NOT NULL default 'pending', assigned_to uuid → profiles(id) nullable,
//                    created_at timestamptz NOT NULL default now(), updated_at timestamptz NOT NULL default now())
//   support_status enum = ('pending','in_progress','resolved')   ← the ONLY three states (no 'contacted', OD-019)
// The three NOT NULL text columns are validated on insert here EXACTLY as the DB would reject a null/empty —
// so a blank-field intake fails offline the same way it fails live (FR-0.REC.002, #3 never-silent).
//
// RLS BOUNDARY (schema.md §rls-policies L51): support_requests is public-INSERT-only pre-auth intake; SELECT
// and UPDATE are gated by PERM-support.view / PERM-support.resolve. The fake models this by routing every read
// through requireView() and every transition through requireResolve() against the SupportAuthz port, so an
// offline caller without the node is denied EXACTLY as the RLS policy would deny at the DB (AC-0.REC.003.1).
// The DDL-level policy itself is authored by the orchestrator (results/proposed-shared-spec.md).

import { PERM_SUPPORT_VIEW, PERM_SUPPORT_RESOLVE, type SupportAuthz } from './authz.ts';

// ── The support_status state machine (support_status enum; OD-019 — no 'contacted') ────────────────
export type SupportStatus = 'pending' | 'in_progress' | 'resolved';
export const SUPPORT_STATUSES: readonly SupportStatus[] = ['pending', 'in_progress', 'resolved'] as const;

/** The ONLY legal forward transitions (FR-0.REC.005). pending→in_progress→resolved; resolved is terminal =
 *  immutable history. No skips, no reopens, no backward moves — anything else is rejected (#2/#3). */
const LEGAL_TRANSITIONS: Readonly<Record<SupportStatus, readonly SupportStatus[]>> = {
  pending: ['in_progress'],
  in_progress: ['resolved'],
  resolved: [], // terminal — immutable
};
export function isLegalTransition(from: SupportStatus, to: SupportStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

// ── Row shapes (0001_baseline.sql L107-116) ────────────────────────────────────────────────────────
export interface SupportRequestRow {
  id: string;
  email: string;
  name: string;
  issue_description: string;
  status: SupportStatus;
  assigned_to: string | null; // → profiles(id); nullable while pending
  created_at: string; // ISO — timestamptz
  updated_at: string; // ISO — timestamptz
}

/** An immutable status-transition record (FR-0.REC.005: actor + timestamp per transition, appended history).
 *  The live adapter writes one access_audit row (audit_type='support_status_transition') per transition. */
export interface StatusTransition {
  request_id: string;
  from_status: SupportStatus;
  to_status: SupportStatus;
  actor_id: string; // the PERM-support.resolve holder who made the transition
  at: string; // ISO timestamp
}

/** Raised by every guard/gate failure — carries a machine reason so callers surface, never swallow (#3). */
export class SupportError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'SupportError';
  }
}
export const ERR_DENIED = 'denied'; // authz failure (RLS boundary — AC-0.REC.003.1)
export const ERR_EMPTY_FIELD = 'empty_field'; // a NOT NULL text field was blank/absent (FR-0.REC.002)
export const ERR_NO_SUCH_REQUEST = 'no_such_request';
export const ERR_ILLEGAL_TRANSITION = 'illegal_transition'; // not a legal support_status move (FR-0.REC.005)
export const ERR_IMMUTABLE = 'resolved_immutable'; // attempt to mutate resolved history (FR-0.REC.005)

// ── The port ────────────────────────────────────────────────────────────────────────────────────────
export interface SupportStore {
  // Intake — PUBLIC (pre-auth); the ONLY unauthenticated write. Validates the three NOT NULL text fields.
  insertRequest(input: { email: string; name: string; issue_description: string }, now: string): Promise<SupportRequestRow>;

  // Reads — PERM-support.view-gated (RLS SELECT boundary). A caller without the node is denied.
  listRequests(actorId: string): Promise<SupportRequestRow[]>;
  getRequest(actorId: string, id: string): Promise<SupportRequestRow | null>;

  // Transition — PERM-support.resolve-gated (RLS UPDATE boundary). Appends the actor+timestamp history row;
  // rejects illegal moves + any mutation of resolved history.
  transition(actorId: string, id: string, to: SupportStatus, now: string): Promise<SupportRequestRow>;
  transitionsFor(actorId: string, id: string): Promise<StatusTransition[]>;

  // Stale sweep source — system read (no auth.uid(); runs as service_role). Returns pending rows whose
  // created_at is older than `cutoff` (now - stale_request_minutes). Read-only; never mutates (FR-0.REC.007).
  pendingOlderThan(cutoff: string): Promise<SupportRequestRow[]>;
}

// ── The in-memory fake reference model ───────────────────────────────────────────────────────────────
let __id = 0;
const nextId = () => `sr-${++__id}`;

/** Mirror the DDL's NOT NULL text constraint: a null/undefined/empty-after-trim value is rejected EXACTLY as
 *  the DB would (the DB rejects NULL; the app rejects empty so a whitespace-only field is never a silent
 *  no-op intake, #3). Returns the trimmed value. */
function requireText(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SupportError(ERR_EMPTY_FIELD, `support_requests.${field} is NOT NULL — a blank '${field}' is rejected (FR-0.REC.002)`);
  }
  return value.trim();
}

export class InMemorySupportStore implements SupportStore {
  private requests: SupportRequestRow[] = [];
  private transitions: StatusTransition[] = [];

  constructor(private authz: SupportAuthz) {}

  // ── Gates (the RLS boundary, enforced in the fake EXACTLY as the DB policy would) ──────────────────
  private async requireView(actorId: string): Promise<void> {
    if (!(await this.authz.can(actorId, PERM_SUPPORT_VIEW))) {
      throw new SupportError(ERR_DENIED, `PERM-support.view required to read the support queue (AC-0.REC.003.1)`);
    }
  }
  private async requireResolve(actorId: string): Promise<void> {
    if (!(await this.authz.can(actorId, PERM_SUPPORT_RESOLVE))) {
      throw new SupportError(ERR_DENIED, `PERM-support.resolve required to transition a support request (FR-0.REC.005)`);
    }
  }

  async insertRequest(input: { email: string; name: string; issue_description: string }, now: string): Promise<SupportRequestRow> {
    // PUBLIC — no authz gate (the pre-auth intake is the one unauthenticated write). Validate the three
    // NOT NULL text columns before inserting so a blank submission never files a silent empty row (#3).
    const email = requireText('email', input.email);
    const name = requireText('name', input.name);
    const issue_description = requireText('issue_description', input.issue_description);
    const row: SupportRequestRow = {
      id: nextId(),
      email,
      name,
      issue_description,
      status: 'pending', // DDL default
      assigned_to: null, // nullable while pending
      created_at: now,
      updated_at: now,
    };
    this.requests.push(row);
    return { ...row };
  }

  async listRequests(actorId: string): Promise<SupportRequestRow[]> {
    await this.requireView(actorId);
    return this.requests.map((r) => ({ ...r }));
  }
  async getRequest(actorId: string, id: string): Promise<SupportRequestRow | null> {
    await this.requireView(actorId);
    const row = this.requests.find((r) => r.id === id);
    return row ? { ...row } : null;
  }

  async transition(actorId: string, id: string, to: SupportStatus, now: string): Promise<SupportRequestRow> {
    await this.requireResolve(actorId);
    const row = this.requests.find((r) => r.id === id);
    if (!row) throw new SupportError(ERR_NO_SUCH_REQUEST, `support request '${id}' not found`);
    // resolved = immutable history (FR-0.REC.005): any transition out of resolved is refused.
    if (row.status === 'resolved') {
      throw new SupportError(ERR_IMMUTABLE, `support request '${id}' is resolved — history is immutable (FR-0.REC.005)`);
    }
    if (!isLegalTransition(row.status, to)) {
      throw new SupportError(ERR_ILLEGAL_TRANSITION, `illegal transition ${row.status}→${to} (legal: pending→in_progress→resolved) (FR-0.REC.005)`);
    }
    const from = row.status;
    row.status = to;
    row.updated_at = now;
    // assigned_to is set to the actor when the request is first picked up (pending→in_progress).
    if (to === 'in_progress') row.assigned_to = actorId;
    this.transitions.push({ request_id: id, from_status: from, to_status: to, actor_id: actorId, at: now });
    return { ...row };
  }
  async transitionsFor(actorId: string, id: string): Promise<StatusTransition[]> {
    await this.requireView(actorId);
    return this.transitions.filter((t) => t.request_id === id).map((t) => ({ ...t }));
  }

  async pendingOlderThan(cutoff: string): Promise<SupportRequestRow[]> {
    // System read (service_role, no auth.uid()) — the stale sweep runs off the RLS path (ADR-006). Read-only.
    return this.requests.filter((r) => r.status === 'pending' && r.created_at < cutoff).map((r) => ({ ...r }));
  }

  // ── Test-seam helpers (not part of the port) ──────────────────────────────────────────────────────
  /** All rows, unguarded — for assertions only (the live DB has no such back door). */
  _all(): SupportRequestRow[] {
    return this.requests.map((r) => ({ ...r }));
  }
  _allTransitions(): StatusTransition[] {
    return this.transitions.map((t) => ({ ...t }));
  }
}
