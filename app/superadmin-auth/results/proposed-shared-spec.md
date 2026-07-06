# ISSUE-014 — proposed shared-spec deltas

## Config-key parity — NO net-new key proposed

All seven `auth.*` keys this slice reads **already exist** in
`spec/02-config/config-registry.md` §auth (§A. Identity & Auth table). ISSUE-013 registered
them; ISSUE-014 only **reads** them (surface-01 `#auth` owns editing). This slice therefore
proposes **no new config key**. Parity as of 2026-07-06:

| Key (this slice `SuperAdminAuthConfig`) | config-registry §auth | Default (registry) | Default (this slice) | Match |
|---|---|---|---|---|
| `account_lockout_threshold` | `auth.account_lockout_threshold` | 5 | 5 | ✅ |
| `account_lockout_minutes`   | `auth.account_lockout_minutes`   | 15 | 15 | ✅ |
| `mfa_softlock_threshold`    | `auth.mfa_softlock_threshold`    | 5 | 5 | ✅ |
| `mfa_softlock_minutes`      | `auth.mfa_softlock_minutes`      | 15 | 15 | ✅ |
| `captcha_enabled`           | `auth.captcha_enabled`           | true | true | ✅ |
| `leaked_password_protection`| `auth.leaked_password_protection`| true (Pro+) | true | ✅ |
| `two_factor_required`       | `auth.two_factor_required`       | true (BOOT, app-enforced) | true | ✅ |

Note on `two_factor_required`: the registry classes it **BOOT** with validation
"bool (app-enforced)"; ISSUE-014 §8 step 1 describes it as the **harness intent flag** that
drives the app-layer `aal2` gate (`gate.ts`), which is exactly the "app-enforced" clause. Same
default (`true`), same meaning — no drift, no proposed change.

The registry-default values are also the **AF-077 spike-confirmed build values** (ISSUE-005,
🟢 2026-07-04), per config.ts header.
