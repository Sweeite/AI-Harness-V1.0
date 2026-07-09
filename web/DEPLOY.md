# Deploying the frontend to Railway — the DEV-AUTH path (walking skeleton)

This deploys the two Next.js apps built for the walking skeleton (ISSUE-088/078/089) to Railway on the
**dev-auth** path: no Supabase env, so the apps serve the seeded role-switch sign-in (the "see it" demo).
Real OAuth is **OD-175** onboarding — deliberately not wired here. Composes with ISSUE-080/081 (the existing
headless `app/service` health stub stays as-is; this ADDS two frontend services).

## What's already proven (offline, Session 81)
- `web/client` + `web/admin` both `next build` clean (all routes compile).
- Each **Docker image builds and serves** on Railway's injected `$PORT` (verified: `/login` → 200, `/` → 307
  auth-gate). The build context is the **repo root** — the rbac bridge re-exports `app/rbac`'s pg-free leaf
  modules (which live outside `web/`, ADR-011), so the Dockerfiles copy `web/` + `app/rbac/` only (those leaf
  modules have no npm deps).

## Deploy artifacts (in this commit)
- `web/client/Dockerfile`, `web/admin/Dockerfile` — build context = repo root; `npm install` + build the
  workspace + `next start` on `$PORT`.
- `web/client/railway.json`, `web/admin/railway.json` — `DOCKERFILE` builder, `dockerfilePath`, healthcheck
  `/login`, watch `web/**` + `app/rbac/**`.
- `.dockerignore` (repo root) — keeps the build context lean (does not affect `app/service`, which uses Railpack).
- `package.json` `start` scripts honor `$PORT` (`next start --port ${PORT:-31xx}`).

## Live steps (require the operator's Railway account — CONFIRM before running)
For **each** app (`web/client`, then `web/admin`):
1. In the Railway project, **New Service → Deploy from GitHub repo** → this repo, branch `main` (after the
   `frontend-walking-skeleton` branch is merged/pushed).
2. Service **Settings**:
   - **Root Directory** = `/` (the repo root — NOT `web/client`; the build needs `app/rbac` in context).
   - **Config-as-code path** = `web/client/railway.json` (or `web/admin/railway.json`).
   - Builder resolves to **Dockerfile** from that config.
3. **Variables**: set **none** for the dev-auth path. Do NOT set `NEXT_PUBLIC_SUPABASE_URL` /
   `SUPABASE_*` — their absence is what selects the seeded dev-auth session (`lib/auth.ts`
   `isSupabaseConfigured()` → false). Railway injects `PORT` automatically.
4. **Generate Domain** (Settings → Networking) to get the public URL.
5. Deploy. Healthcheck `/login` should return 200.

CLI alternative (from the repo root, `railway` is installed): `railway link` → the project, then
`railway up` per service — but GitHub-connected auto-deploy (step 1) matches the existing `app/service`
pattern and the ISSUE-080 canary train, so it's preferred.

## Verify after deploy (dev-auth acceptance)
- `/<domain>/login` → 200, shows the seeded role picker ("Dev session — seeded, no live DB").
- Sign in as **Super Admin** → 13 nav entries; as **Standard User** → 1 (`/workspace`) — RBAC absent-not-empty.
- `web/client`: `/ops` shows the 9 honest-state panels; `/ops?sim=error` shows "couldn't load" not fabricated
  values; `/users` shows the 6-tab cockpit; `/support-requests` is 404 for a role without `PERM-support.view`.
- `web/admin`: `/fleet` shows the fleet grid (frozen ≠ dead, unreachable shown, never green-on-failure).
- Toggle the theme → light+dark both render.

## Residuals (carry forward — do not claim otherwise)
- **Real OAuth = OD-175** onboarding (the dev-auth seeded sign-in is the demo path).
- **OD-198 ③** — surface-05/06 live reads are false-healthy-0 on real authenticated data until producer-RLS
  lands; this deploy is dev-auth/seeded, so honest-state is correct, but 078 is **not** live-verified on real data.
- The `app/service` health-stub service is unchanged; this adds two independent frontend services.
