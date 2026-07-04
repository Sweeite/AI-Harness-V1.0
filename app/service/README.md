# @harness/service — the deployable service (AF-004 Railway boot target)

The **minimal, correct boot skeleton** that Railway deploys per client. Its only job **today** is to
prove the provisioning plumbing end-to-end for the **AF-004** run: env + secrets injected, the
**client-owned Supabase reachable**, and a healthcheck Railway can gate on. The real product surface
(C0/C1 seed, agent harness, ingest endpoint) lands per its own issues — this is not that.

## Behaviour

- Binds Railway's injected **`PORT`** on `0.0.0.0`.
- **`/health`** — the **zero-downtime gate**. Returns **200 only when** every required secret is
  present **and** the client Supabase (`SUPABASE_URL`) answers; otherwise **503** with the exact
  missing keys / failure reason. A required-missing secret ⇒ 503 ⇒ Railway marks the deploy failed
  and never routes to it — **loud, never a silent half-configured silo** (#1/#2/#3).
- **`/`** — liveness text.

The required-secret manifest is **vendored** in `src/health.ts` (see the comment there): Railway's
isolated-monorepo **Root Directory = `/app/service`** scopes the deploy context to this directory, so
the runtime can't import from a sibling package. `src/health.test.ts` imports provisioning's canonical
`REQUIRED_SECRETS` and asserts the vendored copy matches — drift is caught locally, at test time.

## Run

```bash
npm install
npm test         # boot-gate tests (secret detection, DB-reachability, drift)
npm run typecheck
npm start        # serves on PORT (default 3000)
```

## Railway deploy settings (AF-004 two-party session — from `tool-integrations/railway.md`)

- **Root Directory:** `/app/service` (isolated-monorepo; deploys only this subtree).
- **Config file path:** set to the absolute **`/app/service/railway.json`** — Railway does **not**
  prepend the Root Directory to the config-file path (dossier §7 gotcha). That file already sets
  `healthcheckPath=/health`, `RAILPACK` builder, `watchPatterns` (`/app/service/**` — anchored at repo
  root, not the root dir).
- **Env:** the ~7 required secrets (+ per-connector) set by the provisioning script with
  `skipDeploys:true`, deployed once at the end (dossier §7 — never `replace:true`).
- Confirms **AF-141** (GitHub App install), **AF-142** (Workspace token), **AF-143** (mutation names),
  **AF-064** (healthcheck/Wait-for-CI) against live infra.
