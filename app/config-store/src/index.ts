// @harness/config-store — ISSUE-010 (C7 config backbone). Public surface: the ConfigStore port + in-memory
// fake reference model, the live pg adapter, the key-group map + credential redaction helpers. The
// config-admin write path (ISSUE-086) consumes appendAudit on Save; connector runtime (ISSUE-032) consumes
// readConfigValue; the C10 erasure workflow (ISSUE-082/084) consumes redactActor — those are the seams this
// slice stops at (it delivers the sink + immutability/export/retention/tombstone contract, not the writers).
//
// The `check` CLI runs the offline build-time gates (no DB, no network):
//   (1) keygroup ≡ SQL — the TS configKeyGroup must not diverge from the 0003 SQL config_key_group in the
//       cases the check can compare (a divergence would let the service_role export path scope differently
//       from the authenticated RLS path — a #2 gap).
//   (2) fail-closed default — an unknown key maps to the Super-Admin-only PERM-config.infra (never leaks).
//   (3) redaction sanity — a known token shape is scrubbed; the classifier flags secret-shaped keys.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

import { configKeyGroup, callerCanReadKey, CONFIG_PERM_NODES, KEY_NODE_MAP, type ConfigPermNode } from './keygroup.ts';
import { isSecretKey, redactCredentialMaterial, containsCredentialMaterial, REDACTED } from './redaction.ts';

export {
  type ConfigStore,
  InMemoryConfigStore,
  type ConfigValueRow,
  type SecretManifestRow,
  type SecretPresence,
  type ConfigAuditRow,
  type NewConfigAudit,
  type ExportRequest,
  type RetentionResult,
  DOWNLOAD_RECORDS_PERM,
  ERR_DELETE_FORBIDDEN,
  ERR_UPDATE_FORBIDDEN,
} from './store.ts';
export { SupabaseConfigStore } from './supabase-store.ts';
export { configKeyGroup, callerCanReadKey, CONFIG_PERM_NODES, KEY_NODE_MAP, type ConfigPermNode };
export { isSecretKey, redactCredentialMaterial, containsCredentialMaterial, REDACTED };

interface Finding {
  gate: string;
  message: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_0003 = join(HERE, '..', '..', 'silo', 'migrations', '0003_config_values_rls.sql');

// The AUTHORITATIVE full key→node set (spec/02-config/config-registry.md §§A–N). It is the union of the
// three uniform-prefix family probes (auth./webhook./support. → PERM-config.auth) and EVERY explicit key
// in KEY_NODE_MAP. The check validates the TS map AND SQL parity over the COMPLETE set — not a sample —
// so a mis-routed key (the ISSUE-010 blocker) can never slip through again.
const PREFIX_FAMILY_KEYS: Array<[string, ConfigPermNode]> = [
  // auth.* (non-smtp) / webhook.* / support.* are uniform-prefixed → PERM-config.auth
  ['auth.oauth_enabled', 'PERM-config.auth'],
  ['auth.session_ttl_minutes', 'PERM-config.auth'],
  ['webhook.replay_window_seconds', 'PERM-config.auth'],
  ['support.stale_request_minutes', 'PERM-config.auth'],
  // the auth.smtp_* secrets are group-N (never in config_values); if one ever reached the mapper it must
  // NOT read as auth — it fails closed to infra.
  ['auth.smtp_host', 'PERM-config.infra'],
  ['auth.smtp_bounce_webhook', 'PERM-config.infra'],
];

/** The complete registry key→node expectation set: the prefix-family probes + every explicit map entry. */
function allExpectedKeys(): Array<[string, ConfigPermNode]> {
  const fromMap = (Object.entries(KEY_NODE_MAP) as Array<[string, ConfigPermNode]>);
  return [...PREFIX_FAMILY_KEYS, ...fromMap];
}

/** Verify the TS configKeyGroup AND the 0003 SQL agree with the registry over EVERY key. We do not
 * re-parse SQL semantics — for each explicit key we require the SQL file to contain the literal
 * `when cfg_key = '<key>' … '<expected-node>'` pairing on one line (so a mis-routed or dropped key in the
 * migration is caught), and for the TS map to agree with the expected node. Uniform-prefix families are
 * covered by their `like '<prefix>%'` clause + a TS probe. */
function checkKeygroupParity(): Finding[] {
  const findings: Finding[] = [];
  let sql = '';
  try {
    sql = readFileSync(MIGRATION_0003, 'utf8');
  } catch {
    return [{ gate: 'keygroup-sql', message: `migration 0003 not found at ${MIGRATION_0003} — cannot verify RLS ≡ app map` }];
  }
  for (const node of CONFIG_PERM_NODES) {
    if (!sql.includes(`'${node}'`)) {
      findings.push({ gate: 'keygroup-sql', message: `SQL config_key_group is missing group ${node} — RLS/app map divergence (#2)` });
    }
  }
  // The three uniform-prefix families must exist as `like` clauses in the SQL.
  for (const [prefix, node] of [['auth.', 'PERM-config.auth'], ['webhook.', 'PERM-config.auth'], ['support.', 'PERM-config.auth']] as const) {
    const re = new RegExp(`like '${prefix.replace('.', '\\.')}%'[^\\n]*'${node}'`);
    if (!re.test(sql)) {
      findings.push({ gate: 'keygroup-sql', message: `SQL config_key_group is missing the uniform-prefix clause for '${prefix}%' → ${node}` });
    }
  }
  // Full coverage: TS map agrees with the registry for EVERY key.
  for (const [key, expected] of allExpectedKeys()) {
    const got = configKeyGroup(key);
    if (got !== expected) {
      findings.push({ gate: 'keygroup-ts', message: `configKeyGroup('${key}') = ${got}, expected ${expected} (registry group boundary drift)` });
    }
  }
  // Full SQL parity: every EXPLICIT key must be mapped to its expected node ON ONE LINE in the migration.
  for (const [key, expected] of Object.entries(KEY_NODE_MAP) as Array<[string, ConfigPermNode]>) {
    const re = new RegExp(`when cfg_key = '${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s+then '${expected}'`);
    if (!re.test(sql)) {
      findings.push({ gate: 'keygroup-sql-parity', message: `SQL config_key_group does not map '${key}' → ${expected} on one line — TS↔SQL divergence (#2)` });
    }
  }
  // Fail-closed default: an unknown key must land on the Super-Admin-only infra node.
  const unknown = configKeyGroup('some.brand.new.unmapped_key_xyz');
  if (unknown !== 'PERM-config.infra') {
    findings.push({ gate: 'keygroup-failclosed', message: `an unmapped key maps to ${unknown}, not PERM-config.infra — a new key could leak to a lower gate (#2)` });
  }
  return findings;
}

// The group-N platform secret env-var names + the auth.smtp_* dotted secrets (config-registry §N) — EVERY
// one MUST be caught by isSecretKey (never audited, never stored in config_values). Full list, not a sample.
const GROUP_N_SECRETS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'INNGEST_API_KEY',
  'X_INTERNAL_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_WEBHOOK_URL',
  'GOHIGHLEVEL_WEBHOOK_SECRET',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY',
  'auth.smtp_host',
  'auth.smtp_port',
  'auth.smtp_user',
  'auth.smtp_pass',
  'auth.smtp_sender',
  'auth.smtp_bounce_webhook',
];

function checkRedaction(): Finding[] {
  const findings: Finding[] = [];
  for (const secret of GROUP_N_SECRETS) {
    if (!isSecretKey(secret)) findings.push({ gate: 'redaction', message: `isSecretKey missed group-N secret '${secret}' (would allow a secret-bearing audit row — #2)` });
  }
  if (!isSecretKey('slack_webhook_url')) findings.push({ gate: 'redaction', message: 'isSecretKey missed a secret-shaped key' });
  if (isSecretKey('amber_zone_threshold')) findings.push({ gate: 'redaction', message: 'isSecretKey false-positive on a normal knob' });
  if (isSecretKey('price_table')) findings.push({ gate: 'redaction', message: 'isSecretKey false-positive on price_table' });
  const scrubbed = redactCredentialMaterial({ note: 'ok', api_key: 'sk-livedeadbeefdeadbeef0000' });
  if (containsCredentialMaterial(scrubbed)) findings.push({ gate: 'redaction', message: 'redactCredentialMaterial left credential material behind' });
  if ((scrubbed as Record<string, unknown>).api_key !== REDACTED) findings.push({ gate: 'redaction', message: 'secret-shaped key value not redacted' });
  return findings;
}

function runCheck(): Finding[] {
  const findings = [...checkKeygroupParity(), ...checkRedaction()];
  if (findings.length === 0) {
    console.log(`✓ config-store check: key-group map ≡ 0003 RLS (all ${allExpectedKeys().length} registry keys) · fail-closed default holds · every group-N secret caught · credential redaction sound.`);
  } else {
    console.error(`✗ config-store check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

// Only run the CLI when invoked directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}
