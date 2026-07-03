/**
 * CostLedger — the runnable analog of the running cost meter (schema.md §8: event_log
 * aggregation, no separate cost table). Every vendor call appends a CallCost; the ledger
 * rolls them up per-vendor and per-phase so the evidence block (report.ts) can show the
 * memory-write shape (AF-043) separately from the task shape.
 *
 * cost_unknown is tracked, never swallowed: if ANY call could not be costed, the totals carry
 * a `hasUnknown` flag so a reader can never mistake an incomplete measurement for a cheap one
 * (non-negotiable #3 — never fail silently).
 */
import type { CallCost } from './pricing.js';

export type Phase = 'task' | 'memory-write';

export interface VendorRollup {
  vendor: string;
  model: string;
  calls: number;
  attempts: number; // incl. retries
  inputTokens: number;
  outputTokens: number;
  usd: number;
  unknownCalls: number;
}

export class CostLedger {
  private readonly entries: Array<CallCost & { phase: Phase; label: string }> = [];

  record(phase: Phase, label: string, cost: CallCost): void {
    this.entries.push({ ...cost, phase, label });
  }

  all(): ReadonlyArray<CallCost & { phase: Phase; label: string }> {
    return this.entries;
  }

  /** Roll up by vendor+model, optionally filtered to one phase. */
  rollup(phase?: Phase): VendorRollup[] {
    return this.rollupWhere((e) => (phase ? e.phase === phase : true));
  }

  /** Roll up by vendor+model over entries matching an arbitrary predicate (e.g. one event id). */
  rollupWhere(pred: (e: CallCost & { phase: Phase; label: string }) => boolean): VendorRollup[] {
    const rows = this.entries.filter(pred);
    const byKey = new Map<string, VendorRollup>();
    for (const e of rows) {
      const key = `${e.vendor}/${e.model}`;
      const r = byKey.get(key) ?? {
        vendor: e.vendor,
        model: e.model,
        calls: 0,
        attempts: 0,
        inputTokens: 0,
        outputTokens: 0,
        usd: 0,
        unknownCalls: 0,
      };
      r.calls += 1;
      r.attempts += e.attempts;
      r.inputTokens += e.inputTokens;
      r.outputTokens += e.outputTokens;
      r.usd += e.usd;
      if (e.costUnknown) r.unknownCalls += 1;
      byKey.set(key, r);
    }
    return [...byKey.values()].sort((a, b) => b.usd - a.usd);
  }

  totalUsd(phase?: Phase): number {
    return this.rollup(phase).reduce((s, r) => s + r.usd, 0);
  }

  hasUnknown(): boolean {
    return this.entries.some((e) => e.costUnknown);
  }

  /** Count of Sonnet vs Haiku calls in a phase — the memory-write-shape evidence (AF-043). */
  callShape(phase: Phase): { sonnet: number; haiku: number; embedding: number } {
    const rows = this.entries.filter((e) => e.phase === phase);
    return {
      sonnet: rows.filter((e) => e.model === 'sonnet').length,
      haiku: rows.filter((e) => e.model === 'haiku').length,
      embedding: rows.filter((e) => e.model === 'text-embedding-3-small').length,
    };
  }
}
