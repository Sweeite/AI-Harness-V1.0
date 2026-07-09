// ISSUE-088 — the seeded support-request store shared by the PUBLIC insert-only intake (UI-LOGIN "Trouble
// signing in?") and the AUTHENTICATED queue (UI-SUPPORT-REQUESTS). In-memory (dev-auth path); the live
// public-insert / authed-read RLS split is the per-deployment concern (ISSUE-016 + Phase-4 policy). The
// queue is the durable source of truth: a request always lands here even if a notification would fail.

import { DEMO_SUPPORT_REQUESTS, type DemoSupportRequest } from './demo-users.ts';

let seq = 100;

/** Public, insert-only: create a pending request. Cannot read existing rows (mirrors the public policy). */
export function insertSupportRequest(input: { email: string; name: string; issue: string }): { ok: boolean; message: string } {
  const email = input.email?.trim();
  const name = input.name?.trim();
  const issue = input.issue?.trim();
  if (!email || !name || !issue) return { ok: false, message: 'Please complete all fields.' };
  DEMO_SUPPORT_REQUESTS.push({
    id: `sup-${seq++}`,
    email, name, issue,
    status: 'pending',
    assignedTo: null,
    createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    overdue: false,
  });
  // #3: even if notifying admins failed, the request is durably queued — we never swallow it.
  return { ok: true, message: 'Thanks — your request has been sent. An administrator will follow up by email.' };
}

/** Newest-first with overdue `pending` pinned to the top (OD-106). */
export function listSupportRequests(filter?: DemoSupportRequest['status'] | 'all'): DemoSupportRequest[] {
  const rows = DEMO_SUPPORT_REQUESTS.filter((r) => !filter || filter === 'all' || r.status === filter);
  return [...rows].sort((a, b) => {
    const ap = a.status === 'pending' && a.overdue ? 1 : 0;
    const bp = b.status === 'pending' && b.overdue ? 1 : 0;
    if (ap !== bp) return bp - ap; // overdue-pending first
    return b.createdAt.localeCompare(a.createdAt); // then newest-first
  });
}

const ORDER: Record<DemoSupportRequest['status'], number> = { pending: 0, 'in-progress': 1, resolved: 2 };

/** Transition a request, rejecting invalid moves (e.g. resolved→pending). Returns false if invalid. */
export function transitionSupportRequest(id: string, to: DemoSupportRequest['status'], actor: string): boolean {
  const row = DEMO_SUPPORT_REQUESTS.find((r) => r.id === id);
  if (!row) return false;
  if (ORDER[to] <= ORDER[row.status]) return false; // no backward/again transitions (resolved is immutable)
  row.status = to;
  if (to === 'in-progress') row.assignedTo = actor;
  return true;
}
