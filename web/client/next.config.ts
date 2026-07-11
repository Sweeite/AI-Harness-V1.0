import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ISSUE-087 — the client-deployment app config.
// - transpilePackages: the shared design system + the rbac bridge are TS-source (not pre-built) — Next
//   transpiles them.
// - turbopack.root: this is a single repo (ADR-011) where the web/ apps sit ALONGSIDE the app/* backend
//   packages. The rbac bridge re-exports app/rbac/ leaf modules (the ONE source of truth for permissions),
//   so Turbopack's module-resolution root must be the REPO root, not web/ — otherwise it refuses to
//   resolve anything above web/. Pointing root at the repo puts app/rbac in-tree.
const here = dirname(fileURLToPath(import.meta.url)); // web/client
const repoRoot = resolve(here, '..', '..'); // → repo root

const nextConfig: NextConfig = {
  // Every TS-source package the app pulls in must be transpiled by Next (they are raw .ts, not pre-built), and
  // — like @harness/rbac-bridge re-exporting app/rbac — the agent Builder's @harness/agent-bridge re-exports leaf
  // modules from app/orchestrator, app/specialists, and app/execution-plans by relative import. Those leaf app/*
  // packages must be transpiled too or a production `next build` (Turbopack) can't resolve their .ts source
  // (agent-bridge was omitted → the surface-09 build broke since ISSUE-067). turbopack.root = repo root puts
  // app/* in-tree so the relative imports resolve.
  transpilePackages: [
    '@harness/web-shared',
    '@harness/rbac-bridge',
    '@harness/agent-bridge',
    '@harness/orchestrator',
    '@harness/specialists',
    '@harness/execution-plans',
  ],
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
