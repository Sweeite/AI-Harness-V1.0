// ISSUE-060 §8 step 7 — the two read-side learning loops over the accumulated guardrail_log.
//   FR-6.OPT.001 (approval-pattern): surface tier-change CANDIDATES from a consistent approval history;
//                a candidate applies ONLY after explicit admin confirmation — never a silent auto-retiering (#2).
//   FR-6.OPT.002 (anomaly-baseline): the reusable baseline mechanism ISSUE-057 consumes; a signal threshold may
//                auto-tune, but a GATE-altering shift requires admin confirmation (FR-6.ANM.005), not auto-apply.
//   Both share AC-6.OPT.001.2: an un-actioned candidate PERSISTS / re-surfaces, it does not silently vanish (#3).

import type { GuardrailLogRow } from "./types.ts";

// ── Candidate state machine (shared by both loops) ───────────────────────────────────────────────────

export type CandidateKind = "approval_tier" | "anomaly_baseline";
export type CandidateState = "surfaced" | "confirmed" | "rejected";

/** Whether a candidate would alter a GATE decision (admin-confirm required) vs merely a signal threshold
 *  (may auto-tune). FR-6.OPT.002 / FR-6.ANM.005. */
export type ChangeImpact = "gate" | "signal";

export interface Candidate {
  id: string;
  kind: CandidateKind;
  /** The subject whose tier/threshold the candidate would change (e.g. an action class, a signal name). */
  subject: string;
  impact: ChangeImpact;
  proposal: string; // plain-English description of the proposed change
  state: CandidateState;
  surfacedAt: string;
  /** Set on confirm/reject; the admin who actioned it. */
  actionedBy: string | null;
  actionedAt: string | null;
  /** Bumped each time an un-actioned candidate re-surfaces (AC-6.OPT.001.2 — proof it persisted). */
  resurfacedCount: number;
}

export class SilentAutoChangeForbidden extends Error {
  constructor(subject: string) {
    super(`refusing to auto-apply a gate change for '${subject}' — admin confirmation required (AC-6.OPT.001.1, #2)`);
    this.name = "SilentAutoChangeForbidden";
  }
}

/**
 * Holds surfaced candidates. Confirmation is the ONLY path to `applied`; a stale un-actioned candidate is NOT
 * dropped — it re-surfaces (its resurfacedCount grows) so it stays visible (#3).
 */
export class LearningLoop {
  private readonly candidates = new Map<string, Candidate>();

  /** Surface a candidate. If one for the same (kind,subject) is already surfaced+un-actioned, DON'T duplicate —
   *  bump its resurfacedCount instead (re-surface, not a fresh row). Returns the live candidate. */
  surface(input: {
    id: string;
    kind: CandidateKind;
    subject: string;
    impact: ChangeImpact;
    proposal: string;
    at: string;
  }): Candidate {
    const existing = [...this.candidates.values()].find(
      (c) => c.kind === input.kind && c.subject === input.subject && c.state === "surfaced",
    );
    if (existing) {
      existing.resurfacedCount += 1; // AC-6.OPT.001.2 — it persisted; re-surfacing is recorded.
      return { ...existing };
    }
    const c: Candidate = {
      id: input.id,
      kind: input.kind,
      subject: input.subject,
      impact: input.impact,
      proposal: input.proposal,
      state: "surfaced",
      surfacedAt: input.at,
      actionedBy: null,
      actionedAt: null,
      resurfacedCount: 0,
    };
    this.candidates.set(c.id, c);
    return { ...c };
  }

  /** The re-scan the dashboard runs periodically: any surfaced-but-un-actioned candidate re-surfaces (its count
   *  bumps), proving it did NOT vanish while the admin sat on it (AC-6.OPT.001.2). Returns the still-open set. */
  reScan(): Candidate[] {
    const open: Candidate[] = [];
    for (const c of this.candidates.values()) {
      if (c.state === "surfaced") {
        c.resurfacedCount += 1;
        open.push({ ...c });
      }
    }
    return open;
  }

  /** Explicit admin confirmation — the ONLY path that applies a change (AC-6.OPT.001.1). */
  confirm(id: string, adminId: string, at: string): Candidate {
    const c = this.mustGet(id);
    c.state = "confirmed";
    c.actionedBy = adminId;
    c.actionedAt = at;
    return { ...c };
  }

  /** Explicit admin rejection — the candidate is actioned (no longer re-surfaces); the gate stays strict. */
  reject(id: string, adminId: string, at: string): Candidate {
    const c = this.mustGet(id);
    c.state = "rejected";
    c.actionedBy = adminId;
    c.actionedAt = at;
    return { ...c };
  }

  /** A GATE change may be applied ONLY through confirm(). A caller that tries to auto-apply a gate change is
   *  refused (AC-6.OPT.001.1 / FR-6.OPT.002 — never silent auto-change). A `signal`-impact tune is allowed. */
  applyIfPermitted(id: string): { applied: boolean; reason: string } {
    const c = this.mustGet(id);
    // logic-sweep fix: a candidate an admin explicitly REJECTED must never apply — for ANY impact. The
    // signal branch below short-circuited before any state check, so a rejected signal candidate still
    // auto-applied, silently overriding the admin's decision (a #2 violation; reject()'s own doc says a
    // rejected candidate is "actioned"). State-gate rejection first, then fall through to the impact rules.
    if (c.state === "rejected") {
      return { applied: false, reason: "candidate was rejected by an admin — not applied" };
    }
    if (c.impact === "gate" && c.state !== "confirmed") {
      throw new SilentAutoChangeForbidden(c.subject);
    }
    if (c.impact === "signal") {
      // A signal-only threshold may auto-tune (FR-6.OPT.002) — it does not alter a gate decision.
      return { applied: true, reason: "signal threshold auto-tuned (no gate decision altered)" };
    }
    return { applied: true, reason: "gate change applied after explicit admin confirmation" };
  }

  get(id: string): Candidate | undefined {
    const c = this.candidates.get(id);
    return c ? { ...c } : undefined;
  }

  private mustGet(id: string): Candidate {
    const c = this.candidates.get(id);
    if (!c) throw new Error(`candidate ${id} not found`);
    return c;
  }
}

// ── FR-6.OPT.001 — detect a consistent approval pattern from guardrail_log history ────────────────────

/**
 * Scan resolved approval_gate rows for an action class (keyed by description) that is ALWAYS approved by a human
 * — a candidate for auto-approval (a tier loosening). Returns the subjects that met the threshold. This only
 * SURFACES a candidate; it never applies one (that is admin-confirmed).
 */
export function detectApprovalPattern(
  rows: readonly GuardrailLogRow[],
  minSamples: number,
): string[] {
  const bySubject = new Map<string, { total: number; approved: number }>();
  for (const r of rows) {
    if (r.guardrail_type !== "approval_gate") continue;
    if (r.status === "pending") continue; // only resolved history informs a pattern
    const s = bySubject.get(r.description) ?? { total: 0, approved: 0 };
    s.total += 1;
    if (r.status === "approved") s.approved += 1;
    bySubject.set(r.description, s);
  }
  const out: string[] = [];
  for (const [subject, s] of bySubject) {
    // "always auto-approved by a human" AND enough samples to be a pattern, not a coincidence.
    if (s.total >= minSamples && s.approved === s.total) out.push(subject);
  }
  return out;
}

// ── FR-6.OPT.002 — the reusable anomaly-baseline mechanism ISSUE-057 consumes ─────────────────────────

export interface Baseline {
  mean: number;
  stdev: number;
  samples: number;
}

/** Build a baseline (mean + population stdev) from historical numeric observations. ISSUE-057 feeds this the
 *  anomaly signal series; the mechanism itself lives here (FR-6.OPT.002 reusable). */
export function buildBaseline(observations: readonly number[]): Baseline {
  const samples = observations.length;
  if (samples === 0) return { mean: 0, stdev: 0, samples: 0 };
  const mean = observations.reduce((a, b) => a + b, 0) / samples;
  const variance = observations.reduce((a, b) => a + (b - mean) ** 2, 0) / samples;
  return { mean, stdev: Math.sqrt(variance), samples };
}

/** Classify a proposed threshold change: if it would move a GATE decision it must be admin-confirmed; a pure
 *  signal-sensitivity tune may auto-apply (FR-6.OPT.002 / FR-6.ANM.005). */
export function classifyThresholdChange(altersGateDecision: boolean): ChangeImpact {
  return altersGateDecision ? "gate" : "signal";
}
