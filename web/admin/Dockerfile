# Walking-skeleton deploy (ISSUE-078 fleet) — web/admin (super-admin management plane) on the DEV-AUTH path.
# Same contract as web/client's Dockerfile: build context = REPO ROOT; copies web/ + app/rbac/; no Supabase
# env (seeded role-switch). On Railway: Root Directory = repo root, config path = web/admin/railway.json.
FROM node:22-slim

WORKDIR /repo
COPY web ./web
COPY app/rbac ./app/rbac

WORKDIR /repo/web
RUN npm install && npm run build --workspace @harness/web-admin

WORKDIR /repo/web/admin
ENV NODE_ENV=production
# start honors Railway's injected $PORT (package.json: next start --port ${PORT:-3200}).
CMD ["npm", "run", "start"]
