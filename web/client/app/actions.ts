'use server';

// ISSUE-087 — the server actions the shell's auth controls call. Seeded-dev sign-in/out + the aal2
// step-up. In a live deployment the sign-in path is replaced by real OAuth (surface-00 / ISSUE-013); these
// actions drive the substrate's bootable demo so the RBAC shell + the aal2 gate can be exercised offline.

import { redirect } from 'next/navigation';

import { writeDevSession, clearSession, getSession } from '../lib/auth.ts';
import type { Role } from '../lib/rbac-seam.ts';

export async function signInAs(role: Role, withMfa: boolean): Promise<void> {
  await writeDevSession(role, withMfa ? 'aal2' : 'aal1');
  redirect('/');
}

/** Complete the 2FA step-up for the current session (aal1 → aal2), then return to the target. */
export async function completeStepUp(next: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect('/login');
  await writeDevSession(session.role, 'aal2');
  redirect(next && next.startsWith('/') ? next : '/');
}

export async function signOut(): Promise<void> {
  await clearSession();
  redirect('/login');
}
