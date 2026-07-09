'use client';

// ISSUE-078 — the surface-05 persistent chrome: an honest "auto-refresh on (polling)" indicator that never
// claims Realtime (surface-05 is the polling surface), plus a manual "Refresh all" (the FR-7.RTP.002
// on-demand path). Refresh re-runs the server reads so every panel's freshness advances together.

import * as React from 'react';
import { useRouter } from 'next/navigation';

export function OpsControls(): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="ah-row">
      <span className="ah-badge ah-tone-ok" title="This surface polls; it is never Realtime.">
        <span aria-hidden="true">●</span><span>Auto-refresh on (polling)</span>
      </span>
      <button
        type="button"
        className="ah-btn ah-btn-sm"
        onClick={() => { setBusy(true); router.refresh(); setTimeout(() => setBusy(false), 600); }}
      >
        {busy ? <><span className="ah-spinner" aria-hidden="true" /> Refreshing…</> : 'Refresh all'}
      </button>
    </div>
  );
}
