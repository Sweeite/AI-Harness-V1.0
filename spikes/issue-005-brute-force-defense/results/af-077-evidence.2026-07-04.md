### AF-077 evidence — brute-force / credential-stuffing defense spike (ISSUE-005)

**(a) Verdict:** PASS → status 🟢
**(b) Date / method:** 2026-07-04 · SPIKE — red-team / attack-simulation (a scripted single-account AND a distributed multi-IP attack driven at a LIVE Supabase Auth project; the launch go/no-go gate #6, test-strategy.md §4). **R8 "you-present":** run against a throwaway project with operator credentials — never fabricated.
**(b′) Environment:** Supabase project `pzbnlltfneugcgapgevt.supabase.co` · **plan tier: pro** · CAPTCHA ON · leaked-password protection ON (enforceable, Pro+) · multi-IP mode: **simulated**.

**(c) The platform reality this proves the app-layer against ([SA16] / feasibility-register Block J — contestable by design):**
- Supabase has **NO per-account lockout** (false) and **no separate password-grant limit** (false). The only native brakes are IP-level: **/verify 360/hr (burst 30)**, **/token 1800/hr**, **MFA 15/hr** — all per IP.
- A distributed multi-IP attack spreads across enough IPs that none crosses those caps → **IP limits alone are insufficient**. The defense therefore leans on **CAPTCHA + leaked-password protection + the app-layer per-account soft-lock** — and this spike proves those actually stop the attack.

**(d) Attack battery (the load basis):**
- (a) **Single-account credential-stuffing, 1 IP:** 11 scripted `signInWithPassword` attempts against the seeded Super-Admin account.
- (b) **Distributed multi-IP attack (mode = simulated):** the same account from many source IPs so no single IP crosses the caps. **Simulated mode** — real egress-IP rotation needs proxies not provided, so the harness disables its per-IP counter to prove the per-account soft-lock + CAPTCHA + leaked-password are the real backstop when IP limits are out of the picture. (Provide PROXY_ENDPOINTS for a real-proxy run.)
- 2FA-challenge battery: real wrong TOTP codes until the challenge soft-locks, then a genuinely correct code (must still be refused).

**(e) Single-account result (AC-NFR-SEC.009.1 / AC-0.AUTH.009.1):**
- ✅ halted by app-layer soft-lock at attempt 6 (no session ever minted)
- Session ever minted: **no**; halted at attempt **6**.

**(e′) Multi-IP result (AC-NFR-SEC.009.1):**
- ✅ halted by per-account soft-lock at attempt 6 (mode=simulated; IP limits out of the picture, soft-lock still stopped it)
- Session ever minted: **no**; halted at attempt **6** (per-account soft-lock is IP-independent, so it trips even though every request is a new IP).

**(f) 2FA-challenge soft-lock (AC-0.AUTH.007.3):**
- ✅ 2FA challenge soft-locked at wrong-code count 6 (mfa_softlock_threshold=5)
- ✅ a genuinely correct code was still refused once locked

**(f′) Form controls (AC-0.AUTH.009.2):**
- CAPTCHA: ✅ CAPTCHA enabled AND observed live on the form
- Leaked-password: ✅ leaked-password protection enabled on a Pro+ plan (enforceable)

**(g) Observability — attempts logged + Super-Admin alert (AC-NFR-SEC.009.1, #3 "never fail silently"):**
- ✅ 15 login_attempt rows recorded  (event_log — durable schema is C7 / ISSUE-011; here observed in-harness)
- Per-account soft-lock event: ✅ soft-lock tripped at threshold 5
- Super-Admin alert: ✅ Super-Admin alert(s): 2
- Event counts: login_attempt=15 · account_softlock=2 · mfa_softlock=1 · super_admin_alert=2.

**(g′) CONFIRMED threshold values the build (ISSUE-014) should adopt:**
- `account_lockout_threshold` = **5** consecutive failed attempts.
- `account_lockout_minutes` = **15** min temporary lock.
- `mfa_softlock_threshold` = **5** (the 6th consecutive wrong code finds the challenge locked).
- `captcha_enabled` = true · `leaked_password_protection` = true.

**(g″) Scope note:** BRUTE-FORCE / CREDENTIAL-STUFFING DEFENSE on the external Super-Admin password+2FA path ONLY. The production login/session build (OAuth, the shippable soft-lock, surface-00) is ISSUE-013/014 — this spike GATES it, it does not implement it. Webhook-forgery defense = AF-078/ISSUE-006; deployment-wide aal2 RLS coverage = AF-076/079 (POSTURE). The app-layer soft-lock here is a THROWAWAY reconstruction — only enough to measure the defense.

**(h) On ⛔ FAIL — documented fork (R2 / OD-018):** a FAIL means the committed posture (platform IP limits + CAPTCHA + leaked-password + app-layer soft-lock) does NOT halt the attack. That is a **design fork**, not a bug to code around: log an OD capturing the redesign (e.g. mandatory per-IP proof-of-work, a shorter lockout, WAF fronting, or hardware-key-only Super-Admin auth), route it through change-control, and do NOT let ISSUE-014 ship on an unproven gate.
