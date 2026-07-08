// ISSUE-087 §2 — the client app's data-access seam into the REAL @harness/rbac backend package.
//
// This is the "one documented pattern surfaces reuse; no surface talks to the DB directly" boundary. It
// resolves the caller's effective permission nodes from app/rbac's OWN effectiveNodes()/can() (the same
// reader the RLS backstop uses, AF-080) — so the shell's nav gate and the harness gate can never diverge.
// It also renders "one live signal" (the caller's effective-node summary) end-to-end through the typed
// DataSeam, proving the pattern each surface will reuse (ISSUE-087 DoD §4, seam-calls-a-real-package).
//
// It imports app/rbac's pg-FREE leaf modules (store/can/catalog) directly — the InMemory reference model —
// so a `next dev` boot needs no live DB. The live Supabase-backed adapter path (SupabaseRbacStore) is the
// per-deployment concern proven in ISSUE-080/081, not re-done in the substrate.

import { InMemoryRbacStore, effectiveNodes, defaultMatrix, ROLES, type Role } from '@harness/rbac-bridge';
import { makeDataSeam, type ReadResult, type SeamCaller } from '@harness/web-shared';

export type { Role };
export const ALL_ROLES: readonly Role[] = ROLES;

/**
 * Build a seeded reference store: the six canonical roles, each holding its default-matrix grants, plus a
 * user assigned `role`. Mirrors what provisioning's migration 0006 seeds, using the SAME catalog source.
 */
async function seededStore(userId: string, role: Role): Promise<InMemoryRbacStore> {
  const store = new InMemoryRbacStore();
  const matrix = defaultMatrix();
  const roleIds = new Map<Role, string>();
  for (const r of ROLES) {
    const row = await store.createRole(r, true, r === 'Super Admin');
    roleIds.set(r, row.id);
    for (const node of matrix.get(r) ?? new Set<string>()) store._grant(row.id, node);
  }
  await store.assignRole(userId, roleIds.get(role)!);
  return store;
}

/** Resolve the caller's effective granted nodes — EXACTLY as app/rbac's can() resolves them (no drift). */
export async function grantedNodesFor(userId: string, role: Role): Promise<Set<string>> {
  const store = await seededStore(userId, role);
  return effectiveNodes(store, userId);
}

const seam = makeDataSeam();

/** The shape of the "live signal" the substrate renders through the seam to prove the boundary works. */
export interface RbacSignal {
  role: Role;
  nodeCount: number;
  sampleNodes: string[];
}

/**
 * Read the caller's RBAC signal THROUGH the typed DataSeam (honest by construction: a thrown error → an
 * `error` read, never a false-healthy view). This is the end-to-end "seam calls a real app/* package".
 */
export async function readRbacSignal(caller: SeamCaller, role: Role): Promise<ReadResult<RbacSignal>> {
  return seam.read<RbacSignal>(
    {
      id: 'rbac.effective-nodes',
      load: async (c) => {
        const nodes = await grantedNodesFor(c.userId, role);
        const list = [...nodes].sort();
        return {
          data: { role, nodeCount: list.length, sampleNodes: list.slice(0, 6) },
          asOf: new Date().toLocaleTimeString(),
        };
      },
    },
    caller,
  );
}
