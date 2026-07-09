// ISSUE-089 — seeded demo rows for the surface-02 "Users & Access" render (dev-auth path). These stand in
// for app/user-mgmt's (021) real tables, read through the honest seam. Invents no logic — just rows to
// render. The RBAC roles/nodes/matrix are the REAL app/rbac catalog (see demo-rbac.ts), not seeded.

import type { Role } from './rbac-seam.ts';

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  mfa: 'enrolled' | 'not-enrolled' | 'via-idp';
  invite?: 'sent' | 'send-failed' | 'delivery-unconfirmed' | 'bounced' | 'expired';
  createdAt: string;
  lastActiveAt: string | null;
  activity: Array<{ at: string; summary: string; sensitive?: boolean }>;
}

export const DEMO_USERS_ROSTER: DemoUser[] = [
  {
    id: 'demo-super-admin', name: 'Ana Okafor', email: 'super.admin@demo.harness', role: 'Super Admin',
    active: true, mfa: 'enrolled', createdAt: '2026-01-04', lastActiveAt: '2026-07-09 09:42',
    activity: [
      { at: '2026-07-09 09:42', summary: 'Signed in (2FA verified)' },
      { at: '2026-07-08 16:10', summary: 'Granted Confidential clearance to Devon Ruiz', sensitive: true },
      { at: '2026-07-08 15:55', summary: 'Edited role permissions: Account Manager' },
    ],
  },
  {
    id: 'demo-admin', name: 'Ben Larsson', email: 'admin@demo.harness', role: 'Admin',
    active: true, mfa: 'enrolled', createdAt: '2026-01-06', lastActiveAt: '2026-07-09 08:31',
    activity: [
      { at: '2026-07-09 08:31', summary: 'Signed in (2FA verified)' },
      { at: '2026-07-07 11:02', summary: 'Invited user hr@demo.harness' },
    ],
  },
  {
    id: 'demo-finance', name: 'Cara Mendes', email: 'finance@demo.harness', role: 'Finance',
    active: true, mfa: 'via-idp', createdAt: '2026-02-11', lastActiveAt: '2026-07-08 17:20',
    activity: [{ at: '2026-07-08 17:20', summary: 'Viewed cost dashboard' }],
  },
  {
    id: 'demo-hr', name: 'Devon Ruiz', email: 'hr@demo.harness', role: 'HR',
    active: true, mfa: 'not-enrolled', invite: 'delivery-unconfirmed', createdAt: '2026-07-07', lastActiveAt: null,
    activity: [{ at: '2026-07-07 11:02', summary: 'Invited (delivery unconfirmed)' }],
  },
  {
    id: 'demo-account-manager', name: 'Priya Shah', email: 'account.manager@demo.harness', role: 'Account Manager',
    active: true, mfa: 'via-idp', createdAt: '2026-03-19', lastActiveAt: '2026-07-09 07:05',
    activity: [{ at: '2026-07-09 07:05', summary: 'Signed in via identity provider' }],
  },
  {
    id: 'demo-standard-user', name: 'Sam Cole', email: 'standard.user@demo.harness', role: 'Standard User',
    active: false, mfa: 'not-enrolled', createdAt: '2026-04-02', lastActiveAt: '2026-06-28 13:44',
    activity: [
      { at: '2026-06-28 13:44', summary: 'Deactivated by Ana Okafor (offboarding)' },
      { at: '2026-06-28 09:00', summary: 'Signed in' },
    ],
  },
];

export interface DemoClearance {
  id: string;
  subject: string; // user or role name
  subjectKind: 'user' | 'role';
  tier: 'Confidential' | 'Personal';
  entityScope: string | null; // null = Global
  lastReviewedAt: string;
  origin: 'default' | 'explicit';
}

export const DEMO_CLEARANCES: DemoClearance[] = [
  { id: 'clr-1', subject: 'Finance', subjectKind: 'role', tier: 'Confidential', entityScope: 'finance', lastReviewedAt: '2026-05-01', origin: 'default' },
  { id: 'clr-2', subject: 'HR', subjectKind: 'role', tier: 'Personal', entityScope: 'people', lastReviewedAt: '2026-06-20', origin: 'default' },
  { id: 'clr-3', subject: 'Devon Ruiz', subjectKind: 'user', tier: 'Confidential', entityScope: null, lastReviewedAt: '2026-02-10', origin: 'explicit' },
];

export interface DemoReview {
  id: string;
  subject: string;
  tier: 'Confidential' | 'Personal';
  lastReviewedAt: string;
  dueState: 'due' | 'overdue';
  daysOver: number;
}

export const DEMO_REVIEWS: DemoReview[] = [
  { id: 'rev-1', subject: 'Devon Ruiz (Confidential, global)', tier: 'Confidential', lastReviewedAt: '2026-02-10', dueState: 'overdue', daysOver: 59 },
  { id: 'rev-2', subject: 'Finance role (Confidential, finance)', tier: 'Confidential', lastReviewedAt: '2026-05-01', dueState: 'due', daysOver: 0 },
];

export interface DemoRestricted {
  id: string;
  grantee: string;
  granter: string;
  reason: string;
  scope: string | null;
  grantedAt: string;
  revokedAt: string | null;
}

export const DEMO_RESTRICTED: DemoRestricted[] = [
  { id: 'rst-1', grantee: 'Cara Mendes', granter: 'Ana Okafor', reason: 'Q2 board-pack financial close — time-boxed', scope: 'board-docs', grantedAt: '2026-06-01', revokedAt: null },
  { id: 'rst-2', grantee: 'Ben Larsson', granter: 'Ana Okafor', reason: 'Incident #4412 forensic review', scope: null, grantedAt: '2026-05-12', revokedAt: '2026-05-19' },
];

export interface DemoSupportRequest {
  id: string;
  email: string;
  name: string;
  issue: string;
  status: 'pending' | 'in-progress' | 'resolved';
  assignedTo: string | null;
  createdAt: string;
  overdue: boolean;
}

export const DEMO_SUPPORT_REQUESTS: DemoSupportRequest[] = [
  { id: 'sup-1', email: 'locked.out@client.example', name: 'Jordan Fry', issue: "Can't complete 2FA — lost my authenticator device.", status: 'pending', assignedTo: null, createdAt: '2026-07-08 22:14', overdue: true },
  { id: 'sup-2', email: 'new.hire@client.example', name: 'Robin Vale', issue: 'Invite link says expired.', status: 'pending', assignedTo: null, createdAt: '2026-07-09 08:50', overdue: false },
  { id: 'sup-3', email: 'manager@client.example', name: 'Lee Park', issue: 'OAuth says wrong tenant.', status: 'in-progress', assignedTo: 'Ben Larsson', createdAt: '2026-07-09 07:30', overdue: false },
  { id: 'sup-4', email: 'ops@client.example', name: 'Kai Roth', issue: 'Password reset not arriving.', status: 'resolved', assignedTo: 'Ana Okafor', createdAt: '2026-07-07 14:02', overdue: false },
];
