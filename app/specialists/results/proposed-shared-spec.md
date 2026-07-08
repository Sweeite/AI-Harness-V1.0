# ISSUE-062 — proposed shared-spec deltas + live-adapter smoke (R10)

This package does **not** author migrations or edit shared spec files (parallel-build boundary). It records here
the shared-spec edits the orchestrator must reconcile and the rolled-back live smoke to run from a 💻 full env.

## No migration required
The reject-at-write invariant is an **app-layer** code deny (the issue's §8 step 4: "at the code layer"). No DDL
delta: `agents.tools_allowed uuid[]` and `tools.config jsonb` already exist in `0001_baseline.sql` (verified by the
offline `check` gate). `tool_category` is exactly `('read','write')` — which is *why* the identity-based class
predicate is required (send/transact/memory-write are all `category='write'`).

## Shared-spec edits needed (report-only — not applied here)
1. **schema.md §4 (`tools`) + component-03 (C3):** document the **`tools.config.hard_limit_class`** tag convention
   — values `'memory_write' | 'autonomous_send' | 'transaction'` — as the version-controlled classification the C8
   reject-at-write guard resolves tool ids against. Owned WITH C3 (FR-3.ACT.002/.004/.007); part of the AF-068
   battery. A tool with no tag is unclassified (non-forbidden).
2. **⚠️ LOAD-BEARING SEED DATUM:** the single internal memory-write tool (FR-3.ACT.007) **must** be seeded with
   `config.hard_limit_class = 'memory_write'`. If it is not, the live classifier returns `null` for it and the
   sole-writer invariant (SPC.005.2) is **silently unenforced live** (#2/#3). Flag on ISSUE-061 seed / C3 tool seed.
   (Offline the reference model is proven; live enforcement rests on this tag existing.)
3. **config-registry.md:** no new config keys (CFG: none).

## R10 live-adapter smoke (rolled back — run from a 💻 full/live env against the silo)
Proves the live class-lookup query the guard depends on (the app-layer deny is then exercised by the adapter over
this same DB). Wrap in a transaction and ROLLBACK — no state persists.

```sql
begin;
-- a tool tagged memory-write (stand-in for the FR-3.ACT.007 tool)
insert into tools (name, description, category, connector, config, change_reason)
values ('smoke-mem-write', 'smoke', 'write', 'internal',
        '{"hard_limit_class":"memory_write"}'::jsonb, 'issue-062 smoke')
returning id \gset
-- the classifier query the adapter issues must return the tag:
select id::text, config->>'hard_limit_class' as klass from tools where id = :'id';
--   expect klass = 'memory_write'  → the adapter's evaluateToolsAllowed() would then REJECT this id
--   on any non-Memory agent (SPC.005.2) and ALLOW it only on the Memory Agent.
-- an untagged tool must classify as null (non-forbidden):
insert into tools (name, description, category, connector, change_reason)
values ('smoke-plain', 'smoke', 'write', 'internal', 'issue-062 smoke') returning id \gset
select config->>'hard_limit_class' as klass from tools where id = :'id';  -- expect NULL
rollback;
```

Then drive the adapter itself (node, live `DATABASE_URL`): `SupabaseSpecialistRegistry.setToolsAllowed('client',
[<mem-write-tool-id>], …)` must throw `ForbiddenCapabilityGrant` and leave `agents` unchanged; the same call on
`'memory'` must append a new agents version. Record evidence before flipping the issue `done`.
