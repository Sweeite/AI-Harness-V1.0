### AF-069 evidence — restore-rehearsal spike (ISSUE-004)

**(a) Verdict:** PASS → status 🟢
**(b) Date / method:** 2026-07-04 · SPIKE — restore rehearsal (a REAL, logged restore of a recent backup into a throwaway project; the launch go/no-go gate, test-strategy.md §4). First manual run of the standing rehearsal AC-NFR-DR.003.2 (the automated cadence lands in ISSUE-085).
**(b′) Environment:**
- Source: Postgres 17.6 · pgvector 0.8.2
- Path-A target (in-project backup, restored out-of-band): (not exercised)
- Path-B target (off-platform pg_dump → pg_restore): Postgres 17.6 · pgvector 0.8.2

**(c) Corpus / profile (the restore basis — contestable by design):**
- 5,000 `memories` rows with `vector(1536)` embeddings · 25 `auth.users` rows (pre-existing in source).
- A few-thousand-row corpus makes the restore MEANINGFUL (embeddings + identity survive, similarity query works) without a multi-hour dump. Restore CORRECTNESS is what AF-069 proves; whether the hourly dump fits-the-hour AT SCALE is AF-072 (ISSUE-085), out of scope here.

**(d) Path A — in-project PITR/daily backup → throwaway project (AC-NFR-DR.003.1):**
- **Path A (in-project backup): NOT EXERCISED** this run (no connection string supplied). Recorded honestly as not-proven — not as a pass. To include it, set the relevant env var (see .env.example) and re-run.

**(e) Path B — off-platform `pg_dump` → `pg_restore` into throwaway (AC-NFR-DR.003.1):**
- **Path B (off-platform pg_dump): PASS ✅** — Supabase-correct restore: public schema (memories + embeddings) restored via pg_restore; auth.users ROWS loaded data-only into the target’s managed auth schema (the 217-object managed auth schema, owned by supabase_auth_admin, is never restored structurally).
  - restore: driven by harness · `psql "create extension vector" + pg_restore --clean public + pg_restore --data-only auth.users → --dbname postgresql://<redacted>@db.onrpnljlyphbxjhmjjwx.supabase.co:5432/postgres`
  - counts: memories restored 5000 / source 5000 · auth.users restored 25 / source 25
  - ✅ `memories_count_matches` — restored 5000 vs source 5000 memory rows
  - ✅ `embeddings_intact` — null embeddings: 0 · wrong-dimension (≠1536): 0
  - ✅ `vector_similarity_query_works` — cosine <=> similarity query returned 5 rows (top-5)
  - ✅ `auth_users_count_matches` — restored 25 vs source 25 auth.users rows
  - ✅ `auth_users_resolvable` — sampled source user 0538f4d7… resolves on target (email present: true)
  - **measured RTO: 19.4 s** (harness-wall-clock)

**(f) MEASURED RTO (AC-NFR-DR.005.1 — measured, not assumed):**
- Path A: **not recorded** (not-recorded)
- Path B: **19.4 s** (harness-wall-clock)
- Posture (ADR-008): restore-WITH-downtime, minutes-to-hours, NOT instant — no hot failover. This run is where that number becomes MEASURED.

**(g) Scope note:** RESTORE CORRECTNESS + measured RTO only, run ONCE by hand and logged. OUT OF SCOPE (ISSUE-004 §2, owned by ISSUE-085): the STANDING automated rehearsal cadence + lapse/stale alert wiring · scheduling the hourly off-platform dump + client-owned-destination provisioning (ISSUE-007) · whether the hourly dump fits-the-hour at scale (AF-072, LOAD) · Management-API backup-health payload (AF-070) · region/residency confirmation (AF-071, DOCS) · off-platform purge-on-erasure (NFR-DR.009 / AF-137). A missing/failed/stale rehearsal being a LOUD alert is asserted here only as the first manual log entry; the alert wiring is ISSUE-085.

**(h) On ⛔ FAIL — documented fork (R2 / R9 / RP-1):** a backup that does not restore complete + queryable is a **non-negotiable #1 catastrophe** (knowledge lost). AF-069 STAYS 🔴, a **launch-blocking OD is opened**, and the DESIGN DOES NOT PROCEED — the backup/DR mechanism (ADR-008) must change and re-rehearse before go-live. ISSUE-085 stays blocked. A FAIL is a design fork, not a bug to code around.

**Log entry (AC-NFR-DR.003.2 — first manual rehearsal):** rehearsal run 2026-07-04; verdict PASS; paths exercised: B.
