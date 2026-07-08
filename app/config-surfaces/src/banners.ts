// ISSUE-086 — the two ALWAYS-LOUD notification banners pinned above BOTH config surfaces (surface-01b
// §Layout, FR-7.ALR.001). These are the surface's contribution to "never fail silently" (#3): even a config
// admin who never opens the notification centre sees, pinned at the top of the config screens, that (a) the
// alert engine has stalled (AC-7.ALR.008.2) or (b) alert delivery is misconfigured / an alert has nowhere to
// go (AC-7.ALR.009.1). They are derived from a STATIC/on-demand read (bannerSignals), never a Realtime
// subscription (FR-7.RTP.001 — see a11y.ts NO_REALTIME_SUBSCRIPTION).

import type { BannerSignals } from './store.ts';

export interface Banner {
  id: 'alert-engine-stalled' | 'alert-delivery-misconfigured';
  severity: 'critical';
  /** A TEXT message (not colour-only) — carries the condition in words (AC-NFR-A11Y.001.2). */
  text: string;
  ac: string;
}

export const ALERT_ENGINE_STALLED: Banner = {
  id: 'alert-engine-stalled',
  severity: 'critical',
  text: 'CRITICAL: the alert engine has stalled — alerts may not be firing. Investigate immediately.',
  ac: 'AC-7.ALR.008.2',
};

export const ALERT_DELIVERY_MISCONFIGURED: Banner = {
  id: 'alert-delivery-misconfigured',
  severity: 'critical',
  text: 'CRITICAL: alert delivery is misconfigured — one or more alerts have no deliverable destination. Fix routing/contacts.',
  ac: 'AC-7.ALR.009.1',
};

/** The banners to pin on BOTH surfaces given the current signals. A true condition ALWAYS produces its
 *  banner — these are never suppressible (the always-on protective chrome). */
export function pinnedBanners(signals: BannerSignals): Banner[] {
  const out: Banner[] = [];
  if (signals.alertEngineStalled) out.push(ALERT_ENGINE_STALLED);
  if (signals.alertDeliveryMisconfigured) out.push(ALERT_DELIVERY_MISCONFIGURED);
  return out;
}
