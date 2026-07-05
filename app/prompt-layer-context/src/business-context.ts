// ISSUE-044 §8 steps 2-4 — the Layer-2 assembly facade. Ties the shared-block invariant (FR-4.BIZ.001),
// the static/dynamic split (FR-4.BIZ.002), and the dynamic-field value source + staleness rule
// (FR-4.BIZ.003) into the thing ISSUE-053 calls at assembly. This slice OWNS the field declaration + the
// value-store semantics + the staleness rule; ISSUE-053 performs the assembly-time read (it calls this).

import {
  Layer2Classification,
  resolveDynamicField,
  type ResolvedDynamicField,
} from './context.ts';
import type { ContentStore } from './store.ts';
import type { DynamicFieldStore } from './store.ts';

/** The name of the single shared Layer-2 `business` record per deployment (one record, all agents). */
export const BUSINESS_LAYER_NAME = 'deployment_business_context';

export interface BusinessContextDeps {
  content: ContentStore;
  dynamicValues: DynamicFieldStore;
  classification: Layer2Classification;
  /** `dynamic_field_freshness_threshold`, in seconds. */
  freshnessThresholdSeconds: number;
}

/** The resolved Layer-2 for one assembly: the shared static content + each declared dynamic field resolved. */
export interface AssembledLayer2 {
  /** The shared business record's content (static baseline), or null if none authored yet. */
  static_content: string | null;
  /** id/version of the business record used (proves the SAME record is read for every agent). */
  business_version_id: string | null;
  business_version: number | null;
  /** Each declared dynamic field, resolved from the operator-editable store at assembly. */
  dynamic: ResolvedDynamicField[];
  /** The dynamic fields whose staleness must be surfaced to the operator (required, AC-4.BIZ.003.3). */
  stale: ResolvedDynamicField[];
  /** The declared dynamic fields with no value set — the observable gap (AC-4.BIZ.003.2). */
  unset: ResolvedDynamicField[];
}

export class BusinessContextService {
  constructor(private readonly deps: BusinessContextDeps) {}

  /**
   * Assemble Layer 2 for a given assembly moment. Because the `business` record is keyed only by
   * (layer='business', name=BUSINESS_LAYER_NAME) with agent_id=null, EVERY agent in the deployment reads
   * the exact same record — the shared-block invariant (AC-4.BIZ.001.1). The dynamic fields are read fresh
   * from the operator-editable store at THIS call (AC-4.BIZ.003.1), not baked from static config.
   */
  async assemble(now: number): Promise<AssembledLayer2> {
    const rec = await this.deps.content.currentVersion({ layer: 'business', name: BUSINESS_LAYER_NAME });

    const dynamic: ResolvedDynamicField[] = [];
    for (const field of this.deps.classification.dynamicFields()) {
      const stored = await this.deps.dynamicValues.read(field);
      dynamic.push(resolveDynamicField(field, stored, this.deps.freshnessThresholdSeconds, now));
    }

    return {
      static_content: rec?.content ?? null,
      business_version_id: rec?.id ?? null,
      business_version: rec?.version ?? null,
      dynamic,
      stale: dynamic.filter((d) => d.stale),
      unset: dynamic.filter((d) => d.state === 'unset'),
    };
  }
}
