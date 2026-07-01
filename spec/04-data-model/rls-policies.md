# Phase 4 — RLS Policies

**Status:** Draft (Phase 4). Companion to `schema.md`. Per **ADR-006** + `standards/rbac.md`.

## The model (ADR-006, non-negotiable)

1. **Isolation is physical.** One Supabase per client. **No policy references `client_slug`** (it does
   not exist on any app table — OD-096). Cross-client isolation is never an RLS predicate.
2. **Two paths, two enforcement mechanisms:**
   - **Human path** (a logged-in user hitting the dashboard) → **RLS-enforced**, keyed to the caller's
     held PERM nodes + clearances. `auth.uid()` is the subject.
   - **Agent / background path** (harness, loops, Inngest jobs) → runs as **`service_role`**, which
     **bypasses RLS**. Containment on this path is the harness's own RBAC + the per-agent `memory_scope`
     filter (C8 FR-8.SCO), **not** RLS. This is why the sole-writer invariant matters (ADR-004).
3. **Static, data-driven policies.** Policies read live from `role_permissions` / `sensitivity_clearances`
   / `restricted_grants` via `SECURITY DEFINER STABLE` helper functions, wrapped in a **`(select …)`
   initPlan** so the helper evaluates **once per statement**, not once per row (AF-067 — `STABLE` alone is
   not enough; the `(select …)` wrapper is what forces the initPlan). Grant/revoke is instant (edit the
   data row; no policy redeploy).
4. **Default-deny.** Baseline `REVOKE ALL`; every readable table needs an explicit policy. A permission
   node absent from `role_permissions` = denied. Restricted is never a role default.
5. **aal2 gate.** Human-path policies additionally require `user_aal() = 'aal2'` where the surface demands
   step-up (C0/C1) — a benign session continues, a consequential action re-checks (FR-1.RLS.007).

## Helper functions (SECURITY DEFINER, STABLE — called via `(select …)`)

```sql
-- Returns the set of PERM nodes the current user holds (via their one active role).
create function user_perms(uid uuid) returns text[] ...        -- reads user_roles ⋈ role_permissions
-- Returns the clearance tiers + entity-type scopes the user holds.
create function user_clearances(uid uuid) returns setof ...    -- reads sensitivity_clearances
-- Returns the Restricted grants (entity/type scoped) for the user.
create function user_restricted(uid uuid) returns setof ...    -- reads restricted_grants where revoked_at is null
-- Returns the current session AAL ('aal1' | 'aal2').
create function user_aal() returns text ...
```
Each is invoked as `(select user_perms(auth.uid()))` inside a policy so it runs once per statement.

## Per-table policy summary

| Table | Human-path read | Human-path write | Agent path |
|---|---|---|---|
| `profiles` | self + `PERM-user.view` | `PERM-user.manage` | service_role |
| `support_requests` | `PERM-support.view` | **public INSERT-only** intake (cannot SELECT existing) + `PERM-support.resolve` for updates | — |
| `webhook_secrets` / `connector_credentials` | **none** (never surfaced) | — | service_role only (Vault decrypt) |
| `webhook_replay_cache` | none | — | service_role |
| `roles` / `role_permissions` | any authenticated (read) | `PERM-system.role_manage` (Super Admin) | service_role reads for helpers |
| `user_roles` | self + `PERM-user.view` | `PERM-user.manage` | service_role |
| `sensitivity_clearances` | `PERM-clearance.view` | `PERM-clearance.grant` | service_role |
| `restricted_grants` | `PERM-clearance.view` + own grants | `PERM-restricted.grant` (Super Admin) | service_role |
| `access_audit` | `PERM-audit.view` (Personal/Restricted rows re-audited on view) | **append-only**; no UPDATE/DELETE | service_role append |
| `memories` | **clearance predicate** (visibility ∩ sensitivity ∩ Restricted), applied **before ranking** (FR-2.RET.004) | **none** (sole-writer) | **service_role write only** (Memory Agent) |
| `entities` | clearance-scoped (Internal-Org walled from client-facing) | none | service_role |
| `ingestion_queue` | `PERM-ingestion.review` (+ clearance on Personal/Restricted rows) | `PERM-ingestion.review` | service_role |
| `memory_conflicts` | `PERM-memory.review_conflict` | same | service_role |
| `consolidation_approvals` | `PERM-memory.approve_consolidation` | same | service_role |
| `tools` | `PERM-tool.manage` (read) | `PERM-tool.manage` | service_role (selection) |
| `rate_limit_tracker` / `idempotency_ledger` | ops read via `PERM-dashboard.ops` (tracker only) | — | service_role |
| `prompt_layers` | `PERM-prompt.*` (view/edit split; principles Super-Admin-only) | `PERM-prompt.edit` / `.edit_principles` | service_role read at assembly |
| `dynamic_field_values` | `PERM-config.prompts` | same | service_role read at assembly |
| `task_queue` | `PERM-action.review` (approval rows) + **own rows** via `originating_user_id = auth.uid()` (My Queue); sensitive rows clearance-gated | `PERM-action.review` (approve/reject) | service_role |
| `task_graph_versions` / `execution_plans` | `PERM-agents.edit_description` | same (versioned) | service_role read at run |
| `task_history` | ops/audit read only | — | service_role |
| `guardrail_log` | `PERM-action.review` / `PERM-dashboard.ops` | forward status transition only (append-only) | service_role append |
| `injection_quarantine` | `PERM-action.review` | resolve only | service_role |
| `event_log` | clearance + relevance scoped (own/relevant rows); ops sees all via `PERM-dashboard.ops` | **append-only** | service_role append |
| `notifications` | **clearance-scoped to recipient** (viewer) | mark read/actioned | service_role insert |
| `config_values` / `config_audit_log` | **key-prefix-scoped** to caller's `PERM-config.*` group | `config_values`: matching `PERM-config.*`; `config_audit_log`: append-only | service_role |
| `secret_manifest` | `PERM-config.secrets` (Super Admin) — presence only | — | service_role |
| `push_subscriptions` | **owner only** (`user_id = auth.uid()`) | owner | service_role delivery read |
| `agents` | `PERM-agents.view` | `PERM-agents.edit_description` / `.edit_capability` (capability = Super Admin only, OD-080) | service_role (routing) |
| `agent_health_metrics` | `PERM-dashboard.ops` / `PERM-agents.view` | — | service_role write |
| `agent_result_cache` | — | — | service_role only |
| `proactive_suggestions` | **clearance-scoped to recipient** | dismiss/act (act routes through C6) | service_role insert |
| `commands` | `PERM-commands.manage` | `PERM-commands.manage` (author-authority bound, AC-9.CMD.006.4) | service_role read at dispatch |
| `signal_weights` | — | — | service_role |
| `conversations` / `messages` | **owner only** (`owner_user_id = auth.uid()`) | owner insert | service_role insert (agent replies) |
| `deletion_requests` | `PERM-memory.delete` | `PERM-memory.delete` + two-person auth | service_role executes erasure |

## Management-plane tables (separate deployment)

`client_registry`, `deployment_health`, `offboarding_records` are gated by the **`management-plane`**
PERM scope (`PERM-fleet.*` — view/provision/promote_release/offboard/rotate_token). No client business
data is reachable; `internal_token` is never returned to a surface. This is the only place `client_slug`
appears in a policy — and only as the registry's own natural key, not a tenancy predicate.

## The three non-negotiables in the RLS layer

- **#1 (never lose knowledge):** append-only sinks have no UPDATE/DELETE policy (only the retention job
  and the redaction-tombstone path, which is itself logged). Erasure scrubs PII in place, retaining the row.
- **#2 (never do what it shouldn't):** default-deny baseline; capability edits (agents, restricted grants,
  infra config) are Super-Admin-only; Restricted is never a row/role default and never auto-injected; the
  `memory_scope` filter is **fail-closed** on the service_role path (returns nothing if the predicate is
  unwired — AC-8.SCO.001.3).
- **#3 (never fail silently):** a clearance filter that would hide a row runs **before** ranking (never
  shown-then-hidden); a policy-helper error denies rather than opens; the silent-failure detector
  (`task_queue` terminal ⋈ `event_log` terminal) reads across the RLS boundary via `service_role`.

## Open items for build

- The exact `user_perms`/`user_clearances` SQL bodies (SECURITY DEFINER search_path pinning) are build
  artifacts; this spec fixes their contract + the initPlan-wrapping rule (AF-067).
- AF-019 (pgvector applies RLS **after** the ANN scan → aggressive clearance can starve recall) is a
  **paper-until-tested** risk on `memories` retrieval; flagged for the Phase-5 retrieval spike, not a
  schema blocker.
