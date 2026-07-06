// ISSUE-014 §8 steps 2+5 — the external Super-Admin password grant + its brute-force front controls
// (CAPTCHA fail-closed, leaked-password enforcement). The load-bearing rule (FR-0.AUTH.005): a correct
// email+password does NOT grant a session — it advances SAME-PAGE to the TOTP challenge (FR-0.AUTH.007).
// Only an external Super-Admin account has a usable password credential; a client-tenant user has none and
// uses OAuth (ISSUE-013). The real Supabase `auth.users` credential check + leaked-password lookup are the
// LIVE seam (supabase-store.ts / a throwaway project) — here the credential store is a modelled double so
// the grant LOGIC (accept→challenge, reject→failure, fail-closed CAPTCHA, leaked-password refusal) is
// proven offline. No session mechanism lives here — session establishment is ISSUE-013's (app/auth).

/** A modelled external Super-Admin credential record (Supabase `auth.users` shape, minimal for this slice). */
export interface SuperAdminAccount {
  user_id: string; // = auth.users(id)
  email: string;
  password: string; // modelled plaintext for the offline double ONLY; live is Supabase's hashed verify
  is_external_super_admin: boolean; // only these accounts have a usable password path (FR-0.AUTH.005)
  totp_enrolled: boolean; // whether a TOTP factor exists (auth.mfa_factors) — governs the aal2 path
}

/** The widget state the client reports for the CAPTCHA before a password submit (surface-00 UI-LOGIN). */
export type CaptchaState =
  | { loaded: true; token: string | null } // widget loaded; token present iff the challenge was solved
  | { loaded: false }; // widget failed to load — fail-closed (submit must be disabled)

export type PasswordGrantOutcome =
  | { ok: true; next: 'totp_challenge'; user_id: string } // correct creds → advance to the same-page challenge (NO session yet)
  | { ok: false; reason: PasswordDenyReason };

export type PasswordDenyReason =
  | 'captcha_unavailable' // CAPTCHA enabled but widget failed to load → fail-closed, submit refused (#2)
  | 'captcha_unsolved' // CAPTCHA enabled + loaded but no token → not a human-proved submit
  | 'no_password_account' // client-tenant user (or unknown email) — no usable password credential
  | 'leaked_password' // leaked-password protection tripped (Pro+); the credential is refused
  | 'bad_credentials'; // wrong password on a real external-admin account

export interface PasswordPolicy {
  captcha_enabled: boolean;
  leaked_password_protection: boolean;
}

/**
 * FR-0.AUTH.009 CAPTCHA gate — evaluated BEFORE any credential check. Fail-closed: if the widget can't load
 * while captcha_enabled, the submit is refused (surface-00 UI-LOGIN Partial state) — never let the password
 * path through without the configured human check (#2). When disabled the gate is a pass-through.
 */
export function checkCaptcha(policy: { captcha_enabled: boolean }, captcha: CaptchaState): { ok: boolean; reason?: PasswordDenyReason } {
  if (!policy.captcha_enabled) return { ok: true };
  if (!captcha.loaded) return { ok: false, reason: 'captcha_unavailable' }; // fail-closed
  if (!captcha.token) return { ok: false, reason: 'captcha_unsolved' };
  return { ok: true };
}

/**
 * Attempt the external Super-Admin password grant. Order (each a hard, silent-to-attacker-but-logged control):
 *   1. CAPTCHA fail-closed gate (FR-0.AUTH.009).
 *   2. account lookup — only an external-admin account with a password credential can proceed (FR-0.AUTH.005).
 *   3. leaked-password protection (FR-0.AUTH.009) — a breached credential is refused even if it matches.
 *   4. credential verify — wrong password is a failure (feeds the per-account soft-lock at the caller).
 * On success it returns `next: 'totp_challenge'` — NOT a session (the challenge, FR-0.AUTH.007, mints aal2).
 *
 * `leakedLookup` models the Supabase HaveIBeenPwned check: true = the password is in a known breach corpus.
 */
export function attemptPasswordGrant(args: {
  policy: PasswordPolicy;
  captcha: CaptchaState;
  email: string;
  password: string;
  account: SuperAdminAccount | null; // resolved from auth.users by email; null = no such usable account
  leakedLookup: (password: string) => boolean;
}): PasswordGrantOutcome {
  const { policy, captcha, password, account, leakedLookup } = args;

  const cap = checkCaptcha(policy, captcha);
  if (!cap.ok) return { ok: false, reason: cap.reason! };

  // Only an external Super-Admin with a password credential has a usable password path (FR-0.AUTH.005).
  // A client-tenant user resolves to null here (AC-0.AUTH.005.2) — no account, no path.
  if (!account || !account.is_external_super_admin) {
    return { ok: false, reason: 'no_password_account' };
  }

  // Leaked-password protection (FR-0.AUTH.009) — refuse a breached credential regardless of a password match.
  if (policy.leaked_password_protection && leakedLookup(password)) {
    return { ok: false, reason: 'leaked_password' };
  }

  if (password !== account.password) {
    return { ok: false, reason: 'bad_credentials' };
  }

  // Correct credentials → advance SAME-PAGE to the TOTP challenge. NO session is granted here (FR-0.AUTH.005).
  return { ok: true, next: 'totp_challenge', user_id: account.user_id };
}
