'use client';

// ISSUE-088 — surface-00 UI-REAUTH-PROMPT. A modal rendered OVER the current authenticated page (page
// state is preserved, the page dims behind it), becoming a full-width bottom sheet on <768px. It appears
// on session expiry/revoke; a running background task continues as service_role and is noted. Triggered
// here by ?reauth=1 so the operator can see it render over any surface without losing the page underneath.

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Modal } from '@harness/web-shared';

export function ReauthPrompt(): React.JSX.Element | null {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isNarrow, setIsNarrow] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const on = () => setIsNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  if (params.get('reauth') !== '1') return null;

  const dismiss = () => router.replace(pathname);

  return (
    <Modal title="Session expired, please sign in again" onClose={dismiss} sheet={isNarrow}>
      <p className="ah-page-lead">
        Your session ended for security. Your place on this page has been kept — sign in again to continue where you left off.
      </p>
      <div className="ah-banner ah-tone-info" style={{ marginBottom: 'var(--space-3)' }}>
        <span aria-hidden="true">◆</span><span>Your earlier action is still being processed and will finish.</span>
      </div>
      <div className="ah-modal-actions">
        <a className="ah-btn ah-btn-accent" href="/login">Sign in again</a>
      </div>
    </Modal>
  );
}
