// ISSUE-006 §8 (CFG + mode selection) — the CFG-webhook.* values the verifiers read, plus the
// M-vs-R mode gate. Everything operator/vendor-provided is read from `.env` (see .env.example),
// never hard-coded (CRITICAL RULE 2). Zero runtime deps: a tiny hand-rolled .env parser keeps this
// spike in the issue-003 zero-runtime-deps house style.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const spikeRoot = join(here, '..');

// ---------------------------------------------------------------------------
// Minimal .env loader (zero-dep). Reads spikeRoot/.env if present and layers it UNDER the real
// process.env (so an explicitly-exported var still wins). Absent file ⇒ MODE M.
// ---------------------------------------------------------------------------
function loadDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(join(spikeRoot, '.env'), 'utf8');
  } catch {
    return out; // no .env → MODE M
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = loadDotEnv();
function env(key: string): string | undefined {
  const v = process.env[key] ?? fileEnv[key];
  return v && v.length > 0 ? v : undefined;
}

// ---------------------------------------------------------------------------
// CFG-webhook.* — the config the verifiers consult (Context manifest §6, CFG stub table §5).
// Contestable/per-deployment values are marked; none of them is a vendor secret (those live in the
// webhook_secrets sink, seeded from env in MODE R).
// ---------------------------------------------------------------------------
export const CFG = {
  // Slack: reject a webhook whose timestamp is older than this BEFORE the signature check.
  replay_window_seconds: 300, // AC-0.WHK.004.1 (Slack 5-min window)
  // GHL/Google: how long a seen event ID stays in the replay cache (drop dupes within it).
  replay_cache_window: 300, // AC-0.WHK.008.1
  // Google Pub/Sub push JWT `aud`. Per-deployment (CFG stub default is unset `—`). For this
  // throwaway harness we CHOOSE a fixed spike-local test value (§8.0) and mint the valid-case JWT
  // with it; wrong-aud → 401. In MODE R this is overridden by GOOGLE_EXPECTED_AUDIENCE.
  google_expected_audience: env('GOOGLE_EXPECTED_AUDIENCE') ?? 'https://spike-local.invalid/pubsub-push',
  // Per source per hour. Past this → alert (AC-NFR-SEC.008.1). Full wiring is ISSUE-017.
  failure_alert_threshold: 3,
} as const;

// Google certs endpoint (FR-0.WHK.003). MODE R fetches real Google certs; MODE M uses a local JWKS.
export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

// The date after which a GHL request carrying ONLY the legacy `X-WH-Signature` header (no
// `X-GHL-Signature`) is rejected outright (OD-046 HMAC→Ed25519 correction). AC-0.WHK.002.2.
export const GHL_LEGACY_HEADER_CUTOFF = '2026-07-01T00:00:00.000Z';

// ---------------------------------------------------------------------------
// Mode selection. MODE R requires the GHL real facts (the only path NOT self-signable). Slack and
// Google are self-signable in MODE M and only OPTIONALLY use real infra.
// ---------------------------------------------------------------------------
export interface OperatorInputs {
  ghlPayloadFile?: string; // live captured GHL request (JSON: rawBody + headers)
  ghlPublicKey?: string; // GHL published Ed25519 public key (PEM SPKI)
  ghlPublicKeyUrl?: string; // primary-source URL the key came from
  slackSigningSecret?: string; // real Slack signing secret (optional)
  googlePushJwt?: string; // real Google Pub/Sub push JWT (optional)
  googleExpectedAudience?: string; // audience the real JWT was minted for (optional)
}

export function readOperatorInputs(): OperatorInputs {
  const ghlPayloadFileRaw = env('GHL_WEBHOOK_PAYLOAD_FILE');
  const ghlPayloadFile = ghlPayloadFileRaw
    ? isAbsolute(ghlPayloadFileRaw)
      ? ghlPayloadFileRaw
      : join(spikeRoot, ghlPayloadFileRaw)
    : undefined;
  return {
    ghlPayloadFile,
    ghlPublicKey: env('GHL_PUBLIC_KEY'),
    ghlPublicKeyUrl: env('GHL_PUBLIC_KEY_URL'),
    slackSigningSecret: env('SLACK_SIGNING_SECRET'),
    googlePushJwt: env('GOOGLE_PUSH_JWT'),
    googleExpectedAudience: env('GOOGLE_EXPECTED_AUDIENCE'),
  };
}

export type Mode = 'M' | 'R';

// MODE R is entered ONLY when the load-bearing GHL real facts are present — a live captured payload
// AND the real public key. Everything else (Slack secret, Google JWT) is optional enrichment.
export function selectMode(inputs: OperatorInputs): Mode {
  return inputs.ghlPayloadFile && inputs.ghlPublicKey ? 'R' : 'M';
}

export function readGhlCapturedPayload(
  file: string,
): { rawBody: string; headers: Record<string, string> } {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    rawBody?: string;
    body?: string;
    headers?: Record<string, string>;
  };
  const rawBody = parsed.rawBody ?? parsed.body;
  if (typeof rawBody !== 'string') {
    throw new Error(
      `GHL captured payload ${file} must carry the exact received bytes as a string field "rawBody" ` +
        `(capture BEFORE JSON parse — re-serialising invalidates the signature). Got: ${typeof rawBody}`,
    );
  }
  // Lower-case header keys for case-insensitive lookup.
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.headers ?? {})) headers[k.toLowerCase()] = String(v);
  return { rawBody, headers };
}
