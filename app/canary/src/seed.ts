// Idempotent seed of the synthetic canary client (FR-10.PRV.003 corpus provisioning).
//
// Boots the fixed corpus into the canary's store deterministically. Every step checks existence
// first and skips if already present, so a re-seed converges to the same state and re-applies
// nothing (AC-NFR-INF.006.1 posture, applied to the canary). Any store failure propagates LOUD —
// a partial seed never passes silently (#3). The smoke-battery assertions are NOT run here (C2/C5/C8).

import type { CanaryCorpus } from "./fixture.ts";
import type { CanarySeedStore } from "./port.ts";

export interface SeedReport {
  inserted: { entities: number; messages: number; memories: number };
  skipped: { entities: number; messages: number; memories: number };
}

export class CanarySeedError extends Error {
  constructor(
    readonly step: string,
    readonly id: string,
    cause: unknown,
  ) {
    super(`canary seed failed at ${step} (${id}): ${cause instanceof Error ? cause.message : cause}`);
    this.name = "CanarySeedError";
  }
}

export async function seedCanary(corpus: CanaryCorpus, store: CanarySeedStore): Promise<SeedReport> {
  const report: SeedReport = {
    inserted: { entities: 0, messages: 0, memories: 0 },
    skipped: { entities: 0, messages: 0, memories: 0 },
  };

  // Entities first — memories/messages reference them (referential order matters for the live DB).
  for (const e of corpus.entities) {
    try {
      if (await store.hasEntity(e.id)) {
        report.skipped.entities++;
        continue;
      }
      await store.insertEntity(e);
      report.inserted.entities++;
    } catch (cause) {
      throw new CanarySeedError("entity", e.id, cause);
    }
  }

  for (const m of corpus.messages) {
    try {
      if (await store.hasMessage(m.id)) {
        report.skipped.messages++;
        continue;
      }
      await store.insertMessage(m);
      report.inserted.messages++;
    } catch (cause) {
      throw new CanarySeedError("message", m.id, cause);
    }
  }

  for (const mem of corpus.memories) {
    try {
      if (await store.hasMemory(mem.idempotencyKey)) {
        report.skipped.memories++;
        continue;
      }
      const embedding = await store.embed(mem.content); // live: OpenAI; fake: deterministic stub
      await store.insertMemory(mem, embedding);
      report.inserted.memories++;
    } catch (cause) {
      throw new CanarySeedError("memory", mem.id, cause);
    }
  }

  return report;
}
