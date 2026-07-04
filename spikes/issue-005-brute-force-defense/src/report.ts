// ISSUE-005 build order step 6: emit the AF-077 evidence block (fields a–h, mirroring the AF-067 /
// AF-068 house style) → results/af-077-evidence.<date>.{json,md}. Paste the markdown into
// feasibility-register.md Block J/K and flip AF-077 🔴→🟢 on PASS (or ⛔ + the fork on FAIL).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Assertions } from './assert.js';
import type { BatteryResult, MfaBatteryResult } from './attack.js';
import { DEFENSE, PLATFORM, isProPlan } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, '..', 'results');

export interface Evidence {
  verdict: 'PASS' | 'FAIL';
  date: string;
  env: { supabaseUrlHost: string; plan: string; captchaEnabled: boolean; leakedPasswordProtection: boolean; multiIpMode: string };
  single: BatteryResult;
  multi: BatteryResult;
  mfa: MfaBatteryResult;
  assertions: Assertions;
  eventCounts: { attempts: number; softlocks: number; mfaSoftlocks: number; superAdminAlerts: number };
}

export function writeEvidence(e: Evidence): { json: string; md: string } {
  const status = e.verdict === 'PASS' ? '🟢' : '⛔';
  const leakedEnforceable = isProPlan();
  const json = JSON.stringify(e, null, 2);

  const checkLine = (name: string) => {
    const c = e.assertions.checks.find((x) => x.name === name);
    return c ? `${c.ok ? '✅' : '❌'} ${c.detail}` : '(not run)';
  };

  const md = `### AF-077 evidence — brute-force / credential-stuffing defense spike (ISSUE-005)

**(a) Verdict:** ${e.verdict} → status ${status}
**(b) Date / method:** ${e.date} · SPIKE — red-team / attack-simulation (a scripted single-account AND a distributed multi-IP attack driven at a LIVE Supabase Auth project; the launch go/no-go gate #6, test-strategy.md §4). **R8 "you-present":** run against a throwaway project with operator credentials — never fabricated.
**(b′) Environment:** Supabase project \`${e.env.supabaseUrlHost}\` · **plan tier: ${e.env.plan}** · CAPTCHA ${e.env.captchaEnabled ? 'ON' : 'off'} · leaked-password protection ${e.env.leakedPasswordProtection ? 'ON' : 'off'}${leakedEnforceable ? ' (enforceable, Pro+)' : ' (NON-Pro plan → config-intended ONLY, NOT enforced)'} · multi-IP mode: **${e.env.multiIpMode}**.

**(c) The platform reality this proves the app-layer against ([SA16] / feasibility-register Block J — contestable by design):**
- Supabase has **NO per-account lockout** (${String(PLATFORM.NATIVE_PER_ACCOUNT_LOCKOUT)}) and **no separate password-grant limit** (${String(PLATFORM.NATIVE_PASSWORD_GRANT_LIMIT)}). The only native brakes are IP-level: **/verify ${PLATFORM.IP_LIMIT_VERIFY_PER_HOUR}/hr (burst ${PLATFORM.IP_LIMIT_VERIFY_BURST})**, **/token ${PLATFORM.IP_LIMIT_TOKEN_PER_HOUR}/hr**, **MFA ${PLATFORM.IP_LIMIT_MFA_PER_HOUR}/hr** — all per IP.
- A distributed multi-IP attack spreads across enough IPs that none crosses those caps → **IP limits alone are insufficient**. The defense therefore leans on **CAPTCHA + leaked-password protection + the app-layer per-account soft-lock** — and this spike proves those actually stop the attack.

**(d) Attack battery (the load basis):**
- (a) **Single-account credential-stuffing, 1 IP:** ${e.single.attempts.length} scripted \`signInWithPassword\` attempts against the seeded Super-Admin account.
- (b) **Distributed multi-IP attack (mode = ${e.multi.mode}):** the same account from many source IPs so no single IP crosses the caps. ${e.multi.mode === 'simulated' ? '**Simulated mode** — real egress-IP rotation needs proxies not provided, so the harness disables its per-IP counter to prove the per-account soft-lock + CAPTCHA + leaked-password are the real backstop when IP limits are out of the picture. (Provide PROXY_ENDPOINTS for a real-proxy run.)' : '**Real-proxy mode** — requests genuinely egress from operator-provided proxy endpoints (distinct source IPs).'}
- 2FA-challenge battery: real wrong TOTP codes until the challenge soft-locks, then a genuinely correct code (must still be refused).

**(e) Single-account result (AC-NFR-SEC.009.1 / AC-0.AUTH.009.1):**
- ${checkLine('single_account_halted')}
- Session ever minted: **${e.single.sessionEverMinted ? 'YES — BREACH' : 'no'}**; halted at attempt **${e.single.haltedAtAttempt ?? 'n/a'}**.

**(e′) Multi-IP result (AC-NFR-SEC.009.1):**
- ${checkLine('multi_ip_halted')}
- Session ever minted: **${e.multi.sessionEverMinted ? 'YES — BREACH' : 'no'}**; halted at attempt **${e.multi.haltedAtAttempt ?? 'n/a'}** (per-account soft-lock is IP-independent, so it trips even though every request is a new IP).

**(f) 2FA-challenge soft-lock (AC-0.AUTH.007.3):**
- ${checkLine('mfa_softlock_at_threshold')}
- ${checkLine('valid_code_refused_after_lock')}

**(f′) Form controls (AC-0.AUTH.009.2):**
- CAPTCHA: ${checkLine('captcha_active')}
- Leaked-password: ${checkLine('leaked_password_active')}

**(g) Observability — attempts logged + Super-Admin alert (AC-NFR-SEC.009.1, #3 "never fail silently"):**
- ${checkLine('all_attempts_logged')}  (event_log — durable schema is C7 / ISSUE-011; here observed in-harness)
- Per-account soft-lock event: ${checkLine('account_softlock_tripped')}
- Super-Admin alert: ${checkLine('super_admin_alert_fired')}
- Event counts: login_attempt=${e.eventCounts.attempts} · account_softlock=${e.eventCounts.softlocks} · mfa_softlock=${e.eventCounts.mfaSoftlocks} · super_admin_alert=${e.eventCounts.superAdminAlerts}.

**(g′) CONFIRMED threshold values the build (ISSUE-014) should adopt:**
- \`account_lockout_threshold\` = **${DEFENSE.ACCOUNT_LOCKOUT_THRESHOLD}** consecutive failed attempts.
- \`account_lockout_minutes\` = **${DEFENSE.ACCOUNT_LOCKOUT_MINUTES}** min temporary lock.
- \`mfa_softlock_threshold\` = **${DEFENSE.MFA_SOFTLOCK_THRESHOLD}** (the 6th consecutive wrong code finds the challenge locked).
- \`captcha_enabled\` = ${e.env.captchaEnabled} · \`leaked_password_protection\` = ${e.env.leakedPasswordProtection}${leakedEnforceable ? '' : ' (requires Pro+ to enforce)'}.

**(g″) Scope note:** BRUTE-FORCE / CREDENTIAL-STUFFING DEFENSE on the external Super-Admin password+2FA path ONLY. The production login/session build (OAuth, the shippable soft-lock, surface-00) is ISSUE-013/014 — this spike GATES it, it does not implement it. Webhook-forgery defense = AF-078/ISSUE-006; deployment-wide aal2 RLS coverage = AF-076/079 (POSTURE). The app-layer soft-lock here is a THROWAWAY reconstruction — only enough to measure the defense.

**(h) On ⛔ FAIL — documented fork (R2 / OD-018):** a FAIL means the committed posture (platform IP limits + CAPTCHA + leaked-password + app-layer soft-lock) does NOT halt the attack. That is a **design fork**, not a bug to code around: log an OD capturing the redesign (e.g. mandatory per-IP proof-of-work, a shorter lockout, WAF fronting, or hardware-key-only Super-Admin auth), route it through change-control, and do NOT let ISSUE-014 ship on an unproven gate.
`;

  writeFileSync(join(resultsDir, `af-077-evidence.${e.date}.json`), json);
  writeFileSync(join(resultsDir, `af-077-evidence.${e.date}.md`), md);
  return { json, md };
}

export { resultsDir };
