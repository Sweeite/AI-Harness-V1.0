// ISSUE-023 / AF-019 spike — seed the af019_ envelope + a 50k CLUSTERED-vector corpus (server-side, so ~77M floats
// never cross the wire). The corpus MUST be clustered, not uniform-random: recall@10 is only meaningful when the data
// has real nearest-neighbor STRUCTURE (a true "10 nearest" that is measurably closer than the rest). Uniform-random
// high-dim vectors are ~all equidistant, so exact-vs-HNSW id-overlap is ~0 by construction — a measurement artifact,
// not an HNSW failure (the first spike run, 2026-07-09, showed exactly this). So: 200 near-orthogonal unit centroids +
// small per-row noise → tight, separated clusters. A probe drawn near a centroid (sampleProbe) has a well-defined
// cleared neighbourhood — which is what AF-019 actually asks: does the clearance predicate + iterative_scan still find
// the cleared neighbours, or does an aggressive predicate STARVE the pool? Relevance quality (do real embeddings
// cluster usefully) is AF-002/ISSUE-025 — still out of scope; this measures the index's geometric recall under RLS.
//
// Needs pgvector >= 0.7 (vector `+` operator + l2_normalize) — the silo is 0.8.2.

import { randomUUID } from 'node:crypto';
import { q } from './db.js';
import { PROFILE } from './config.js';

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
  const users: string[] = Array.from({ length: PROFILE.N_USERS }, () => randomUUID());
  const entities: string[] = Array.from({ length: PROFILE.N_ENTITIES }, () => randomUUID());

  await q(`insert into af019_app_users (id, aal) select unnest($1::uuid[]), 'aal2'`, [users]);

  for (const r of ROLES) {
    await q('insert into af019_roles (id, name, visibility) values ($1,$2,$3)', [r.id, r.name, r.visibility]);
    const perms = PERMS.slice(0, 1 + (r.id % PERMS.length));
    for (const p of perms) await q('insert into af019_role_permissions (role_id, perm) values ($1,$2)', [r.id, p]);
  }

  const subjects: Subject[] = users.map((uid, i) => ({ uid, roleId: ROLES[i % ROLES.length]!.id, aal: 'aal2' as const }));
  for (const s of subjects) await q('insert into af019_user_roles (user_id, role_id) values ($1,$2)', [s.uid, s.roleId]);

  for (const s of subjects) {
    const role = ROLES.find((r) => r.id === s.roleId)!;
    for (const c of role.clearances) await q('insert into af019_sensitivity_clearances (user_id, sensitivity) values ($1,$2)', [s.uid, c]);
  }

  for (const s of subjects) {
    const role = ROLES.find((r) => r.id === s.roleId)!;
    if (!role.clearances.includes('restricted')) continue;
    const slice = entities.filter((_, idx) => idx % 5 === 0); // a 20% Restricted grant slice
    for (const e of slice) await q('insert into af019_restricted_grants (grantee_user_id, entity_id) values ($1,$2)', [s.uid, e]);
  }

  // 200 near-orthogonal UNIT centroids (l2_normalize(random)) — the cluster seeds. Kept in a table so the server-side
  // memory insert (and sampleProbe) can reference them without shipping 307k floats over the wire.
  await q(`create table af019_centroids (cid int primary key, vec vector(${PROFILE.EMBED_DIM}) not null)`);
  await q(
    `insert into af019_centroids (cid, vec)
     select g, l2_normalize(v.vec)
     from generate_series(1, $1) g
     join lateral (select array(select random() - 0.5 from generate_series(1, $2))::vector as vec) v on true`,
    [PROFILE.N_CENTROIDS, PROFILE.EMBED_DIM],
  );

  const vocab = ['contract', 'invoice', 'meeting', 'client', 'support', 'pricing', 'renewal', 'onboarding', 'incident', 'roadmap'];
  const total = PROFILE.N_MEMORIES;
  const batch = 5_000;
  let loaded = 0;
  while (loaded < total) {
    const n = Math.min(batch, total - loaded);
    // each row: pick a random centroid, embedding = l2_normalize(centroid + small noise). Centroid (unit) dominates the
    // tiny noise (per-component U[-NOISE,NOISE]) → tight, separated clusters with a real "10 nearest".
    await q(
      `insert into af019_memories (content, embedding, entity_ids, visibility, sensitivity)
       select
         'memory ' || g || ' about ' || ($2::text[])[1 + floor(random() * array_length($2,1))::int],
         l2_normalize(c.vec + nz.noise),
         array[ ($4::uuid[])[1 + floor(random() * array_length($4,1))::int] ]::uuid[],
         case when random() < 0.6 then 'global' when random() < 0.9 then 'team' else 'private' end,
         case when random() < 0.7 then 'normal' when random() < 0.9 then 'personal' else 'restricted' end
       from generate_series(1, $1) g
       join lateral (select vec from af019_centroids order by random() limit 1) c on true
       join lateral (select array(select (random() - 0.5) * 2 * $5 from generate_series(1, $3))::vector as noise) nz on true`,
      [n, vocab, PROFILE.EMBED_DIM, entities, PROFILE.CLUSTER_NOISE],
    );
    loaded += n;
    process.stdout.write(`\r  seeded ${loaded}/${total} clustered memories`);
  }
  process.stdout.write('\n');
  await q('analyze af019_memories');
  return { subjects, entities };
}
