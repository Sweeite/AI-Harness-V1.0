// ISSUE-047 step 2 — the config-defined trigger registry (FR-5.TRG.002 / AC-5.TRG.002.1).
//
// Trigger definitions (conditions, schedules, enablement) live in DEPLOYMENT CONFIG, not code. At boot the
// registry is built FROM config; a new trigger is added, and any trigger enabled/disabled per deployment,
// WITHOUT a code change. A trigger marked `enabled:false` is registered-but-inert — it creates no tasks.
//
// This mirrors app/config-store's config-driven-at-boot posture (FR-5.LOP.002 / FR-5.TRG.002). The registry
// itself is pure data + a boot builder; the dispatch decision (is this trigger allowed to fire?) is a lookup.

import { isTaskType, type TaskType } from './store.ts';

/** One trigger definition, as it appears in deployment config. `key` is the config-unique trigger name. */
export interface TriggerDef {
  key: string;
  type: TaskType; // which of the four trigger types this definition fires as
  enabled: boolean; // per-deployment enable/disable, no code change
  /** Free-form config the trigger carries (event filter / cron schedule / etc.) — opaque to this slice. */
  config?: Record<string, unknown>;
}

/** Raised when config is malformed — a bad definition MUST fail loud at boot, never be silently skipped (#3). */
export class RegistryError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

export class TriggerRegistry {
  private byKey = new Map<string, TriggerDef>();

  private constructor(defs: TriggerDef[]) {
    for (const d of defs) {
      if (!d.key || d.key.trim() === '') {
        throw new RegistryError('bad_key', 'a trigger definition has an empty key');
      }
      if (this.byKey.has(d.key)) {
        // A duplicate key is a config error — do NOT silently let the last write win (#3).
        throw new RegistryError('duplicate_key', `duplicate trigger key '${d.key}' in deployment config`);
      }
      if (!isTaskType(d.type)) {
        throw new RegistryError('bad_type', `trigger '${d.key}' has invalid type '${d.type}'`);
      }
      this.byKey.set(d.key, { ...d, config: d.config ? { ...d.config } : undefined });
    }
  }

  /** Build the registry FROM deployment config at boot (FR-5.TRG.002) — the ONLY constructor. No code path
   *  hardcodes a trigger; adding one is a config edit + reboot. */
  static fromConfig(defs: TriggerDef[]): TriggerRegistry {
    return new TriggerRegistry(defs);
  }

  get(key: string): TriggerDef | null {
    return this.byKey.get(key) ?? null;
  }

  /** Is this trigger active (defined AND enabled)? An unknown OR disabled trigger is NOT active — it fires
   *  nothing (AC-5.TRG.002.1). */
  isActive(key: string): boolean {
    const d = this.byKey.get(key);
    return !!d && d.enabled;
  }

  all(): TriggerDef[] {
    return [...this.byKey.values()].map((d) => ({ ...d }));
  }
  activeCount(): number {
    return this.all().filter((d) => d.enabled).length;
  }
}
