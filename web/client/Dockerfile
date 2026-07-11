# Walking-skeleton deploy (ISSUE-088/078/089) — web/client on the DEV-AUTH path.
#
# Dev-auth: NO Supabase env is set, so lib/auth.ts's isSupabaseConfigured() is false and the app serves
# the seeded role-switch sign-in (the "see it" path). Real OAuth is OD-175 onboarding — do NOT set the
# Supabase env here.
#
# Build context = the REPO ROOT (not web/). The web bridges re-export pg-free LEAF modules that live OUTSIDE
# web/ (ADR-011 single repo), so the build must copy every app/* tree a bridge reaches into:
#   • @harness/rbac-bridge   → app/rbac        (store/can/catalog)
#   • @harness/agent-bridge  → app/orchestrator (registry.ts), app/specialists (store.ts/specialists.ts),
#                              app/execution-plans (taxonomy.ts)   [ISSUE-067, surface-09]
# These leaf files are pg-free and have no npm deps (pg lives only in the adapter/supabase-store modules the
# bridges never touch), so copying web/ + these four app/* dirs is sufficient. If a new web bridge reaches
# into another app/* package, add its COPY here too — a missing dir surfaces as a next-build "Module not
# found", NOT a builder quirk. On Railway: Root Directory = repo root, config path = web/client/railway.json.
FROM node:22-slim

WORKDIR /repo
COPY web ./web
COPY app/rbac ./app/rbac
COPY app/orchestrator ./app/orchestrator
COPY app/specialists ./app/specialists
COPY app/execution-plans ./app/execution-plans

WORKDIR /repo/web
RUN npm install && npm run build --workspace @harness/web-client

WORKDIR /repo/web/client
ENV NODE_ENV=production
# start honors Railway's injected $PORT (package.json: next start --port ${PORT:-3100}).
CMD ["npm", "run", "start"]
