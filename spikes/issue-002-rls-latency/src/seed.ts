// ISSUE-002 build order step 3: seed roles/users/clearances/Restricted grants across the
// envelope, then load a realistic large memory corpus. Embeddings are generated
// SERVER-SIDE (generate_series) so we never ship ~77M floats over the wire.
//
// Embeddings are RANDOM. That is correct for this spike: AF-067 measures LATENCY (initPlan
// overhead + retrieval p95), not relevance. Relevance/ranking quality is AF-002 / ISSUE-025
// (explicitly out of scope, ISSUE-002 §2). Random vectors stress the scan + predicate the
// same way real ones do.

import { randomUUID } from 'node:crypto';
import { q } from './db.js';
import { PROFILE } from './config.js';

// 6 roles spanning the visibility/sensitivity lattice (OD-169 visibility tiers per role).
const ROLES = [
  { id: 1, name: 'viewer', visibility: ['global'], clearances: ['normal'] },
  { id: 2, name: 'team_member', visibility: ['global', 'team'], clearances: ['normal', 'personal'] },
  { id: 3, name: 'manager', visibility: ['global', 'team'], clearances: ['normal', 'personal'] },
  { id: 4, name: 'admin', visibility: ['global', 'team', 'private'], clearances: ['normal', 'personal', 'restricted'] },
  { id: 5, name: 'support', visibility: ['global'], clearances: ['normal'] },
  { id: 6, name: 'super_admin', visibility: ['global', 'team', 'private'], clearances: ['normal', 'personal', 'restricted'] },
];

const PERMS = ['memory.read', 'memory.review_conflict', 'action.review', 'dashboard.ops'];

export type Subject = { uid: string; roleId: number; aal: 'aal1' | 'aal2' };

export async function seed(): Promise<{ subjects: Subject[]; entities: string[] }> {
  const nUsers = PROFILE.N_USERS;
  const nEntities = PROFILE.N_ENTITIES;

  const users: string[] = Array.from({ length: nUsers }, () => randomUUID());
  const entities: string[] = Array.from({ length: nEntities }, () => randomUUID());

  // app_users — every seeded user is aal2 (the baseline gate; aal1 users can't read at all).
  await q(
    `insert into app_users (id, aal) select unnest($1::uuid[]), 'aal2'`,
    [users],
  );

  // roles + role_permissions
  for (const r of ROLES) {
    await q('insert into roles (id, name, visibility) values ($1,$2,$3)', [
      r.id,
      r.name,
      r.visibility,
    ]);
    // give each role a slice of the perm set (fidelity for user_perms; not in the memories
    // predicate, but the helper must do real work)
    const perms = PERMS.slice(0, 1 + (r.id % PERMS.length));
    for (const p of perms) {
      await q('insert into role_permissions (role_id, perm) values ($1,$2)', [r.id, p]);
    }
  }

  // user_roles — round-robin the 6 roles across the 20 users (deterministic spread).
  const subjects: Subject[] = users.map((uid, i) => ({
    uid,
    roleId: ROLES[i % ROLES.length].id,
    aal: 'aal2' as const,
  }));
  for (const s of subjects) {
    await q('insert into user_roles (user_id, role_id) values ($1,$2)', [s.uid, s.roleId]);
  }

  // sensitivity_clearances — each user cleared for exactly their role's clearance set.
  for (const s of subjects) {
    const role = ROLES.find((r) => r.id === s.roleId)!;
    for (const c of role.clearances) {
      await q(
        'insert into sensitivity_clearances (user_id, sensitivity) values ($1,$2)',
        [s.uid, c],
      );
    }
  }

  // restricted_grants — users whose role clears 'restricted' get a live grant over a
  // random 20% slice of entities (so restricted rows are reachable for them, walled for
  // everyone else).
  for (const s of subjects) {
    const role = ROLES.find((r) => r.id === s.roleId)!;
    if (!role.clearances.includes('restricted')) continue;
    const slice = entities.filter((_, idx) => idx % 5 === 0); // 20%
    for (const e of slice) {
      await q(
        'insert into restricted_grants (grantee_user_id, entity_id) values ($1,$2)',
        [s.uid, e],
      );
    }
  }

  // memories — bulk load, embeddings + distributions generated server-side.
  const vocab = [
    'contract', 'invoice', 'meeting', 'client', 'support',
    'pricing', 'renewal', 'onboarding', 'incident', 'roadmap',
  ];
  const total = PROFILE.N_MEMORIES;
  const batch = 5_000;
  let loaded = 0;
  while (loaded < total) {
    const n = Math.min(batch, total - loaded);
    await q(
      `
      insert into memories (content, embedding, entity_ids, visibility, sensitivity)
      select
        'memory ' || g || ' about ' || ($2::text[])[1 + floor(random() * array_length($2,1))::int],
        (select array(select random() from generate_series(1, $3))::vector),
        array[ ($4::uuid[])[1 + floor(random() * array_length($4,1))::int] ]::uuid[],
        case when random() < 0.6 then 'global' when random() < 0.9 then 'team' else 'private' end,
        case when random() < 0.7 then 'normal' when random() < 0.9 then 'personal' else 'restricted' end
      from generate_series(1, $1) g
      `,
      [n, vocab, PROFILE.EMBED_DIM, entities],
    );
    loaded += n;
    process.stdout.write(`\r  seeded ${loaded}/${total} memories`);
  }
  process.stdout.write('\n');

  await q('analyze memories');
  return { subjects, entities };
}
