// ISSUE-062 (C8 SPC) — THE LOAD-BEARING DELIVERABLE: the three per-agent NEGATIVE hard-limit invariants enforced
// at the agents.tools_allowed SAVE PATH as a code-level DENY (not an audited capability change). This is the C8
// expression of three of the seven ADR-007 hard limits, sitting ON TOP of the C6 runtime layer (defense in depth:
// prompt + missing-tool + approval gate + runtime hard limit + THIS registry-write invariant).
//
// The three invariants (AC-8.SPC.003.3 / .004.3 / .005.2 + AC-NFR-SEC.004.2):
//   (a) memory-write capability added to ANY agent other than the Memory Agent   → REJECT  (SPC.005, ADR-004)
//   (b) an autonomous-send tool added to the Comms Agent                          → REJECT  (SPC.003, hard limit #1)
//   (c) a transaction-initiating tool added to the Finance Agent                  → REJECT  (SPC.004, hard limit #2)
//
// THE DISCRIMINATOR IS NOT A STORED COLUMN. schema §4 `tools` carries category('read'|'write'), risk_level,
// requires_approval, connector, scopes, config — none of which splits *send* vs *transact* vs *memory-write* (all
// three are category='write'). So a VERSION-CONTROLLED class predicate resolves tool ids by IDENTITY via C3
// (FR-3.ACT.007 = the single internal memory-write tool; FR-3.ACT.004 = the Comms send path — the draft-only tool
// is NOT autonomous-send, a future direct-send tool IS; FR-3.ACT.002 note = no transaction/impersonation tool
// exists in the registry today, so the Finance guard blocks *adding* one). The classifier's correctness is part of
// the AF-068 red-team battery (GREEN 2026-07-04, ISSUE-003).
//
// The guard fires REGARDLESS OF CALLER ROLE — it is a negative invariant on the DATA, independent of the OD-080
// authority value (that PERM gates *who may open the editor*; this gates *whether the invariant holds*). Per OD-140
// it is "show + explain + block": the same classification drives the greyed-picker reason (ISSUE-067) and this
// save-time deny; the reason is LOGGED (a RejectionLog sink, #3 never-silent) AND the write is DENIED (#2), which is
// strictly stronger than "merely audited".

import {
  COMMS,
  FINANCE,
  MEMORY,
  SPECIALIST_CONTRACTS,
  SPECIALIST_ROLES,
  type SpecialistRole,
} from './specialists.ts';

// ── The three forbidden tool classes (resolved by C3 identity, not by a stored column). ──────────────
export const CLASS_MEMORY_WRITE = 'memory_write' as const;
export const CLASS_AUTONOMOUS_SEND = 'autonomous_send' as const;
export const CLASS_TRANSACTION = 'transaction' as const;
export type ForbiddenToolClass =
  | typeof CLASS_MEMORY_WRITE
  | typeof CLASS_AUTONOMOUS_SEND
  | typeof CLASS_TRANSACTION;
export const FORBIDDEN_TOOL_CLASSES: readonly ForbiddenToolClass[] = [
  CLASS_MEMORY_WRITE,
  CLASS_AUTONOMOUS_SEND,
  CLASS_TRANSACTION,
] as const;

/** True when a raw class string from the classification source is one of the three recognized forbidden classes. */
export function isForbiddenToolClass(v: string | null | undefined): v is ForbiddenToolClass {
  return v != null && (FORBIDDEN_TOOL_CLASSES as readonly string[]).includes(v);
}

/** The tool-class predicate. `classOf(toolId)` returns the forbidden class of a tool id, or null if the tool is
 * unclassified (i.e. not one of the three forbidden classes — the default, safe reading). The reference model uses
 * an explicit version-controlled map; the live adapter joins `tools` and reads the class tag (see supabase-store). */
export interface ToolClassifier {
  classOf(toolId: string): ForbiddenToolClass | null;
}

/** In-memory reference classifier: an explicit, version-controlled id→class map. A tool NOT in the map is
 * unclassified (null) — matching the live adapter, where a tool with no class tag is non-forbidden. Today the ONLY
 * populated class is the single memory-write tool (FR-3.ACT.007); no autonomous-send or transaction tool exists in
 * the registry (FR-3.ACT.002/.004 notes) — those entries appear only when such a tool is ever registered. */
export class InMemoryToolClassifier implements ToolClassifier {
  private readonly byId = new Map<string, ForbiddenToolClass>();
  constructor(entries: Iterable<readonly [string, ForbiddenToolClass]> = []) {
    for (const [id, klass] of entries) this.byId.set(id, klass);
  }
  /** Register (or re-classify) a tool id. The classification is a build artifact owned WITH C3 (AF-068). */
  register(toolId: string, klass: ForbiddenToolClass): void {
    this.byId.set(toolId, klass);
  }
  classOf(toolId: string): ForbiddenToolClass | null {
    return this.byId.get(toolId) ?? null;
  }
}

// ── The invariant rule: which (role, class) pairs are forbidden. ──────────────────────────────────────
/** True when granting a tool of class `klass` to `role` violates a per-agent hard-limit invariant. Precise to the
 * three named invariants: memory-write is forbidden to EVERY non-Memory role; autonomous-send is forbidden to
 * Comms; transaction is forbidden to Finance. (Send/transaction tools do not exist for other roles today; if one
 * is ever registered, extend this predicate + its AF-068 battery entry — see openQuestions.) */
export function isForbiddenGrant(role: string, klass: ForbiddenToolClass): boolean {
  if (klass === CLASS_MEMORY_WRITE) return role !== MEMORY;
  if (klass === CLASS_AUTONOMOUS_SEND) return role === COMMS;
  if (klass === CLASS_TRANSACTION) return role === FINANCE;
  return false;
}

/** The reason string surfaced to the picker (OD-140) AND logged on a save-time deny. */
export function forbiddenReason(role: string, toolId: string, klass: ForbiddenToolClass): string {
  if (klass === CLASS_MEMORY_WRITE) {
    return `tool '${toolId}' is memory-write capability — only the Memory Agent may hold it (SPC.005 / ADR-004 single writer); '${role}' may not`;
  }
  if (klass === CLASS_AUTONOMOUS_SEND) {
    return `tool '${toolId}' is an autonomous-send tool — the Comms Agent never sends autonomously (SPC.003 / hard limit #1); it drafts to the approval queue`;
  }
  return `tool '${toolId}' is a transaction-initiating tool — the Finance Agent never initiates transactions (SPC.004 / hard limit #2); it flags for a human`;
}

/** The detail of the first violating grant found in a proposed tools_allowed set. */
export interface ForbiddenGrantDetail {
  role: string;
  tool_id: string;
  tool_class: ForbiddenToolClass;
  reason: string;
}

/**
 * Evaluate a proposed `tools_allowed` for an agent role. Returns the FIRST forbidden grant (deterministic — input
 * order), or null if the set is clean. This is the pure kernel of the reject-at-write guard; the store calls it and
 * throws. Iterating in input order makes the failure deterministic for tests + operator messaging.
 */
export function evaluateToolsAllowed(
  role: string,
  toolsAllowed: readonly string[],
  classifier: ToolClassifier,
): ForbiddenGrantDetail | null {
  for (const toolId of toolsAllowed) {
    const klass = classifier.classOf(toolId);
    if (klass === null) continue;
    if (isForbiddenGrant(role, klass)) {
      return { role, tool_id: toolId, tool_class: klass, reason: forbiddenReason(role, toolId, klass) };
    }
  }
  return null;
}

/** Thrown at the save path when a tools_allowed edit would violate a per-agent hard-limit invariant. LOUD (#2/#3):
 * the write does not land, and the reason is on the error + in the RejectionLog. */
export class ForbiddenCapabilityGrant extends Error {
  constructor(readonly detail: ForbiddenGrantDetail) {
    super(
      `REJECTED at write: ${detail.reason} — a per-agent hard-limit invariant, denied at save (not merely audited) ` +
        `(AC-8.SPC.003.3/.004.3/.005.2 · AC-NFR-SEC.004.2 · OD-140)`,
    );
    this.name = 'ForbiddenCapabilityGrant';
  }
}

// ── The LIVE guard kernel (FAIL-CLOSED). ──────────────────────────────────────────────────────────────
// The in-memory reference above assumes the classification is fully deployed (its map is hand-wired). The LIVE
// classification is read from `tools.config->>'hard_limit_class'`, a tag that (today) is on NO tool row and in no
// migration — so live, a naive "unknown id ⇒ null ⇒ non-forbidden" default FAILS OPEN: an untagged memory-write
// tool would be granted to a non-Memory agent, exactly the SPC.005.2 invariant this slice exists to enforce (#2).
// The offline fake cannot see this (its map is populated). So the live path must be FAIL-CLOSED: a proposed tool we
// cannot PROVE benign is DENIED, not allowed. All three forbidden capabilities are category='write', so:
//   • recognized forbidden class + forbidden for this role → deny (precise reason)   [same as the fake]
//   • write-category tool with NO recognized class tag      → deny (unclassified_write — could be an untagged
//     forbidden capability; cannot be certified safe)       [FAIL-CLOSED — the fix for the live fail-open]
//   • id absent from `tools` entirely                        → deny (unknown_tool — cannot classify at all)
//   • read-category tool with no class tag                   → allow (no forbidden class is a read; provably benign)
// The correct long-term remedy is a shipped tag convention + the memory-write tool seeded with it (sharedSpecEdits);
// until then this path refuses to certify a write grant it cannot classify, rather than silently permitting it.

/** A live `tools` row projected to exactly what the guard needs (id + coarse category + the class tag). */
export interface LiveToolRow {
  id: string;
  category: string; // tool_category — 'read' | 'write'
  klass: string | null; // config->>'hard_limit_class'
}

/** Why a proposed grant could not be CERTIFIED safe by the live classifier (distinct from a recognized forbidden
 * grant): a write tool with no class tag, or an id not present in `tools`. Per #2 an un-provable grant is denied. */
export interface UncertifiableGrantDetail {
  role: string;
  tool_id: string;
  kind: 'unclassified_write' | 'unknown_tool';
  reason: string;
}

export type LiveGuardVerdict =
  | { ok: true }
  | { ok: false; forbidden: ForbiddenGrantDetail }
  | { ok: false; uncertifiable: UncertifiableGrantDetail };

/**
 * The pure live-guard kernel. Given the proposed `tools_allowed` and the `tools` rows fetched for exactly those ids,
 * decide the grant in INPUT ORDER (deterministic first-violation). FAIL-CLOSED: any tool not provably benign is
 * denied. This is the kernel the live adapter wires DB rows into; unit-testable without a DB (reproduces the live
 * fail-open the offline reference cannot).
 */
export function evaluateLiveGrant(
  role: string,
  toolsAllowed: readonly string[],
  rows: readonly LiveToolRow[],
): LiveGuardVerdict {
  const byId = new Map<string, LiveToolRow>();
  for (const r of rows) byId.set(r.id, r);
  for (const toolId of toolsAllowed) {
    const row = byId.get(toolId);
    if (!row) {
      return {
        ok: false,
        uncertifiable: {
          role,
          tool_id: toolId,
          kind: 'unknown_tool',
          reason:
            `tool '${toolId}' is not present in the tools registry — it cannot be classified, so it cannot be ` +
            `certified safe to grant; denied (fail-closed, #2)`,
        },
      };
    }
    const klass = isForbiddenToolClass(row.klass) ? row.klass : null;
    if (klass !== null) {
      if (isForbiddenGrant(role, klass)) {
        return { ok: false, forbidden: { role, tool_id: toolId, tool_class: klass, reason: forbiddenReason(role, toolId, klass) } };
      }
      continue; // recognized class, but not forbidden for THIS role (e.g. memory-write → Memory)
    }
    // Unclassified. A write tool could BE one of the three forbidden capabilities that simply was not tagged (all
    // three are category='write') — refuse to certify it (this is the live fail-open, closed). A read tool is
    // provably non-forbidden (none of the three classes is a read).
    if (row.category === 'write') {
      return {
        ok: false,
        uncertifiable: {
          role,
          tool_id: toolId,
          kind: 'unclassified_write',
          reason:
            `tool '${toolId}' is a write-category tool with no hard_limit_class classification — it cannot be ` +
            `proven not to be a forbidden capability (memory-write / autonomous-send / transaction); classify it ` +
            `(tools.config.hard_limit_class) before granting; denied (fail-closed, #2)`,
        },
      };
    }
  }
  return { ok: true };
}

/** Thrown at the live save path when a grant cannot be CERTIFIED safe (fail-closed) — the write does not land and
 * the reason is logged. Distinct from ForbiddenCapabilityGrant (a recognized forbidden class): here the classifier
 * could not prove the tool benign, and per #2 an un-provable grant is denied, not permitted. */
export class UncertifiableCapabilityGrant extends Error {
  constructor(readonly detail: UncertifiableGrantDetail) {
    super(
      `REJECTED at write (fail-closed): ${detail.reason} — the live tool-classification could not certify this ` +
        `grant safe; denied at save, not merely audited (#2/#3)`,
    );
    this.name = 'UncertifiableCapabilityGrant';
  }
}

// ── Rejection log (#3 never-silent — the reason is persisted, then the write is denied, per OD-140). ──
/** The class recorded on a rejection: a recognized forbidden class, or a fail-closed non-certification reason. */
export type RejectionToolClass = ForbiddenToolClass | UncertifiableGrantDetail['kind'];
export interface RejectionLogRow {
  id: string;
  role: string;
  tool_id: string;
  tool_class: RejectionToolClass;
  reason: string;
  actor_id: string;
  created_at: string;
}
export interface RejectionLog {
  logRejection(row: Omit<RejectionLogRow, 'id' | 'created_at'>, now: number): RejectionLogRow;
}
export class InMemoryRejectionLog implements RejectionLog {
  private seq = 0;
  readonly rejections: RejectionLogRow[] = [];
  logRejection(row: Omit<RejectionLogRow, 'id' | 'created_at'>, now: number): RejectionLogRow {
    this.seq += 1;
    const full: RejectionLogRow = {
      id: `reject-${String(this.seq).padStart(4, '0')}`,
      created_at: new Date(now * 1000).toISOString(),
      ...row,
    };
    this.rejections.push(full);
    return full;
  }
}

// ── Exact messages the store throws (a test asserts the same failure the live gate produces). ─────────
export const ERR_UNKNOWN_ROLE = (role: string) =>
  `specialists: '${role}' is not a canonical specialist role (${SPECIALIST_ROLES.join(', ')})`;
export const ERR_EMPTY_CHANGE_REASON =
  'specialists: `change_reason` is required and non-empty — every tools_allowed edit is audited';

// ── The port: the guarded specialist-definition store. ────────────────────────────────────────────────
export interface SpecialistDef {
  role: SpecialistRole;
  domain: SpecialistRole;
  tools_allowed: string[];
  version: number;
  change_reason: string;
  updated_at: string;
}

export interface SpecialistRegistry {
  /** The current definition for a specialist role, or null if not seeded. */
  getByRole(role: SpecialistRole): Promise<SpecialistDef | null>;

  /** Reject-at-write: set a specialist's `tools_allowed`. If the proposed set would grant a forbidden capability
   * (Comms send / Finance transact / non-Memory memory-write), the write is DENIED (throws ForbiddenCapabilityGrant)
   * and the reason logged — NOT applied-then-audited. Fires regardless of caller role. Otherwise a new version is
   * appended (append-only, mirroring the C8 agents version chain). */
  setToolsAllowed(
    role: SpecialistRole,
    toolsAllowed: string[],
    change_reason: string,
    actorId: string,
    now: number,
  ): Promise<SpecialistDef>;
}

/**
 * In-memory reference model. Seeds the eight specialist rows with EMPTY tools_allowed (the canonical roster carries
 * no send/transaction tool by construction — REG.006.3). setToolsAllowed runs the reject-at-write guard on every
 * edit. Deterministic: caller-supplied `now`; no Date.now/random (house discipline). Append-only version bump.
 */
export class InMemorySpecialistRegistry implements SpecialistRegistry {
  private readonly defs = new Map<SpecialistRole, SpecialistDef>();

  constructor(
    private readonly deps: {
      classifier: ToolClassifier;
      rejections?: RejectionLog;
    },
  ) {
    // seed the eight roster rows (contracts) with empty tools_allowed — the canonical least-privilege baseline.
    for (const role of SPECIALIST_ROLES) {
      const c = SPECIALIST_CONTRACTS[role];
      this.defs.set(role, {
        role,
        domain: c.domain,
        tools_allowed: [],
        version: 1,
        change_reason: 'seed (canonical roster; consumed from ISSUE-061 REG.006)',
        updated_at: new Date(0).toISOString(),
      });
    }
  }

  async getByRole(role: SpecialistRole): Promise<SpecialistDef | null> {
    const d = this.defs.get(role);
    return d ? { ...d, tools_allowed: [...d.tools_allowed] } : null;
  }

  async setToolsAllowed(
    role: SpecialistRole,
    toolsAllowed: string[],
    change_reason: string,
    actorId: string,
    now: number,
  ): Promise<SpecialistDef> {
    const cur = this.defs.get(role);
    if (!cur) throw new Error(ERR_UNKNOWN_ROLE(role));
    if (typeof change_reason !== 'string' || change_reason.trim().length === 0) {
      throw new Error(ERR_EMPTY_CHANGE_REASON);
    }
    // THE reject-at-write invariant — evaluated BEFORE any mutation lands (#2 deny, #3 log the reason).
    const bad = evaluateToolsAllowed(role, toolsAllowed, this.deps.classifier);
    if (bad) {
      this.deps.rejections?.logRejection(
        { role: bad.role, tool_id: bad.tool_id, tool_class: bad.tool_class, reason: bad.reason, actor_id: actorId },
        now,
      );
      throw new ForbiddenCapabilityGrant(bad);
    }
    const next: SpecialistDef = {
      ...cur,
      tools_allowed: [...toolsAllowed],
      version: cur.version + 1,
      change_reason,
      updated_at: new Date(now * 1000).toISOString(),
    };
    this.defs.set(role, next);
    return { ...next, tools_allowed: [...next.tools_allowed] };
  }
}
