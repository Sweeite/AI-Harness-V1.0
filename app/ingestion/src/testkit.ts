// ISSUE-026 (C2 ING) — shared test helpers (NOT a *.test.ts, so it is not executed as a test file). Builds a wired
// ingestion stack over the in-memory reference fakes so every AC test starts from the same offline-green baseline.

import type { TaskAuthz } from '../../memory-write/src/commit.ts';
import type { WriteOutcome } from '../../memory-write/src/writer.ts';
import { DEFAULT_INGESTION_CONFIG, type IngestionConfig } from './config.ts';
import { defaultFilters, type Filters } from './filters.ts';
import { IngestionQueue } from './queue.ts';
import type { IngestDeps } from './ingest.ts';
import {
  InMemoryIngestionStore,
  InMemoryObservabilitySink,
  InMemoryVerificationSink,
  RecordingWriteGate,
  type WriteRoute,
} from './store.ts';

export interface Stack {
  store: InMemoryIngestionStore;
  observ: InMemoryObservabilitySink;
  verifier: InMemoryVerificationSink;
  gate: RecordingWriteGate;
  filters: Filters;
  config: IngestionConfig;
  queue: IngestionQueue;
  deps: IngestDeps;
}

/** A wired stack. `configOverrides` tweak the CFG; `outcome` customises what the sole-writer gate returns (e.g. to
 *  simulate committed memory ids for Pipeline 3, or a writer-side hold that must surface). */
export function makeStack(configOverrides: Partial<IngestionConfig> = {}, outcome?: (r: WriteRoute) => WriteOutcome): Stack {
  const store = new InMemoryIngestionStore();
  const observ = new InMemoryObservabilitySink();
  const verifier = new InMemoryVerificationSink();
  const gate = new RecordingWriteGate(outcome);
  const filters = defaultFilters();
  const config: IngestionConfig = { ...DEFAULT_INGESTION_CONFIG, ...configOverrides };
  const queue = new IngestionQueue({ store, gate, observ, config });
  const deps: IngestDeps = { queue, store, gate, filters, observ, config };
  return { store, observ, verifier, gate, filters, config, queue, deps };
}

export function taskAuthz(over: Partial<TaskAuthz> = {}): TaskAuthz {
  return {
    taskId: 'task-1',
    serviceRoleIdentity: 'memory-agent',
    originatingUserId: 'user-1',
    reliedOn: { clearances: [], restricted: [] },
    ...over,
  };
}

/** A committed outcome carrying synthetic memory ids (for Pipeline 3's awaiting-verification surfacing). */
export function committedWith(ids: string[]): (r: WriteRoute) => WriteOutcome {
  return () => ({
    kind: 'committed',
    results: ids.map((id) => ({ status: 'committed' as const, memoryId: id, superseded: [], conflictId: null, rewrote: false })),
  });
}
