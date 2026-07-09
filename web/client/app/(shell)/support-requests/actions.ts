'use server';

// ISSUE-088 — the authenticated support-queue transition actions. Both re-check PERM-support.resolve on the
// server (fail-closed) — the UI hiding the button is not the enforcement point. Invalid transitions (e.g.
// resolved→pending) are rejected by the store. resolved rows are immutable history (OD-019: not a reset tool).

import { revalidatePath } from 'next/cache';

import { callerNodes } from '../../../lib/authz.ts';
import { transitionSupportRequest } from '../../../lib/support-store.ts';
import type { DemoSupportRequest } from '../../../lib/demo-users.ts';

async function transition(id: string, to: DemoSupportRequest['status']): Promise<void> {
  const { session, nodes } = await callerNodes();
  if (!session || !nodes.has('PERM-support.resolve')) return; // fail-closed
  transitionSupportRequest(id, to, session.email);
  revalidatePath('/support-requests');
}

export async function pickUp(id: string): Promise<void> {
  await transition(id, 'in-progress');
}

export async function resolve(id: string): Promise<void> {
  await transition(id, 'resolved');
}
