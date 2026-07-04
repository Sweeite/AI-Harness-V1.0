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
// It needs only SUPABASE_URL, SUPABASE_ANON_KEY, TEST_ACCOUNT_EMAIL, TEST_ACCOUNT_PASSWORD — NOT
// TEST_ACCOUNT_TOTP_SECRET (that is what this produces). Nothing is hard-coded.

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
  const email = need('TEST_ACCOUNT_EMAIL');
  const password = need('TEST_ACCOUNT_PASSWORD');

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });

  // 1. Sign in (enrollment requires an authenticated session).
  console.log('  [1/4] signing in with email+password…');
  const signIn = await supabase.auth.signInWithPassword({ email, password });
  if (signIn.error) {
    console.error(
      `\n  Sign-in failed: ${signIn.error.message}\n` +
        '  Create the user first (Supabase → Authentication → Users → Add user) with this\n' +
        '  email+password, then re-run. If the account already has 2FA, sign-in may require a\n' +
        '  code — enroll can only run on a fresh (aal1) account.\n',
    );
    process.exit(1);
  }

  // 2. Enroll a TOTP factor → returns the base32 secret.
  console.log('  [2/4] enrolling a TOTP factor…');
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

  // 3. Generate the current code from that secret and verify, to activate the factor.
  console.log('  [3/4] verifying the factor with a generated code (activates it)…');
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

  // 4. Done — print the secret to paste into .env.
  console.log('  [4/4] factor verified + active.\n');
  console.log('─'.repeat(72));
  console.log('  Paste this line into spikes/issue-005-brute-force-defense/.env :\n');
  console.log(`  TEST_ACCOUNT_TOTP_SECRET=${secret}`);
  console.log('\n─'.repeat(72));
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
