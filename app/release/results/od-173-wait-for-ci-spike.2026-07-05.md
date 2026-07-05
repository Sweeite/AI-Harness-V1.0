# OD-173 / AF-064 — Wait-for-CI live spike (the #3 hazard) — 2026-07-05, session 64

**Two-party (operator present).** Railway project `adaptable-miracle`, **canary environment** `023f250b`
(created this session) tracking branch **`release`**, Root Directory `/app/service`, **"Wait for CI" ON**;
production environment `1373cde3` tracks `main`. GitHub repo `Sweeite/AI-Harness-V1.0`, CI workflow
`.github/workflows/ci.yml` (the merge gate — 6 package jobs + the expand-contract discipline gate).

## The hazard under test (railway.md §7 / OD-173)

Railway has **no native promote primitive** → promotion is a Git fast-forward `release`→`main`, gated by
Railway **"Wait for CI"**. The **#3 danger:** "Wait for CI" waits on the commit's check suites — a broken
build must be **blocked**, never silently deployed. Spike goal: prove a **red own-suite check BLOCKS the
canary deploy** (a broken build never rolls forward), and observe the gate's release-on-green behaviour —
**before FR-10.DEP.002 is treated as a proven live mechanism** (AF-064 🟡→🟢).

## GREEN path — a CI-green push deploys (Wait-for-CI releases)

- Pushed **`84878f5`** to `release` (adds `app/service/src/version.ts` + `/version` route → touches
  `/app/service`, so `watchPatterns` matches). CI run `28728021889` → **success** (all 6 package jobs +
  discipline green).
- **Result:** Wait-for-CI released the hold → the canary **auto-deployed a new build `16e41e5d`** on
  `84878f5`, instances `RUNNING`. `GET /health` → **200**; `GET /version` →
  `{"core_version":"84878f5ddaaf…","last_migrated_at":null,"plugin_version":null}` — the live version
  signal reports the deployed commit SHA (AC-10.DEP.001.1 auto-deploy + AC-10.DEP.004.1 core_version,
  live).

## RED path — a CI-red push is BLOCKED (the #3 guard) ✅

- Pushed **`078b30c`** to `release` — a deliberately failing service test (`spike-red.test.ts`, touches
  `/app/service`). CI run `28728079086` → **failure** (service job `failure`; overall red).
- **Result:** for **2+ minutes / 9 polls** after CI concluded failure, the canary **held the prior good
  build `16e41e5d`/`84878f5` RUNNING and never rolled forward to `078b30c`.** `GET /version` stayed
  `84878f5…` throughout. **Wait-for-CI blocked the broken build** — a red own-suite check does NOT deploy.
- Reverted (`5c50450`, removes the spike test) → CI green → canary reconverged to the clean build.

## Verdict

- **CONFIRMED (live):** a **red own-suite check blocks the canary deploy** — the load-bearing #3 guard of
  OD-173. A broken build cannot silently reach the (canary, and therefore the) fleet. Green releases,
  red blocks.
- **Honest scope limit (residual):** the repo currently has exactly **one** check-suite producer
  (`ci.yml`), so the *block-on-red* behaviour is proven for our own suite. The broader dossier claim —
  "Wait for CI waits on **ALL** check suites, so an unrelated/stale/skipped third-party check could hold
  or skip a deploy" — remains **DOCS-backed** (railway.md §7), not adversarially re-tested here. **If a
  third-party check suite is later added to the repo, re-confirm the aggregate behaviour.** This is the
  ADR-005 §2 honest limit; it does not weaken the proven #3 guard.

**AF-064 → 🟢** for the branch-per-environment canary/release-train + Wait-for-CI promotion gate mechanism
(block-on-red proven live). **Build-history rollback** (`deploymentRollback` / rollback = redeploy prior
build): the *mechanism* is DOCS-confirmed in the Railway dossier (railway.md §10/§AF-064); the rollback
*safety* (prior code runs correctly against the newer, additive schema — the load-bearing premise) is
**AF-065 🟢, proven LIVE in ISSUE-008 session 62** (`app/silo/results/af-065-mixed-fleet-spike.sql`), and
"no down-migration reverse path" is the offline gate `assertNoDownMigration` (release.test.ts). Per the
issue's §9, the rollback ACs (AC-10.DEP.003.1/.2, AC-NFR-INF.003.1/.2) are proven by DOCS + AF-065 + the
offline gate — a live `deploymentRollback` exercise is **not DoD-required** and was not run this session.

## Bonus finding — watchPatterns net-diff skip (correct, not a bug)

After reverting the red spike (`5c50450`), the canary did **not** redeploy: the net diff of `5c50450` vs
the last-deployed `84878f5` within the watched path `/app/service/**` is **empty** (the spike test file
was added in `078b30c` then removed in `5c50450`), so Railway correctly **skipped** the redeploy. The
canary stays on `84878f5`, functionally identical to `release` HEAD in the deployed path. This is the
same `watchPatterns` scoping that keeps a spec/tracker-only commit from redeploying the fleet.
