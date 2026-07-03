/**
 * The ADR-003 §4 memory-write path — the thing under measurement.
 *
 * Ordered pipeline (models per ADR-003 §4, lines 125–138):
 *   1. code-level noise filter  (NO model — empty/system/dedupe; non-survivors cost 0 here)
 *   2. Haiku selective-write gate  ("is this worth remembering?" — most events die here)
 *   3. Haiku contradiction pre-check   ] two more Haiku calls, survivors only
 *   4. Haiku sensitivity classifier    ]
 *   5. Sonnet writer  (the ONLY Sonnet call; exactly 1 per written memory)
 *   6. OpenAI embedding  (the memory vector — pgvector store)
 *
 * Cost shape asserted by the spike: a surviving write = 1 Sonnet + 3 Haiku + 1 embedding;
 * a non-surviving event = ≤1 Haiku, 0 Sonnet (AF-043 evidence).
 */
import { costOf, PRICE_TABLE } from './pricing.js';
import type { CostLedger } from './ledger.js';
import { callHaiku, callSonnet, embed } from './vendors.js';

export interface MemoryEvent {
  id: string;
  text: string;
}

export interface WriteOutcome {
  survived: boolean;
  diedAt: 'code-filter' | 'haiku-gate' | null;
}

/** Stage 1 — code-level noise filter. No model call. */
function codeFilter(event: MemoryEvent, seen: Set<string>): boolean {
  const t = event.text.trim();
  if (t.length < 12) return false; // trivially short
  if (/^(system:|ack|ok|thanks?)\b/i.test(t)) return false; // system echo / filler
  const norm = t.toLowerCase().replace(/\s+/g, ' ');
  if (seen.has(norm)) return false; // exact-dupe
  seen.add(norm);
  return true;
}

function isYes(text: string): boolean {
  return /\b(yes|keep|remember|store|worth|retain)\b/i.test(text) && !/\bno\b/i.test(text.slice(0, 12));
}

/**
 * Drive one event through the full write path, recording every vendor call to the ledger
 * under the 'memory-write' phase. Returns whether it survived and where it died.
 */
export async function writeMemory(
  event: MemoryEvent,
  ledger: CostLedger,
  seen: Set<string>,
): Promise<WriteOutcome> {
  // Stage 1 — code filter (free).
  if (!codeFilter(event, seen)) {
    return { survived: false, diedAt: 'code-filter' };
  }

  // Stage 2 — Haiku selective-write gate.
  const gate = await callHaiku(
    'You are a selective-memory gate. Answer with a single word — KEEP or DROP — for whether ' +
      'this event is a durable fact worth remembering long-term (names, decisions, preferences, ' +
      'commitments). Ephemeral chatter, acknowledgements, and one-off noise = DROP.',
    `Event: "${event.text}"\nKEEP or DROP?`,
    16,
  );
  ledger.record('memory-write', `gate:${event.id}`, costOf(PRICE_TABLE, 'anthropic', 'haiku', gate.inputTokens, gate.outputTokens, gate.attempts));
  if (!isYes(gate.text)) {
    return { survived: false, diedAt: 'haiku-gate' }; // 0 Sonnet — the common case
  }

  // Stage 3 — Haiku contradiction pre-check.
  const contra = await callHaiku(
    'You check whether a new memory contradicts existing knowledge. Reply CONTRADICTION or CLEAR.',
    `New memory: "${event.text}"\n(No prior memories loaded in this spike.) CONTRADICTION or CLEAR?`,
    16,
  );
  ledger.record('memory-write', `contradiction:${event.id}`, costOf(PRICE_TABLE, 'anthropic', 'haiku', contra.inputTokens, contra.outputTokens, contra.attempts));

  // Stage 4 — Haiku sensitivity classifier.
  const sens = await callHaiku(
    'Classify the sensitivity tier of this memory: PUBLIC, INTERNAL, or RESTRICTED. One word.',
    `Memory: "${event.text}"\nTier?`,
    16,
  );
  ledger.record('memory-write', `sensitivity:${event.id}`, costOf(PRICE_TABLE, 'anthropic', 'haiku', sens.inputTokens, sens.outputTokens, sens.attempts));

  // Stage 5 — Sonnet writer (the single Sonnet call).
  const writer = await callSonnet(
    'You are the memory writer. Produce a concise, normalized memory record (subject, fact, ' +
      'and any entities) suitable for long-term storage. Output 1–3 sentences.',
    `Raw event: "${event.text}"\nWrite the durable memory record.`,
    256,
  );
  ledger.record('memory-write', `writer:${event.id}`, costOf(PRICE_TABLE, 'anthropic', 'sonnet', writer.inputTokens, writer.outputTokens, writer.attempts));

  // Stage 6 — embedding (memory vector).
  const emb = await embed(writer.text);
  ledger.record('memory-write', `embed:${event.id}`, costOf(PRICE_TABLE, 'openai', 'text-embedding-3-small', emb.inputTokens, 0, emb.attempts));

  return { survived: true, diedAt: null };
}
