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
  transpilePackages: ['@harness/web-shared', '@harness/rbac-bridge'],
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
