# Stage-2 checkpoint — LIVE evidence (2026-07-05, session 66)

Two-party live run against the canary silo (`SILO_DB_URL`), operator-present. Applied migrations
`0003_config_values_rls`, `0004_prompt_version_discipline`, `0005_retention_prune_whitelist` via
`npm run migrate` (fail-loud + resumable; pre-flight discipline + rls-lint green), then ran the three
issue capstones. Every capstone runs in ONE rolled-back transaction — no fixture survives; the silo is
byte-identical afterward (only the three migrations persist).

## Capstone results — ALL GREEN

**ISSUE-010** (`app/config-store/results/issue-010-capstone.sql`) — 7/7:
- AC-NFR-CMP.006.3 — all four audit sinks carry the `t_append_only` trigger
- AC-NFR-CMP.006.1 — `service_role` DELETE on `config_audit_log` rejected
- AC-NFR-CMP.006.2 — `service_role` in-place content UPDATE rejected
- AC-7.LOG.008.4 — redaction-tombstone permitted; change record retained, actor scrubbed
- AC-7.LOG.008.1 — key-prefix RLS: a `PERM-config.memory` caller reads the memory-group key, NOT the observability-group key
- default-deny — a no-config-perm caller reads zero `config_values` rows
- AC-NFR-SEC.003.1 — `secret_manifest` exposes presence + last_rotated only (no value column)

**ISSUE-011** (`app/observability/results/issue-011-capstone.sql`) — 5/5:
- AC-7.LOG.001.1 — in-place UPDATE of an `event_log` row rejected
- AC-7.LOG.001.1 — unflagged DELETE rejected
- AC-7.LOG.006.3 — redaction-tombstone (null→non-null `redacted_at`) permitted + applied
- **OD-180** — a DELETE inside a `set local app.retention_prune='on'` txn SUCCEEDS (retention path)
- AC-7.LOG.001.2 — out-of-enum `event_type` rejected

**ISSUE-042** (`app/prompt-store/results/issue-042-capstone.sql`) — 7/7:
- AC-4.STO.001.1 — `prompt_layers` carries the listed columns and NO `client_slug`
- AC-4.STO.003.1 — in-place content edit rejected by the version-discipline trigger
- AC-4.STO.003.2 — empty/whitespace `change_reason` rejected
- AC-4.STO.004.1 — DELETE forbidden (rollback creates a new version, never deletes)
- AC-4.LYR.002.1 — a core row requires `agent_id` (schema CHECK enforced)
- AC-4.STO.005.2 (deny) — a user WITHOUT `PERM-prompt.edit` sees 0 rows (default-deny)
- AC-4.STO.005.2 (allow) — a user WITH `PERM-prompt.edit` reads the row (RLS allow)

## Four real defects the checkpoint surfaced (offline could not) — all fixed live + at source

1. **Append-only trigger redaction bug (all three non-guardrail sinks).** `enforce_audit_append_only()`
   used an inline `... and old.status = …` for the guardrail_log branch; on `event_log`/`access_audit`/
   `config_audit_log` (no `status` column) PL/pgSQL raised *"record old has no field status"* — so the
   redaction-tombstone UPDATE was **broken on 3 of 4 sinks** (AC-7.LOG.006.3 / AC-7.LOG.008.4 / the
   compliance-erasure path). Predates the fan-out (latent in 0001). **Fix:** restructured to an outer
   `if tg_table_name='guardrail_log'`, folded into `0005`; `schema.md` §Immutability enforcement synced.
2. **Missing `SELECT` grant to `authenticated` on the RLS read tables.** `0001c` did a blanket
   `revoke all from anon, authenticated`; RLS *filters* rows, it does not *grant* access, so every
   human-path read policy (009/010/042) was unreachable ("permission denied for table" before RLS ran).
   `009`'s capstone missed it — its freshly-created demo table auto-received Supabase default-privilege
   grants the real tables had revoked. **Fix:** `grant select on config_values to authenticated` (0003)
   + `grant select, insert on prompt_layers to authenticated` (0004). Writes stay service_role/trigger-gated.
   *General note for ISSUE-020:* every other human-readable table needs the same grant as its read policy
   is authored — 020 owns that + the `aal2` baseline predicate.
3. **`0004` version-discipline trigger didn't freeze `prompt_layers.name`** (verifier MINOR) — a rogue
   direct-SQL rename could split a version chain. **Fix:** added `name` to the frozen-columns guard.
4. **`042` capstone `created_by` type** — an inline INSERT passed the `text`-typed `ed_uid` to the `uuid`
   column. **Fix:** `ed_uid::uuid`.

## Post-run silo state
`_migrations` = 0001a–d · 0002 · 0003 · 0004 · 0005 (all applied). Capstones rolled back — no fixture
survives. The append-only trigger + retention whitelist + config/prompt RLS policies + grants persist.
