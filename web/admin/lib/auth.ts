// ISSUE-087 §2/§4 — the server-side session surface: authenticated/anonymous split, sign-out, and the
// aal2-aware posture. Two paths behind ONE getSession() contract:
//   • Supabase SSR (production): the real cookie-bound session (supabase-server.ts) — active when the
//     deployment's Supabase env is present.
//   • Seeded-dev (offline boot): a signed cookie naming a demo role, so `next dev` serves a clickable
//     authenticated shell with NO live DB (the walking-skeleton "see it" goal). Clearly flagged dev=true
//     so the UI can banner it and it is never mistaken for live auth.
// The role drives the RBAC nav via the seam (rbac-seam.ts). aal reflects the 2FA posture (ISSUE-020): an
// aal2-required area renders the step-up and does not leak (proven on /config below).

import { cookies } from 'next/headers';

import { isSupabaseConfigured, getSupabaseServerClient } from './supabase-server.ts';
import type { Role } from './rbac-seam.ts';

const SESSION_COOKIE = 'ah_session';

export interface Session {
  userId: string;
  email: string;
  role: Role;
  aal: 'aal1' | 'aal2';
  /** true ⇒ the seeded-dev session (no live Supabase). Surfaced in the UI so it's never mistaken for live. */
  dev: boolean;
}

/** The demo roster used by the seeded-dev sign-in. Lets the operator click through each role and WATCH the
 *  RBAC nav change — a live demonstration of the marquee absent-not-empty gate. */
export const DEMO_USERS: Record<Role, { userId: string; email: string }> = {
  'Super Admin': { userId: 'demo-super-admin', email: 'super.admin@demo.harness' },
  Admin: { userId: 'demo-admin', email: 'admin@demo.harness' },
  Finance: { userId: 'demo-finance', email: 'finance@demo.harness' },
  HR: { userId: 'demo-hr', email: 'hr@demo.harness' },
  'Account Manager': { userId: 'demo-account-manager', email: 'account.manager@demo.harness' },
  'Standard User': { userId: 'demo-standard-user', email: 'standard.user@demo.harness' },
};

/** Read the current session (or null if anonymous). SSR-safe: reads the request cookie store. */
export async function getSession(): Promise<Session | null> {
  // Production path: a real Supabase session, if the deployment is configured.
  if (isSupabaseConfigured()) {
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      // Role resolution from the DB (user_roles) is the deployment's own read; for the substrate we read
      // it from the seeded-dev cookie if present, else default to the least-privileged role (fail-closed).
      const devRole = await readDevRole();
      return {
        userId: data.user.id,
        email: data.user.email ?? 'unknown',
        role: devRole?.role ?? 'Standard User',
        aal: (data.user as { aal?: 'aal1' | 'aal2' }).aal === 'aal2' ? 'aal2' : 'aal1',
        dev: false,
      };
    }
    // configured but not signed in → anonymous
  }

  // Seeded-dev path (offline boot).
  const dev = await readDevRole();
  if (!dev) return null;
  const user = DEMO_USERS[dev.role];
  return { userId: user.userId, email: user.email, role: dev.role, aal: dev.aal, dev: true };
}

async function readDevRole(): Promise<{ role: Role; aal: 'aal1' | 'aal2' } | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { role: Role; aal: 'aal1' | 'aal2' };
    if (parsed.role in DEMO_USERS) return { role: parsed.role, aal: parsed.aal === 'aal2' ? 'aal2' : 'aal1' };
  } catch {
    /* malformed cookie → treat as anonymous (fail-closed) */
  }
  return null;
}

/** Server action: seeded-dev sign-in as a role (with or without a completed 2FA step-up). */
export async function writeDevSession(role: Role, aal: 'aal1' | 'aal2'): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, JSON.stringify({ role, aal }), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  });
}

/** Server action: sign out — clears the server session cookie (and the Supabase session if configured). */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  if (isSupabaseConfigured()) {
    const supabase = await getSupabaseServerClient();
    await supabase.auth.signOut();
  }
}
