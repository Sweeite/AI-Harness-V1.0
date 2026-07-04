// ISSUE-006 §8 step 7 — the test battery. Per connector, a matrix of
// {valid, tampered-body, tampered-signature, replayed, stale-timestamp} payloads, asserting
// accept/reject per the ACs. Plus the cross-cutting parse-before-verify proof (AC-0.WHK.005.1).
//
// MODE M builds every payload from self-generated keys/secrets (proves mechanics). MODE R additionally
// asserts the GHL path against the operator's LIVE captured payload + real key (resolves AF-090) and,
// if supplied, real Slack/Google material.

import { Buffer } from 'node:buffer';
import { CFG, type Mode, type OperatorInputs, readGhlCapturedPayload } from './config.js';
import { Sinks, type Connector } from './sinks.js';
import { ingress, parseThenVerifyIngress, reserialisationDiffers, type InboundRequest } from './rawBody.js';
import { resetFailureCounts } from './reject.js';
import { verifySlack, signSlack } from './verifiers/slack.js';
import {
  verifyGhl,
  verifyEd25519,
  ghlSigningInput,
  discoverGhlSigningInput,
  type GhlSigningInput,
} from './verifiers/ghl.js';
import { verifyGoogle, type Jwks } from './verifiers/google.js';
import {
  generateSlackSigningSecret,
  generateEd25519Pair,
  signEd25519,
  generateRsaJwks,
  mintRs256Jwt,
} from './keygen.js';

export type Expect = 'accept' | 'reject';
export interface Case {
  id: string;
  connector: Connector;
  cell: string; // matrix cell: valid | tampered-body | tampered-signature | replayed | stale-timestamp | ...
  expect: Expect;
  ac: string; // the AC this case exercises
  run: (sinks: Sinks) => { status: 200 | 401; note: string };
}
export interface CaseResult {
  id: string;
  connector: Connector;
  cell: string;
  expect: Expect;
  ac: string;
  gotStatus: 200 | 401;
  passed: boolean;
  note: string;
}

// The §8.0 discovered facts, surfaced into the evidence.
export interface DiscoveredFacts {
  ghl_signing_input: GhlSigningInput | 'UNCONFIRMED (MODE M — AF-090 unresolved)';
  ghl_public_key_source: string;
  google_expected_audience: string;
}

export interface BatteryOutput {
  mode: Mode;
  results: CaseResult[];
  discovered: DiscoveredFacts;
  parseBeforeVerify: {
    // AC-0.WHK.005.1 proof: the correct (raw-first) ingress verifies; the parse-then-verify variant
    // fails to verify the SAME genuinely-valid signature.
    rawFirstVerifies: boolean;
    parseThenVerifyFails: boolean;
    reserialisationDiffered: boolean;
    sampleRawBody: string;
  };
  constantTimeNote: string;
}

// A logical clock for the run (deterministic). "now" epoch seconds; battery advances it as needed.
const NOW = 1_751_616_000; // 2026-07-04T00:00:00Z (matches the evidence date; purely logical)

export function runBattery(mode: Mode, inputs: OperatorInputs): BatteryOutput {
  const sinks = new Sinks();
  resetFailureCounts();
  const cases: Case[] = [];

  // ─────────────────────────────────────────────────────────────────────────────────
  // Seed webhook_secrets. Vendor material comes from generated keys (MODE M) or operator env (MODE R).
  // ─────────────────────────────────────────────────────────────────────────────────

  // Slack signing secret (real if supplied, else generated — Slack is self-signable either way).
  const slackSecret = inputs.slackSigningSecret ?? generateSlackSigningSecret();
  sinks.seedSecret({
    connector: 'slack',
    secret_kind: 'hmac_signing_secret',
    secret_value: slackSecret,
    secret_version: 1,
    active: true,
  });

  // GHL Ed25519 keypair. MODE R: the operator's REAL public key (private key never needed — we verify a
  // real captured signature). MODE M: a throwaway keypair simulating GHL's signer.
  const ghlPair = mode === 'M' ? generateEd25519Pair() : null;
  const ghlPublicKey = mode === 'R' ? inputs.ghlPublicKey! : ghlPair!.publicKeyPem;
  sinks.seedSecret({
    connector: 'ghl',
    secret_kind: 'ed25519_public_key',
    secret_value: ghlPublicKey,
    secret_version: 1,
    active: true,
  });

  // Google: expected audience (spike-local chosen value, or the operator's real audience) + JWKS.
  const googleAud = CFG.google_expected_audience;
  sinks.seedSecret({
    connector: 'google',
    secret_kind: 'expected_audience',
    secret_value: googleAud,
    secret_version: 1,
    active: true,
  });
  const rsa = generateRsaJwks(); // local JWKS mints MODE-M tokens; in MODE R, real certs would be fetched.
  const googleJwks: Jwks = rsa.jwks;

  // ─────────────────────────────────────────────────────────────────────────────────
  // §8.0 discovery: resolve the GHL signing-input construction (AF-090).
  // ─────────────────────────────────────────────────────────────────────────────────
  let ghlConstruction: GhlSigningInput = 'raw_body_only';
  let discovered: DiscoveredFacts = {
    ghl_signing_input: 'UNCONFIRMED (MODE M — AF-090 unresolved)',
    ghl_public_key_source:
      mode === 'R'
        ? inputs.ghlPublicKeyUrl ?? '(operator-provided key; URL not recorded in .env)'
        : '(MODE M — throwaway harness keypair; NOT GHL’s real key)',
    google_expected_audience: googleAud,
  };

  // The captured GHL request used to build the GHL battery. In MODE R it is the operator's LIVE capture;
  // in MODE M the harness constructs one with its throwaway signer.
  let ghlValidRaw: Buffer;
  let ghlValidHeaders: Record<string, string>;
  let ghlEventId = 'ghl-evt-001';

  if (mode === 'R') {
    const cap = readGhlCapturedPayload(inputs.ghlPayloadFile!);
    ghlValidRaw = Buffer.from(cap.rawBody, 'utf8');
    ghlValidHeaders = cap.headers;
    const realSig = cap.headers['x-ghl-signature'];
    if (!realSig) {
      throw new Error('MODE R: captured GHL payload has no X-GHL-Signature header — cannot resolve AF-090');
    }
    const resolved = discoverGhlSigningInput(
      ghlPublicKey,
      ghlValidRaw,
      realSig,
      cap.headers['x-ghl-timestamp'],
    );
    if (!resolved) {
      // AF-090 genuinely unresolved against the real key — a real finding, NOT to be signed away.
      throw new Error(
        'MODE R: none of the candidate GHL signing-input constructions verified the LIVE signature ' +
          'against the real public key. AF-090 remains OPEN — record the finding and extend the candidate ' +
          'set from GHL primary docs; do NOT fabricate a PASS.',
      );
    }
    ghlConstruction = resolved;
    discovered.ghl_signing_input = resolved;
  } else {
    // MODE M: mint a self-signed GHL request with the throwaway signer over the chosen construction.
    const body = JSON.stringify({ id: ghlEventId, type: 'ContactCreate', k: 'v', n: 3 });
    ghlValidRaw = Buffer.from(body, 'utf8');
    const sig = signEd25519(ghlPair!.privateKey, ghlSigningInput(ghlConstruction, ghlValidRaw));
    ghlValidHeaders = { 'x-ghl-signature': sig };
  }

  // ─────────────────────────────────────────────────────────────────────────────────
  // SLACK matrix. Base string v0:ts:rawBody; replay window checked before signature.
  // ─────────────────────────────────────────────────────────────────────────────────
  const slackBody = JSON.stringify({ event: { type: 'message', text: 'hello' }, team_id: 'T123' });
  const slackRaw = Buffer.from(slackBody, 'utf8');
  const slackTs = String(NOW);
  const validSlackSig = signSlack(slackSecret, slackTs, slackRaw);
  const slackReq = (headers: Record<string, string>, raw: Buffer, now = NOW): InboundRequest => ({
    raw,
    headers,
  });

  cases.push({
    id: 'SLK-valid',
    connector: 'slack',
    cell: 'valid',
    expect: 'accept',
    ac: 'AC-0.WHK.001.1 (valid path)',
    run: (s) =>
      verifySlack(s, {
        ingress: ingress(slackReq({ 'x-slack-request-timestamp': slackTs, 'x-slack-signature': validSlackSig }, slackRaw)),
        sourceId: 'T123',
        now: NOW,
      }),
  });
  cases.push({
    id: 'SLK-tampered-body',
    connector: 'slack',
    cell: 'tampered-body',
    expect: 'reject',
    ac: 'AC-0.WHK.004.2',
    run: (s) => {
      const tampered = Buffer.from(slackBody.replace('hello', 'HACKED'), 'utf8');
      return verifySlack(s, {
        ingress: ingress(slackReq({ 'x-slack-request-timestamp': slackTs, 'x-slack-signature': validSlackSig }, tampered)),
        sourceId: 'T123',
        now: NOW,
      });
    },
  });
  cases.push({
    id: 'SLK-tampered-sig',
    connector: 'slack',
    cell: 'tampered-signature',
    expect: 'reject',
    ac: 'AC-0.WHK.004.2',
    run: (s) =>
      verifySlack(s, {
        ingress: ingress(slackReq({ 'x-slack-request-timestamp': slackTs, 'x-slack-signature': 'v0=deadbeef'.padEnd(validSlackSig.length, '0') }, slackRaw)),
        sourceId: 'T123',
        now: NOW,
      }),
  });
  cases.push({
    id: 'SLK-stale-timestamp',
    connector: 'slack',
    cell: 'stale-timestamp',
    expect: 'reject',
    ac: 'AC-0.WHK.004.1 (replay window, before signature)',
    run: (s) => {
      const staleTs = String(NOW - CFG.replay_window_seconds - 60);
      const staleSig = signSlack(slackSecret, staleTs, slackRaw); // even a VALID sig must lose to the stale window
      return verifySlack(s, {
        ingress: ingress(slackReq({ 'x-slack-request-timestamp': staleTs, 'x-slack-signature': staleSig }, slackRaw)),
        sourceId: 'T123',
        now: NOW,
      });
    },
  });
  cases.push({
    id: 'SLK-absent-sig',
    connector: 'slack',
    cell: 'absent-signature',
    expect: 'reject',
    ac: 'AC-0.WHK.001.1',
    run: (s) =>
      verifySlack(s, {
        ingress: ingress(slackReq({ 'x-slack-request-timestamp': slackTs }, slackRaw)),
        sourceId: 'T123',
        now: NOW,
      }),
  });

  // ─────────────────────────────────────────────────────────────────────────────────
  // GHL matrix. Ed25519; legacy-header cutoff; event-ID replay.
  // ─────────────────────────────────────────────────────────────────────────────────
  const ghlReq = (headers: Record<string, string>, raw: Buffer): InboundRequest => ({ raw, headers });
  const mkGhl = (id: string, cell: string, expect: Expect, ac: string, headers: Record<string, string>, raw: Buffer, now = NOW) =>
    cases.push({
      id,
      connector: 'ghl',
      cell,
      expect,
      ac,
      run: (s) =>
        verifyGhl(s, { ingress: ingress(ghlReq(headers, raw)), sourceId: 'ghl-loc-1', now, mode, construction: ghlConstruction }),
    });

  mkGhl('GHL-valid', 'valid', 'accept', 'AC-0.WHK.002.1 (valid path)', ghlValidHeaders, ghlValidRaw);
  mkGhl(
    'GHL-tampered-body',
    'tampered-body',
    'reject',
    'AC-0.WHK.002.1',
    ghlValidHeaders,
    Buffer.concat([ghlValidRaw, Buffer.from(' ', 'utf8')]), // one extra byte → signature no longer matches
  );
  mkGhl(
    'GHL-tampered-sig',
    'tampered-signature',
    'reject',
    'AC-0.WHK.002.1',
    { ...ghlValidHeaders, 'x-ghl-signature': Buffer.from('forged-signature-bytes-000000000').toString('base64') },
    ghlValidRaw,
  );
  mkGhl(
    'GHL-legacy-only-after-cutoff',
    'legacy-header-only',
    'reject',
    'AC-0.WHK.002.2',
    { 'x-wh-signature': 'legacyhmacvalueonly' }, // no X-GHL-Signature, "now" is after 2026-07-01
    ghlValidRaw,
  );
  mkGhl('GHL-absent-sig', 'absent-signature', 'reject', 'AC-0.WHK.001.1', {}, ghlValidRaw);
  // Replay: a VALID GHL event seen twice → first accepts, second drops (AC-0.WHK.008.1). Both share sinks
  // within one case-run, so we exercise the pair inside a single case.
  cases.push({
    id: 'GHL-replayed',
    connector: 'ghl',
    cell: 'replayed',
    expect: 'reject', // the SECOND delivery must not create work
    ac: 'AC-0.WHK.008.1 / AC-NFR-SEC.008.2',
    run: (s) => {
      const first = verifyGhl(s, { ingress: ingress(ghlReq(ghlValidHeaders, ghlValidRaw)), sourceId: 'ghl-loc-1', now: NOW, mode, construction: ghlConstruction });
      const second = verifyGhl(s, { ingress: ingress(ghlReq(ghlValidHeaders, ghlValidRaw)), sourceId: 'ghl-loc-1', now: NOW + 1, mode, construction: ghlConstruction });
      // first must have been accepted (200), second must be a drop (200 but NO new task).
      const tasksForEvent = s.downstreamTasks.filter((t) => t.connector === 'ghl').length;
      const droppedNoWork = first.status === 200 && second.note.includes('replay') && tasksForEvent === 1;
      return { status: droppedNoWork ? 401 : 200, note: droppedNoWork ? 'replay dropped, no 2nd task' : `NOT deduped (tasks=${tasksForEvent})` };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────────
  // GOOGLE matrix. RS256 JWT; audience; expiry; message-ID replay. MODE M mints against local JWKS.
  // MODE R uses the operator's real JWT if supplied, else still mints locally (Google path is
  // self-mintable — only the GHL path gates AF-078 GREEN).
  // ─────────────────────────────────────────────────────────────────────────────────
  const googleBody = JSON.stringify({ message: { messageId: 'msg-001', data: 'eyJ4IjoxfQ==' }, subscription: 'sub-x' });
  const googleRaw = Buffer.from(googleBody, 'utf8');
  const validJwt =
    mode === 'R' && inputs.googlePushJwt
      ? inputs.googlePushJwt
      : mintRs256Jwt(rsa.privateKey, rsa.kid, { aud: googleAud, exp: NOW + 600, iat: NOW - 10, iss: 'https://accounts.google.com' });
  const googleReq = (headers: Record<string, string>, raw: Buffer): InboundRequest => ({ raw, headers });
  const mkGoogle = (id: string, cell: string, expect: Expect, ac: string, jwt: string | null, raw = googleRaw, now = NOW) =>
    cases.push({
      id,
      connector: 'google',
      cell,
      expect,
      ac,
      run: (s) =>
        verifyGoogle(s, {
          ingress: ingress(googleReq(jwt ? { authorization: `Bearer ${jwt}` } : {}, raw)),
          sourceId: 'sub-x',
          now,
          jwks: googleJwks,
        }),
    });

  mkGoogle('GOO-valid', 'valid', 'accept', 'AC-0.WHK.003.1 (valid path)', validJwt);
  mkGoogle(
    'GOO-wrong-audience',
    'tampered-audience',
    'reject',
    'AC-0.WHK.003.1',
    mintRs256Jwt(rsa.privateKey, rsa.kid, { aud: 'https://attacker.example/aud', exp: NOW + 600, iat: NOW - 10 }),
  );
  mkGoogle(
    'GOO-expired',
    'expired',
    'reject',
    'AC-0.WHK.003.1 (expiry)',
    mintRs256Jwt(rsa.privateKey, rsa.kid, { aud: googleAud, exp: NOW - 60, iat: NOW - 600 }),
  );
  mkGoogle(
    'GOO-tampered-sig',
    'tampered-signature',
    'reject',
    'AC-0.WHK.003.1',
    (() => {
      const good = mintRs256Jwt(rsa.privateKey, rsa.kid, { aud: googleAud, exp: NOW + 600, iat: NOW - 10 });
      const parts = good.split('.');
      parts[2] = parts[2].slice(0, -4) + 'AAAA'; // corrupt the signature segment
      return parts.join('.');
    })(),
  );
  mkGoogle('GOO-absent-sig', 'absent-signature', 'reject', 'AC-0.WHK.001.1', null);
  cases.push({
    id: 'GOO-replayed',
    connector: 'google',
    cell: 'replayed',
    expect: 'reject',
    ac: 'AC-0.WHK.008.1 / AC-NFR-SEC.008.2',
    run: (s) => {
      const first = verifyGoogle(s, { ingress: ingress(googleReq({ authorization: `Bearer ${validJwt}` }, googleRaw)), sourceId: 'sub-x', now: NOW, jwks: googleJwks });
      const second = verifyGoogle(s, { ingress: ingress(googleReq({ authorization: `Bearer ${validJwt}` }, googleRaw)), sourceId: 'sub-x', now: NOW + 1, jwks: googleJwks });
      const tasksForEvent = s.downstreamTasks.filter((t) => t.connector === 'google').length;
      const droppedNoWork = first.status === 200 && second.note.includes('replay') && tasksForEvent === 1;
      return { status: droppedNoWork ? 401 : 200, note: droppedNoWork ? 'replay dropped, no 2nd task' : `NOT deduped (tasks=${tasksForEvent})` };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────────
  // Run every case against a FRESH sink per case (so per-case failure counters + replay caches don't
  // bleed) — except the replay cases which need shared state within their own run (handled inline).
  // ─────────────────────────────────────────────────────────────────────────────────
  const results: CaseResult[] = cases.map((c) => {
    const s = new Sinks();
    // Re-seed the fresh sink (verifiers read secrets from it).
    s.seedSecret({ connector: 'slack', secret_kind: 'hmac_signing_secret', secret_value: slackSecret, secret_version: 1, active: true });
    s.seedSecret({ connector: 'ghl', secret_kind: 'ed25519_public_key', secret_value: ghlPublicKey, secret_version: 1, active: true });
    s.seedSecret({ connector: 'google', secret_kind: 'expected_audience', secret_value: googleAud, secret_version: 1, active: true });
    resetFailureCounts();
    const out = c.run(s);
    const passed = c.expect === 'accept' ? out.status === 200 : out.status === 401;
    return { id: c.id, connector: c.connector, cell: c.cell, expect: c.expect, ac: c.ac, gotStatus: out.status, passed, note: out.note };
  });

  // ─────────────────────────────────────────────────────────────────────────────────
  // AC-0.WHK.005.1 — the parse-before-verify proof, using the Slack valid case (non-canonical JSON).
  // Raw-first ingress verifies; parse-then-verify ingress fails the SAME genuinely-valid signature.
  // ─────────────────────────────────────────────────────────────────────────────────
  const pbvRaw = Buffer.from(JSON.stringify({ z: 1, a: 2, nested: { b: 3 } }) + '  ', 'utf8'); // trailing space → non-canonical
  const pbvTs = String(NOW);
  const pbvSig = signSlack(slackSecret, pbvTs, pbvRaw);
  const pbvSinks = new Sinks();
  pbvSinks.seedSecret({ connector: 'slack', secret_kind: 'hmac_signing_secret', secret_value: slackSecret, secret_version: 1, active: true });
  resetFailureCounts();
  const rawFirst = verifySlack(pbvSinks, {
    ingress: ingress({ raw: pbvRaw, headers: { 'x-slack-request-timestamp': pbvTs, 'x-slack-signature': pbvSig } }),
    sourceId: 'T-pbv',
    now: NOW,
  });
  const pbvSinks2 = new Sinks();
  pbvSinks2.seedSecret({ connector: 'slack', secret_kind: 'hmac_signing_secret', secret_value: slackSecret, secret_version: 1, active: true });
  resetFailureCounts();
  const parseThen = verifySlack(pbvSinks2, {
    ingress: parseThenVerifyIngress({ raw: pbvRaw, headers: { 'x-slack-request-timestamp': pbvTs, 'x-slack-signature': pbvSig } }),
    sourceId: 'T-pbv',
    now: NOW,
  });

  const parseBeforeVerify = {
    rawFirstVerifies: rawFirst.status === 200,
    parseThenVerifyFails: parseThen.status === 401, // the anti-pattern breaks a VALID signature
    reserialisationDiffered: reserialisationDiffers(pbvRaw),
    sampleRawBody: pbvRaw.toString('utf8'),
  };

  return {
    mode,
    results,
    discovered,
    parseBeforeVerify,
    constantTimeNote:
      'Signature comparison uses crypto.timingSafeEqual (Slack HMAC) / crypto.verify (Ed25519 & RS256, ' +
      'constant-time in the backend) — never `===`. See verifiers/*.ts.',
  };
}
