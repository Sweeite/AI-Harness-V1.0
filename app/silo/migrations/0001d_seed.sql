-- Client-silo baseline migration 0001d — idempotent first-boot seed (ISSUE-008)
--
-- Runs LAST in migration 0001 (after tables/indexes/RLS), as the migration role (RLS-exempt), per
-- migrations.md L42-44. Every write is IDEMPOTENT + first-boot-only (guarded by `on conflict do
-- nothing` on a unique key, or `where not exists` where there is none) — running it twice writes
-- nothing new (migrations.md hard constraint; AC re-runnability).
--
-- Seed VALUES by source (Rule 0 — "do not guess them", ISSUE-008 §6):
--   * six roles + role_permissions matrix  → PERMISSION_NODES.md (catalog = source of truth,
--     FR-1.PERM.005). Client-silo nodes ONLY: the `PERM-fleet.*` family is management-plane scope
--     (lives on the operator's separate deployment, ADR-001 §7) and is NEVER seeded into a silo.
--     The 5 ⚠️ "unseeded" nodes (add_sensitivity, memory.write, prompt.rollback, prompt.view_history,
--     compliance.download_records) get NO row — they default-deny per OD-030 until a seed is decided.
--   * orchestrator + 8 specialist agents → the canonical roster in component-08 (FR-8.REG.006 /
--     FR-8.SPC.001), descriptions verbatim from the design doc (L3423-3439).
--   * Internal-Org singleton entity + deployment_settings single row → schema.md §Global rules / §14.
--
-- DEFERRED (documented, not dropped — see ODs):
--   * agents.memory_scope: the concrete jsonb SHAPE of the per-agent least-privilege filter is NOT
--     fixed by the spec (only a conceptual access matrix, component-08 L3467-3476); its shape is fixed
--     by its consumer, ISSUE-063 (per-agent memory scoping). Seeding an invented shape here would be a
--     guessed #2 CONTAINMENT value. Instead we seed the MANDATED fail-closed default `'{}'::jsonb`
--     (empty = retrieves nothing — exactly the fail-closed rule AC-8.SCO.001.3), and ISSUE-063 wires
--     the real scope. See OD-177.
--   * config_values defaults (entity_types, expected_slots, ef_search, ~117 tunables): DEFERRED to
--     ISSUE-010 (Config store + audit-immutability), which owns `config_values`. The values are
--     numerous + Phase-2-owned + several OD-gated; transcribing them in this GATE migration would risk
--     Rule-0 drift against config-registry.md. The Internal-Org entity below seeds fine without them
--     (entities.type is a plain text column; the entity_types validation is app-level). See OD-178.
--   * agents.name literal convention: FR-8.REG.001's `{client_slug}_<role>_agent` pattern embeds
--     client_slug, which OD-096 forbids on any silo table — a spec conflict. We seed the bare role
--     slug (no client_slug); reconciliation tracked in OD-177.
--
-- The runner wraps this file in a transaction — do NOT add BEGIN/COMMIT.

-- ── Six roles (FR-1.ROLE.001; PERMISSION_NODES.md L14-16) ───────────────────
-- All six are the seed baseline (is_default). Super Admin is always protected (OD-025); the others are
-- protected-while-in-use (enforced in app, not seeded here).
insert into roles (name, is_default, is_protected) values
  ('Super Admin',     true, true),
  ('Admin',           true, false),
  ('Finance',         true, false),
  ('HR',              true, false),
  ('Account Manager', true, false),
  ('Standard User',   true, false)
on conflict (name) do nothing;

-- ── Role × permission-node matrix (PERMISSION_NODES.md "Default roles" column) ──
-- Client-silo nodes only (PERM-fleet.* excluded; 5 ⚠️ unseeded nodes excluded). Presence = granted;
-- absence = default-deny (OD-030). Scoped/conditional grants noted in PERMISSION_NODES.md as "only when
-- granted" / panel-scoped (Finance→dashboard.ops Cost panel; Finance/Account-Manager→action.review when
-- routed) are NOT base defaults — they are granted per-deployment, so they are not seeded here.
insert into role_permissions (role_id, permission_node)
select r.id, m.node
from roles r
join (values
  -- C0 — Login / Auth
  ('Super Admin','PERM-auth.provider_toggle'),
  ('Super Admin','PERM-support.view'),      ('Admin','PERM-support.view'),
  ('Super Admin','PERM-support.resolve'),   ('Admin','PERM-support.resolve'),
  ('Super Admin','PERM-user.invite'),       ('Admin','PERM-user.invite'),
  -- C1 — RBAC
  ('Super Admin','PERM-system.role_manage'),
  ('Super Admin','PERM-user.assign_role'),  ('Admin','PERM-user.assign_role'),
  ('Super Admin','PERM-user.deactivate'),   ('Admin','PERM-user.deactivate'),
  ('Super Admin','PERM-user.reset_2fa'),    ('Admin','PERM-user.reset_2fa'),
  ('Super Admin','PERM-user.view_activity'),('Admin','PERM-user.view_activity'),
  ('Super Admin','PERM-user.grant_clearance'),
  ('Super Admin','PERM-user.grant_restricted'),
  -- C2 — Memory (gated by C1)
  ('Super Admin','PERM-memory.delete'),
  ('Super Admin','PERM-ingestion.initiate'),  ('Admin','PERM-ingestion.initiate'),
  ('Super Admin','PERM-ingestion.interview'), ('Admin','PERM-ingestion.interview'),
  ('Super Admin','PERM-ingestion.review'),    ('Admin','PERM-ingestion.review'),
  ('Super Admin','PERM-memory.review_conflict'), ('Admin','PERM-memory.review_conflict'),
  ('Super Admin','PERM-memory.approve_consolidation'),
  -- C3 — Tool layer
  ('Super Admin','PERM-tool.manage'),       ('Admin','PERM-tool.manage'),
  -- C4 — Prompt architecture
  ('Super Admin','PERM-prompt.edit'),       ('Admin','PERM-prompt.edit'),
  ('Super Admin','PERM-prompt.edit_principles'),
  -- C9 — Proactive / Commands
  ('Super Admin','PERM-commands.manage'),   ('Admin','PERM-commands.manage'),
  ('Super Admin','PERM-system.tune'),       ('Admin','PERM-system.tune'),
  -- C10 — Infra / Compliance
  ('Super Admin','PERM-config.edit'),
  ('Super Admin','PERM-compliance.view_audit'),
  -- Config Admin family (PERM-config.* — all Super Admin only)
  ('Super Admin','PERM-config.auth'),
  ('Super Admin','PERM-config.memory'),
  ('Super Admin','PERM-config.tools'),
  ('Super Admin','PERM-config.prompts'),
  ('Super Admin','PERM-config.loops'),
  ('Super Admin','PERM-config.guardrails'),
  ('Super Admin','PERM-config.observability'),
  ('Super Admin','PERM-config.agents'),
  ('Super Admin','PERM-config.proactive'),
  ('Super Admin','PERM-config.infra'),
  ('Super Admin','PERM-config.secrets'),
  -- Dashboard Access family
  ('Super Admin','PERM-dashboard.overview'), ('Admin','PERM-dashboard.overview'), ('Account Manager','PERM-dashboard.overview'),
  ('Super Admin','PERM-dashboard.ops'),      ('Admin','PERM-dashboard.ops'),
  ('Super Admin','PERM-dashboard.workspace'),('Admin','PERM-dashboard.workspace'),('Finance','PERM-dashboard.workspace'),
    ('HR','PERM-dashboard.workspace'),('Account Manager','PERM-dashboard.workspace'),('Standard User','PERM-dashboard.workspace'),
  -- Asset Management family (OD-080 two-tier split: capability = Super Admin only)
  ('Super Admin','PERM-agents.view'),            ('Admin','PERM-agents.view'),
  ('Super Admin','PERM-agents.edit_description'), ('Admin','PERM-agents.edit_description'),
  ('Super Admin','PERM-agents.edit_capability'),
  -- Approval Authority
  ('Super Admin','PERM-action.review'),      ('Admin','PERM-action.review'),
  -- Guardrails — autonomy
  ('Super Admin','PERM-guardrail.edit_autonomy'),
  -- Operations Actions
  ('Super Admin','PERM-ops.dlq_manage'),         ('Admin','PERM-ops.dlq_manage'),
  ('Super Admin','PERM-ops.connector_reconnect'),('Admin','PERM-ops.connector_reconnect')
) as m(role_name, node) on r.name = m.role_name
on conflict (role_id, permission_node) do nothing;

-- ── Orchestrator + 8 specialist agents (FR-8.REG.006 / FR-8.SPC.001) ────────
-- name = bare role slug (client_slug excluded — OD-096). description verbatim from design-doc L3423-3439.
-- memory_scope = '{}'::jsonb  →  FAIL-CLOSED (retrieves nothing) until ISSUE-063 wires the real per-agent
-- scope (OD-177). tools_allowed = '{}' — no tool rows exist at first boot; grants are future config.
-- max_tokens = null (unspecified). enabled = true (canonical roster). version = 1 by definition.
insert into agents (name, description, memory_scope, tools_allowed, max_tokens, enabled, change_reason)
select v.name, v.description, '{}'::jsonb, '{}'::uuid[], null::int, true,
       'First-boot seed — canonical roster (FR-8.REG.006 / ISSUE-008). memory_scope fail-closed pending ISSUE-063 (OD-177).'
from (values
  ('orchestrator', 'Routes and plans tasks. Reads semantic memory, the entity model, and the tool registry only; never writes. (FR-8.ORC.008)'),
  ('research',  'Gathers information before anything else. Reads only, never writes. Every other agent calls this one first. (design-doc L3425)'),
  ('client',    'Owns client relationship work. Calls, summaries, contact updates, communication preferences. Deep client and contact memory access. (design-doc L3427)'),
  ('campaign',  'Owns active campaign work. Briefs, status, performance summaries, task creation. Deep campaign and deliverable memory access. (design-doc L3429)'),
  ('comms',     'Drafts all external communications. Never sends autonomously. Always outputs to the dashboard approval queue. (design-doc L3431)'),
  ('ops',       'Internal operations. Task assignment, capacity, scheduling, internal Slack updates, SOP surfacing. Primary agent for Internal Org entity knowledge. Access to team member and SOP memory. (design-doc L3433)'),
  ('memory',    'Dedicated to memory management. Runs the write flow, handles consolidation, manages the verification queue. Other agents hand raw events to this one rather than writing memory themselves. (design-doc L3435)'),
  ('finance',   'Invoice status, retainer tracking, payment flagging. Read-heavy. Hard limit: never initiates transactions. Confidential clearance scoped to finance entities. (design-doc L3437)'),
  ('insight',   'Runs on the slow loop, not on demand. Looks across all memory and activity for patterns, risks, and opportunities. Feeds the proactive intelligence layer and the self-improvement panel. (design-doc L3439)')
) as v(name, description)
where not exists (select 1 from agents a where a.name = v.name);

-- ── Internal-Org singleton entity (schema.md §Global rules; FR-2.ENT.003) ───
-- Exactly one row with is_internal_org = true; the app never inserts a second. type 'Internal Org' is
-- the locked entity_types constant (config seed deferred to ISSUE-010 — DB column is plain text).
insert into entities (type, name, external_refs, is_internal_org)
select 'Internal Org', 'Internal Org', '{}'::jsonb, true
where not exists (select 1 from entities where is_internal_org);

-- ── deployment_settings single row (schema.md §14, OD-162) ──────────────────
-- Seeded not-frozen at first boot alongside the Internal-Org singleton; app never inserts a second row.
insert into deployment_settings (frozen_at, frozen_reason)
select null::timestamptz, null::text
where not exists (select 1 from deployment_settings);
