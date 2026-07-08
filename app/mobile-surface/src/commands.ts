// ISSUE-079 — the mobile command surface: the no-back-door dispatch gate + the tap-optimised command menu.
//
// The invariant (NFR-SEC.013): a command invoked from mobile — whether typed `/slug`, tapped in the quick menu,
// or acted from an inline suggestion — runs the IDENTICAL node gate + C6 pipeline as desktop. There is no
// shortcut that bypasses the gate (#2). The ordering is load-bearing:
//   1. node gate FIRST (FR-9.CMD.002) — an unauthorised caller is DENIED before anything else. A command with
//      no mapped node is denied (AC-9.CMD.002.3), never run under an implicit allow.
//   2. destructive-confirm is NEVER the sole barrier (FR-9.CMD.003.3) — the gate runs BEFORE the confirm, so a
//      denied caller never even sees the confirm dialog (AC-NFR-SEC.013.2).
//   3. audit-critical commands FAIL CLOSED on a log failure (FR-9.CMD.004.3) — if the event_log write throws,
//      the side effect does NOT run (#3): we do not act-then-fail-to-record.
// The actual C6 guardrail pipeline + the command catalog are owned by C9/C6 (ISSUE-072/056); this package owns
// the mobile ENTRY discipline that must not diverge from desktop.

import { type MobileSurfaceStore, MobileError, ERR_AUDIT_LOG_FAILED } from "./store.ts";

export type Invocation = "typed_slash" | "quick_tap" | "inline_suggestion";

export interface CommandDef {
  slug: string;
  /** The PERM node this command maps to. null = NO mapped node → always denied (AC-9.CMD.002.3). */
  node: string | null;
  destructive: boolean; // requires a confirm — AFTER the gate, never instead of it
  auditCritical: boolean; // the event_log write must succeed or the command fails closed (FR-9.CMD.004.3)
  common: boolean; // eligible for the quick-tap menu (C9 owns "common")
}

export interface CallerContext {
  userId: string;
  /** The nodes the caller holds (from C1 — the SAME resolution as desktop). */
  heldNodes: ReadonlySet<string>;
}

export type DispatchResult =
  | { outcome: "denied"; reason: string } // node gate failed OR no mapped node — before any confirm
  | { outcome: "needs_confirm"; slug: string } // gate passed; a destructive command awaits explicit confirm
  | { outcome: "ran"; slug: string }
  | { outcome: "failed_closed"; reason: string }; // audit log failed → side effect NOT run (#3)

/** The pure node gate — used identically by dispatch and by the quick-tap menu's visibility filter. */
export function nodePermitted(cmd: CommandDef, caller: CallerContext): boolean {
  if (cmd.node === null) return false; // no mapped node ⇒ denied (AC-9.CMD.002.3), never an implicit allow
  return caller.heldNodes.has(cmd.node);
}

/**
 * Dispatch a command from ANY mobile entry point. `confirmed` is the destructive-confirm signal (the gate has
 * already run for the caller who saw the confirm — but we re-gate here so the confirm is never the sole
 * barrier). `runSideEffect` performs the actual C6-piped action; it runs ONLY after the gate passes, the
 * confirm (if destructive) is satisfied, and — for audit-critical commands — the event_log write succeeds.
 */
export async function dispatchCommand(
  store: MobileSurfaceStore,
  cmd: CommandDef,
  caller: CallerContext,
  invocation: Invocation,
  opts: { confirmed?: boolean; runSideEffect: () => Promise<void> },
): Promise<DispatchResult> {
  // 1. Node gate FIRST — identical for typed_slash / quick_tap / inline_suggestion (NFR-SEC.013, no bypass).
  if (!nodePermitted(cmd, caller)) {
    return {
      outcome: "denied",
      reason:
        cmd.node === null
          ? `command '${cmd.slug}' has no mapped PERM node — denied (AC-9.CMD.002.3)`
          : `caller lacks '${cmd.node}' for '${cmd.slug}' — denied before confirm (AC-NFR-SEC.013.2)`,
    };
  }

  // 2. Destructive-confirm AFTER the gate — never the sole barrier (FR-9.CMD.003.3).
  if (cmd.destructive && opts.confirmed !== true) {
    return { outcome: "needs_confirm", slug: cmd.slug };
  }

  // 3. Audit-critical commands: the event_log write must land BEFORE the side effect (fail-closed, #3).
  if (cmd.auditCritical) {
    try {
      await store.appendEventLog({
        eventType: "tool_called",
        entityIds: [],
        summary: `mobile command /${cmd.slug} dispatched (${invocation})`,
        payload: { slug: cmd.slug, invocation, user_id: caller.userId, node: cmd.node },
      });
    } catch (e) {
      // The audit write failed → do NOT run the side effect (act-then-lose-audit is a #3 violation).
      const reason = e instanceof MobileError && e.code === ERR_AUDIT_LOG_FAILED ? e.message : String(e);
      return { outcome: "failed_closed", reason: `audit log failed for '${cmd.slug}' — command not run (#3): ${reason}` };
    }
  }

  await opts.runSideEffect();
  return { outcome: "ran", slug: cmd.slug };
}

/**
 * FR-9.CMD.005 / AC-9.CMD.005.1 — the quick-tap menu shows the most common commands the caller is
 * node-PERMITTED for; a command the caller lacks the node for is omitted (never shown-then-denied). If the
 * permitted set can't be resolved the caller falls back to the `/` picker (handled by the shell). Every quick
 * command dispatches through the SAME `dispatchCommand` gate as typing `/slug` — the menu is not a bypass (#2).
 */
export function quickTapMenu(catalog: readonly CommandDef[], caller: CallerContext): CommandDef[] {
  return catalog.filter((c) => c.common && nodePermitted(c, caller));
}
