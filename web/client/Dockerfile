# Walking-skeleton deploy (ISSUE-088/078/089) — web/client on the DEV-AUTH path.
#
# Dev-auth: NO Supabase env is set, so lib/auth.ts's isSupabaseConfigured() is false and the app serves
# the seeded role-switch sign-in (the "see it" path). Real OAuth is OD-175 onboarding — do NOT set the
# Supabase env here.
#
# Build context = the REPO ROOT (not web/). The rbac bridge re-exports app/rbac's pg-free leaf modules
# (store/can/catalog), which live OUTSIDE web/ (ADR-011 single repo), so the build needs both trees. Those
# leaf modules have no npm deps (pg is only in the adapter modules the bridge does not touch), so copying
# web/ + app/rbac/ is sufficient. On Railway: set this service's Root Directory = repo root and its config
# path = web/client/railway.json.
FROM node:22-slim

WORKDIR /repo
COPY web ./web
COPY app/rbac ./app/rbac

WORKDIR /repo/web
RUN npm install && npm run build --workspace @harness/web-client

WORKDIR /repo/web/client
ENV NODE_ENV=production
# start honors Railway's injected $PORT (package.json: next start --port ${PORT:-3100}).
CMD ["npm", "run", "start"]
