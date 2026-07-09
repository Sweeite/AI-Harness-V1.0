// ISSUE-023 (C2 VEC) — FR-2.VEC.002: the embed-on-write STEP. Embed content with the single configured model
// (CFG-embedding_model, default text-embedding-3-small / 1536 dims), VALIDATE the produced vector, and stamp
// { embedding, embeddingModel } on the row. Dimension mismatches are detectable because the model name rides with
// every row (FR-2.VEC.002); a degenerate/wrong-dim vector is REJECTED (FR-2.MEM.002).
//
// BOUNDARY (Rule 0 — do not build 024's job here): the commit/halt-on-failure wrapper that routes a failed embed to
// the retryable write-failure queue with an alert (FR-2.WRT.007) is ISSUE-024's (the sole-writer path). THIS slice
// supplies the produce+validate the writer plugs in — it throws a TYPED EmbeddingError so 024 can catch it and halt
// the commit (never store a null/invalid embedding — #1/#3). It never itself decides to enqueue or commit.

export const EMBED_DIM = 1536; // vector(1536) — schema.md memories row / FR-2.MEM.002; the HNSW index is 1536-dim.
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'; // CFG-embedding_model default (REBUILD-class).

// Why an embed failed — the caller (ISSUE-024) branches on this to decide retry vs reject, but BOTH halt the commit.
//   provider_failure — error/timeout/rate-limit from the model call (a transient, retryable cause).
//   wrong_dim        — the provider returned a vector whose length != the active model's dimension.
//   degenerate       — a zero / non-finite / all-equal vector (cosine distance is undefined or meaningless on it).
export type EmbeddingErrorKind = 'provider_failure' | 'wrong_dim' | 'degenerate';

export class EmbeddingError extends Error {
  constructor(
    readonly kind: EmbeddingErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/** The external embedding provider (OpenAI via the AI SDK at deploy; a fake in tests). Returns the raw vector for
 * `content` under `model`. May throw/reject — the writer treats any rejection as a provider_failure (FR-2.WRT.007). */
export interface EmbeddingProvider {
  embed(content: string, model: string): Promise<number[]>;
}

/** A produced + validated embedding, ready for the writer to stamp on the memory row. */
export interface StampedEmbedding {
  embedding: number[];
  embeddingModel: string;
  dim: number;
}

/** Spend accounting (ADR-003 cost — OpenAI embeddings are counted). Injected; a no-op if the deployment does not wire
 * a meter. A model change re-embeds the whole corpus, so counting per call matters for the REBUILD cost estimate. */
export interface EmbeddingSpendMeter {
  countEmbedding(model: string, contentChars: number): void;
}

/**
 * Validate a raw vector against the active model. Pure — no I/O. This is the FR-2.MEM.002 gate that keeps a
 * null/garbage embedding out of the column (a bad vector is permanently invisible to the vector arm AND undetectable
 * by decay/erosion jobs which key on confidence/age, so it must be caught HERE + by the FR-2.MNT.010 backstop).
 * Throws EmbeddingError on any violation; returns the vector on success.
 */
export function validateEmbedding(vec: number[], model: string, expectedDim: number = EMBED_DIM): number[] {
  if (!Array.isArray(vec)) {
    throw new EmbeddingError('degenerate', `embeddings: provider returned a non-array embedding for model '${model}'`);
  }
  if (vec.length !== expectedDim) {
    throw new EmbeddingError(
      'wrong_dim',
      `embeddings: embedding dimension ${vec.length} != active model '${model}' dimension ${expectedDim} (FR-2.VEC.002) — rejected`,
    );
  }
  let sawNonZero = false;
  for (let i = 0; i < vec.length; i++) {
    const x = vec[i]!;
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      throw new EmbeddingError('degenerate', `embeddings: embedding component ${i} is not a finite number (got ${String(x)}) — rejected`);
    }
    if (x !== 0) sawNonZero = true;
  }
  // A zero vector has undefined cosine distance (0/0) — pgvector would treat it as equidistant to everything, so it is
  // silently unsearchable/mis-ranked. Reject it as degenerate (never commit it — the #1/#3 failure this guards).
  if (!sawNonZero) {
    throw new EmbeddingError('degenerate', `embeddings: embedding is the zero vector (undefined cosine distance) — rejected`);
  }
  return vec;
}

/**
 * Produce + validate + stamp an embedding for a memory write (FR-2.VEC.002). This is the step ISSUE-024's commit path
 * wraps. On ANY failure it throws a typed EmbeddingError:
 *   - the provider throws/rejects        → provider_failure (the retryable FR-2.WRT.007 case)
 *   - the vector is wrong-dim/degenerate → wrong_dim / degenerate (rejected, FR-2.MEM.002)
 * The caller MUST NOT commit a memory when this throws (#1). Spend is counted on a successful produce (ADR-003).
 */
export async function embedForWrite(
  content: string,
  provider: EmbeddingProvider,
  opts: { model?: string; expectedDim?: number; meter?: EmbeddingSpendMeter } = {},
): Promise<StampedEmbedding> {
  const model = opts.model ?? DEFAULT_EMBEDDING_MODEL;
  const expectedDim = opts.expectedDim ?? EMBED_DIM;

  let raw: number[];
  try {
    raw = await provider.embed(content, model);
  } catch (e) {
    // Wrap the provider fault as a typed, retryable failure — the writer routes the SOURCE EVENT to retry with an
    // alert (FR-2.WRT.007); a live task event is not trivially replayable, so it must be captured, not lost (#1).
    throw new EmbeddingError('provider_failure', `embeddings: model '${model}' embed call failed: ${errMsg(e)}`, e);
  }
  const embedding = validateEmbedding(raw, model, expectedDim);
  opts.meter?.countEmbedding(model, content.length);
  return { embedding, embeddingModel: model, dim: expectedDim };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
