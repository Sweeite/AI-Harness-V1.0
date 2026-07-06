// ISSUE-015 — domain types for invite + seed bootstrap (C0). Pure data + the ≤24h TTL cap constant; no
// I/O, no DB, no Date.now()/random (house determinism discipline — `now` is caller-supplied epoch seconds).
//
// Grounded in:
//   - component-00-login.md FR-0.INV.001..007, FR-0.SEED.001..003 (the AC text lives there — read it).
//   - schema.md §1 Identity & Auth / 0001_baseline.sql: profiles, support_requests, roles, user_roles.
//   - AF-074: the native Supabase invite/OTP/recovery link expiry is a GLOBAL project setting hard-capped
//     at 86400 s (24 h). There is NO custom invite-token table (OD-014) — the token is native.

/** AF-074: the hosted-Supabase hard cap on invite/OTP/recovery link expiry — 24 h in seconds. A GLOBAL
 *  project setting (not per-link): lowering it shortens BOTH invite and seed setup links. Any requested TTL
 *  above this is clamped down (never silently exceeded) — proven offline here; the live coupling is AF-074
 *  (LIVE-owed, see feasibility-register.md). */
export const LINK_TTL_HARD_CAP_SECONDS = 86_400;

/** The two account-genesis paths (both C0-owned) drive which setup branch the invited user takes. */
export type AccountType =
  | 'client_tenant' // Option A — connects OAuth; NO password is ever set (FR-0.INV.004 / AC-0.INV.004.2).
  | 'external_admin'; // Option B — email+password THEN TOTP enroll (FR-0.INV.004 / AC-0.INV.004.1).

/** The origin of a setup link — an admin-issued invite, or the one-time first-boot seed link. Both reuse
 *  UI-INVITE-SETUP and the same native ≤24h token mechanism (FR-0.SEED.002 reuses the invite path). */
export type LinkOrigin = 'invite' | 'seed';

/** Invite lifecycle state (FR-0.INV.002/.006). `pending` = link live & unused; `used` = consumed by a
 *  completed setup (activation); `expired` = past its ≤24h TTL; `revoked` = admin-cancelled pre-use. */
export type InviteState = 'pending' | 'used' | 'expired' | 'revoked';

/** Best-effort delivery state of the invite/seed email (FR-0.INV.003/.007). `unconfirmed` is the honest
 *  post-send state when the provider exposes no bounce webhook — NEVER reported as a definite 'delivered'. */
export type DeliveryState = 'sent_unconfirmed' | 'send_failed' | 'bounced';

/** The setup-method choice on UI-INVITE-SETUP. The account type fixes which is valid (OD-020: one method). */
export type SetupMethod = 'oauth' | 'password_totp';

/** An issued invite (native Supabase token — no custom table, OD-014). We mirror only the columns the C0
 *  invite lifecycle needs; auth.users / auth.identities / auth.mfa_factors are Supabase-managed (referenced,
 *  never app-schema'd). `profileId` links to the profiles mirror row written on activation. */
export interface Invite {
  /** the native Supabase token id (opaque). */
  token: string;
  email: string;
  accountType: AccountType;
  origin: LinkOrigin;
  /** the profiles.id the activation writes/reads (the mirror row). Present once the invite is minted. */
  profileId: string;
  /** epoch seconds the link was issued. */
  issuedAt: number;
  /** epoch seconds the link expires — ALWAYS ≤ issuedAt + LINK_TTL_HARD_CAP_SECONDS (AF-074). */
  expiresAt: number;
  state: InviteState;
  delivery: DeliveryState;
  /** the issuer profile id (null for the seed — it is a service_role deploy-time action, not a user). */
  issuedBy: string | null;
}

/** Result of completing setup on a valid token → the account activates and we know where to send it. */
export interface Activation {
  profileId: string;
  email: string;
  accountType: AccountType;
  method: SetupMethod;
  /** true once the account is active (FR-0.INV.005). A partial Option-B (password set, TOTP abandoned)
   *  yields activated=false — no half-provisioned account (FR-0.INV.004 edge). */
  activated: boolean;
  /** the role assigned (read from user_roles — C1 seam) used to route the post-activation redirect. */
  roleName: string | null;
  /** the role-default view the user lands on (FR-0.INV.005). null role → the safe no-access landing. */
  redirectView: string;
}

/** The role-default landing map (FR-0.INV.005). The authoritative per-role default-view definition is C1's
 *  (ISSUE-018); C0 owns only the redirect-by-role SEAM. This is the C0-visible routing table; a role with no
 *  entry (or no role at all) lands on the safe no-access view, never a blank/guessed destination. */
export const SAFE_NO_ACCESS_VIEW = '/no-access';
