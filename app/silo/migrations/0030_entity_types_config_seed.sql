-- Migration 0030 — entity_types config seed (ISSUE-022 / FR-2.ENT.002 / AC-2.ENT.002.1 / CFG-entity_types). Additive seed.
--
-- The 0001d baseline deferred the config_values defaults ("entity_types, expected_slots, ef_search, ~117 tunables")
-- to their owning slices; entity_types (the per-deployment list of categories a thing can be filed under) is owned
-- by C2 memory and consumed here to validate entities.type at write time (entities.type is a plain-text column;
-- validation is app-level per OD-178). This seeds the documented default list so a fresh deployment has exactly the
-- default types, including the locked "Internal Org" (AC-2.ENT.002.1). The canonical source of truth is the
-- DEFAULT_ENTITY_TYPES constant in app/memory/src/entity-types.ts; this seed MIRRORS it (memory `check` asserts the
-- two agree -- a non-drift guard, cf. rbac catalog <-> 0006_rbac_seed). Operators may add/rename/soft-disable a type
-- as config afterward with no deploy (AC-2.ENT.002.2); "Internal Org" stays locked-present (config-registry L325).
--
-- expected_slots (the Maturity denominator, ADR-002) is NOT seeded here -- it is the slot substrate owned by the
-- Maturity slice ISSUE-030 (this issue's §2-Out: entities.maturity exists here but is populated by ISSUE-030).
--
-- transactional:true -- a single guarded idempotent insert (no BEGIN/COMMIT; the runner wraps it). `on conflict
-- (key) do nothing` makes re-apply a no-op and never clobbers an operator's later customisation of the list.

insert into config_values (key, value)
values (
  'entity_types',
  '["Client","Contact","Team Member","Vendor/Partner","Campaign","Task","Deliverable","Template","Deal","Contract/Retainer","Invoice","Brand Guide","Audience","Channel","Team/Department","Meeting","SOP/Playbook","Tool/Platform","Goal/OKR","Financial Period","Lesson Learned","Internal Org"]'::jsonb
)
on conflict (key) do nothing;
