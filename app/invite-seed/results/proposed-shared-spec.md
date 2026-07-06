# ISSUE-015 — proposed shared-spec deltas (schema / enum, owed to change-control)

> **PROPOSAL ONLY.** Authored in `app/invite-seed/results/` per the Stage-4 fan-out contract. This file does
> **not** edit `spec/04-data-model/schema.md`, `app/silo/migrations/*`, `spec/02-config/config-registry.md`,
> or any glossary — the orchestrator reconciles these at integration time (same change-control class as
> OD-170 / OD-179: an FR mandates an `event_log` write but the enum admits no matching value). Everything
> below is by-ID and cites the FR/AC.

## 1. `event_type` enum — four additive values owed to migration 0011 (orchestrator-owned)

The invite/seed slice writes four `event_type` values into the append-only `event_log` sink. **None of the
four is in the live `event_type` Postgres ENUM** — verified absent in both `app/silo/migrations/0001_baseline.sql`
L60-65 (baseline) and `0007_stage3_event_types.sql` (Stage-3 auth/freeze additions). Against a real silo,
every invite issuance / seed run / bounce / activation would raise
`invalid input value for enum event_type` — i.e. every genesis path would throw on the audit write (#3, and
a lost activation is #1). This is an ADDITIVE, expand-contract-safe delta (values are never renamed/removed),
same class as OD-170 (`authz_revoked_midtask` / `rls_harness_divergence`) and ISSUE-047's 0007 delta.

| value | emitted by (this slice) | FR / AC |
|-------|-------------------------|---------|
| `email_send_ok` | `deliver()` — a setup/invite email was sent (unconfirmed, no bounce guarantee) | FR-0.INV.003 / AC-0.INV.003.1 (positive path) |
| `email_send_failed` | `deliver()` — an SMTP send failed → explicit issuer-visible failure, never a false "sent" | FR-0.INV.003 / AC-0.INV.003.1 |
| `invite_bounced` | `markBounced()` — a provider bounce marked the invite undelivered + re-alerted | FR-0.INV.007 / AC-0.INV.007.1 |
| `account_activated` | `completeSetup()` — an account activated on setup completion (role-default redirect) | FR-0.INV.005 / AC-0.INV.005.1 |

**Proposed migration 0011** (authored for the live build by the orchestrator, NOT authored into `app/silo`
by this slice). `transactional:false` — `ALTER TYPE … ADD VALUE` runs under autocommit; `IF NOT EXISTS`
makes each statement idempotent + the migration resumable (mirror the 0007 header/rules; keep comments
semicolon-free):

```sql
-- Migration 0011 — ISSUE-015 invite/seed event_type enum expansion. Additive, expand-contract-safe.
-- transactional:false — autocommit; each ADD VALUE commits independently; IF NOT EXISTS = idempotent.
alter type event_type add value if not exists 'email_send_ok';
alter type event_type add value if not exists 'email_send_failed';
alter type event_type add value if not exists 'invite_bounced';
alter type event_type add value if not exists 'account_activated';
```

**Lockstep guard (in-package, so this can never again drift silently):** the four values are frozen in
`app/invite-seed/src/store.ts` as `INVITE_SEED_EVENT_TYPES` + `isInviteSeedEventType()`. Both the in-memory
fake (`writeEvent`) and the live pg adapter (`supabase-store.ts writeEvent`) reject any value outside the set
with `ERR_UNADMITTED_EVENT_TYPE` — the offline mirror of the live enum's `invalid input value` error. The
live insert additionally casts `$1::event_type`, so until 0011 is applied the live write fails **LOUD**
(never a silent skip — #3). Tests in `invite-seed.test.ts` (`enum-drift — …`) FAIL if the set ever admits an
unadmitted value or drops one of the four — closing the fake-vs-live drift the adversarial verifier caught.
The `INVITE_SEED_EVENT_TYPES` list and this migration-0011 delta MUST stay in lockstep.

## 2. Schema — no delta (confirmation only; mark "verify-present")

The tables this slice's live adapter reads/writes all already exist in `0001_baseline.sql` (schema.md §1/§2)
with the columns ISSUE-015 §8 requires. **No `schema.md` edit is proposed** — verify-present only:

| table | columns this slice uses | status |
|-------|-------------------------|--------|
| `profiles` | `id uuid pk`, `email text not null`, `active boolean not null default true` | verify-present (0001 L97-104) |
| `user_roles` | `user_id`, `role_id`, `active`; `unique(user_id)` (one role per user, OD-029) | verify-present (0001 L162-170) |
| `roles` | `id`, `name unique` | verify-present (0001 L142-149) |
| `event_log` | `event_type` (ENUM — see §1), `summary text not null` (never empty, AC-7.LOG.002.2) | verify-present (0001 L483-496); **enum delta owed (§1)** |
| `access_audit` | `audit_type`, `actor_identity`, `actor_type` (ENUM), `action`, `target_type`, `reason`; append-only trigger | verify-present (0001 L211-226) |

- **No custom invite-token table (OD-014).** The native Supabase invite/OTP link is the only token; expiry +
  consumption are Supabase-auth-server-side. The live adapter reconstructs the invite from the `profiles`
  mirror row (token `native-<profileId>` / `native-seed-<profileId>`), fail-closed on missing/already-active
  (a consumed token) — `validateToken` / `completeSetup` in `supabase-store.ts` now write REAL SQL (flip
  `profiles.active`, insert `account_activated`, read `user_roles→roles.name` for the redirect), no fake
  delegation on the persistence path.
- **`account_type` is not a persisted app column** (searched schema.md + migrations — absent by design). The
  seed admin is always `external_admin`; a native invite's setup branch is selected by the submitted method.
  This is a live seam, not a proposed column — flagged here for the orchestrator's awareness, no delta owed.

## 3. RLS — no delta (verify-present); `service_role` off the RLS path (ADR-006)

The seed + setup persistence run as `service_role` (ADR-006, RLS-exempt by design). The `support_requests`
public insert-only intake policy the invalid/expired-token error path routes into (FR-0.REC.002 seam) is
owned by **ISSUE-016** (its table) + **ISSUE-009** (the default-deny baseline) — **verify-present**, no RLS
delta owed by this slice. The `access_audit` / `event_log` append-only + one-way-redaction triggers are
already in `0001_baseline.sql` (L688-714) — verify-present.

## 4. Residual LIVE-owed feasibility — AF-074 (do NOT fake a live pass)

**AF-074 remains 🔴 (LIVE-owed) — not closed by this slice.** The ≤24 h link-TTL **clamp** is proven offline
(`LINK_TTL_HARD_CAP_SECONDS = 86400`, `cappedExpiry`, and the `AC-0.INV.002.1` clamp test). What only a
hosted-Supabase spike can confirm — and is therefore still owed before `AC-0.INV.002.1` / `AC-0.SEED.002.1`
are `Verified` per `test-strategy.md` — is:
- the expiry is a **global** project setting (not per-link), **hard-capped at 86400 s**, and
- lowering the global slider shortens **both** invite and seed links (vs a separate fixed invite TTL).

This is the DOCS+SPIKE gate in `spec/00-foundations/feasibility-register.md` (AF-074) and the SA11 refutation
(72 h invite ⛔). The offline suite must not be read as closing it — the live coupling stays residual until
the spike runs on the client silo. No live pass is claimed here.

## 5. Nothing else touched

No new glossary term, no new `CFG-auth.*` key (the `auth.invite_link_ttl` / `auth.seed_setup_link_ttl` /
`auth.smtp_*` keys are consumed, homed in the config registry / ISSUE-013), no new PERM node
(`PERM-user.invite` is consumed as a boolean gate, homed in C1/ISSUE-018), no new OD/AF (OD-014 / OD-020 /
AF-074 already logged).
