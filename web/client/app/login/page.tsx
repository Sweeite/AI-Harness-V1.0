// ISSUE-088 — surface-00 UI-LOGIN mounted on the 087 auth boundary. The anonymous→authenticated split is
// still enforced by middleware; this renders the full login trust-boundary screen (OAuth primary, operator
// disclosure, fail-closed CAPTCHA, "Trouble signing in?" support intake, 2FA challenge step). On the
// dev-auth path the OAuth/operator/role paths sign in through the seeded-dev session (real OAuth = OD-175).

import { LoginScreen } from './LoginScreen.tsx';
import { submitSupportRequest } from './actions.ts';
import { signInAs } from '../actions.ts';
import { ALL_ROLES } from '../../lib/rbac-seam.ts';
import { isSupabaseConfigured } from '../../lib/supabase-server.ts';

export default function LoginPage(): React.JSX.Element {
  return (
    <LoginScreen
      live={isSupabaseConfigured()}
      roles={ALL_ROLES}
      signInAs={signInAs}
      submitSupport={submitSupportRequest}
    />
  );
}
