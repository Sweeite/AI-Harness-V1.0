// ISSUE-079 — FR-7.VIEW.003 the mobile web-push contract (the ROUTING + the registration truthfulness).
// The delivery MECHANISM (web-push service worker / APNs / FCM) is a Phase-5 paper-vs-proven note (surface-12
// Feasibility) — NOT modelled here; this owns the platform-agnostic routing contract (OD-150) + the honest
// "push enabled" signal. The record is ALWAYS the in-app notification centre (FR-7.ALR.006) — a push is a
// delivery, never the record, so a dropped push loses nothing (#1).

import {
  type MobileSurfaceStore,
  type PushSubscriptionInput,
  MobileError,
  ERR_PUSH_REGISTRATION_FAILED,
} from "./store.ts";

// ── delivery classes (surface-12 Push table / design-doc L3277–3281) ──────────────────────────────
export const PUSH_CLASSES = ["critical", "hard_limit", "pending_approval", "stale_approval_queue"] as const;
export type PushClass = (typeof PUSH_CLASSES)[number];

/** The always-immediate, NEVER-user-suppressible classes (AC-7.VIEW.003.1, pairs with AC-7.ALR.002.2). */
export const NON_SUPPRESSIBLE_CLASSES: readonly PushClass[] = ["critical", "hard_limit"] as const;

export type PushTiming =
  | { kind: "immediate"; suppressible: false }
  | { kind: "configurable"; suppressible: true; configKey: string };

/** Config keys that drive the two configurable classes (config-registry: both LIVE, read-only on mobile). */
export const CFG_APPROVAL_PUSH_FREQUENCY_MINUTES = "approval_push_frequency_minutes";
export const CFG_STALE_QUEUE_PUSH_HOURS = "stale_queue_push_hours";

/**
 * FR-7.VIEW.003 routing. Critical + hard-limit fire immediately and are non-suppressible; pending/stale
 * approvals fire at the configured frequency. There is no silent default: an unknown class throws (#3) rather
 * than fall through to a quiet "immediate" or "never".
 */
export function classifyPush(cls: PushClass): PushTiming {
  switch (cls) {
    case "critical":
    case "hard_limit":
      return { kind: "immediate", suppressible: false };
    case "pending_approval":
      return { kind: "configurable", suppressible: true, configKey: CFG_APPROVAL_PUSH_FREQUENCY_MINUTES };
    case "stale_approval_queue":
      return { kind: "configurable", suppressible: true, configKey: CFG_STALE_QUEUE_PUSH_HOURS };
    default: {
      const _exhaustive: never = cls;
      throw new Error(`unknown push class '${_exhaustive}' — routing must not silently default (#3)`);
    }
  }
}

/** A user cannot suppress critical/hard-limit even if they try (#3 guarantee — AC-7.VIEW.003.1). */
export function isSuppressible(cls: PushClass): boolean {
  return classifyPush(cls).suppressible;
}

// ── registration truthfulness (#3) ───────────────────────────────────────────────────────────────
export type PushEnabledState =
  | { enabled: true; subscriptionId: string }
  | { enabled: false; reason: string }; // renders "push not enabled" — NEVER a false "on"

/**
 * Register this device/browser and return the HONEST enabled-state. A registration that throws (push service
 * down, no endpoint, DB write failed) resolves to { enabled:false } — the caller shows "push not enabled",
 * never a silent "on" (surface-12 Phase-4 note, #3). It does NOT re-throw: a failed push registration is a
 * degraded-but-safe state (the in-app centre still records everything), not a crash.
 */
export async function registerPush(
  store: MobileSurfaceStore,
  input: PushSubscriptionInput,
): Promise<PushEnabledState> {
  try {
    const row = await store.registerPushSubscription(input);
    if (!row.endpoint) {
      // Defence in depth: a "successful" row with no endpoint is still NOT enabled (#3).
      return { enabled: false, reason: "registration returned no endpoint" };
    }
    return { enabled: true, subscriptionId: row.id };
  } catch (e) {
    const reason =
      e instanceof MobileError && e.code === ERR_PUSH_REGISTRATION_FAILED ? e.message : `registration failed: ${String(e)}`;
    return { enabled: false, reason };
  }
}

/** The Settings-sheet reflection of the two LIVE config values (read-only on mobile; edited on surface-01). */
export interface PushSettingsView {
  approvalPushFrequencyMinutes: number;
  staleQueuePushHours: number;
  nonSuppressible: readonly PushClass[]; // shown so the user knows critical/hard-limit can't be turned off
}

export function pushSettingsView(approvalFreqMin: number, staleHours: number): PushSettingsView {
  return {
    approvalPushFrequencyMinutes: approvalFreqMin,
    staleQueuePushHours: staleHours,
    nonSuppressible: NON_SUPPRESSIBLE_CLASSES,
  };
}
