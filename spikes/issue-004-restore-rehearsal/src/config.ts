// ISSUE-004 build order step 1 (declared profile + which paths to exercise).
//
// The corpus profile is CONTESTABLE BY DESIGN (mirrors ISSUE-002's config.ts). It sizes the
// representative source data the backup captures — the restore is only meaningful if the
// backup held something meaningful. If you think the numbers are wrong, change them here (or
// via env) and re-seed — the PASS/FAIL is only as good as this profile.
//
// Grounding:
// - memories: "a large memory batch" accumulates over a silo's life (schema.md `memories`
//   row / FR-2.MEM.002 — vector(1536) embedding column). A few thousand rows is enough for a
//   MEANINGFUL restore assertion (embeddings survive, similarity query works) without making
//   pg_dump/pg_restore of a throwaway take hours. The restore correctness — not the corpus
//   size — is what AF-069 proves; sizing-at-scale (does the hourly dump fit the hour) is
//   AF-072 / ISSUE-085, explicitly OUT OF SCOPE here (ISSUE-004 §2).
// - auth.users: the Supabase-managed identity rows must survive a restore (a restored DB with
//   no users is unusable). A couple dozen is enough to assert count-matches + resolvable.
// - EMBED_DIM 1536: vector(1536) — schema.md `memories` row / FR-2.MEM.002.

function envInt(name: string, dflt: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer, got: ${v}`);
  return n;
}

export const PROFILE = {
  // Representative source corpus (seeded only if SOURCE is empty).
  N_MEMORIES: envInt('N_MEMORIES', 5_000),
  N_AUTH_USERS: envInt('N_AUTH_USERS', 25),
  EMBED_DIM: envInt('EMBED_DIM', 1536), // vector(1536)

  // Assertion knobs.
  SIMILARITY_PROBE_K: 5, // top-k a vector similarity query must return on the restored target
} as const;

// Which restore paths this run exercises, derived from which env vars are set (Rule-0: the
// harness never claims to have proven a path it didn't run). Path B is driven end-to-end by
// the harness (pg_dump → pg_restore); path A is asserted against a target the operator
// restored the in-project backup into out-of-band (see README honesty caveat).
export function pathsFromEnv(): { A: boolean; B: boolean } {
  return {
    A: Boolean(process.env.TARGET_A_DB_URL),
    B: Boolean(process.env.TARGET_DB_URL),
  };
}

// The env vars main.ts requires before it will run at all. Absence → refuse + print (never a
// silent "pass" with no infra). SOURCE is always required; at least one target path must be
// exercisable.
export const REQUIRED_ENV = {
  always: ['SOURCE_DB_URL'] as const,
  atLeastOneTarget: ['TARGET_DB_URL', 'TARGET_A_DB_URL'] as const,
};
