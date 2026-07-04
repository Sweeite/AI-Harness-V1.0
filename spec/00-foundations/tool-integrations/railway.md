# Tool Integration Dossier — Railway (deployment PaaS)

> Primary-source, date-stamped research for the **operator-owned compute platform** (ADR-001 §5,
> ADR-005). Railway is a **platform dependency**, not a per-client connector — but it is the target
> of automated provisioning code (`RailwayInfra`, the live `Infra` adapter for ISSUE-007 / AF-004),
> so it gets the full 12-dimension dossier. **No `RailwayInfra` / connector FR may cite Railway
> vendor facts except from this dossier** (Rule 0 / the tool-integration gate).

- **Tool / vendor:** Railway (`railway.com`, formerly `railway.app`) — deployment PaaS on GCP.
- **Status:** 🟡 researching (DOCS complete + gate passed; **load-bearing items need a live SPIKE** before the connector FRs / AF-004 are marked Ready — see below)
- **Verified on:** 2026-07-04   ·   **Re-verify by:** 2026-10-04 (**90 days** — no public-API stability SLA + recent plan/pricing churn justify a tight quarterly cadence)
- **Researched by / session:** Session 59 (parallel research fan-out, 8 sub-agents)
- **Applicability:** ALL clients — the operator runs **one Railway service per client** (a fleet of small always-on Node services, ADR-009), each deploying the **same repo from `app/`** against a **client-owned Supabase**. Load-bearing for FR-10.PRV.001 (provisioning), FR-10.DEP.002 (canary/promote), FR-10.DEP.003 (rollback), NFR-INF.006/007.
- **Read / write / both:** write (provisioning/deploy control-plane) — the harness *drives* Railway; Railway does not feed data into memory.

---

## Verdict summary

| Dimension | Verdict | Headline | Source date |
|---|---|---|---|
| 2 Auth & tokens | ✅ VERIFIED | 3 static token tiers; **provisioning needs a Workspace/Account token — project tokens can't create** (→ god-mode blast radius). Static tokens: no documented expiry. | 2026-07-04 |
| 3 Rate limits | ✅ VERIFIED | Pro 10k RPH / 50 RPS; **real-world Cloudflare-1015 bans below the ceiling** → backoff mandatory for fleet automation. | 2026-07-04 |
| 4 API surface | ✅ VERIFIED (⚠️1 gate) | Every provisioning op is scriptable via GraphQL `/graphql/v2` — **EXCEPT the GitHub App install (AF-141, manual)**. | 2026-07-04 |
| 5 Webhooks/events | 🟡 PARTIAL | Deploy-status webhooks exist (UI-configured); `webhookCreate` mutation schema-present but doc-unsupported → poll `deployments.status` instead. | 2026-07-04 |
| 7 Provisioning | ⚠️ FORK | `projectCreate`/`serviceCreate`/`serviceConnect` scriptable, **but GitHub App install is a manual per-account gate (AF-141)** + `templateDeployV2` is doc-thin. | 2026-07-04 |
| 8 Isolation | ✅ VERIFIED | Private network **hard-isolated per project + per environment** (WireGuard); public networking opt-in; multi-tenant compute on GCP (not dedicated hosts). | 2026-07-04 |
| 9 Cost | ✅ VERIFIED | $20/vCPU-mo + $10/GB-mo + $0.05/GB egress, **pooled (no per-service floor)** ≈ $5–10/service/mo; Pro $20/seat; **post-paid card required**. | 2026-07-04 |
| 10 Failure modes | ✅ VERIFIED | Failed deploy keeps prior version serving; **healthcheck is the zero-downtime gate**; crash-loop terminal after 10 retries (no auto-page). | 2026-07-04 |
| 11 Versioning | ⚠️ RISK | **No GA/deprecation SLA** on the public GraphQL API; additive evolution; changelog is the only notice channel. | 2026-07-04 |
| AF-064 (canary/promote) | ✅ ACHIEVABLE | Branch-per-environment + "Wait for CI" + **Git-merge promotion — no native promote primitive (OD-173)**. | 2026-07-04 |
| Build-history rollback (FR-10.DEP.003) | ✅ SUPPORTED (stronger than assumed) | Instant image re-serve via `deploymentRollback`, **bounded by plan retention (Hobby 72h / Pro 120h)**; CLI can't do historical rollback. *(This is the Railway **mechanism**; AF-065 = the separate expand-contract **migration** premise, unaffected here.)* | 2026-07-04 |

**The one finding that most changes the spec:** **AF-141 — the Railway GitHub App install + repo
authorization is a manual, dashboard/OAuth-only step per GitHub account/org that has NO API or CLI
path.** ISSUE-007 / FR-10.PRV.001 / AF-004 describe a *scripted, idempotent* provisioning flow; the
repo-link step it depends on is **not fully automatable**. The script can automate everything after
the install, but must **pre-flight-verify repo access and fail loud if the GitHub App isn't
installed** (never a silent deploy-from-nothing — #3). This becomes an explicit consent-gated step in
the onboarding runbook (OD-174).

---

## 1. Identity & applicability
Railway is a PaaS that builds a linked GitHub repo and runs it as always-on services. Here it is the
**operator-owned compute** hosting one service per client silo. Object model:
`Workspace → Project → { Services } × { Environments }`; a service has a **service-instance per
environment**. No documented services-per-project cap (absence ≠ guarantee — AF-worthy at scale).
**Provisioning shape (fork, → OD/ADR-005):** one **project per client** (strongest isolation, matches
the Silo model) vs one shared project with a service/environment per client. Per-project is cleaner.

## 2. Auth & token lifecycle  *(→ #1: never lose access)*
- **Endpoint:** `https://backboard.railway.com/graphql/v2` (GraphQL; the `.app` host is legacy —
  any hardcoded `backboard.railway.app` is **STALE**). Live schema explorer: `railway.com/graphiql`.
- **Three static token tiers** (docs.railway.com/integrations/api, 2026-07-04):
  | Token | Scope | Header | Blast radius |
  |---|---|---|---|
  | **Account** | all resources, all workspaces | `Authorization: Bearer` | god-mode |
  | **Workspace** (formerly "Team") | one workspace | `Authorization: Bearer` | all client projects in the workspace |
  | **Project** | one environment of one project | `Project-Access-Token:` (distinct header) | one env — **cannot create projects/services** |
- **Provisioning must use a Workspace or Account token** — a project token is scoped to an *existing*
  environment and structurally can't `projectCreate`. Least-privilege = **Workspace token** (walled off
  from personal + other workspaces, shareable, survives one human's account). ⚠️ **AF-142.**
- **Lifetime:** static tokens have **no documented expiry/rotation** (asserted by absence). OAuth
  tokens (only if "Login with Railway" is ever used): access 1h, refresh 1yr **rotating** (persist the
  new one every refresh — the F5/GHL trap), 100-token cap. **Revocation:** delete on the tokens page /
  OAuth "Revoke Access". Treat rotation as a manual operator duty.
- **Token storage** (ADR-001): the provisioning Workspace token lives ONLY in the operator's secret
  store, never in the repo/build. Client Supabase service-role keys → set as Railway **sealed
  variables** where possible (see §5) so a leaked account token can't read them back via API.
- **Source:** docs.railway.com/integrations/api · /integrations/oauth/login-and-tokens (2026-07-04).

## 3. Rate limits & quotas  *(→ #3: never fail silently)*
- Public API: **Free 100 RPH · Hobby 1,000 RPH / 10 RPS · Pro 10,000 RPH / 50 RPS · Enterprise
  custom.** Headers `X-RateLimit-{Limit,Remaining,Reset}` + `Retry-After`; over-limit = HTTP 429.
- **Cloudflare edge (error 1015)** enforces the per-second ceiling and can **ban an IP below the
  documented RPH** during multi-step create/poll automation — and in that case the `X-RateLimit-*`
  headers are absent. **Exponential backoff + honour `Retry-After` is mandatory for fleet
  provisioning.** Build concurrency: **Hobby = 3** concurrent builds (Pro higher, unpublished).
- **What changed:** rate-limit numbers are documented but the 429/1015 semantics are community-sourced.
- **Source:** docs.railway.com/reference/public-api (2026-07-04) + Railway Help Station threads.

## 4. API surface & capabilities
All ops the `RailwayInfra` adapter needs are scriptable via GraphQL (mutation → source):
- Create project: **`projectCreate(input)`** · service: **`serviceCreate(input{projectId,name,source.repo,branch})`**.
- Link repo: **`serviceConnect(id,{repo,branch})`** (also triggers first deploy) — *gated by AF-141*.
- Root directory (`app/`): **`serviceInstanceUpdate(serviceId,environmentId,{rootDirectory})`** —
  **GraphQL-only, not in config-as-code, no CLI flag.**
- Env vars: **`variableUpsert`** / **`variableCollectionUpsert`** (bulk) / **`variableDelete`**.
- Deploy: **`serviceInstanceDeploy`** / `environmentTriggersDeploy` / `deploymentRedeploy`.
- Status: query **`deployments(input,first)` → edges.node{ id status }**, enum
  `QUEUED|WAITING|BUILDING|DEPLOYING|SUCCESS|FAILED|CRASHED|REMOVED|SLEEPING|SKIPPED`.
- Domain: **`serviceDomainCreate(input{serviceId,environmentId,targetPort})`**; read via `domains(...)`.
- Pagination: Relay-style cursor connections (`edges{node} pageInfo{hasNextPage endCursor}`).
- **Discovery discipline:** docs pages carry **no last-updated dates** → validate every mutation
  name + input field against the live `railway.com/graphiql` schema before marking FRs Ready.
- **Source:** docs.railway.com/integrations/api/manage-services · /manage-variables · /guides/manage-deployments · /guides/manage-domains (2026-07-04).

## 5. Webhooks / events / realtime
- Railway can push **deployment-status webhooks** (events: deployment status, volume/CPU/RAM alerts;
  payload e.g. `type:"Deployment.failed"` with resource IDs) — but the docs document **UI setup
  only**. A `webhookCreate` mutation exists in the introspectable schema but is **doc-unsupported** and
  has a reported "Not Authorized" quirk. **→ For AF-004, POLL `deployments.status` rather than
  register a webhook via API.** (docs.railway.com/observability/webhooks, 2026-07-04).

## 6. Data, sensitivity & ingestion
N/A as a data source — Railway ingests no client data into memory. Its sensitivity surface is
**secrets custody** (env vars, §5 sealed variables) and **build-log exposure** (undocumented whether
secrets can leak to build logs — AF candidate; don't echo env in build steps).

## 7. Provisioning & per-client setup  *(ADR-001 §5 / ADR-005 §5)*
- Scriptable: `projectCreate` → `serviceCreate` → `serviceConnect(repo)` → `serviceInstanceUpdate`
  (rootDirectory `/app`) → `variableCollectionUpsert` (skipDeploys) → deploy → poll status → `serviceDomainCreate`.
- **🔴 HARD GATE (AF-141):** the repo link only works once the **Railway GitHub App is installed on
  the GitHub account/org and granted repo access** — a **manual dashboard/GitHub-OAuth step with no
  API/CLI path**. The provisioner must verify access and **fail loud** if absent. → onboarding step (OD-174).
- **Monorepo (`app/`):** set **Root Directory = `/app`** per service (isolated-monorepo pattern).
  **Watch paths anchor at repo root `/`, NOT the root dir** → use **`/app/**`**. A committed
  `railway.json` must be referenced by **absolute path `/app/railway.json`** (Root Directory is NOT
  prepended). Same repo → many services is documented, **but** a 2025-11-28 moderator thread reports a
  rough edge on the standard multi-service-from-one-repo flow → SPIKE before relying on it.
- **`templateDeployV2`** (one-click per-client fan-out with `secret()`/`randomInt()` deploy-time vars)
  is a strong fit **but doc-thin** (confirmed only via Help Station; `V2` implies churn) → verify live.
- **Config-as-code** (`railway.json`/`.toml`, builder default **RAILPACK**): `build`/`deploy` fields
  incl. `startCommand`, `healthcheckPath/Timeout`, `restartPolicy*`, `watchPatterns`,
  `overlapSeconds`, `drainingSeconds`, `multiRegionConfig`; **per-env overrides** + a special `pr` key.
  **Code overrides the dashboard and is NOT written back** → make the repo the single source (drift = #3).
- **NEW (watch, don't build on yet):** IaC `.railway/railway.ts` (2026-06-05, **experimental**,
  TS-only, requires migrating services off `railway.json` first). Prefer stable `railway.json` + GraphQL.
- **Source:** docs.railway.com/deployments/github-autodeploys · /guides/monorepo · /guides/deploying-a-monorepo · /reference/config-as-code · /templates/* · /infrastructure-as-code (2026-07-04).

## 8. Isolation & security
- **Private networking is hard-isolated per project AND per environment** (WireGuard mesh; internal
  DNS `<svc>.railway.internal`; runtime-only). "Services in different projects/environments cannot
  communicate over the private network" (vendor-stated). → a project-per-client boundary is a genuine
  tenancy wall. **Public networking is opt-in** ("Generate Domain") — a service can be private-only.
- **Compute is multi-tenant on GCP** (container/network isolation, **not** dedicated hosts) — do NOT
  claim "physically isolated per client." Compliance: **SOC 2 Type 2, SOC 3, HIPAA, GDPR + DPF**,
  encryption at rest, audit logs, RTO 60 min (trust.railway.com).
- **RBAC is workspace-level only** (Admin / Member / Deployer) — any Member sees **all** client
  projects. **Per-project/per-environment human isolation requires Enterprise (Environment RBAC)** — a
  cost line, not a toggle. For machines, the project token is the scoping analogue (but can't create).
- **Source:** docs.railway.com/reference/private-networking · /guides/public-networking · /reference/teams · /enterprise/environment-rbac · trust.railway.com (2026-07-04).

## 9. Cost  *(→ ADR-003)*
- **Metered, pooled at the workspace level — no per-service base fee/floor.** Rates: **vCPU $0.000463/min
  = $20/vCPU-mo · RAM $0.000231/GB-min = $10/GB-mo · public egress $0.05/GB** (internal traffic free;
  volumes $0.15/GB-mo — N/A, Postgres is external Supabase).
- **Per always-on small Node service ≈ $5–10/mo** (0.25 vCPU + 0.5 GB). **Fleet scales ~linearly, no
  volume discount below Enterprise** (10 clients ≈ $100/mo, 50 ≈ $500/mo compute). RAM is the dominant
  lever → right-size each service. **Client-owned Supabase egress exits over public egress — budget it.**
- **Plans:** Free ($1/mo credit, reinstated 2025-08-27) · Hobby $5/mo (incl. $5 usage) · **Pro $20/seat/mo
  (incl. $20 usage/seat)** · Enterprise custom. **Post-paid card required** for paid usage.
- **Price-table entries to add (Phase 2 CFG / cost model):** `railway_vcpu_usd_per_min=0.000463`,
  `railway_ram_usd_per_gb_min=0.000231`, `railway_egress_usd_per_gb=0.05`, `railway_pro_seat_usd_mo=20`.
- **Source:** docs.railway.com/pricing/plans · railway.com/pricing · blog.railway.com/p/free-plan (2026-07-04).

## 10. Failure modes & limits  *(→ #3, ADR-004)*
- **A failed build/deploy keeps the previous version serving** (status → `Failed`); zero-downtime
  cutover with `overlapSeconds` (drain defaults to **0s** — raise `drainingSeconds` to avoid cutting
  in-flight requests). **Restart policy default `ON_FAILURE`, max 10 retries → terminal `Crashed`
  (no auto-page)** — needs external alerting. Healthcheck timeout default **300s**. Build timeout is
  **not published** (plan-dependent — SPIKE).
- **Healthcheck (`healthcheckPath`) is the zero-downtime gate:** Railway holds traffic on the old
  deploy until the new one returns 200; **with NO healthcheck, a broken-but-booting app goes live** →
  the boot stub MUST expose `/health` and only 200 when the required-secret/DB checks pass.
- **Source:** docs.railway.com/deployments/reference · /restart-policy · /guides/healthchecks (2026-07-04).

## 11. Versioning & staleness risk
- Single `/graphql/v2` endpoint; **no formal GA/beta label, no deprecation SLA, no breaking-change
  notice channel** beyond the changelog. Additive GraphQL evolution. Base rates stable ~2yr, but
  **plan structure + card policy churned** (free-plan removed 2023 → reinstated 2025-08-27). → tight
  **Re-verify by 2026-10-04**; watch railway.com/changelog. **Source:** docs.railway.com/reference/public-api (2026-07-04).

---

## Outputs filed (Rule 0 — write it down)

- **AF raised:**
  - **AF-141** — Railway GitHub App install + repo authorization is a **manual, dashboard/OAuth-only,
    per-GitHub-account gate** (no API/CLI). Provisioning (FR-10.PRV.001 / AF-004) can't be fully
    unattended; the script must pre-flight-verify + fail loud. **Verify: SPIKE.** *(Load-bearing.)*
  - **AF-142** — Automated provisioning requires a **Workspace/Account token** (project tokens can't
    `projectCreate`) → god-mode blast radius over every client project; confirm project-token-can't-create
    + least-privilege custody. **Verify: SPIKE.**
  - **AF-143** — `templateDeployV2` + several GraphQL mutation names/inputs are doc-thin/undated;
    validate against the live GraphiQL schema before speccing connector FRs. **Verify: SPIKE/DOCS.**
  - **AF-064 UPDATED** → **ACHIEVABLE**: branch-per-environment + "Wait for CI" + Git-merge promotion
    (no native promote); Railway **build-history rollback = `deploymentRollback`**, bounded by plan
    retention (Hobby 72h / Pro 120h), CLI can't do historical rollback (use API), past the window it
    silently degrades to a non-identical rebuild. SPIKE "Wait for CI" scope (waits on ALL check suites)
    + `canRollback`. **NOTE:** AF-064 is the Railway *mechanism*; **AF-065 (expand-contract migration
    safety — a Postgres SPIKE) is a DIFFERENT claim and is NOT resolved by this dossier** (unchanged 🔴).
- **OD raised:**
  - **OD-173** — Release-flow fork: promotion is a **Git merge/fast-forward, not a native Railway
    promote primitive** (reconcile ADR-005 §2). *Recommend:* branch-per-environment (`canary`←canary
    branch, `production`←main) + Wait-for-CI gate + merge-to-promote; the *gate* stands, the *mechanism*
    is Git (ADR-005 §2 already anticipated this).
  - **OD-174** — The **manual Railway GitHub App install** must be an explicit consent-gated onboarding
    step; `RailwayInfra` pre-flight-checks repo access and fails loud if absent. *Recommend:* add to
    `app/runbooks/client-onboarding.md` (client installs the Railway GitHub App on their repo access /
    operator installs on the operator GitHub org that owns the shared repo — confirm which in the SPIKE).
- **Glossary terms to add:** *Workspace token* · *Root Directory* · *Wait for CI* · *sealed variable*.
- **Config keys implied (Phase 2):** the four `railway_*` cost entries (§9); `railway.json` field set (§7).
- **Connector/infra FRs this unblocks:** `RailwayInfra` (the live `Infra` adapter, ISSUE-007 / AF-004);
  FR-10.DEP.002 (canary/promote), FR-10.DEP.003 (rollback) — all now cite THIS dossier for Railway facts.
- **RISK residuals tracked here (design around, not new IDs):** `variableUpsert`/`--set` **redeploys by
  default** → RailwayInfra must pass `skipDeploys:true` while seeding, deploy once at the end;
  `variableCollectionUpsert replace:true` is **destructive** → never use for incremental writes;
  **sealed variables are UI-only** (no seal-via-API) → ordinary encrypted-at-rest vars for automation,
  sealing is a manual step if required; per-project **human RBAC is Enterprise-only** (cost).

## Verification-gate result
DOCS gate **passed** — all 12 dimensions covered by dated primary sources (8-agent fan-out,
2026-07-04). **Load-bearing claims still owed a live SPIKE before AF-004 / the connector FRs go
Ready:** AF-141 (GitHub App gate + which account installs it), AF-142 (token tier can create),
AF-143 (mutation names vs live schema), AF-064 (Wait-for-CI scope), AF-065 (`deploymentRollback`
`canRollback`). These are exactly the AF-004 two-party session's checklist — the dossier turns "wire
up Railway blind" into "confirm five named facts against live infra."
