// ISSUE-006 §8 step 8 — emit the AF-078 evidence block (fields a–h, mirroring the AF-067/AF-068
// house style) + machine-readable JSON → results/af-078-evidence.<date>.{json,md}. Written ONLY at
// run time (the R8 "you-present" rule: no fabricated evidence). Paste the markdown into
// feasibility-register.md §K and flip AF-078 🔴→🟢 ONLY on a MODE-R PASS.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CFG, GHL_LEGACY_HEADER_CUTOFF } from './config.js';
import type { BatteryOutput, CaseResult } from './battery.js';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, '..', 'results');

export interface Verdict {
  verdict: 'PASS' | 'FAIL';
  green: boolean; // true ONLY when a MODE-R PASS resolves AF-090 (GHL path proven against real facts)
  reason: string;
}

// The battery PASSING proves the mechanics. AF-078 only flips GREEN when MODE R additionally proves
// the GHL path against real GHL facts (AF-090 resolved). MODE M can never be GREEN — it prints the debt.
export function computeVerdict(b: BatteryOutput): Verdict {
  const allCasesPass = b.results.every((r) => r.passed);
  const parseProof = b.parseBeforeVerify.rawFirstVerifies && b.parseBeforeVerify.parseThenVerifyFails;
  const batteryPass = allCasesPass && parseProof;

  if (!batteryPass) {
    return { verdict: 'FAIL', green: false, reason: 'one or more battery assertions failed (see per-case table)' };
  }
  if (b.mode === 'M') {
    return {
      verdict: 'PASS',
      green: false,
      reason:
        'MODE M — mechanics proven (parse-before-verify, constant-time compare, replay defense); ' +
        'AF-090 / GHL real-signature assertion still OWED → run MODE R with operator infra to flip AF-078 GREEN.',
    };
  }
  return {
    verdict: 'PASS',
    green: true,
    reason: 'MODE R — GHL path proven against the LIVE captured payload + real public key (AF-090 resolved).',
  };
}

function caseLine(r: CaseResult): string {
  return `| ${r.id} | ${r.connector} | ${r.cell} | ${r.expect} | ${r.gotStatus} | ${r.passed ? '✅' : '❌'} | ${r.ac} |`;
}

export function writeEvidence(b: BatteryOutput, date: string): { mdPath: string; jsonPath: string; verdict: Verdict } {
  const v = computeVerdict(b);
  const status = v.green ? '🟢' : v.verdict === 'PASS' ? '🟡 (mechanics only)' : '⛔';

  const byConnector = (c: string) => b.results.filter((r) => r.connector === c);
  const passCount = b.results.filter((r) => r.passed).length;

  const md = `### AF-078 evidence — webhook forgery / replay rejected end-to-end (ISSUE-006)

**(a) Verdict:** ${v.verdict} → status ${status}
> ${v.reason}
${
  v.green
    ? ''
    : `> ⚠️ **NOT GREEN.** ${b.mode === 'M' ? 'This was a MODE M run: the GHL path was exercised with a THROWAWAY harness keypair, not GHL’s real signer. AF-090 (the real GHL signing base string) is UNRESOLVED. AF-078 stays 🔴 until a MODE R run proves the GHL path against a live captured payload + GHL’s published public key.' : v.reason}`
}

**(b) Date / method:** ${date} · SPIKE — red-team / E2E adversarial (a valid·tampered·replayed·stale matrix per connector vs the running verifiers; launch go/no-go gate, test-strategy.md §4).
**(b′) MODE:** **${b.mode}** ${b.mode === 'R' ? '(real — operator infra present)' : '(mechanics — self-contained; no operator infra)'}. Environment: self-contained TypeScript / Node harness (ADR-009 stack), Node built-in \`crypto\` for Ed25519 · RS256 (JWKS) · HMAC-SHA256. The productionised endpoints ship in ISSUE-017; this throwaway spike proves the MECHANICS + yields the retained battery.

**(c) §8.0 discovered facts (the spike-discovery outputs — Rule 0: write back to the register):**
- **GHL Ed25519 signing input (AF-090):** \`${b.discovered.ghl_signing_input}\`. ${b.mode === 'R' ? 'Confirmed empirically against the live captured payload + real key — record this base-string construction in the AF-090 row.' : 'UNCONFIRMED — MODE M cannot resolve this; it is the whole reason a MODE R run is required.'}
- **GHL published public key source:** ${b.discovered.ghl_public_key_source}. (Read by the verifier from \`webhook_secrets\`, never inline — CRITICAL RULE 2.)
- **Google expected audience:** \`${b.discovered.google_expected_audience}\` (spike-local chosen value; per-deployment config, NOT written back to the spec).
- **GHL legacy-header cutoff:** requests carrying only \`X-WH-Signature\` after \`${GHL_LEGACY_HEADER_CUTOFF}\` are rejected (OD-046).

**(d) Per-connector results (valid → accept · tampered/replayed/stale → 401):** ${passCount}/${b.results.length} assertions pass.
- **Slack (HMAC-SHA256 over v0:ts:rawBody):** ${byConnector('slack').filter((r) => r.passed).length}/${byConnector('slack').length} — replay window (>${CFG.replay_window_seconds}s) rejected BEFORE the signature check (AC-0.WHK.004.1); tampered body/signature → 401 (AC-0.WHK.004.2).
- **GHL (Ed25519, X-GHL-Signature):** ${byConnector('ghl').filter((r) => r.passed).length}/${byConnector('ghl').length} — tampered body/signature → 401 (AC-0.WHK.002.1); legacy-only after cutoff rejected (AC-0.WHK.002.2).
- **Google (Pub/Sub RS256 JWT):** ${byConnector('google').filter((r) => r.passed).length}/${byConnector('google').length} — wrong audience/expired/tampered-signature → 401 (AC-0.WHK.003.1).

**(e) The parse-before-verify proof (AC-0.WHK.005.1 — the load-bearing failure mode):**
- Raw-first ingress verifies a genuinely-valid signature: **${b.parseBeforeVerify.rawFirstVerifies ? 'YES ✅' : 'NO ❌'}**.
- The deliberately-wrong parse-then-verify ingress FAILS that same valid signature: **${b.parseBeforeVerify.parseThenVerifyFails ? 'YES ✅ (proves a framework that parses/re-serialises before verify silently breaks all three connectors)' : 'NO ❌ — the proof did not hold'}**.
- Re-serialisation differed from the raw bytes: ${b.parseBeforeVerify.reserialisationDiffered ? 'YES (non-canonical JSON — the realistic case)' : 'NO'}. Sample raw body: \`${b.parseBeforeVerify.sampleRawBody.replace(/`/g, '\\`')}\`.

**(f) Constant-time compare + reject path:**
- ${b.constantTimeNote}
- Every failed verify → **HTTP 401** + a \`guardrail_log\` row of type \`prompt_injection\` (ADR-007: webhook auth is a HARD control) + **NO downstream task** (AC-0.WHK.001.1, AC-NFR-SEC.008.1). Past \`failure_alert_threshold=${CFG.failure_alert_threshold}\`/source/hr → alert (escalated_at set).

**(g) Replay defense (AC-0.WHK.008.1 / AC-NFR-SEC.008.2):**
- Slack: 5-minute timestamp window (checked first). GHL/Google: seen-event-ID cache (\`webhook_replay_cache\`, PK (connector_type,event_id)), checked AFTER a valid signature — a re-delivered verified event is DROPPED (event_log \`webhook_replay_drop\`) and creates NO second task.

**(g′) Scope note:** VERIFICATION MECHANICS + REPLAY only. Productionised endpoints, secret-rotation dual-accept window, per-source throttle wiring, obscurity-token endpoint = ISSUE-017. Trigger-infra consumption of the verified event = ISSUE-037. This harness is the throwaway stub; the retained battery re-runs against the real ISSUE-017 code.

**(h) On ⛔ FAIL — documented fork (R2 / ADR-007):** a bypass (a forged/replayed event that verifies, or a parse-before-verify break) is **closed in code** on the owning ISSUE-017, **never patched with a detection rule**, then the battery re-runs. A FAIL is a design fork (log an OD), not a bug to code around.

---

#### Per-case results

| Case | Connector | Matrix cell | Expect | HTTP | Result | AC |
|------|-----------|-------------|--------|------|--------|----|
${b.results.map(caseLine).join('\n')}
`;

  const mdPath = join(resultsDir, `af-078-evidence.${date}.md`);
  const jsonPath = join(resultsDir, `af-078-evidence.${date}.json`);
  writeFileSync(mdPath, md);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        af: 'AF-078',
        issue: 'ISSUE-006',
        date,
        mode: b.mode,
        verdict: v.verdict,
        green: v.green,
        reason: v.reason,
        discovered: b.discovered,
        parseBeforeVerify: b.parseBeforeVerify,
        counts: {
          cases: b.results.length,
          passed: b.results.filter((r) => r.passed).length,
        },
        results: b.results,
      },
      null,
      2,
    ),
  );

  return { mdPath, jsonPath, verdict: v };
}

export { resultsDir };
