// ISSUE-087 §4 — the auth gate: "an unauthenticated visitor cannot reach the shell." Enforced at the edge
// before any shell route renders. An unauthenticated request to a protected path is redirected to /login;
// /login and framework internals are public. This is the coarse gate; per-node RBAC (which entry/panel a
// signed-in user sees) is enforced in the shell via the rbac seam (absent-not-empty).

import { NextResponse, type NextRequest } from 'next/server';

// Pre-auth surface-00 routes: /login (UI-LOGIN) and /setup (UI-INVITE-SETUP — the token is the gate).
const PUBLIC_PATHS = ['/login', '/setup'];

function hasSession(req: NextRequest): boolean {
  // Seeded-dev session cookie, OR a Supabase auth cookie (sb-...-auth-token) when configured.
  if (req.cookies.get('ah_session')) return true;
  for (const c of req.cookies.getAll()) {
    if (c.name.startsWith('sb-') && c.name.includes('auth-token')) return true;
  }
  return false;
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (isPublic) return NextResponse.next();

  if (!hasSession(req)) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Protect everything except Next internals + static assets. /login is handled in the body (public).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
