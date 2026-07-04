# app/management — management-plane schema (operator-owned)

The **management plane** is the operator-owned control database (ADR-001 §7). It holds the
`client_registry` (one row per client silo) + the dual-stored `internal_token`. It is **separate**
from every client silo (each client's own Supabase).

## What's here

- **`migrations/0001_client_registry.sql`** — the `client_registry` table + `client_status` enum,
  copied verbatim from `spec/04-data-model/schema.md` §13.

## Scope + ownership (Rule 0)

`client_registry`'s **full lifecycle** — status-transition machinery and `internal_token`
rotate/revoke — is owned by **ISSUE-012 / FR-10.MGT.001–004** (currently `blocked`). This migration
creates **only the table + enum**, the minimal precondition **ISSUE-007 §8** authorizes sequencing
first so the provisioning `INSERT` (FR-10.PRV.001) has a target during the **AF-004** live run. When
ISSUE-012 builds, it takes ownership of this table; do not add lifecycle logic here.

`secret_manifest` is a **per-silo** table (each client's own Supabase, boot-blocking presence
check), not a management-plane table — it is intentionally not created here.

## Applying it (two-party / AF-004 session)

Against the management-plane Supabase (operator-owned), run the migration with the Postgres client
(`psql "$MGMT_DATABASE_URL" -f migrations/0001_client_registry.sql`). A migration runner
(`drizzle-kit`, ISSUE-008) supersedes the manual apply once built.
