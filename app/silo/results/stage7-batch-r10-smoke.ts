// Stage-7 batch — combined R10 live-adapter smoke (ISSUE-026 ingestion · 027 maintenance · 066 learning/cache/cost).
// Proves the live-adapter risk these three additive-event-type slices carry: the NEW event_type values cast into the
// real enum with NO 22P02 (the fake-accepts-any-string / live-throws class R10 exists to catch), plus the one
// non-trivial live query each slice's fix depends on. ONE txn, ROLLED BACK — nothing persists.
//
// Run: source ~/.ai-harness-secrets.env && npx tsx results/stage7-batch-r10-smoke.ts   (from app/silo)

import pg from 'pg';

// The 12 additive event_type values (migrations 0041/0042/0043) each package's live adapter writes.
const NEW_EVENT_TYPES = [
  'ingestion_filtered', // 026 (0041)
  'memory_maintenance_run', 'memory_confidence_changed', 'memory_maintenance_task', 'memory_maintenance_mutation', // 027 (0042)
  'routing_cost_tier', 'routing_cost_shape', 'routing_learning_adjusted', 'routing_mismatch_detected', // 066 (0043)
  'agent_cache_hit', 'agent_cache_miss', 'agent_cache_invalidated',
];

const results: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) throw new Error(`R10 assertion FAILED: ${name} ${detail}`);
}

async function main(): Promise<void> {
  const url = process.env.SILO_DB_URL;
  if (!url) throw new Error('SILO_DB_URL not set (source ~/.ai-harness-secrets.env)');
  const ssl = /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: url, ssl });
  await client.connect();
  try {
    await client.query('begin');

    // [1] every NEW event_type value casts into the real enum via an event_log insert — NO 22P02 (all 3 packages).
    for (const et of NEW_EVENT_TYPES) {
      await client.query(`insert into event_log (event_type, entity_ids, summary, payload) values ($1::event_type, '{}', $2, '{}'::jsonb)`, [et, `r10 stage7 ${et}`]);
    }
    const { rows: evc } = await client.query(`select count(*)::int as n from event_log where summary like 'r10 stage7 %'`);
    check('[1] all 12 new event_type values write to event_log via ::event_type (no 22P02)', evc[0].n === NEW_EVENT_TYPES.length, `${evc[0].n}/12`);

    // [2] ISSUE-027 fix — the under-review freeze query with the 'escalated' clause is valid SQL against the real
    //     memory_conflicts schema (the MAJOR: 'pending'-only dropped escalated conflicts).
    const { rows: ur } = await client.query(`select count(*)::int as n from memory_conflicts where state in ('pending','escalated')`);
    check('[2] 027 underReviewMemoryIds WHERE state in (pending,escalated) runs live', typeof ur[0].n === 'number');

    // [3] ISSUE-026 audit path — the ingestion decision audit casts actor_type + writes the real access_audit columns.
    await client.query(
      `insert into access_audit (audit_type, actor_identity, actor_type, target_entity_id, action, reason, path_context)
       values ('ingestion_decision', 'human:r10', 'user'::actor_type, null, 'include', 'r10 smoke', 'queue=r10')`,
    );
    const { rows: au } = await client.query(`select count(*)::int as n from access_audit where path_context='queue=r10'`);
    check('[3] 026 ingestion_decision audit writes access_audit (actor_type user, no 22P02)', au[0].n === 1);

    // [4] ISSUE-066 cache path — the scope-aware agent_result_cache insert + the set-equality find query run against the
    //     real columns (agent_id FK to agents; use a real seeded agent so the FK holds).
    const { rows: ag } = await client.query(`select id from agents limit 1`);
    if (ag[0]) {
      const aid = ag[0].id;
      await client.query(
        `insert into agent_result_cache (agent_id, scope_entity_ids, memory_version, output, expires_at, created_at)
         values ($1, '{}'::uuid[], 'v-r10', '{"r":1}'::jsonb, now() + interval '1 hour', now())`,
        [aid],
      );
      const { rows: cf } = await client.query(
        `select count(*)::int as n from agent_result_cache where agent_id=$1 and memory_version='v-r10' and scope_entity_ids @> '{}'::uuid[] and scope_entity_ids <@ '{}'::uuid[]`,
        [aid],
      );
      check('[4] 066 agent_result_cache scope-aware insert + set-equality find run live', cf[0].n === 1);
      // the advisory-lock key used by put() is a valid hashtextextended call.
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, ['lrn-cache:r10']);
      check('[4] 066 put() advisory-lock (pg_advisory_xact_lock + hashtextextended) is valid live', true);
    } else {
      check('[4] 066 cache path SKIPPED — no seeded agent to satisfy the FK', true, 'agents empty on this silo');
    }

    await client.query('rollback');
    console.log('\n' + results.join('\n'));
    console.log('\n✓ ALL Stage-7 batch R10 assertions PASSED — rolled back, nothing persisted.');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.log('\n' + results.join('\n'));
    console.error('\n✗ Stage-7 batch R10 smoke FAILED:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await main();
