// ISSUE-078 — the panel/section CATALOG: the single source of truth both the RBAC gate (rbac.ts) and the
// non-drift `check` (index.ts) read. It encodes three obligations of the two dashboard surfaces:
//
//   • AC-7.VIEW.001.1 — every panel/section maps to a PRODUCING component's FR (C7 invents no signal). The
//     `producingFR` field is that mapping; `check` asserts none is empty.
//   • AC-7.VIEW.002.1 — each panel/section is individually role-scoped and node-gated (absent-not-empty). The
//     `requiresNode` + `roles` fields drive rbac.ts.
//   • AC-7.RTP.002.1 — each surface-05 panel names the config key + documented default for its poll cadence.
//
// PERM node ids are the AUTHORITATIVE C1 ids from PERMISSION_NODES.md (surface-05 OD-121/OD-167, surface-06
// OD-125, OD-129). NO node is invented here — `check` proves every id below exists in that catalog (a gate on
// a non-existent node is a build-time #3 defect, per the PERMISSION_NODES.md rule).

// ── PERM node ids (verbatim from PERMISSION_NODES.md) ───────────────────────────────────────────────
export const PERM = {
  // surface-05 entry + actions (intra-client)
  DASHBOARD_OPS: "PERM-dashboard.ops", // OD-129 — enter surface-05
  COMPLIANCE_DOWNLOAD: "PERM-compliance.download_records", // export event-log / guardrail-log trust evidence
  OPS_DLQ_MANAGE: "PERM-ops.dlq_manage", // OD-167 — DLQ requeue/discard
  OPS_CONNECTOR_RECONNECT: "PERM-ops.connector_reconnect", // OD-167 — connector re-auth
  // surface-06 entry + actions (management-plane scope, OD-125, Super Admin only / never delegable)
  FLEET_VIEW: "PERM-fleet.view",
  FLEET_PROVISION: "PERM-fleet.provision",
  FLEET_PROMOTE_RELEASE: "PERM-fleet.promote_release",
  FLEET_OFFBOARD: "PERM-fleet.offboard",
  FLEET_ROTATE_TOKEN: "PERM-fleet.rotate_token",
} as const;
export type PermNode = (typeof PERM)[keyof typeof PERM];

// ── the six canonical C1 roles (FR-1.ROLE.001) ──────────────────────────────────────────────────────
export const ROLES = [
  "super_admin",
  "admin",
  "finance",
  "hr",
  "account_manager",
  "standard_user",
] as const;
export type Role = (typeof ROLES)[number];

/** An action a panel/section renders — gated by its own node beyond entry (least-privilege). */
export interface CatalogAction {
  id: string;
  label: string;
  requiresNode: PermNode;
}

/** A surface-05 panel (nine) or a surface-06 section (A–H). */
export interface CatalogItem {
  id: string;
  title: string;
  /** The producing component's FR(s) this item RENDERS (AC-7.VIEW.001.1). Never empty. */
  producingFR: string[];
  /** Entry node the caller must hold for this item to render at all (default-deny, FR-1.PERM.002). */
  requiresNode: PermNode;
  /** Roles this item is scoped to (the OD-121 panel×role map / OD-125 operator-only). `absent`, not empty,
   *  to any role not listed (AC-7.VIEW.002.1). */
  roles: Role[];
  /** Actions gated beyond view. */
  actions: CatalogAction[];
  /** surface-05 only: the poll-cadence config key + documented default (AC-7.RTP.002.1). */
  cadence?: { configKey: string; defaultSeconds: number };
}

const OPS_ALL: Role[] = ["super_admin", "admin"]; // full single-deployment dashboard (surface-05 Access table)

// ── surface-05 — the nine Operations panels (FR-7.VIEW.001 enumerated set + the 8→9 connector split) ──
export const OPS_PANELS: readonly CatalogItem[] = [
  {
    id: "system-health",
    title: "System Health",
    producingFR: ["FR-5.LOP.005", "FR-5.QUE.001", "FR-5.QUE.005", "FR-3.DSC.005", "FR-8.HLTH.001"],
    requiresNode: PERM.DASHBOARD_OPS,
    roles: OPS_ALL,
    actions: [],
    cadence: { configKey: "polling_interval_health_metrics_s", defaultSeconds: 30 },
  },
  {
    id: "failure-health",
    title: "Failure Health",
    // the #3 panel — the silent-failure indicator is driven by the LOG.003 completeness gap (AC-7.VIEW.001.2)
    producingFR: ["FR-7.LOG.003", "FR-5.LOP.005", "FR-5.QUE.001"],
    requiresNode: PERM.DASHBOARD_OPS,
    roles: OPS_ALL,
    actions: [],
    cadence: { configKey: "polling_interval_health_metrics_s", defaultSeconds: 30 },
  },
  {
    id: "connector-health",
    title: "Connector Health",
    producingFR: ["FR-3.DSC.005", "FR-3.DSC.006", "FR-3.RL.001", "FR-3.TRIG.005"],
    requiresNode: PERM.DASHBOARD_OPS,
    roles: OPS_ALL,
    actions: [
      { id: "connector-reconnect", label: "Reconnect / re-auth", requiresNode: PERM.OPS_CONNECTOR_RECONNECT },
    ],
    cadence: { configKey: "polling_interval_health_metrics_s", defaultSeconds: 30 },
  },
  {
    id: "memory-health",
    title: "Memory Health",
    producingFR: ["FR-2.MNT.001"], // C2 memory-health signals, rendered read-only
    requiresNode: PERM.DASHBOARD_OPS,
    roles: OPS_ALL,
    actions: [],
    cadence: { configKey: "polling_interval_memory_health_s", defaultSeconds: 300 },
  },
  {
    id: "event-log",
    title: "Event Log",
    producingFR: ["FR-7.LOG.001", "FR-7.LOG.002", "FR-7.LOG.004"],
    requiresNode: PERM.DASHBOARD_OPS,
    roles: OPS_ALL,
    actions: [{ id: "export", label: "Export", requiresNode: PERM.COMPLIANCE_DOWNLOAD }],
    cadence: { configKey: "polling_interval_event_log_s", defaultSeconds: 60 },
  },
  {
    id: "dead-letter-queue",
    title: "Dead-Letter Queue",
    producingFR: ["FR-5.JOB.006"],
    requiresNode: PERM.DASHBOARD_OPS,
    roles: OPS_ALL,
    actions: [
      { id: "requeue", label: "Requeue", requiresNode: PERM.OPS_DLQ_MANAGE },
      { id: "discard", label: "Discard", requiresNode: PERM.OPS_DLQ_MANAGE },
    ],
    cadence: { configKey: "polling_interval_health_metrics_s", defaultSeconds: 30 },
  },
  {
    id: "cost",
    title: "Cost",
    producingFR: ["FR-7.COST.001", "FR-7.COST.002", "FR-7.COST.003"],
    requiresNode: PERM.DASHBOARD_OPS,
    // Finance enters scoped to the Cost panel only (surface-05 Access table / OD-121).
    roles: ["super_admin", "admin", "finance"],
    actions: [{ id: "export", label: "Export", requiresNode: PERM.COMPLIANCE_DOWNLOAD }],
    cadence: { configKey: "polling_interval_cost_tracking_s", defaultSeconds: 300 },
  },
  {
    id: "guardrail-log",
    title: "Guardrail Log",
    producingFR: ["FR-6.LOG.001", "FR-6.LOG.004", "FR-7.LOG.007"],
    requiresNode: PERM.DASHBOARD_OPS,
    roles: OPS_ALL,
    actions: [{ id: "export", label: "Export trust evidence", requiresNode: PERM.COMPLIANCE_DOWNLOAD }],
    cadence: { configKey: "polling_interval_health_metrics_s", defaultSeconds: 30 },
  },
  {
    id: "self-improvement",
    title: "Self-Improvement",
    // displays (does not generate) C9 suggestions + C8 health/drift + C7 flywheel (AC-7.VIEW.001.3)
    producingFR: ["FR-8.HLTH.001", "FR-8.HLTH.002", "FR-8.HLTH.003", "FR-7.OPT.001", "FR-6.OPT.001"],
    requiresNode: PERM.DASHBOARD_OPS,
    roles: OPS_ALL,
    actions: [],
    cadence: { configKey: "polling_interval_self_improvement_s", defaultSeconds: 600 },
  },
] as const;

const FLEET_ONLY: Role[] = ["super_admin"]; // the external operator — the ONLY actor (surface-06 Access table)

// ── surface-06 — the fleet grid (A) + management sections (B–H) ──────────────────────────────────────
export const FLEET_SECTIONS: readonly CatalogItem[] = [
  {
    id: "fleet-health-grid",
    title: "Fleet Health Grid",
    producingFR: ["FR-7.MGM.001", "FR-7.MGM.002", "FR-7.MGM.003"],
    requiresNode: PERM.FLEET_VIEW,
    roles: FLEET_ONLY,
    // click-through is NOT a management-plane node — it is the client's own RBAC (AC-7.MGM.003.2); modelled
    // in fleet.ts, deliberately absent from `actions`.
    actions: [],
  },
  {
    id: "cross-deployment-alerts",
    title: "Cross-Deployment Alerts",
    producingFR: ["FR-7.MGM.004", "FR-7.ALR.004", "FR-7.ALR.008", "FR-7.ALR.009"],
    requiresNode: PERM.FLEET_VIEW,
    roles: FLEET_ONLY,
    actions: [],
  },
  {
    id: "releases-cicd",
    title: "Releases & CI/CD",
    producingFR: ["FR-7.MGM.004", "FR-10.DEP.002", "FR-10.DEP.003", "FR-10.DEP.004"],
    requiresNode: PERM.FLEET_VIEW,
    roles: FLEET_ONLY,
    actions: [
      { id: "promote", label: "Promote release (canary → main)", requiresNode: PERM.FLEET_PROMOTE_RELEASE },
      { id: "rollback", label: "Roll back", requiresNode: PERM.FLEET_PROMOTE_RELEASE },
    ],
  },
  {
    id: "migrations",
    title: "Migrations",
    producingFR: ["FR-10.MIG.001", "FR-10.MIG.002"],
    requiresNode: PERM.FLEET_VIEW,
    roles: FLEET_ONLY,
    actions: [
      { id: "re-attempt", label: "Re-attempt (redeploy)", requiresNode: PERM.FLEET_PROMOTE_RELEASE },
    ],
  },
  {
    id: "provisioning-onboarding",
    title: "Provisioning & Onboarding",
    producingFR: ["FR-10.PRV.001", "FR-10.PRV.002", "FR-10.PRV.003", "FR-10.PRV.004"],
    requiresNode: PERM.FLEET_VIEW,
    roles: FLEET_ONLY,
    actions: [
      { id: "provision", label: "Provision new client", requiresNode: PERM.FLEET_PROVISION },
    ],
  },
  {
    id: "cross-deployment-cost",
    title: "Cross-Deployment Cost",
    producingFR: ["FR-7.MGM.005"],
    requiresNode: PERM.FLEET_VIEW,
    roles: FLEET_ONLY,
    actions: [],
  },
  {
    id: "backup-health",
    title: "Backup Health",
    producingFR: ["FR-7.MGM.005"],
    requiresNode: PERM.FLEET_VIEW,
    roles: FLEET_ONLY,
    actions: [],
  },
  {
    id: "client-registry-offboarding",
    title: "Client Registry & Offboarding",
    producingFR: ["FR-10.MGT.001", "FR-10.MGT.004", "FR-10.OFF.001", "FR-10.OFF.006"],
    requiresNode: PERM.FLEET_VIEW,
    roles: FLEET_ONLY,
    actions: [
      { id: "rotate-token", label: "Rotate internal token", requiresNode: PERM.FLEET_ROTATE_TOKEN },
      { id: "initiate-offboarding", label: "Initiate offboarding", requiresNode: PERM.FLEET_OFFBOARD },
      { id: "export-verify", label: "Trigger / verify export", requiresNode: PERM.FLEET_OFFBOARD },
      { id: "freeze", label: "Freeze", requiresNode: PERM.FLEET_OFFBOARD },
      // hard-delete additionally requires two-person auth (AC-10.DEL.006.2) — enforced in offboarding.ts.
      { id: "hard-delete", label: "Execute hard-delete + deprovision", requiresNode: PERM.FLEET_OFFBOARD },
      { id: "reactivate", label: "Reactivate (within retention)", requiresNode: PERM.FLEET_OFFBOARD },
    ],
  },
] as const;

/** Every PERM node id the catalog gates on — the set `check` proves exists in PERMISSION_NODES.md. */
export function referencedNodes(): Set<string> {
  const s = new Set<string>();
  for (const item of [...OPS_PANELS, ...FLEET_SECTIONS]) {
    s.add(item.requiresNode);
    for (const a of item.actions) s.add(a.requiresNode);
  }
  return s;
}
