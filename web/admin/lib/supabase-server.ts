// ISSUE-087 §2 — the real Supabase server-side (SSR-safe) client wiring.
//
// This is the production auth path: a cookie-bound server client per request (@supabase/ssr), reading the
// deployment's OWN Supabase (ADR-001 — auth runs in the client-owned project; the substrate holds no
// operator-side secret). It activates when the deployment's Supabase env is present. When it is absent
// (a plain `next dev` with no silo), the app falls back to the seeded-dev session in auth.ts so the shell
// is still bootable + clickable locally — the "see it" walking-skeleton goal. The LIVE per-deployment
// auth close is verified in ISSUE-013 (real OAuth, OD-175) + ISSUE-080/081 (deploy), not re-done here.

import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** A per-request SSR Supabase client bound to the Next cookie store. */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  const cookieMethods: CookieMethodsServer = {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(toSet) {
      // In a Server Component render, cookie writes are ignored (read-only context) — that is expected;
      // the middleware refreshes the session cookie on the response. We swallow the write-in-RSC error.
      try {
        for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
      } catch {
        /* read-only cookie context (RSC) — refreshed in middleware instead */
      }
    },
  };
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieMethods },
  );
}
