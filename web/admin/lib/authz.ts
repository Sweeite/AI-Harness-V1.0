// ISSUE-078 — the management-plane server-side authz helper (mirrors web/client). Resolves the caller's
// effective node set from app/rbac's OWN reader via the 087 rbac-seam (the same source can()/RLS use), so a
// fleet route gate can never diverge from the harness gate. Fail-closed: no session ⇒ no nodes.

import { getSession, type Session } from './auth.ts';
import { grantedNodesFor } from './rbac-seam.ts';

export async function callerNodes(): Promise<{ session: Session | null; nodes: Set<string> }> {
  const session = await getSession();
  if (!session) return { session: null, nodes: new Set() };
  const nodes = await grantedNodesFor(session.userId, session.role);
  return { session, nodes };
}
