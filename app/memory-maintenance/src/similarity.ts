// ISSUE-027 (C2 MNT) — cosine similarity for the merge / duplicate-cluster scans (the maintenance analogue of the
// HNSW vector arm; over the ≤20-user hot set an in-process all-pairs scan is cheap, cf. AF-019). Mirrors
// app/retrieval's cosineSimilarity 1:1 so the merge threshold means the same thing offline and live.

/** cosine similarity in [-1,1]; 0 for a zero-magnitude vector (degenerate — never NaN, #3). */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
