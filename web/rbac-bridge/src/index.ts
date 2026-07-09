// @harness/rbac-bridge — the ONLY place the web tier reaches into the real @harness/rbac backend package.
// Re-exports rbac's pg-free leaf modules (the InMemory reference model + can() + the catalog), so the
// Next apps call the SAME permission logic the harness/RLS enforce (no second source of truth). The
// relative import up into app/rbac/ is permitted by next.config's experimental.externalDir (ADR-011:
// the product code is one repo; app/rbac/ lives alongside web/).
export { InMemoryRbacStore } from '../../../app/rbac/src/store.ts';
export { effectiveNodes, can, allowed } from '../../../app/rbac/src/can.ts';
export {
  defaultMatrix,
  ROLES,
  CATALOG_NODES,
  CATALOG,
  THIRTEEN_CATEGORIES,
  PROTECTED_ROLE,
  type Role,
  type CatalogNode,
} from '../../../app/rbac/src/catalog.ts';
