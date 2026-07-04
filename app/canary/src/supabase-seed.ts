// SupabaseSeed — the LIVE `CanarySeedStore` adapter (FR-10.PRV.003 live half).
//
// The two-party AF-004 companion to the in-memory fake in port.ts. It does the two things that can
// ONLY be proven against real infra: (1) real OpenAI `text-embedding-3-small` embeddings, and
// (2) idempotent upserts into the canary's own Supabase (PostgREST, service_role) with
// ON CONFLICT DO NOTHING on the natural keys (id / idempotency_key) — so a re-seed is a no-op.
//
// Keys are read from the process env by the caller (seed-live.ts) and passed in here — never held on
// disk. In the deployment (and via `railway run` this session) they come from the deployment's env:
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY. seed.ts (seedCanary) still owns the
// existence-check-then-insert idempotency + the fail-loud CanarySeedError; this adapter is pure I/O.

import type { EntityRow, MemoryRow, MessageRow } from "./fixture.ts";
import { EMBED_DIMS, type CanarySeedStore } from "./port.ts";

export interface SupabaseSeedConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  openaiApiKey: string;
  /** injectable for tests; defaults to global fetch (Node ≥18). */
  fetchImpl?: typeof fetch;
  embeddingModel?: string;
}

/** Loud failure carrying the HTTP context — seedCanary wraps this in a typed CanarySeedError. */
export class SupabaseSeedHttpError extends Error {
  constructor(what: string, status: number, body: string) {
    super(`${what} → HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "SupabaseSeedHttpError";
  }
}

export class SupabaseSeed implements CanarySeedStore {
  private readonly rest: string;
  private readonly key: string;
  private readonly openaiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly model: string;

  constructor(cfg: SupabaseSeedConfig) {
    this.rest = `${cfg.supabaseUrl.replace(/\/$/, "")}/rest/v1`;
    this.key = cfg.serviceRoleKey;
    this.openaiKey = cfg.openaiApiKey;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.model = cfg.embeddingModel ?? "text-embedding-3-small";
  }

  private authHeaders(): Record<string, string> {
    return { apikey: this.key, Authorization: `Bearer ${this.key}` };
  }

  /** GET count via PostgREST; true if ≥1 row matches the filter. */
  private async exists(table: string, filter: string): Promise<boolean> {
    const res = await this.fetchImpl(`${this.rest}/${table}?${filter}&select=id&limit=1`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new SupabaseSeedHttpError(`exists ${table}`, res.status, await res.text());
    const rows = (await res.json()) as unknown[];
    return rows.length > 0;
  }

  /** POST an insert with ON CONFLICT DO NOTHING (Prefer: resolution=ignore-duplicates). */
  private async insert(table: string, row: unknown, onConflict?: string): Promise<void> {
    const q = onConflict ? `?on_conflict=${onConflict}` : "";
    const res = await this.fetchImpl(`${this.rest}/${table}${q}`, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new SupabaseSeedHttpError(`insert ${table}`, res.status, await res.text());
  }

  // ── embeddings (real OpenAI) ──
  async embed(text: string): Promise<number[]> {
    const res = await this.fetchImpl("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) throw new SupabaseSeedHttpError("openai embeddings", res.status, await res.text());
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    const embedding = json.data?.[0]?.embedding;
    if (!embedding || embedding.length !== EMBED_DIMS) {
      throw new Error(`OpenAI returned ${embedding?.length ?? "no"}-dim embedding, expected ${EMBED_DIMS}`);
    }
    return embedding;
  }

  // ── entities ──
  async hasEntity(id: string): Promise<boolean> {
    return this.exists("entities", `id=eq.${id}`);
  }
  async insertEntity(e: EntityRow): Promise<void> {
    await this.insert("entities", {
      id: e.id,
      type: e.type,
      name: e.name,
      is_internal_org: e.isInternalOrg,
    });
  }

  // ── messages (comms corpus) ──
  async hasMessage(id: string): Promise<boolean> {
    return this.exists("messages", `id=eq.${id}`);
  }
  async insertMessage(m: MessageRow): Promise<void> {
    await this.insert("messages", {
      id: m.id,
      channel: m.channel,
      from_entity_id: m.fromEntityId,
      subject: m.subject,
      body: m.body,
      entity_ids: m.entityIds,
    });
  }

  // ── memories (embedding written at seed time) ──
  async hasMemory(idempotencyKey: string): Promise<boolean> {
    return this.exists("memories", `idempotency_key=eq.${idempotencyKey}`);
  }
  async insertMemory(m: MemoryRow, embedding: number[]): Promise<void> {
    if (embedding.length !== EMBED_DIMS) {
      throw new Error(`embedding for ${m.id} is ${embedding.length}-dim, expected ${EMBED_DIMS}`);
    }
    await this.insert(
      "memories",
      {
        id: m.id,
        type: m.type,
        content: m.content,
        embedding: `[${embedding.join(",")}]`, // pgvector text literal
        embedding_model: this.model,
        entity_ids: m.entityIds,
        source: m.source,
        confidence: m.confidence,
        visibility: m.visibility,
        sensitivity: m.sensitivity,
        idempotency_key: m.idempotencyKey,
      },
      "idempotency_key",
    );
  }
}
