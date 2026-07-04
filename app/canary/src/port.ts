// The `CanarySeedStore` port — every live side effect of seeding the synthetic client (Supabase
// inserts + the OpenAI embedding call) goes through here, so seed.ts stays testable with NO live
// infra. The in-memory fake proves determinism + idempotency now; the LIVE adapter (SupabaseSeed,
// which embeds via OpenAI and writes the canary's Supabase) is the two-party step — TODO below.

import type { EntityRow, MemoryRow, MessageRow } from "./fixture.ts";

export const EMBED_DIMS = 1536; // text-embedding-3-small (schema: vector(1536) not null)

export interface CanarySeedStore {
  // existence checks make every insert idempotent (re-seed converges — AC-NFR-INF.006.1 posture)
  hasEntity(id: string): Promise<boolean>;
  insertEntity(e: EntityRow): Promise<void>;

  hasMessage(id: string): Promise<boolean>;
  insertMessage(m: MessageRow): Promise<void>;

  hasMemory(idempotencyKey: string): Promise<boolean>;
  /** 1536-dim vector; live adapter calls OpenAI, the fake returns a deterministic stub. */
  embed(text: string): Promise<number[]>;
  insertMemory(m: MemoryRow, embedding: number[]): Promise<void>;
}

/**
 * In-memory fake for the build-time tests. Deterministic embed (a content-seeded pseudo-vector, so
 * two runs of the same corpus produce identical vectors — no network, no randomness). Fault
 * injection (`failOn`) lets a test prove the seed fails LOUD on a partial insert (#3).
 */
export class InMemorySeedStore implements CanarySeedStore {
  entities = new Map<string, EntityRow>();
  messages = new Map<string, MessageRow>();
  memories = new Map<string, { row: MemoryRow; embedding: number[] }>(); // keyed by idempotencyKey
  readonly calls: string[] = [];

  /** if set, the named insert method throws once — simulates a transient partial failure. */
  failOnce: string | null = null;

  private maybeFail(step: string) {
    if (this.failOnce === step) {
      this.failOnce = null;
      throw new Error(`injected failure at ${step}`);
    }
  }

  async hasEntity(id: string) {
    return this.entities.has(id);
  }
  async insertEntity(e: EntityRow) {
    this.calls.push(`insertEntity:${e.id}`);
    this.maybeFail("insertEntity");
    this.entities.set(e.id, e);
  }
  async hasMessage(id: string) {
    return this.messages.has(id);
  }
  async insertMessage(m: MessageRow) {
    this.calls.push(`insertMessage:${m.id}`);
    this.maybeFail("insertMessage");
    this.messages.set(m.id, m);
  }
  async hasMemory(idempotencyKey: string) {
    return this.memories.has(idempotencyKey);
  }
  async embed(text: string) {
    // deterministic pseudo-embedding: FNV-seeded, unit-ish values in [-1, 1). NOT semantic — the
    // live adapter's OpenAI vectors are what real retrieval uses; this only satisfies not-null shape.
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    const v = new Array<number>(EMBED_DIMS);
    for (let i = 0; i < EMBED_DIMS; i++) {
      h ^= (h << 13) >>> 0;
      h = (h ^ (h >>> 17)) >>> 0;
      h = (h ^ (h << 5)) >>> 0;
      v[i] = ((h >>> 0) / 0xffffffff) * 2 - 1;
    }
    return v;
  }
  async insertMemory(m: MemoryRow, embedding: number[]) {
    this.calls.push(`insertMemory:${m.id}`);
    this.maybeFail("insertMemory");
    if (embedding.length !== EMBED_DIMS) {
      throw new Error(`embedding for ${m.id} is ${embedding.length}-dim, expected ${EMBED_DIMS}`);
    }
    this.memories.set(m.idempotencyKey, { row: m, embedding });
  }
}

// TODO(AF-004 / two-party): SupabaseSeed implements CanarySeedStore against the canary's own
// Supabase (service_role) — embed() calls OpenAI text-embedding-3-small, insert*() upsert with
// ON CONFLICT DO NOTHING on the natural keys (id / idempotency_key) so a re-seed is a no-op.
// Built alongside RailwayInfra in the live provisioning session; needs the C0/C1 seed schema.
