// ISSUE-087 §2 — the typed data-access seam.
//
// The issue's rule: "a typed boundary (server actions / route handlers) through which surfaces call the
// app/* backend packages … One documented pattern surfaces reuse; NO surface talks to the DB directly."
// This module is the framework-free contract of that seam; each Next app supplies the concrete server-
// side implementation (web/client → its own Supabase; web/admin → the management DB, client_slug-valid).
//
// The seam is honest by construction: read() ALWAYS returns a ReadResult (never throws to the caller),
// mapping a thrown error to an `error` read and an authorization-empty result to an `unknown` read — so a
// surface that renders through resolveViewState() can never turn a failed/denied backend call into a
// false-healthy view (NFR-OBS.011 / OD-198 ③). This is where "authz returned nothing" is kept distinct
// from "genuinely zero".

import type { ReadResult } from './honest-state.ts';

/** Identifies the caller for authz — the same user id app/rbac's can()/effectiveNodes() resolves against. */
export interface SeamCaller {
  userId: string;
  /** The surface the call originates from — recorded, never used to branch authz (NFR-SEC.013 no back-door). */
  surface?: 'desktop' | 'mobile' | 'command' | 'quick-tap' | 'api';
}

/** A read the seam can perform. `T` is the surface's own row/DTO shape. */
export interface SeamRead<T> {
  /** A stable id for the read (telemetry / cache key). */
  id: string;
  /** Runs the actual app/* backend call. May throw; the seam catches and maps to an honest read. */
  load: (caller: SeamCaller) => Promise<SeamOutcome<T>>;
}

/**
 * What a load() returns. `data` present ⇒ a confirmed read (possibly empty-but-confirmed).
 * `authorized: false` ⇒ the backend/RLS returned nothing because the caller wasn't permitted — mapped to
 * an `unknown` read (can't-confirm), NOT to a healthy zero. `stale` ⇒ last-known data, labelled.
 */
export type SeamOutcome<T> =
  | { data: T; asOf: string; stale?: boolean }
  | { authorized: false; reason: string };

/** The seam surfaces call. One method; one honest contract. */
export interface DataSeam {
  read<T>(read: SeamRead<T>, caller: SeamCaller): Promise<ReadResult<T>>;
}

/** ISO-ish timestamp helper the concrete seam impls stamp reads with (injected so it stays testable). */
export type Clock = () => string;

/**
 * The reference DataSeam. Wraps a load() so the surface always receives a ReadResult: a thrown error →
 * `error`; an unauthorized outcome → `unknown` (can't-confirm, distinct from zero); a stale outcome →
 * `stale`; otherwise `ok`. Concrete app seams either use this directly (passing an app/*-backed load) or
 * mirror its mapping.
 */
export function makeDataSeam(): DataSeam {
  return {
    async read<T>(read: SeamRead<T>, caller: SeamCaller): Promise<ReadResult<T>> {
      try {
        const outcome = await read.load(caller);
        if ('authorized' in outcome) {
          // Authz returned nothing → we cannot confirm state. NEVER a healthy zero (OD-198 ③).
          return { kind: 'unknown', message: `Not permitted to view this (${outcome.reason}).` };
        }
        if (outcome.stale) return { kind: 'stale', data: outcome.data, asOf: outcome.asOf };
        return { kind: 'ok', data: outcome.data, asOf: outcome.asOf };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Backend read failed.';
        return { kind: 'error', message };
      }
    },
  };
}
