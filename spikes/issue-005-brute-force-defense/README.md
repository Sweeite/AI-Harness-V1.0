# ISSUE-005 — brute-force / credential-stuffing defense spike (AF-077 gate)

Adversarial attack-simulation harness for **[ISSUE-005](../../spec/06-issues/ISSUE-005-brute-force-spike.md)**.
It proves — against a **live throwaway Supabase Auth project** — that the external Super-Admin
**password + 2FA** login withstands a scripted credential-stuffing / brute-force attack. Supabase
provides **no native per-account lockout** ([SA16] / feasibility-register Block J), so the defense
rests on **CAPTCHA + leaked-password protection + an app-layer per-account soft-lock**; this spike
red-teams exactly that. On PASS, **AF-077** flips 🔴→🟢 so **ISSUE-014** may ship — one of the six
launch go/no-go SPIKE-GATEs (`test-strategy.md` §4, gate #6).

Stack: **TypeScript / Node** ([ADR-009](../../spec/00-foundations/adr/ADR-009-implementation-stack.md)) + `@supabase/supabase-js` (real auth endpoints) + `otpauth` (real TOTP codes).

> **R8 "you-present" spike — not fabricated, not yet run.** This drives a REAL scripted attack at a
> REAL project. It needs the operator's throwaway Supabase project + a seeded account + credentials
> — which we do NOT have yet. `results/` holds only `PENDING.md`; no evidence is invented. `main.ts`
> **refuses to run and prints the required env vars** if they are absent (never a silent pass with no
> target — #3).

## The threat model (why a PASS means something)

Supabase's only native brake is **IP-level** rate limiting (`/verify` 360/hr burst 30, `/token`
1800/hr, MFA 15/hr — all per IP). A **distributed multi-IP** attack spreads across enough IPs that
none crosses those caps, so **IP limits alone are insufficient**. The real backstop must be the
**app-layer per-account soft-lock** (IP-independent), **CAPTCHA** on the form, and **leaked-password
protection**. The harness models a maximally-persistent scripted attacker and asserts the defense
halts it **before any session mints** — on both a single-account battery AND a multi-IP battery.

## What it does (maps 1:1 to ISSUE-005 §8 build order)

| Step | File | What |
|---|---|---|
| 1 declare config | `src/config.ts` | The defense thresholds (`account_lockout_threshold`, `account_lockout_minutes`, `mfa_softlock_threshold=5`, `captcha_enabled`, `leaked_password_protection`) **and** the platform facts (no per-account lockout; 360/1800/15-per-hr IP caps). **Contestable by design.** |
| 1 target | `src/auth.ts` | REAL Supabase auth calls via `@supabase/supabase-js`: `signInWithPassword` (the attack target) + the AAL2 TOTP challenge/verify path; per-source clients (proxy or logical IP); env validation that refuses to run without a target. |
| 3 the defense | `src/softlock.ts` | The minimal **app-layer** per-account soft-lock (counter → temporary block after `account_lockout_threshold`, unlock after `account_lockout_minutes`, fire a Super-Admin alert) + the 2FA-challenge soft-lock (`mfa_softlock_threshold`). **Throwaway — the thing under test that Supabase does NOT provide natively.** |
| 5 observability | `src/eventlog.ts` | In-harness `event_log` sink recording every attempt + the threshold-crossing Super-Admin alert (durable schema is C7 / ISSUE-011). |
| 4 battery | `src/attack.ts` | (a) scripted single-account credential-stuffing from 1 IP; (b) distributed multi-IP attack (real-proxy if `PROXY_ENDPOINTS` given, else simulated by disabling the per-IP counter); + the 2FA wrong-code battery. |
| 4–5 assert | `src/assert.ts` | Asserts each battery halted before a session minted; soft-lock tripped + Super-Admin alert fired; every attempt logged; 2FA locked at threshold; CAPTCHA + leaked-password active. |
| 6 evidence | `src/report.ts` | Emits the AF-077 evidence block (fields a–h) + JSON → `results/`. |
| — orchestrate | `src/main.ts` | read env → configure soft-lock → run batteries → assert → emit → verdict. Refuses to run with no target. |

## Run

```bash
npm install
cp .env.example .env      # fill in the throwaway Supabase project + seeded account (see below)
npm run spike             # runs the batteries → asserts → writes results/
npm run typecheck
```

**Prerequisites (operator, present at run time):** a throwaway Supabase Auth project with
email+password + a TOTP factor enabled and one seeded external-Super-Admin account; CAPTCHA turned
on in Supabase → Authentication → Attack Protection; leaked-password protection on (Pro+); and, for a
**real** multi-IP run, proxy endpoints. Everything comes from `.env` — the harness hard-codes nothing.

## What the operator must provide (WHAT I NEED FROM THE OPERATOR)

| Value | Env var | Notes |
|---|---|---|
| Throwaway Supabase project | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | **Disposable** — the attack trips IP rate limits; delete it afterwards. |
| Plan tier | `SUPABASE_PLAN` (`free`\|`pro`) | **Leaked-password protection is Pro+ only.** On `free` it can only be config-intended, not enforced. |
| Seeded Super-Admin test account | `TEST_ACCOUNT_EMAIL`, `TEST_ACCOUNT_PASSWORD` | One account, email+password + TOTP enrolled. |
| Enrolled TOTP secret | `TEST_ACCOUNT_TOTP_SECRET` | Base32 factor secret — drives real wrong/right 2FA codes. |
| CAPTCHA on the form | `CAPTCHA_ENABLED` (+ optional `CAPTCHA_TEST_SITEKEY`/`_SECRET`) | Turn CAPTCHA on in the dashboard; provider test keys make the presence assertion *live* vs config-intended. |
| Proxies for a real multi-IP test | `PROXY_ENDPOINTS` (optional) | If omitted, the multi-IP battery runs the **simulated** mode (labelled in the evidence). |
| Dashboard toggles | — | Turn on **CAPTCHA** and **leaked-password protection** in the Supabase dashboard before running. |

## What this proves — and what it does not

- **Proves (AF-077):** the committed posture (IP limits + CAPTCHA + leaked-password + app-layer
  per-account soft-lock) halts both a single-account and a multi-IP scripted attack **before a
  session mints**, with every attempt logged and a Super-Admin alert fired — and yields the
  confirmed `account_lockout_threshold` / `account_lockout_minutes` / `mfa_softlock_threshold` values
  ISSUE-014 should adopt.
- **Does NOT prove:** the *shipped* login/soft-lock code (ISSUE-013/014) is safe — the soft-lock here
  is the throwaway reconstruction sanctioned by §2; the DoD is the **logged verdict + evidence +
  confirmed thresholds**, not production code. Webhook-forgery = AF-078/ISSUE-006; deployment-wide
  aal2 RLS coverage = AF-076/079 (posture).

## Honesty caveats (read before trusting a GREEN)

- **Multi-IP simulation:** truly rotating source IPs needs real proxies the harness can't assume. With
  no `PROXY_ENDPOINTS`, battery (b) runs **simulated** — it disables the harness per-IP counter to
  prove the per-account soft-lock is the real backstop when IP limits are defeated. The evidence
  **labels** which mode ran; a full-confidence GREEN uses `real-proxy`.
- **CAPTCHA vs a scripted attacker:** CAPTCHA on the form blocks *unattended* scripting; a real
  attacker may farm-solve or bypass it, so CAPTCHA is a *layer*, not the load-bearing control — the
  per-account soft-lock is. The spike asserts CAPTCHA is *present*, not that it is unsolvable.
- **Leaked-password Pro+ gating:** leaked-password protection only enforces on **Pro+**. On a `free`
  project AC-0.AUTH.009.2's leaked half is asserted as **config-intended only**, recorded honestly in
  the evidence — a true GREEN on that half needs a Pro+ project.

## On ⛔ FAIL

A session minted, or the soft-lock / alert / log did not fire — the committed posture does not halt
the attack. Per **R2 / OD-018** this is a **design fork** (log an OD with the redesign it forces —
e.g. mandatory PoW, WAF fronting, hardware-key-only Super-Admin auth), routed through change-control.
Do **not** code around it, and do **not** let ISSUE-014 build on an unproven gate.

## Output

`results/af-077-evidence.<date>.{json,md}` — paste the markdown block into
[feasibility-register.md](../../spec/00-foundations/feasibility-register.md) Block J/K (AF-077) and
flip 🔴→🟢 on PASS.
