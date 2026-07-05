// ISSUE-017 §8 step 4 — source identification (FR-0.WHK.005 / AC-0.WHK.005.2). A "source" is
// identified by **connector + endpoint token + source IP** — the triple the threshold alert and the
// auto-throttle key off. The endpoint token is the per-deployment obscurity token (FR-0.WHK.006);
// the IP is the edge-observed client IP. Missing pieces degrade to a stable placeholder so a
// spoofed/absent IP still buckets deterministically rather than escaping the counter.

import type { Connector } from './store.js';

export function sourceId(connector: Connector, endpointToken: string, sourceIp: string | undefined): string {
  return `${connector}:${endpointToken}:${sourceIp ?? 'unknown-ip'}`;
}
