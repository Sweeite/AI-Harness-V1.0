// ISSUE-088/089 — the server-side authz helper shared by gated routes + actions. It resolves the caller's
// effective node set from app/rbac's OWN reader (via the 087 rbac-seam) — the SAME source can()/RLS use —
// so a route/action gate can never diverge from the harness gate (AF-080). Fail-closed: no session ⇒ no
// nodes. This is defense-in-depth behind the absent-not-empty nav gate, and the enforcement point for a
// direct-URL hit on a surface the caller isn't permitted to see (FR-1.PERM.006 → 404, not empty).

import { getSession, type Session } from './auth.ts';
import { grantedNodesFor } from './rbac-seam.ts';

export async function callerNodes(): Promise<{ session: Session | null; nodes: Set<string> }> {
  const session = await getSession();
  if (!session) return { session: null, nodes: new Set() };
  const nodes = await grantedNodesFor(session.userId, session.role);
  return { session, nodes };
}

export async function callerHas(node: string): Promise<boolean> {
  const { nodes } = await callerNodes();
  return nodes.has(node);
}
