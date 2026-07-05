// ISSUE-017 §8 step 6 — dual-accept webhook-secret rotation (FR-0.WHK.007 / AC-0.WHK.007.1). Runs
// from the provisioning runbook as service_role, NOT on the hot path. The dual-accept property is
// upheld structurally: during the window BOTH the old and new secret rows are `active`, and the
// verifiers read EVERY active version (store.readActiveSecrets), so either verifies. After the
// window the runbook retires the old version and only the new remains active — so only the new
// verifies. Every step writes a rotation `audit` row (the FR's Observability contract).
//
// Timeline:
//   rotateSecret()  → add new active version (both old+new now verify). audit: webhook_secret_rotated.
//   … dual-accept window (CFG-webhook.secret_rotation_window) …
//   retireOldVersions() → set every version below the newest inactive. audit: webhook_secret_retired.

import type { Connector, WebhookStore, WebhookSecretRow } from './store.js';
import type { SecretKind, WebhookConfig } from './config.js';

export interface RotationResult {
  newVersion: number;
  activeVersions: number[];
}

/** Begin a rotation: install the new secret as a new active version alongside the current one(s). */
export async function rotateSecret(
  store: WebhookStore,
  connector: Connector,
  kind: SecretKind,
  newValue: string,
  now: number,
): Promise<RotationResult> {
  const before = await store.readActiveSecrets(connector, kind);
  const row: WebhookSecretRow = await store.addSecretVersion(connector, kind, newValue, now);
  await store.writeAudit({
    action: 'webhook_secret_rotated',
    connector,
    secret_kind: kind,
    detail: `installed v${row.secret_version} (dual-accept begins; active now: ${[...before.map((s) => s.version), row.secret_version].join(',')})`,
  });
  const active = await store.readActiveSecrets(connector, kind);
  return { newVersion: row.secret_version, activeVersions: active.map((s) => s.version).sort((a, b) => a - b) };
}

/** End a rotation: retire every version older than the newest active one (call after the window). */
export async function retireOldVersions(
  store: WebhookStore,
  connector: Connector,
  kind: SecretKind,
  now: number,
): Promise<number[]> {
  const active = await store.readActiveSecrets(connector, kind);
  if (active.length <= 1) return active.map((s) => s.version); // nothing to retire
  const newest = Math.max(...active.map((s) => s.version));
  const retired: number[] = [];
  for (const s of active) {
    if (s.version < newest) {
      await store.retireSecretVersion(connector, kind, s.version, now);
      retired.push(s.version);
    }
  }
  await store.writeAudit({
    action: 'webhook_secret_retired',
    connector,
    secret_kind: kind,
    detail: `retired v${retired.join(',')} after rotation window; only v${newest} active`,
  });
  return retired;
}

/** Convenience for callers that want the configured window (informational; the runbook schedules it). */
export function rotationWindowSeconds(cfg: WebhookConfig): number {
  return cfg.secret_rotation_window;
}
