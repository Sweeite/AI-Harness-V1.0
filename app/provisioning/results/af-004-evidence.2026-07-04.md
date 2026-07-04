# AF-004 evidence — live end-to-end provisioning against a client-owned Supabase

**Date:** 2026-07-04 · **Session:** 60 · **Result:** 🟢 PASS (provisioning plumbing) · **Run by:** operator-present two-party session.

The load-bearing launch-gating spike (feasibility-register **AF-004**): an operator-owned **Railway**
service, deployed from the shared GitHub repo's `app/` subtree, injected with env + secrets and
reaching a **client-owned Supabase** silo, with the `internal_token` dual-stored and a `client_registry`
row written. This is the one red gate that blocked Checkpoint 0.

## Infrastructure used (real)

| Piece | Identity (non-secret) |
|---|---|
| Client silo (Supabase) | `Transpera-AIOS-V1`, ref `nwufvzaamomajdyzemhx`, region **Oceania/Sydney `ap-southeast-2`** |
| Management plane (Supabase) | `ai-harness-mgmt`, ref `fsvbtasizctwnypksile`, Sydney (created this session) |
| Railway project / service / env | `adaptable-miracle` `035eae9a…` / `AI-Harness-V1.0` `c43f8606…` / `production` `1373cde3…` |
| Deployed service URL | `https://ai-harness-v10-production.up.railway.app` |
| Deployed commit | `324ae79` (GitHub-native auto-deploy) |

*(All keys/tokens/passwords held session-only, never committed.)*

## What was proven (each an AF-004 sub-claim)

1. **GitHub-native deploy from a subdirectory** — Railway service **Root Directory = `/app/service`**
   set via `serviceInstanceUpdate`; a push of `324ae79` to `main` auto-built **only `app/service`**
   (RAILPACK/Node); deploy status **`SUCCESS`**. *(Confirms the ADR-005 deploy mechanism + AF-141's
   note that the GitHub App install is the one manual precursor — see below.)*
2. **Env + secret injection** — all seven `REQUIRED_SECRETS` present on the service
   (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `INTERNAL_TOKEN`, `LOGIN_OAUTH_CLIENT_ID`, `LOGIN_OAUTH_CLIENT_SECRET`). Anthropic/OpenAI set by
   the operator in the Railway UI (never transited this session); the rest set via
   `variableCollectionUpsert` (`skipDeploys:true`).
3. **`internal_token` dual-store** — minted (`itk_…`, 68 chars), stored in the Railway env
   **and** in `client_registry.internal_token` on the management-plane DB.
4. **`client_registry` write** — one row on the mgmt plane:
   `client_slug=canary · region=ap-southeast-2 · status=initialising · railway_url=<the deploy URL>`.
5. **Boot + reachability gate** — `GET /health → 200`
   `{"ok":true,"missingSecrets":[],"supabaseReachable":true,"detail":"ready"}` — i.e. the deployed
   Railway service **reached the client-owned Supabase silo** (PostgREST) with the injected
   service-role key, and Railway's healthcheck gated the deploy live only on that 200.
6. **`client_registry` DDL** applied to the mgmt plane from
   `app/management/migrations/0001_client_registry.sql` (table + `client_status` enum, verbatim schema §13).

## Railway GraphQL mutations validated live (AF-143)

`serviceInstanceUpdate` (rootDirectory) · `variableCollectionUpsert` / `variableUpsert` (skipDeploys) ·
`serviceDomainCreate` · `deployments` query (status enum) · `me`/`workspaces`/`project` queries. Each
returned as the dossier (`tool-integrations/railway.md`) predicted.

## Honest caveats (what this run did NOT cover)

- **The `/health` service is the minimal boot PROBE, not the real first-boot seed.** The C0/C1 seed
  (Internal Org + first Super Admin + roles + agents) is **owned by other issues** and not built;
  ISSUE-007 §2 explicitly scopes provisioning to *triggering* the seed, not the seed itself. So the
  `initialising → active` transition (which the real seed drives) was not exercised.
- **`LOGIN_OAUTH_*` are placeholders** — no per-client login-OAuth app is registered yet
  (FR-10.PRV.002 / per-onboarding). The boot gate checks presence, not validity.
- **Canary live seed not run** — the `SupabaseSeed` adapter (FR-10.PRV.003 live half) that seeds the
  `app/canary` corpus into the silo is not yet built/run (needs the OpenAI key, which stays on Railway).
- **`RailwayInfra` adapter not codified** — the provisioning steps were driven by direct GraphQL/CLI
  calls this session (which validate the adapter design); folding them into
  `app/provisioning/src/infra.ts` (replacing `TODO(AF-004)`) is the remaining automation step.
- **AF-064** (canary env / promote / rollback) was **not** exercised — stays 🟡.

## Verdict

**AF-004 → 🟢** for the provisioning-mechanics claim it gates (deploy-from-subdir · env/secret injection ·
`internal_token` dual-store · `client_registry` write · boot + client-Supabase reachability, all on real
operator-Railway + client-Supabase infra). The seed integration, canary live seed, and `RailwayInfra`
codification are tracked follow-ups on ISSUE-007 — **Checkpoint 0 does not close until those land.**
