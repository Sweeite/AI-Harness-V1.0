// Thin shared-type module so retention.ts depends on the writer/store SHAPES without a circular import of
// the concrete EventWriter (which itself imports store/redact). Re-exports the store port; declares the
// minimal writer surface the retention/erasure jobs use.

export type { EventLogStore } from "./store.ts";
import type { EventLogInput } from "./types.ts";
import type { WriteResult } from "./event-writer.ts";

/** The subset of EventWriter the retention/erasure jobs call — write() only. */
export interface EventWriterLike {
  write(input: EventLogInput): Promise<WriteResult>;
}
