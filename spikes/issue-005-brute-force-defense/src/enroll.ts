// ISSUE-005 §8.1 helper — seed the test account's TOTP factor and PRINT its base32 secret.
//
// Supabase has NO dashboard button to "enable 2FA for a user" and hand you the secret — TOTP
// enrollment is a client-SDK flow (sign in → mfa.enroll → verify a code). This one-shot script runs
// that flow against the throwaway project and prints TEST_ACCOUNT_TOTP_SECRET for you to paste into
// .env. Run it ONCE, after the test user exists (email+password) and TOTP MFA is allowed on the
// project (Supabase dashboard → Authentication → sign-in / MFA settings → enable TOTP).
//
//   npm run enroll
//
// If the account ALREADY has a factor (from a prior attempt), Supabase refuses to enroll a new one
// ("AAL2 required to enroll a new factor") and never re-reveals the old secret. So this helper first
// CLEARS any existing factors via the admin (service_role) API, then enrolls a fresh one with a
// secret we know. That is why it needs SUPABASE_SERVICE_ROLE_KEY (you already provide it for the
// spike). It does NOT need TEST_ACCOUNT_TOTP_SECRET — that is what this produces.

import './ws-polyfill.js';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as OTPAuth from 'otpauth';

function need(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    console.error(`\n  MISSING ${name} — set it in .env before enrolling.\n`);
    process.exit(2);
  }
  return v;
}

async function main(): Promise<void> {
  console.log('\nISSUE-005 — seed a TOTP factor on the test account (prints the secret)\n');

  const url = need('SUPABASE_URL');
  const anonKey = need('SUPABASE_ANON_KEY');
  const serviceRoleKey = need('SUPABASE_SERVICE_ROLE_KEY');
  const email = need('TEST_ACCOUNT_EMAIL');
  const password = need('TEST_ACCOUNT_PASSWORD');

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  // 1. Sign in (password grant → an aal1 session; enough to list factors, even if one exists).
  console.log('  [1/5] signing in with email+password…');
  const signIn = await supabase.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.user) {
    console.error(
      `\n  Sign-in failed: ${signIn.error?.message ?? 'no user returned'}\n` +
        '  Create the user first (Supabase → Authentication → Users → Add user) with this\n' +
        '  email+password, then re-run.\n',
    );
    process.exit(1);
  }
  const userId = signIn.data.user.id;

  // 2. Clear any existing factors (their secrets are unknown to us / can never be re-read).
  console.log('  [2/5] checking for existing MFA factors…');
  const existing = await supabase.auth.mfa.listFactors();
  const all = existing.data?.all ?? [];
  if (all.length > 0) {
    console.log(`        found ${all.length} existing factor(s) with unknown secret(s) — removing to enroll fresh…`);
    for (const f of all) {
      const del = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
      if (del.error) {
        console.error(
          `\n  Could not remove existing factor ${f.id}: ${del.error.message}\n` +
            '  (Is SUPABASE_SERVICE_ROLE_KEY correct? It must be the service_role key, not anon.)\n',
        );
        process.exit(1);
      }
      console.log(`        removed factor ${f.id} (${f.factor_type ?? 'totp'})`);
    }
  } else {
    console.log('        none — clean account.');
  }

  // 3. Enroll a fresh TOTP factor → returns the base32 secret.
  console.log('  [3/5] enrolling a fresh TOTP factor…');
  const friendlyName = `spike-005-${Date.now()}`;
  const enroll = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName });
  if (enroll.error) {
    console.error(
      `\n  Enroll failed: ${enroll.error.message}\n` +
        '  If this says MFA/TOTP is not enabled, turn it on: Supabase dashboard →\n' +
        '  Authentication → (Sign In / Providers or Multi-Factor Authentication) → enable TOTP.\n',
    );
    process.exit(1);
  }
  const factorId = enroll.data.id;
  const secret = enroll.data.totp.secret; // base32 shared secret — what the harness needs.

  // 4. Generate the current code from that secret and verify, to activate the factor.
  console.log('  [4/5] verifying the factor with a generated code (activates it)…');
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) {
    console.error(`\n  Challenge failed: ${challenge.error.message}\n`);
    process.exit(1);
  }
  const verify = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: totp.generate(),
  });
  if (verify.error) {
    console.error(`\n  Verify failed: ${verify.error.message} (clock skew? re-run to retry)\n`);
    process.exit(1);
  }

  // 5. Done — print the secret to paste into .env.
  console.log('  [5/5] factor verified + active.\n');
  console.log('─'.repeat(72));
  console.log('  Paste this line into spikes/issue-005-brute-force-defense/.env :\n');
  console.log(`  TEST_ACCOUNT_TOTP_SECRET=${secret}`);
  console.log('\n' + '─'.repeat(72));
  console.log(
    `\n  (factor id ${factorId}, friendly name "${friendlyName}"). The account now requires a\n` +
      '  TOTP code on the password path — exactly the state spike 005 attacks. Keep the secret;\n' +
      "  it is the account's 2FA seed. Then run: npm run spike\n",
  );
}

main().catch((e) => {
  console.error('\n  ENROLL ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
