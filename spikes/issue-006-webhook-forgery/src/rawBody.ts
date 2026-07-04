// ISSUE-006 §8 step 1 — the raw-body ingress shim. THE single most important mechanic and the whole
// reason AF-078 exists: a signature is computed over the EXACT bytes the vendor sent. If a framework
// buffers → JSON.parse → re-serialises the body before the verifier runs, the re-serialised bytes
// differ (key order, whitespace, number formatting, unicode escaping) and EVERY signature check
// silently fails-open or fails-closed on the wrong input — AC-0.WHK.005.1.
//
// The shim captures the raw received bytes and exposes `raw` and `parsed` SEPARATELY, so a verifier
// can only ever sign/verify over `raw`. We also ship a deliberately-WRONG "parse-then-verify" variant
// to demonstrate, in the battery, that reconstructing bytes from the parsed object FAILS the spec.

import { Buffer } from 'node:buffer';

export interface InboundRequest {
  // The exact received bytes, verbatim. This is what every verifier signs over.
  raw: Buffer;
  headers: Record<string, string>; // header keys are lower-cased on ingress
}

export interface Ingress {
  /** The verbatim received bytes. Verifiers MUST use this. */
  raw(): Buffer;
  /** The parsed JSON body — for BUSINESS LOGIC only, NEVER for signature input. */
  parsed(): unknown;
  header(name: string): string | undefined;
}

// CORRECT ingress: raw captured before parse; parse is lazy and derived FROM raw, never the reverse.
export function ingress(req: InboundRequest): Ingress {
  const raw = req.raw;
  let parsedCache: unknown;
  let parsedOnce = false;
  return {
    raw: () => raw,
    parsed: () => {
      if (!parsedOnce) {
        parsedOnce = true;
        try {
          parsedCache = JSON.parse(raw.toString('utf8'));
        } catch {
          parsedCache = undefined;
        }
      }
      return parsedCache;
    },
    header: (name: string) => req.headers[name.toLowerCase()],
  };
}

// WRONG ingress (the anti-pattern the spec forbids): the framework parsed first and the verifier is
// handed a re-serialisation of the parsed object as if it were the raw body. Used ONLY by the
// AC-0.WHK.005.1 battery cell to prove this path fails to verify a genuinely-valid signature.
export function parseThenVerifyIngress(req: InboundRequest): Ingress {
  const parsed = JSON.parse(req.raw.toString('utf8'));
  const reserialised = Buffer.from(JSON.stringify(parsed), 'utf8'); // ← the bug: NOT the original bytes
  return {
    raw: () => reserialised,
    parsed: () => parsed,
    header: (name: string) => req.headers[name.toLowerCase()],
  };
}

// True iff the parsed→re-serialised bytes differ from the raw bytes. When true (the normal case for
// any non-canonical JSON), a parse-then-verify connector is provably broken.
export function reserialisationDiffers(raw: Buffer): boolean {
  try {
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))), 'utf8');
    return !raw.equals(reserialised);
  } catch {
    return true;
  }
}
