-- Client-silo migration 0043 — orchestrator learning / cache / cost event_type values (ISSUE-066, C8 LRN/COST)
--
-- WHY: ISSUE-066 closes the orchestrator feedback loop and records LOUD observability to event_log (#3 — a cost-tier
-- choice, the C7 cost-shape, a learning adjustment, a routing mismatch, and every cache hit/miss/invalidation must be
-- observable + reversible). The live adapter (app/learning-cache-cost/supabase-store.ts) writes these seven values;
-- event_type is a FIXED enum and they are not in it, so a live event_log insert would throw '22P02 invalid input value
-- for enum event_type' (the fake-passes-offline / live-throws class R10 and the offline check gate catch). Added
-- additively:
--   routing_cost_tier         -- COST.001, the chosen cost tier for a route
--   routing_cost_shape        -- COST.003, the expected call profile handed to the C7 meter
--   routing_learning_adjusted -- LRN.001, an observable + reversible routing-weight adjustment from tracked outcomes
--   routing_mismatch_detected -- LRN.002, an agent-description-update suggestion
--   agent_cache_hit           -- LRN.003.1
--   agent_cache_miss          -- LRN.003.3 (cold / expired / uncertain -> miss-on-uncertainty)
--   agent_cache_invalidated   -- LRN.003.2, scope-aware write-triggered invalidation
--
-- The routing_outcome value the learning slice READS is written by the orchestrator (ISSUE-061), not here; and the
-- cost_threshold_breach alert is an alert_type, not an event_type.
--
-- transactional:false -- ALTER TYPE ... ADD VALUE cannot run inside a txn block. IF NOT EXISTS makes it idempotent and
-- resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon -- 0007/0011 trap).

alter type event_type add value if not exists 'routing_cost_tier';
alter type event_type add value if not exists 'routing_cost_shape';
alter type event_type add value if not exists 'routing_learning_adjusted';
alter type event_type add value if not exists 'routing_mismatch_detected';
alter type event_type add value if not exists 'agent_cache_hit';
alter type event_type add value if not exists 'agent_cache_miss';
alter type event_type add value if not exists 'agent_cache_invalidated';
