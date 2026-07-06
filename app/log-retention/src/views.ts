// ISSUE-077 §8 step 7 — the five RBAC-gated dashboard DATA CONTRACTS (FR-7.VIEW.001–003). Data/signal wiring
// ONLY; all layout/visual state is Phase 3 (rendered by ISSUE-078/073/079). This slice guarantees each panel
// resolves to a producing-component FR (no C7-invented signal), scopes each role surface to C1 permissions,
// wires the answer-mode pill onto every AI-output item, and defines the mobile push-notification routing classes.

import type { AnswerMode, PushSubscriptionRow, TaskTerminalRow } from "./types.ts";
import { isAnswerMode } from "./types.ts";
import type { PushSubscriptionStore } from "./store.ts";

// ── FR-7.VIEW.001 — the operations dashboard panel → producing-component FR map ────────────────────────
//
// Each named panel has a DEFINED data source mapping to a PRODUCING component's FR — C7 does not invent a
// signal (AC-7.VIEW.001.1). This is the authoritative map; a panel with source_fr === null would be a
// C7-invented signal and is rejected by the check gate.
export interface PanelSource {
  panel: string;
  producing_component: string; // C2/C3/C5/C6/C7/C8/C9
  source_fr: string; // the producing FR — NEVER a C7 invention
  /** The C1 permission node a role must hold to see this panel (RBAC scope, FR-7.VIEW.002.1). */
  required_permission: string | null; // null ⇒ visible to any authenticated role
}

/** The operations-dashboard panel catalog (design L3207-3238). Every entry names its producing FR. */
export const OPS_DASHBOARD_PANELS: readonly PanelSource[] = [
  // system-health panel
  { panel: "loop_status", producing_component: "C5", source_fr: "FR-5.JOB.006", required_permission: "PERM-observability.view" },
  { panel: "queue_depth_trend", producing_component: "C5", source_fr: "FR-5.QUE.001", required_permission: "PERM-observability.view" },
  { panel: "success_rate_vs_threshold", producing_component: "C7", source_fr: "FR-7.ALR.004", required_permission: "PERM-observability.view" },
  { panel: "connector_status", producing_component: "C3", source_fr: "FR-3.CONN.005", required_permission: "PERM-observability.view" },
  { panel: "agent_health", producing_component: "C8", source_fr: "FR-8.AGT.006", required_permission: "PERM-observability.view" },
  // failure-health view
  { panel: "live_failure_feed", producing_component: "C7", source_fr: "FR-7.LOG.003", required_permission: "PERM-observability.view" },
  { panel: "silent_failure_indicators", producing_component: "C7", source_fr: "FR-7.LOG.003", required_permission: "PERM-observability.view" },
  { panel: "threshold_tracker", producing_component: "C7", source_fr: "FR-7.ALR.004", required_permission: "PERM-observability.view" },
  // memory-health view
  { panel: "erosion_risk", producing_component: "C2", source_fr: "FR-2.RET.007", required_permission: "PERM-memory.view" },
  { panel: "confidence_distribution", producing_component: "C2", source_fr: "FR-2.MAT.003", required_permission: "PERM-memory.view" },
  { panel: "coverage_by_entity", producing_component: "C2", source_fr: "FR-2.MAT.003", required_permission: "PERM-memory.view" },
  { panel: "maintenance_queue", producing_component: "C2", source_fr: "FR-2.MNT.001", required_permission: "PERM-memory.view" },
  // event log / DLQ / cost / guardrail views
  { panel: "event_log", producing_component: "C7", source_fr: "FR-7.LOG.001", required_permission: "PERM-observability.view" },
  { panel: "dead_letter_queue", producing_component: "C5", source_fr: "FR-5.JOB.006", required_permission: "PERM-observability.view" },
  { panel: "cost_tracking", producing_component: "C7", source_fr: "FR-7.COST.001", required_permission: "PERM-observability.view" },
  { panel: "guardrail_log", producing_component: "C6", source_fr: "FR-6.LOG.001", required_permission: "PERM-observability.view" },
  // self-improvement panel — displays C9 Insight suggestions; C7 does NOT generate them (AC-7.VIEW.001.3)
  { panel: "self_improvement", producing_component: "C9", source_fr: "FR-9.INS.001", required_permission: "PERM-observability.view" },
];

/** AC-7.VIEW.001.1 — assert every panel resolves to a producing-component FR (no C7-invented signal). A panel
 *  is a "C7 invention" only if it carries no source_fr at all; a legitimately C7-produced signal (e.g. the
 *  silent-failure indicator) still names a C7 FR and is fine. */
export function panelsWithoutProducer(panels: readonly PanelSource[] = OPS_DASHBOARD_PANELS): string[] {
  return panels.filter((p) => !p.source_fr || p.source_fr.trim() === "").map((p) => p.panel);
}

// ── FR-7.VIEW.001.2 — the silent-failure indicator, driven by the LOG.003 completeness gap ────────────
//
// A silent failure = a task that reached a TERMINAL task_queue status but has NO terminal event_log row
// (task_completed XOR task_failed). This slice DERIVES the indicator from that completeness gap — it does not
// invent the signal (the detector itself is ISSUE-011 LOG.003; here we surface its output on the panel).
export interface SilentFailureIndicator {
  task_id: string;
  task_status: "completed" | "failed";
  detail: string;
}

/** Given terminal task_queue rows and the set of task_ids that DO have a terminal event_log row, surface the
 *  tasks with a completeness gap (AC-7.VIEW.001.2). */
export function silentFailureIndicators(
  terminalTasks: readonly TaskTerminalRow[],
  taskIdsWithTerminalEvent: ReadonlySet<string>,
): SilentFailureIndicator[] {
  const out: SilentFailureIndicator[] = [];
  for (const t of terminalTasks) {
    if (!taskIdsWithTerminalEvent.has(t.task_id)) {
      out.push({
        task_id: t.task_id,
        task_status: t.status,
        detail: `task reached terminal status '${t.status}' but has NO terminal event_log row — a silent failure (LOG.003 gap)`,
      });
    }
  }
  return out;
}

// ── FR-7.VIEW.002 — RBAC-scoped role surfaces + the answer-mode pill ──────────────────────────────────

export type RoleSurface = "super_admin" | "operations" | "manager" | "standard_user" | "mobile";

/** A caller's C1 permission set (this slice CONSUMES C1's authority; it does not seed the catalog). */
export interface ViewerContext {
  role: RoleSurface;
  permissions: ReadonlySet<string>;
}

/** AC-7.VIEW.002.1 — return ONLY the panels a viewer's C1 permissions allow. An unpermitted panel is NOT
 *  rendered to it (filtered out, never leaked). null required_permission ⇒ visible to any authenticated role. */
export function panelsForViewer(viewer: ViewerContext, panels: readonly PanelSource[] = OPS_DASHBOARD_PANELS): PanelSource[] {
  return panels.filter((p) => p.required_permission === null || viewer.permissions.has(p.required_permission));
}

/** True IFF a specific panel is visible to this viewer (a convenience the check gate uses to prove an
 *  unpermitted signal is not rendered). */
export function canViewPanel(viewer: ViewerContext, panel: string, panels: readonly PanelSource[] = OPS_DASHBOARD_PANELS): boolean {
  return panelsForViewer(viewer, panels).some((p) => p.panel === panel);
}

// The answer-mode pill (C4 FR-4.CID.006) — rendered on EVERY AI-output item (AC-7.VIEW.002.2).
export interface ActivityItem {
  id: string;
  is_ai_output: boolean;
  answer_mode: AnswerMode | null; // C4-sourced; must be present on every AI-output item
  text: string;
}
export interface RenderedActivityItem extends ActivityItem {
  pill: AnswerMode | null; // the rendered pill; null ONLY for non-AI items
}

export class MissingAnswerModePill extends Error {
  constructor(itemId: string, reason: string) {
    super(`AI-output item ${itemId} is missing/invalid its answer-mode pill (${reason}) — AC-7.VIEW.002.2 (#3)`);
    this.name = "MissingAnswerModePill";
  }
}

/** Render an activity feed, attaching the answer-mode pill to EVERY AI-output item. An AI-output item WITHOUT a
 *  valid answer_mode fails LOUD (never rendered pill-less — an unlabelled AI output is a #3 trust hole). A
 *  non-AI item carries no pill. */
export function renderActivityFeed(items: readonly ActivityItem[]): RenderedActivityItem[] {
  return items.map((item) => {
    if (!item.is_ai_output) return { ...item, pill: null };
    if (item.answer_mode === null || !isAnswerMode(item.answer_mode)) {
      throw new MissingAnswerModePill(item.id, item.answer_mode === null ? "no answer_mode set" : `'${item.answer_mode}' not an answer_mode`);
    }
    return { ...item, pill: item.answer_mode };
  });
}

// ── FR-7.VIEW.003 — mobile push-notification routing contract ─────────────────────────────────────────

export type PushClass = "critical" | "hard_limit" | "pending_approval" | "stale_approval";

/** The routing decision for one push class (AC-7.VIEW.003.1/.2). */
export interface PushRouting {
  class: PushClass;
  immediate: boolean; // critical + hard_limit are immediate
  suppressible: boolean; // hard_limit is NEVER suppressible (AC-7.VIEW.003.1)
  frequency_configurable: boolean; // pending/stale approvals are per-deployment/user configurable (AC-7.VIEW.003.2)
}

/** The fixed routing contract per class. hard_limit is immediate + always (never suppressible); pending/stale
 *  approvals are configurable. */
export const PUSH_ROUTING: Record<PushClass, PushRouting> = {
  critical: { class: "critical", immediate: true, suppressible: false, frequency_configurable: false },
  hard_limit: { class: "hard_limit", immediate: true, suppressible: false, frequency_configurable: false },
  pending_approval: { class: "pending_approval", immediate: false, suppressible: true, frequency_configurable: true },
  stale_approval: { class: "stale_approval", immediate: false, suppressible: true, frequency_configurable: true },
};

/** Per-user configurable push frequencies (AC-7.VIEW.003.2). A hard_limit push ignores these entirely. */
export interface PushFrequencyPrefs {
  pending_approval_frequency_s: number;
  stale_approval_frequency_s: number;
}

export interface PushDecision {
  deliver: boolean;
  immediate: boolean;
  targets: PushSubscriptionRow[]; // the user's registered devices
  detail: string;
}

/** Decide how a push of `cls` routes to `userId`. A hard-limit push is ALWAYS delivered immediately and can
 *  never be suppressed by user prefs (AC-7.VIEW.003.1); pending/stale-approval pushes honour the configurable
 *  frequency (AC-7.VIEW.003.2). `suppressUserRequested` models a user who tried to mute — ignored for
 *  hard_limit/critical. */
export async function routeMobilePush(
  cls: PushClass,
  userId: string,
  subs: PushSubscriptionStore,
  opts: { suppressUserRequested?: boolean; dueByFrequency?: boolean } = {},
): Promise<PushDecision> {
  const routing = PUSH_ROUTING[cls];
  const targets = await subs.forUser(userId);

  if (!routing.suppressible) {
    // hard_limit / critical: immediate + always, regardless of any user suppression request.
    return {
      deliver: true,
      immediate: routing.immediate,
      targets,
      detail:
        routing.class === "hard_limit"
          ? "hard-limit push: immediate and NOT suppressible (AC-7.VIEW.003.1)"
          : "critical push: immediate",
    };
  }

  // pending/stale approvals: suppressible + frequency-gated (AC-7.VIEW.003.2).
  if (opts.suppressUserRequested) return { deliver: false, immediate: false, targets, detail: `${cls}: suppressed by user preference` };
  if (opts.dueByFrequency === false) return { deliver: false, immediate: false, targets, detail: `${cls}: not yet due per configured frequency` };
  return { deliver: true, immediate: false, targets, detail: `${cls}: delivered at configured frequency` };
}
