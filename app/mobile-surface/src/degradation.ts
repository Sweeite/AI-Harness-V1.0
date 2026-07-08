// ISSUE-079 — the out-of-scope-on-mobile boundary (OD-152 / NFR-SEC.013 no back-door). Faithful to the
// design-doc "Deep system management stays on desktop" (L3284): every deep-management / high-blast-radius
// action degrades to an explicit "open on a wider display" NOTICE pointing at its desktop home — a NOTICE,
// never a silent omission (a missing control the user can't explain is itself a #3 failure). Gating these off
// mobile is the #2 protection: a mis-tap on a phone for a #1/#2 action is a real risk, better deferred than
// fat-fingered. The retained low-risk writes (Approve/Reject, disable, verify/flag, mark-actioned) are NOT
// here — they stay on mobile and run the identical node+C6 path.
//
// This catalog mirrors the surface-12 "Out of scope on mobile" table (each capability → its home surface); it
// is guarded for internal consistency by index.ts `check` (every capability names a non-empty desktop surface,
// no duplicates).

export interface DegradedCapability {
  capability: string;
  surface: string; // the desktop surface where it lives
  why: string;
}

/** OD-152 — the eight deep-management capabilities gated off mobile (surface-12 §"Out of scope on mobile"). */
export const DEGRADED_CAPABILITIES: readonly DegradedCapability[] = [
  { capability: "config_edit", surface: "surface-01", why: "a mis-set knob is high-blast-radius (#2); read-only on mobile" },
  { capability: "permission_matrix_edit", surface: "surface-02", why: "the matrix doesn't adapt < 768 px; read-only category list only" },
  { capability: "conflict_consolidation_resolution", surface: "surface-03", why: "a wrong tap is a #1/#2 memory event; comparison views need width" },
  { capability: "approval_modify", surface: "surface-04", why: "editing action params on a phone is a #2 risk (Approve/Reject stay)" },
  { capability: "fleet_actions", surface: "surface-06", why: "two-person deployment destruction is not a phone task" },
  { capability: "agent_capability_edit", surface: "surface-09", why: "a mis-set scope/tool grant is a #2 risk; disable stays (retains definition, #1)" },
  { capability: "custom_command_authoring", surface: "surface-10", why: "a mis-gated command is a #2 risk; disable stays" },
  { capability: "memory_mutation", surface: "surface-11", why: "a mis-issued correction/erasure is a #1/#2 action; verify/flag feedback stays" },
] as const;

const BY_CAP: ReadonlyMap<string, DegradedCapability> = new Map(
  DEGRADED_CAPABILITIES.map((d) => [d.capability, d]),
);

export function isDegradedOnMobile(capability: string): boolean {
  return BY_CAP.has(capability);
}

export interface DegradationNotice {
  degraded: true;
  capability: string;
  surface: string;
  message: string; // an explicit notice — never a silent omission
}

/**
 * OD-152 — return the "open on a wider display" notice for a deep-management action. Throws for a capability
 * that is NOT in the degraded set (a caller must not fabricate a notice for a retained action, nor silently
 * omit a real one — either way is a #3 inconsistency).
 */
export function degradeNotice(capability: string): DegradationNotice {
  const d = BY_CAP.get(capability);
  if (!d) {
    throw new Error(`'${capability}' is not a mobile-degraded capability — do not synthesise a notice for it`);
  }
  return {
    degraded: true,
    capability: d.capability,
    surface: d.surface,
    message: `This action lives on desktop — open on a wider display (${d.surface}). ${d.why}.`,
  };
}
