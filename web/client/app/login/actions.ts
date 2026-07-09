'use server';

// ISSUE-088 — the PUBLIC (pre-auth) support-request intake action for UI-LOGIN's "Trouble signing in?"
// modal. Insert-only: it creates a `pending` row and cannot read the queue (the authenticated queue is
// PERM-support.view-gated). No credential reset here (OD-019) — an admin resolves by checking access.

import { insertSupportRequest } from '../../lib/support-store.ts';

export async function submitSupportRequest(formData: FormData): Promise<{ ok: boolean; message: string }> {
  return insertSupportRequest({
    email: String(formData.get('email') ?? ''),
    name: String(formData.get('name') ?? ''),
    issue: String(formData.get('issue') ?? ''),
  });
}
