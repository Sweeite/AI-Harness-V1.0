// ISSUE-005 — SPIKE: brute-force / credential-stuffing defense (AF-077 gate). Orchestrates §8 end
// to end: read+validate env → configure the app-layer soft-lock → run the attack batteries against
// the LIVE throwaway project → assert halted-before-success + logged + alerted → emit AF-077
// evidence → print the verdict.
//
// R8 "you-present": this drives a REAL scripted attack at a REAL Supabase project. It REFUSES TO
// RUN and prints the required env vars if any are absent — never a silent pass with no target (#3).

import 'dotenv/config';
import { requireEnv } from './auth.js';
import { EventLog } from './eventlog.js';
import { SoftLock } from './softlock.js';
import { DEFENSE } from './config.js';
import { singleAccountBattery, multiIpBattery, mfaBattery } from './attack.js';
import { assertAll } from './assert.js';
import { writeEvidence, type Evidence } from './report.js';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main(): Promise<void> {
  console.log('\nISSUE-005 — brute-force / credential-stuffing defense spike (AF-077)\n');

  // [0/5] validate operator-provided env. Refuse to run if the target is missing.
  const check = requireEnv();
  if (!check.ok) {
    console.error('  REFUSING TO RUN — this R8 "you-present" spike needs the operator\'s real');
    console.error('  throwaway Supabase Auth project + seeded account. Missing required env vars:\n');
    for (const name of check.missing) console.error(`      - ${name}`);
    console.error('\n  Copy .env.example → .env and fill them in (see .env.example for what each is).');
    console.error('  DO NOT run against a production project — the attack trips Supabase IP rate limits.\n');
    process.exit(2);
  }
  const env = check.env;
  const host = (() => {
    try {
      return new URL(env.url).host;
    } catch {
      return env.url;
    }
  })();

  const leakedPasswordProtection = (process.env.LEAKED_PASSWORD_PROTECTION ?? 'false').toLowerCase() === 'true';
  console.log(`  [0/5] target: Supabase ${host} · plan ${env.plan} · CAPTCHA ${env.captchaEnabled ? 'on' : 'off'} · leaked-pw ${leakedPasswordProtection ? 'on' : 'off'}`);

  // [1/5] wire the app-layer soft-lock (the thing under test) + the observability sink.
  console.log('  [1/5] configuring app-layer soft-lock (throwaway) + event_log sink…');
  const log = new EventLog();
  const lock = new SoftLock(log);

  // [2/5] single-account credential-stuffing (1 IP).
  console.log('  [2/5] running single-account credential-stuffing battery (1 IP)…');
  const single = await singleAccountBattery(env, lock, log);
  console.log(`        session minted: ${single.sessionEverMinted ? 'YES (BREACH)' : 'no'} · halted at attempt ${single.haltedAtAttempt ?? 'n/a'}`);

  // The lock window elapses between batteries so the multi-IP run starts from a clean gate but
  // trips the SAME per-account soft-lock (proving it is IP-independent). Advance the logical clock.
  lock.advance(DEFENSE.ACCOUNT_LOCKOUT_MINUTES + 1);

  // [3/5] distributed multi-IP attack.
  console.log('  [3/5] running distributed multi-IP battery…');
  const multi = await multiIpBattery(env, lock, log);
  console.log(`        mode: ${multi.mode} · session minted: ${multi.sessionEverMinted ? 'YES (BREACH)' : 'no'} · halted at attempt ${multi.haltedAtAttempt ?? 'n/a'}`);

  // [4/5] 2FA-challenge soft-lock battery.
  console.log('  [4/5] running 2FA-challenge soft-lock battery…');
  const mfa = await mfaBattery(env, lock, log);
  console.log(`        2FA locked at wrong-code ${mfa.lockedAtAttempt ?? 'n/a'} · valid code refused after lock: ${mfa.validCodeRefusedAfterLock} · AAL2 reached: ${mfa.aal2EverReached ? 'YES (BREACH)' : 'no'}`);

  // [5/5] assert + emit evidence.
  console.log('  [5/5] asserting containment + observability, emitting AF-077 evidence…');
  const assertions = assertAll({
    single,
    multi,
    mfa,
    log,
    account: env.account,
    captchaEnabled: env.captchaEnabled,
    leakedPasswordProtection,
  });

  const evidence: Evidence = {
    verdict: assertions.verdict,
    date: today(),
    env: {
      supabaseUrlHost: host,
      plan: env.plan,
      captchaEnabled: env.captchaEnabled,
      leakedPasswordProtection,
      multiIpMode: multi.mode ?? 'n/a',
    },
    single,
    multi,
    mfa,
    assertions,
    eventCounts: {
      attempts: log.attempts().length,
      softlocks: log.rows.filter((r) => r.type === 'account_softlock').length,
      mfaSoftlocks: log.rows.filter((r) => r.type === 'mfa_softlock').length,
      superAdminAlerts: log.superAdminAlerts().length,
    },
  };

  const { md } = writeEvidence(evidence);

  console.log('\nPer-check:');
  for (const c of assertions.checks) {
    console.log(`  ${c.ok ? '✅' : '❌'} ${c.name}  [${c.ac}]`);
    if (!c.ok) console.log(`why       ${c.detail}`);
  }

  console.log('\n' + '─'.repeat(72));
  console.log(md);
  console.log('─'.repeat(72));
  console.log(
    `\n  Evidence written → results/af-077-evidence.${evidence.date}.{json,md}\n` +
      `  Verdict: ${assertions.verdict} ${assertions.verdict === 'PASS' ? '🟢' : '⛔'}. ` +
      (assertions.verdict === 'PASS'
        ? 'Paste the block into feasibility-register.md Block J/K and flip AF-077 🔴→🟢.\n'
        : 'FAIL is a design fork — open an OD with the redesign it forces (R2/OD-018); do NOT let ISSUE-014 ship.\n'),
  );

  if (assertions.verdict !== 'PASS') process.exit(1);
}

main().catch((e) => {
  console.error('\n  SPIKE ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
