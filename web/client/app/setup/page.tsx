// ISSUE-088 — surface-00 UI-INVITE-SETUP route (/setup?token=…). Public (pre-auth): the token is the gate.
// Validates the token server-side (valid | expired | invalid) and derives the account's single setup
// method. On the dev-auth path "activate" establishes the seeded session (real invite/OAuth = OD-175).

import { SetupScreen } from './SetupScreen.tsx';
import { signInAs } from '../actions.ts';
import type { Role } from '../../lib/rbac-seam.ts';

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; type?: string; role?: string }>;
}): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const token: 'valid' | 'expired' | 'invalid' = sp.token === 'valid' ? 'valid' : sp.token === 'expired' ? 'expired' : 'invalid';
  const accountType = sp.type === 'operator' ? 'operator' : 'client';
  const role = (sp.role as Role) ?? (accountType === 'operator' ? 'Super Admin' : 'Standard User');
  return <SetupScreen token={token} accountType={accountType} role={role} activate={signInAs.bind(null, role, true)} />;
}
