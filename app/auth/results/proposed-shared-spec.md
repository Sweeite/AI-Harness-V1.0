# ISSUE-013 — proposed shared-spec deltas (config keys + schema note)

> **PROPOSAL ONLY.** Authored in `app/auth/results/` per the Stage-3 fan-out contract. This file does
> **not** edit `spec/02-config/config-registry.md`, `spec/04-data-model/schema.md`, or any glossary —
> the orchestrator reconciles these at integration time. Everything below is by-ID and cites the FR.

## 1. The five `CFG-auth.*` session/OAuth keys (FR-0.AUTH / FR-0.SESS)

ISSUE-013 §5 asks this slice to register five keys. **All five already exist** in
`spec/02-config/config-registry.md` (§ auth, L70–75). This slice therefore proposes **no new key** — it
records the values it is built against and flags **one reconciliation** the orchestrator should confirm.

| Key | Registry (current) | Built-against (this package `DEFAULT_AUTH_CONFIG`) | Edit-class | FR |
|---|---|---|---|---|
| `auth.oauth_enabled` | `true` · BOOT · bool | `true` | BOOT | FR-0.AUTH.001/002/003 |
| `auth.oauth_provider` | `google` · BOOT · enum {google,microsoft} | `google` | BOOT | FR-0.AUTH.001/003 |
| `auth.access_token_ttl` | `1 h` · LIVE · duration; "Supabase fixed 1 h (don't raise)" | `3600s` (default), validated floor **300s** | LIVE | FR-0.SESS.002 |
| `auth.session_inactivity_timeout` | `14 d` · LIVE · duration; Pro+ | `14 d` (`14*24*3600`s) | LIVE | FR-0.SESS.004 |
| `auth.session_absolute_timeout` | `30 d` · LIVE · duration; > inactivity | `30 d` (`30*24*3600`s) | LIVE | FR-0.SESS.004 |

### Reconciliation flag (orchestrator to confirm)
- **`auth.access_token_ttl` — the FR permits lowering; the registry says "don't raise".** FR-0.SESS.002 is
  explicit: *"1 hour by default, operator-configurable"* with a *"rec floor 5 min"* [SA2] and *">1 h
  discouraged by Supabase"*. The package encodes this as: **default 3600s, validated minimum 300s, values
  above 3600s are discouraged (accepted but not rejected)**. The registry note "don't raise" is advisory,
  not a hard reject — this package does not reject a raise; it only **rejects a value below the 300s floor**
  (a #2/#3 config error). If the orchestrator wants a hard upper bound, add it to the registry — this slice
  does not assume one.
- **Edit-class for `oauth_enabled`/`oauth_provider` is BOOT** (registry) — consistent with FR-0.AUTH.003's
  note "likely BOOT/REBUILD if the IdP app wiring is read at boot". The FR guarantee "next login uses the
  new provider with no code deploy" is preserved: BOOT = a config reload, **not** a code deploy. The
  `PERM-auth.provider_toggle` gate (default-deny; homed in C1/ISSUE-018) is enforced on the edit — see the
  `setProviderConfig` port method (denies without the capability).

## 1b. `event_type` enum — 7 auth values owed to migration 0007 (orchestrator-owned)

The 7 auth `event_type` values this slice logs — `sign_in_success`, `sign_in_failure`,
`session_established`, `identity_rejected`, `reuse_detection_revocation`, `task_continuation`,
`verification_failure` — are **NOT** in the baseline `event_type` enum (`0001_baseline.sql` L60-65).
The **orchestrator adds them via migration 0007** (additive `ALTER TYPE ... ADD VALUE`,
expand-contract-safe). This slice does **not** author that migration and does **not** rename the
values. The live pg adapter (`supabase-store.ts` `logEvent`) casts the value as `$1::event_type`, so
until 0007 is applied an unknown value raises `invalid_text_representation` **loud** — never a silent
skip (#3). Same house pattern as `app/triggers/src/supabase-store.ts`.

## 2. Schema note (no delta — confirmation only)

The `profiles` table already exists in `0001_baseline.sql` (schema.md §1) with **exactly** the columns
ISSUE-013 §8 step 1 requires: `id uuid pk references auth.users(id) on delete cascade`, `active boolean`,
`last_active_at timestamptz` (plus `email`, `name`, `created_at`). **No schema.md edit is proposed.** The
only additive artifact is the RLS policy pair in
`proposed-migration-0006_profiles_mirror.sql` (owner-reads-own SELECT + owner self-update), which composes
on the ISSUE-009 default-deny baseline. `rls-policies.md` may want an entry for `profiles_owner_read` /
`profiles_owner_update` at integration — proposed, not written.

## 3. Nothing else touched

No new glossary term (AAL/aal1/aal2, refresh-token rotation/reuse-detection, JWKS local verification are
already glossary terms per component-00-login.md Context Manifest). No new PERM node
(`PERM-auth.provider_toggle` is consumed as a stub, homed in C1). No new OD/AF (AF-073 already logged;
noted as a browser feasibility gate, not an AC blocker — see notes).
