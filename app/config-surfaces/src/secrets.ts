// ISSUE-086 — the #secrets section: a READ-ONLY presence + last_rotated view of the 11 platform secrets
// (surface-01 §#secrets, config-registry.md §N, config-edit-taxonomy SECRET class + rule 2). The section has
// NO Save control and NO value column — by construction a secret value never reaches config_values or
// config_audit_log (AC-7.LOG.008.5 / AC-7.LOG.005.1). Rotation is env/Railway only; the manifest is populated
// by the deploy hook (OD-102).

import type { SecretPresence } from './store.ts';

export interface SecretManifestEntry {
  key: string;
  /** required at boot? A required-missing secret blocks boot (rendered "MISSING — boot blocked"). */
  required: boolean;
}

// The 11 platform secrets (surface-01 §#secrets / registry §N). `required` reflects the registry's Required
// column (conditional-on-connector ones are marked required:false — their absence is not boot-blocking).
export const SECRET_MANIFEST: readonly SecretManifestEntry[] = [
  { key: 'ANTHROPIC_API_KEY', required: true },
  { key: 'OPENAI_API_KEY', required: true },
  { key: 'INNGEST_API_KEY', required: true },
  { key: 'X_INTERNAL_TOKEN', required: true },
  { key: 'SLACK_SIGNING_SECRET', required: false },
  { key: 'SLACK_WEBHOOK_URL', required: false },
  { key: 'GOHIGHLEVEL_WEBHOOK_SECRET', required: false },
  { key: 'GOOGLE_OAUTH_CLIENT_SECRET', required: false },
  { key: 'GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY', required: false },
  { key: 'auth.smtp_bundle', required: false },
  { key: 'auth.smtp_bounce_webhook', required: false },
];

export const SECRET_MANIFEST_KEYS: readonly string[] = SECRET_MANIFEST.map((e) => e.key);

export interface SecretRowRender {
  key: string;
  /** presence text — never a value. */
  presenceLabel: string;
  lastRotatedLabel: string;
  /** #secrets is read-only — there is never a save/rotate control (config-edit-taxonomy rule 2). */
  editable: false;
}

/** Render one #secrets row from a presence record (or null when the manifest entry didn't load). */
export function renderSecretRow(entry: SecretManifestEntry, presence: SecretPresence | null): SecretRowRender {
  let presenceLabel: string;
  if (presence === null) {
    // A required secret we cannot confirm reads "Status unknown — verify in Railway" (never a false "present").
    presenceLabel = entry.required ? 'Status unknown — verify in Railway' : '— (status unknown)';
  } else if (presence.present) {
    presenceLabel = 'Present';
  } else {
    presenceLabel = entry.required ? 'MISSING — boot blocked' : 'Not configured';
  }
  const lastRotatedLabel = presence?.last_rotated ?? 'Unknown';
  return { key: entry.key, presenceLabel, lastRotatedLabel, editable: false };
}
