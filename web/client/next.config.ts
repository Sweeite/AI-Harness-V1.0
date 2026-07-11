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
  // TS-source packages Next must transpile (they are raw .ts, not pre-built). Each is a web/ WORKSPACE MEMBER that
  // web-client declares as a dependency, so it resolves by name and Railway's builder includes it (and the app/*
  // leaf modules it re-exports by relative import) in the deploy closure. @harness/agent-bridge (surface-09's
  // Builder guard) mirrors @harness/rbac-bridge exactly: it re-exports pg-free leaf modules from app/orchestrator,
  // app/specialists, app/execution-plans — those transpile via the bridge (turbopack.root = repo root puts app/*
  // in-tree). agent-bridge was NOT a workspace member before, so the production build couldn't resolve its app/*
  // .ts source → the surface-09 build broke on Railway since ISSUE-067 (worked locally where the full repo is present).
  transpilePackages: ['@harness/web-shared', '@harness/rbac-bridge', '@harness/agent-bridge'],
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
