// ISSUE-088/078/089 — the surface render layer's honest read over SEEDED demo data, shared by both apps.
//
// These render slices run on the 087 dev-auth / seeded path (no live DB — the walking-skeleton "see it"
// goal). Domain LOGIC is owned by app/* (user-mgmt 021, rbac 018/019, the C7 observability producers); the
// LIVE Supabase-backed adapter that reads their real tables is the per-deployment concern (ISSUE-080/081,
// OD-175). So this seeds demo rows and reads them THROUGH the honest DataSeam so that:
//   • a read the caller is not permitted to make maps to an `unknown` view (can't-confirm), NEVER a healthy
//     zero (OD-198 ③);
//   • a simulated backend failure maps to an `error` view (never a false-empty list) — the ?sim= hook lets
//     the operator force every honest-state branch in the browser and watch it never lie (#3).

import { makeDataSeam } from './seam.ts';
import type { SeamCaller } from './seam.ts';
import type { ReadResult } from './honest-state.ts';

const seam = makeDataSeam();

/** The in-browser honest-state proof hook. `?sim=error` forces a read to its failure branch, etc. */
export type Sim = 'ok' | 'error' | 'stale' | 'empty' | 'unknown';

export function simFrom(searchParams: Record<string, string | string[] | undefined> | undefined): Sim {
  const raw = searchParams?.sim;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'error' || v === 'stale' || v === 'empty' || v === 'unknown' ? v : 'ok';
}

/**
 * Read seeded data through the honest seam. `authorized === false` (or sim 'unknown') is the OD-198 ③
 * authz-empty case → an `unknown` (can't-confirm) view, never a zero. `sim` overrides the outcome for the
 * in-browser proof. `empty` returns a confirmed-empty (genuine zero) so the caller renders its true-empty
 * copy — distinct from error/unknown.
 */
export async function readSeeded<T>(opts: {
  id: string;
  caller: SeamCaller;
  authorized?: boolean;
  reason?: string;
  data: T;
  empty: T;
  sim: Sim;
  stale?: boolean;
  now?: () => string;
}): Promise<ReadResult<T>> {
  const now = opts.now ?? (() => new Date().toLocaleTimeString());
  return seam.read<T>(
    {
      id: opts.id,
      load: async () => {
        if (opts.authorized === false || opts.sim === 'unknown') {
          return { authorized: false as const, reason: opts.reason ?? 'no permission for this read' };
        }
        if (opts.sim === 'error') throw new Error("Couldn't load this — the backend read failed. Retry.");
        if (opts.sim === 'empty') return { data: opts.empty, asOf: now() };
        if (opts.sim === 'stale' || opts.stale) return { data: opts.data, asOf: '11:55:04', stale: true as const };
        return { data: opts.data, asOf: now() };
      },
    },
    opts.caller,
  );
}
