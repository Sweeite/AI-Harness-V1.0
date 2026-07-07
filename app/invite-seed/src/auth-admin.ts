// ISSUE-015 — the Supabase Auth admin-API seam (FR-0.INV.001/.004, FR-0.SEED.001). Account genesis is
// invite-only: public signup is OFF at the Supabase project level, so the admin API is the ONLY path that
// creates the underlying `auth.users` row (createUser / inviteUserByEmail — no password, no auto-email; the
// native ≤24h setup link follows via generateLink + custom SMTP). ADR-001: these calls run inside the
// client-owned Supabase project (never operator custody), as service_role (ADR-006, off the RLS path).
//
// WHY THIS IS A PORT (the ISSUE-015 BLOCKER fix): `profiles.id` FKs `auth.users(id)` (0001_baseline.sql L98,
// `on delete cascade`). The profiles MIRROR row MUST reuse the REAL `auth.users.id` — never a fabricated
// `gen_random_uuid()` with no parent, which raises `foreign_key_violation` on every live invite/seed. The
// admin API creates the auth.users row and RETURNS its id; the store threads THAT id into profiles. Same
// discipline as app/auth/src/supabase-store.ts `upsertProfile(id, …)` (the real auth id is threaded in), and
// the same port+fake seam shape as SmtpSender here — so offline (fake) and live (adapter) agree by
// construction. The invariant this closes: no `profiles` insert with an id absent from `auth.users`.

/** The result of creating the underlying auth.users row via the admin API. `id` IS the `auth.users.id` the
 *  profiles mirror row must use as its own primary key (the FK parent). */
export interface AuthUser {
  /** the created auth.users.id (a uuid) — the value `profiles.id` MUST equal (FK to auth.users(id)). */
  id: string;
  email: string;
}

/** The Supabase Auth admin-API port. The live adapter wraps `supabase.auth.admin.createUser`
 *  (invite-only genesis: no password, no auto-email — the ≤24h setup link is sent separately via SMTP). The
 *  fake below is the deterministic reference model that drives the offline suite. Creating the auth user is
 *  ALWAYS the first step of an invite/seed genesis, and its returned id is the profiles-mirror primary key —
 *  so an orphan profile (an id with no auth.users parent) is impossible by construction. */
export interface AuthAdmin {
  /** Create the auth.users row for `email` (no password / no auto-email) and return it, including the id the
   *  profiles mirror row must adopt. Idempotency/uniqueness of email is Supabase-managed (auth.users). */
  createUser(email: string): Promise<AuthUser>;
}

/** In-memory reference AuthAdmin. Mints a deterministic uuid per email so the offline suite is stable and the
 *  profiles mirror always references a "real" (fake-side) auth.users id — mirroring the live contract that the
 *  admin API returns the id the profiles FK needs. Deterministic: no clock/random (house discipline). */
export class InMemoryAuthAdmin implements AuthAdmin {
  /** the fake auth.users table: email → created user (so a repeat createUser on the same email is stable). */
  readonly users = new Map<string, AuthUser>();
  private seq = 0;

  /** A deterministic uuid-shaped id (v4 layout) seeded from a counter — stable across runs, no randomness. */
  private nextUuid(): string {
    this.seq += 1;
    const hex = this.seq.toString(16).padStart(12, '0');
    // xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx — the '4' (version) and '8' (variant) nibbles keep it uuid-shaped.
    return `00000000-0000-4000-8000-${hex}`;
  }

  async createUser(email: string): Promise<AuthUser> {
    const existing = this.users.get(email);
    if (existing) return existing; // email is unique in auth.users — a repeat returns the same id.
    const user: AuthUser = { id: this.nextUuid(), email };
    this.users.set(email, user);
    return user;
  }
}
