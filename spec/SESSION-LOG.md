# Session Log

Reverse-chronological. One entry per working session. This is cross-session memory — the
next session reads the top entry to know exactly where to resume.

---

## Session 58 — 2026-07-04 — ISSUE-007 STARTED (`in-progress`): codebase-home resolved → **ADR-011 (ONE repo — product code in `app/`)**; built the operator-independent slices — client onboarding runbook (FR-10.PRV.004/.002) + provisioning-script scaffold (FR-10.PRV.001) with idempotency + fail-loud PROVEN (4/4 build-time tests). Live AF-004 run + canary fixture still owed (two-party). Checkpoint 0 stays OPEN.

**What happened:** Opened **ISSUE-007** (the last Stage-0 gate, root of the 11-node critical path). First resolved the build-phase decision it parks — *where the durable product codebase lives* — then built every part of the issue that needs **no live infra**, proving the launch-gating idempotency + fail-loud posture now. The two-party pieces (live AF-004 run + the canary fixture) are cleanly teed up for when the operator's Supabase/Railway access is ready. **This session set up a clean handoff so the next chat can start building immediately.**

**Codebase-home decision (settled after a same-session reversal):** first recorded **ADR-010** (a dedicated build repo, `Sweeite/ai-harness-core`) and created + pushed it. The operator then flagged that a *second* repo splits the project's context (all 86 issues + the spec live here) and doubles the sync burden across devices — a standing drift risk for a solo builder. **Reversed to ONE repo → [ADR-011](00-foundations/adr/ADR-011-single-repo.md) (Accepted, supersedes ADR-010, now ⚪ Superseded).** Product code lives in **`app/`** in THIS repo: `app/runbooks/client-onboarding.md` + `app/provisioning/` (4/4 tests green here). One source of truth — spec + issues + code together. The `ai-harness-core` GitHub repo + local clone were **deleted**. Railway will later deploy from the `app/` subdirectory (ADR-005 fan-out unchanged).

**Decision recorded (Rule 0) — [ADR-010](00-foundations/adr/ADR-010-codebase-home.md), Accepted:** the product codebase lives in a **new dedicated build repo, separate from this spec repo**. Reasoning: ADR-005 already fixes it as **one shared repo** Railway deploys per-client (not "monorepo vs many"); the only open axis was *which* repo. This spec repo's whole identity is Rule 0 (requirements source of truth) and it should **not** be a Railway deploy source (a repo that's ~90% markdown). The spine crosses repos by **ID** (`FR→ISSUE#→PR#→TEST`), so separation costs nothing in traceability. Binding cross-repo rule added: every build-repo PR cites its ISSUE-/FR-/AC-IDs; the issue records the PR URL at ship. ADR index + ISSUE-007 callout updated to point at ADR-010 (resolved).

**Built this session (operator-independent — staged under `build/` per ADR-010, moves to the build repo at creation):**
- **`build/runbooks/client-onboarding.md` — FR-10.PRV.004 + FR-10.PRV.002.** The consent-gated client-side runbook: client creates + owns Supabase (`ap-southeast-2`) + Anthropic/OpenAI + in-scope connectors (card on each), grants operator delegated access; per-client OAuth-app registration (redirect URIs → deployment domain, **no shared operator app**); Google production verification started early (AF-013 lead-time); client-owns-compute recorded as a per-client exception. Fail-loud: missing delegated access blocks provisioning. AC-map: AC-10.PRV.004.1/.2 + AC-10.PRV.002.1/.2.
- **`build/provisioning/` — FR-10.PRV.001 scaffold (TypeScript/Node, ADR-009).** Orchestration (`src/provision.ts`) split from a live **`Infra` port** (`src/infra.ts`) so correctness is testable with **zero live infra**. Steps in ADR-005 §5 order — Railway link → `DEPLOYMENT_CONFIG` → mint+dual-store `internal_token` → `client_registry` insert → first deploy (seed) → `initialising` — each **idempotent** (checks state, skips if done) and **loud on partial failure** (typed `ProvisioningError`, never a silent half-silo). Registration is operator-side only (no self-registration — AC-10.PRV.001.2). **4/4 build-time smoke tests green** (`src/provision.test.ts`, `node --test`): happy path dual-stores the token; **re-run converges (nothing re-applied, token not re-minted) — AC-NFR-INF.006.1**; **missing secret fails loud with NO registry row / NO deploy — AC-10.PRV.001.3 / AC-NFR-INF.006.2**; partial failure (deploy dies once) resumes on re-run. `npm run typecheck` clean. Dry-run CLI prints the plan + the exact secret set; the live `--execute` path is guarded behind `TODO(AF-004)` until `RailwayInfra` is built in the two-party session.

**Still owed on ISSUE-007 (both need the two-party session — status stays `in-progress`):**
1. **Live AF-004 run** (🔴) — the load-bearing end-to-end proof: an operator Railway app deploying from the build repo against a **client-owned** Supabase, env + secrets + `internal_token` dual-store + `client_registry` row + first-boot seed all green. Needs the operator's Supabase/Railway access **and** at least ISSUE-012's `client_registry` DDL to write into (integration-coupled — see ISSUE-007 §8). Implementing `RailwayInfra` (the live `Infra` adapter) is the code side of this.
2. **Canary fixture (FR-10.PRV.003, "Should")** — the seeded synthetic-client corpus the canary boots; reuse `spikes/issue-001-cost-viability/src/corpus.ts` (shared with the AF-001/002 spike corpus). AF-066 (representativeness) is a fast-follow, not a correctness gate.

**Files changed (this repo, sync ritual):** new **ADR-011** (single repo) + **ADR-010** marked ⚪ Superseded + ADR index updated; **ISSUE-007** frontmatter `ready→in-progress` + ADR-011 resolution callout; `README.md` build row; new **`app/`** tree — `app/README.md`, `app/runbooks/client-onboarding.md`, `app/provisioning/{package.json,tsconfig.json,README.md,src/{types,infra,provision,index,provision.test}.ts}` (the code, moved back in from the retired repo; `node_modules` gitignored). The interim `ai-harness-core` GitHub repo + local clone were deleted. **NOT touched:** `BUILD-SCHEDULE.md` `007` box (stays unticked — issue not `done`), Checkpoint-0 box (stays OPEN — R1), GitHub #7 (stays open — not done). No new OD.

**Next action (START HERE next chat):** ISSUE-007 has two remaining pieces, both **two-party** (need the operator's Supabase/Railway access). Everything is in THIS one repo — read the requirements (this file + `spec/06-issues/ISSUE-007-provisioning-bootstrap.md` + `spec/06-issues/BUILD-SCHEDULE.md`), the code is in `app/`. Steps:
1. **Operator prep (from `app/runbooks/client-onboarding.md`):** stand up a client-owned Supabase (region `ap-southeast-2`) + Anthropic/OpenAI + in-scope connector accounts; grant delegated access; a Railway account linked to this repo (`Sweeite/AI-Harness-V1.0`), service root = `app/`.
2. **Integration precondition:** ISSUE-012's `client_registry` table DDL must exist for the provisioning `INSERT` to land (see ISSUE-007 §8 integration note) — sequence at least that DDL first.
3. **Build `RailwayInfra`** (the live `Infra` adapter — `app/provisioning/src/infra.ts` has the typed slot + `TODO(AF-004)`), wire the CLI `--execute` path, and **run the AF-004 end-to-end spike**: operator Railway app deploying `app/` against the client-owned Supabase; env + secrets + `internal_token` dual-store + `client_registry` row + first-boot seed all green.
4. **Build the canary fixture** (FR-10.PRV.003) — synthetic-client corpus; reuse `spikes/issue-001-cost-viability/src/corpus.ts` dimensions.
5. On green: flip **AF-004 🔴→🟢** (feasibility-register), ISSUE-007 → `done`, tick its `BUILD-SCHEDULE.md` box, record the implementing commit in `ISSUE-007`, close GitHub #7. **Only then does Checkpoint 0 close and Stage 1 (`008`) open (R1).** The orchestration is already built + tested — the two-party session wires real infra into a finished script, it does not build from scratch.

---

## Session 57 — 2026-07-04 — ISSUE-006 mechanics DONE: AF-078 🟡 MECHANICS PASS + AF-090 DOCS-resolved; live GHL confirmation deferred (OD-172, operator has no GHL account) — all six Stage-0 spikes cleared for Checkpoint-0; only 007 remains

**What happened:** Closed out **ISSUE-006 (webhook forgery/replay, AF-078)** to the extent possible without a GHL account.
Ran the harness's self-contained **MODE M** battery (**17/17** pass); researched GHL's signing scheme from **primary docs**
to resolve **AF-090**; and, with the operator, made a scope decision (**OD-172**) to **re-gate the live per-connector
webhook confirmation from launch-blocking to per-connector onboarding**. With this, **all six Stage-0 spikes are cleared
for Checkpoint-0 (001–005 GREEN + 006 mechanics/OD-172); the only remaining Stage-0 gate is ISSUE-007 (provision a real
silo).**

**Why the deferral (operator-decided, Option A):** the operator **has no GHL account**, and connectors are **client-
driven** (none provisioned at launch), so a **real GHL-signed webhook cannot be produced** — the one thing MODE R needs.
Rather than fake it (which the harness refuses — MODE M cannot claim GREEN), we recorded what IS proven and deferred what
can't be proven yet.

**What was proven / resolved:**
- **MODE M mechanics — 17/17:** per-connector verifiers (Slack HMAC · GHL Ed25519 · Google Pub/Sub JWT) **reject forged /
  tampered / replayed / stale** webhooks and **accept valid** ones. The load-bearing **raw-body-before-parse** trap is
  proven (a deliberate parse-then-verify variant provably fails the same signature — AC-0.WHK.005.1); constant-time compare
  (`crypto.timingSafeEqual`) and replay defense (Slack 5-min window · GHL/Google seen-ID cache) hold.
- **AF-090 DOCS-resolved (primary source, dated 2026-07-04):** from GHL's developer docs — **GHL signs the RAW BODY ONLY**
  with Ed25519 (`X-GHL-Signature`; legacy `X-WH-Signature` RSA deprecates 2026-07-01), and the **published Ed25519 public
  key** (`MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=`) was captured. Src:
  `marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide`. This closes the AF-090 *design* unknown; only the
  empirical live-payload confirmation remains.
- **Slack** is fully proven (symmetric HMAC over a shared secret — the mechanics ARE the real proof, no asymmetric vendor
  gap); **Google** OIDC mechanics (JWKS/audience/expiry) proven.

**OD-172 (change-control — narrows a launch gate):** the per-connector **live webhook-verification confirmation** is
re-gated from a launch-blocking Stage-0 requirement to a **per-connector onboarding requirement** — proven on
**ISSUE-017 / 039 / 040 / 041** before each connector goes live for a real client (blocking THERE). For Checkpoint-0 /
go-no-go, AF-078 is satisfied by the proven mechanics + AF-090 DOCS; the live checks are **tracked residuals** (#3), not
silent. Does NOT relax the mechanics (raw-body-before-parse, constant-time, replay) or NFR-SEC.008 / ADR-007.

**Files changed (sync ritual):** new **OD-172** in `open-decisions.md` (+ guard bumped to OD-173); `feasibility-register.md`
AF-090 🔴→🟡 DOCS-confirmed (key + signing input + source) and AF-078 🔴→🟡 MECHANICS PASS (+ OD-172 residual);
`test-strategy.md` §4 AF-078 gate annotated (OD-172); `ISSUE-006` frontmatter `in-progress→done` + Result note;
`BUILD-SCHEDULE.md` Stage-0 `006` box ✅ (with the 🟡/OD-172 caveat); `_backlog.md` Epic-S row (done) + Tier-0 roll-up;
`README.md` build row. **GitHub #6 closed** with the result + OD-172. **NOT touched:** Checkpoint-0 box (stays OPEN — 007
owed). No change to any locked ADR/FR beyond the OD-172 gate-scope narrowing.

**Next action:** **ISSUE-007 (Stage-0 GATE — provisioning + per-client Supabase bootstrap, still `ready`)** is the LAST
thing between here and Checkpoint 0. Its harness/runbook is **not yet built** — that's the next build task; it needs the
operator's Supabase org access to stand up a real per-client silo (two-party, R8). **Checkpoint 0 closes when 007 has
stood up a real silo** (all six spike AFs are already cleared); only then does Stage 1 (`008` migration harness) open (R1).
**Tracked residuals (not blocking Checkpoint 0, blocking their own later gates):** AF-069 Path A (in-project/PITR restore)
before go-live; AF-078/AF-090 per-connector live webhook confirmation at connector onboarding (ISSUE-017/039/040/041).

**Handoff (new chat next):** ran the **repo self-sufficiency test** (zero-context subagent, repo-only) → **CAN-ACT-WITHOUT-
GUESSING: YES** (next action = build ISSUE-007). Patched the 3 non-blocking drifts it found: `_backlog` Tier-0 roll-up
leading glyphs `🔵→✅` for 004/005/006; OD-172 header session 56→57; and **ISSUE-017/039 absorbed OD-172** (their stale
"AF-078 🔴 launch-blocking" framing corrected to "🟡 MECHANICS PASS; live per-connector confirmation re-gated to onboarding
here"). The next chat resumes cleanly on ISSUE-007.

---

## Session 56 — 2026-07-04 — ISSUE-004 run + PASS: AF-069 🟢 (restore rehearsal, Path B) — 5 of 6 Stage-0 spike AFs now GREEN

**What happened:** With the operator present, ran the **ISSUE-004** restore-rehearsal harness against **real
Supabase infra** and it **PASSED** on Path B — **AF-069 🔴→🟢**. Full sync ritual done. **5 of 6 Stage-0 spike AFs
are now GREEN (001/002/003/004/005); only 006 (webhook, AF-078) + the 007 GATE remain.**

**Setup the operator provided (R8):** the spike-5 project reused as the **source** (direct conn, PG 17.6, pgvector
0.8.2) + a **throwaway target** project (direct conn). Installed the Postgres client tools on the operator's Mac
(`brew install libpq` → pg_dump/pg_restore/psql 18.4, keg-only → prepended to PATH at run time).

**The real work — a genuine finding + harness fix (not a rubber-stamp):** the subagent-built harness used a naive
"whole-DB `pg_restore --clean` into an empty project" strategy that **DOES NOT WORK against a Supabase target** — its
`auth` schema is **managed** (217 objects owned by `supabase_auth_admin`), and the restoring `postgres` role cannot
drop/recreate it (`pg_restore: error: must be owner of table webauthn_credentials`). Diagnosed empirically (ran it,
captured the failure, inspected the dump TOC): also learned `memories.embedding` is type **`extensions.vector(1536)`**
(pgvector lives in Supabase's `extensions` schema, not dumped). **Reworked `dump.ts` + `restore.ts` to a Supabase-
correct strategy:** (1) ensure `extensions.vector` exists on the target; (2) restore the **`public`** schema
(memories + embeddings) cleanly (postgres owns public); (3) load only the **`auth.users` ROWS** data-only into the
target's existing managed auth.users (cleared first for idempotent re-runs) — never restoring the managed auth schema
structurally. Also moved the target env-read to AFTER the restore (so the evidence reports the target's pgvector
version accurately, not the pre-restore "not installed").

**Result (all 5 assertions green — evidence `spikes/issue-004-restore-rehearsal/results/af-069-evidence.2026-07-04.md`):**
- **5000/5000 memories restored, embeddings intact** (0 null, 0 wrong-dimension), and a **cosine `<=>` similarity
  query returns top-5** on the restored target — pgvector memory survives the backup→restore (AC-NFR-DR.003.1).
- **25/25 `auth.users` rows restored + a sampled user resolves** on the target — identity survives.
- **Measured RTO 19.4 s** (harness wall-clock; AC-NFR-DR.005.1 — a measured number, not the assumed "minutes-to-
  hours"). First manual rehearsal logged (AC-NFR-DR.003.2; the automated cadence is ISSUE-085).

**⚠️ Honesty — Path A NOT exercised (recorded, not hidden):** only **Path B** (the off-platform `pg_dump` → restore)
ran — that's the load-bearing #1 guarantee (the client-owned copy that survives project deletion/billing-lapse).
**Path A** (Supabase's in-project PITR/daily backup restored into a throwaway) was the optional operator-driven step
and was **skipped**; also note Supabase in-project backups restore **in-place**, not into a throwaway, so the harness
structurally can't drive it. The evidence + register record Path A as **not-proven**; **residual: confirm the in-
project/PITR restore on the real production tier before go-live.** AF-069 is flipped GREEN on the proven off-platform
path with this caveat explicit everywhere — not a silent full-green.

**Files changed (sync ritual — all trackers in lockstep):** `feasibility-register.md` AF-069 🔴→🟢 (Path-B PASS
summary + Path-A residual); `ISSUE-004` frontmatter `in-progress→done` + Result note; `BUILD-SCHEDULE.md` Stage-0
`004` box ✅; `_backlog.md` Epic-S row (done) + Tier-0 roll-up; `README.md` build row; reworked harness
`spikes/issue-004-restore-rehearsal/src/{dump,restore,main}.ts`; new evidence `results/af-069-evidence.2026-07-04.{md,json}`
(+ stale `PENDING.md` removed; local `*.dump` artifacts gitignored + deleted at teardown — they hold real data).
**GitHub #4 closed** with the result. **NOT touched:** Checkpoint-0 box (stays OPEN — 006 + 007 owed), AF-078 (stays 🔴).
No OD (the spike passed; Path A is a recorded residual, not a design fork).

**Next action:** one you-present spike remains — **ISSUE-006 (webhook, AF-078)**: harness built + MODE-M-validated
(17/17 forgery/replay cases; parse-before-verify proof holds), needs **MODE R** = a **live captured GHL webhook
payload** (raw body + `X-GHL-Signature` headers) + **GHL's published Ed25519 public key + source URL** to resolve
**AF-090** and assert against real vendor signatures. Plus **ISSUE-007** (Stage-0 GATE, still `ready`) must stand up a
real per-client silo — its harness/runbook is **not yet built** (next build task; it will need the operator's Supabase
org access). **Checkpoint 0 closes only when all six spike AFs are GREEN (001/002/003/004/005 ✅; 006 owed) AND 007 has
stood up a silo** — only then does Stage 1 (`008`) open (R1). Also a **residual**: Path A (in-project/PITR restore)
verification for AF-069 before go-live. Do not tick the Checkpoint-0 box early.

---

## Session 55 — 2026-07-04 — ISSUE-005 run + PASS: AF-077 🟢 (brute-force/credential-stuffing) — first you-present spike flipped GREEN on real infra

**What happened:** With the operator present, ran the **ISSUE-005** harness against a **live throwaway Supabase
Auth project** and it **PASSED** — **AF-077 🔴→🟢**, the first of the three you-present Stage-0 spikes flipped on
real infra. Full sync ritual done in one commit.

**Setup the operator provided (R8):** a throwaway Supabase Auth project (plan **pro**), a seeded external-Super-
Admin account (email+password), an enrolled TOTP factor, **Cloudflare Turnstile** CAPTCHA enabled in Attack
Protection, and leaked-password protection on. Two build-time harness bugs were fixed to get there (all committed
before the run, no status change): (1) **Node<22 WebSocket** — `@supabase/supabase-js` constructs a realtime
client that throws without a global WebSocket on Node 20 → added `src/ws-polyfill.ts` (`ws`); (2) **enroll helper**
— Supabase has no dashboard 2FA-enable-and-reveal-secret flow, so added `npm run enroll` (`src/enroll.ts`) which
clears any stale factor via the admin API then enrolls a fresh one and prints `TEST_ACCOUNT_TOTP_SECRET`; (3)
declared the `undici` dep (lazy-imported by the real-proxy path) so the whole harness typechecks. Chose **Turnstile
over hCaptcha** (verified pricing: Turnstile is unconditionally free/unlimited — a better fit for the client-pays-
opex model than hCaptcha's $139/mo Pro tier; both are Supabase-supported and harness-agnostic).

**Result (all 9 checks green — evidence `spikes/issue-005-brute-force-defense/results/af-077-evidence.2026-07-04.md`):**
- Scripted **single-account** and **simulated multi-IP** credential-stuffing **both halted before any session
  minted** — the app-layer per-account soft-lock trips at threshold **5** and holds (attempt 6 blocked before
  reaching Supabase). Proves the load-bearing AF-077 claim: the soft-lock is **IP-independent**, so it stops the
  multi-IP case that defeats Supabase's per-IP caps (Supabase has **no** native per-account lockout, [SA16]).
- **2FA challenge** soft-locks at wrong-code **6** (`mfa_softlock_threshold`=5) and **refuses even a genuinely-
  correct code once locked**; **AAL2 never reached**.
- **CAPTCHA observed LIVE** — Turnstile genuinely rejected the scripted logins (recorded as observed, not merely
  config-flagged — the honest bar we set). Leaked-password enforceable on Pro.
- Observability: **15** login attempts logged, **2** Super-Admin alerts fired (#3 — nothing silent).
- **Confirmed build values for ISSUE-014:** `account_lockout_threshold`=5 · `account_lockout_minutes`=15 ·
  `mfa_softlock_threshold`=5 · CAPTCHA+leaked on.

**Honesty caveat (in the evidence):** multi-IP was **simulated** (no proxies supplied) — the harness disabled its
per-IP counter to prove the per-account soft-lock is the real backstop when IP limits are defeated. The soft-lock
proof is IP-independent, so a real-proxy run would strengthen but not change the verdict. Also: because Turnstile
blocked every scripted attempt, the soft-lock counter tripped on CAPTCHA-rejected failures (the counter counts
failed attempts regardless of *why* they failed — identical mechanism to wrong-password failures); both layers
demonstrably engaged.

**Files changed (sync ritual — all trackers in lockstep):** `feasibility-register.md` AF-077 🔴→🟢 (rich PASS
summary + evidence pointer); `ISSUE-005` frontmatter `in-progress→done` + Result note; `BUILD-SCHEDULE.md` Stage-0
`005` box ticked ✅; `_backlog.md` Epic-S row (done) + Tier-0 roll-up; `README.md` build row; new evidence
`spikes/issue-005-brute-force-defense/results/af-077-evidence.2026-07-04.{md,json}` (+ stale `PENDING.md` removed);
plus the three harness fixes above (`ws-polyfill.ts`, `enroll.ts`, `undici`). **GitHub #5 closed** with the result.
**NOT touched:** the Checkpoint-0 box (stays OPEN — 004/006 + 007 still owed), AF-069/078 (stay 🔴). No
scope/decision change; no OD (the spike passed — a red spike would have been the design fork).

**Next action:** two you-present spikes remain — **ISSUE-004 (restore, AF-069)** and **ISSUE-006 (webhook, AF-078)**,
both harnesses built + `in-progress`, awaiting operator infra (004: source + throwaway target Supabase projects +
`pg_dump`/`pg_restore`; 006 MODE R: a live captured GHL payload + GHL's published Ed25519 public key → resolves
AF-090). Plus **ISSUE-007** (Stage-0 GATE, still `ready`) must stand up a real silo. **Checkpoint 0 closes only when
all six spike AFs are GREEN (001/002/003/005 ✅; 004/006 owed) AND 007 has stood up a silo** — only then does Stage 1
(`008`) open (R1). Do not tick the Checkpoint-0 box early.

---

## Session 54 — 2026-07-04 — ISSUE-004/005/006 harnesses BUILT (in-progress) — the three remaining Stage-0 you-present spikes; AFs stay 🔴 pending operator infra (nothing faked, nothing flipped)

**What happened:** Built the **three remaining Stage-0 launch-gating spike harnesses** — the parallel BATCH
**ISSUE-004 (restore rehearsal, AF-069)**, **ISSUE-005 (brute-force / credential-stuffing, AF-077)**,
**ISSUE-006 (webhook forgery/replay, AF-078)**. All three are runnable TS/Node harnesses (ADR-009) mirroring
the 001–003 house style exactly: `src/` mapping 1:1 to each issue's §8 build order, fields a–h dated evidence
emitters → `results/`, a README (§8 table + Run + proves/does-not + On-FAIL), `.env.example`, `.gitignore`,
`package.json`/`tsconfig.json`. Each typechecks. **None was run and none flips its AF this session** — unlike
001–003, these three are **R8 "you-present" spikes** that need the operator's REAL infra + credentials, which
we do not have at build time. Per the operator's instruction and R8/#3, the harnesses **refuse to run without
infra and fabricate no evidence** (`results/` holds only `PENDING.md`).

**The three harnesses (all in `spikes/`):**
- **`issue-004-restore-rehearsal/`** — drives a real restore of BOTH ADR-008 backup paths into a throwaway
  project and asserts pgvector memory rows (embeddings intact, cosine query works) + `auth.users` survive,
  with a MEASURED RTO (AC-NFR-DR.003.1/.005.1). Honesty caveat baked in: **path A (in-project/PITR backup)
  cannot be driven by a connection string** — Supabase restores it itself; the harness asserts against the
  operator's out-of-band-restored target. Path B (`pg_dump`→`pg_restore`) is fully harness-driven.
- **`issue-005-brute-force-defense/`** — real scripted credential-stuffing (single-account + multi-IP) against
  a live throwaway Supabase Auth project via `@supabase/supabase-js` + real TOTP (`otpauth`), asserting the
  app-layer per-account soft-lock + 2FA soft-lock + CAPTCHA + leaked-password halt the attack before a session
  mints, logged + alerted (AC-0.AUTH.009.1/.2, AC-0.AUTH.007.3, AC-NFR-SEC.009.1). Caveats: true multi-IP needs
  operator proxies (else a labelled *simulated* mode); leaked-password enforces only on Pro+.
- **`issue-006-webhook-forgery/`** — zero-dep (Node `crypto`) verifiers for Slack HMAC · GHL Ed25519 · Google
  Pub/Sub JWT, with the load-bearing **raw-body-before-parse** shim (+ a deliberately-wrong parse-then-verify
  variant proving AC-0.WHK.005.1), `timingSafeEqual`, replay cache, and the common 401 + `prompt_injection`
  reject path. **Two modes:** MODE M (self-contained mechanics — proves the crux with self-generated keys but
  **refuses to claim GREEN**) and MODE R (real — needs a **live captured GHL payload + GHL's published Ed25519
  public key** to resolve **AF-090** and assert against real vendor signatures). AF-078 flips 🟢 only on a
  MODE-R PASS.

**Why nothing was flipped (honesty / the three non-negotiables):** a green AF here must be *earned* against real
infra. Faking a backup, an auth endpoint, or a GHL signature to force a PASS would violate #1 (a false backup
guarantee) and #3 (a silent false-healthy gate). So this session marks the three issues **`ready → in-progress`**
only, and leaves every downstream tracker at the honest not-done state.

**Files changed (all trackers in lockstep at the in-progress state — no tracker left ahead):** new
`spikes/issue-004-restore-rehearsal/`, `spikes/issue-005-brute-force-defense/`, `spikes/issue-006-webhook-forgery/`
(harness code + READMEs + `.env.example` + `results/PENDING.md`); the three `ISSUE-004/005/006` frontmatter
`status: ready → in-progress` + a build-status note in each; `_backlog.md` Epic-S rows + Tier-0 roll-up (🔵
in-progress, harnesses built, AFs 🔴); `README.md` build row. **NOT touched (correctly):** `feasibility-register.md`
(AF-069/077/078 stay 🔴), `BUILD-SCHEDULE.md` boxes (unticked — not done), the Checkpoint-0 box (open), GitHub
issues #4/#5/#6 (stay OPEN — matches in-progress). No scope/decision change; no OD (no spike has failed — a red
spike would be the design fork, none has run yet).

**Next action (operator-blocked — the exact ask is in each harness README "What I need from the operator"):**
the operator provides the credentials/setup for each you-present spike, then we **run each spike present** and, on
PASS, run the **full sync ritual per spike** (flip its AF 🔴→🟢 in `feasibility-register.md` with dated a–h
evidence, tick its `BUILD-SCHEDULE.md` box, update the `_backlog` roll-up + README build row, close its GitHub
issue #4/#5/#6, append a SESSION-LOG entry) — one commit each. Operator shopping list in brief: **004** — a SOURCE
Supabase project (direct conn) + a throwaway restore target (direct conn) + `pg_dump`/`pg_restore` on PATH (+ opt.
a second throwaway for the path-A in-project-backup restore + its wall-clock; plan tier that has PITR/daily
backups); **005** — a throwaway Supabase Auth project (URL + anon + service-role) + a seeded external-Super-Admin
account + its enrolled TOTP base32 secret + plan tier (Pro+ for leaked-password) + CAPTCHA turned on (+ opt.
provider test keys, proxies); **006** — a **live captured GHL webhook payload** (raw body + headers incl.
`X-GHL-Signature`) + **GHL's published Ed25519 public key + source URL** (for MODE R / AF-090); Slack/Google real
secrets optional (self-signable in MODE M). **Checkpoint 0 closes only when all six spike AFs are GREEN *and*
`007` (Stage-0 GATE — provision a real silo, still `ready`) has stood up a silo** — 007 remains owed alongside
these three. Only then does **Stage 1 (`008` migration harness)** open (R1). Do **not** tick the Checkpoint-0 box
early.

---

## Session 53 — 2026-07-04 — ISSUE-003 built + run + PASS: AF-068 (injection containment red-team) flipped 🟢; GitHub mirror drift (#2) reconciled

**What happened:** Built the next `ready` Stage-0 spike — **ISSUE-003 (injection-containment red-team, AF-068)** — the
load-bearing claim of the whole ADR-007 posture. Unlike 001/002 (measurements against real infra), the *subjects
under test* (the seven hard limits ISSUE-055, the injection pipeline ISSUE-059, the mid-task RLS re-check ISSUE-020)
aren't built yet, so per §8.1 the spike runs against a **throwaway harness stub that faithfully reproduces the seams**
— "prove the path, not ship the product." Full harness `spikes/issue-003-injection-containment/` (TS/Node, zero runtime
deps, mirrors the 001/002 house style: `src/` 1:1 with §8 build order, dated evidence in `results/`, README, AF block).
**AF-068 PASS → 🟢.**

**Design (why the green run is trustworthy, not self-fulfilling):** threat model = a **fully-compromised, maximally-
obedient model** (assume HL7 already happened at the reasoning layer — the model emits whatever the injection asks;
security *never* rests on the model refusing, per ADR-007 part 1). The code gate `enforce()` takes **no prompt/content
parameter** — structurally unswayable by injected text. Battery = **12 attacks + 4 negative controls**:
- **12/12 attacks contained** — no consequential side effect reached execution (each of the 7 hard limits + the
  external-comms floor incl. an OD-161 "low-risk" sub-type + financial + Confidential/Restricted memory + cross-client
  + self-approval + boundary-tag break-out).
- **8 evasion payloads** carried no injection literal → not quarantined → **reached the model, which obeyed** → still
  blocked by the code gate. This is the "contained, not necessarily caught" proof (ADR-007 part 1).
- **4/4 negative controls succeed** (human-approved external send / same-client read / benign read / normal memory
  write all allowed) — proving real containment, not a brick that blocks everything.
- Boot: `injection_semantic_detection_enabled=false` (AC-NFR-SEC.006.3); quarantine retained + human-routed
  (`human_decision=null`, `guardrail_log` type `prompt_injection`); **0** hard_limit rows approved (schema L506 check).
- **Mutation-tested:** injecting a real bypass (allow autonomous external email) flips the verdict ⛔ + exits non-zero —
  the battery has teeth (proven, then reverted).

**Scope honesty (stated in the evidence + issue §10):** PASS = the containment *design* has no bypass at the executable-
seam level, **and** we now hold the retained regression battery. It does **not** prove the *shipped* enforcement code is
safe — the same battery re-runs against ISSUE-055/059/020 (and live connectors, once ISSUE-039/040/041 exist) pre-release.
Detection-signal *quality* is AF-117 (separate EVAL); per ADR-007 detection is only a signal, so a library gap degrades
the signal, it does not breach containment.

**Files changed (sync ritual — all trackers in one commit):** new `spikes/issue-003-injection-containment/` (+ evidence);
`feasibility-register.md` (AF-068 🔴→🟢); `ISSUE-003` frontmatter `ready→in-progress→done` + §10 Result; `BUILD-SCHEDULE.md`
Stage-0 003 ✅; `_backlog.md` (roster + Tier-0 roll-up); `README.md` build row; `security.md` NFR-SEC.004/006 AF-068 gate
annotations (ACs proven-vs-stub, Verify-vs-shipped). **GitHub mirror reconciled:** closed **#3** (AF-068) — *and* **#2**
(AF-067), which was still OPEN though ISSUE-002 was `done` last session (drift from Session 52 fixed; Rule 0 / #3). No
scope/decision change.

**Next action:** Stage 0 continues — **three** launch-gating spikes remain on the go/no-go set: **ISSUE-004 (restore
rehearsal, AF-069)**, **005 (brute-force, AF-077)**, **006 (webhook forgery, AF-078)**. All `ready`; none blocks another;
each flips its AF. R2/R8 still apply (a red spike is a design fork; 004 needs a real backup+restore, 005/006 need real
auth/webhook endpoints → operator credentials). **Checkpoint 0 closes only when all six Tier-0 spike AFs are GREEN *and*
`007` (Stage-0 GATE — provisioning + per-client Supabase bootstrap, still `ready`) has stood up a real silo** — 007 is
owed alongside the three remaining spikes. Only then does **Stage 1 (`008` migration harness)** open (R1).

---

## Session 52 — 2026-07-04 — ISSUE-002 built + run + PASS: AF-067 (RLS hot-path latency) flipped 🟢; AF-019 planner cliff surfaced

**What happened:** Pulled main (synced `BUILD-SCHEDULE.md` etc.), then built the next `ready` Stage-0 gate —
**ISSUE-002 (RLS hot-path latency spike)** — on the operator's **real Supabase** (PG 17.6 / pgvector 0.8.2). Full
runnable harness `spikes/issue-002-rls-latency/` (mirrors the ISSUE-001 house style: `src/` modules 1:1 with the
issue §8 build order, dated evidence in `results/`, README, AF-evidence block). **AF-067 PASS → 🟢.**

**Measured (50k memories · 20 users · 6 roles, heaviest restricted predicate):**
- **initPlan overhead 1.06 ms/statement** (< 50 ms target), initPlan **loops = [1,1,0,1] → once-per-statement confirmed**
  (not per row) — AC-NFR-PERF.001.1 PASS.
- **`auth_rls_initplan` lint (splinter 0003 replica) PASS** — every `auth.*`/helper call wrapped in `(select …)`,
  all policy columns indexed — AC-NFR-PERF.001.2 PASS.
- **Cliff proven** on a `count(*)` full scan (no vector math to mask it): bare per-row policy **2.5× slower** than
  wrapped (modest ratio — helpers hit tiny indexed tables; direction + mechanism identical to Supabase's 178,000→12).
- **Clearance-filtered vector top-k p95 = 0.9 ms** on the HNSW index (< 2 s) — AC-NFR-PERF.003.2 PASS (latency half).
- **OOS-012 (D2 JWT-cache fallback) NOT triggered.**

**⚠️ Surfaced a real AF-019 finding (NOT an AF-067 failure — logged, not hidden, per #3):** with the RLS clearance
predicate present, the **pgvector planner defaults to a full Seq Scan (~19 s)** instead of the HNSW index (**~63 ms
forced**) — a **~300× cliff**. The index composes correctly with RLS; the planner just won't pick it under the filter
without help. This is now a **measured hard requirement for ISSUE-023** (force index usage: `hnsw.iterative_scan` /
partial indexes / cost tuning) — recorded in AF-019 (register F10 + status), ISSUE-023 (new ⚠️ callout), performance.md,
backlog, BUILD-SCHEDULE, README.

**Files changed (sync ritual — all trackers in one commit):** new `spikes/issue-002-rls-latency/` (+ evidence);
`feasibility-register.md` (AF-067 🔴→🟢, AF-019 F10/status strengthened); `ISSUE-002` frontmatter `ready→done`;
`ISSUE-023` measured-blocker callout; `BUILD-SCHEDULE.md` Stage-0 002 ✅; `_backlog.md` (roster + Tier-0 roll-up);
`README.md` build row; `performance.md` NFR-PERF.001/003 (paper→confirmed, latency half). No scope/decision change.

**Next action:** Stage 0 continues — three launch-gating spikes remain on the go/no-go set: **ISSUE-003 (injection
containment, AF-068)**, **004 (restore rehearsal, AF-069)**, **005 (brute-force, AF-077)**, **006 (webhook forgery,
AF-078)**. None blocks another; each flips its AF. R2/R8 still apply (a red spike is a design fork; spikes need the
operator's credentials/keys). After all six Tier-0 spikes are GREEN, Checkpoint 0 closes and Stage 1 (`008` migration
harness) opens.

---

## Session 51 — 2026-07-03 — CLAUDE.md wired to the build schedule + a build-status sync contract

**What happened:** Operator asked that `CLAUDE.md` check the schedule before a build session starts and keep
build status/progress in sync. Added three things to the operating protocol (no new IDs; process doc, not a
locked decision):
- **Start-of-session reading order — new item 8:** if the build has begun, read `BUILD-SCHEDULE.md` first
  (active stage · next `ready` issue · safety contract R1–R9), then only that issue + its Context manifest.
- **New "Build-phase protocol" section:** codifies (1) read-schedule-and-reconcile-before-building, (2) the
  safety contract with R1 (no stage opens until the prior checkpoint is GREEN) and R2 (a red spike is a design
  fork → OD), and (3) the **build-status source of truth** — ground truth = each `ISSUE-<nnn>.md` `status:`
  frontmatter; derived = `BUILD-SCHEDULE.md` boxes + `_backlog.md` roll-up; GitHub = outward mirror; SESSION-LOG
  = narrative. Plus the **sync ritual**: when an issue changes state, update every tracker in the same commit;
  never leave one ahead of another (silent drift = #3 violation).
- **End-of-session step 1** now also requires reconciling build status across all trackers in the build phase.

**Files changed:** `CLAUDE.md` (3 edits). No scope/decision change.

**Next action:** unchanged — Stage 0, `ISSUE-002` (RLS-latency spike) is the next `ready` gate on the memory
critical path.

---

## Session 50 — 2026-07-03 — Build-order made followable: `BUILD-SCHEDULE.md` (11 dependency waves + checkpoints + safety contract)

**What happened:** Operator asked whether the build could be *batched* (build a group, then test) rather
than strictly one-issue-at-a-time, and for a followable schedule that "won't mess up if I follow it."
Confirmed the build order was already documented (`_backlog.md` tiers + 11-node critical path + DAG; each
issue's §7 edges) — the batching concept too ("issues within a tier can be built in parallel"). Added a
**derived** operational schedule; no new IDs, no decisions (Rule 0 — it re-expresses existing order).

**Created `spec/06-issues/BUILD-SCHEDULE.md`:** recomputed the DAG into **11 strict dependency waves**
(finer than the 7 tiers — the tiers hide internal chains, e.g. `018→019→022` all in Tier 3). Each stage =
a batch (provably parallel-safe: same-wave issues have no path between them) + its **gate** (the spine
issue) + a **checkpoint** (integration test). Fronted by a **safety contract** (R1–R9) whose core
guarantee: building stages in order means every dependency was built *and passed its checkpoint* first, so
you never build on unverified ground (#3). Spine = `007→008→009→018→019→022→023→025→045→053→072`;
`053` flagged as the keystone (fan-in 7). High-care issues tied to the three non-negotiables marked 🔴.

**Also:** pointer added at the top of `_backlog.md` "Build-order tiers" → the new schedule. A visual
build-timeline artifact was produced this session (spine + fans + checkpoints, "highlight spine only" toggle).

**Rule-0 note:** if `BUILD-SCHEDULE.md` and any per-issue §7 disagree, the issue file wins; regenerate the
schedule if the DAG changes. Acceptance-criteria text is never copied into it (read in the FR).

**Next action:** unchanged from Session 49 — continue Tier-0 spikes (recommend `ISSUE-002` RLS-latency,
gates the memory critical path). The schedule doesn't alter scope or decisions; it's a build aid.

---

## Session 49 — 2026-07-03 — BUILD BEGINS: ISSUE-001 (cost-viability spike) built + run + PASS; AF-001 flipped 🟢; ADR-009 (stack) locked

> **⚠️ HANDOFF NOTE — the build has started. Spec Phases 0–6 remain the terminus; this is the first
> runnable code.** Tier-0 spike **ISSUE-001 is DONE** (AF-001 launch gate PASS). Five Tier-0 spikes
> remain (002 RLS-latency · 003 injection · 004 restore · 005 brute-force · 006 webhook). The
> product-repo home decision is deliberately deferred to **ISSUE-007** (top of the critical path) —
> spikes live in `spikes/<issue>/` and are disposable evidence, not the product codebase.

**What happened:** Started the build with **ISSUE-001 — SPIKE: cost viability ≤ ~$20/day** (one of the
six OD-157 launch go/no-go gates). Two decisions + a full runnable harness + a real measured PASS.

**Decisions written down (Rule 0):**
- **ADR-009 (implementation stack = TypeScript/Node)** — NEW. Grepped the whole spec: the *language*
  was never recorded, only the infra (Inngest + Supabase, which are TS-first). The operator's memory
  said "TypeScript" but Rule 0 = it isn't decided until it's in a file with an ID. Locked it now,
  Accepted, indexed in `adr/README.md`. Affects every build issue.
- **Code location:** build code lives in **`spikes/<issue>/`** in this repo (spec untouched). The
  product-repo-vs-monorepo call is explicitly deferred to ISSUE-007 (Tier-1 bootstrap "stands up a
  client project") — a spike shouldn't force it.

**ISSUE-001 built + run (DoD closed):**
- **Harness:** `spikes/issue-001-cost-viability/` — 11 TS modules mapping 1:1 to the issue's build
  order: `profile.ts` (declared typical-volume profile — the extrapolation basis, contestable by
  design) · `corpus.ts` (assembles+records the corpus, since no canonical corpus file exists) ·
  `pricing.ts`+`ledger.ts` (`price_table` + round-up estimator + the running meter, `cost_tokens ×
  price_table`) · `vendors.ts` (real Anthropic Sonnet/Haiku + OpenAI embed, **attempts counted**,
  dry-run mode) · `task.ts` (orchestrator→research→2 specialists→synthesis) · `memoryWrite.ts`
  (ADR-003 §4 path: code filter → Haiku gate → 2 Haiku pre-checks → 1 Sonnet writer → embed) ·
  `extrapolate.ts` + `thresholds.ts` + `report.ts` (evidence fields a–h) + `main.ts`.
- **Real measured result (2026-07-03):** one task **$0.0359** (5 Sonnet + 1 Haiku); one surviving
  write **$0.0025** (1 Sonnet + 3 Haiku + 1 embed — ADR-003 §4 shape **confirmed**); non-survivor
  **0 Sonnet**. Extrapolated against the declared profile (50 tasks/day · 500 write-events, 100
  survive · 169 idle-gated loops) = **$2.09/day** — ~10× under the ~$20 target, ~25× under the $50
  soft alert, *with* the round-up posture (every retry charged, non-batch rates, no cache discount).
  Verdict **PASS 🟢**. Evidence artifact: `results/af-001-evidence.2026-07-03.{json,md}`.
- **Note on the run:** first live run failed **loud** (as designed, non-negotiable #3) on an OpenAI
  `429 no-quota` — operator funded OpenAI, re-ran clean. Anthropic worked first try.

**Repo writes (Rule 0 — result recorded, not left in chat):**
- `feasibility-register.md` — **AF-001 flipped 🔴→🟢** with the evidence summary; AF-040/041/042/043
  given dated `↳ AF-001` cross-reference notes (glyphs unchanged — their own EVALs still owed).
- `cost.md` — **AC-NFR-COST.006.1/.2 → Verified** + a Verification-result line under NFR-COST.006.
- `config-registry.md` App. A item 10 — **OpenAI `text-embedding-3-small` rate filled: 0.00002/1k**
  ($0.02/1M standard, not batch), primary-source verified 2026-07-03 (was a `???`-style gap).
- `ISSUE-001-...md` — `status: ready → done` + a result banner. `README.md` — new **Build** status row.
- `adr/ADR-009-...md` + `adr/README.md` index row.

**New open questions / follow-ups:** none blocking. Fast-follow EVALs still owed (unchanged, not this
gate): AF-042 (estimate-vs-real-invoice reconciliation), AF-043 (gate accuracy / 3-week shadow-retain),
AF-040/041 (threshold realism over more task types). The declared profile is contestable → any dispute
routes to an AF-040/041 EVAL, not back to this gate.

**Next action:** the operator's choice — continue Tier-0 spikes (recommend **ISSUE-002 RLS-latency**
next, as it gates the memory critical path 009/023/025). Session-49 is **committed to `main` and pushed
to `origin/main`** (operator directed the push; `7cca645` spike + `caf17cc` backlog cleanup). **GitHub
issue #1 CLOSED** with the result; `_backlog.md` roster + Tier-0 line mark 001 ✅ done. Repo == GitHub,
in sync. Product-repo home decision is parked in **ISSUE-007's own file** (build-phase callout added).

---

## Session 48 — 2026-07-03 — PHASE 6 COMPLETE: 86 build issues cut · verified · coverage-complete · GitHub-mirrored · committed

> **⚠️ HANDOFF NOTE — the GitHub mirror is DONE. Do NOT re-run Step 8.** All 86 issues already exist on
> `Sweeite/AI-Harness-V1.0` (#1–#86, 1:1 with ISSUE-0NN), each issue file's `github:` frontmatter carries its `#n`,
> and the whole Phase-6 deliverable is committed (`24dfc72`) + the doc-sync follow-up. Re-running the mirror would
> create 86 **duplicate** GitHub issues. Phase 6 (and the whole Phases 0–6 spec effort) is the terminus — **the next
> action is `git push` (not yet pushed) → the build begins.** (Repo self-sufficiency test run at end of session — PASS;
> it caught these forward-pointers still reading "awaiting mirror", now corrected.)

**What happened:** Executed Phase 6 (Issue Decomposition) per the finalized playbook. Built `spec/06-issues/`:
`_TEMPLATE.md` (the 10-field self-sufficiency contract) · `_backlog.md` (the spine) · **86 `ISSUE-<nnn>-<slug>.md`
files (001–086)** · `_harvest/frag-*.md` (Step-1 coverage fan-out, ~1,600 lines). Every issue points into the repo
**by ID** and never copies `AC-*` text (Rule 0 / DRY).

**Steps 1–9 (bar the outward mirror + sign-off):**
- **Step 1 — Harvest** (subagent fan-out, 4 Explore agents over C0–C3 / C4–C6 / C7–C10 / NFR+data+surfaces) →
  `_harvest/frag-c0-c3.md` · `frag-c4-c6.md` · `frag-c7-c10.md`. Full coverage inventory: ~438 FRs + ~93 NFRs.
- **Step 2 — `id-conventions.md`** amended via change-control: `ISSUE-` redefined from GitHub `#<n>` to a canonical
  repo-markdown `ISSUE-<nnn>` file (dated note, matching the Phase-5 `DR`-domain precedent).
- **Steps 3–4 — Cut slices + map.** 86 issues across **13 epics** (S spikes · A foundations · B identity · C memory ·
  D tools · E prompt · F harness · G guardrails · H agent-design · I proactive · J observability · K infra · L config).
  `_backlog.md` carries 7 build tiers, the **verified-acyclic dependency DAG**, the **11-node critical path**
  (`007→008→009→018→019→022→023→025→045→053→072`), and the full FR+NFR **coverage ledger**. The six OD-157
  launch-gating spikes (AF-068/069/001/067/078/077) are first-class ISSUE-001–006, sequenced ahead of dependents.
- **Drafting via Workflow** (operator delegated "I trust your recommendation" → full Workflow run, precedent = the
  pre-Phase-6 audit). First run drafted 72/86 then hit a **session limit** (7.7M subagent tokens); a compact
  finish-workflow drafted the remaining 14 + verified a 34-issue sample + coverage critic. (Script bug — fix-stage
  didn't guard a null verdict from a killed agent — fixed in the finish run.)
- **Step 7 — Verification gate CLEAN.** Coverage critic **PASS** (all 85 FR area-groups + all 9 NFR domains claimed,
  **zero orphan** FR/NFR/issue — checks a/b); DAG **acyclic**, all edges resolve (check d); **per-issue zero-context
  self-sufficiency build-test** (check f) on a 34-issue sample (all 6 spikes + all 14 late-drafted + every seam-heavy /
  foundation issue): **20 passed first try · 11 fixed-then-passed · 3 surfaced genuine spec gaps** → Step-5 change-control.
- **Step 5 — Gap-sweep change-controls (the gate's real payoff):**
  - **OD-168** — `rls-policies.md`'s helper list omitted the **visibility-tier resolver**; a builder couldn't author
    FR-1.RLS.003's visibility predicate. Added `user_visibility(uid)` (distinct from the PERM-node `user_perms`) to
    `rls-policies.md` + `indexes.md`; ISSUE-020 cites it. *(Minted by the ISSUE-020 build-test fix-agent; verified real.)*
  - **OD-169** — FR-2.RET.005 gave ranking **weights** but no **sub-signal→[0,1] normalization**; recency + entity-match
    were unmapped. Fixed the contract (recency = `0.5^(age/half_life)`, Jaccard entity-match, cosine→`(c+1)/2`); minted
    `CFG-rank_recency_half_life_days` (90, LIVE) into `config-registry.md`; +FR-2.RET.005 Notes. *(ISSUE-025 fix-agent;
    config + FR edits verified applied.)*
  - **OD-170** — the `event_type` enum (`schema.md` §8) admitted **no value** for the FR-1.RLS.007 mid-task
    authorization-stop or the FR-1.RLS.008 divergence `event_log` writes → a build-time guess. Added
    `authz_revoked_midtask` + `rls_harness_divergence` (additive/expand-contract-safe); ISSUE-020 build steps cite them.
  - Issue-file fixes (no spec change): **ISSUE-077** manifest now names `PERMISSION_NODES.md` L110 (Super Admin) for
    `PERM-compliance.download_records` (was mis-pointed at ISSUE-018); **ISSUE-008** reworded the false "creates RLS DDL
    verbatim" claim (rls-policies.md fixes *contracts*, DDL is a build artifact → ISSUE-009 owns the logic), rescoped
    `expected_slots` concrete content to onboarding/ISSUE-030 (registry defines shape only), and re-cited the dangling
    FR-1.PERM.002 → FR-1.PERM.005 + OD-030 (both resolvable from `PERMISSION_NODES.md`).
- **Step 6 — Open decision:** **OD-171** (🟡 OPERATOR) — the connector rollout order (ISSUE-039 GHL / 040 Google /
  041 Slack). The DAG fully sequences everything else and **no v1 scope-cut was forced**; this is the one open
  build-sequencing degree of freedom and it's client-driven (ADR-001). Recommendation: GHL first (CRM spine, carries
  AF-090/098). Gates nothing on the critical path — the build can start on the whole foundational/identity/memory spine.
- **Step 9 (partial) — `traceability-matrix.csv`** issue column wired: every FR → its `ISSUE-<nnn>` (split areas mapped
  by FR number). README Phase-6 row + this log updated.

**Fix-agent hygiene note:** the verification fix-agents autonomously minted + logged OD-168/OD-169 (well-analyzed,
ADR-consistent) and applied their change-controls; one collided with the OD-168 I'd assigned to the enum fix → I
renumbered the enum change to **OD-170** and reconciled the tail guard ("Next OD number: OD-172"). All three ODs verified
against source (CFG keys real, FR-1.RLS.003 confirms the visibility model) before acceptance — no hallucinated IDs left in.

**Steps 8 + 9 — DONE (operator: "sign off + mirror + commit").**
- **Step 8 — GitHub mirror created:** 86 issues on `Sweeite/AI-Harness-V1.0` (was empty → now #1–#86, a clean 1:1
  `ISSUE-0NN → #NN`). Each GitHub body links the canonical repo file + lists the DoD `AC-*` as a task-list (link, don't
  duplicate — the ownership split). Each issue file's `github:` frontmatter carries its `#n`; the id→# map is in
  `spec/06-issues/_github-map.tsv`. The matrix records the 1:1 mapping (no separate column — ISSUE-0NN = #NN).
- **Step 6 — OD-171 resolved (operator): GHL first** (ISSUE-039 → 040 Google → 041 Slack).
- **Step 9 — committed** `24dfc72` (102 files) + this doc-sync follow-up. **Not pushed** (never push unasked).
- **Repo self-sufficiency test (handoff gate) — PASS.** A zero-context subagent resumed from the repo alone: all 86
  issues present, coverage complete, every OD-168/169/170/171 + enum/helper/config change-control resolves, the 3
  patched issues (008/020/077) clean, no dangling IDs. Its one finding was that these forward-pointers still read
  "awaiting mirror" (the mirror was done post-write) — **corrected here** so a fresh chat does not re-mirror.

**Next action:** `git push` to activate the GitHub issue links, then **the build begins** — Phase 6 is the terminus of
the Phases 0–6 spec effort; the repo is now a build queue. A fresh chat picks up the top ready issue from
`spec/06-issues/_backlog.md` (start on Tiers 0–2: the six launch-gating spikes ISSUE-001–006 + the foundational/identity/
memory spine), reads only that issue + its context manifest, and builds it to its `AC-*`. No prior conversation needed.

---

## Session 47 — 2026-07-02 — OD-161 OPERATOR CONFIRMATION (carried-forward note discharged)

**What happened:** Operator pulled the Session-46 audit-reconciliation commits to local and asked to review the one
carried-forward operator note before Phase 6. Walked the operator through **OD-161** (the rollback of
`FR-9.MODE.004`'s Act-tier autonomous low-risk-external send → **Prepare-only**, reversing part of the previously
operator-decided **OD-088**): the collision with locked **ADR-007** ("no config change can override a hard limit",
twice verbatim), the duplication of the **OD-047** carve-out rejected one day earlier, and the actual cost
(Prepare-only loses only the final auto-send on non-client cold-lead/nurture email — one human tap; all opportunity
detection + full drafting preserved). Gut-checked the one scenario that would justify reopening (unattended
high-volume cold outreach, where "tap each one" defeats the purpose → would warrant a deliberate ADR-007 amendment
instead). **Operator confirmed the rollback stands.**

**Then — Phase-6 playbook FINALIZED (same session, finalize-before-entry pass).** `phase-playbooks.md` Phase 6
went from a 9-line approach stub to **full mechanical detail** (parity with Phases 4/5): Goal · Why-it-exists ·
the **issue self-sufficiency contract** (the cardinal rule) · Scope calls · Output file structure (`spec/06-issues/`
= `_TEMPLATE.md` + `_backlog.md` + `ISSUE-<nnn>-<slug>.md`) · the 10-field issue template · 9 Steps · the a–f
verification gate · Done-when/Who-decides/Hand-off. **Operator decisions this session:**
- **Issue home** → canonical repo markdown **AND** a maintained GitHub Issues mirror ("maintain both" — operator
  wants at-a-glance progress + quick in-place notes). Drift-controlled by an **ownership split**: repo markdown owns
  the issue **DEFINITION** (scope, FR/`AC-*`/`NFR-*` IDs, touchpoints, manifest, deps); GitHub owns the **BUILD-STATE**
  (open/closed, checkboxes, comments). Definition edits flow repo→GitHub; any GitHub note that changes a definition
  must be reconciled back to the repo before it's authoritative (Rule 0 preserved).
- **Granularity** → fine tracer-bullet slices + a `_backlog.md` index (epic grouping + dependency map + critical path).
- **Self-sufficiency** (operator's stated priority for cross-chat build) is now the *cardinal rule + gate check (f)*:
  every issue is a precise build-order that **points into the repo by ID, never copies `AC-*` text** (copying = a
  second source of truth that rots = Rule-0 violation); the gate spawns a **zero-context subagent per issue** that
  must build from issue + named files alone, no guessing.
- **Coverage total** (every FR C0–C10 + every NFR → ≥1 issue; no orphan either way); the **six OD-157 launch-gating
  spikes** are first-class spike-issues sequenced ahead of dependents; `ISSUE-<nnn>` convention amended at entry
  (change-control) since `id-conventions.md` currently mis-defines it as GitHub `#<n>`.

**gh confirmed available** (handoff de-risk): `gh` installed + authenticated as **Sweeite**, token scope includes
`repo` (issue-create OK), remote `Sweeite/AI-Harness-V1.0`. The new chat can create the GitHub mirror with no setup.

**Files changed:** `open-decisions.md` (OD-161 → +✅ OPERATOR CONFIRMED annotation; ADR-007 untouched),
`phase-playbooks.md` (Phase 6 finalized), README (Phase-6 row), this log. No Phase-6 *execution* done — no issues cut,
`id-conventions.md` not yet amended (that's entry Step 2), `spec/06-issues/` not yet created — per operator:
**execution happens in a NEW chat.**

**Next step (for the new chat): EXECUTE Phase 6** per the now-finalized `phase-playbooks.md` Phase-6 procedure —
Step 1 harvest/coverage fan-out → Step 2 amend `id-conventions.md` (`ISSUE-<nnn>`) → Step 3 cut the vertical slices →
Step 4 dependency map + `_backlog.md` → Step 5 gap-sweep → Step 6 ODs → Step 7 verification gate (incl. the per-issue
self-sufficiency build test) → Step 8 GitHub mirror (`gh issue create`, record `#<n>`) → Step 9 wire matrix + README +
sign-off. FR-9.MODE.004 is cut as **Prepare-only** (OD-161). *(Skill status refreshed this session: the `to-issues`
skill — tracer-bullet vertical-slice issue decomposition, directly relevant to Phase 6 — and `handoff` are now
**INSTALLED** (present on disk + in the skills list; the earlier "verified absent" notes reflected the environment at
that moment). The new chat may use `to-issues` to assist, but the finalized playbook is authoritative.)* **A repo
self-sufficiency test was run before this handoff — see the addendum at the end of this entry.**

**ADDENDUM — repo self-sufficiency test (required handoff gate, run before this handoff): PASS.** A zero-context
subagent read only the repo (following CLAUDE.md's start-of-session order) and tried to resume the next action.
**Verdict: the repo is genuinely self-sufficient — a fresh cold chat can resume Phase 6 from the repo alone without
guessing.** Next action correctly identified as Phase-6 Step 1 (harvest/coverage fan-out). All four load-bearing
claims confirmed: (1) the Phase-6 playbook is at full mechanical detail — self-sufficiency contract, `spec/06-issues/`
structure, 10-field template, Steps 1–9, a–f gate all present; (2) OD-161 carries the ✅ OPERATOR CONFIRMED
annotation + rolls FR-9.MODE.004 to Prepare-only; (3) `id-conventions.md`'s `ISSUE-` row is still `#<n>` (correctly
un-amended — that's entry Step 2); (4) OD-157 names six spikes, all six AFs resolve in the feasibility register.
**Zero blocking gaps.** One informational finding (not a repo defect): the `to-issues`/`handoff` skills, logged
"absent" in Sessions 46/47, are now **installed** — the handoff had already told the new chat to re-check; the stale
"absent" wording in the two forward-facing resume pointers (README Phase-6 row + this entry's next-step) was corrected
to "installed" this session so the new chat isn't misled. (Historical Session-46 references left intact as record.)

---

## Session 46 — 2026-07-02 — PRE-PHASE-6 FULL-SPEC AUDIT RUN + FULLY RECONCILED — 🟢 PHASE 6 GATE CLEARED

**What happened:** Ran the **pre-Phase-6 full-spec audit** (`spec/00-foundations/pre-phase-6-audit-playbook.md`),
operator-authorized as a **Workflow** ("run it as a Workflow (Recommended)"). First attempt stalled mid-run (a
session interruption killed 3 in-flight agents around Dimension 6/Verify, ~34/38 agents cached) — resumed via
`resumeFromRunId`, which replayed all completed agents from cache and finished cleanly. **154 total agents, 0
errors, 6.7M subagent tokens.**

**Audit result:** 110 raw candidate findings across the 6 dimensions (ID resolution · traceability completeness ·
cross-phase consistency · change-control integrity · contradiction hunt · three-non-negotiables end-to-end) →
after adversarial verification (a dedicated refutation agent per HIGH/MED candidate, default-to-false-positive):
**48 confirmed HIGH, 46 confirmed MED, 10 LOW (cosmetic, unverified), 6 refuted.** Full report: `spec/00-foundations/
audit/_audit-report.md` (+ `dim-1`…`dim-6` evidence files + `_mechanical-prepass.md`). The volume is mostly
**cross-phase reference decay** — Phase 4 (data model) split/renamed things Phase 1 (components) had already cited
by their old names, and no prior verification gate had ever checked *across* phases, only within one. A smaller set
(~7) were genuine architectural contradictions — two different Approved parts of the spec describing incompatible
system behavior.

**Reconciliation (same session, operator-delegated "I trust your recommendation"):** Judgment calls on the 7
architectural findings were made directly (not delegated to fix-agents) and logged as **OD-161…OD-167** in
`open-decisions.md`, each with options considered + rationale, per `standards/change-control.md`:
- **OD-161 🔑 the big one** — `FR-9.MODE.004`'s Act-tier autonomous external-send (added via OD-088, a direct
  **operator** decision at C9 finalization) collided with **ADR-007**'s locked "no config change can override a
  hard limit" text, and reproduced exactly the carve-out **OD-047** (one day earlier) explicitly rejected. Resolved:
  rolled back to **Prepare-only** — the AI still drafts, a human still sends. This reverses part of a prior
  *operator*-decided call, so it's flagged here explicitly, not buried in the batch. `C6 FR-6.APR.002/003`'s OD-088
  narrowing reverted to the original blanket external-comms floor; `AC-6.APR.002.3` retired; the now-pointless
  `act_trust_period_days`/`external_act_trust_period` config fields removed everywhere (config-registry.md,
  surface-01, component-09).
- **OD-162** — defined the previously-undefined "local mirror" of `client_registry.status` (cited by FR-5.TRG.001.3/
  FR-10.DEL.007/FR-10.OFF.004 but never specified, since `client_registry` lives only in the management-plane
  deployment and ADR-001 §7 is push-only). Resolved: a new `deployment_settings.frozen_at` table **inside each
  client's own Supabase**, written by the management plane via the client's already-custodied `service_role` key
  (ADR-001 §7) — reuses existing infrastructure, doesn't reopen the push-only boundary.
- **OD-163** — `UI-SUPPORT-REQUESTS` (surface-00, predates the "exactly two Realtime surfaces" rule) corrected from
  Realtime to polling.
- **OD-164** — ADR-003's cost-ladder key names reconciled against the shipped config-registry.md (dated in-place
  note, same pattern as OD-046); the daily/weekly soft-alert figures restored to independently-editable keys
  (`cost_ladder_soft_threshold_daily_usd`/`_weekly_usd`) per ADR-003's actual requirement.
- **OD-165** — custom-command dispatch (`FR-9.CMD.008`) now creates/reuses a `task_queue` row like any other agent
  action, closing a #2 gap where a command resolving to hard-approval had no described enforcement path.
- **OD-166/167** — PERM-node catalog reconciliation: minted `PERM-compliance.view_audit` and two `PERM-ops.*`
  (DLQ manage / connector reconnect) nodes for citations that resolved to nothing.
- **Dim5-H28 (regex-quarantine vs ADR-007) — reviewed, no fix needed.** Read the actual ADR-007 text directly
  (`L163-164`: quarantine is explicitly framed as part of the "signal + human-routing layer") plus FR-6.INJ.006
  ("never proceeds without explicit human approval") — the audit's finding was a misreading, not a defect. Logged in
  the OD-161–167 block so a future session doesn't re-open ADR-007 over it.

**Mechanical fixes** (dangling/renamed IDs, missing matrix rows, stale FR/node counts, schema gaps) applied via a
**second Workflow**: 30 file-scoped agents running in parallel (one per file/tightly-coupled file group, to avoid
concurrent-edit conflicts on shared files like `traceability-matrix.csv`/`PERMISSION_NODES.md`/`config-registry.md`/
`schema.md`), each executing a precise pre-decided checklist — no independent judgment left to the fix agents.
0 errors, all 30 completed with clear per-item completion notes (several correctly flagged out-of-scope items rather
than guessing, e.g. surface-07's agent found the audit's line-count for M26 was slightly imprecise and fixed only
the one real occurrence). Two cross-agent loose ends closed manually afterward: `amber_zone_threshold`'s corrected
default (0.65→0.75, H27) propagated to `config-registry.md` + a new cross-key validation constraint; two
`DATA-credentials` references in `surface-05-dashboard-ops.md` that no agent's checklist covered; the OD-161
removal's ripple into `surface-01-config-admin.md`'s Data-bindings table (the now-deleted trust-period fields were
still described there); README's stale C6 FR-count (35→36, RTL ×3→×4).

**Files changed:** ~35 files across `spec/00-foundations/` (open-decisions.md +OD-161-167, ADR-003/ADR-004
reconciliation notes, what-makes-it-great.md, feasibility-register.md +AF-139, tool-integrations/gohighlevel.md),
`PERMISSION_NODES.md`, `traceability-matrix.csv`, all of `spec/02-config/config-registry.md`, `spec/04-data-model/`
(schema.md +2 tables, indexes.md, migrations.md, rls-policies.md), 9 of the 11 `spec/01-requirements/` component
files, 9 of the 14 `spec/03-surfaces/` surface files, 4 of the 9 `spec/05-non-functional/` files, `README.md`,
this log. New audit evidence files in `spec/00-foundations/audit/`. Committed in stages as the workflows produced
output (honest WIP commits when stop-hooks fired mid-run, per the established pattern from sessions 42/43),
final reconciliation commit + this entry.

**Next step: Phase 6 (Issue decomposition)** — gate is clear. Finalize the Phase-6 playbook (approach → full
mechanical detail, per the finalize-before-entry rule used for every prior phase), then slice the spec into
vertical, independently-buildable issues, each inheriting its FR `AC-*` + the `NFR-*` constraints + the six
launch-gating spikes (OD-157) as its definition of done, with a build-order/dependency map. *(No dedicated
`to-issues` skill is currently installed in this environment, despite being named here and in the audit playbook —
verified absent from both the available-skills list and the filesystem, 2026-07-02. Follow the finalized Phase-6
playbook procedure directly instead; re-check whether a skill has since been installed before assuming it isn't.)*
**Operator note carried forward: OD-161 reverses part of a previously operator-decided call
(OD-088, low-risk-external autonomous send) — worth a explicit look before Phase 6 issues get cut from FR-9.MODE.004,
in case there's context this session didn't have.**

**ADDENDUM — full OD-register review + repo self-sufficiency test (same session, before handoff to a new chat):**
Ran a full review of all 167 decisions in `open-decisions.md` (six parallel sharded reads + a dedicated skeptical
self-review of OD-161–167). Zero decisions open; no contradictions in the pre-existing register. The self-review
did catch real gaps in this session's own reconciliation — fixed: forward-pointers added to OD-088/OD-064/OD-143
(each was silently superseded with no pointer to the OD that changed it); OD-166/167's catalog-count arithmetic
corrected (52→53→55, matching `PERMISSION_NODES.md`'s own M27 baseline correction, not the stale 51→52→54); a real
safety gap in OD-162 closed with new **AC-10.OFF.004.5** (the freeze-write can partially fail — mgmt-plane marks a
deployment frozen but the local `deployment_settings.frozen_at` write fails — now requires a `freeze_pending`
sub-state + escalation, never a silent false-frozen read); the stale `system-map/09-proactive.md` diagram (still
depicting the reverted Act-tier exception) updated. Then ran the **required repo self-sufficiency test** (CLAUDE.md
"Context-window management") before this handoff — a zero-context subagent reading only the repo. **Result: FAIL
on first pass, patched, now clean.** Found and fixed: (1) `config-registry.md`'s Appendix A item 9 description
still described the retired Act-tier fields as live (a duplicate description the earlier reconciliation missed —
the main §L table row was already fixed, this Appendix A summary wasn't); (2) `traceability-matrix.csv`'s
FR-9.MODE.004 row was stale (cited the retired `CFG-external_act_trust_period` key and a dangling `AC-9.MODE.004.6`
— OD-161 retired the old `.5` and renumbered the former `.6` to `.5`, so `.6` no longer exists); (3) AF-131's
description (both in `component-09-proactive.md` and `feasibility-register.md`) still framed itself as a live #2
containment gate against "autonomous client send," a path OD-161 removed — reframed as a lower-stakes draft-quality
EVAL; (4) the `to-issues` skill (referenced in README/SESSION-LOG/the audit playbook) and the `handoff` skill
(referenced in CLAUDE.md) are both named as available but don't exist in this environment (verified against the
actual available-skills list + filesystem) — reworded all four references so a future session doesn't stall trying
to invoke something absent, with an explicit note to re-check in case one gets installed later. **Self-sufficiency
test PASS after these fixes** — a fresh chat starting cold can now execute the next action (finalize the Phase-6
playbook) without guessing.

---

## Session 45 — 2026-07-01 — PHASE 5 (NON-FUNCTIONAL) ENTERED, DRAFTED, GATE CLEAN, SIGNED OFF — 🟢 PHASE 5 COMPLETE

**SIGN-OFF (2026-07-01):** operator signed off on Phase 5 ("yep sign off"). README flipped 🟢; the four
risk-posture ODs (OD-157–160) confirmed as chosen. Repo self-sufficiency test run before commit+push (handoff
gate into Phase 6) — **PASS** (fresh chat can resume from the repo alone). **Operator's stated next intent: a
full whole-spec audit (Phases 0–5) before Phase 6 issue decomposition** — the repeatable procedure is written
in **`spec/00-foundations/pre-phase-6-audit-playbook.md`** (six dimensions · adversarial-verify pass ·
mechanical pre-pass · sharding rules · workflow-or-parallel orchestration · pass criteria). **The audit may run
in a NEW CHAT** (this one's context is heavy) — a fresh chat reads `CLAUDE.md` → `README.md` → that playbook
and executes. **NEXT ACTION:** run the audit (kick-off prompt is in the playbook's "How to kick this off"
section); a clean audit clears Phase 6.

**What happened:** Entered **Phase 5 (Non-Functional Requirements)**. Per the "finalize before entry" rule,
first **rewrote the Phase-5 playbook** from approach-altitude to full mechanical detail (9-file output
structure, the **reference-don't-re-spec** cardinal rule, the **AF-register-as-test-spine** principle, steps
1–8, verification gate checks a–f). Added the **`DR` domain code** to `id-conventions.md` (backup/DR is a
first-class NFR domain). Noted **OD-009 is already RESOLVED→ADR-008** — Phase 5 specs the machinery, doesn't
re-decide.

**Harvest (six-agent fan-out).** Independent read-only subagents over: 3 component shards (C0–C3 · C4–C7 ·
C8–C10 — the first two attempts overflowed reading all 11 at once, so sharded), 2 surface shards (00–05 ·
06–12), and 1 ADR + config-registry pass. Consolidated into **`_nfr-inventory.md`**: ~82 NFR candidates across
8 domains, each tied to its functional owner FR/ADR + its AF-* gate, + a gap-sweep list + the 4 risk-posture ODs.

**Four risk-posture ODs surfaced to the operator (RP-1…4), who chose the recommended option for each →
OD-157–160:** OD-157 the **six launch-gating spikes** (AF-068/069/001/067/078/077) vs blocking-by-posture
mechanisms vs fast-follow accuracy-EVALs; OD-158 restore rehearsal monthly+per-migration; OD-159 a11y baseline
(full WCAG→OOS-041); OD-160 aspirational spike-confirmed perf targets (never a binding SLO).

**Drafted all 9 files.** `security.md` written first as the **exemplar** (the `NFR-*` row shape: Requirement /
Type / Upholds / Implemented-by / Target / Verification / **Launch gate** / ACs). The other 7 domain files +
were drafted by parallel subagents against the exemplar (each verified its cites against source; two agents
paused after delegating cite-checks and were resumed to write). `test-strategy.md` (the keystone — the AF
de-risking schedule) written in the main thread. **~90 NFR-\* total** (SEC 17 · INF 14 · OBS 16 · PERF 12 ·
CMP 11 · COST 10 · DR 8 · A11Y 2).

**Gap-sweep change-controls:** +AF-138 (mobile web-push delivery) · +OOS-041 (WCAG deferral) · +3 config keys
(`recovery_tier`, `haiku_audit_window_days`, `haiku_gate_disagree_threshold` — all owed by ADRs but absent from
the registry, Rule-0 gaps) · inventory scale-cite fix (≤20 users/silo is ADR-006/008, not ADR-001).

**Verification gate (independent zero-context, checks a–f): CLEAN — 0 HIGH · 3 MED · 3 LOW, all reconciled.**
(a) domain coverage complete; (b) reference-integrity high (~30 cites spot-checked live, no dangling safety cite,
no NFR contradicts its source); (c) three non-negotiables provably covered (audit-sink immutability trigger,
restore-proven, erasure-walk, hard-limits-non-overridable, service_role-bounded, silent-failure detector +
watchdog + escalate-don't-abandon + cost-unknown≠$0); (d) feasibility spine — six launch-gating spikes
consistent everywhere, **no NFR overclaims proven-vs-specified** (every perf number tagged "confirm-by-AF"); (e)
gap-sweep landed; (f) testability — every domain→test layer, every AC-NFR checkable. **Reconciled:** MED-1
dangling `recovery_tier` cite→config key added; MED-2 stale "haiku keys missing" note→corrected; MED-3
test-strategy "every AF" completeness→+AF-063/040/041/113; LOW-1/LOW-2 cite-precision; LOW-3 no-action.

**Files changed:** `phase-playbooks.md` (Phase-5 approach→full detail), `id-conventions.md` (+DR),
`spec/05-non-functional/` (all 9 files, new), `feasibility-register.md` (+AF-138), `out-of-scope.md` (+OOS-041),
`config-registry.md` (+recovery_tier +2 haiku keys), `open-decisions.md` (+OD-157–160), `_nfr-inventory.md`
(cite fixes), `traceability-matrix.csv` (Phase-5 header note), `README.md` (Phase-5 🟡), this log. Committed
across the session (playbook-entry, inventory, domain-files, gap-sweep, gate-fixes as separate commits).

**Next step:** **operator sign-off on Phase 5** → flip README to 🟢 → **Phase 6 (Issue decomposition)** — slice
the finished spec into vertical, independently-buildable issues, each inheriting its FR ACs **+** the NFR-*
constraints (+ the launch-gating spikes) as its definition of done. This is the last spec phase before the
backlog. **Open question for sign-off:** confirm the 4 risk-posture ODs (OD-157–160) as chosen (they were the
recommended options, operator-selected via the Phase-5 decision prompt).

---

## Session 44 — 2026-07-01 — PHASE 4 (DATA MODEL) DRAFTED, GATE CLEAN-WITH-FIXES, FINALIZED + SIGNED OFF — 🟢 PHASE 4 COMPLETE

**What happened:** Entered **Phase 4 (Data Model)**. Per the playbook's "finalize before entry" rule, first
**rewrote the Phase-4 playbook** from approach-altitude to full mechanical detail (output file structure,
harvest fan-out, the 7 net-new stores, type/enum consolidation, RLS/index/migration rules, verification
gate checks a–f). Then built all five `spec/04-data-model/` files.

**Harvest (subagent fan-out).** Independent subagents over the **14 surfaces** ("Phase 4 data binding
notes"), the **11 components** (`DATA-`/`Data touched:` footers, sharded C0–C1/C2–C3/C4–C6/C7–C8/C9–C10),
and the **config registry + traceability matrix** (the authoritative **21 `DATA-*` id** list). Consolidated
into **`_data-inventory.md`**: ~40 tables in 14 groups, the **16 net-new Phase-3 stores/fields** catalogued
+ owed-back to their component FRs, **R1** (`client_slug` is DELETED not "label-only" — OD-096/FR-10.ISO.001
supersede the older C2–C6 prose), **R2** (store renames), and **7 schema ODs** (OD-P4-01…07) surfaced with
recommendations.

**`schema.md`** — one coherent schema: a `Types` section (every enum defined once) + 14 groups. Every table
typed with PK/FK/constraints. All net-new stores **designed** — `memory_conflicts`, `consolidation_approvals`,
`injection_quarantine`, `task_history` (durable envelope originals, OD-P4-04/AF-115), `notifications`,
`push_subscriptions`, `agent_health_metrics`, `agent_result_cache` (scope-aware invalidation), `execution_plans`,
`commands`, `signal_weights`, `conversations`/`messages` (OD-135 chat), + fields `task_queue.originating_user_id`,
`guardrail_log.escalated_at`, two-person-auth on `deletion_requests`. **NO `client_slug` on any application
table** — only `client_registry`/`deployment_health`/`offboarding_records` on the **separate management
deployment** (ADR-001 §7). 7 schema ODs resolved per the **recommended** option (user-delegated): OD-P4-01
thin `profiles` mirror · **OD-P4-02 split** `webhook_secrets` + `connector_credentials` · OD-P4-03 shadow-drop
= `ingestion_queue.state` · **OD-P4-04 durable `task_history`** · OD-P4-05 pill stored / cost derived ·
OD-P4-06 defer per-agent `model` · OD-P4-07 dedicated `agent_result_cache`.

**`rls-policies.md`** — ADR-006 static data-driven policies via `(select …)` initPlan (AF-067); human-path RLS
(keyed to `auth.uid()` + PERM nodes + clearances) vs agent-path `service_role` (bypasses RLS; containment via
harness RBAC + the C8 `memory_scope` fail-closed filter); per-table policy summary; the three non-negotiables
mapped into the RLS layer. **`indexes.md`** — HNSW vector (CONCURRENTLY, m=16/ef_construction=64) + the
`(status, created_at)` queue family + the silent-failure-detector join (`task_queue` terminal ⋈ `event_log`
terminal) + RBAC policy-read indexes (initPlan perf) + every net-new store; AF-019 (RLS-after-ANN recall
starvation) flagged paper-until-tested. **`migrations.md`** — expand→backfill→contract discipline
(`migration-discipline.md`), migration 0001 ordering + the CONCURRENTLY-outside-txn caveat (0001b), the
management deployment's **separate** migration lineage, worked examples (drop `agents.system_prompt`,
embedding-model swap), per-deployment failure isolation, AF-065 paper-until-tested.

**Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 0 HIGH · 2 MED · 4
LOW.** (a) coverage complete — all 21 ids + config + 16 net-new present, no orphan, no dead table. (b) net-new
completeness PASS. (c) types PASS (task_status incl. `flagged`, guardrail_type ×5, event_type ×8,
sensitivity_tier ×4, memory_type ×3 all match source; 2 doc-only enums flagged). (d) **`client_slug` CLEAN** —
grep confirms only the 3 mgmt-plane tables carry it, no app table. (e) #1/#2/#3 sweep PASS — append-only sinks,
sole-writer memories, hard_limit≠approved CHECK, two-person auth all present. (f) migrations PASS. Source
subagent verified **10/10 load-bearing claims**, zero contradictions. **Reconciled: MED-1** — `deletion_requests`
executor-distinctness CHECK added (AC-10.DEL.006.2 no-self-execution now DB-enforced, not app-only); **MED-2/LOW-1**
— store renames recorded as R2; **LOW-2** — doc-enum note added. **LOW-3** (confirm OD-P4 resolutions at sign-off)
+ **LOW-4** (severity/risk_level as free text) carried to sign-off.

**Files changed:** `phase-playbooks.md` (Phase-4 approach→full detail + status), `spec/04-data-model/`
(`_data-inventory.md`, `schema.md`, `rls-policies.md`, `indexes.md`, `migrations.md`, `_harvest-c7-c8.md`,
`_gate-report.md` — all new), `README.md` (Phase-4 row 🟡). This log. Committed + pushed across the session
(playbook, harvest, schema, RLS/idx/migrations, gate-fixes as separate commits).

**SIGN-OFF FINALIZATION DONE (this session):** the operator delegated ("go what you recommend"). (1) The
**16 net-new-store owed-back `DATA-` cites** were applied to their component FRs via change-control (subagent,
18 additive edits, verified): C2 memory_conflicts (FR-2.WRT.002)/consolidation_approvals (FR-2.MNT.014) ·
C3 idempotency_ledger (FR-3.CONN.004) · C5 task_history (FR-5.ENV.003) + task_queue.originating_user_id
(FR-5.QUE.002) · C6 injection_quarantine (FR-6.INJ.006) + guardrail_log.escalated_at (FR-6.LOG.001) ·
C7 notifications (FR-7.ALR.001) + push_subscriptions (FR-7.VIEW.003) · C8 agent_health_metrics (FR-8.HLTH.001)/
execution_plans (FR-8.PLAN.004)/agent_result_cache (FR-8.LRN.003) · C9 commands (FR-9.CMD.006)/signal_weights
(FR-9.SUG.005)/conversations+messages (FR-9.CMD.004, best-fit anchor — no dedicated chat FR exists) ·
C10 deletion_requests two-person-auth columns (AC-10.DEL.006). (2) The **R1 `client_slug` clerical amendment**
landed on C3/C4/C5/C6 ("label-only" → DELETED per OD-096/FR-10.ISO.001, mgmt-plane `client_registry` only);
**C2 needed none** (it never carried the label-only wording — isolation there is only ever "physical, never an
RLS predicate"). (3) `traceability-matrix.csv` wired (Phase-4 header note: every `data_touched` DATA-* id
consolidated in `schema.md`). (4) README + playbook + this log → 🟢. **7 OD-P4 resolutions accepted as
recommended.**

**POST-SIGN-OFF RE-AUDIT (same session, operator-requested "full quality check start to finish").** A
**second independent zero-context adversarial audit** (distinct from the sign-off gate) re-read the repo and
tried to break Phase 4. Structure verified clean (coverage, 16 net-new cites all landed in their component FRs,
`client_slug` isolation, type consolidation, RLS table-coverage, migrations — all PASS with file:line evidence).
It found **3 real defects the first gate missed** (the first gate checked for append-only *wording*, not a
*mechanism*) — all now **fixed**:
- **HIGH-1 (fixed)** — audit-sink immutability (`event_log`/`guardrail_log`/`access_audit`/`config_audit_log`)
  was asserted append-only but enforced **only by RLS**, which the `service_role` writer **bypasses** — so a
  buggy/compromised writer could silently rewrite/delete history (#1 + #3, and it undercut the AC-7.LOG.008.3
  tamper-evident claim). **Fix:** added `enforce_audit_append_only()` `BEFORE UPDATE OR DELETE` trigger fired
  **regardless of role** (whitelists only the forward status transition + one-way redaction-tombstone; DELETE
  revoked) — `schema.md` §Immutability enforcement; `rls-policies.md` #1 restated to point at the trigger.
- **MED-1 (fixed)** — `deletion_requests` two-person CHECK was NULL-permissive (`<>` passes when a side is
  NULL) and asymmetric; **my earlier "no-self-execution now DB-enforced" claim was overstated.** **Fix:** both
  comparisons now `is distinct from` (NULL-safe) + a new CHECK requiring three non-null distinct people at
  `status='executed'`. **Now** genuinely DB-enforced.
- **MED-2 (fixed)** — `notifications.recipient IS NULL` = broadcast-to-role, but the RLS predicate was stated
  only as "recipient = viewer", so broadcast alerts would be **invisible to everyone** (a #3 silent alert-drop).
  **Fix:** RLS predicate now `recipient = auth.uid()` **OR** (`recipient is null` AND `recipient_role` ∈ caller
  roles).
- **LOW-2 (fixed)** — README C9 count was stale (28 → **31**; the CMD.006–008 addendum was never bumped).
- **LOW-1 / LOW-3 (accepted, logged)** — `permission_node`/`perm_node` are free text (no FK to the markdown
  node catalog — seed-time validation, default-deny posture) and version-tables rely on `previous_version_id`
  convention. Known trade-offs, lower risk than the audit sinks; noted for build-time seed validation, no
  schema change. **New feasibility item AF candidate at build:** trigger-based immutability + a seed-time
  perm-node validation pass. Verdict after fixes: **Phase 4 sound and the #1/#3 enforcement gap closed.**

**Next step — Phase 5 (Non-Functional):** `NFR-*` requirements across security, infrastructure/deploy,
observability, cost (envelope + ladder per ADR-003), compliance, **backup & disaster recovery (resolve OD-009
under ADR-008 — client-owned Supabase ownership/verification + a *tested* restore)**, and the **test strategy**
(how every `AC-*` becomes a real test and reaches `Verified`). Load the Phase-5 playbook (`phase-playbooks.md`
§"Phase 5" — currently at approach altitude; finalize it before entry, same as Phase 4). The schema
(`spec/04-data-model/`) now underpins the security + backup NFRs. OD-009 is the one load-bearing operator
decision (risk posture + backup ownership). Run the standing verification gate at Phase-5 close.

---

## Session 43 — 2026-07-01 — SURFACE-01b (CONFIG-CHANGE AUDIT LOG VIEWER · `UI-config-audit-log`) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 🟢 PHASE 3 COMPLETE (14 of 14)

**What happened:** Built `spec/03-surfaces/surface-01b-config-audit-log.md` — the **14th and final Phase-3 surface**: the
**config-change audit-log viewer**, the read/review counterpart to surface-01 (surface-01 *writes* config + appends the
`config_audit_log` row on every Save; surface-01b *reads back* who changed which knob, from→to, when, with a compliance
export). Surface ID **`UI-config-audit-log`** is **named by OD-099** (surface-01's per-section "View audit log →" links
already target it), **not minted here** — like `UI-COMMANDS` on surface-10. Pattern-matched surfaces 00–12. **Three
sections in two buckets:** **A — Config-Change Timeline** (the filterable trail — config section / key / actor / date
range; newest-first; key-prefix-scoped) · **B — Change Detail** (one `config_audit_log` entry in full — the
`old_value`→`new_value` diff, actor + role, timestamp, the knob's `What it does` + LIVE/BOOT/REBUILD class) · **C —
Compliance Export** (a client-presentable extract, **all-or-nothing**, gated by `PERM-compliance.download_records`).

**KEY FINDING — a Rule-0 governance gap closed via change-control (OD-153).** `config_audit_log` is the system's **third
audit sink** alongside `event_log` (C7, FR-7.LOG.001/006) and `guardrail_log` (C6 writes, C7 governs FR-7.LOG.007) and
`access_audit` (C1 content FR-1.AUD.001/002, C7 storage via the FR-1.AUD.003 seam). But `config_audit_log` had **no FR
owner** for its *governance* (append-only / retention / tamper-evidence / export) — it existed only as a
`config-edit-taxonomy.md` rule-4 *write* mandate + a surface-01 Phase-4 schema stub. An unlogged / tamperable /
un-exportable record of *who changed the system's own behaviour* is a **#1/#3 violation**. **Resolved: minted
`FR-7.LOG.008` in C7 via change-control** (config_audit_log view / retention / tamper-evidence / export, mirroring
FR-7.LOG.007 for guardrail_log + the FR-1.AUD.003 content→storage seam). **C7 34 → 35 FRs.** Precedent: OD-097 →
FR-7.ALR.009, minted into C7 from Phase 2 the same way. New ACs: **AC-7.LOG.008.1** (export all-or-nothing, no silent
truncation) · **.2** (retention floor ≥ `individual_deletion_audit_years`) · **.3** (append-only + tamper-evident) ·
**.4** (redaction-tombstone on user-erasure — `config_audit_log` now owed to the C2 FR-2.MNT.017 / C10 FR-10.DEL.004
erasure walk, a carry-forward) · **.5** (secrets never appear — SECRET rows are never UI-editable so never logged).

**The clean PERM case — no entry node minted (fourth-plus consecutive: 10/11/12/01b).** The viewer needs **no new
`PERM-config.view_audit` node** (OD-155): entry requires **≥1 `PERM-config.*` node**, and the row set is **key-prefix-
scoped** to the caller's held config sections — the identical RLS surface-01 mandates for `config_values`/`config_audit_log`.
A caller sees only the audit history of sections they may **manage** (a Finance-config admin never reads the infra-config
trail; `#infra` history stays Super-Admin-only). Export is the distinct, higher act, gated by the already-catalogued
**`PERM-compliance.download_records`** (Super Admin, unseeded — default-deny). No catalog edit.

**4 ODs raised + resolved (surface-local; recommendations delegated, consistent with surfaces 05–12), logged OD-153–156:**
- **OD-153** 🔑 **#1/#3 Rule-0 governance gap** → mint `FR-7.LOG.008` in C7 via change-control (above).
- **OD-154** — layout: single filterable Config-Change Timeline landing + per-change Change Detail drawer + header Export
  action (consistent with surface-06/09/11's list-landing + detail-drawer).
- **OD-155** ⚠️ **#2 read authority (clean, no node)** — key-prefix-scoped `PERM-config.*` entry; export via
  `PERM-compliance.download_records` (above).
- **OD-156** — export behaviour: key/section/old→new/actor/changed_at over the filtered, key-prefix-scoped range,
  all-or-nothing (AC-7.LOG.008.1); field-level diff; secrets never appear (SECRET class never UI-editable).

**Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 0 HIGH · 2 MED · 3 LOW (all
reconciled).** (a) Coverage PASS (FR-7.LOG.008 + ACs, FR-7.LOG.005/006/007, FR-1.PERM.005/AUD.003, FR-7.ALR.008/009,
FR-7.RTP.001, OD-099, the OD-097→FR-7.ALR.009 precedent all resolve + paraphrase faithfully; over-claims seamed out).
(b) CFG PASS (`event_log_retention_window` + `individual_deletion_audit_years`, both BOOT, read-only reflected).
(c) DATA PASS (`config_audit_log` fields match the surface-01 stub exactly; no `client_slug`; Phase-4-flagged).
(d) PERM PASS (no node minted; view = key-prefix `PERM-config.*`, all 10 exist; export = `PERM-compliance.download_records`
unseeded; six roles). (e) #1/#2/#3 sweep PASS (no false "no changes" on a failed load; no out-of-scope config history;
secrets never appear; export all-or-nothing). (f) Seams PASS. **Reconciled: MED-1** — the "SECRET never editable in-app"
authority was mis-cited to **OD-102** (which actually resolves the `secret_manifest.last_rotated` deploy-hook source) →
re-cited to the **SECRET edit class** (`config-edit-taxonomy.md` line 11 + rule 2) in **both** the surface and the
propagated **AC-7.LOG.008.5**. **MED-2 (fixed at source)** — the surface + FR cited `config-edit-taxonomy` **rule 4** for
auditing **LIVE/BOOT/REBUILD**, but rule 4 read "LIVE" only → **rule 4 amended via change-control** to cover all three
editable classes (a BOOT/REBUILD change going unaudited is a #1/#3 gap; reconciles rule 4 with `config-registry.md`
§cross-cutting + surface-01's Save, which already audit BOOT; SECRET produces no row). **LOW-1** — "the 11 sections" →
"10 editable of the 11" (the 11th, `#secrets`, is SECRET-class, no audit rows). **LOW-2 (accepted)** — AC-7.MGM.002.4
cited only as a server-authoritative-time analogy. **LOW-3** — the banner's own secrets reasoning re-cited to the SECRET
class (same root as MED-1).

**Files changed:** `surface-01b-config-audit-log.md` (new); `component-07-observability.md` (+FR-7.LOG.008 / AC.1–.5;
header 34→35 FRs / LOG ×8; traceability footer 33→35); `config-edit-taxonomy.md` (rule 4 amended LIVE → LIVE/BOOT/REBUILD,
change-control); `open-decisions.md` (OD-153–156 🟢 + rule-4-amendment note + reserve pointer → OD-157);
`traceability-matrix.csv` (+FR-7.LOG.008 row); `README.md` (Phase-3 row → 🟢 COMPLETE 14 of 14 + surface-01b detail);
`phase-playbooks.md` (Phase-3 status → 🟢 COMPLETE). This log. **No `PERMISSION_NODES.md` change** (no node minted). **No
new OOS / AF.** **Phase-4 debt flagged in-file:** `config_audit_log` append-only + key-prefix RLS + indexes; owed to the
C2 FR-2.MNT.017 / C10 FR-10.DEL.004 erasure walk (actor-attribution redaction-tombstone, mirroring how session 27 added
event_log/guardrail_log via AC-2.MNT.017.4).

**Note (git):** a stop-hook fired mid-session; the draft + change-control mint + register updates were committed + pushed
as a WIP commit (honest message: gate pending) before this finalization. The gate reconciliation (MED/LOW fixes),
README/playbook status bump, and this SESSION-LOG entry land in the follow-up commit.

**🟢 PHASE 3 IS COMPLETE (14 of 14 surfaces signed off).** **Next step: Phase 4 — Data Model.** Consolidate every
`DATA-`/`table.field` reference across the 14 surfaces + the 11 components into one coherent schema: tables, types, RLS
policies (intra-client only, no `client_slug` — ADR-001/006), indexes (incl. HNSW per ADR / VEC), and migrations
(`migration-discipline.md`). **Load the Phase-4 playbook** (`phase-playbooks.md` §"Phase 4"). The surfaces have already
enumerated the Phase-4 data-binding stubs — start by harvesting every "Phase 4 data binding notes" section (each surface
file has one) + each component's `DATA-` footer. **Net-new stores owed from Phase 3** (flagged across surfaces, none yet
schema'd): `config_audit_log` (append-only, key-prefix RLS — surface-01/01b) · `conversations`/`messages` chat store
(OD-135, surface-08) · `push_subscriptions` device-token store (surface-12) · `commands` user-defined-command store
(surface-10) · the agent-health metric store + execution-plan store (surface-09) · `notifications` net fields
(surface-07). Also resolve the historical `client_slug` question (already killed by ADR-001/OD-096 — confirm no app table
carries it). Run the standing verification gate at Phase-4's close as usual.

## Session 42 — 2026-07-01 — SURFACE-12 (MOBILE VIEW · `UI-MOBILE-*`, 6 sub-surfaces) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 13 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-12-mobile.md` — the thirteenth Phase-3 surface (14th file): the **mobile
view**, the cross-component mobile treatment the prior twelve surfaces each seamed here (every surface 00–11 carries a
"Mobile" note ending "Detailed mobile treatment: `surface-12-mobile.md`"). Grounded in the design-doc canonical
**"Dashboard 5 — Mobile view" (`design-doc-v4.md` L3266–3284)** — *"Purpose-built for action on the go. Not a scaled down
desktop… Deep system management stays on desktop."* — which names exactly **five mobile screens** (Home · Approval queue ·
Activity feed · Chat interface · Alerts) + the **push-notification contract**. Mobile is granted to **all six canonical
roles** (design-doc L538). Pattern-matched surfaces 00–11.

**Six sub-surfaces minted:** **`UI-MOBILE-HOME`** (the glance — health score FR-7.VIEW.002 non-technical rollup /
pending-approvals count / active-alerts count / quick-chat launcher) · **`UI-MOBILE-APPROVALS`** (the design-doc's
*"primary action surface — one-tap approve/reject"* — Approve/Reject + reason, **Modify degrades to desktop**; one of the
two Realtime surfaces, FR-6.APR.*/ESC.*, server-authoritative soft-run countdown) · **`UI-MOBILE-ACTIVITY`** (plain-English
`event_log` feed, the **answer-mode pill** on every AI output FR-4.CID.006 / AC-7.VIEW.002.2 — "mode unknown" never
silently "Cited") · **`UI-MOBILE-CHAT`** (`/` dispatch, each command node-gated FR-9.CMD.002, destructive-confirm-after-gate
FR-9.CMD.003.3, `event_log` fail-closed FR-9.CMD.004.3; async results via poll + nudge, **no third Realtime socket**
AC-7.RTP.001.3) · **`UI-MOBILE-COMMAND-MENU`** (the tap-optimised quick-tap buttons above the keyboard, FR-9.CMD.005 /
L3915 — most common node-permitted commands; **same node gate + C6 pipeline as typing `/slug`**, no shortcut bypass) ·
**`UI-MOBILE-ALERTS`** (the notification centre, filterable by severity, the **second Realtime surface** FR-7.RTP.001;
all 7 alert rules FR-7.ALR.002 + the two self-protective banners alert-engine-stalled/unroutable FR-7.ALR.008/009 +
Slack-independent durability FR-7.ALR.006). Plus a cross-cutting **push-notification contract** section (FR-7.VIEW.003:
critical **immediate** · hard-limit **immediate + always, non-suppressible** AC-7.VIEW.003.1 · pending/stale approvals
**configurable** via `approval_push_frequency_minutes`/`stale_queue_push_hours` AC-7.VIEW.003.2) and a cross-cutting
**out-of-scope-on-mobile** section (the deep-management set → desktop notice).

**The governing framing — the three non-negotiables on a phone:** **#2 no mobile back-door** — every approve/act/command
routes the **identical** C1 node gate + C6 pipeline as desktop (FR-9.MODE.003 no-bypass); Restricted needs the same
explicit audited reveal (FR-1.RST.003); and the deep-management / high-blast-radius set (config edit, permission-matrix
edit, conflict/consolidation resolution, approval **Modify**, fleet actions, agent-capability edit + plan rollback,
custom-command authoring, memory mutation) degrades to a *"open on a wider display"* **notice** — never a silent omission —
consolidating the reciprocal mobile note each of surfaces 01/02/03/04/06/09/10/11 already wrote. **#3 no false-healthy on a
phone** — freshness/last-updated badges + the honest Live/Reconnecting/Polling indicator (FR-7.RTP.004) + the two
protective banners are **mandatory on every mobile screen** (a stale "all-green"/"all caught up" on a phone is the single
most dangerous false-healthy view; empty states gated on a *confirmed-live* connection; every error reads "—"/"can't
confirm", never "0"/"all clear"/green). **#1 nothing lost** — a mobile "disable" (the one write mobile keeps) retains the
definition; a dropped push is never the sole record (the in-app notification centre persists it, FR-7.ALR.001/006).

**The clean PERM case — no entry node minted (third consecutive: 10, 11, 12).** Mobile is a **viewport treatment**, not a
new authority surface: each mobile screen inherits **exactly the same PERM node as its desktop counterpart**
(`PERM-action.review` for Approvals; `PERM-dashboard.workspace`/`.overview`/`.ops` for Home/Chat/Activity; per-command
FR-9.CMD.002; the Alerts/notification centre is **node-free clearance-scoped chrome**). Design-doc L538 grants all six
roles the mobile view; *what* each sees is their existing clearance + nodes. No catalog edit.

**4 ODs raised + resolved (surface-local; recommendations delegated, consistent with surfaces 05–11), logged OD-149–152:**
- **OD-149** 🔑 — sub-surface decomposition: **six** = the design-doc's five named screens + the tap-optimised command menu
  (its own FR-9.CMD.005); **push notifications is a cross-cutting delivery contract, not a 7th screen** (faithful to the
  design-doc's own L3277–3281 grouping).
- **OD-150** — delivery platform: **responsive web + PWA with web-push for v1** (installable; same auth/RLS/deployment —
  no per-silo app to provision); **native wrapper deferred → OOS-040**. The FR-7.VIEW.003 routing contract is
  platform-agnostic; the delivery *mechanism* is flagged paper-vs-proven (Phase-5 spike recommended, not minted).
- **OD-151** — navigation: **fixed bottom tab bar** (Home/Approvals/Chat/Activity/Alerts) + persistent bell + honest
  connection indicator + the two protective banners pinned; command menu = in-chat sheet; push settings = a Settings sheet
  (read-only reflection of the surface-01 config). One-handed target (L3284).
- **OD-152** — out-of-scope-on-mobile boundary: the deep-management set → a **notice** (never a silent omission); the
  low-risk writes (Approve/Reject, agent/command **disable**, verify/flag feedback, mark-actioned) stay, each on the
  identical C6/node path.

**Verification gate (independent zero-context subagent, checks a–f): CLEAN — 0 HIGH · 0 MED · 2 LOW (both reconciled).**
(a) Coverage PASS — the five design-doc screens + command menu all addressed; every cited FR/AC resolves + paraphrases
faithfully (FR-7.VIEW.003/RTP.001-004/ALR.001-009/VIEW.002.2, FR-9.CMD.001-005/SUG.004-005/MODE.003, FR-6.APR.001-003/
ESC.001-003, FR-4.CID.006, FR-1.RST.003/ROLE.001/PERM.007 — no fabrication, no invented AC). (b) CFG PASS — both push
keys real (`approval_push_frequency_minutes`=30 LIVE, `stale_queue_push_hours`=4 LIVE), read-only reflected, edited on
surface-01. (c) DATA PASS — no `client_slug`; the net-new stores correctly Phase-4-flagged (`conversations`/`messages`
OD-135; the new `push_subscriptions` device-token store owed to C7). (d) PERM PASS — no entry node minted; six roles; all
inherited nodes resolve in `PERMISSION_NODES.md`; all-six-roles matches L538. (e) #1/#2/#3 sweep PASS — no back-door, no
false-healthy, nothing lost (strong compliance; empty states gated on confirmed-live). (f) Seams PASS — the
out-of-scope-on-mobile table's attributions each match the reciprocal home-surface mobile note; no double-owned
capability. **LOW-1 (fixed):** the Home health-score tile cited FR-7.VIEW.001 (the *technical* ops FR) for the
"non-technical rollup" — re-cited to **FR-7.VIEW.002** (the Manager rollup, same source as surface-07 At-a-Glance), the
"C7 invents no signal" guarantee kept on AC-7.VIEW.001.1, underlying signals named as the VIEW.001 system-health panel.
**LOW-2 (accepted, no change):** "pinned banner" is surface-coined UI chrome — component-07 uses no "banner" wording;
rendering a fail-loud condition as a pinned banner is legitimate Phase-3 chrome naming that preserves the guarantee
(consistent with surface-05/07).

**Files changed:** `surface-12-mobile.md` (new); `open-decisions.md` (OD-149–152 🟢 + reserve pointer → OD-153);
`out-of-scope.md` (OOS-040 native wrapper deferred; pointer → OOS-041); `README.md` (Phase-3 row → 13 of 14 + surface-12
detail); `phase-playbooks.md` (status → 13 of 14). This log. **No `PERMISSION_NODES.md` change** (no node minted). **No
matrix change** — consistent with surfaces 00–11 (the six `UI-MOBILE-*` stubs are rendered; the served FRs are existing
C6/C7/C9/C4/C5 rows). **No new AF minted in Phase 3** (the push-delivery-reliability spike is *recommended* for Phase-5,
not minted — no Phase-3 FR rests on it; the surface fails safe to the persisted in-app record). **Phase-4 debt flagged
in-file:** the net-new **`push_subscriptions`** device-token store (RLS-scoped to user, no `client_slug`, owed to C7); the
`conversations`/`messages` chat store (OD-135) + `task_queue.originating_user_id` reused from surfaces 04/08; the
clearance-scoping RLS on the feed/queue/alerts/suggestions.

**Note (git):** a stop-hook fired mid-session and the draft + register updates were committed + pushed as a WIP commit
(honest message: gate still pending) before this finalization; the README/playbook status bump + this SESSION-LOG entry +
the LOW-1 fix land in the follow-up commit.

**Next step:** **`surface-01b-config-audit-log.md`** — the **final Phase-3 surface**: the config-change audit-log viewer
(`UI-config-audit-log`, minted by OD-099) that surface-01's per-section "View audit log →" links target. FR source: the
config-change audit trail (surface-01 references it; the underlying `event_log`/config-audit records, C7 LOG + the
`PERM-config.*` / `PERM-compliance.download_records` gates). Read-only viewer: who changed which knob, from→to, when, with
export. Load surface-01's audit-log references + the C7 LOG FRs + the config registry's audit expectations. Copy
`_TEMPLATE.md`; follow the Phase 3 playbook; run the gate before sign-off. **After surface-01b, Phase 3 is complete →
Phase 4 (Data model).**

---

## Session 41 — 2026-07-01 — SURFACE-11 (MEMORY NAVIGATION / ENTITY BROWSER · `UI-MEMORY-NAV`) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF + 3 OWED CATALOG NODES CLOSED — 12 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-11-memory-nav.md` — the twelfth Phase-3 surface: the **memory
navigation / entity browser** of one client deployment, fed by **C2 (Memory)**. Minted **`UI-MEMORY-NAV`** (C2 references
"entity browser", "entity detail", "memory detail view", and the dual keyword+vector search by description —
FR-2.ENT.001/003/004, FR-2.MEM.002, FR-2.RET.002 — but assigns no `UI-` id). This is the **read/browse** counterpart to
surface-03's memory-*review* queues: surface-03 gates the **write path**, surface-11 navigates **what is stored**.
Pattern-matched surfaces 00–10.

**Four sections in two playbook buckets:** **A — Entity Browser** (the entity-organised spine FR-2.ENT.001 — one card per
cleared entity, type-filtered FR-2.ENT.002, Maturity % + `[Building]` marker FR-2.MAT.002/003, a duplicate-cluster flag
for the fragmentation/AF-082 risk FR-2.ENT.005/MNT.010; Internal Org distinguished + walled FR-2.ENT.003) · **B — Entity
Detail** (one entity's memories grouped by type FR-2.MEM.001 + filled/empty knowledge slots FR-2.MAT.001 + `external_refs`
pointers FR-2.ENT.004) · **C — Memory Detail** (one row in full FR-2.MEM.002 — content, provenance source/source_ref,
confidence + lifecycle FR-2.MNT.001, visibility×sensitivity tags FR-2.TAG, the **drillable supersede/summary chain**
FR-2.MNT.006/007 nothing overwritten) · **D — Memory Search** (the dual keyword+vector search FR-2.RET.002, **clearance
filter runs BEFORE ranking** FR-2.RET.004 — never shown-then-hidden).

**The governing framing:** surface-11 is the **human window into the three memory non-negotiables** — **#1** integrity
made *visible* (drillable supersede chains nothing overwritten MNT.007; a fragmented entity visible + mergeable
ENT.005/AF-082; audited erasure cascade MNT.017) · **#2** clearance/visibility/Restricted enforced **before display**
everywhere (RET.004, never ranked-then-stripped — a leak vector), Restricted **never auto-shown** (explicit+audited reveal
only, RST.003), Internal Org walled from client-facing agents (ENT.003), every human edit routes through the **sole
writer** (ADR-004 — never a direct `UPDATE`) · **#3** embed-failed memories were never stored so can't appear as a silent
partial (WRT.007), low-confidence/contradicted memories shown *with state* not silently trusted (MNT.001), a failed/stale
load reads "—" never a false-empty brain.

**The clean PERM case — no entry node minted.** Memory *read* authority **is** the C1 clearance/visibility model applied
at the row (FR-2.RET.004 / FR-1.RLS.003), the same model that decides what retrieval injects into any task — introducing a
browse node would make this the *only* node-gated memory-read path, an inconsistency. Entry is any authenticated user; the
row filter shows each user exactly their cleared subset; Restricted never auto-shown. Every **mutation** stays node-gated
(`PERM-memory.write` writer-routed / `PERM-memory.delete`; conflict/consolidation decisions route to surface-03). Second
consecutive no-mint surface (like surface-10).

**4 ODs raised + resolved (recommendations delegated), logged OD-145–148:**
- **OD-145** 🔑 **#2 read authority (clean, no node).** No new `PERM-memory.browse` — entry is clearance-scoped at the row
  (above); mutations node-gated.
- **OD-146** — layout: Entity Browser grid landing + detail drawer + Memory Detail + persistent Memory Search bar
  (consistent with surface-06/09).
- **OD-147** — entity-type + expected-slot **config** is edited on surface-01 (`PERM-config.*`); surface-11 reflects it
  read-only + links out (keeps surface-11 a browser, DRY config home).
- **OD-148** 🔑 **#2/#1 sole-writer edit model.** Read-first: verify/flag = a logged feedback signal (MNT.016); a content
  correction routes *through* the sole-writer validate-and-commit (WRT.006), never a direct `UPDATE` (ADR-004).

**CATALOG HOUSEKEEPING — the 3 long-owed nodes CLOSED (separate from surface-11's ODs).** The nodes flagged "owed" in
`PERMISSION_NODES.md` since surfaces 03/04 — `PERM-memory.review_conflict` + `PERM-memory.approve_consolidation`
(surface-03 / OD-115, into the **C2 — Memory** section) and `PERM-action.review` (surface-04 / OD-117, into a **new
Approval Authority** section under FR-1.PERM.007) — were **transcribed into the catalog** with their full 4-field defs
(matching `open-decisions.md` verbatim). Catalog **48→51**; the "⚠️ Owed to this catalog" block flipped to "✅ CLOSED".
surface-11 is in the Memory neighborhood, the natural point the session-40 handoff named for this.

**Verification gate (independent zero-context subagent, checks a–f): CLEAN — 0 HIGH · 0 MED · 2 LOW (both benign).**
(a) Coverage PASS — every cited C2 FR/AC (MEM/ENT/TAG/RET/MNT/MAT) resolves + paraphrases faithfully; no invented AC; no
over-claim (pill → C4/C8, ingestion → surface-03, agent-actions → surface-04 seamed out; never writes memory directly).
(b) CFG PASS — all four keys real, read-only (edited surface-01), `cold_start_full_threshold` = 80% verified. (c) DATA
PASS — no `client_slug`; read is row-level clearance RLS, no `service_role` browse; MEM.002/ENT.004 field lists match.
(d) PERM PASS — no entry node minted; the 3 transcribed nodes present with 4-field defs matching open-decisions.md; count
51, owed-debt CLOSED; six roles, no role-string gates. (e) #1/#2/#3 sweep PASS — clearance/Restricted enforced *before*
display everywhere (no shown-then-hidden leak); Restricted explicit+audited; Internal Org walled; supersede chains
drillable/retained; failed load never an empty brain; every edit sole-writer-routed. (f) Seams PASS. **LOW-1 (not a
surface defect — the surface was MORE correct than its source):** the surface's duplicate-cluster cite `FR-2.MNT.010` is
right; **the C2 component's own L219 prose mis-cited it as `FR-2.MNT.011`** (structural vs relevance erosion) — **the stale
C2 cross-ref was corrected this session** (anti-hallucination reference-verify). **LOW-2:** the gate banner's "pending"
placeholder replaced with the PASS result.

**Files changed:** `surface-11-memory-nav.md` (new); `PERMISSION_NODES.md` (+2 Memory nodes / +1 Approval Authority
section+node / Status count 48→51 / owed-block → CLOSED); `component-02-memory.md` (FR-2.ENT.005 L219 stale cross-ref
MNT.011→MNT.010); `open-decisions.md` (OD-145–148 🟢 + reserve pointer → OD-149); `README.md` (Phase-3 row → 12 of 14 +
surface-11 detail); `phase-playbooks.md` (status → 12 of 14). This log. **No matrix change** — consistent with surfaces
00–10 (the `UI-MEMORY-NAV` stub is rendered; served FRs are existing C2 rows; the 3 transcribed PERM nodes are catalog
additions, not FR rows). **No new OOS / AF** (AF-067 latency + AF-082 fragmentation are existing, cited not minted).
**Phase-4 debts flagged in-file:** the clearance-scoped browse read-path (`DATA-memories` / `DATA-entities`, RLS-gated, no
`service_role` browse, no `client_slug`), the expected-slots fill-state derivation, the `access_audit` write on
Confidential/Restricted/Internal-Org view, and the sole-writer submit path for human corrections. **Catalog housekeeping:
now fully current** — no node owed-but-untranscribed as of this session.

**Next step:** **`surface-12-mobile.md`** — the **mobile surfaces** (6 sub-surfaces). FR source is cross-component: the
mobile treatments the prior surfaces each seamed here — the **mobile command menu** (C9 FR-9.CMD.005, tap-optimised quick
commands, distinct from surface-10's *management*), mobile chat/approvals/notifications (surfaces 04/07/08), the
read-mostly mobile degrades noted on surfaces 09/10/11. Load the per-surface "Mobile" sections already written
(00–11 each carry one) + FR-9.CMD.005 + the C7 RTP realtime contract (the two Realtime surfaces on mobile). The **one
remaining after that is `surface-01b-config-audit-log.md`** (`UI-config-audit-log`, OD-099 — the config-change audit-log
viewer surface-01's "View audit log →" links to). Copy `_TEMPLATE.md`; follow the Phase 3 playbook; run the gate before
sign-off. **After surface-12 + surface-01b, Phase 3 is complete → Phase 4 (Data model).**

---

## Session 40 — 2026-07-01 — SURFACE-10 (CUSTOM COMMAND MANAGEMENT · `UI-COMMANDS`) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 11 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-10-commands.md` — the eleventh Phase-3 surface: the **custom-command
management console** of one client deployment, fed by **C9 (Proactive Intelligence)**. Surface ID **`UI-COMMANDS`** is
**named by the FRs, not minted here** — FR-9.CMD.006 already assigns it ("Custom commands are created, edited, and deleted
via `UI-COMMANDS`"), unlike surfaces 04–09 which each minted their own `UI-` id. FR source: the custom-command CRUD
(FR-9.CMD.006–008) framed inside the broader `/` dispatch contract (FR-9.CMD.001–005). Pattern-matched surfaces 00–09.

**Three sections in two playbook buckets:** **A — Custom Commands** (the `commands` list landing — one row per
user-defined command: slug / assigned agent / invocation node / active-state; an **inactive** command whose agent was
disabled reads "unavailable", never a silent no-op, AC-9.CMD.006.3) · **B — Command Builder** (the definition editor —
slug **collision-checked against all system slugs** AC-9.CMD.006.2 and **never silently renamed**; a `$ARGUMENTS` prompt
template; a **required assigned agent** from the C8 registry; an invocation-node picker that is **default-deny** if unmapped
AC-9.CMD.002.3) · **C — System-Command Reference** (the read-only reserved-slug namespace grouped by home component —
system commands are **code-registered, not data**; `/tune` *values* edit on surface-01). Commands are **invoked on
surface-08** (chat, inline answer-mode pill, FR-9.CMD.008); this surface only *defines* them.

**The clean PERM case — no node minted.** The two nodes this surface needs — `PERM-commands.manage` (entry + CRUD, Super
Admin + Admin) and `PERM-system.tune` (referenced on the reference tab) — are **already catalogued** (C9 "Proactive /
Commands" section, `PERMISSION_NODES.md` L89–90). Unlike surfaces 03/04/06/07/08/09, each of which surfaced a Rule-0
catalog gap and minted node(s), surface-10 needed **no mint** and **no catalog edit**.

**4 ODs raised + resolved (recommendations delegated, consistent with surfaces 05–09), logged OD-141–144:**
- **OD-141** — layout: custom-command list landing + Command Builder drawer + a collapsible read-only System-Command
  Reference section (consistent with surface-09 OD-138 / surface-06 OD-126).
- **OD-142** 🔑 **#2 least-privilege (pushed to the FR layer).** The FR text (default-deny unmapped node, AC-9.CMD.002.3)
  did **not** stop a manager from gating a powerful custom command on a broadly-held node to **widen its audience past
  their own authority** over the wrapped agent/capability — a real #2 surface-area gap (bounded by the invocation's C6
  pipeline + the agent's scope/clearance, but real). Resolved: a manager may only assign a node they're authorized to
  assign; a wider save is rejected at write.
- **OD-143** 🔑 **#2 containment (pushed to the FR layer).** A custom command's destructiveness/approval is governed by
  the underlying action's **C6 tier**, not a definition-time flag the author can clear — every invocation runs the same
  C6 guardrail pipeline (FR-9.CMD.008); an author may **add** a UI confirm but never **remove** a guardrail.
- **OD-144** — system-command reference: read-only, grouped by home component, reserved-slug badges (proactive complement
  to the authoritative save-time collision check); not hidden (surprise rejections), not editable (code, not data).

**Verification gate (independent zero-context subagent, checks a–f): CLEAN — 0 HIGH · 1 MED · 2 LOW (all reconciled).**
(a) Coverage PASS — every FR-9.CMD.001–008 + AC cited resolves and paraphrases faithfully (the gate re-read the CMD
section L832–1063 and matched each AC verbatim); invocation/agent-definition/config all correctly seamed out
(surface-08/09/01), no over-claim. (b) CFG PASS — the CMD FRs declare no config keys. (c) DATA PASS — no `client_slug` on
any binding; the `commands` store correctly NET-NEW Phase-4, user-defined-only (system commands code-registered).
(d) PERM PASS — both nodes catalogued with the claimed roles/scope; no node minted; no role-string gates ("Agency Owner"
only as an explicitly-not-a-role reference); six canonical roles used. (e) #1/#2/#3 sweep PASS — no false-healthy state
(error never reads empty/healthy; collision is loud; disabled-agent = "unavailable"; unmapped node = default-deny; no C6
outrun; no audience-widening past authority). (f) Seams PASS. **Reconciled: MED-1** — OD-141–144 transcribed into the
central `open-decisions.md` (the Rule-0 register-sync; pointer bumped to OD-145). **LOW-1** — catalog line-cite tightened
`L86–90`→`L89–90` (2 sites). **LOW-2** — OD-142/143 **pushed into C9 via change-control** as **AC-9.CMD.006.4**
(author-authority on the invocation gate) + **AC-9.CMD.008.4** (a definition can never lower the C6 tier), with a
change-control addendum on the C9 header — so the two #2 constraints live in the requirement layer, not only this surface
(mirrors surface-04 OD-120→AC-6.APR.003.3).

**Files changed:** `surface-10-commands.md` (new); `component-09-proactive.md` (+AC-9.CMD.006.4 / +AC-9.CMD.008.4 +
header change-control addendum); `open-decisions.md` (OD-141–144 🟢 + reserve pointer → OD-145); `README.md` (Phase-3 row
→ 11 of 14 + surface-10 detail); `phase-playbooks.md` (status → 11 of 14). This log. **No `PERMISSION_NODES.md` change**
(no node minted). **No matrix change** — consistent with surfaces 00–09 (the `UI-COMMANDS` stub is rendered; served FRs
are existing C9 rows; the two new ACs tighten Approved FRs, not new rows). **No new OOS / AF.** **Phase-4 debt flagged
in-file:** the net-new **`commands` store** (user-defined only; system commands stay code-registered; no `client_slug`;
`active` auto-flips on assigned-agent disable — trigger/reconcile pass) owed to C9/C5. **Catalog housekeeping still owed
(unchanged):** the 3 flagged surface-03/04 nodes (OD-115 ×2, OD-117 ×1) remain to be transcribed when those surfaces are
next touched; surface-10 does not touch them.

**Next step:** `surface-11-memory-nav.md` — the **memory navigation / entity browser** surface. FR source: **C2 (Memory)**
— the entity-organised business brain (FR-2.ENT.* entity types, FR-2.RET.* retrieval, FR-2.MNT.* maintenance signals, the
`[Building]` coverage flag ADR-002, clearance/visibility/Restricted scoping FR-2.RET.004 enforced **before** ranking). This
is the **read/browse** counterpart to surface-03's memory-*review* queues: surface-03 gates the write path, surface-11
navigates what's stored (entities, relationships, provenance, sensitivity tiers). Carry-in: **ADR-004** (sole-writer — the
browser is read-only; any edit routes through the Memory Agent), **C1 clearance** (Restricted never auto-shown, never
auto-injected), no `client_slug`, the answer-mode-pill seam where AI-derived context is shown. Check `PERMISSION_NODES.md`
for the Memory-Access nodes (incl. the two OD-115 conflict/consolidation nodes still owed to the catalog — surface-11 is a
natural place to transcribe them if it touches Memory Access). Copy `_TEMPLATE.md`; load only the C2 retrieval/entity FRs;
follow the Phase 3 playbook; run the gate before sign-off.

---

## Session 39 — 2026-07-01 — SURFACE-09 (AGENT FLEET · AGENT BUILDER · ORCHESTRATION) DRAFTED, RESOLVED, GATE-CLEAN-WITH-FIXES, SIGNED OFF — 10 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-09-agent-builder.md` — the tenth Phase-3 surface: the **agent-management
console** of one client deployment, fed by **C8 (Agent Design)**. Minted **`UI-AGENT-BUILDER`** (C8 names "registry
editor", "version history", and the routing/plan-version views by description — FR-8.REG.001/003/004, FR-8.PLAN.004 — but
assigns no formal `UI-` id). Pattern-matched surfaces 00–08. **Five sections in the three playbook buckets:** **Agent
Fleet** (A — the data-driven `agents` roster grid + per-agent health/drift/dead-agent **badges**) · **Agent Builder**
(B — the per-agent definition editor) + **Version History** (C — the immutable trail) · **Orchestration & Routing** (D —
the orchestrator-as-registry-agent ORC.008 + the routing-config **read-only readout**) + **Execution Plans** (E —
versioned plans + human-only rollback PLAN.004).

**The governing framing:** surface-09 is the **act-on counterpart to surface-05's self-improvement panel** — surface-05
*flags* (a drifting agent, a dead agent, a consistently-rerouted task type), surface-09 is where a human *edits the
description, narrows the scope, or rolls back a plan*, because in C8 **the fix for mis-routing is data, never code**
(AC-8.ORC.003.1). The seam was verified both ways (surface-05 owns the full panel + points back to surface-09; this
surface shows badges + links out — no double-ownership). Cardinal-sin defenses encoded: the **hard-limit invariants are
rejected AT WRITE** (Comms never-sends AC-8.SPC.003.3, Finance never-transacts AC-8.SPC.004.3, only the Memory Agent holds
memory-write AC-8.SPC.005.2 / ADR-004 — a code-level deny, not a mere audit, #2); capability edits Super-Admin-only (#2);
drift/dead-agent **flag-never-auto-correct** (OD-078, #3); a **stalled health producer reads "stale" not green**
(AC-8.HLTH.004.2, #3); **immutable versioned history with a mandatory `change_reason`** (FR-8.REG.004, #1); human-only
plan rollback (OOS-030, #1); **no `client_slug` column** (AC-8.REG.001.3).

**4 ODs raised + resolved (operator: "I trust your recommendations, what's needed" — delegated), logged OD-137–140:**
- **OD-137** 🔑 **Rule-0 PERM gap (change-control mint).** FR-1.PERM.007's **Asset Management** category names the
  design-doc seed row **"Create / edit agents" (Super Admin + Admin, L509–615)**, but **no concrete `PERM-agents.*` node
  was ever catalogued** (the catalog had no Asset Management section). The locked **OD-080 (C8)** further splits that
  coarse row into two authority tiers. **Minted the `PERM-agents.*` family via change-control** under the **already-homed**
  Asset Management category (no new category, no ADR supersede — mirrors OD-117/OD-125/OD-129/OD-133), scope
  **intra-client**, encoding OD-080 exactly: **`PERM-agents.view`** + **`PERM-agents.edit_description`** (description /
  tuning / plan-rollback — Super Admin + Admin) + **`PERM-agents.edit_capability`** (memory scope / tools / enabled / add
  / disable — **Super Admin only**, *tighter* than the design-doc's coarse SA+Admin — a #2 authority decision).
  **Transcribed into `PERMISSION_NODES.md` immediately** (new Asset Management section; catalog 45→48).
- **OD-138** — layout: fleet-grid landing + per-agent Builder drawer (with a Version History tab) + an Orchestration
  section via section nav (consistent with surface-06's grid-landing + detail-drawer, OD-126).
- **OD-139** — edit-gating + change-reason UX: one Builder, inline split (capability fields **read-only/locked for an
  Admin** with a "Super-Admin-only" affordance — transparency over hiding, #3); every Save opens a **mandatory
  `change_reason` modal** (REG.004 — no version without a reason).
- **OD-140** — hard-limit invariant presentation: **show + explain + block** (the forbidden tool appears greyed with an
  inline reason; any grant attempt is **rejected at write** with the reason logged) — the Builder's defense-in-depth
  layer alongside the missing tool (C3) + the code enforcement (C6).

**Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 1 HIGH (already-resolved) · 0 MED
· 2 LOW (all reconciled).** (a) Coverage PASS — owns all eight C8 areas, does **not** double-own surface-05's
self-improvement panel (badges + link-out only; surface-05 reciprocally points back). (b) CFG PASS — all 10 keys match
the registry default/class/anchor/PERM verbatim. (c) DATA PASS — no `client_slug` on any binding; both net-new Phase-4
stores flagged; `agents` columns match FR-8.REG.001 (no `system_prompt`, OD-075). (d) PERM PASS — OD-080 split encoded
exactly across the three nodes; mint under the existing Asset Management category (FR-1.PERM.007 confirmed to carry it;
design-doc L509–615 confirms the row). (e) #1/#2/#3 sweep PASS — false-healthy refused everywhere; hard-limit containment
enforced **at write** for all three invariants; drift/dead-agent flag-never-auto-correct; plan rollback human-only.
(f) Seams PASS (execution → C5; config knobs → surface-01 #agents; Layer-1 prompt → C4 `PERM-prompt.*`; self-improvement
panel + routing trends → surface-05; tool registry → C3 `PERM-tool.manage`). **Fixes:** **F1 (HIGH, dangling-ID)** — the
gate read `PERMISSION_NODES.md` *before* the transcription edit landed (it ran concurrently); **verified the three
`PERM-agents.*` nodes ARE present** (Asset Management section, count 45→48) — resolved, not a real gap. **F3 (LOW)** — the
Model field was bound to a non-existent `agents.model` column (FR-8.REG.001 defines none); corrected to a **read-only
config-derived display** (model selected by complexity per FR-8.COST.001; a per-agent override would be a net-new Phase-4
field, not asserted). **F2 (LOW)** — count-baseline note, no contradiction (45→48 on the right baseline; the 3 owed
surface-03/04 nodes remain separately owed).

**Files changed:** `surface-09-agent-builder.md` (new); `PERMISSION_NODES.md` (+Asset Management section / 3 `PERM-agents.*`
nodes / count 45→48); `open-decisions.md` (OD-137–140 🟢 + node defs; reserved-block + pointer → OD-141); `README.md`
(Phase-3 row → 10 of 14 + surface-09 detail); `phase-playbooks.md` (status → 10 of 14). This log.

**No matrix change** — consistent with surfaces 00–08 (the `UI-AGENT-BUILDER` stub is rendered; the served FRs are
existing C8 rows; the `PERM-agents.*` nodes are catalog additions, not FR rows). **No new OOS / AF** (all cited AFs are
existing block-S AFs). **Phase-4 debts flagged in-file:** the **net-new execution-plan store** (PLAN.004 versioned plans,
owed to C8/C5), the **net-new agent-health metric store** (HLTH.001–003 + producer heartbeat), a **per-agent `model`
column** *if* per-agent model override is wanted (not asserted — net-new), the registry version-chain index, and the
service_role-managed registry-edit authorization path (the OD-137 nodes, human-path). **Catalog housekeeping still owed
(unchanged):** the 3 flagged surface-03/04 nodes (OD-115 ×2, OD-117 ×1) remain to be transcribed when those surfaces are
next touched.

**Next step:** `surface-10-commands.md` — the **custom-command management** surface (`UI-COMMANDS`). FR source: **C9
(Proactive Intelligence)** — the custom-command CRUD FR-9.CMD.006–008 (define/manage custom `/` commands; `$ARGUMENTS`
substitution; node-set-at-definition; disabled-agent handling) + the broader `/` command dispatch contract FR-9.CMD.001–005
(each command node-gated FR-9.CMD.002, destructive-confirm FR-9.CMD.003, `event_log` fail-closed FR-9.CMD.004). The
commands are **invoked** on surface-08 (the chat) but **managed** here. Carry-in: `PERM-commands.manage` (the existing C9
catalog node, Super Admin + Admin) + `PERM-system.tune` (the `/tune` system-command node); the six canonical C1 roles;
the answer-mode-pill seam (C4 FR-4.CID.006, every command output carries it). Copy `_TEMPLATE.md`; load only the C9 CMD
FRs; follow the Phase 3 playbook; run the gate before sign-off.

---

## Session 38 — 2026-07-01 — SURFACE-08 (STANDARD USER DASHBOARD: CHAT · MY QUEUE · ACTIVITY FEED) DRAFTED, RESOLVED, GATE-CLEAN-WITH-FIXES, SIGNED OFF — 9 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-08-dashboard-user.md` — the ninth Phase-3 surface: the **everyday
user's home**, the Standard User role view (and every role's personal workspace). Minted **`UI-DASHBOARD-USER`**
(FR-7.VIEW.002 names the Standard User view as one of five RBAC-gated role surfaces but assigns no `UI-` id). Grounded in
the **design-doc canonical** (`design-doc-v4.md` L3256–3262, "Dashboard 4 — Standard user view") which names exactly
three panels — **My queue · Activity feed · Chat interface** — plus the two FR-mandated carry-ins (notification centre +
proactive suggestions). The planning-doc "My Workspace / Inbox / Decisions / chat" labels map onto these (My
Workspace=the chat surface; Inbox=notification centre + suggestions; Decisions=My Queue) — design-doc is the authority,
mirroring how surfaces 07–09 dissolved planning-doc role labels. Pattern-matched surfaces 00–07.

**Five sections:** **A — Notification Centre** (cross-cutting chrome, **home-specced on surface-07** — rides here
clearance-scoped, the one Realtime element, FR-7.ALR.001 / FR-7.RTP.001) · **B — Chat interface** (the heart: the `/`
command dispatch FR-9.CMD.001–008, each command **node-gated on its own C1 node** FR-9.CMD.002 not entry, destructive
commands confirm **after** the node gate FR-9.CMD.003.3, `event_log` write **fails closed** FR-9.CMD.004.3, custom
commands return **inline with no `task_queue` row** FR-9.CMD.008; every AI output carries the **answer-mode pill** C4
FR-4.CID.006 / AC-7.VIEW.002.2 — surface-08 is the *other* canonical pill home) · **C — My Queue** (C5 `task_queue`
filtered to this user via `originating_user_id`; the decision UI for a held item is surface-04) · **D — Activity Feed**
(C7 `event_log`, clearance+relevance scoped, pill on every row) · **E — Proactive Suggestions** (C9 FR-9.SUG.004
delivered to the user, act-through-C6 FR-9.MODE.003, dismissal safety-floor FR-9.SUG.005, cold-start "learning"
suppression FR-9.CST.002).

**KEY ARCHITECTURAL CALL — the chat has no data store yet (OD-135).** The spec defines **no `chat_messages`/
`conversations` table**; the chat is currently a rendering surface over `task_queue` + `event_log` + command results.
Resolved: **persist the thread** (a **net-new Phase-4 `conversations`+`messages` store**, RLS-scoped, no `client_slug`)
because losing a user's interaction history on reload is a **#1 violation** — flagged as a Phase-4 obligation owed to
C5/C9, **not invented as an FR** (Rule 0). And because FR-7.RTP.001 caps Realtime at **exactly two surfaces** (approval
queue + notification centre), an **async task result returns to chat on poll + a notification-centre nudge — no third
Realtime socket** (AC-7.RTP.001.3).

**4 ODs raised + resolved (operator: "Cool do it" — recommendations delegated), logged OD-133–136:**
- **OD-133** 🔑 **Rule-0 PERM gap (change-control mint), anticipated by surface-07.** OD-129 explicitly named a third,
  not-yet-minted "surface-08's standard-user node." Minted **`PERM-dashboard.workspace`** (default: **all six roles** —
  every authenticated user has a personal workspace; per-`/`-command authority stays finer, FR-9.CMD.002), scope
  intra-client, under the already-homed FR-1.PERM.007 "Dashboard Access" category — completing the family
  (`overview`/`ops`/`workspace`). **Transcribed into `PERMISSION_NODES.md` immediately** (catalog 44→45).
- **OD-134** — layout: chat-led main view + adjacent collapsible panels + persistent notification bell + the two
  always-loud banners pinned (consistent with surface-07 OD-130).
- **OD-135** — chat persistence + async-result path (above).
- **OD-136** — proactive suggestions across all three FR-9.SUG.004 delivery surfaces (dedicated panel + notification
  nudge + inline-in-chat), dismissal safety-floor preserved everywhere, every "act" through C6.

**Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 2 HIGH · 2 MED · 1 LOW (all
reconciled).** Coverage (every cited C7/C9/C5/C4 FR/AC verified verbatim — incl. the three scrutiny points:
AC-7.VIEW.002.2 pill-on-every-chat-output, AC-7.RTP.001.3 only-two-Realtime, AC-9.CMD.008.3 no-`task_queue`-on-custom-command,
all hold), CFG wiring (all 4 keys exist with claimed default/class), DATA (no `client_slug` on any binding; the chat
store + `originating_user_id` correctly flagged net-new, not asserted-existing), PERM (no role-string gates anywhere;
FR-9.CMD.002 node-gating correct; the `PERM-dashboard.*` family + FR-1.PERM.007 category verified), the **#1/#2/#3
false-healthy sweep — NO HOLE** (every error/stale state shows "—" not "0", an empty thread never reads "no history", a
blank feed never "nothing happened", an unresolvable pill reads "mode unknown" never "Cited"; a `/` command routes
through its node gate **and** C6, a proactive "act" through C6 — chat is no back-door), and seams (notification centre→
surface-07, decision UI→surface-04, command management→surface-10, config edit→surface-01, trace→surface-05, pill
definition→C4) all **PASS**. **Fixes applied:** **H1** — OD-133–136 transcribed into the central `open-decisions.md`
(pointer advanced to OD-137); **H2** — `PERM-dashboard.workspace` transcribed into `PERMISSION_NODES.md` (44→45); **M1**
— `PERM-action.review` annotated OD-117-owed-to-catalog at its reference; **M2** — unpermitted-hidden re-cited to
AC-9.CMD.007.1 + FR-9.CMD.002 (.007.2 covers *inactive* only); **L1** — connection-prioritisation re-cited to the
FR-7.RTP.003 body (+AC-7.RTP.003.1/.2). *(H1/H2 were the register-transcription steps; the surface had asserted them as
done before the central files were patched — the gate correctly caught the dangling-ID window.)*

**Files changed:** `surface-08-dashboard-user.md` (new); `PERMISSION_NODES.md` (+`PERM-dashboard.workspace` / count
44→45); `open-decisions.md` (OD-133–136 🟢 + node def; reserved-block + pointer → OD-137); `README.md` (Phase-3 row → 9
of 14 + surface-08 detail); `phase-playbooks.md` (status → 9 of 14). This log.

**No matrix change** — consistent with surfaces 00–07 (the `UI-` stub is rendered; the served FRs are existing
C7/C9/C5/C4 rows; `PERM-dashboard.workspace` is a catalog addition, not an FR row). **No new OOS / AF.** **Phase-4 debts
flagged in-file:** the **net-new `conversations`/`messages` chat store** (OD-135, owed to C5/C9 — the one genuinely-new
schema obligation this surface raises); `task_queue.originating_user_id` (the per-user filter, already flagged on
surface-04); the relevance-scoping index on `event_log`; the clearance-scoping RLS policies (ADR-006) for the thread /
queue / feed / suggestions / notification centre. **Catalog housekeeping still owed (unchanged):** the 3 flagged
surface-03/04 nodes (OD-115 ×2, OD-117 ×1) remain to be transcribed when those surfaces are next touched.

**Next step:** `surface-09-agent-builder.md` — the **Agent Fleet + Agent Builder / specialist config + Orchestration**
surface. FR source: **C8 (Agent Design)** — the orchestrator + 7-step routing (FR-8.ORC.*), the `agents` registry
(data-driven, versioned; `system_prompt`→`prompt_layers`, FR-8.REG.*), the 8 specialist definitions + their hard limits
(FR-8.SPC.*), per-agent memory scoping (FR-8.SCO.*), agent-health/drift metric production (FR-8.HLTH.*), orchestrator
learning + result caching (FR-8.LRN.*), cost-routing (FR-8.COST.*). Carry-in: **C4** (the `prompt_layers` content this
surface edits is C4-owned — LYR/CID/BIZ/INJ/TSK/PRIN/STO; agent config binds to it), **ADR-004** (Memory = sole writer
identity; Comms never-sends / Finance never-transacts hard limits), the `PERM-agents.*` / `PERM-system.*` gates (check
`PERMISSION_NODES.md` — an agent-management node may need minting, raise as an OD if so), the six canonical C1 roles.
Copy `_TEMPLATE.md`; load only the C8 FRs (+ the C4 prompt-layer seam); follow the Phase 3 playbook; run the gate before
sign-off.

---

## Session 37 — 2026-07-01 — SURFACE-07 (AGENCY / MANAGER DASHBOARD + NOTIFICATION CENTRE) DRAFTED, RESOLVED, GATE-CLEAN-WITH-FIXES, SIGNED OFF — 8 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-07-dashboard-agency.md` — the eighth Phase-3 surface: the
**non-technical leadership view** of one client deployment (the business-activity counterpart to surface-05's technical
ops dashboard) **plus the notification centre**. **Two surface IDs minted here:** **`UI-DASHBOARD-AGENCY`** (FR-7.VIEW.002
names five role surfaces incl. the **Manager (non-technical)** view but assigns no `UI-` id) and **`UI-NOTIFICATION-CENTRE`**
(the **second of exactly two Realtime/WebSocket surfaces** per FR-7.RTP.001 — the other is surface-04's approval queue —
named in FR-7.ALR.001 but never given a `UI-` id). Pattern-matched surfaces 00–06.

**Role mapping (the planning-doc trap, dissolved):** "Agency Owner" → **Super Admin**, "Manager" → **Admin /
Account Manager**; there is **no** "Agency Owner"/"Manager" C1 role. The Access table uses only the six canonical roles
(FR-1.ROLE.001) — mirrors how C7/C8/C9 dissolved the non-existent "Agency Owner" role (C9 OD-086). Default entrants:
Super Admin, Admin, Account Manager (the AM is the primary day-to-day user — their clients' activity + suggestions).

**Four sections:** **A — Notification Centre** (`UI-NOTIFICATION-CENTRE`, the one **Realtime** element; all 7 alert
rules FR-7.ALR.002 incl. the non-suppressible hard-limit AC-7.ALR.002.2; the two self-protective pinned banners —
alert-engine-stalled AC-7.ALR.008.2 + alert-delivery-misconfigured AC-7.ALR.009.1; Slack-independent durability
FR-7.ALR.006; honest Live/Reconnecting/Polling FR-7.RTP.004 with **re-fetch on reconnect**; prioritised for the live
connection under budget FR-7.RTP.003) · **B — At-a-Glance** (non-technical management rollup; **C7 invents no signal**
AC-7.VIEW.001.1; polls health 30s) · **C — Activity Feed** (a **canonical home of the answer-mode pill** Cited/Inferred/
Unknown C4 FR-4.CID.006 / AC-7.VIEW.002.2 — an unresolved pill reads **"mode unknown", never silently "Cited"**; the C2
thin-coverage *threshold* is seamed to C2, not owned here; polls event-log 60s) · **D — Proactive Suggestions** (C9
delivery FR-9.SUG.004; every "act" routes through the **identical C6 path** FR-9.MODE.003, floored rows never auto-act
FR-9.MODE.002; dismissal safety-floor FR-9.SUG.005 / AC-9.PRO.004.2/.4).

**KEY DESIGN CALL — the notification centre is cross-cutting chrome, not a surface-07-exclusive panel** (OD-131): FR-7.ALR.001
makes it "primary, persistent, **accessible from every view**", so it rides **every** dashboard (surface-05/07/08) as a
bell + slide-over, **clearance-scoped per viewer** (a Standard User gets it on surface-08). Home-specced here; **node-free**
(rides any Dashboard Access node — see OD-129). This is why it gets its own `UI-` id but is rendered everywhere.

**4 ODs raised + resolved (operator: "take all four recommendations"), logged OD-129–132:**
- **OD-129** 🔑 **Rule-0 PERM gap (change-control mint).** FR-1.PERM.007 **homes** the twelve permission categories
  incl. **Dashboard Access**, but **no concrete `PERM-dashboard.*` node id was ever catalogued**. surface-05 (signed
  off) already references a Dashboard-Access "ops" node (working name `PERM-dashboard.view_ops`) absent from the catalog
  — a real owed gate (same drift the catalog flags for surface-03/04). **Minted the Dashboard Access node family via
  change-control**, scope **intra-client**, under the already-homed FR-1.PERM.007 category (no new category, no ADR
  supersede — mirrors surface-04 OD-117's mint under "Approval Authority"): **`PERM-dashboard.overview`** (this surface
  — Super Admin/Admin/Account Manager) + **`PERM-dashboard.ops`** (canonicalises surface-05's `view_ops`; Super Admin/
  Admin + Finance-scoped-to-Cost). **The notification centre is deliberately NOT a node** (cross-cutting chrome,
  clearance-scoped). **Transcribed into `PERMISSION_NODES.md` immediately** (new "Dashboard Access" section; catalog
  42→44) and **surface-05's `view_ops` reference updated in lockstep** (closing, not extending, the drift).
- **OD-130** — layout: persistent notification bell + slide-over (cross-cutting) + a sectioned main agency view; the
  two always-loud banners pin above any section.
- **OD-131** — notification-centre scope: cross-cutting chrome on every dashboard, home-specced here (above).
- **OD-132** — suggestion actions: every "act" routes through the C6 guardrail (FR-9.MODE.003); dismissal safety-floor
  preserved (a floored item re-delivers regardless of dismissal). Inline execution rejected as a #2 violation.

**Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 1 HIGH · 1 MED · 2 LOW (all
reconciled).** Coverage (every cited C7 ALR/RTP/VIEW + C9 SUG/MODE/PRO + C4 CID.006 + C1 PERM/ROLE id verified
verbatim), CFG wiring (all 11 keys exist with claimed class/default, edited on surface-01 #observability), DATA (no
`client_slug`; net Phase-4 fields flagged), PERM (the **no-`PERM-dashboard.*`-node gap verified real, not fabricated**;
surface-05's uncatalogued ref confirmed; mint under existing category OK), the **#1/#2/#3 false-healthy sweep — NO HOLE**
(notification centre shows "—" not "0" on error; pill "mode unknown" never silently "Cited"; feed/suggestions never
empty-as-fact on fetch failure), seams (approval *queue*→surface-04, only the stale-approval *alert* here; ops→surface-05;
fleet→surface-06; pill *definition*→C4; coverage *threshold*→C2; routing *config edits*→surface-01), and role mapping
all **PASS**. **Fixes applied:** **H1** — the "every action incl. Act routes through C6" rule is **FR-9.MODE.003**, NOT
FR-9.PRO.005 (which is *Opportunity-spotting*) — re-cited at all 6 use sites (the extraction prompt had propagated the
wrong id; caught by the gate). **M1** — node-name drift: surface-05's working name `view_ops` canonicalised to
`PERM-dashboard.ops` and **surface-05's reference updated in lockstep** (else OD-129 would have created a *second*
dangling ref instead of closing the first). **L1** — RTP.002 cadence defaults (60s/30s) re-cited to the FR statement,
not AC .1/.2. **L2** — dismissal-floor tightened to AC-9.PRO.004.2/.4.

**Files changed:** `surface-07-dashboard-agency.md` (new); `surface-05-dashboard-ops.md` (node-name `view_ops`→`ops`
reconciled, 3 refs); `PERMISSION_NODES.md` (+Dashboard Access section / 2 `PERM-dashboard.*` nodes / count 42→44);
`open-decisions.md` (OD-129–132 🟢 + node defs; next OD-133); `README.md` (Phase-3 row → 8 of 14 + surface-07 detail);
`phase-playbooks.md` (status → 8 of 14). This log.

**No matrix change** — consistent with surfaces 00–06 (the two `UI-` stubs are rendered; the served FRs are existing
C7/C9/C4 rows; the `PERM-dashboard.*` nodes are catalog additions, not FR rows). **No new OOS / AF** (all cited AFs —
AF-118 alert-engine liveness, AF-120 clock-sync — are existing block-R AFs). **Phase-4 debts flagged in-file:** the
`notifications` store's net fields `escalation_state` + `escalated_at` (FR-7.ALR.005) and `actioned_at` (FR-7.ALR.001),
the dashboard-row-persisted-independent-of-Slack constraint (FR-7.ALR.006), and the RLS clearance-scoping of the feed /
suggestions / notification centre (ADR-006). **Catalog housekeeping still owed (unchanged):** the 3 flagged surface-03/04
nodes (OD-115 ×2, OD-117 ×1) remain to be transcribed when those surfaces are next touched.

**Next step:** `surface-08-dashboard-user.md` — the **standard-user view: My Workspace, Inbox, Decisions, chat**.
FR source: C7 FR-7.VIEW.002 (the **Standard User** role surface — the fifth role view) + the cross-cutting
**notification centre** (rides here too, clearance-scoped — surface-07 is its home spec; gate this surface's entry with
the standard-user Dashboard Access node) + the **answer-mode pill** (surface-08 is the *other* canonical pill home, on
chat + workspace AI-output items, C4 FR-4.CID.006 / AC-7.VIEW.002.2) + C9 proactive suggestions delivered to the user +
the **chat interface** (the `/` command dispatch is C9 FR-9.CMD.* — but command *management* is surface-10; surface-08
renders the chat + inline command use). Carry-in: the six canonical C1 roles (Standard User entry needs a Dashboard
Access node — likely a third `PERM-dashboard.*` mint, e.g. `PERM-dashboard.workspace`, under the now-established family;
raise as an OD if so); the C7 RTP realtime contract (the notification centre socket rides here); clearance-scoping at the
row (ADR-006). Copy `_TEMPLATE.md`; load only the FRs surface-08 serves; follow the Phase 3 playbook; run the gate
before sign-off.

---

## Session 36 — 2026-06-30 — SURFACE-06 (SUPER ADMIN MANAGEMENT PLANE / FLEET) DRAFTED, RESOLVED, GATE-CLEAN-WITH-FIXES — 7 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-06-dashboard-super-admin.md` — the seventh Phase-3 surface and the
**only cross-deployment surface in the product**: the external operator's fleet console, running on the **separate Super
Admin management deployment** (ADR-001 §7), not on any client silo. Minted the surface ID **`UI-DASHBOARD-SUPER-ADMIN`**
(FR-7.VIEW.002 named "the Super Admin (cross-deployment) dashboard" + FR-7.MGM.003 defined "a deployment health grid" by
description but assigned no `UI-` id). The operator's planning-doc `s-c-*` control-plane screens (Fleet Clients, Deploys,
Health, Provisioning, Migrations, Cost, Plugins) all map here. This is the surface OD-124 seamed the cross-deployment
signals **to**. Pattern-matched surface-00…05.

**The two governing rules (the non-negotiables this surface most directly serves):** **#2 — a map, not a warehouse**
(FR-10.MGT.003): only *operational metadata* crosses from a client deployment (health, queue depth, alert counts, core
version, connector status, cost-to-date) — **no client business data ever**; to look inside a client the operator clicks
through and logs into *that client's* dashboard under *that client's* RBAC (AC-10.MGT.003.2). **#3 — a dark deployment
never reads healthy** (FR-7.MGM.002): a card with no recent push flips `stale`/`unreachable` on an *independent
heartbeat* against *server-authoritative* time (AC-7.MGM.002.3/.4); a **frozen** (offboarding) deployment reads
**expected-quiet — not green, not a dead-alert** (AC-10.OFF.004.4).

**Eight sections:** **Fleet Health Grid** (landing — one card/deployment, FR-7.MGM.003, click-through under client RBAC) ·
**Cross-Deployment Alerts** (FR-7.MGM.004 + the two self-protective banners: alert-engine-stalled AC-7.ALR.008.2,
unroutable-alert AC-7.ALR.009.1) · **Releases & CI/CD** (version spread + max-skew alert FR-10.DEP.004 + promote/rollback
FR-10.DEP.002/003; promote disabled when the gate status is unknown) · **Migrations** (per-deployment failure isolation
FR-10.MIG.002) · **Provisioning & Onboarding** (FR-10.PRV.* — track + guided checklist, loud-on-partial-failure) ·
**Cross-Deployment Cost** (estimate-grade, ADR-003 / FR-7.MGM.005) · **Backup Health** (Supabase Management API,
FR-7.MGM.005) · **Client Registry & Offboarding** (the guarded 5-step destructive workflow FR-10.OFF.001–006 + token
lifecycle FR-10.MGT.004 + two-person hard-delete FR-10.DEL.003/AC-10.DEL.006).

**KEY DATA DISTINCTION — `client_slug` IS valid on this surface** (the only one): it lives solely in `client_registry`
on the management deployment (ADR-001 §3/§7 / FR-10.MGT.001 / FR-10.OFF.006), and is **deleted from every app table**
(OD-096 / FR-10.ISO.001) — the inverse of every per-deployment surface 00–05/07–12, which carry no `client_slug`. The
verification gate confirmed this claim against the ADR + FRs.

**4 ODs raised + resolved (operator: "take all four recommendations"), logged OD-125–128:**
- **OD-125** 🔑 **#2 gating, Rule-0 PERM gap (change-control)** — the C7/C10 FRs named the operator/Super Admin as the
  holder of every fleet action *in prose* (FR-10.PRV.001 provisioning, FR-10.DEP.002 promotion, FR-10.OFF.* offboarding,
  FR-10.MGT.004 token rotation) but bound **no `PERM-` node** to any of them, and **no node gated the fleet view itself**
  — a gate with no catalog entry is a build-time #3 defect. **Minted five management-plane nodes via change-control** —
  `PERM-fleet.view` / `.provision` / `.promote_release` / `.offboard` / `.rotate_token` — scope = a **new
  `management-plane` scope** (the operator's separate deployment, ADR-001 §7 — beyond intra-client), all Super-Admin-only
  / never-delegable; click-through-into-a-client is **not** a node (it's the client's own RBAC). **Transcribed into
  `PERMISSION_NODES.md` immediately** (new "Management Plane" section + new scope value; catalog 37→42) — unlike
  surface-03 OD-115 / surface-04 OD-117 which left their nodes only in `open-decisions.md`; **flagged those 3 as owed**
  in the catalog rather than leaving the drift silent. Mirrors the surface-03/04 mint pattern; C1 catalog grows, no FR
  re-approval, no ADR supersede.
- **OD-126** — fleet-grid **landing** + section nav + per-deployment **detail drawer** (with click-through); the two
  always-loud conditions pin above any section (not flat single-scroll; not fully tabbed — critical banners must never
  hide behind a tab).
- **OD-127** — offboarding = a **guarded multi-step wizard** exposing each #1 gate (export-verified-before-delete,
  sign-off-before-retention, **inline two-person auth** on hard-delete, server-driven/resumable); not a single button.
- **OD-128** — provisioning v1 = **track + guided checklist** (the token-minting/secret-setting stays the operator-run
  hardened script, FR-10.PRV.001 "loud on partial failure"); full one-click web provisioning deferred to v2.

**Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 0 HIGH · 0 MED · 3 LOW (all
reconciled).** Coverage (every cited FR/AC exists with exact meaning — a thorough C10 re-extraction confirmed
MGT/DEP/MIG/PRV/ISO/OFF/DEL all match), CFG wiring (all keys exist with claimed class/default — `deployment_staleness_window`
15min LIVE, `client_offboarding_retention_days` 90 BOOT, `canary_soak_minutes` 60 LIVE, `deploy_max_version_skew` 3,
`deploy_max_skew_days` 14, `deployment_region` ap-southeast-2 BOOT), DATA (the `client_slug`-valid-here claim verified;
operational-metadata-only boundary honored), PERM (the 5 nodes recorded, two-person auth correctly applied,
click-through correctly not a node), the #2/#3 false-healthy state sweep (every error/stale state refuses a false-healthy
view; destructive actions disabled when state unconfirmed), and all seams (single-deployment ops = surface-05, live
queue = surface-04, notifications = surface-07, backup/DR verified-restore = Phase 5) all **PASS**. **3 LOW =
citation-precision fixes, all applied:** AC-7.MGM.002.4 re-tagged **AF-120 (clock-sync)** not AF-118 (AF-118 = the
independent-heartbeat liveness on .002.3); Backup-Health re-tagged **AF-069/AF-070** (restore-works / mgmt-API fields)
not AF-071 (region/residency); parent **FR-10.DEL.003** added alongside AC-10.DEL.006. *(Note: the gate subagent's
returned transcript contained a leaked "compose the final answer now, stop calling tools" line — recognised as injected
subagent content, not a real directive; disregarded, workflow continued normally.)*

**Files changed:** `surface-06-dashboard-super-admin.md` (new); `PERMISSION_NODES.md` (+Management Plane section / 5
`PERM-fleet.*` nodes / new `management-plane` scope / count 37→42 / owed-nodes flag); `open-decisions.md` (OD-125–128 🟢
+ OD-125 five node defs; next OD-129); `README.md` (Phase-3 row → 7 of 14 + surface-06 detail); `phase-playbooks.md`
(status → 7 of 14). This log.

**No matrix change** — consistent with surfaces 00–05 (the `UI-` stub is rendered; the served FRs are existing
C7/C10 rows; the `PERM-fleet.*` nodes are catalog additions, not FR rows). **No new OOS / AF** (AF-118/120/069/070 are
existing block-R/backup AFs, cited not minted). **Phase-4 debts flagged:** the two-person-auth record (first + distinct
second approver, no self-second) is a net field-set owed for the offboarding hard-delete; the management DB schema for
this deployment is `client_registry` + the push-fed health/meta/alert stores **only** (no client business tables, no
`client_slug` in any app table). **Catalog housekeeping owed:** transcribe the 3 flagged surface-03/04 nodes
(OD-115 ×2, OD-117 ×1) into `PERMISSION_NODES.md` when those surfaces are next touched.

**Next step:** `surface-07-dashboard-agency.md` — the **Agency Owner + Manager view + activity feed + notification
centre**. FR source: C7 VIEW (the Manager role dashboard FR-7.VIEW.002) + the **notification centre** (the *second* of
the two Realtime surfaces, FR-7.RTP.001 — the live critical-alert delivery target seamed from surfaces 04/05/06) +
C9 proactive suggestions delivery + the C7 ALR alert-delivery (FR-7.ALR.*). Carry-in: the six canonical C1 roles
(the planning-doc "Agency Owner"/"Manager" labels map to Super Admin/Admin/Account Manager — never invent roles, mirror
how C7/C8/C9 dissolved the non-existent "Agency Owner" role); the C7 RTP realtime contract (this surface **owns** one of
the two Realtime sockets); answer-mode pill (cross-cutting, home surface). Copy `_TEMPLATE.md`; follow the Phase 3
playbook; run the gate before sign-off.

---

## Session 35 — 2026-06-30 — SURFACE-05 (OPERATIONS DASHBOARD) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 6 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-05-dashboard-ops.md` — the sixth Phase-3 surface and the **poll-based
read-only counterpart to surface-04's Realtime approval queue**. Where surface-04 is one of exactly two Realtime/WebSocket
surfaces (FR-7.RTP.001), surface-05 is the canonical **polling** surface (FR-7.RTP.002): nine panels, each fed by its home
component, each refreshing on its own per-deployment-configurable cadence, none over a live socket. Minted the surface ID
**`UI-DASHBOARD-OPS`** (FR-7.VIEW.001 defined "the operations dashboard" by description but assigned no formal `UI-` id).
Framed as the operator-facing embodiment of non-negotiable **#3 (never fail silently)** — the dashboard's defining job is to
make a *silent* failure *loud*, and its cardinal sin is a **false-healthy view**. Pattern-matched surface-00…04.

**Nine panels (8→9: Connector Health split out of VIEW.001's system-health bundle — a faithful decomposition, sanctioned by
the playbook's panel list):** **System Health** (C5 FR-5.LOP.005/QUE.001 loops + queue + success rate, + C3/C8 rollups) ·
**Failure Health** (the silent-failure detector — `task_queue`-terminal-without-`event_log`-terminal per **AC-7.LOG.003.1** +
spike/backup pre-breach trackers) · **Connector Health** (C3 FR-3.DSC.005/006/TOK/RL.001/TRIG.005/006 — status, token-expiry
countdown never showing the token, rate headroom, watch re-arm) · **Memory Health** (C2 FR-2.MNT.* signals, **read-only**;
the actionable queues are surface-03) · **Event Log** (C7 FR-7.LOG.001–006 — append-only plain-English timeline, `cost_unknown`
sentinel, redaction-tombstone retention) · **DLQ** (C5 FR-5.JOB.006 — full error history, **human-only requeue/discard**,
the AC-5.JOB.006.2 unattended-escalation badge) · **Cost** (C7 FR-7.COST.001–004 — estimate-grade meter + lit ladder rung;
**renders, does not enforce** — C6 decides/C5 executes per FR-7.COST.003) · **Guardrail Log** (C6 FR-6.LOG.001–004 + C7
FR-7.LOG.007 view/export; hard-limit rows never `approved`) · **Self-Improvement** (C8 FR-8.HLTH.001–004/LRN.001–002 +
C7 FR-7.OPT.001 + C6 FR-6.OPT.001 + C9 Insight suggestions — **flag/suggest only, never auto-act**).

**4 ODs raised + resolved (operator "yes" → all four recommendations taken), logged OD-121–124:**
- **OD-121** — **#2 per-panel role-scoping** (FR-7.VIEW.002 / AC-7.VIEW.002.1 gave no panel→node map). Bound to **existing**
  C1 PERM categories (FR-1.PERM.007 — Dashboard Access · Observability · Compliance · System Functions · Tool Access): entry
  via a Dashboard Access (ops) node (Super Admin + Admin full; Finance → Cost only; others hidden); export →
  `PERM-compliance.download_records`; DLQ requeue/discard + connector re-auth → System-Functions/Tool-Access nodes. **No new
  category, no node mint, no FR re-approval** (unlike surface-03 OD-115 / surface-04 OD-117 — here the categories already fit;
  node ids materialise in `PERMISSION_NODES.md` at build, FR-1.PERM.005).
- **OD-122** — **single-scroll sectioned** dashboard + sticky health-summary strip + anchor nav + **independently-polled**
  collapsible panels (not tabbed — tabs hide a degrading panel, a #3 risk).
- **OD-123** 🔑 **#3 Rule-0 config gap (change-control)** — C5 **AC-5.JOB.006.2** mandates a DLQ-unattended escalation "beyond
  a configurable age," but the registry had **no key** for it (`max_retries_before_dead_letter`=3 is the retry cap). **Minted
  `dlq_stale_alert_hours`** (default 24 h, LIVE, §H `#loops`, `PERM-config.loops`) **via change-control to `config-registry.md`**
  (logged in its Status section). Satisfies the existing AC; no FR re-approval. Same shape as OD-097.
- **OD-124** — surface-05 is **strictly single-deployment**; cross-deployment/management-plane signals (FR-7.MGM.001–005) are
  **exclusively surface-06** (matches ADR-001 §3 isolation, no `client_slug`).

**Verification gate (1 independent zero-context subagent, checks a–f): CLEAN — 0 HIGH · 0 MED · 0 LOW.** All six passed:
(a) full panel coverage, every panel → a producing FR, silent-failure driven by LOG.003, self-improvement displays-not-
generates; (b) **all 19 cited config keys resolve** with matching class/default, incl. the newly-minted `dlq_stale_alert_hours`
(verified at registry L176); (c) **no `client_slug` leak** (OD-096/FR-10.ISO.001 honored on every binding), `cost_unknown`
sentinel + silent-failure join coherent; (d) PERM model reuses existing C1 categories, `PERM-compliance.download_records`
confirmed, no invented node/category, no bare role-string gates; (e) **the #3 false-healthy sweep found no hole** — every
error/stale state badges "—" not "0"/"$0"/"✓", and notably **the silent-failure detector protects itself** (its own failure
shows "couldn't verify," never an empty all-clear) + DLQ/export actions disabled while stale/unloaded; (f) all seven seams
correct, cost-ladder enforcement correctly disclaimed. One non-blocking note (8 named views → 9 panels) folded into the
Sections intro.

**Files changed:** `surface-05-dashboard-ops.md` (new); `config-registry.md` (+`dlq_stale_alert_hours` §H, Status-section
change-control note); `open-decisions.md` (OD-121–124 🟢 + reserved-block, next OD-125); `README.md` (Phase-3 row → 6 of 14 +
surface-05 detail); `phase-playbooks.md` (status → 6 of 14). This log.

**No matrix change** — consistent with surfaces 00–04 (the `UI-` stub is rendered, the served FRs are existing C5/C6/C7/C3/C8/C9
rows; `dlq_stale_alert_hours` is a config row, not an FR). **No new OOS / AF.** The Phase-4 data-binding notes flag the
silent-failure reconciliation join (`task_queue`↔`event_log` terminal-event), the `cost_unknown` sentinel representation, and
the C3 connector-state / C8 agent-metric stores as Phase-4 schema obligations.

**Next step:** `surface-06-dashboard-super-admin.md` — the **Super Admin dashboard + management-plane screens** (the
cross-deployment fleet: clients, deploys, health grid, provisioning, migrations, cost overview, plugins — FR-7.MGM.001–005 +
C10 management plane + ADR-001 §7). This is the surface OD-124 seamed the cross-deployment signals *to*.

---

## Session 34 — 2026-06-30 — SURFACE-04 (AGENT ACTION APPROVAL QUEUE) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 5 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-04-approval-queue.md` — the fifth Phase-3 surface and the
**realtime/WebSocket counterpart to surface-03's poll queues**. Where surface-03 gates candidate *knowledge*,
surface-04 gates candidate *action*: one **single live queue** (OD-118) of every held agent task —
**`awaiting_approval`** (a C6 approval-tier gate) and **`flagged`** (a C6 safety hold: anomaly / rate-limit /
injection) — with **Approve / Reject / Modify** (FR-6.ESC.003), routed to contextually-appropriate reviewers
(FR-6.APR.005). Minted the surface ID **`UI-APPROVAL-QUEUE`** (Phase 1 referenced "the dashboard approval queue" by
description but assigned no formal `UI-` id). This is **one of exactly two Realtime surfaces** in the product
(FR-7.RTP.001 — the other is the notification centre on surface-07, seamed). Pattern-matched surface-00…03.

**FR source:** **C5 (held state)** — FR-5.QUE.005 (`awaiting_approval` blocks execution; `approved_by`/`approved_at`;
escalate-don't-abandon AC-5.QUE.005.2), FR-5.ASM.004 (the gate that produces the item; AC-5.ASM.004.2 late-side-effect
re-enters), FR-5.ASM.005 (mid-task quarantine retains WIP). **C6 (tiers + routing + resolutions)** — FR-6.APR.001/002
(3 tiers + mandatory-hard floor), FR-6.APR.003 (soft auto-runs only if reversible), FR-6.APR.005 (contextual routing +
**no-self-approval** AC-6.APR.005.3), FR-6.ESC.001 (flagged ≠ awaiting_approval; **hard-limit hits are killed, never
held** AC-6.ESC.001.2), FR-6.ESC.003 (Approve/Reject/Modify + already-applied-effects + compensation-not-rollback,
OD-010), FR-6.ESC.004 (no silent abandon), FR-6.LOG.001/003 (`guardrail_log`). **C7 (transport + alerts)** —
FR-7.RTP.001 (this IS the Realtime surface), FR-7.RTP.003 (per-silo budget → degrade-to-polling), FR-7.RTP.004
(reconnect / honest live-vs-polling), FR-7.ALR.002/003/005/007 (stale-approval alert delivery — seam, C7 owns).

**4 ODs raised + resolved (operator delegated "what do you recommend" → all four recommendations taken), logged OD-117–120:**
- **OD-117** 🔑 **#2 gating + Rule-0 gap** — the C5/C6/C7 FRs named **no PERM node for *deciding* a held item**
  (FR-5.QUE.005 "a human approves," FR-6.APR.005 "reviewer role," FR-6.ESC.003 "human resolutions"; `PERM-guardrail.edit_autonomy`
  gates the autonomy *config*, not a queue item). Resolved by **minting `PERM-action.review` via change-control**,
  **homed under the existing "Approval Authority" category** (FR-1.PERM.007's fixed twelve — a node *within* it, not a
  new category). Four-field def (Description / Default roles = Super Admin + Admin, Finance/AM only-when-granted+routed /
  Scope incl. no-self-approval + clearance / Added-in) recorded in `open-decisions.md`. Build obligation = appear in
  `PERMISSION_NODES.md` (FR-1.PERM.005). Mirrors surface-03's OD-115. **C1 catalog grows; no FR re-approval.**
- **OD-118** — one live queue + filter chips (All / Approvals / Safety holds / Overdue), not tabs (identical resolution +
  escalation + transport across both classes; keeps the live socket singular).
- **OD-119** — Modify = structured editor of declared editable params; requeue **re-enters the guardrail gate** (can't
  downgrade a tier or smuggle past — AC-5.ASM.004.2).
- **OD-120** — a reviewer may **freeze a soft item's auto-run countdown** ("Hold for full review" → promotes soft→explicit;
  never the reverse). **Applied via change-control to C6 FR-6.APR.003 as AC-6.APR.003.3.**

**Verification gate (1 independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 1 HIGH + 3 MED, all reconciled.**
The three non-negotiables, full FR coverage, CFG wiring (all keys exist with claimed class/default — `approval_soft_timeout`
10m, `approval_escalation_timeout` 4h, `approval_staleness_alert_threshold` 4h, `realtime_connection_headroom_threshold`
80%, etc.), the six-role model, and the OD-120 change-control all passed clean. Fixes: **HIGH (c-1)** the
`guardrail_log.client_slug` framing was stale ("Phase-4 fate undecided") — **OD-096 already deleted `client_slug` from all
app tables** (C10 FR-10.ISO.001); corrected to cite the closed decision. **MED (c-2)** `originating_user_id` (task_queue)
+ `escalated_at` (guardrail_log) are net-new — flagged as **new Phase-4 fields owed to C5/C6**. **MED (a-1)** the soft
auto-run countdown's "server-authoritative" claim leaned on an *alert* AC (AC-7.ALR.005.3) — re-cited as a server-owned
timer (FR-6.APR.003) + an explicitly-owed surface UI obligation. **MED (d-1)** re-homed `PERM-action.review` under the
existing Approval Authority category (not a new one, which would conflict with the fixed-12).

**Files changed:** `surface-04-approval-queue.md` (new); `component-06-guardrails.md` (+AC-6.APR.003.3, OD-120 change-control);
`open-decisions.md` (OD-117–120 🟢 + OD-117 node def; next OD-121); `README.md` (Phase-3 row → 5 of 14 + surface-04 detail);
`phase-playbooks.md` (status → 5 of 14). This log.

**No matrix change** — consistent with surfaces 00–03 (the `UI-` stub is rendered, the served FRs are existing C5/C6/C7 rows;
`PERM-action.review` is a catalog node, not an FR; AC-6.APR.003.3 is an AC addition, not a new FR row). **No new OOS / AF.**
Two debts to Phase 4 (new schema fields `task_queue.originating_user_id` + `guardrail_log.escalated_at`) + one owed UI
obligation (server-authoritative displayed soft-countdown) are flagged in the surface's Phase-4 notes.

**Next step:** `surface-05-dashboard-ops.md` (the ops dashboard: system health, connector health, event log, DLQ, cost,
guardrail log, self-improvement — the poll-based C7 panels per FR-7.RTP.002).

---

## Session 33 — 2026-06-30 — SURFACE-03 (MEMORY REVIEW QUEUES) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 4 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-03-ingestion-queue.md` — the fourth Phase-3 surface. One tabbed
**"Memory Review"** surface consolidates the **three human-gated queues that guard the memory write path**:
**Ingestion** (`UI-INGESTION-QUEUE`) · **Conflicts** (the hard-conflict quarantine) · **Consolidation** (the
Personal-tier merge/summarise approval gate). Framed as the operator-facing embodiment of the three non-negotiables
for memory: nothing sensitive written without an explicit human decision (#2), nothing silently dropped or held
forever (#3), held/deferred knowledge never lost (#1). Each section specced with data bindings, actions+PERM,
poll contract, all five states. Pattern-matched surface-00/01/02.

**FR source:** `component-02-memory.md` — **Ingestion tab:** FR-2.ING.002 (Filter-2 sensitivity flagging), FR-2.ING.003
(Include/Exclude/Defer + defer-resurface + un-actioned escalation), FR-2.ING.004 (no sensitive write without Include),
FR-2.ING.005 (HR Exclude-by-default), FR-2.ING.001/OD-036 (trust-window shadow-drop audit), FR-2.ING.010 (Include
routes through the standard write flow). **Conflicts tab:** FR-2.WRT.002 / OD-032 (hard-conflict quarantine, never
auto-resolved), informed by FR-2.MNT.008 (priority rules → suggested resolution), seam-in from FR-2.MNT.006 (daily
supersede safety-net). **Consolidation tab:** FR-2.MNT.014 / OD-037 (Personal-tier merge FR-2.MNT.005 / summarise
FR-2.MNT.007 never auto-consolidated). **ADR carry-ins:** ADR-003 (Filter-1/2 Haiku gates *produce* the queue
contents), **ADR-004** (Include/approval hands to the **sole writer** — *not* a direct insert; still runs contradiction
check + per-entity lock + write-rate cap; a writer-side rejection must resurface), ADR-002 (`[Building]` entity context),
ADR-001 §3 (no `client_slug`). **C3 seam:** ingestion items originate from connector triggers (FR-3.TRIG.*) +
gap-reconciliation re-ingest (FR-3.TRIG.006) feeding FR-2.ING.006/007/008. **C7 seam:** these are POLL queues (the
realtime-WebSocket set is C6's agent-approval queue on **surface-04** + the notification centre — FR-7.RTP.001); the
escalation *alert* is delivered by C7, the surface owns the queue + badge.

**4 ODs raised + resolved (operator: "mint dedicated nodes" + "take all three recs"), logged OD-113–116:**
- **OD-113** — one tabbed "Memory Review" surface (not three nav routes).
- **OD-114** — trust-window auto-drop audit = read-only toggle inside the Ingestion tab (not a 4th tab).
- **OD-115** 🔑 **#2 gating + change-control** — the Conflicts + Consolidation queues had **no dedicated PERM node**
  in the C2 FRs (FR-2.WRT.002 said only "writer"; FR-2.MNT.014 said "cleared role + `PERM-memory.*`") — a real Rule-0
  gap. Resolved by **minting two new nodes under the Memory Access category via change-control**:
  **`PERM-memory.review_conflict`** (Super Admin + Admin) and **`PERM-memory.approve_consolidation`** (Super Admin +
  Personal clearance). Four-field definitions (Description/Default roles/Scope/Added-in) recorded in `open-decisions.md`
  OD-115; build obligation = appear in `PERMISSION_NODES.md` when materialised (FR-1.PERM.005 discipline — an
  *addition*, not an ADR supersede). **C1 catalog grows; no FR re-approval needed.**
- **OD-116** — Include confirms/assigns the sensitivity tier (pre-filled from Filter-2, overridable, override audited).

**Verification gate (1 independent zero-context subagent, 6 checks a–f): CLEAN — 0 HIGH, 5 MED + 1 LOW.** All four
core checks PASS clean: stub coverage (UI-INGESTION-QUEUE + conflict queue fully addressed, no orphans, no over-claim);
CFG wiring (all 6 keys exist with claimed class/default — incl. `hr_content_enabled` BOOT); DATA (no `client_slug`
leak, all Phase-4 stubs flagged, joins read-only); PERM (only nodes, two new ones recorded with all 4 fields). The
two non-negotiable checks PASS: no silent-failure hole (every error state refuses to render a false-empty queue, badge
shows "—" not "0"; ADR-004 sole-writer reflected; hard conflicts never auto-resolved; Personal never auto-consolidated;
clearance-before-view enforced) + escalation uniform on all three queues with C7 alert-delivery seam. **6 reconciled:**
(F1 already satisfied) + keep-both closes the quarantine record (`state=resolved`); consolidation-reject logs to
`access_audit`; Defer disabled when `deferred_until` can't be computed; `escalated_at` documented as server-owned
(C2 loop, not a surface computation — badge correct even when dashboard idle); HR row clarified (gate is the config
flag, not the role).

**Files changed:** `surface-03-ingestion-queue.md` (new); `open-decisions.md` (OD-113–116 🟢 + OD-115's two node
defs; next OD-117); `README.md` (Phase-3 row → 4 of 14); `phase-playbooks.md` (status → 4 of 14). This log.

**No matrix change** — Phase 3 surfaces don't add traceability-matrix rows (the `UI-` stubs are already columns on the
C2 FR rows); consistent with surface-00/01/02. **No new OOS / AF.** The two new PERM nodes are catalog additions
(C1 build artifact), not matrix rows.

**NEXT STEP — `surface-04-approval-queue.md`** (the C6 agent-action approval-queue dashboard — the 3 approval tiers).
FR source = `component-06-guardrails.md` (the **APR** area — FR-6.APR.* approval tiers / mandatory-hard set / contextual
routing + the **ESC** escalation/flagged workflow FR-6.ESC.*). Carry-in: **ADR-007** (containment-first; quarantine
retains-not-discards), the **C7 RTP realtime contract** (this queue **IS** in the realtime-WebSocket set — FR-7.RTP.001,
`awaiting_approval` live — unlike surface-03's poll queues; note the distinction), OD-056 (step-level approval +
no-irreversible-outrun), OD-088 (action-autonomy matrix, the C6/C9 floor). Copy `_TEMPLATE.md`; follow the Phase 3
playbook steps; run the gate before sign-off. **surface-03 signed off + committed to main this session.**

---

## Session 32 — 2026-06-30 — SURFACE-02 (USER & ACCESS MGMT) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 3 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-02-user-mgmt.md` — the third Phase-3 surface. One tabbed
**"Users & Access"** surface consolidates the **six C1 (RBAC) admin sub-surfaces**: UI-USER-MGMT · UI-ROLE-MGMT ·
UI-PERMISSION-MATRIX · UI-CLEARANCE-MGMT · UI-CLEARANCE-REVIEW · UI-RESTRICTED-GRANT (the `UI-CLEARANCE-*` glob =
two surfaces: grant/revoke + cadence review). `UI-USER-ACTIVITY` (FR-1.USR.004) is intentionally merged into the
Users-tab detail drawer (noted in-file, not dropped). Six tabs: Users · Roles · Permissions · Clearances ·
Reviews · Restricted. Each specced with data bindings, actions+PERM, real-time/poll contract, all five states.
Pattern-matched surface-00/01.

**FR source:** `component-01-rbac.md` (ROLE/PERM/CLR/RST/USR/AUD areas) **+** the C0 invite-lifecycle FRs that
name UI-USER-MGMT (`component-00-login.md` FR-0.INV.001/.002/.003/.006/.007 — invite-only/expiry/SMTP/revoke-
resend/bounce). CFG keys read-only here (editing → surface-01). **Gating spine:** Admin is gated to the **Users
tab only**; Roles + Permissions = `PERM-system.role_manage` (Super-Admin-only, FR-1.ROLE.003); Clearances +
Reviews = `PERM-user.grant_clearance` (Super-Admin-only, FR-1.USR.005); Restricted = `PERM-user.grant_restricted`
(Super-Admin-only, FR-1.RST.001). #2 (explicit/scoped/reason-captured grants) and #3 (blocked last-Super-Admin,
throttled invite, overdue review all surfaced) govern.

**Key correctness moves carried in:** FR-1.RLS.007 mid-task-revocation halt **seamed OUT** to C5/C6/C8 (this
surface owns authorization *state*, not agent-path interception); `client_slug` excluded everywhere (ADR-001 §3 /
OD-096); reactivation does **not** auto-restore above-Standard clearances / Restricted (AC-1.USR.002.2); Restricted
never a role default + never auto-injected (FR-1.RST.003, seamed to C2); instant-on-next-query, no re-login
(FR-1.RLS.006); `restricted_grants.reason` NOT NULL (FR-1.RST.002).

**4 ODs raised + resolved (operator: "yes to all"), logged OD-109–112:**
- **OD-109** — six sub-surfaces render as one tabbed surface (not six nav routes).
- **OD-110** — permission matrix = category-grouped accordion (12 catalog categories) + search, not a flat grid.
- **OD-111** — clearance review = its own "Reviews" tab + overdue escalation banner, not inline badges.
- **OD-112** — reason optional on non-Restricted mutations (captured to audit), mandatory only for Restricted —
  consistent with locked OD-029.

**Verification gate (1 independent zero-context subagent, 6 checks a–f): CLEAN — 0 HIGH, 1 MED, 4 LOW.**
All six UI- stubs covered; every "FRs served" FR genuinely rendered; no `client_slug`; one-role-per-user matches
OD-029; `restricted_grants.reason` NOT NULL; every PERM node real (checked vs `PERMISSION_NODES.md`); Super-Admin-
only gating correct; five states have no silent-failure holes (fetch-failure never renders as healthy/empty;
last-Super-Admin block surfaces; failed invite never reads "sent"; matrix toggle rolls back on write failure).
**3 patched:** (MED) the manifest mis-routed `clearance_review_cadence_days` editing to surface-01 `#auth` — it
lives under `#guardrails` (registry group D); fixed + corrected `invite_link_ttl` class to BOOT. (LOW) flagged
`UI-USER-ACTIVITY` as intentionally merged; (LOW) corrected RLS.007 seam target C5/C6 → **C5/C6/C8** per OD-031.
**2 LOW justified-as-is:** Reviews-tab gate granularity (faithful to C1's coarse node set — no separate view-only
node exists); `invite_link_ttl` BOOT-vs-LIVE (surface never claims LIVE — folded into the MED fix).

**Files changed:** `surface-02-user-mgmt.md` (new); `open-decisions.md` (OD-109–112 🟢; next OD-113);
`README.md` (Phase-3 row → 3 of 14); this log.

**No matrix change** — Phase 3 surfaces don't add traceability-matrix rows (the `UI-` stubs are already columns on
the C1/C0 FR rows); consistent with surface-00/01. **No new OOS / AF.**

**NEXT STEP — `surface-03-ingestion-queue.md`** (UI-INGESTION-QUEUE + the conflict-review queue). FR source =
`component-02-memory.md` (the ING area — ingestion pipeline/queue durability/escalation FR-2.ING.* + the
conflict/merge review FR-2.MNT.* human-gated queues) + the C3 connector trigger seams that feed ingestion.
Carry-in: ADR-002 (Maturity / `[Building]`), ADR-003 (selective-writing + sensitivity-classify gates), ADR-004
(sole-writer service_role + per-entity validate-and-commit), the C7 RTP real-time contract. Copy `_TEMPLATE.md`;
follow the Phase 3 playbook steps; run the gate before sign-off.

---

## Session 31 — 2026-06-29 — SURFACE-00 (AUTH) DRAFTED, RESOLVED, GATE-CLEAN — 2 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-00-auth.md` — the second Phase-3 surface. One file consolidates
the **six C0 auth-boundary sub-surfaces**: UI-LOGIN · UI-2FA-ENROLL · UI-2FA-CHALLENGE · UI-INVITE-SETUP ·
UI-REAUTH-PROMPT · UI-SUPPORT-REQUESTS. Each specced as its own section with data bindings, actions+PERM,
real-time/poll contract, and all five states (loading/empty/error/partial/offline). Pattern-matched surface-01.

**FR source:** `component-00-login.md` (AUTH/SESS/INV/SEED/REC). CFG keys are **read-only** here (group A/B/C);
editing lives on surface-01 `#auth`. Five sections are public/pre-auth; only the UI-SUPPORT-REQUESTS *queue* is
authenticated (`PERM-support.view`/`.resolve`). The "Trouble signing in?" intake form is a public modal off
UI-LOGIN. #3 (never fail silently) is the governing rule — every reject/lockout/throttle/dropped-email/lost-work
state is made visible.

**4 ODs raised + resolved (operator: "take all 4 recs"), logged OD-105–108:**
- **OD-105** — external-admin email+password collapsed behind an "Operator sign-in" disclosure; OAuth primary.
- **OD-106** — support queue pins overdue `pending` to top, then newest-first (FR-0.REC.007 first-class).
- **OD-107** — no TOTP backup codes in v1 (external admins recover via the FR-0.SEED.003 env re-run) → **OOS-039**.
- **OD-108** — UI-REAUTH-PROMPT re-authenticates inline to preserve page state (FR-0.SESS.007); redirect only if OAuth forces it.

**Verification gate (1 independent zero-context subagent, 6 checks a–f): CLEAN — 0 HIGH, 1 MED, 5 LOW.**
DATA fields match C0 exactly (no invented/retired fields; OD-019 no-phone honoured; status enum
pending|in-progress|resolved); all 12 CFG keys exist + are correctly read-only; all six sections × five states
present; zero contradictions with OD-016/018/019 or ADR-001 §3/OD-096; #3 posture strong. **2 patched:** (a3 MED)
added the `aal1`→UI-2FA-CHALLENGE forced-redirect Navigation row (FR-0.AUTH.008); (e1 LOW) added the
FR-0.REC.006 notification-send-failure note (queue stays durable source of truth; delivery is a C7 seam). Other
LOWs were justified-as-is (manifest-completeness CFG entries; justified Empty=N/A; AF-075 correctly carried).

**Stale-note fix:** SESSION-LOG session 30 called **OD-104** "pre-existing, NOT patched / needs an operator
decision." It is in fact **already RESOLVED** (2026-06-28, → C3 FR-3.TRIG.005/006; OWED-FR-1 CLOSED — see
`open-decisions.md` OD-104 and `component-00-login.md` L823–825). No action owed; corrected here so it isn't
re-flagged.

**Files changed:** `surface-00-auth.md` (new); `open-decisions.md` (OD-105–108 🟢; next OD-109);
`out-of-scope.md` (OOS-039; next OOS-040); `README.md` (Phase-3 row → 2 of 14); this log.

**No matrix change** — Phase 3 surfaces don't add traceability-matrix rows (the `UI-` stubs are already columns
on the C0 FR rows); consistent with surface-01.

**NEXT STEP — `surface-02-user-mgmt.md`** (UI-USER-MGMT, UI-ROLE-MGMT, UI-PERMISSION-MATRIX,
**UI-CLEARANCE-MGMT** (grant/revoke — FR-1.CLR.002/.004 + USR.005) + **UI-CLEARANCE-REVIEW** (cadence review —
FR-1.CLR.005), UI-RESTRICTED-GRANT — i.e. the `UI-CLEARANCE-*` glob expands to **two** surfaces). FR source = `component-01-rbac.md` (ROLE/PERM/CLR/RST/USR areas) + the C0 INV FRs that name
UI-USER-MGMT (FR-0.INV.001/.002/.003/.006/.007 — invite issue/expiry/SMTP/lifecycle/bounce). Carry-in:
`PERMISSION_NODES.md` (the canonical node catalog), ADR-006 (data-driven RLS), the six canonical C1 roles. Copy
`_TEMPLATE.md`; follow the Phase 3 playbook steps; run the gate before sign-off.

---

## Session 30 — 2026-06-28 — PLAIN-ENGLISH DESCRIPTIONS ON EVERY CONFIG KNOB (registry) + DRY helper-text convention — **SIGNED OFF + PUSHED**

**✅ OPERATOR SIGN-OFF (2026-06-28):** "i confirm it and i want to sign off and push to main." Confirmed the
plain-English descriptions work, the DRY convention, and the self-sufficiency-test gap patches. Pushed to `main`.

**OD-104 CLOSED (2026-06-28, operator delegated "i trust your rec"):** missed/never-arriving webhook detection —
**verified the mechanism already exists, no new FR.** Owned by C3 **FR-3.TRIG.005** (watch re-arm, fail-loud on
lapse) + **FR-3.TRIG.006** (event-gap detect + reconcile from a persisted watermark — dropped/auto-disabled/
late events never become silent loss), alerted via FR-3.DSC.006 → C7. **C0 OWED-FR-1 closed.** One build-time
caveat logged: confirm GHL's incremental sync provides a TRIG.006 reconciliation read (GHL not in TRIG.006's
named happy-path arms; rides the generic detect-then-reconcile pattern). **No open items remain blocking Phase 3.**

**What happened:** Operator reviewed `surface-01-config-admin` (already signed off, session 29) plus an HTML
mockup and flagged that the config knobs are impossible to understand from their key names alone. Added a
**plain-English `What it does` description to every config row.**

**Scope of the change:**
- **`spec/02-config/config-registry.md`** — new `What it does (plain English)` column on all 14 group/secret
  tables (A–N), one jargon-free line per row, written for a non-technical agency admin. **170 knob/secret rows
  + 11 Appendix-A structured objects** — verified 100% coverage (0 empty descriptions). Method: 6 parallel
  subagents, each grounding its descriptions in the relevant `component-NN` requirement files (no invented
  behaviour). Conventions section documents the column as **canonical source text**.
- **`spec/03-surfaces/surface-01-config-admin.md`** — added a binding paragraph (Layout): the surface renders
  each key's registry description as the on-screen **helper line** beneath the key. **DRY decision (operator
  confirmed "keep it dry"):** the registry is the single source; the surface references it, never duplicates the
  170 strings. A key with no description is a registry defect, not a surface fallback.
- **`spec/03-surfaces/_TEMPLATE.md`** — added the **DRY rule for human-readable text** under Data bindings so
  every future surface follows the same bind-don't-duplicate pattern.

**Honest flag:** the trickiest descriptions (memory-retrieval dials especially) describe *intended* (paper)
behaviour; revisit if real tuning behaves differently once built. Consistent with the feasibility posture.

**Commits:** registry descriptions (b2316bd); template/README/SESSION-LOG alignment + this entry to follow.

**Resume point unchanged: next surface is `surface-00-auth.md`** (UI-LOGIN, UI-2FA-*, UI-INVITE-SETUP,
UI-REAUTH-PROMPT, UI-SUPPORT-REQUESTS). Follow the Phase 3 playbook steps; copy `_TEMPLATE.md`; the C0 FRs
(`component-00-login.md`) are the FR source. FR bindings (from the sufficiency test): UI-LOGIN → FR-0.AUTH.001/
.002/.004/.005/.009 + FR-0.REC.001; UI-2FA-ENROLL → FR-0.AUTH.006; UI-2FA-CHALLENGE → FR-0.AUTH.007/.008;
UI-INVITE-SETUP → FR-0.INV.004/.005 (+ FR-0.SEED.002 reuse); UI-REAUTH-PROMPT → FR-0.SESS.003/.004/.006/.007;
UI-SUPPORT-REQUESTS → FR-0.REC.002/.003/.005/.006/.007.

**Self-sufficiency test RUN before this handoff (zero-context agent, 2026-06-28) → verdict: resumable, and the
gaps it found are now PATCHED:**
- **Phantom role model (blocking-quality)** — `_TEMPLATE.md` + signed-off `surface-01` Access tables used
  non-existent "Advanced/Basic Member" roles. **FIXED** → the six canonical C1 roles (Super Admin, Admin,
  Finance, HR, Account Manager, Standard User); template now carries a "use the six roles, never invent" note.
- **`PERMISSION_NODES.md` did not exist** (referenced 35×, owed since ADR-006). **CREATED** at repo root — the
  canonical catalog, 37 nodes harvested from C0–C10 + config, fields per FR-1.PERM.005 (Description / Default
  roles / Scope / Added-in); 5 unseeded stubs flagged ⚠️ (default-deny per OD-030).
- **Surface count 13-vs-14** — playbook header said "13 files". **FIXED** → 14 (00–12 + 01b); README/SESSION-LOG
  already said 14.
- **`UI-CONFIG-AUTH` orphan + `surface-01b` listed-not-built** — **NOTED** in the playbook: UI-CONFIG-AUTH is
  absorbed into surface-01 `#auth` (not a standalone surface); surface-01b is a known not-yet-built link target.
- **Pre-existing, NOT patched (needs an operator decision, flagged for a future session):** C0 OWED-FR-1
  (missed/never-arriving webhook reconciliation homing, C0 L819–823) is still "confirm at sign-off" — it needs a
  component-ownership call (C2/C3/C7/C9) = a real OD, not a doc fix. Does not block surface-00.

---

## Session 29 — 2026-06-28 — PHASE 3 ENTERED (SURFACES) — PRE-ENTRY PASS + C9 CHANGE-CONTROL ADDENDUM

**Phase 3 entered.** Pre-entry pass completed: surface inventory collected (17 formal `UI-` stubs + 94 review-scaffolding entries + `UI-config-admin` 11 sections from Phase 2 Appendix B), consolidated into ~12 logical surface files, ordering agreed. `spec/03-surfaces/` exists and is empty — ready.

**Inputs reviewed:** operator's `AIOS_prototype.html` prototype (31 planned dashboards) + `AIOS Dashboard Planning.md`. Key finding: the vast majority of planned dashboards map cleanly to existing Phase 1 FRs. The `s-c-*` control-plane screens (Fleet Clients, Deploys, Health, Provisioning, Migrations, Workflows, Cost, Plugins) map to C7 MGM + C10 and will be Phase 3 surfaces.

**V2 deferrals logged (OOS-034–038):**
- OOS-034: Objectives / OKR hierarchy
- OOS-035: Projects (task grouping)
- OOS-036: Priority Matrix / Eisenhower grid
- OOS-037: Brain Dump (quick-capture scratchpad)
- OOS-038: Field Ops / Mission Manager

**Credential Vault resolved:** platform secrets = env-only (Phase 2, Group N, class SECRET — no UI). Connector OAuth status = visible via management-plane surfaces. No standalone vault UI.

**C9 change-control addendum — DONE:** +FR-9.CMD.006–008 (user-defined custom commands — the "Commands" feature):
- Operator vision: user-defined slash commands that work like Claude Code skills — `/command-name` → inline result in chat, no async queue, no task_queue entry.
- FR-9.CMD.006: custom command definition (slug, prompt template, assigned agent, PERM node) stored in `commands` table.
- FR-9.CMD.007: custom commands registered in CMD dispatch alongside system commands; slug collision with system commands rejected at save.
- FR-9.CMD.008: invocation — template resolved with `$ARGUMENTS`, dispatched to assigned agent, result inline with answer-mode pill; same C6 guardrail pipeline as any agent run.
- C9 header updated: CMD ×5 → ×8, 28 FRs → 31 FRs. Matrix rows added. PERM stub `PERM-commands.manage` (→ PERMISSION_NODES.md, C1 FR-1.PERM.005; default Super Admin + Admin). DATA stub: `commands` table (→ Phase 4).
- UI surface: `UI-COMMANDS` added to Phase 3 surface list (Commands management screen where admins create/edit custom commands).

**Surface ordering agreed for Phase 3:**

| # | File | Coverage |
|---|---|---|
| 00 | `surface-00-auth.md` | UI-LOGIN, UI-2FA-*, UI-INVITE-SETUP, UI-REAUTH-PROMPT, UI-SUPPORT-REQUESTS |
| 01 | `surface-01-config-admin.md` | UI-config-admin #auth…#secrets (11 sections) — Phase 2 Appendix B carry-in |
| 02 | `surface-02-user-mgmt.md` | UI-USER-MGMT, UI-ROLE-MGMT, UI-PERMISSION-MATRIX, UI-CLEARANCE-*, UI-RESTRICTED-GRANT |
| 03 | `surface-03-ingestion-queue.md` | UI-INGESTION-QUEUE, conflict review queue |
| 04 | `surface-04-approval-queue.md` | Approval queue dashboard (C6 tiers) |
| 05 | `surface-05-dashboard-ops.md` | Ops dashboard: system health, connector health, event log, DLQ, cost, guardrail log, self-improvement |
| 06 | `surface-06-dashboard-super-admin.md` | Super Admin dashboard + management-plane screens (s-c-*): fleet clients, deploys, health, provisioning, migrations, cost, plugins |
| 07 | `surface-07-dashboard-agency.md` | Agency Owner + Manager view, activity feed, notification centre |
| 08 | `surface-08-dashboard-user.md` | Standard user view: My Workspace, Inbox, Decisions, chat |
| 09 | `surface-09-agent-builder.md` | Agent Fleet, Agent Builder / specialist config, Orchestration |
| 10 | `surface-10-commands.md` | UI-COMMANDS — custom command management (FR-9.CMD.006–008) |
| 11 | `surface-11-memory-nav.md` | Memory navigation / entity browser |
| 12 | `surface-12-mobile.md` | Mobile surfaces (6 sub-surfaces) |

**Surface-01 (Config Admin) — DONE ✅**
`spec/03-surfaces/surface-01-config-admin.md` — 613 lines. All 11 sections (#auth #memory #tools #prompts #loops #guardrails #observability #agents #proactive #infra #secrets), all 117 scalar + 11 secret + 10 structured CFG rows wired, all 5 states per section. OD-098–103 resolved (operator: "take your recs"): "System Config" nav · `UI-config-audit-log` separate surface (added to Phase 3 list — now 14 surfaces total) · desktop banner mobile · BOOT confirm only when dirty · `secret_manifest` deploy-hook table · per-section save. Verification gate CLEAN (all 4 checks PASS). Phase 4 stubs: `config_values` · `config_audit_log` · `secret_manifest`.

**Next: `surface-00-auth.md`** — UI-LOGIN, UI-2FA-CHALLENGE, UI-2FA-ENROLL, UI-INVITE-SETUP, UI-REAUTH-PROMPT, UI-SUPPORT-REQUESTS. Carry-in: C0 FRs (AUTH/SESS/INV/SEED/REC/WHK areas), Block J feasibility findings (Supabase Auth vendor facts), ADR-006 §RLS session boundary.

---

## Session 28 — 2026-06-27 — PHASE 2 (CONFIG REGISTRY) ENTERED — HARVEST + REGISTRY DRAFTED, VERIFICATION-GATE CLEAN

**Phase 2 begun.** Output: `spec/02-config/config-registry.md` (authoritative) + `spec/02-config/_HARVEST.md`
(working artifact). **~117 scalar knobs + 11 secrets + 10 structured objects**, every row classified
(SECRET/BOOT/LIVE/REBUILD) · defaulted · validated · `PERM-`-gated · `UI-`-surfaced. **Zero `???`** —
Phase-2 gate met. Verification gate (independent zero-context subagent): **CLEAN PASS on all 6 checks**
(coverage 1:1 · zero-??? · class sanity · cross-key constraints satisfied by defaults · locks held ·
conflict resolutions applied).

**Method:** operator chose "full harvest first." 4 Explore subagents (C0–C3 / C4–C7 / C8–C10 component
sweeps + a design-doc tunable sweep). Then a 3-agent gap-hunt. Then descriptions added to every row (the
operator flagged the first draft was unreadable — descriptions had been stripped; restored). Then the
registry built with per-GROUP PERM/UI assignment (not per-key — every knob in a group shares one
`PERM-config.<group>` gate + one `UI-config-admin#<group>` section).

**The gap-hunt payoff (real omissions caught, not in any FR):**
- **8 platform SECRETs** missing → new group N: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `INNGEST_API_KEY`,
  `X_INTERNAL_TOKEN` (mgmt-plane push auth, ADR-001 §7), the 3 connector signing secrets, the Google
  Pub/Sub key.
- **`ef_search`** (memory recall/latency dial, design L1511) — no CFG stub existed.
- **12 design-block knobs** with no FR home (4 ranking weights, 6 polling intervals, default/lightweight
  model, checkpoint thresholds, push frequencies, a few alert thresholds) — registered, additive, no
  change-control needed.
- **Alert routing has NO owner** (genuine Phase-1 hole, not a harvest miss) → **OD-097**.

**Decisions (operator delegated, "i trust your recs"):**
- **3 conflicts** resolved locked-spec-beats-stale-design: `parallel_execution_enabled`=false ·
  `embedding_model`=REBUILD (not BOOT) · `invite_link_ttl`≤24h / `access_token_ttl`=1h (design's 72h/7d
  were refuted by Block J).
- **2 class calls:** `entity_types`=BOOT · `default_model`/`lightweight_model`=BOOT.
- **OD-097** → C7 owns a small alert-routing config (`SLACK_WEBHOOK_URL` secret + `alert_routing_rules` /
  `escalation_contacts` / `quiet_hours` editable, Slack+email), recipients via C1 roles.

**Three-tier mental model agreed with operator (frames the whole phase):** Tier 1 = day-to-day record
management (users/roles/agents/memory curation) → Phase 3 surfaces + Phase 4 data, NOT config. Tier 2 =
harness tuning knobs → this registry. Tier 3 = secrets → env-only. "Customisable where it *should* be" =
bounded on purpose: the seven hard limits, sole-writer identity, and floored autonomy rows are
deliberately LOCKED, marked as such, never specced as editable.

**Downstream wiring captured (Appendix B):** 11 new `PERM-config.*` nodes owed to `PERMISSION_NODES.md`
(C1 FR-1.PERM.005); new `UI-config-admin` surface + 11 sections owed to Phase 3.

**C7 alert-routing addendum — DONE (change-control, same session).** OD-097's behavioural half realised as
**`FR-7.ALR.009`**: C7 owns the routing config; an alert with no deliverable destination fails loud (persists on the
dashboard + raises an "alert delivery misconfigured" critical condition on the mgmt-plane push); quiet-hours can
never silence a critical/hard-limit alert; a config write that would strand a critical alert is rejected fail-closed.
C7 header 33→34 FRs (ALR ×8→×9), matrix row added, OD-097 CLOSED. (Reuses the ALR.005/006/008 patterns.)

**Proposed defaults — CONFIRMED & locked** (operator: "as long as i can edit these later i am happy", 2026-06-27).
~30 knobs Phase 1 left blank were given starting defaults; `(proposed)` tags stripped. All are LIVE/BOOT —
operator-editable post-deploy via `UI-config-admin`. Confirmed editability was the operator's only condition.

**PHASE 2 SIGNED OFF (2026-06-27).** Registry complete + verification-CLEAN + OD-097 closed + defaults confirmed.
README Phase-2 row → 🟢 COMPLETE.

**Next: Phase 3 — Surfaces.** First surface to spec is `UI-config-admin` (the screen that renders this whole
registry, sectioned per group), then the Tier-1 day-to-day management screens (User Management, Permission Matrix,
Agent Builder, the 5 observability dashboards, memory navigation). Carry-in for Phase 3: Appendix B's new
`UI-config-admin` + 11 sections; the per-component panel-signal seams C7 left for Phase 3.

**Commits:** registry (f607751); C7 addendum (254a2ff); defaults-confirmed + sign-off to follow this entry.

---

## Session 27 — 2026-06-27 — COMPONENT 10 (INFRASTRUCTURE & COMPLIANCE) DRAFTED, VERIFIED & APPROVED — **PHASE 1 COMPLETE** 🎉

**The FINAL Phase-1 component** — the deployment / management-plane / lawful-deletion layer. Output:
`spec/01-requirements/component-10-infra-compliance.md` (**34 FRs, all Approved**), `system-map/10-infra-compliance.md`,
34 matrix rows, OD-089…OD-096 logged+resolved, feasibility **block U (AF-132…AF-137)**, OOS-033. **Two carry-in
Phase-1 debts cleared via change-control (OD-068, OD-074).** With C10 Approved, **Phase 1 (C0–C10, all 11 components)
is COMPLETE.** Next: Phase 2 (Config).

**The key scope finding (set with the operator up front):** the design doc's literal `## 10.` section (**L3919–4112**)
is **only compliance** (retention / individual erasure / client offboarding). The **infrastructure** half is decided
in the **ADRs (001/005/008)** and lives in orphaned design lines (deployment model L15–36, migration propagation
L1138–1160, the management plane / `client_registry` L1164–1240) that **no component C0–C9 claimed**. Since "every
design line → ≥1 FR, no orphans" is the definition of done and C10 is the last component, those orphans had to land
here. **Operator chose (AskUserQuestion): "functional infra + compliance in C10; backup/DR → Phase 5."** Backup/DR
(ADR-008) is only *referenced* — already routed to Phase 5 (C2 AC-2.MNT.017.2, README Phase-5 row).

**Area codes:** RET ×2 · DEL ×7 · OFF ×6 · PRV ×4 · MGT ×4 · DEP ×5 · MIG ×2 · ISO ×3 · LEG ×1. **C10 owns:** the
**intentional-retention** principle + retention configs · the **individual right-to-erasure** workflow (intake queue →
identify → conditional delete → redaction → audit → connector-flag → two-person auth; **wraps C2 FR-2.MNT.017**, does
not re-spec it) · the **client offboarding** workflow (trigger → verified export + client sign-off → retention-freeze
→ hard-delete/deprovision → compliance meta-record) · **provisioning** orchestration (ADR-005 §5) · the **release
model** (Railway auto-deploy · canary/release-train promotion gate · rollback-by-redeploy/no-down-migration ·
version-skew alert · plugins-out-of-train) · **schema-migration propagation** + per-deployment failure isolation · the
**management plane** (`client_registry` schema/lifecycle + the ingest endpoint, push-only, ADR-001 §7) · **isolation**
(`client_slug` deleted from app tables) + **residency** (v1 Sydney lock, v2 selection). **Seams:** erasure mechanics →
C2; log redaction → C7; token revocation → C3; seed → C0/C1; reporter+dashboards+staleness → C7; backup/DR → Phase 5;
rendering → Phase 3.

**Drafting:** two Explore subagents — one decomposed the §10 compliance lines, one mapped the infra ADRs + orphaned
deployment/management-plane design lines + checked what's already owned. Caught up front: cold-storage tiering is
**already OOS-016** (v2-deferred), not a new FR; individual erasure overlaps C2 FR-2.MNT.017 (C10 wraps, C2
mechanises).

**8 ODs resolved (OD-089…096), all delegated to recommendation; 5 touch the non-negotiables:** **OD-089 (#2/#3)**
offboarding partial-deprovision → `deletion_failed` + escalate, never-complete-on-partial, no-auto-rollback (OD-010
consistent). **OD-090 (#1)** export verified-complete **and** client-acknowledged = hard gate before destruction.
**OD-091 (#2/#3)** deployment-freeze enforcement → C10 sets `status=frozen`, **C5 dispatch layer enforces + fails
closed** (applied via change-control to **AC-5.TRG.001.3**, mirroring the C8 OD-081 memory-scope wiring). **OD-092
(#1/#2)** erasure name-in-content → deterministic auto, fuzzy human-confirm. **OD-093 (#2)** two-person auth = distinct
authoriser (no self-second). OD-094 (manual promotion v1), OD-095 (skew defaults 3/14). **OD-096 (#2 isolation, raised
in drafting):** the `client_slug` **label-vs-delete** tension — ADR-001 §3 (Accepted) says "deleted from all app
tables" but prior components reconciled only to "a label, not an RLS key." Carried to the **ADR terminus: delete**
(the column was never load-bearing; reverses no prior decision; Phase-4 creates no column).

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass — CLEAN.** Zero orphans (every §10 + infra cross-cut intent maps to an FR/seam/OOS),
  **all 6 traps PASS** (`client_slug` deleted + OD-096 reconciled · backup/DR seamed-not-owned · management plane
  push-only + metadata-only · erasure delegated to C2 · deletion deliberate-never-partial-silent · 10/10 citations
  sound), all 3 change-control edits consistent.
- **Quality/failure pass — 9 findings (2 HIGH, 4 MED, 3 LOW), ALL reconciled in-file.** **H1** a frozen deployment
  would false-alarm as *dead* (and a dead one could hide as *frozen*) → **+AC-10.OFF.004.4** (`status`
  server-authoritative, consumed by C7 staleness — frozen = expected-quiet not dead-alert, while Supabase
  project-health is still independently monitored — a #1 silent-deletion guard). **H2** export-verification could fail
  *open* → **+AC-10.OFF.002.4** (fails closed; only affirmative verified-complete advances). **M1** the C2 erasure C10
  calls had no verify-complete/fail-closed guarantee (OD-074 widened it across a C2→C7 boundary) → **+AC-10.DEL.003.4**
  (verify C2 complete before the audit-done) + **C2 AC-2.MNT.017.5** (verified-complete-or-fails-loud) + **AF-137**.
  **M2** fail-open in two-person-config / connector-flag-raise / ack-write → +AC-10.DEL.006.4 + AC-10.OFF.003.4. **M3**
  offboarding progress + meta-record must be management-plane-resumable → +AC-10.OFF.005.4. **M4** token revoke could
  orphan a live credential → +AC-10.OFF.005.5 (revoke first / re-driven). **L1** RET.001 had no enforcement consumer →
  +AC-10.RET.001.3 (C2 sole-writer + tombstone is the detector). **L2** header count fixed (34). **L3** neighbouring
  stale notes cleaned (C5 header, C7 carry-forward).

**Two Phase-1 debts cleared this session (change-control — the last component is where they had to land or leak past
Phase 1):**
- **OD-068** → wrote the owed **C6 FR-6.RTL.004** (cost-ladder enforcement: C7 meters → C6 decides → C5 executes;
  soft→throttle→hard-kill; never overrides a hard limit; every rung writes `guardrail_log`). OD-068 carry-forward
  CLOSED.
- **OD-074** → amended **C2 FR-2.MNT.017** (**AC-2.MNT.017.4**) to trigger the C7 log redaction-tombstone
  (`event_log`/`guardrail_log`) on erasure, called from C10 FR-10.DEL.004. The two stale C7 carry-forward notes
  flipped to ✅ CLOSED.

**Sign-off:** user-authorized 2026-06-27 ("i approve, push to github and main"; OD-089…096 delegated, the
C2/C5/C6/C7 change-control amendments accepted). **34 FRs `Approved`.** **No build-time viability gate holds any C10
FR** — AF-132…137 gate the deprovision/export/erasure/freeze/legal/erasure-verify *claims* (block U), not the FR
machinery.

**Files changed:** `component-10-infra-compliance.md` (new, 34 FRs Approved); `component-06-guardrails.md`
(+FR-6.RTL.004, OD-068); `component-02-memory.md` (+AC-2.MNT.017.4/.5, OD-074 + gate M1); `component-05-harness.md`
(+AC-5.TRG.001.3 freeze gate, OD-091; header note); `component-07-observability.md` (2 carry-forward notes → CLOSED);
`open-decisions.md` (OD-089…096 → 🟢; OD-068 carry-forward CLOSED; next OD-097); `feasibility-register.md` (block U
AF-132…137; next AF-138); `out-of-scope.md` (OOS-033; next OOS-034); `traceability-matrix.csv` (34 C10 rows);
`glossary.md` (+7 terms — client_registry, internal_token, client offboarding, deployment freeze, individual erasure,
deletion audit log, offboarding meta-record); `system-map/10-infra-compliance.md` (new); `system-map/README.md` (10 ✅
built); `README.md` (Phase 1 → COMPLETE + C10 row); this log.

**Carry-forwards / housekeeping:** (1) **Phase 4 (data model):** create **no `client_slug` column** in any app table
(OD-096); the three "label, not RLS key" mentions (C5 FR-5.QUE.002, C2, C6 `guardrail_log`) get a one-line clerical
reconciliation note then. (2) **Phase 3 surface seam (H1):** wire C7's staleness path to read `client_registry.status`
(frozen ≠ dead-alert) + independently monitor Supabase project-health — a small C10↔C7 seam at the C7/Phase-3 pass.
(3) New nodes to register at C1 reconciliation / Phase 2: the C9 `PERM-guardrail.edit_autonomy` + `/`-command nodes
(carried from session 26). (4) AF-132…137 + the carried-in AF-004/013/020/064/065/066/071 are build-time MUST-TEST.

**NEXT STEP — Phase 1 is COMPLETE. Begin Phase 2 (Config registry).** Per the README plan: classify + surface every
tunable — "every CFG has a surface + edit-mechanism + validation; zero `???`." The `CFG-*` ids scattered across
C0–C10 FRs (e.g. C10's `client_offboarding_retention_days`, `deploy_max_version_skew`, `canary_soak_minutes`,
`deployment_region`; the C9 autonomy matrix; the C6 thresholds; the C2/C5 windows) are the raw input — Phase 2
consolidates them into the config registry (`spec/02-config/`). Read `phase-playbooks.md` for the Phase-2 procedure
before starting.

---

## Session 26 — 2026-06-27 — COMPONENT 9 (PROACTIVE INTELLIGENCE) DRAFTED, VERIFIED & APPROVED — "what it does without being asked"

Tenth Phase-1 component, the **proactive-generation + cold-start-gating + chat-command layer**. Output:
`spec/01-requirements/component-09-proactive.md` (**28 FRs, all `Ready`**, gate-clean, **awaiting operator
sign-off**), `system-map/09-proactive.md`, 28 matrix rows, OD-082…OD-088 logged+resolved, feasibility block T
(AF-127…AF-131), OOS-031/032. A C6 Approved FR amended via change-control (OD-088). Pattern-matched the C0–C8 loop.

**C9 = "what it does without being asked"** (L3654). Area codes: MODE ×4 · PRO ×7 · SUG ×5 · CST ×7 · CMD ×5. C9 owns
the **three proactivity modes** (Suggest/Prepare/Act, mode = f(C6 risk tier), **no-bypass** — every Act traverses the
same C6 pipeline), the **7 generators** (relationship/meeting/doc/derisking/opportunity/daily-briefing/pattern; each
independently enable/disable-able + thresholded), the **suggestion lifecycle** (`proactive_suggestions` store, rank /
explain-with-pill / deliver-route / **dismissal-learn-with-floor**), the **cold-start phase ladder** (consumes C2's
phase, owns proactive-suppression), and the `/` **command dispatch** (node-gated). Enforcement → C6, slow-loop +
briefing trigger → C5, Insight-Agent def → C8, coverage/`[Building]` → C2, delivery → C7, all rendering → Phase 3.

**Scope call (entry): generation + cold-start policy + command dispatch now; enforcement / delivery / surfaces / the
coverage metric stay seamed.** A large fraction of section 9 is owned by Approved components (the coverage metric
already C2 FR-2.MAT.002/RET.007; the slow loop C5 FR-5.LOP.001; the Insight Agent C8 FR-8.SPC.006; notification C7;
guardrails C6). C9 **produces** proactive items + assigns mode + gates the engine; home components enforce/schedule/
deliver/render. Mirrors C8's "produce signals, others act" + C7's "backbone now, surfaces → Phase 3."

**The founder-holiday problem (L3792–3864)** is handled as an **integration narrative** (no orphan — the 8
break-points map to C2/C4/C5/C6/C7/C8/C9); the founder-prep checklist + initialisation guide = operational documents
→ **OOS-031/032**.

**7 ODs delegated + 1 operator-decided (OD-082…OD-088):** OD-082 dedicated `proactive_suggestions` store
(never-dropped; Prepare → linked C5 task). **OD-083 (#2)** proactive Act never bypasses C6 (no second risk
classifier). **OD-084 (#1/#3)** dismissal-learning floor — tunes *volume*, never *safety*; a derisking signal is never
silenced + re-surfaces on escalation. OD-085 cold-start: C2 emits phase, C9 owns policy matrix + suppression, rest
seamed. **OD-086 (#2, contradiction caught)** `/`-command gating → **C1 permission nodes, not the design's "Agency
Owner" role** (which is NOT one of C1's six — same class as C7/C8 `client_slug`). OD-087 founder docs → OOS.
**OD-088 (operator-decided #2 → option b)** — the **configurable action-autonomy matrix**: the operator flagged that
C6's blanket "all external comms = hard" (FR-6.APR.002) is too blunt — a cold-lead nurture email can't even be
drafted. Split: **low-risk external** (cold-lead / templated nurture to **non-client** contacts) → configurable down
to Prepare or up to **Act after a trust period** (rate-capped + audited); **floored** (existing-client / SoR comms,
financial, Confidential/Restricted) → **fixed at hard, never configurable below**. **Applied via change-control to
C6 FR-6.APR.002 + FR-6.APR.003** (narrow the mandatory-hard "external" element; reconcile the no-irreversible-auto
rule to "floored-external") + **new FR-9.MODE.004** (the matrix + the floor; `CFG-action_autonomy_matrix`; edits
gated `PERM-guardrail.edit_autonomy` Super-Admin). Also added: each of the 7 PRO scanners individually
enable/disable-able (default on) + thresholds → `CFG-scanner_*_enabled` refs for Phase 2.

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass — CLEAN.** Every intent L3650–3918 maps to an FR / correct seam / OOS; **all 6 traps
  PASS** (no "Agency Owner" role — node gating · consumes C2 coverage, never recomputes · proactive Act never
  bypasses C6 · OD-088 floored set can't be lowered to Act/Prepare · Insight Agent not redefined / no second writer ·
  14/14 citations verified); no `client_slug`. Two editorial nits fixed (stale FR count; a MAT.002/003 citation).
- **Quality/failure pass — critical floor-check NO HOLE + 9 findings (2 HIGH, 4 MED, 3 LOW), ALL reconciled.** The
  **operator-requested critical check** confirmed **nothing financial / existing-client / SoR / Confidential /
  Restricted can reach autonomous Act** through the new matrix — defended in depth (write-time reject 004.2 →
  mode-assign floor 002.2 → C6 tier floor AC-6.APR.002.1/.3 → ambiguity-defaults-floored 004.3 → non-overridable
  hard-limit backstop), OD-056 irreversibility exception bounded to non-client low-risk + rate-capped. **H1** (the
  residual the floor-narrowing *introduced*): a *confident-but-wrong* client/content tag is the one unguarded route →
  **+AC-9.MODE.004.5** (re-resolve recipient client-status vs the system-of-record **at send time**, re-floor on
  match) + **AF-131** (classification-accuracy EVAL). **H2** Insight-detected escalating risks have no C6/C7 path →
  sharpened AC-9.CST.002.3 + **+AC-9.PRO.004.4** (OD-084 floor spans dismissal **+** cold-start suppression **+**
  scanner-disable). **M1** deferred floor item silent-expiry → +AC-9.SUG.002.3. **M2** stuck-`generated` →
  +AC-9.SUG.001.4 (escalate-don't-abandon). **M3** node-gate-before-confirm + `/forget`→C2 trace → +AC-9.CMD.003.3.
  **M4** floored-caps-mode precedence → +AC-9.MODE.004.6. **L1** scan-execution liveness, **L2** stale-phase
  fail-open, **L3** audit-critical command fail-closed on log failure — all added.

**Sign-off:** user-authorized 2026-06-27 ("i am happy"; OD-082…087 delegated, OD-088 operator-decided, the C6
change-control amendment accepted). **28 FRs `Approved`**; matrix rows + headers + README + system-map README flipped
to Approved; committed + pushed to `main`. **No build-time viability gate holds any C9 FR** — AF-127…131 gate the
detection/learning/ranking/ETA/tag-accuracy *claims* (block T), not the FR machinery; **AF-131** is the load-bearing
one (the OD-088 floor's #2 safety rests on the non-client/content classifier).

**Files changed:** `component-09-proactive.md` (new, 28 FRs Ready); `component-06-guardrails.md` (FR-6.APR.002/003
amended, change-control OD-088); `open-decisions.md` (OD-082…088 → 🟢; next OD-089); `feasibility-register.md` (block
T AF-127…131; next AF-132); `out-of-scope.md` (OOS-031/032; next OOS-033); `traceability-matrix.csv` (28 C9 rows);
`glossary.md` (+6 terms — proactivity mode, proactive suggestion, cold-start phase, action-autonomy matrix, floored
external comms, dismissal-learning floor); `system-map/09-proactive.md` (new); `system-map/README.md` (09 ✅ built);
`README.md` (status + Phase-1 row); this log.

**Carry-forwards / housekeeping:** (1) **AF-131** (non-client/content classification accuracy) is the new
load-bearing build-time gate — the OD-088 floor's #2 safety rests on it; MUST-TEST. (2) The OD-088 + OD-086 new nodes
(`PERM-guardrail.edit_autonomy` Super-Admin; the per-command `/` gating nodes) to register at the C1 reconciliation /
Phase-2 config. (3) Still owed from earlier: the **C6 cost-ladder enforcement FR** (OD-068) + **C2 FR-2.MNT.017**
log-sink erasure amendment (OD-074). (4) AF-127…131 are build-time MUST-TEST.

**NEXT STEP — component 10 (Infrastructure & Compliance), the FINAL Phase-1 component.** Design-doc section
**`## 10. Infrastructure & Compliance` = L3919+** (confirm the end bound — `## Where the quality actually lives` at
L4113 is likely the next `##`). Pattern-match the C0–C9 loop: Context Manifest → decompose → cite → log ODs (next
**OD-089**; new AFs from **AF-132**; next OOS **OOS-033**) → resolve → verification gate (2 zero-context subagents) →
sign-off → wire matrix + build `system-map/10-infra-compliance.md`. **C10 is where the deployment/infra ADRs land:**
ADR-001 (Silo isolation + hybrid ownership + the management plane), ADR-005 (deploy/provisioning — canary +
release-train + scripted provisioning), ADR-008 (backup/DR — hourly client-owned snapshot + PITR upsell +
operator-verified restore), and the **compliance** surface (data residency, the GHL PHI/BAA chain AF-098, erasure
already homed in C2 FR-2.MNT.017 + C7 redaction-tombstone). **Carry-ins:** the owed C6 cost-ladder FR (OD-068) + C2
MNT.017 log-sink amendment (OD-074); the self-hosted-Inngest deferral (OOS-028); build-time spikes AF-001/002/004 +
the provisioning AF-004; backup/DR block I (AF-069…072). **C10 may be a connector-research trigger** only if it
introduces a new external sink (e.g. a paging/infra vendor). **First, finish C9: get the operator's sign-off + commit.**

---

## Session 25 — 2026-06-26 — COMPONENT 8 (AGENT DESIGN) DRAFTED, VERIFIED & APPROVED — "who does the work"

Ninth Phase-1 component, the **routing + agent-definition layer**. Output: `spec/01-requirements/component-08-agent-design.md`
(**37 FRs, all Approved**), `system-map/08-agent-design.md`, 37 matrix rows, OD-075…OD-081 logged+resolved, feasibility
block S (AF-121…AF-126), OOS-030. Pattern-matched the C0–C7 loop end-to-end in one session.

**C8 = "who does the work"** (vs C5 what makes it run). Area codes: ORC ×8 · REG ×6 · SPC ×6 · SCO ×3 · PLAN ×4 ·
HLTH ×4 · LRN ×3 · COST ×3. C8 owns the **orchestrator + 7-step description-driven routing**, the **`agents`
registry** (data-driven, versioned, auto-discovered), the **8 specialist definitions** + their hard limits,
**per-agent memory scoping**, **per-step failure-mode ASSIGNMENT** (C5 executes), **agent-health / drift /
dead-agent metric PRODUCTION** (flag-never-auto-correct), **orchestrator learning + result caching**, and
**cost-routing by complexity** + the confidence dial.

**Scope call set at entry: routing + definitions + metric-production now; execution / surfaces / healing stay
seamed.** A large fraction of the design section (L3371–3649) is already owned by Approved components — the context
envelope + retry/skip/halt execution + parallel/warm-up/checkpoints (C5), self-healing mechanisms (C2/C3/C5), the
dashboards (C7 + Phase 3), suggestion generation (C9), cost metering/enforcement (C7/C6), prompt content (C4). C8
**produces signals**; their home components surface/enforce/act. This kept C8 at 37 FRs and mirrors C6's "seam, don't
absorb" + C7's "backbone now, surfaces → Phase 3."

**Drafting:** an Explore subagent decomposed L3371–3649 + the cross-cut sites (checklist L321–335, `agents_config`
L945–965, failure-map drift/dead-agent rows L2845–2847, observability intervals L3120–3128/L3210–3220, orchestrator
own Layer 1 L2390) into ~112 intents pre-classified C8-OWN vs SEAM→Cx. Read the primary section directly to ground
the routing/registry/scoping cites. **Carried in OD-048's deferral** — `agents.system_prompt` reconciled here.

**7 ODs logged then resolved (OD-075…OD-081), 3 user-delegated #1/#2/#3:** **OD-076 (#1)** agent result cache →
scope-aware + time-bounded invalidation (write-triggered by the Memory Agent commit, miss-on-uncertainty — never a
stale hit). **OD-077 (#3)** low-confidence clarification → tracked + escalating (reuse C5 AC-5.QUE.005.2), never
silent park/auto-proceed. **OD-080 (#2)** registry edits → split by authority: capability grants
(memory_scope/tools_allowed/enabled) = Super Admin only; description/weight tuning = Super Admin + Admin. Plus
OD-075 (drop `system_prompt`, closes OD-048), OD-078 (drift/dead-agent flag-only, never auto-disable), OD-079 (seed
roster at provisioning). **All delegated** ("accept all my recommendations"). **OD-081 (#2)** was raised *by the
gate* — see below.

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — every intent L3371–3649 + cross-cut sites maps or is correctly seamed; 5/6
  traps PASS, the 6th (citations) clean in spot-check. **Caught a real contradiction:** the design's
  `agents.client_slug` column contradicts **ADR-001 §3** (Silo model deletes `client_slug` from app tables) — C8
  was mis-citing ADR-001 §3 to *keep* it. **Dropped the column**, mirroring C7 OD-067; AC-8.REG.001.3 rewritten.
  Plus a dead citation `FR-2.RST.003` → `FR-2.RET.006`/`C1 FR-1.RST.003`, and `FR-5.TRG.*` slow-loop → `FR-5.LOP.001`.
- **Quality/failure pass — 10 findings (3 HIGH, 4 MED, 3 LOW), ALL reconciled.** **H1 (the structural hole):** the
  per-agent `memory_scope` matrix (the whole SCO area) had **NO enforcement consumer** — C2 enforces clearance/RLS,
  C5 FR-5.ASM.006 invokes it with task-clearance + task-entities, but nothing applied "which agent is running" at
  retrieval (#2 unwired, most acute for the `service_role` orchestrator narrowed by *nothing*). → **OD-081 resolved +
  applied via change-control** (the C7 in-session-fix precedent): **+AC-5.ASM.006.2** (harness passes the agent's
  `memory_scope` into the C2 read, **fails closed**) + **+AC-2.RET.004.2** (C2 drops out-of-agent-scope candidates
  before ranking, narrow-within-clearance); SCO.001 rewritten as a real retrieval filter (+AC-8.SCO.001.3
  fail-closed). **H2** orchestrator crash mid-route (dequeue→plan-persist) → +AC-8.ORC.001.3 idempotent re-route,
  never dequeued-but-unplanned. **H3** metric-producer silent stall → +AC-8.HLTH.004.2 producer liveness/heartbeat
  for HLTH.001/003 + LRN.002 (mirrors HLTH.002.2 + C5 AC-5.JOB.006.2). MED/LOW: +AC-8.LRN.003.2/.3 (write-triggered
  cache invalidation + miss-on-uncertainty, M4), ORC.008 service_role note (M5), +AC-8.SPC.003.3/.004.3 +
  AC-8.REG.006.3 (Comms/Finance tool-grant reject-at-write + positive seed check, M6), C6 cost-ladder carry-forward
  kept tracked (M7), +AC-8.ORC.007.2 secondary sink (L8), +AC-8.REG.005.3 warn-at-disable-last-agent (L9),
  +AC-8.PLAN.002.2 halt-escalate staleness (L10). Meta: C8 upholds the three non-negotiables; the biggest residual
  (H1) is now wired, not asserted.

**Sign-off:** user-authorized ("Sign off — Approve C8"; OD resolution delegated). 37 FRs `Approved`. **No build-time
viability gate holds any C8 FR** — AF-121…126 gate the routing/detection/cache/learning *accuracy claims*, not the
FR machinery (gate analog of C4 AF-111 / C6 block-Q / C7 block-R).

**Files changed:** `component-08-agent-design.md` (new, Approved); `component-05-harness.md` (+AC-5.ASM.006.2,
change-control OD-081); `component-02-memory.md` (+AC-2.RET.004.2, change-control OD-081); `open-decisions.md`
(OD-075…081 → 🟢; next OD-082); `feasibility-register.md` (block S AF-121…126; next AF-127); `out-of-scope.md`
(OOS-030; next OOS-031); `traceability-matrix.csv` (37 C8 rows); `glossary.md` (+7 terms — agent registry, memory
scope, routing/confidence score, drift/dead-agent detection, agent result cache, execution-plan version);
`system-map/08-agent-design.md` (new); `system-map/README.md` (08 ✅ built); `README.md` (status + Phase-1 row); this log.

**Carry-forwards / housekeeping:** (1) The **C6 cost-ladder enforcement FR** is still owed (OD-068) — C8 feeds it
(COST.003) but the throttle/kill enforcer doesn't exist; action when C6 is next touched. (2) AF-121…126 are
build-time MUST-TEST. (3) The OD-080 permission split implies new nodes `PERM-agent.edit_capability`
(Super-Admin-only) vs `PERM-agent.edit_routing` (Admin-allowed) — to wire at the C1 reconciliation / Phase-2 config.

**NEXT STEP — component 9 (Proactive Intelligence).** Design-doc section **`## 9. Proactive Intelligence` = L3650+**
(confirm the end bound + next `##` at decomposition). Pattern-match the C0–C8 loop: Context Manifest → decompose →
cite → log ODs (next **OD-082**; new AFs from **AF-127**; next OOS **OOS-031**) → resolve → verification gate (2
zero-context subagents) → sign-off → wire matrix + build `system-map/09-proactive.md`. **C9 is where many C8/C7
seams land:** the **Insight Agent** (C8 SPC.006 produces its output; C9 owns the proactive/pattern generation), the
**self-improvement panel suggestions** (C7 reserves the surface + C8 produces the agent-health/drift/routing metrics;
C9 turns them into surfaced/guided suggestions — "agent X 40% failure", "version 3 outperformed 4", "type Y
rerouted"), and the **three proactivity modes** (L3658+). **Likely seams out:** the dashboards → C7 + Phase 3;
enforcement → C6; memory mechanisms → C2; routing metrics → C8 (done). **Carry-ins:** the C6 cost-ladder FR (owed,
OD-068) · build-time spikes AF-001/002/004 · the C8 block-S AFs · AF-068/116/117. **C9 is NOT a connector
component** (no research-first gate) unless it introduces a new external sink.

---

## Session 24 — 2026-06-26 — COMPONENT 7 (OBSERVABILITY) DRAFTED, VERIFIED & APPROVED — "how you know what it's doing"

Eighth Phase-1 component, the **observability backbone**. Output: `spec/01-requirements/component-07-observability.md`
(**33 FRs, all Approved**), `system-map/07-observability.md`, 33 matrix rows, OD-067…OD-074 logged+resolved,
feasibility block R (AF-118…AF-120), OOS-028/029. Pattern-matched the C0–C6 loop end-to-end in one session.

**C7 = "how you know what it's doing"** — the data + logic layer of the three pillars (logging · monitoring ·
alerting). Area codes: LOG ×7 · RTP ×4 · ALR ×8 · COST ×4 · MGM ×5 · VIEW ×3 · OPT ×2. C7 owns the `event_log`, the
real-time-vs-polling contract, alerting (the 7 rules + routing + escalation + the engine watchdog), the cost meter +
ladder signal, the management-plane cross-deployment push (ADR-001 §7) + backup-health (ADR-008), and log
retention/export (incl. the C7 side of `guardrail_log`).

**Scope decision set with the operator up front: backbone now, surfaces → Phase 3.** C7 specs the observability
*functions* as Phase-1 FRs; the five role dashboards (Super Admin · Operations · Manager · Standard User · Mobile)
get only a thin "this view exists + RBAC-routed + sources these signals" contract, with full layout/state deferred
to the dedicated Phase-3 Surfaces pass. Each panel's *signal* is produced by its home component (C2/C3/C5/C6/C8/C9) —
C7 displays, it does not recompute. This kept C7 at 33 FRs and avoided both duplicating Phase 3 and usurping the
producing components. Mirrors C6's "seam, don't absorb" call. **The operator chose this** (vs full-dashboards-in-C7).

**Drafting:** an Explore subagent mapped L3031–L3328 → 80 intents + candidate area codes + the cross-cut sites that
land in C7. Read the primary section directly to ground the `event_log`/alerting/polling cites. **Caught up front:**
the `event_log` (L3048) + `guardrail_log` (L2896) schemas + the Realtime filters (L3085/3159) carry `client_slug` —
stale under the Silo model (ADR-001 §3 deleted it). Also grounded the cross-deployment views as **push,
operational-metadata-only** (ADR-001 §7), cost as **estimate-grade never the invoice** (ADR-003), and the three
distinct log sinks (OD-065).

**8 ODs logged then resolved (OD-067…OD-074), 2 user-decided:** **OD-068 (#2, user-decided)** cost-ladder enforcement
ownership → **C7 meters + signals, C6 decides, C5 executes** — grounded in **ADR-003 §"Guardrails component"** (the
cost ladder IS a C6 guardrail class). **OD-074 (#1/compliance, user-decided, surfaced by the gate)** erasure vs
append-only logs → **redaction-tombstone** (scrub PII in place, retain row + audit metadata). OD-067 (client_slug
drop intra-silo), 069 (escalate-don't-abandon), 070 (Slack-independent notification durability), 071 (stale-not-green
push), 072 (three-sink retention), 073 (per-silo connection budget + degrade-to-polling) — all delegated, all land
on (a).

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — zero orphaned design lines (every intent L3031–3328 + checklist L304–326 maps
  or is correctly seamed — surfaces→Phase 3, signals→home components, cost-enforcement→C5/C6); no contradictions with
  ADR-001/003/008, glossary, or consumed C1–C6 FRs; **all 6 traps PASS** (`client_slug` label-only · cross-deployment
  PUSH-not-pull, never mirrors business data · three distinct log sinks, C7 owns guardrail_log view/retention/export
  not its write-completeness · cost estimate-grade never the invoice · surfaces→Phase 3 no signal usurpation · 10/10
  citations clean). One finalization item (registers not yet wired) — done this session.
- **Quality/failure pass — 13 findings (4 HIGH, 5 MED, 4 LOW), ALL reconciled.** The reviewer's meta-finding: C7 has
  the strongest #3 instincts of any component so far; the residual risk was **the observability layer becoming its
  own silent single point of failure**, plus two real cross-component seam holes. **F1 (HIGH)** cost-ladder
  enforcement seam: verified against **ADR-003 §"Guardrails component" (L181–182)** → OD-068(a) is correct; the
  contradiction was **C5's seam line ("C7 enforces") + C6's never-written cost-ladder FR** → C5 line **corrected via
  change-control** (2 spots), the owed **C6 cost-ladder FR logged as a tracked carry-forward**, FR-7.COST.003
  re-cited to ADR-003. **F2 (HIGH)** → +AC-7.MGM.002.3 (independent-heartbeat stale-evaluator — the stale-detector
  can't itself fail silently) + AC-7.MGM.001.3 (reporter logs each push to the *local* event_log). **F3 (HIGH)/OD-074**
  → redaction-tombstone (+AC-7.LOG.006.3 / .007.4; **C2 FR-2.MNT.017 amendment owed** — carry-forward). **F7 (HIGH)**
  → +FR-7.ALR.008 (alert-engine heartbeat + independent watchdog — "the watcher is watched"). **F8** → AC-7.LOG.003.2
  out-of-band degraded path. **F9** → +AC-7.LOG.003.3 cross-sink event_log↔guardrail_log reconciliation. **F6** →
  server-authoritative timestamps (AC-7.MGM.002.4 / AC-7.ALR.005.3). **F10/F11/F12** → cost-unknown sentinel,
  configurable connection-headroom threshold, pill-coverage thresholding seamed to C2. **F4/F5** → registers wired +
  statuses reconciled. AF-118 (absence-of-signal liveness), AF-119 (out-of-band durability), AF-120 (clock-sync) —
  all build-time, none holds an FR.

**Sign-off:** user-authorized — OD-068 + OD-074 decided directly, the rest delegated; gate clean + all 13 findings
reconciled in-file. 33 FRs `Approved`. **No build-time viability gate holds any C7 FR** (AF-118…120 gate the
silent-failure-detector *liveness/durability/correctness claims*, not the FR machinery — gate analog of C6's block-Q).

**Files changed:** `component-07-observability.md` (new, Approved); `component-05-harness.md` (cost-ladder seam line
corrected, change-control); `open-decisions.md` (OD-067…074 → 🟢; next OD-075); `feasibility-register.md` (block R
AF-118…120; next AF-121); `out-of-scope.md` (OOS-028 self-hosted Inngest, OOS-029 cross-deployment benchmarking;
next OOS-030); `traceability-matrix.csv` (33 C7 rows); `glossary.md` (+7 terms — notification centre, Supabase
Realtime, health reporter/push, staleness window, cost meter, answer-mode pill, redaction-tombstone);
`system-map/07-observability.md` (new); `system-map/README.md` (07 ✅ built); `README.md` (status + Phase-1 row); this log.

**Carry-forwards / housekeeping:** (1) **C2 FR-2.MNT.017** owes a change-control amendment to extend its transitive
erasure walk to `event_log` + `guardrail_log` (redaction-tombstone, OD-074). (2) The **C6 cost-ladder enforcement
FR** is owed — ADR-003 spawned it but C6 (session 23) didn't write it; tracked in OD-068; action when C6 is next
touched. (3) AF-118/119/120 are build-time MUST-TEST.

**NEXT STEP — component 8 (Agent Design).** Design-doc section **`## 8. Agent Design` = L3371–L3649** (next
`## 9. Proactive Intelligence` at L3650). Pattern-match the C0–C7 loop: Context Manifest → decompose → cite → log ODs
(next **OD-075**; new AFs from **AF-121**; next OOS **OOS-030**) → resolve → verification gate (2 zero-context
subagents) → sign-off → wire matrix + build `system-map/08-agent-design.md`. **C8 is where many C5/C7 seams land:**
the **orchestrator** (routing + confidence threshold — "the highest-leverage single tunable for cost vs quality",
L3632), the **agent registry** (`agents.system_prompt` — reconcile with C4 OD-048's unify-on-`prompt_layers`
decision), **agent specialisation drift detection** (L3642 — C7 reserves the surface, C8 produces the metric), and
**agent health / success-rate** metrics (C7 VIEW.001 displays them). **C8 also resolves the `agents.system_prompt`
single-source-of-truth** that C4 OD-048 deferred to C8. Likely seams out: observability/event-log → C7 (done);
proactive/insight-agent → C9; infra → C10. **Carry-ins:** the C6 cost-ladder enforcement FR (if C8 touches
orchestration cost), build-time spikes AF-001/002/004, AF-068/116/117, the C5 block-P + C7 block-R AFs. **C8 is NOT a
connector component** (no research-first gate) unless it introduces a new external sink.

---

## Session 23 — 2026-06-26 — COMPONENT 6 (GUARDRAILS) DRAFTED, VERIFIED & APPROVED — "what stops it doing something catastrophic"

Seventh Phase-1 component, the **enforcement layer** ("the code half" of system safety). Output:
`spec/01-requirements/component-06-guardrails.md` (**35 FRs, all Approved**), `system-map/06-guardrails.md`, 35
matrix rows, OD-060…OD-066 logged+resolved + carry-forwards **OD-047** and **OD-010** resolved, feasibility
block Q (AF-116…AF-117). Pattern-matched the C0–C5 loop end-to-end in one session.

**C6 = "what stops it doing something catastrophic"** (vs C5 what makes it run). Area codes: HRD ×4 · APR ×6 ·
ANM ×5 · RTL ×3 · ESC ×4 · INJ ×6 · LOG ×4 · OPT ×2 · FMM ×1. C6 owns the code-side enforcement of the four
guardrail layers (hard limits · approval gates · anomaly detection · rate limits), the escalation/flagged
workflow, the 4-step injection sanitization pipeline, the `guardrail_log`, and the optimisations. **ADR-007 is the
spine** (containment-first; detection-as-signal; semantic scan off-by-default; quarantine retains-not-discards;
0.85/0.95 are signal knobs not safety dials).

**Two scoping calls set up front (the architectural judgment):** (1) **the failure-mode map (L2821–2862) stays
SEAMED, not absorbed** — it's a cross-component catalogue; each row's detection lives in its home component
(C2/C3/C5/C8) + alert path is C7; C6 owns only the guardrail-class responses + the no-silent invariant (OD-061).
This kept C6 at 35 FRs instead of ballooning to 60+ and usurping C2/C3/C5/C8. (2) **hard limits are the
un-overridable layer, kept distinct from approval gates** (which ARE human-overridable) — L2066 vs L2782.

**6 new ODs + 2 carry-forwards resolved (OD-060…066 + OD-047 + OD-010):** **OD-047** (carry-forward, operator's
C3 flag) → **keep the seven hard limits absolute; gate-don't-promote coverage gaps** (bulk export / mass-delete /
connector spend route to hard-approval + rate caps, not new absolute limits — they keep a legitimate
human-authorized path); enforceability still gated on **AF-068**. **OD-060** (#2) → hard-limit hit = block+log+
alert, **no approve affordance** (the `status→approved` transition is invalid for `hard_limit`). **OD-064** (#2) →
soft-approval auto-executes **reversible-only** (irreversible is hard-tier by definition, reconciling C5 OD-056).
**OD-010** (#2, carry-forward) → **no auto-rollback** of external side effects (auto-compensation is itself an
autonomous action); instead show already-applied effects at review + queue a **human-visible cleanup task**;
irreversible effects surfaced as non-compensable. OD-061 (failure-map scope), OD-062 (rate-limit ownership split),
OD-063 (anomaly-as-signal severity), OD-065 (guardrail_log vs access_audit/event_log), OD-066 (semantic-off +
regex-quarantine) delegated to recommendation. **The four #2-touching (047/060/064/010) were surfaced to the
operator, who delegated** ("what do you suggest").

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — zero orphans (all L2746–3030 + the L2053–2066 / L2976–2980 cross-cuts map
  or are correctly seamed), no contradictions with ADR-007/003/004/006, glossary, or consumed C0/C1/C3/C4/C5 FRs;
  **all 6 traps PASS** (`client_slug` label-only · C6 never usurps C2/C3/C5/C8 detection — the failure-map scope ·
  hard-limit-not-overridable kept distinct · semantic-scan off-by-default + thresholds are signal knobs +
  quarantine retains · anomaly-as-signal · 12 citations spot-checked, no miscites).
- **Quality/failure pass found 12 findings (3 HIGH, 6 MED, 3 LOW), ALL reconciled in-file.** The reviewer's
  meta-finding: the posture-level safety logic was already sound; the real risk was **mechanism wiring** — a
  guardrail correctly designed but never run, or failing open. The 3 HIGH closed exactly those: **+AC-6.INJ.001.2**
  (the injection pipeline's named harness call site between tool-read and AI-call + a C5 step-order
  reconciliation note — H1, the silent-bypass seam); **+AC-6.FMM.001.3** (a guardrail check that **itself errors**
  fails CLOSED — the missing #3 invariant, H2); **+AC-6.LOG.003.3** (a `guardrail_log` write-failure is
  fail-closed — the block holds even if the row fails, never rolls back into the action proceeding — H3). MED/LOW:
  +AC-6.APR.005.3 (no self-approval at the human tier — initiator ≠ approver, M1), +AC-6.ESC.001.3 (multi-fire
  precedence — hard_limit dominates, M2), manifest tightened (mid-task re-check mechanism is C5 FR-5.ASM.005, M3),
  +AC-6.ESC.004.3 (every wait-point has a named staleness owner, M4), +AC-6.INJ.006.4 (quarantine-review
  staleness, M5), +AC-6.OPT.001.2 (un-actioned candidate persists, M6), +AC-6.LOG.001.3 (`pending` disambiguation,
  L1), AC-6.RTL.001.1 meaningful-ceiling clause (L2), OD-047 sub-question CLOSED so no open sub-question points at
  an Approved FR (L3). Confirmed great-tier: ADR-007 reconciliations faithful, hard-limit-vs-approval split handled
  at three layers (FR + AC + schema-status), failure-map scope discipline, OD-010's no-auto-rollback care.

**Sign-off:** user-authorized (delegated, "what do you suggest" on all four #2-touching ODs). 35 FRs `Approved`.
**No build-time viability gate holds any C6 FR** — AF-068 gates the *enforceability claim* of the hard limits
(HRD.001/OD-047), AF-116 the anomaly-accuracy claim, AF-117 the injection-library-coverage claim (the gate analog
of C4's AF-111 / C5's block-P).

**Files changed:** `component-06-guardrails.md` (new, Approved); `open-decisions.md` (OD-047 + OD-010 → 🟢,
OD-060…066 added → 🟢; next OD-067); `feasibility-register.md` (block Q AF-116…117; next AF-118);
`traceability-matrix.csv` (35 C6 rows); `glossary.md` (+7 terms — approval tier, anomaly detection, guardrail_log,
escalation timeout, contextual approval routing, quarantine, flagged); `system-map/06-guardrails.md` (new);
`system-map/README.md` (06 ✅ built); `README.md` (status table + Phase-1 row); this log.

**Carry-forward / housekeeping:** (1) **C5 step-order reconciliation (INJ.001.2)** — C5 FR-5.ASM.007's step order
should name the injection-sanitization step explicitly (it currently names only the anomaly check); raised as a
C5 change-control note, to action when convenient (does not block C7). (2) The self-hosted-Inngest deferral
(C5 FR-5.JOB.007) still owes an OOS id at C6/C10 — **deferred to C7/C10** (next OOS = OOS-028); not homed this
session as C6 didn't touch the Inngest hosting question. (3) AF-068/116/117 are build-time MUST-TEST.

**NEXT STEP — component 7 (Observability).** Design-doc section **`## 7. Observability` = L3031–L3328** (next
`## The complete system loop` at L3329, then `## 8. Agent Design` at L3371). Pattern-match the C0–C6 loop:
Context Manifest → decompose → cite → log ODs (next **OD-067**; new AFs from **AF-118**) → resolve → verification
gate (2 zero-context subagents) → sign-off → wire matrix + build `system-map/07-observability.md`. **C7 is where
many C5/C6 seams land:** the **event_log** + metrics sinks, **alert delivery** (the dashboard alerts + admin Slack
that C6 HRD.002/ESC.002 *require* but C6 produces only the event), the **guardrail_log dashboard view + retention
+ tamper-evidence + export mechanism** (C6 LOG.004 owns completeness, C7 owns where it lives), the **cost-ladder
enforcement** (ADR-003; C5 feeds, C7 enforces), the **management-plane push / backup-health** (ADR-008, ADR-001
§7), **access_audit retention** (C1 OD-024 seamed retention to C7), the **answer-mode pill rendering** + prompt-
health signals (C4/C2 seamed to C7/C8). Likely seams out: orchestrator → C8; enforcement → C6 (done). Carry-ins:
OD-010 (now resolved for C5/C6) · build-time spikes AF-001/002/004 · AF-068/116/117 · the C5 block-P AFs ·
the management-API field gaps AF-070/071. **C7 is NOT a connector component** (no research-first gate) unless it
introduces a new external sink (e.g. a metrics/paging vendor) — if it does, that triggers the
`tool-integration-research.md` gate.

---

## Session 22 — 2026-06-26 — COMPONENT 5 (AGENT HARNESS) DRAFTED, VERIFIED & APPROVED — "what makes it run"

Sixth Phase-1 component, the **execution layer**. Output: `spec/01-requirements/component-05-harness.md`
(**43 FRs, all Approved**), `system-map/05-harness.md`, 43 matrix rows, OD-054…OD-059 logged+resolved,
feasibility block P (AF-112…AF-115). Pattern-matched the C0–C4 loop end-to-end in one session.

**C5 = "what makes it run"** (vs C2 what it knows, C3 what it can do, C4 what it is). Area codes: TRG ×5 ·
QUE ×6 · GRP ×4 · ENV ×3 · LOP ×5 · JOB ×7 · ASM ×9 · OPT ×4. C5 owns triggering, the **`task_queue`**
(permanent audit record), **versioned task graphs**, the **context envelope**, the **three loops**, the
**Inngest** engine + dead letter queue, the **prompt-stack assembly + run pipeline** (assemble 4 layers → pin →
safety-validate → gate → execute step-by-step → pill → complete), and the optimisations. **Scope boundary set
with the operator at entry: strict — C5 calls, C6 enforces.** Seams out: enforcement/approval-policy/anomaly-
detection → **C6**; event-log/metrics/alert-delivery → **C7**; orchestrator routing + agent registry → **C8**;
memory mechanisms → C2; tool execution → C3; prompt content → C4; RBAC rules → C1.

**Drafting:** Explore subagent mapped the design section (L2493–2745) + system loop (L3329–3367) → 79 intents +
10 candidate area codes (refined to 8). Spot-verified load-bearing cites (task_queue L2517–2535, loops
L2561–2575, envelope L2591–2609, Inngest L2624–2742). **Caught up front** that the subagent's "service_role
mid-task re-check is an open ambiguity" is **already settled** by C1 FR-1.RLS.007 / OD-031 — C5 *implements* the
machinery (FR-5.ASM.005), doesn't re-open it. Also reconciled `client_slug`=label-not-RLS, `'flagged'` status
vs the enum (→ OD-054), Inngest-vs-task_queue double-retry (→ OD-058).

**6 ODs logged then resolved (OD-054…OD-059):** OD-054 status enum **+ explicit guardrail/quarantine state**
(C5 schema, C6-set, distinct from approval-wait); OD-055 compression **summarize-but-retain-originals** (economy
never loss); **OD-056 (user-decided) parallel × approval = step-level gating + no-irreversible-outrun** (#2);
OD-057 loops **no concurrent same-loop + single catch-up** (no backfill stampede); OD-058 **Inngest = single
retry authority**, task_queue = audit projection; **OD-059 (user-decided) chained-task = fresh envelope +
handoff + B re-retrieves under its own scope/clearance** (#2). The two #2-touching calls (056, 059) decided by
the user directly; 054/055/057/058 delegated to recommendation. All landed on option (a).

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — all L2493–2745 + L3329–3367 intents map (the 3 deferred seams —
  observability→C7, ingestion-filter mechanism→C2, oversight→C6/C7 — correctly seamed, not orphaned); no
  contradictions with ADR-003/004/005/006/007, glossary, or consumed C0/C1/C2/C4 FRs; **all 6 traps PASS**
  (`client_slug` label-only · C5 never usurps C6 enforcement/anomaly-detection/approval-policy · mid-task
  re-check consumes C1 not re-decides · no Inngest/task_queue double-retry · citations spot-checked ·
  `flagged` reconciled). 2 cosmetic miscites fixed (extraneous L2349 in TRG.004, L2343 in QUE.005 dropped).
- **Quality/failure pass found 11 findings (3 HIGH, 5 MED, 3 LOW), ALL reconciled in-file:** **+FR-5.TRG.005**
  (verified-event→task **at-least-once**, the C3→C5 seam-atomicity hole — a one-shot event has no loop catch-up,
  HIGH); **+AC-5.JOB.005.2** (fan-out partial failure never silent — HIGH); **+AC-5.QUE.005.2** (approval-wait
  staleness escalation, reusing C1 OD-028 / C2 OD-032 don't-silently-abandon — HIGH); **+AC-5.GRP.003.2/.3**
  (crash-window key-committed-before-side-effect ordering + collision-resistance — M1/L2); **+AC-5.ASM.009.2**
  (durable chained-successor creation, the internal chain seam — M2); **retention clauses** on AC-5.ASM.005.1 +
  AC-5.QUE.003.2 (quarantine/halt **retains WIP** — you can't compensate (OD-010) what you didn't retain — M3);
  **+AF-115** + FR-5.ENV.003 note (the originals-store retention lifetime — Inngest cloud step-state TTL may be
  shorter than the chain + audit window — M4); **+AC-5.JOB.006.2** (C5-emitted DLQ-not-empty heartbeat so the
  failure-handler can't itself fail silently — M5); **+AC-5.ASM.004.2** (late-discovered consequential action
  re-enters the approval gate — L1); **+AC-5.GRP.001.2** (graph-less task fails loudly at creation — L3).
  The reviewer's meta-observation: H3/M2/M5 are all "a hold/handoff waiting on a human or downstream sink with
  no staleness escalation" — C5 now adopts the standardized C1 OD-028 / C2 OD-032 escalate-don't-abandon pattern
  at all three wait-points. Confirmed great-tier: the six resolved ODs land the hard #1/#2 calls.

**Sign-off:** user-authorized (delegated, "Sign off — Approve C5"). 43 FRs `Approved`. **No build-time viability
gate holds any C5 FR** — AF-112…115 are build-time validations of the catch-up/parallel/compression/retention
*claims*, not of the FR machinery (gate analog of C4's AF-111).

**Files changed:** `component-05-harness.md` (new, Approved); `open-decisions.md` (OD-054…OD-059 → 🟢; next
OD-060); `feasibility-register.md` (block P AF-112…115; next AF-116); `traceability-matrix.csv` (43 C5 rows);
`system-map/05-harness.md` (new); `system-map/README.md` (05 ✅ built); `README.md` (status table + Phase-1 row);
this log. No new OOS (self-hosted Inngest deferral noted on FR-5.JOB.007, to home formally at C6/C10).

**Carry-forward / housekeeping:** The self-hosted-Inngest deferral (FR-5.JOB.007) should get an OOS id at
C6/C10 (next OOS = OOS-028).

**Repo self-sufficiency / handoff test RUN (2026-06-26, end of session 22) — PASS, gaps patched.** A
zero-context subagent read only the repo (start-of-session order) and confirmed C6 is fully resumable from the
repo alone: component, design bounds (**L2746–L3030**, next `## 7.` at L3031), the per-component loop, spine
**ADR-007**, the inbound C5/C3 seams, the carry-forward ODs (047, 010 — both fully written with options+recs),
and the next counters (**OD-060 / AF-116 / OOS-028**, all stated in register footers). It flagged one defect
class — a **C6-vs-C7 "Guardrails" numbering drift** — now **fully patched:** (1) **OD-047** register entry
relabelled C7→**C6** (2 spots); (2) the **entire C3 file** relabelled to canonical (it had been authored under
the old C7=Guardrails / C8=Observability numbering — every Guardrails "C7"→C6, every Observability "C8"→C7, with
the agent-design `C5/C6/C8` carry-ins + "C8 agent UX" preserved; a dated clerical change-control note added to
the C3 header — no FR/AC/decision/vendor fact changed). C0/C1/C4/C5 were already canonical. Verified: zero
non-keep-set C8 and all Guardrails refs now C6 in C3. **The repo is handoff-clean for the C6 (Guardrails) chat.**

**NEXT STEP — component 6 (Guardrails).** Design-doc section **`## 6. Guardrails` = L2746–~L3000** (confirm the
end bound at decomposition; Layer 1 hard limits L2754–2768, Layer 2 approval gates L2772–2782, Layer 3 anomaly
detection L2791–2803, boundary/sanitization L2940–2980, the failure-mode map L2821–2862). Pattern-match the
C0–C5 loop: Context Manifest → decompose → cite → log ODs (next **OD-060**; new AFs from **AF-116**) → resolve →
verification gate (2 zero-context subagents) → sign-off → wire matrix + build `system-map/06-guardrails.md`.
**C6 is where many C5 seams land:** hard-limit **enforcement** (the code half of "both prompt AND code", paired
with C4 FR-4.CID.004 + C3 FR-3.ACT.002), the **approval-gate tier policy + routing** (C5 QUE.005/ASM.004 only
move tasks to `awaiting_approval`), **injection sanitization + boundary tagging** (ADR-007, the mechanism C4
FR-4.CID.003 only states), **anomaly detection + thresholds** (C5 ASM.007 only invokes the check), and setting
the **`flagged` status** (C5 OD-054 defined the state, C6 sets it). **C6 also actions OD-047** (review the seven
hard limits — set / rigidity / enforceability — with the **AF-068** containment red-team) and is where
**OD-010** (compensation/rollback) lands substantively alongside C5/C8. **ADR-007 is the spine** (containment-
first; detection-as-signal; embedding scan off by default). Likely seams out: event-log/alerts → C7;
orchestrator → C8. Carry-ins: build-time spikes AF-001/002/004 + the C5 block-P AFs (AF-112…115) + AF-068.

---

## Session 21 — 2026-06-26 — COMPONENT 4 (PROMPT ARCHITECTURE) DRAFTED, VERIFIED & APPROVED — "what the AI is"

Fifth Phase-1 component. Output: `spec/01-requirements/component-04-prompt.md` (**32 FRs, all Approved**),
`system-map/04-prompt.md`, 32 matrix rows, OD-048…OD-053 logged+resolved, AF-111 logged. A
**content-definition** component — the smallest so far, no connector research gate, most machinery is seams.

**C4 = "what the AI is"** (vs C2 what it knows, C3 what it can do). Area codes: LYR ×4 · CID ×6 · BIZ ×3 ·
INJ ×4 · TSK ×3 · PRIN ×3 · STO ×6 · OPT ×3. C4 owns the **four-layer model** (L1 core identity per-agent ·
L2 business context · L3 memory injection · L4 task instruction), the **seven operating principles** + the
safety floor, the **`prompt_layers` store** + version discipline, and the optimisations. It does NOT own
runtime **assembly** (→C5), memory retrieval/clearance gate (→C1/C2), injection sanitization (→C6), hard-limit
**enforcement** (→C6), answer-mode pill rendering (→C5/C8), or the prompt-health **signals** (→C7).

**Drafting:** offloaded a whole-doc prompt-architecture sweep to an Explore subagent (the primary section
L2384–2492 + 8 cross-cut sites: checklist L261–271, L2-config L840–856, perm rows L556–558, boundary
instruction L2976–2980, hard-limits L2756–2768, `agents.system_prompt` L3500–3517, runtime assembly
L3338–3347, prompt-health L3578/3589–3591). Spot-verified the load-bearing cites before drafting. Caught the
central contradiction up front: **Layer 1 is stored in two places** (`prompt_layers.content` where
`layer='core'` AND `agents.system_prompt`), each with its own versioning → OD-048.

**6 ODs logged then resolved (OD-048…OD-053):** OD-048 Layer-1 single source of truth = **unify on
`prompt_layers`**, drop/derive `agents.system_prompt` (reconcile in C8); **OD-049 (user-decided) operating-
principles block = editable, Super-Admin-ONLY** (new `PERM-prompt.edit_principles`, not Admin) + mandatory
change_reason + safety-audit + warning; OD-050 prompt-change = **version pinned at assembly** (in-flight tasks
finish on their version); OD-051 L1 length = **advisory warning**; OD-052 dynamic L2 values = **operator-
editable per-deployment store**; **OD-053 (user-decided) principles floor = hard-block** (reword yes, delete a
principle no). 5 delegated/rec-accepted; the two safety-posture calls (049, 053) decided by the user directly.

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — all L2384–2492 intents + the 8 cross-cut sites map to FRs;
  `agents.system_prompt` + prompt-health correctly handled as seams not orphans; no contradictions with
  ADR-001/002/003/006/007, glossary, or consumed C1/C2/C3 FRs; **all 6 traps PASS** (no `client_slug` RLS key ·
  C4 never claims assembly · L1 duplication resolved to one store · boundary = C4 content + C6 mechanism ·
  principles Super-Admin-edit doesn't break "shared verbatim" · citations clean).
- **Quality/failure pass found 7 findings (2 HIGH, 3 MED, 2 LOW), ALL reconciled:** **+FR-4.LYR.004**
  (assembly-time required-element validation — assembly halts if the resolved L1 lacks the boundary instruction
  / hard-limit statement / principles block; C4 owns the requirement, C5 enforces — HIGH); **re-anchored
  AC-4.PRIN.002.2** (the principles-edit audit pointed at C1 FR-1.AUD.002 which doesn't cover prompt edits →
  re-homed to the immutable `prompt_layers` version chain + a distinct safety-event to C7 — HIGH); **+OD-053 +
  AC-4.PRIN.002.4** (the seven-principle **hard-floor** — HIGH, the #2 edge of OD-049); +AC-4.BIZ.003.3
  (present-but-stale dynamic field surfaced, required + configurable threshold — MED); reworded AC-4.PRIN.002.3
  (assembled-*after*-edit, removes the version-pin ambiguity — MED); +AC-4.INJ.003.3 (above-clearance memory
  in an assembled L3 = containment breach, halt-and-audit — MED); +AF-033 cross-ref at FR-4.CID.006 (said-vs-did
  pill accuracy, already tracked — LOW). Confirmed great-tier: version discipline + single-source-of-truth,
  principle-as-statement-not-enforcement (PRIN.003), boundary/hard-limit prompt-vs-code split, AF-111 honesty.

**Sign-off:** user-authorized — OD-048/050/051/052 recs accepted, **OD-049 + OD-053 decided by the user**
(principles editable by Super Admin only, with a hard floor against deletion), gate clean + all 7 findings
reconciled in-file. 32 FRs `Approved`. No build-time viability gate holds any C4 FR (AF-111 gates only the
*optimisation claim* — version-perf attribution + compression payoff — not the version-identity/pin machinery).

**Files changed:** `component-04-prompt.md` (new, Approved); `open-decisions.md` (OD-048…OD-053 → 🟢; next
OD-054); `feasibility-register.md` (block O AF-111; next AF-112); `traceability-matrix.csv` (32 C4 rows);
`system-map/04-prompt.md` (new); `system-map/README.md` (04 ✅ built); `README.md` (status table + Phase-1 row);
this log. No new OOS.

**NEXT STEP — component 5 (Agent Harness).** Design-doc section **`## 5. Agent Harness` = L2493–2745** (next
`## 6. Guardrails` at L2746); plus the **system loop** L3329–3370 (where C5's runtime assembly + execution
lives) and the C5 checklist overview. Pattern-match the C0–C4 loop: Context Manifest → decompose → cite → log
ODs (next **OD-054**; new AFs from **AF-112**) → resolve → verification gate (2 zero-context subagents) →
sign-off → wire matrix + build `system-map/05-harness.md`. **C5 is where many C4 seams land:** the **prompt-
stack assembly** (retrieve the 4 layers, inject dynamic/memory values, concatenate, send — L3338–3339), the
**FR-4.LYR.004 assembly-validation** (halt if a safety element is missing), **version pinning** (FR-4.STO.006),
the **answer-mode pill** evaluation (with C8), the **task_queue** (L2517–2535), checkpoints, context-envelope
compression (L2608–2609), and the per-agent run loop. **C5 consumes:** C3's tool runtime (tool calls), C4's
prompt layers, C2's memory read flow, C1's `service_role`/mid-task re-check (FR-1.RLS.007). **Likely seams
out:** hard-limit/approval **enforcement** + injection sanitization → C6; observability/event-log → C7;
orchestrator routing + agent registry → C8. **Carry-ins unchanged:** OD-010 (compensation/rollback) lands
substantively at C5/C6; build-time spikes AF-001/002/004 + AF-111.

---

## Session 20 — 2026-06-25 — COMPONENT 3 (TOOL LAYER) DRAFTED, VERIFIED & APPROVED — the connector runtime

Fourth Phase-1 component, the connector layer. Output: `spec/01-requirements/component-03-tool-layer.md`
(**53 FRs, all Approved**), `system-map/03-tool-layer.md`, 53 matrix rows, OD-046 logged+resolved, the
session-19 ODs already resolved. Built directly on the session-19 research gate (dossiers + spine decision).

**C3 = "how the AI reaches the outside world."** Specced as the session-19 spine: a **generic connector
contract + shared tool runtime** (safety machinery built ONCE) with **GHL / Google / Slack as the first
three instances**. Area codes: CONN ×5 · REG ×4 · TOK ×6 (+3 instance) · RL ×8 · ACT ×7 (2 generic limits +
5 instance writes) · TRIG ×5 (+1 instance) · OPT ×4 · DSC ×6 · OBS ×4. **53 FRs = 40 generic runtime + 13
connector instances.** Every vendor fact cites the **dossier**, not the (stale) design doc.

**Drafting:** offloaded the three dossiers to an Explore subagent → a precise citable vendor fact-sheet
(token TTLs, scopes, rate limits, signature schemes, idempotency), then wrote generic CONN-contract FRs
first (the runtime every instance plugs into), then the GHL/Google/Slack instances. Key reconciliations
carried in: `client_slug`=label-not-RLS (mirrors C1) · agent/tool path = `service_role` (ADR-006) · golden
rule (source_ref pointers, not copies) · the 7 hard limits are code gates (ADR-007) · OD-044's "verified
authenticated ingress" homes the per-vendor signature schemes (GHL Ed25519 / Google OIDC-JWT+channel-token
/ Slack HMAC).

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — no orphaned design lines (all L1968–2382 intents map; stale
  per-connector numbers correctly superseded by dossiers), no internal C3 contradictions, citations clean,
  **all 6 traps PASS**. **Caught a real cross-component bug:** C0 **FR-0.WHK.002** (Approved) specced GHL
  webhook auth as **HMAC-SHA256** — stale; the dossier + ADR-007 OD-044 note make it **Ed25519** (legacy RSA
  `X-WH-Signature` deprecates 2026-07-01). Corrected in place via change-control → **OD-046** (operator
  accepted at sign-off); C0 FR re-cited to the dossier, Status kept Approved (corrected, not re-opened).
- **Quality/failure pass found 10 findings (2 HIGH, 7 MED, 1 LOW), ALL reconciled:** **+FR-3.TRIG.005**
  (watch/subscription re-arm — Gmail/Drive/Calendar watches expire with NO auto-renew; a missed re-arm now
  enters the degraded flow + health panel — closed a HIGH silent-ingest-loss hole); **+FR-3.TRIG.006**
  (event-delivery gap detection + reconciliation — Slack auto-disable/>2h-late-drop had no specced mechanism,
  only prose; HIGH); **+AC-3.CONN.004.4** (durable pre-call intent record); tightened **AC-3.TOK.005.2**
  (post-refresh-pre-persist crash → grace-window retry then degrade loudly; no false "prior state intact");
  **+AC-3.RL.006.2** (irreversible/billed writes route to halt-and-escalate, excluded from auto-retry);
  **+AC-3.DSC.003.2/.3 + AC-3.DSC.004.2** (resume re-checks authorization FR-1.RLS.007; paused-task set +
  escalation clock persisted across restart); **+AC-3.OPT.004.2** (gap flag structured/mandatory-to-read);
  **+AC-3.CONN.005.3** (delete-granting scopes excluded — cheapest gate for hard-limit #3) + FR-3.ACT.002
  note (financial/impersonation limits have **no** C3 mechanism — wholly C7+AF-068); persisted RL.004 queue
  + drain re-consults idempotency. Confirmed-adequate: token no-leak, the GHL rotating-refresh persist spine,
  draft-to-approval for email/calendar, fail-closed boundary tag, physical isolation, OD-044 per-vendor
  signatures, OD-010 named-not-solved at every write FR.

**Sign-off:** user-authorized (delegated, C1/C2-style — chose "Sign off — Approve C3 + C0 fix"). 53 FRs
`Approved`; the C0 FR-0.WHK.002 correction accepted. **3 viability gates** documented (FRs are Approved but
do NOT advance to build until cleared): Slack history ingest → AF-083/084; GHL webhook signing input →
AF-090; GHL PHI-location ingest → AF-098 (BAA chain).

**Files changed:** `component-03-tool-layer.md` (53 FRs Approved + gate summary); `component-00-login.md`
(FR-0.WHK.002 HMAC→Ed25519, change-control note); `open-decisions.md` (OD-046 logged+resolved; next OD-047);
`traceability-matrix.csv` (53 C3 rows); `system-map/03-tool-layer.md` (new); `system-map/README.md`
(03 ✅ built); `README.md` (status table + Phase-1 row); this log. No new AFs (findings mapped to existing
Block-N AFs); no new OOS.

**NEXT STEP — component 4 (Prompt Architecture).** Design-doc section **`## 4. Prompt Architecture` ≈
L2384+** (confirm the end bound at decomposition; next `## 5.` follows). Pattern-match the C0/C1/C2/C3 loop:
Context Manifest → decompose the design's prompt section → cite → log ODs (next **OD-047**; new AFs from
**AF-111**) → resolve → verification gate (2 zero-context subagents) → sign-off → wire matrix + build
`system-map/04-prompt.md`. **C4 consumes** C3's tool registry + descriptions (FR-3.REG.002 — the AI selects
tools by description) and ADR-007 containment (boundary-tagged content is data, never instructions). **Likely
seams:** the harness/agent-loop *execution* → C5; guardrail *enforcement* of the hard limits + approval gates
→ C7; observability/eval of prompt quality → C8. **Carry-ins:** OD-010 (compensation/rollback) at
C5/C6/C8; **OD-047 (NEW — review the seven hard limits: right set / rigidity / enforceability — flagged by
operator, lands at C7 with the AF-068 red-team)**; the C3 viability gates (AF-083/090/098) + build-time
spikes AF-001/002/004 on a runnable prototype.

---

## Session 19 — 2026-06-25 — COMPONENT 3 (TOOL LAYER): spine decision + research-first gate run, filed & reconciled (FRs next)

Entered C3 (the connector component). User raised a strategic point up front — **"factor in adding tools later"**
(research → plan → build, repeatably). Turned it into a locked design decision + ran the research-first gate.

**Spine decision (user-approved: "C3 spine + lifecycle standard", no new ADR):** C3 is specced as a **generic
connector contract + shared tool runtime**, with **GHL / Google / Slack as the first three *instances***. The
runtime builds the safety machinery ONCE (token-refresh-persist, rate-limit tracker+backoff, webhook verify,
boundary-tagging, idempotent retry, disconnection/recovery) so future tools inherit it and the three
non-negotiables can't regress per-tool. **Validated by the design doc itself — L1976: "built as a boilerplate
… the first implementations of the pattern, not the limit."** After C3 is done, the existing
`standards/tool-integration-research.md` grows from a research-only gate into the full Research→Spec→Build→Verify
lifecycle (extracted from the real example, not pre-guessed).

**Research-first gate run (4 background agents):** 3 primary-source dossiers (one per tool) + 1 Explore design-map.
Dossiers written to `tool-integrations/{slack,gohighlevel,google-gmail}.md`, each gate-passed (independent
re-check). **Statuses: GHL 🟢 · Google 🟢 · Slack 🟡** (Slack dossier complete; its *viability* — history ingest —
rests on AF-083 EVAL, kept honest-yellow). The design-map decomposed L1968–2382 into ~58 intents, pre-split
**generic (~35) vs tool-specific (~15) vs generic+param (~8)** → 9 area codes (CONN/REG/OBS/ACT/TRIG/OPT/RL/TOK/DSC).

**Three material vendor surprises the design doc missed** (now spec'd correctly, cite dossiers not design doc):
(1) **GHL webhook signing RSA→Ed25519**, legacy `X-WH-Signature` deprecated **2026-07-01** → use `X-GHL-Signature`;
(2) **Google webhooks have no HMAC** (Gmail Pub/Sub OIDC JWT; Drive/Calendar signed `X-Goog-Channel-Token`+TLS);
(3) **neither GHL nor Gmail has write-idempotency** → app-side send-once guards (GHL → `/contacts/upsert`).
Plus a compliance flag: **GHL data can carry PHI, downstream BAA chain unknown (AF-098)** — gates HIPAA-location ingest.

**Filed (Rule 0), collision-safe renumber (single-pass dict regex):** feasibility **Block N = AF-083–110** (Slack
083–088 · GHL 089–100 · Google 101–110; next AF = **AF-111**); **OD-011 RESOLVED** (Slack internal custom app per
workspace, gated AF-083 EVAL); **OD-039–045 logged then RESOLVED** per recommendation (next OD = **OD-046**);
**OOS-018–027** (next OOS = **OOS-028**); **+12 glossary terms**. `traceability-matrix.csv` NOT yet touched (no C3
FRs to wire yet).

**OD resolutions (operator delegated "what do you recommend"):** OD-039 Slack per-workspace default · OD-040 token
rotation OFF · OD-041 GHL pass Security Review (**implicit 5-GHL-agency cap until then** — flagged) · OD-042 GHL
webhook receiver durable-queue→2xx+dedup `deliveryId` · OD-043 GHL re-verify 90d+changelog poll · **OD-044 ⭐ ADR-007
webhook-auth reconciliation → clarification note added to ADR-007** (Consequences→Connector ingress, dated
2026-06-25: hard control = "verified authenticated ingress", HMAC one instance; CONN contract homes per-vendor
scheme — change-control satisfied via note, not supersede) · OD-045 Google Drive `drive.file` default (escalate to
`drive.readonly`+CASA only for full-corpus ingest).

**Files changed:** `component-03-tool-layer.md` (new — manifest, contract spine, intent inventory, seams, vendor-fact
supersedes, OD table now RESOLVED, FRs deferred); 3 dossiers (new); `tool-integrations/README.md` (3 rows);
`feasibility-register.md` (Block N); `open-decisions.md` (OD-011 + OD-039–045); `out-of-scope.md` (OOS-018–027);
`glossary.md` (+12); `adr/ADR-007-injection-posture.md` (2026-06-25 clarification note); `README.md` (status); this log.

**NEXT STEP — draft the C3 FRs.** Gate passed, all ODs resolved, ADR-007 reconciled → FR drafting is unblocked.
Order: **generic CONN connector-contract FRs first** (the runtime: registry/REG, token lifecycle/TOK, rate-limit
tracker+backoff/RL, webhook-verify + boundary-tag, idempotent retry, disconnection/recovery/DSC, optimisation/OPT,
the 7 hard limits under ACT, trigger model/TRIG), **then the three connector instances** (OBS/ACT/TOK params per
tool) each citing its dossier for vendor facts. Then OD-free ACs → the per-component verification gate (2 zero-context
subagents: orphan/contradiction + quality/failure) → sign-off. **Per-FR `Ready` is additionally gated on build-time
AFs** (Slack history-ingest → AF-083; GHL webhook → AF-090; GHL PHI ingest → AF-098). **Seams (don't double-spec):**
memory-write tool → C2 (FR-2.WRT.*); high-risk rate-limit halt/escalate + approval gates + hard-limit enforcement →
C7; health panels/alerts/event-logging → C8; webhook *authentication* → C0 (FR-0.WHK.*); service-role agent path +
mid-task revocation → C1 (FR-1.RLS.007). Build `system-map/03-tool-layer.md` alongside the FRs (per-component map
policy). Carry-ins unchanged: OD-010 (compensation/rollback) at C5/C6/C8 — every external-write ACT tool is an
exposure point; build-time spikes AF-001/002/004.

---

## Session 18 — 2026-06-25 — COMPONENT 2 (MEMORY) DRAFTED, RESOLVED, VERIFIED & APPROVED — the business brain

Third Phase-1 component, the heart of the system. Output: `spec/01-requirements/component-02-memory.md`
(**57 FRs**, 56 Approved + 1 v2-deferred), OD-032…038 resolved, AF-082 logged, OOS-016/017 logged, matrix +
system-map wired.

**C2 = "what the AI knows"** — the durable, entity-organised, sensitivity-tagged knowledge base every task reads
from (step 4) and writes back to (step 7). Area codes: MEM ×2 · ENT ×5 · TAG ×3 · ING ×10 · WRT ×7 · RET ×7 ·
MNT ×17 · VEC ×3 · MAT ×3. **Three ADRs converge:** ADR-002 (Maturity/Sufficiency), ADR-003 (≤1 Sonnet writer +
Haiku gates + "controls before gates"), ADR-004 (sole-writer service_role + validate-and-commit).

**Drafting:** offloaded the design-doc Memory map (L1338–1967 + the L906–926 config block + L1487–1559 vector) to an
Explore subagent → 78 fine-grained intents; spot-verified the load-bearing cites (memory types, the tag enumeration,
the two filters) before writing. **Key reconciliation caught up front:** the design's "Filter 1 / Filter 2" ARE
ADR-003's Haiku gates (selective-writing + sensitivity-classify), **not a third model layer** — C2 cites ADR-003
rather than inventing one. C2 **consumes** C1's FR-1.CLR.001/004/006, RST.003, RLS.003/007, AUD.001 and **owns the
mechanisms C1 only ruled on** (tagging, the retrieval pipeline, never-auto-inject-Restricted, the sole-writer path).

**7 ODs logged then resolved (OD-032…038):** OD-032 hard-conflict quarantine+escalate (mirrors C1 OD-028); OD-033
entity resolution external-ref-first + flag-ambiguous + soft-disable retire (gated by AF-082); **OD-034 cold storage
DEFERRED to v2 → OOS-016** (user-decided — adds a lose-a-memory failure mode for no launch-scale benefit; HNSW stays
fast past ≤20-user volume); OD-035 candidate filters apply uniformly to BOTH search arms (closes a stale-knowledge
leak); OD-036 ~3-week shadow-retain trust window, graduate on low disagree-rate + operator sign-off (ADR-003 §8
made concrete); OD-037 Personal-consolidation skip-by-default + audited approval queue; **OD-038 compliance-erasure
rule homed in C2 (FR-2.MNT.017), backup-purge seamed to Phase 5** (user-decided). 5 delegated C0/C1-style; the two
scope/legal calls (034, 038) taken to the user — both chose the recommendation.

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — all design intents L1338–1967 mapped; the 3 deferrals (cold storage, re-rank/
  HyDE, structured-extraction/query-decomposition) correctly logged OOS-016/003/017; no contradictions with
  ADR-001/002/003/004/006/007 or the consumed C1 FRs; all 5 trap areas PASS. Caught a **citation slip** (Personal-
  no-consolidation cited L1407 → correct **L1414**) + two cross-ref slips (MNT.009→**008**, MNT.016→**014**) — all fixed.
- **Quality/failure pass found 7 findings, ALL reconciled:** **+FR-2.WRT.007** (embedding-failure halts commit, never
  stores a null/invalid embedding — a real #1/#3 silent-loss hole); **+AC-2.WRT.006.3** (mid-task revocation re-check
  at the commit boundary — C1 FR-1.RLS.007 stated the rule, no C2 FR enforced it); **FR-2.ING.003** escalation AC +
  `CFG-review_escalation_days`/`CFG-ingest_defer_resurface_days` and **FR-2.MNT.010** now scans the ingestion queue +
  null-embedding rows (closed a **Rule-0 dangling "Phase 2" decision**); **FR-2.MNT.017** hardened to erase
  **transitively** across the supersede chain + merged/summarised derived rows (+AC-2.MNT.017.3 — the residue hole
  OD-038's own rule forbids); escalation ACs on FR-2.WRT.002 / FR-2.MNT.014; FR-2.WRT.006 lexical-recheck note →
  FR-2.MNT.006 daily backstop; AC-2.VEC.003.2 re-embed completeness gate. Confirmed-adequate: clearance-before-
  ranking, Restricted, golden rule, decay-never-deletes, evidence layer, sole-writer.

**Sign-off:** user-authorized — OD resolution delegated (5) + the two scope/legal calls decided directly; gate clean
on orphans/contradictions, all 7 quality findings reconciled in-file. 56 FRs `Approved` + FR-2.MNT.012 `Deferred(v2)`.

**Files changed:** `component-02-memory.md` (new, Approved); `open-decisions.md` (OD-032…038 → 🟢; next OD-039);
`feasibility-register.md` (block M AF-082; next AF-083); `out-of-scope.md` (OOS-016 cold storage, OOS-017 structured-
extraction/query-decomposition; next OOS-018); `traceability-matrix.csv` (57 rows); `system-map/02-memory.md`
(reconciled-with-spec note); `system-map/README.md` (02-memory ✅ Approved); `README.md` (status table + Phase-1 row);
this log.

**NEXT STEP — component 3 (Tool layer).** **Design-doc section: `## 3. Tool Layer` = L1968–2383** (next section
`## 4. Prompt Architecture` at L2384), incl. Observation tools L2021, Action tools L2037, Tool registry L2070, Tool
optimisations L2101, Connector token management L2225, Connector disconnection flow L2301; plus the C3 checklist
overview **L245–~270**. This is the **connector** component, so it **triggers the research-first
gate** (`standards/tool-integration-research.md`) — open dated primary-source dossiers in `tool-integrations/` for
GHL / Google(Drive+Gmail) / Slack before speccing connector FRs, citing the dossier (not the design doc) for vendor
facts. C3 is where the **AF-003 corrected vendor values propagate** (F1 Gmail per-env quota, F2 GHL 100/10s+200k/day,
F5 GHL refresh-token-rotation-persist, F3 Slack throttle) and where **OD-011 (Slack app class — rec internal-custom-
app, EVAL-gated)** resolves. C3 **owns the seams C2 named:** the connectors behind C2's three ingestion pipelines
(FR-2.ING.006/007/008) and the **live-data fetch** for the relevance cross-check (FR-2.MNT.011); also the connector
OAuth + token lifecycle C0 deferred (AF-013/014). **Carry-ins unchanged:** OD-010 (compensation/rollback) at C5/C6/C8;
build-time spikes AF-001/002/004 + the C2 AFs (AF-019 HNSW-under-RLS, AF-031, AF-034, AF-043, AF-061–063, AF-067,
AF-082) on a runnable prototype. The C2 mid-task-quarantine **machinery** (AC-2.WRT.006.3) is a C5/C6/C8 build concern;
the answer-mode **pill rendering** (FR-2.RET.007) is C8.

---

## Session 17 — 2026-06-24 — COMPONENT 1 (RBAC) DRAFTED, RESOLVED, VERIFIED & APPROVED + `standards/rbac.md` written

Second Phase-1 component, pattern-matched to the C0 exemplar. Output: `spec/01-requirements/component-01-rbac.md`
(**37 FRs**, all `Approved`), the owed `standards/rbac.md`, `system-map/01-rbac.md`, 37 matrix rows, OD-024…031
resolved, AF-079/080/081 logged.

**C1 = authorization ("what you may do/see")** — the question C0 left open once `auth.uid()` is established.
**ADR-006 is the spine** (its 6 binding parts map ~1:1 onto the RLS/PERM/CLR FRs). Area codes: ROLE ×5 · PERM ×7 ·
CLR ×6 · RST ×3 · RLS ×8 · USR ×5 · AUD ×3. Every vendor/architecture fact cites ADR-006 or the design doc.

**Drafting:** offloaded the design-doc RBAC map (L397–639 + L717–736) to an Explore subagent; verified load-bearing
line anchors before citing. Homed the C0 PERM stubs (`PERM-user.invite`, `PERM-auth.provider_toggle`, support nodes)
+ the role tables (`user_roles`/`roles`) C0 read. **Caught a real design contradiction:** L438 lists "Restricted" as
a Super Admin *role* clearance, but L452/L620 make it strictly per-named-individual — resolved in favour of L452
(Restricted is never a role default; Super Admin holds the *authority to grant*).

**8 ODs resolved (OD-024…OD-031, all 🟢, delegated C0-style):** dedicated append-only `access_audit` table, C7 owns
retention (OD-024); role deletable iff zero users + not protected, Super Admin always protected (OD-025); denied
direct access = explicit 403 + security log, never silent empty (OD-026); `entity_type_scope` column + Restricted-
per-individual (OD-027); overdue clearance review = escalate, neither auto-revoke nor silently keep (OD-028); audit
every RBAC mutation + one-role-per-user v1 + last-Super-Admin protected on all removal paths (OD-029); seed default
matrix once at provisioning, edits authoritative after (OD-030); **OD-031** (gate-raised) mid-task revocation policy.

**Verification gate (2 independent zero-context subagents):**
- Orphan/contradiction pass **CLEAN** — all 27 design intents mapped; the 4 traps all avoided (no `client_slug` in
  policies; no FR assumes RLS guards the agent path; Restricted never a role-default; no role-name inside a policy);
  all 6 seams (C0/C2/C3/C7) acknowledged.
- Quality/failure pass found **5 findings, ALL reconciled**, clustered at the **service-role/mid-task seam** (the one
  path ADR-006 part 6 deliberately leaves off RLS): **+FR-1.RLS.007** (a `service_role` task binds its originating
  user; on mid-task **deactivation or clearance-revoke it halts + quarantines before the next consequential side
  effect** — while a benign **session-expiry continues**, reconciling C0 FR-0.SESS.006; mechanism seamed to C5/C6/C8,
  compensation → OD-010); **+FR-1.RLS.008** (RLS/harness divergence is logged, not silently zero-rowed, #3);
  **+OD-031**, **+AF-081** (agent-path audit completeness — no DB backstop, rests on harness discipline); reactivation
  re-grant branch on USR.002 (no stale grant silently restored). AF-080 sharpened to runtime divergence.

**`standards/rbac.md` written** (Binding, owed since ADR-006) — 12 rules: default-deny everywhere · one `can()` gate ·
`PERMISSION_NODES.md` build-time source of truth · static generic data-driven policies · the `(select …)` initPlan
rule (AF-067, non-negotiable for perf) · RLS owns only the row-access subset intra-client · human-path-RLS vs
agent-path-service_role · instant change · explicit/scoped/reviewed clearances · Restricted per-individual/logged/
never-auto-injected · dual-path audit completeness · no-lockout.

**Sign-off:** user-authorized ("lets sign off unless you think i need to review something") — I judged nothing needed
their specific review (gate clean on orphans/contradictions; findings reconciled on the locked ADRs). 37 FRs → `Approved`.

**Files changed:** `component-01-rbac.md` (new, Approved); `standards/rbac.md` (new, Binding); `system-map/01-rbac.md`
(new); `system-map/README.md` (01-rbac ✅); `traceability-matrix.csv` (37 rows); `open-decisions.md` (OD-024…031 → 🟢;
next OD-032); `feasibility-register.md` (block L AF-079–081, AF-080 sharpened; next AF-082); `README.md` (status table
+ Phase-1 row); this log.

**NEXT STEP — component 2 (Memory).** The exemplar zoom-in `system-map/02-memory.md` already exists (reflects
ADR-002/003/004). Pattern-match the C0/C1 loop: Context Manifest → decompose the design's memory section → cite → log
ODs (OD-032+; new AFs from AF-082) → verification gate → sign-off. **Design-doc section: `## 2. Memory System` =
L1338–1967** (memory types/entities, the two ingestion filters + contradiction check + memory writer write-flow, the
visibility×sensitivity orthogonal tags L1400–1418, retrieval/ranking, the maintenance schedule L1870, the three
ingestion pipelines L1908+); plus the C2 checklist overview **L222–243** and the memory-relevant config (e.g.
`retrieval_confidence_threshold` ~L906). Note the clearance-before-ranking lines C1 cited (L464, **L1725**) live inside
this section — C2 owns the *mechanism* there. Likely area codes (confirm at decomposition): MEM/ENT (entities) ·
ING (ingestion filters + pipelines) · WRT (write flow + contradiction check + sole writer) · RET (retrieval/ranking) ·
TAG (visibility×sensitivity) · MNT (maintenance/supersede/merge). **C2 consumes from C1:** the clearance/visibility/Restricted access model
(FR-1.CLR.*/RST.*), the `(select …)` data-driven RLS pattern (AF-067), and **owns the mechanisms C1 only stated the
rule for** — tagging memories with a sensitivity tier + entity type (FR-1.CLR.001/004), the retrieval/injection
pipeline that enforces clearance-before-ranking (FR-1.CLR.006) and never-auto-inject-Restricted (FR-1.RST.003), and the
service-role sole-writer path (ADR-004) whose mid-task authorization C1 governs (FR-1.RLS.007). **Carry-ins unchanged:**
OD-010 (compensation/rollback) at C5/C6/C8; OD-011 (Slack app class) at the C3 Slack connector; build-time spikes
AF-001/002/004 + AF-067/076/079/080/081 on a runnable prototype.

---

## Session 16 — 2026-06-24 — COMPONENT 0 (LOGIN) DRAFTED, RESOLVED, VERIFIED & APPROVED (the golden exemplar)

The full Phase-1 per-component loop, executed end-to-end on **component 0 (Login)** — the golden exemplar
every later component pattern-matches. Output: `spec/01-requirements/component-00-login.md` (**42 live FRs +
1 retired**, all `Approved`), its `system-map/00-login.md` zoom-in, 43 matrix rows, 12 OD resolutions.

**Drafting:** decomposed design-doc **L358–390 + L643–816** into 6 area codes (AUTH/SESS/INV/SEED/REC/WHK).
Every Supabase vendor fact cites **feasibility Block J (SA1–17)**, NOT the design doc; the **6 refuted
design-doc claims** are carried as a doc-reconciliation table up top. New **AF-078** (webhook verification,
block K). Glossary +AAL/aal2, +refresh-token rotation, +JWKS local verification.

**12 ODs logged then resolved (OD-012…OD-023, all 🟢):** session-lifetime = native rotating+inactivity
(OD-012); mid-task = `service_role` (OD-013, per ADR-004/006); invites = **24h native, no custom token**
(OD-014); HttpOnly pursued w/ AF-073 gate (OD-015); 2FA = deployment-wide aal2, no exemptions (OD-016);
same-page challenge + soft-lock (OD-017); **OD-018 (user-decided) = OAuth-only for all client-tenant users,
email+password+2FA ONLY for external (operator-side) Super Admins** who can't SSO; OD-019 **dissolved** by
OD-018 (no client password to reset → phone-verify flow retired); one-method-at-setup (OD-020); seed =
email+pw+2FA external bootstrap admin (OD-021); webhook secret rotation/replay (OD-022); webhook alert→Super
Admin+throttle (OD-023).

**OD-018 cascade (the key event):** since all client users are OAuth, the system holds no client password →
**FR-0.REC.004 (phone-verify credential change) RETIRED**, phone field + custom invite-token table dropped,
REC reframed to a generic login-support intake. A scope decision *deleted* complexity + an attack surface.

**Verification gate (2 independent zero-context subagents):**
- Orphan/contradiction pass **CLEAN** — all 49 design intents mapped; 6 deviations are the intended Block-J
  corrections; seams to C1/C2/C3 acknowledged; no unsupported claims.
- Quality/failure-overlay pass found **6 findings, ALL reconciled:** seed check-then-create race → hardened
  **FR-0.SEED.003** with an ADR-004 atomic guard (real bug caught); +**FR-0.AUTH.010** (audit completeness),
  +**FR-0.INV.007** (email bounce), +**FR-0.REC.007** (stale-request re-escalation); missed-webhook detection
  parked as a seam to **C2/C3/C7** (not C0); backup confirmed covered by ADR-008.

**Sign-off:** user-authorized/delegated ("I trust you and your recommendations"). 3 LOW items accepted (status
enum `contacted`→`in-progress`; phone-recovery retired; **ADR-007 webhook-ingress "component 1" cross-ref
reconciled** via a dated clarification note); FR-0.INV.007 full-bounce-wiring deferred → **OOS-015**.

**Files changed:** `spec/01-requirements/component-00-login.md` (new, Approved); `system-map/00-login.md` (new);
`traceability-matrix.csv` (43 rows); `open-decisions.md` (OD-012…023 → 🟢; next OD-024); `feasibility-register.md`
(block K, AF-078; next AF-079); `glossary.md` (+3 terms); `out-of-scope.md` (OOS-015; next OOS-016);
`adr/ADR-007-injection-posture.md` (C0-scoping reconciliation note); `system-map/README.md` (00-login ✅);
`README.md` (status + Phase-1 row); this log.

**NEXT STEP — component 1 (RBAC).** Pattern-match the C0 exemplar: create `component-01-rbac.md` with a Context
Manifest (ADR-006 data-driven RLS is the spine; ADR-001 intra-client; the C0 `auth.uid()`/`aal2` seam from
FR-0.AUTH.008/SESS.006), decompose the design's RBAC section, cite, log ODs, run the verification gate, sign
off. **C1 owes the `standards/rbac.md` standard** (two-level RBAC+RLS, default-deny, RLS-vs-harness division,
service-role caveat, `PERMISSION_NODES.md`) — promised since ADR-006. C1 also **homes the PERM-* nodes** C0
referenced as stubs (`PERM-user.invite`, `PERM-auth.provider_toggle`, `PERM-support.view/.resolve`) and the
**role tables** `user_roles`/`roles` that FR-0.INV.005/SEED.001 read. Carry-ins unchanged: OD-011 (Slack app
class) at the C3 Slack connector; OD-010 (compensation/rollback) at C5/C6; build-time spikes AF-001/002/004 +
AF-073–078 on a runnable prototype.

---

## Session 15 — 2026-06-24 — PHASE 1 ENTERED · component-0 scope finalized · Supabase Auth research-first gate run

User asked to confirm Phase 0 done + whether to reason about Phase 1 before starting (yes to both). Read the
whole repo + had subagents map the design-doc Login section and re-read every foundation file. **Phase 0 is
confirmed complete** (all 8 ADRs Accepted; the 3 SPIKE/EVAL priority spikes AF-001/002/004 are build-time by
design). **Phase 1 is now entered.** No FRs drafted yet — this session did the "finalize before entry" pass +
the research gate. **Nothing here is a code change; it's spec scaffolding for component 0 (the golden exemplar).**

**Two scope decisions locked (user-approved), recorded in `phase-playbooks.md` → "Component 0 — entry
finalization":**
1. **C0 = authentication only ("who you are").** In scope: dashboard login (Google/Microsoft as a *login-identity
   provider* via Supabase Auth), email+password, **2FA** (TOTP enroll+challenge), **sessions** (JWT, TTLs,
   cookies, expiry/re-auth), **invite-based account creation**, **first-boot Super Admin seed**, **"trouble
   signing in"** recovery + support-request handling, **inbound webhook authentication** (HMAC/JWT verify of
   GHL/Google/Slack webhooks — a hard control per ADR-007). Out of C0: roles/permissions/clearances/RLS → **C1**;
   **connector OAuth + token lifecycle** (the AI's data access to Gmail/Drive/GHL/Slack, AF-013/014) → **C3 Tool
   Layer**. The **seam** is the session establishing `auth.uid()`. NOTE: the design doc places much auth content
   **structurally under the `## 1.` RBAC header** (L643–816: app auth flow, sessions, webhook security) — we
   re-home it to C0 by semantics. C0's own header is only L358–390.
2. **Supabase Auth research-first gate done BEFORE drafting C0 FRs** (Supabase is a *platform* dep, so findings
   live in `feasibility-register.md`, not `tool-integrations/`).

**Supabase Auth research pass (2026-06-24, 4 parallel primary-source agents) → `feasibility-register.md` Block J
(findings SA1–SA17) + new AF-073–077 + sharpened AF-067.** It **refuted/corrected 6 design-doc claims** — these
MUST be cited from Block J, not the design doc, in C0 FRs:
- ⛔ **Refresh-token "7-day TTL" REFUTED** — Supabase refresh tokens **never expire**; single-use rotating, 10s
  reuse interval, reuse-detection revokes the whole session. Session bounds = optional time-box/inactivity
  (Pro+, no default, lazily enforced). The design's `auth.session_refresh_days:7` maps to **no native setting**.
- 🟠 **HTTP-only cookies** — NOT the documented default (`@supabase/ssr` says HttpOnly "not necessary") → AF-073.
- ⛔ **"Server-side session continues mid-task"** — no such object; either middleware refreshes the JWT or
  background runs as `service_role` (bypasses RLS, no `auth.uid()`).
- ⛔ **`two_factor_required` as a config flag** — no org-wide end-user MFA toggle exists; must be **built** via
  restrictive `aal2` RLS on every protected resource + post-login app gating → AF-076.
- ⛔ **72h invite links** — hard cap **24h (86400s)**, global setting, not per-link → AF-074 + custom-token fork.
- ⬜ **Microsoft Authenticator** — unnamed by Supabase; compat rests on open RFC-6238 → AF-075.
- ✅ Verified & useful: TOTP default-on; Google+Azure login IdP (pin tenant, require `email` scope, `xms_edov`);
  invite-only supported (admin API bypasses the signup toggle); **custom SMTP mandatory for prod** (built-in
  2/hr); **no per-account login lockout** (platform Cloudflare/fail2ban + CAPTCHA + leaked-pw Pro+) → AF-077;
  **asymmetric JWT (RS256/ES256) default since 2025-10-01** → local JWKS verification (`getClaims`), but
  `getUser` where revocation matters; API-key rename anon→`sb_publishable`, service_role→`sb_secret`.
- **AF-067 SHARPENED (load-bearing for C1/ADR-006):** `STABLE` alone ≠ once-per-statement; helper calls MUST be
  wrapped `(select …)` to force the initPlan (Supabase benchmark **178,000ms→12ms**), index policy cols, scope
  `TO authenticated`, wire the `auth_rls_initplan` lint. Now a binding implementation rule, not an open risk.

**Files changed:** `phase-playbooks.md` (Component 0 entry finalization), `feasibility-register.md` (Block J,
AF-073–077, AF-067 sharpened, next-AF→AF-078), `README.md` (Phase-1 row 🟡 + status line), this log.

**NEXT STEP — draft `spec/01-requirements/component-00-login.md`** (per Phase-1 playbook steps 1–5), as the golden
exemplar. Open with a **Context Manifest** (ADR-001 §2/§5 Supabase+secrets custody, ADR-006 §6 service-role
bypass, ADR-007 webhook-auth-as-hard-control; standards: config-edit-taxonomy, migration-discipline; glossary
auth terms; **feasibility Block J + AF-073–077**; design-doc **L358–390 + L643–816**). **Area codes:**
AUTH (login/OAuth/2FA), SESS (sessions/tokens), INV (invites), SEED (first-boot Super Admin), REC (recovery/
support), WHK (webhook auth). Decompose into atomic FRs citing **Block J** for vendor facts. Build
`system-map/00-login.md` zoom-in alongside (per-component map policy). Then user resolves ODs → ACs → verification
gate → sign-off.

**Component-0 OD candidates to LOG when drafting** (4 research forks + ~8 from the design-doc mapping — none
logged yet; will be OD-012+): (a) **session-lifetime model** — adopt Supabase rotating-never-expiring + inactivity
vs custom bounds [SA3]; (b) **mid-task continuation** — middleware JWT-refresh vs service_role [SA5]; (c) **invite/
setup-link expiry** — re-spec ≤24h vs custom invite-token layer [SA11/12, AF-074]; (d) **HttpOnly** — hard
requirement (spike AF-073) vs accept default [SA4]; (e) **2FA delivery UX** (same-page vs redirect) + wrong-code
rate-limiting; (f) **per-user 2FA override** vs deployment-wide; (g) **support-request notification** — who's
alerted on submit + phone capture/lookup + call logging + unreachable-user escalation; (h) **invite edge cases** —
expired→re-request? admin revoke-early? OAuth+password dual setup?; (i) **Super Admin seed** — OAuth option? bounced-
email recovery path?; (j) **RLS every-table coverage** discipline (ties to AF-076); (k) **webhook** — secret
rotation, replay beyond timestamp, accept-rate limits; (l) **webhook failure alert** — recipient, source-id,
escalation action.

**Carry-ins (unchanged):** GHL/Gmail/Slack connector findings (F1–F6, AF-013/014) are for **C3**, not C0; **OD-011**
(Slack app class) resolves at the C3 Slack connector; **`standards/rbac.md`** owed when C1/data-model specced
(from ADR-006); **OD-010** (compensation/rollback) is a C5/C6 item. Build-time spikes AF-001/002/004 + the new
AF-073–077 run on a runnable prototype.

---

## Session 14 — 2026-06-23 — ADR-008 ACCEPTED (backup & disaster recovery) — last Phase-0 blocker closed

User asked "what's next," chose **OD-009 (backup/DR)** — the last actionable Phase-0 item (the 3 SPIKE/EVAL
priority spikes are build-time, deferred). Then delegated the three forks to me ("what do you recommend and
why, explain simply"). Drafted → he probed two points (why PITR ~$100, the Storage-bucket caveat) → resolved
both → wrote **ADR-008**, closing OD-009. Phase 0 now has **no blockers left**.

**Research-first, per the AF-003 lesson (vendor facts go stale):** ran a dated primary-source pass on Supabase
backup/DR before asserting anything. It **reframed the whole decision** — the dominant loss path is **the
client's credit card, not a crash**: because ADR-001 puts the project on the client's account, a billing lapse
pauses it after ~7 days → restorable 90 days → then **the project AND all in-project backups (daily + PITR) are
permanently deleted together**. PITR alone can't save you (it lives inside the doomed project).

**Decided (6 binding parts):** *(Decision part 1 was revised later in the same session — see "In-session
revision" below; the entry reflects the final state.)*
- **Default = free daily in-project backups + an hourly off-platform snapshot** (~1-hour RPO, near-zero cost,
  AF-072-bounded). **PITR is an opt-in upsell** (off by default, ~$100+/mo on the client's card, for
  minute-level RPO or brains too big for an hourly logical dump). Running below hourly is a **logged downgrade
  exception**, never a silent default.
- **Independent off-platform `pg_dump` to a client-owned destination** (different region), run **hourly**,
  independent of the primary project lifecycle — the **only** defense against the deletion path. **Client-owned**
  so the operator never holds business data (preserves the ADR-001 boundary). Operator-held copy = logged
  per-client exception.
- **Ownership split:** client owns + pays; **operator operates + verifies** (the OD's core "whose job" ambiguity).
- **Tested restore rehearsal** to a throwaway project (Supabase verifies nothing; we do) — confirms DB + pgvector
  + auth rows come back queryable. ⚠️ AF-069.
- **Backup-health joins the management-plane push** (ADR-001 §7) — operational metadata only: recovery tier
  (daily+hourly, or PITR), last-backup time, **project status incl. pause/billing-at-risk**, off-platform-
  snapshot + rehearsal results; read via Supabase Management API (⚠️ AF-070); **loud Super Admin alert on
  lapse** → a failing client backup is *seen* before the deletion window (protects #1 + #3).
- **Golden rule governs scope + Storage buckets out of scope** (OOS-013): per `L1634` source files live in
  their system of record, **referenced (`source_ref`) not copied into Supabase**; v1 Storage holds only
  **regenerable offboarding exports** (`L97`), checked against the design doc — not source-of-truth. DR posture
  = restore-with-downtime, not hot failover (Enterprise-only; OOS-014).

**In-session revision (operator's call):** Austin pushed that ~$100/mo PITR-on-by-default is overkill, and
(correctly, citing the golden rule) that files should be **referenced in their system of record, not stored in
Supabase**. Both confirmed: (1) **default flipped to hourly off-platform snapshots + free daily; PITR demoted
to a documented opt-in upsell** — cheaper, and acceptable because memory is re-derivable from systems of record
that survive any incident (so AF-072 now gates the *default* hourly cadence). (2) The **golden rule (`L1634`)**
was already the design's law (only Storage use is the transient offboarding export); lifted it into the glossary
as a **binding principle** so no future component copies source files into Supabase. ADR-008 carries a dated
**Revision** note (Accepted-but-ink-wet, transparent amendment per change-control). Glossary +Golden rule,
+Off-platform snapshot, +RPO, +PITR upsell, +Restore rehearsal.

**Vendor facts that drove it (primary-source, 2026-06-23):** PITR = paid add-on, 2-min RPO, replaces daily,
not Spend-Cap-covered; free daily = Pro 7d/Team 14d, can lose ~24h; backups cover **DB only (incl. pgvector +
auth), NOT Storage buckets**; **Management API can read backup status** without business data; **no platform
restore-verification**; **no auto-failover** on Pro/Team. Could NOT verify from primary docs (→ AFs): backup
**region locality / AU residency** (AF-071), exact **Management-API payload fields** (AF-070).

**Captured as MUST-TEST:** new feasibility **block I** — AF-069 (restore actually works, SPIKE — the load-
bearing one), AF-070 (Management API exposes the health fields, SPIKE), AF-071 (backup region/AU residency,
DOCS/vendor confirmation — primary docs insufficient), AF-072 (off-platform dump completes in-window at scale,
LOAD).

**Files changed:** `adr/ADR-008-backup-dr.md` (new, Accepted); `open-decisions.md` (OD-009 → 🟢);
`adr/README.md` (ADR-008 row); `feasibility-register.md` (new block I AF-069–072; next AF-073);
`out-of-scope.md` (OOS-013 Storage buckets, OOS-014 HA/failover; next OOS-015); `what-makes-it-great.md`
(non-negotiable #1 watch + dimension-11 row cleared 🔴→🔵 + "one gap left" summary); `README.md` (ADR status
line — ADR-008, no Phase-0 blockers, next = Phase 1 component 0).

**Next step:** **Phase 0 is done — start Phase 1, component 0 (Login)** as the golden exemplar, building its
`system-map/` zoom-in alongside it (per the per-component map-build policy). Phase-1 carry-ins to honor:
**propagate the AF-003 corrected vendor values** into connector/token/rate-limit FRs (esp. GHL refresh-token
persistence F5, Gmail per-env quota F1, Slack app class **OD-011**); **OD-011** (Slack app registration,
🟡 rec (a) internal-custom-app) resolves when the Slack connector/ingestion component is specced;
**OD-010** (compensation/rollback) is a Phase-1 Harness/Guardrails item; write **`standards/rbac.md`** when
component 7 / data model is specced (owed from ADR-006). The 3 SPIKE/EVAL priority spikes (AF-001/002/004)
plus the new AF-069/070/072 are build-time, run on a runnable prototype.

---

## Session 13 — 2026-06-23 — AF-003 vendor-claims spike (DOCS pass) — first feasibility item verified

User asked "what's next," chose feasibility spikes, then asked whether "priority spikes" = "feasibility
spikes" (yes — priority = the run-first subset that can invalidate the architecture; same `AF-` register).
**Honest constraint surfaced:** 3 of the 4 priority spikes (AF-001 cost, AF-002 retrieval, AF-004
provisioning) are SPIKE/EVAL and **need a runnable prototype that doesn't exist** — can't run from inside a
spec repo without fabricating results (would violate non-negotiable #3 + anti-hallucination rule). The **one
doable now** is **AF-003 (vendor-claims, method DOCS)** — pure documentation verification. Ran it: 4 parallel
research agents over Google/Gmail, GHL+Slack, Supabase+pgvector, Inngest+Railway, all against current primary
vendor docs.

**Result — 3 claims stale/refuted, 1 design fork, rest verified:**
- ⛔ **AF-011 (GHL rate limit) REFUTED** — not "120/min, no burst"; real = **100 req/10s burst + 200k/day, per
  app per location**. No per-minute limit. Daily cap is the real ceiling.
- ⛔ **AF-014 (GHL OAuth refresh) PARTLY REFUTED** — refresh token is **NOT indefinite**; it **rotates per use**
  + dies after **1 yr unused**. ⚠️ **#1 risk:** harness must persist the new refresh token every refresh or
  silently lose access.
- 🟠 **AF-010 (Gmail quota) STALE** — "250/sec" gone → **6,000 QU/min/user**, and **date-dependent** on GCP
  project activation (pre/post 2026-05-01). Pin per-environment. +100-token-per-account cap.
- 🟠 **AF-017 (Edge Functions) STALE** — "150s" is Free-only; paid = 400s; real constraint = **2s CPU cap (all
  plans)**. Cite that, not 150s.
- 🔴 **AF-012 (Slack) → DESIGN FORK, logged OD-011** — since 2025-05-29 non-Marketplace apps have
  `conversations.history/.replies` throttled to **Tier 1 (1 call/min × 15 msgs)** = lethal for history ingest.
  **Exempt: Marketplace apps + internal custom apps.** OD-011 recommends **(a) internal custom app per client
  workspace** (fits ADR-001/005), EVAL-gated on a live workspace.
- 🟢 **Verified:** AF-013 (Google OAuth — sharper: Testing=7d expiry, 6mo-unused death, password-reset
  revoke, CASA annual reassessment ~weeks = onboarding critical path), AF-015 (Slack xoxb), AF-016 (Realtime —
  soft quotas + msgs/sec & joins/sec ceilings), AF-018 (Inngest — **per-key concurrency ✓ confirms ADR-004**;
  wording fixes: per-step ≤2h, `onFailure`/`inngest/function.failed` not "DLQ"; Free concurrency=5), AF-020
  (Railway — pre-deploy command blocks-on-fail ✓ confirms migrate-on-release + **branch-per-env corroborates
  AF-064 canary model**), AF-021 (cross-account Supabase works; ⚠️ service-role key = god-mode bypass-RLS, +
  static-egress-IP assumption for allowlisting).
- 🟡 **AF-019 (pgvector HNSW)** — HNSW verified, but **kept SPIKE/LOAD-open**: RLS/WHERE filters apply *after*
  the ANN scan, so per-client RLS (ADR-006) can starve recall; must LOAD-test **with RLS predicates applied**.

**Files changed:** `feasibility-register.md` (AF-003 row → 🟡; Block A all 12 statuses set; new "AF-003 DOCS
verification findings" subsection F1–F12 with corrected values + sources + design impacts); `open-decisions.md`
(new **OD-011** Slack app class, 🟡 rec (a); next OD-012); `README.md` (status line — spike progress + OD-011).

**Also built (user request) — the tool-integration research-first gate.** The tool set is open-ended and
client-driven; new connectors arrive per client/use case, and AF-003 just proved vendor facts go stale. So we
made a **repeatable research trigger**: no tool is specced until a dated, primary-source dossier exists.
- `standards/tool-integration-research.md` (new, **Binding**) — the 5-step procedure (open dossier → parallel
  research fan-out over 12 dimensions, primary docs only, date-stamped → file AF/OD/glossary outputs →
  verification re-check → only then spec the connector FRs) + the 12 research dimensions (auth/token lifecycle,
  rate limits, API, webhooks, data/sensitivity, provisioning, isolation, cost, failure, versioning) each tied to
  an ADR / non-negotiable, with the AF-003 finding that proves it matters + a **staleness / `Re-verify by`** rule.
- `tool-integrations/_TEMPLATE.md` (new) — the per-tool dossier shape.
- `tool-integrations/README.md` (new) — index; **pre-seeded** with Google/Gmail, GHL, Slack rows pointing at the
  AF-003 F1–F6 findings + OD-011 (so the spike work feeds the dossiers when those connectors are specced).
- `CLAUDE.md` — new section **"Adding a new tool / connector (research-first — this triggers research)"** after
  the feasibility rules; `README.md` repo map (+standard, +`tool-integrations/` folder).

**Next step:** **OD-009 (backup/DR — elevated, top-bar)** is now the last actionable Phase-0 item before
Phase 1 (the 3 SPIKE/EVAL priority spikes are build-time, deferred). Resolve OD-009 draft→approve (may spawn a
small ADR on the ownership question — client owns the Supabase, so backup ownership/verification is ambiguous;
underpins non-negotiable #1). **Then Phase 1 component 0 (Login)** as the golden exemplar + its `system-map/`
zoom-in. Corrected vendor values (F1–F12) must propagate into the Phase-1/2 connector, token-lifecycle, and
rate-limit FRs — esp. GHL refresh-token persistence (F5), Gmail per-env quota (F1), Slack app class (OD-011).
Carry-over from ADR-006: write `standards/rbac.md` when component 7 / data model is specced. OD-010
(compensation/rollback) is a Phase-1 Harness/Guardrails item.

---

## Session 12 — 2026-06-23 — ADR-007 ACCEPTED (prompt-injection posture) — last load-bearing ADR

Fourth **draft→approve** ADR, and the **last** of the seven. Closes OD-007. User was confused by the
first draft and asked to simplify — worked it through in plain language (Option A "spot the fakes" vs
Option B "lock the doors"; bank-teller-and-vault analogy landed). He then raised two sharp instincts
that *validated* the design: (1) detection is unreliable → that's why we lock the doors; (2) scanning
everything is expensive → that's why the one paid scanner is off by default. Approved, and explicitly
asked to "make sure to have the on/off switch for the smoke alarm" → captured as config
`injection_semantic_detection` (default **off**).

**Decided (6 binding parts):**
- **Containment-first, not detection-first.** The security boundary is the controls that **ignore
  prompt content entirely** — hard limits in code (`L2053`/`L2066`), default-deny RBAC + RLS (ADR-006),
  approval gates (`L2772`), rate limits (`L2809`), physical cross-client isolation (ADR-001),
  sole-writer + sensitivity-gated memory (ADR-004). A successful injection is **contained, not
  necessarily caught**. This is "controls before gates" (ADR-003) applied to injection, and the only
  posture consistent with non-negotiable #2.
- **Keep the cheap deterministic layers, always on:** external-data **boundary tagging** (`L2965`),
  high-precision **regex tripwires** (`L2943`, log/alert only — not a gate), **webhook HMAC auth**
  (`L742–809`, a real hard control = authentication, not content-detection).
- **Detection-as-signal:** the **embedding-similarity classifier** (`L2959`, the "partly theater" part)
  ships **off by default**; when on it may only flag for triage — **never** auto-quarantine/discard/
  block. Promotion past off-by-default is EVAL-gated.
- **Fail-safe = retain + route to human.** Quarantine **holds** content (shadow-retain) and never
  machine-discards it; **discard is a human-only logged decision** (protects non-negotiable #1). Every
  match logged loudly; every quarantine alerts (protects #3).
- **Thresholds (0.85/0.95) are signal-tuning knobs, not safety dials** — config registry must document
  them as such so no future requirement mistakes a threshold for the boundary.
- **Rejected:** A1 detection-primary (the review's "theater"; unbounded false-negatives + false-positive
  quarantine drops knowledge); mandating the embedding scan on the hot ingest path (read-path cost,
  unproven payoff); machine auto-discard (violates #1).

**Captured as MUST-TEST:** new feasibility block **H** —
- **AF-068 (SPIKE / red-team)** — the containment boundary holds end-to-end: **no authorized-but-
  dangerous autonomous action path** reaches a consequential side effect (external comm / financial /
  cross-client read / destructive write / memory poisoning) without hitting a code gate that ignores
  prompt content. The whole posture rests on this; a bypass must be **closed in code**, not patched with
  a detection rule.

**Files changed:** `adr/ADR-007-injection-posture.md` (new, Accepted); `open-decisions.md` (OD-007 →
🟢); `adr/README.md` (ADR-007 Accepted); `feasibility-register.md` (new block H AF-068; next AF-069);
`glossary.md` (+Containment-first injection posture, +External-data boundary tag, +Detection-as-signal);
`what-makes-it-great.md` (#2 ⚠️ flag cleared → now points at AF-068 red-team residual); `README.md`
(ADR status line — **all seven ADRs landed**).

**Next step:** **Phase 0 ADRs are done.** Remaining before Phase 1: the **priority feasibility spikes**
(AF-001 cost, AF-002 retrieval, AF-004 provisioning) and **OD-009 (backup/DR — elevated, top-bar)**.
Then **Phase 1 component 0 (Login)** as the golden exemplar, building its `system-map/` zoom-in
alongside. Note still-owed from ADR-006: the `standards/rbac.md` standard (write it when component 7 or
the data model is specced). OD-010 (compensation/rollback) is a Phase-1 Harness/Guardrails item.

---

## Session 11 — 2026-06-23 — The three non-negotiables captured (operator's top bar)

User noted (correctly, applying Rule 0) that the "what does *great* mean to you?" question lived
only in chat, never the repo. He answered: **wants all three** — never lose/corrupt knowledge,
never do something it shouldn't, never fail (silently). Affirmed coherent: the three don't conflict
(integrity / safety / observability), they only cost rigor.

**Captured:**
- `what-makes-it-great.md` — new top section **"The three non-negotiables (the operator's top bar)"**:
  each invariant + what upholds it + what threatens it. Framed as the **ranking rule** for Phase-1
  trade-offs (invariant wins over convenience/speed/scope).
- `process-overview.md` — added the three to "what the user wants."
- **OD-009 (backup/DR) ELEVATED** — it underpins non-negotiable #1, so it's now top-bar, not a
  Phase-5 nicety; resolve early.
- `CLAUDE.md` — added a binding **"three non-negotiables"** section right after Rule 0 (they were
  only transitively reachable via process-overview; now every chat treats them as the ranking rule).

**Consequence to remember:** invariant #1 leans on OD-009 (backup/DR — still a gap); invariant #2
leans on ADR-007 (injection — still open, next up). So the two open items both touch a non-negotiable.

**Next step:** unchanged — **ADR-007 (prompt-injection posture)**, draft→approve (last load-bearing
ADR); then priority spikes (AF-001/002/004); then Phase 1 (component 0 Login). Resolve OD-009 early
given its elevation.

---

## Session 10 — 2026-06-23 — ADR-006 ACCEPTED (dynamic roles vs static RLS)

Third **draft→approve** ADR. Closes OD-006 — roles are editable at runtime but RLS is authored at
migration time. User asked to "simplify" and worked through it interactively (anchored on "aren't we
using Supabase for login/OAuth?" — yes, and ADR-006 sits on top of it). The keycard analogy landed;
user pushed "why not make both [grant + revoke] instant?" — which pushed the design to the *simpler*
pole and removed a whole sub-problem.

**Decided (6 binding parts):**
- **False fork — keep both via static, data-driven RLS over *live* permission data.** Permissions
  live in **tables** (`roles`, `role_permissions`, `user_roles`, `sensitivity_clearances` w/
  entity-type scope, `restricted_grants`), edited from the dashboard with **no migration**. RLS
  policies are authored once, **generic** (never name a role), and look up the user's *current*
  permissions **live** each query via `STABLE SECURITY DEFINER` helpers keyed on `auth.uid()`.
- **Every change is instant** — grant *and* revoke — because nothing is cached on the token. This
  deleted the original "propagation latency" fork entirely (no JWT snapshot → no staleness window →
  no split grant-lazy/revoke-forced rule, no forced-logout machinery).
- **Division of labor:** RLS owns the visibility/sensitivity/Restricted **row-access** subset (DB
  backstop); the **harness** owns the full permission matrix in code. Both read the same tables →
  can't drift.
- **Two ADR-001 reconciliations baked in** (so nothing re-reads stale doc text): RLS is
  **intra-client only** — the doc's `client_slug` clause (`L724`) is **deleted**, cross-client
  isolation is physical; and RLS guards the **user-session** path only — the Memory Agent (sole
  writer, ADR-004) + backend run as the **service role**, which **bypasses RLS** (governed by harness
  RBAC). No requirement may assume RLS guards an agent write.
- **Rejected:** D1 one-policy-per-role (migration per edit, breaks `L471`/`L639`); D2 JWT-cached
  permission claims (faster reads but imports a staleness/propagation problem not worth it at ≤20
  users — kept only as the documented fallback, OOS-012).

**Captured as MUST-TEST:** new feasibility block **G** —
- **AF-067 (SPIKE+LOAD)** — live data-driven RLS performs on the **hot retrieval path** (the `STABLE`
  helper lookup, once per statement over tiny indexed tables, composing with pgvector ranking of a
  large memory batch). The whole D3 choice rests on this; D2 JWT-cache is the fallback if it fails.

**Files changed:** `adr/ADR-006-rls-dynamic-roles.md` (new, Accepted); `open-decisions.md`
(OD-006 → 🟢); `adr/README.md` (ADR-006 Accepted); `feasibility-register.md` (new block G AF-067;
next AF-068); `out-of-scope.md` (OOS-012 JWT-cached claims deferred; next OOS-013); `glossary.md`
(+Data-driven RLS, +Permission tables, +Restricted grant, +Entity-type-scoped clearance,
+Service-role bypass); `README.md` (ADR status line).

**Still owed (deferred to where context is richest, not now):** the new binding standard
`standards/rbac.md` (two-level RBAC + RLS model, default-deny, RLS-vs-harness division, service-role
caveat, `PERMISSION_NODES.md` convention) — write it when component 7 (RBAC/Guardrails) or the data
model is specced, per the ADR's Consequences. ADR-006 is the source of truth meanwhile.

**Next step:** **ADR-007 (prompt-injection posture)** — draft→approve (OD-007). The last load-bearing
ADR. Decide how much to lean on code-level hard limits vs regex/embedding detection (the doc calls the
latter "partly theater" + false-positive-quarantine risk); affects the Guardrails component. Note the
ADR-003 hard-limit precedent ("controls before gates") and `L2066` ("no user role, no agent
instruction, no config change can override a hard limit") as the lock-points. Then priority spikes
(AF-001 cost, AF-002 retrieval, AF-004 provisioning), then Phase 1 (component 0 Login).

---

## Session 9 — 2026-06-23 — Quality bar + failure overlay + honest "is it great?" audit

User pushed: the happy-path map looked too simple and lacked the finer detail separating a good vs
great harness, and asked whether the "great" stuff is actually in our system — capture it if not.

**Created:**
- `what-makes-it-great.md` — the great-vs-good quality bar across 12 dimensions, **plus an honest
  coverage audit** (where each lives in the design doc / ADRs + status: designed / ADR-hardened /
  paper-pending-test / gap). Headline: most great dimensions ARE designed in or ADR-hardened; the
  rest is "great on paper, must be tested" (AF register). Becomes a Phase-1 gate.
- `system-map/failure-overlay.md` — the shadow map: per step, what goes wrong + the mechanism that
  catches it (with cites). This is where the real depth/complexity lives.
- Rendered both as live visuals.

**Gaps surfaced & tracked:** **OD-010** (compensation/rollback of partially-completed task chains —
no undo story for external side effects when a chain halts; the one genuinely new gap from the
audit). OD-009 (backup/DR) reaffirmed. Everything else either designed, ADR-hardened, or in the AF
register as paper-pending-test.

**Wired:** README repo map; phase-playbooks Phase 1 step 8a (quality-bar + failure-overlay check
per component). 

**Answer to "is the great stuff in our system?":** mostly yes (dimensions 1–10 designed/hardened);
2 real gaps now tracked (OD-009, OD-010); the residual risk is paper-pending-test items, all logged.

**Next step:** unchanged — **ADR-006 (dynamic roles vs static RLS)**, draft→approve; then ADR-007;
then spikes; then Phase 1.

---

## Session 8 — 2026-06-23 — System map + per-component zoom-ins + grounding mode

User hit real anxiety: couldn't picture the system end-to-end ("blank in my head"), feared he
couldn't explain it / that the build won't match the vision stuck in his head. **Root cause = a
missing top-down VIEW** (we'd only ever built bottom-up: decisions/ADRs/requirements). Fix = make
the system visible, and build support for the user into the repo.

**Created:**
- `system-map.md` — top-down end-to-end route (8-stage "drive"), the continuous layer
  (loops/observability/proactive), the infra/compliance foundation, component legend C0–C10, and
  the **simulation technique** (walk a scenario down the map → each gap becomes an OD/requirement)
  with a worked GHL-lead example.
- `system-map/` — per-component zoom-in folder + index (all 11). **Build policy:** each zoom-in is
  built when we spec that component in Phase 1, so maps never drift from requirements. `02-memory.md`
  built now as the **exemplar** (reflects ADR-002/003/004). Out-of-order builds allowed if a
  component is causing anxiety.
- `working-with-me.md` — **grounding mode**: recognise the pattern (anxiety = missing-view signal,
  not a defect), do/don't list, and a 7-step "ground me" protocol.

**Wired:** CLAUDE.md now opens with a priority **grounding-mode** section + map pointers; README
repo map updated. Rendered the e2e map and the Memory zoom-in as live visuals in chat.

**Next step:** unchanged — **ADR-006 (dynamic roles vs static RLS)**, draft→approve; then ADR-007;
then priority spikes; then Phase 1 (component 0 Login as golden exemplar). When we spec each
component, build its `system-map/` zoom-in alongside it.

---

## Session 7 — 2026-06-23 — ADR-005 ACCEPTED (deploy fan-out & provisioning)

Second **draft→approve** ADR. Closes OD-005 — deploy fan-out, per-client provisioning, and version
skew, all asserted-not-designed in the doc. User chose the two forks in plain-language terms after I
explained them; then flagged a real gap (a brand-new business has no data to test a canary on), which
became a third decision axis.

**Decided (7 binding parts):**
- **Fan-out is already solved by ADR-001 §6** — no custom CI; each Railway project natively tracks the
  shared repo. `client_registry` is the observability map, not the deploy driver. Also re-stated
  ADR-001 §7 (push, not pull) for version/health reporting.
- **Blast radius = canary + release-train** (chose A3 over instant-global / per-deployment-manual):
  feature → `release` (canary tracks) → promote (fast-forward) → `main` (fleet auto-deploys). Promotion
  gated on tests + clean migration + green smoke battery + soak. Per-deployment migration-failure
  isolation retained (`L1141-1160`).
- **Version skew is normal + bounded, not an error** — made safe by **expand-contract migrations**
  (new binding standard `standards/migration-discipline.md`); rollback = code-redeploy + roll-forward,
  **never destructive down-migration**; `deploy_max_version_skew`/`deploy_max_skew_days` alert catches
  laggards.
- **Provisioning = scripted CLI + runbook** (chose B3 over full-IaC / pure-manual), **two-party** per
  ADR-001 hybrid: client creates cost-bearing accounts + card + delegated access (runbook); operator
  script does Railway link + env/`DEPLOYMENT_CONFIG` + `internal_token` mint/dual-store + `client_registry`
  insert + first-deploy→seed. **Operator-side registration** (no self-registration → no token chicken-and-egg).
- **OAuth apps per-client in the client's own accounts** (ADR-001 §5), redirect URIs → that deployment's
  Railway domain. ⚠️ Google **production verification** (AF-013) is a real onboarding **schedule dependency**.
- **Canary test method** (user's gap): **seeded synthetic client + deterministic smoke battery** now
  (catches boot/migration/connector + behavioral checks; shares the AF-001/AF-002 corpus), maturing into
  **operator dogfooding** its own deployment. Honest limit flagged: catches only what fixtures cover.
- **Plugins stay out of the release train** (per-deployment, manual; version-visibility only).

**Captured as MUST-TEST:** new feasibility block **F** —
- **AF-064 (DOCS+SPIKE)** — Railway supports the branch-based canary/promotion + build-history rollback model.
- **AF-065 (SPIKE)** — expand-contract keeps a mixed-version fleet safe (the skew + rollback premise). *Parts 3+4 rest on this.*
- **AF-066 (EVAL)** — the synthetic canary corpus is representative enough to catch behavioral regressions.
- Sharpened **AF-004** (full provisioning path) and **AF-020** (Railway auto-deploy + migrate-on-release).

**Files changed:** `adr/ADR-005-deploy-provisioning.md` (new, Accepted); `open-decisions.md` (OD-005 → 🟢);
`adr/README.md` (ADR-005 Accepted); `feasibility-register.md` (new block F AF-064–066; AF-004/020 sharpened;
next AF-067); `glossary.md` (+Canary deployment, +Release train/promotion, +Version skew, +Expand-contract
migration, +Provisioning script vs runbook, +Synthetic canary corpus/smoke battery); `out-of-scope.md`
(OOS-010 automated plugin distribution, OOS-011 full-IaC; next OOS-012); `standards/migration-discipline.md`
(new, Binding); `README.md` (ADR status line, repo map standards).

**Next step:** **ADR-006 (dynamic roles vs static RLS)** — draft→approve (OD-006). Roles are editable at
runtime but RLS is authored at migration time; ADR-001 made RLS **intra-client only** (role/visibility/
sensitivity, never client separation) — lock against that. Then ADR-007 (injection posture, OD-007), then
priority spikes (AF-001 cost, AF-002 retrieval, AF-004 provisioning), then Phase 1 (component 0 Login).

---

## Session 6 — 2026-06-23 — ADR-004 ACCEPTED (memory-write concurrency)

First **draft→approve** ADR (not a grill). Closes OD-004 — the contradiction-check-then-write
TOCTOU race under `parallel_execution`/fan-out.

**Decided:** **Per-entity serialization + optimistic validate-and-commit.**
- Serialize only **same-entity** writes (disjoint writes stay parallel → fan-out preserved). A
  contradiction is always same-entity, so that's the only race that matters.
- **Core insight:** can't hold a DB lock across the multi-second Sonnet writer (pool exhaustion +
  ADR-003 waste). So LLM work runs **unlocked**; then a **short** transaction under **sorted
  per-entity Postgres advisory locks** (`pg_advisory_xact_lock`, sorted = deadlock-free) re-checks
  a per-entity watermark `max(updated_at)` — unchanged → commit; changed → re-run only the cheap
  **DB** contradiction check (no LLM) and commit/re-target/bounce. Locks held ~ms.
- Three supports: **Memory Agent = sole writer** (invariant, locks design `L3435`); **unique
  idempotency constraint** `hash(source_ref, sorted entity_ids, content_hash)` kills retry
  double-writes; **CAS supersede** (`WHERE superseded_by IS NULL`) kills lost supersession.
- Daily supersede / weekly merge **demoted** from correctness to hygiene. `memory_writes_per_minute:30`
  makes serialization effectively free.
- **Rejected:** A do-nothing/daily-job (wrong for hours), B global-serialize (kills fan-out),
  C pessimistic-lock-across-LLM (wrong granularity + hold time), D optimistic-only (misses the
  duplicate-insert case — folded in as a support instead).
- **User-flagged knob (left as-is):** on a detected race the re-check re-runs the **DB** check, not
  a full Sonnet re-decision — deliberate "good enough" to avoid LLM livelock. User approved.

**Captured as MUST-TEST (user explicitly asked):** new feasibility block **E** —
- **AF-061 (SPIKE+EVAL)** — the validate-and-commit actually closes the window, no livelock. *The
  whole correctness claim rests on this.*
- **AF-062 (LOAD)** — advisory locks + short txns don't bottleneck at scale; multi-entity locks
  deadlock-free.
- **AF-063 (DOCS+SPIKE)** — Inngest per-key concurrency behaves as assumed; degrades safely to
  advisory-lock-only.

**Files changed:** `adr/ADR-004-concurrency-model.md` (new, Accepted); `open-decisions.md`
(OD-004 → 🟢); `adr/README.md` (ADR-004 Accepted); `feasibility-register.md` (new block E
AF-061–063; next AF-064); `glossary.md` (+TOCTOU race, +Per-entity serialization, +Advisory lock,
+Optimistic validate-and-commit, +Idempotency key); `README.md` (ADR status line).

**Next step:** **ADR-005 (deploy fan-out & provisioning automation)** — draft→approve (OD-005).
Push-deploy to N Railway projects + per-client Supabase/OAuth provisioning + version skew across
clients. Builds on ADR-001 (hybrid ownership). Priority spike AF-004 (provisioning) is its
companion. Remaining draft-approve ADRs after that: ADR-006 (RLS/dynamic roles, OD-006),
ADR-007 (injection posture, OD-007). Then priority spikes, then Phase 1 (component 0 Login).

---

## Session 5 — 2026-06-22 — Process fully externalized (full-optics docs)

User wanted the entire operating model written down now (not just-in-time), with full optics —
what/want/goal/why/how — so any future chat inherits the complete picture and never has to
*invent* methodology (only *follow* it).

**Created:**
- `spec/00-foundations/process-overview.md` — the optics bible: WHAT we're doing, WHAT the user
  wants, the GOAL (Point B / DoD), WHY (first principles), HOW (the machine), ID system,
  artifacts map, who-decides-what, current-state pointer.
- `spec/00-foundations/phase-playbooks.md` — repeatable procedure for all 6 phases. Phase 0 + 1
  at full mechanical detail (Phase 1 is the engine: 10-step per-component loop incl. parking
  cross-phase CFG/UI/DATA/PERM stubs, verification gate, sign-off). Phases 2–6 at goal+approach+
  done-when altitude, each finalized right before entry (living docs, change-controlled).

**Wired:** CLAUDE.md start-of-session reading list now includes both, + the **self-sufficiency
test** (repo alone must suffice, zero conversation). README repo map updated.

**Principle locked:** *author methodology where context is richest (now); future chats execute,
never invent.* The repo-self-sufficiency test is the guard against drift across chats.

**Next step:** unchanged — **ADR-004 (concurrency model for memory writes)**, draft→approve.
Then ADR-005/006/007, priority spikes (esp. AF-001 cost, AF-002 retrieval), then Phase 1
(component 0 Login as the golden exemplar).

---

## Session 4 — 2026-06-22 — Process hardening (5 additions) + retrofit pass

(Side chat, after ADR-003 committed `411364a`. This chat became the writer; working tree was
clean/synced first.) Added five process improvements the user requested:

1. **Backup & disaster recovery** — logged **OD-009** (whose job + strategy; ADR-001's
   client-owned Supabase makes backup ownership/verification ambiguous) and added it to Phase 5
   scope in README. Net-new gap, not a retrofit.
2. **out-of-scope.md created** (OOS-001..009) — seeded by **retrofitting deferrals already made**
   in ADR-001/002/003: region v2, confidence-weighted slot-fill v2, re-rank/HyDE off-by-default,
   self-host Inngest, full Model-A (client compute) exception-only, Pooled fallback, weekly cost
   auto-throttle out, HR ingestion off, cost reconcile deferred.
3. **Build-order / dependency map** — added to Phase 6 (README).
4. **Change-control standard** (`standards/change-control.md`) — Accepted ADRs immutable
   (supersede via new ADR); Ready/Approved FRs change via a new OD. Wired into CLAUDE.md +
   requirement-template.
5. **Component sign-off** — added `Approved` to the FR status lifecycle (requirement-template),
   the end-of-session ritual (CLAUDE.md), and the Definition of Done (README).

**Retrofit check — result: nothing needs reopening.** ADRs 001–003 stand as-is; they were
signed off via grilling, so the new `Approved` status applies to Phase-1 component FRs going
forward, not retroactively. The only retrofit was capturing their already-made deferrals into
out-of-scope.md (#2 above). Accepted ADRs are now under change-control from here on.

**Files changed:** `out-of-scope.md` (new), `standards/change-control.md` (new),
`open-decisions.md` (OD-009; next = OD-010), `requirement-template.md` (Approved status +
rules 7–8), `CLAUDE.md` (change-control + sign-off ritual), `README.md` (repo map, Phase 5
backup/DR, Phase 6 build-order, DoD).

**Next step:** unchanged — **ADR-004 (concurrency model for memory writes)**, draft→approve.
Lock against the ADR-003 write-path (code filter → Haiku gate → Haiku pre-check → Sonnet writer)
and the `memory_writes_per_minute:30` cap (per Session 3 note).

---

## Session 3 — 2026-06-22 — ADR-003 ACCEPTED (cost model — client-side viability + cost ladder)

**Decided (grill complete, all forks resolved; closes OD-003):**
- **Scope reframed by ADR-001:** opex client-borne → operator marginal cost ≈ $0. Cost is **not**
  operator P&L. ADR-003 commits to (a) a per-deployment viability **envelope** and (b) runaway
  **guarantees**. (Rejected operator-P&L framing — would reopen ADR-001; rejected mechanisms-only.)
- **Breach = tiered ladder, not alert-only** (modelled on the rate-limit 80/95/100 ladder):
  soft alert `$50/day` + `$200/week` (notification only) → **throttle** non-critical at `$75/day`
  (1.5×) → **hard kill** at `$100/day` (2×) = urgent + human-only. All keys per-deployment,
  operator-tunable to client spend tolerance. Daily≠weekly×7 is intentional (spike vs sustained).
- **Cost source = estimate-grade**, not invoice: event-log tokens × an operator-editable price
  table; **all vendors** (Sonnet+Haiku+OpenAI embeddings); **fail-safe rounded UP** so the ceiling
  fires early. Real invoice is unreachable (ADR-001 boundary).
- **Memory write corrected:** OD-003's "3 Sonnet calls" is **wrong** → ≤**1 Sonnet** (writer) +
  Haiku pre-checks; code noise-filter + Haiku selective-writing gate run first. `memory_writes_per_minute:30`
  caps Sonnet writer at 30/min, not 90.
- **Loops short-circuit in code** (DB/condition check) before waking the Sonnet orchestrator —
  idle-deployment loop floor ≈ free. Not an LLM gate.
- **Principle "controls before gates"** (binding): structural/code limits first; one self-funding
  Haiku gate only (selective-writing); **re-rank/HyDE NOT mandated** (AF-002-gated). User pushed on
  "do we need extra LLM gates" — answer: mostly no.
- **Viability target ≤ ~$20/day typical**, $50 = investigate, $100 = backstop. Lever order if AF-001
  shows over-budget: model routing → selective-writing → loop gating → injection limit → orchestrator
  confidence threshold (highest leverage).
- **Haiku decision log + trust window (user-requested, ADR-003 §8):** all 3 memory-path Haiku
  decisions logged (input + verdict + outcome) for manual review; **3-week trust window**
  (`haiku_audit_window_days:21`) in **shadow-retain** mode (would-drop memories written + tagged,
  never lost); after the window, if disagree-rate < threshold the gate goes autonomous. This audit
  log IS the validation data for AF-043/AF-035. Same pattern = template for auditing routing later.
- **Model-routing telemetry (user-requested):** standing **dual-track** — cost (model+task+$) AND
  quality (false-drops/mis-routes/classifier errors). A cost win is worthless if quality silently
  degrades. → AF-035 sharpened.

**Files changed:** `adr/ADR-003-cost-model.md` (new, Accepted; incl. §8 Haiku decision log + routing
telemetry); open-decisions (OD-003 → 🟢); glossary (+Estimated cost, +Cost ladder, +Critical work,
+Haiku decision log, +Trust window, +Shadow-retain; Guardrail row +cost ladder); feasibility-register
(AF-001/035/040/041 sharpened; **AF-042** estimator drift, **AF-043** gate ROI/trust added); adr/README
(ADR-003 Accepted); README (ADR status line — all 3 load-bearing grills done).

**Feasibility:** ⚠️ AF-001/040/041 (viability target paper-only until cost spike) · ⚠️ AF-042
(estimate-vs-invoice drift) · ⚠️ AF-043 (selective-writing gate must pay for itself).

**Next step:** **ADR-004 (concurrency model for memory writes)** — draft→approve (not a grill).
TOCTOU race on contradiction-check-then-write under parallel agents; no per-entity locking defined
(OD-004). Note for ADR-004: the ADR-003 write-path (code filter → Haiku gate → Haiku pre-check →
Sonnet writer) and `memory_writes_per_minute:30` cap are the concurrency surface to lock against.

---

## Session 2 — 2026-06-22 — ADR-002 ACCEPTED (coverage % → Maturity + Retrieval Sufficiency)

**Decided (grill complete, 5 forks resolved):**
- **Q1 — split** the overloaded "coverage %" into two metrics (vs one number for both jobs).
- **Q2 — denominator = expected knowledge slots** per entity type (vs volume / confidence-only).
  Binary slot-fill at v1.
- **Q2b — one slot substrate, two read-paths** (vs two independent engines) + three anti-bloat
  guardrails: thin Sufficiency (no bespoke model), 5–8 operator-editable slots/type, defer
  confidence-weighted fill to v2.
- **`[Building]` recurs per-entity:** deployment cold-start *mode* is one-time (off at 80%
  permanently); the `[Building]` *flag* reappears for new/thin entities (e.g. a year-two client).
  Resolved the doc's two self-contradictions (per-entity vs overall; "permanent" vs recurring).
- **OD-008 closed:** `[Building]` is a flag, not a 4th pill → 3 pills (Cited/Inferred/Unknown).

**Model:** Maturity = `filled slots / expected slots` (stored, daily + on-write, aggregate gates
cold-start 20/50/80). Retrieval Sufficiency = query-time threshold over existing retrieval
signals (slots-touched filled AND surfaced above relevance×confidence bar). Pill rule:
low Sufficiency + entity Maturity < proactive(50) → `[Building]`; else `[Unknown]`.

**Files changed:** `adr/ADR-002-coverage-metric.md` (new, Accepted); glossary (retired Coverage %,
added Maturity / Retrieval Sufficiency / Expected knowledge slot, resolved Answer mode + Cold
start); open-decisions (OD-002, OD-008 → 🟢); adr/README (ADR-002 Accepted); feasibility-register
(AF-034 sharpened); README (ADR status line).

**Feasibility:** ⚠️ AF-034 — slot-fill Maturity predicting "useful" + the Sufficiency threshold
separating `[Building]`/`[Unknown]` are **paper-only**, validated in the AF-002 retrieval spike.

**Next step:** Grill **ADR-003** (cost model & economic viability — last load-bearing grill).
Note from ADR-001: opex is client-borne, so cost tracking is *visibility-grade, not
invoice-grade* — fold that into the ADR-003 framing. AF-001 cost spike runs alongside.

---

## Session 1 — 2026-06-22 — Foundations + ADR-001

**Decided:**
- Method locked: git markdown repo · grill load-bearing ADRs / draft-approve the rest ·
  foundations first then components 0→10. (See README.)
- **ADR-001 (Isolation model) — Accepted.** Silo (one Supabase per client) · single
  codebase / N runtimes · `client_slug` deleted from all app tables · hybrid account
  ownership (client owns Supabase + API keys + opex on their card; operator owns Railway
  compute / the moat) · Railway GitHub auto-deploy · Super Admin = pushed operational
  metadata only, never client business data.

**Created:**
- Repo skeleton: `README.md`, `CLAUDE.md`, `spec/00-foundations/` (id-conventions,
  requirement-template, glossary, open-decisions, adr/, standards/config-edit-taxonomy),
  `traceability-matrix.csv`, `spec/source/` (design doc + review scaffolding copied in).
- `spec/00-foundations/adr/ADR-001-isolation-model.md`.

**Open decisions remaining:** OD-002..OD-008 (see open-decisions.md). Load-bearing grills
left: ADR-002 (coverage metric), ADR-003 (cost model). Draft-approve: ADR-004 (concurrency),
ADR-005 (provisioning/deploy), ADR-006 (RLS), ADR-007 (injection), OD-008 (pill count).

**Added (post-ADR-001):** Feasibility track — `spec/00-foundations/feasibility-register.md`
(AF-* IDs, seeded with 4 priority spikes + vendor/behavioural/cost/scale assumptions). Wired
into CLAUDE.md (feasibility flagging rule), id-conventions (AF- type), requirement template
(Feasibility field), README (parallel track). ACRONYMS.md added at repo root.

**Next step:** Grill ADR-002 — define "memory coverage %" (the metric behind cold-start
gating, the [Building] pill, proactive suppression). Currently a percentage with no
denominator. When defined, link it to AF-034 (is the metric actually meaningful — EVAL).
