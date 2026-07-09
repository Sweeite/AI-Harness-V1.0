// ISSUE-078 — seeded signals for the surface-06 Super-Admin fleet console (the SOLE cross-deployment
// surface, ADR-001 §7). Rendered from the PUSH-FED management store only — NEVER a client pull (FR-7.MGM.003).
// Here `client_slug` IS valid (management plane). The grid is frozen-≠-dead and stale/unreachable-honest:
// a card the mgmt plane hasn't heard from renders "stale/unreachable", never a false-healthy green (#2/#3).

export interface DeploymentCard {
  slug: string;
  name: string;
  health: 'healthy' | 'degraded' | 'stale' | 'frozen' | 'unreachable';
  asOf: string;
  coreVersion: string;
  note?: string;
}

export const FLEET_GRID: DeploymentCard[] = [
  { slug: 'acme', name: 'Acme Media', health: 'healthy', asOf: '09:41', coreVersion: 'v1.8.2' },
  { slug: 'northwind', name: 'Northwind Agency', health: 'degraded', asOf: '09:40', coreVersion: 'v1.8.2', note: '1 connector degraded' },
  { slug: 'globex', name: 'Globex Partners', health: 'stale', asOf: '08:12', coreVersion: 'v1.8.1', note: 'no snapshot in 89m — treat as unconfirmed, not healthy' },
  { slug: 'initech', name: 'Initech (offboarding)', health: 'frozen', asOf: '09:38', coreVersion: 'v1.8.2', note: 'frozen for offboarding — frozen ≠ dead; export verified, awaiting two-person delete' },
  { slug: 'umbrella', name: 'Umbrella Co', health: 'unreachable', asOf: '—', coreVersion: '—', note: 'management plane cannot reach this deployment — shown unreachable, never green' },
];

export interface FleetSection {
  id: string;
  title: string;
  node: string; // real Management-Plane catalog node — absent ⇒ section ABSENT, not empty
  rows: Array<{ text: string; meta?: string; tone?: 'ok' | 'stale' | 'error' | 'unknown' }>;
  note?: string;
}

export const FLEET_SECTIONS: FleetSection[] = [
  {
    id: 'alerts', title: 'Cross-Deployment Alerts', node: 'PERM-fleet.view',
    rows: [
      { text: 'Northwind — connector degraded (GHL)', meta: '09:40', tone: 'stale' },
      { text: 'Globex — snapshot stale 89m', meta: '08:12', tone: 'error' },
    ],
  },
  {
    id: 'releases', title: 'Releases & CI/CD', node: 'PERM-fleet.promote_release',
    rows: [
      { text: 'core v1.8.2 — promoted to main', meta: 'last push green · 4 deployments', tone: 'ok' },
      { text: 'Globex still on v1.8.1', meta: 'promotion pending', tone: 'stale' },
    ],
  },
  {
    id: 'migrations', title: 'Migrations', node: 'PERM-fleet.view',
    rows: [
      { text: 'silo head 0037 · mgmt head 0004', meta: 'all deployments in lockstep', tone: 'ok' },
    ],
  },
  {
    id: 'provisioning', title: 'Provisioning & Onboarding', node: 'PERM-fleet.provision',
    rows: [
      { text: 'Wayne Enterprises — provisioning', meta: 'step 3/6 · schema applied', tone: 'stale' },
    ],
  },
  {
    id: 'cost', title: 'Cross-Deployment Cost', node: 'PERM-fleet.view',
    rows: [
      { text: 'Fleet spend today: $61.20 est.', meta: 'estimate (ADR-003) · trend ↗', tone: 'ok' },
    ],
    note: 'Every figure is an estimate — never an invoice.',
  },
  {
    id: 'backup', title: 'Backup Health', node: 'PERM-fleet.view',
    rows: [
      { text: 'Acme — last backup 02:00, restore-tested', meta: 'from Management-API', tone: 'ok' },
      { text: 'Umbrella — backup health unknown', meta: 'unreachable — not reported healthy', tone: 'error' },
    ],
  },
  {
    id: 'registry', title: 'Client Registry & Offboarding', node: 'PERM-fleet.offboard',
    rows: [
      { text: 'Initech — freeze confirmed, export verified', meta: 'awaiting two-person hard-delete', tone: 'stale' },
    ],
    note: 'Hard-delete requires a DISTINCT second approver (AC-10.DEL.006.2) — no self-second.',
  },
];
