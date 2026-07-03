/**
 * Vendor call wrappers — real paid Sonnet / Haiku / OpenAI-embedding calls, with per-call
 * token capture and ATTEMPT COUNTING (every try, incl. retries, is charged — ADR-003 §3
 * round-up posture). The SDK's own retry is disabled so we own the attempt count.
 *
 * DRY_RUN=1 (or a missing key) => deterministic fake token counts, clearly flagged, so the
 * full flow is runnable/testable without spending money. A dry run can NEVER produce a PASS
 * verdict (main.ts guards this) — it only exercises the shape.
 *
 * Failure is loud: if all attempts fail we throw. We never return a silent empty result
 * (non-negotiable #3).
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export const DRY_RUN = process.env.DRY_RUN === '1';

const SONNET_MODEL = process.env.ANTHROPIC_SONNET_MODEL ?? 'claude-sonnet-5';
const HAIKU_MODEL = process.env.ANTHROPIC_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001';
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';

const MAX_ATTEMPTS = 3;

export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
}

export interface EmbedResult {
  inputTokens: number;
  attempts: number;
}

const anthropic = DRY_RUN || !process.env.ANTHROPIC_API_KEY
  ? null
  : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });

const openai = DRY_RUN || !process.env.OPENAI_API_KEY
  ? null
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });

/** Deterministic pseudo-token count for dry runs — proportional to text length, no randomness. */
function fakeTokens(s: string): number {
  return Math.max(1, Math.round(s.length / 4));
}

function isTransient(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 529;
}

async function callAnthropic(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<LlmResult> {
  if (DRY_RUN || !anthropic) {
    return {
      text: `[dry-run reply to: ${user.slice(0, 40)}...]`,
      inputTokens: fakeTokens(system + user),
      outputTokens: fakeTokens(user) + 20,
      attempts: 1,
    };
  }
  let attempts = 0;
  let lastErr: unknown;
  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    try {
      const msg = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      });
      const text = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return {
        text,
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        attempts, // round-up: the successful call's tokens are charged `attempts` times
      };
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempts >= MAX_ATTEMPTS) break;
    }
  }
  throw new Error(`Anthropic ${model} failed after ${attempts} attempt(s): ${String(lastErr)}`);
}

/** Sonnet — reasoning / orchestration / the single memory writer. price_table family: 'sonnet'. */
export async function callSonnet(system: string, user: string, maxTokens = 1024): Promise<LlmResult> {
  return callAnthropic(SONNET_MODEL, system, user, maxTokens);
}

/** Haiku — classification / selective-write gate / pre-checks. price_table family: 'haiku'. */
export async function callHaiku(system: string, user: string, maxTokens = 256): Promise<LlmResult> {
  return callAnthropic(HAIKU_MODEL, system, user, maxTokens);
}

/** OpenAI text-embedding-3-small — memory embedding. */
export async function embed(text: string): Promise<EmbedResult> {
  if (DRY_RUN || !openai) {
    return { inputTokens: fakeTokens(text), attempts: 1 };
  }
  let attempts = 0;
  let lastErr: unknown;
  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    try {
      const res = await openai.embeddings.create({ model: EMBED_MODEL, input: text });
      return { inputTokens: res.usage.prompt_tokens, attempts };
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempts >= MAX_ATTEMPTS) break;
    }
  }
  throw new Error(`OpenAI ${EMBED_MODEL} failed after ${attempts} attempt(s): ${String(lastErr)}`);
}

export const MODELS = { SONNET_MODEL, HAIKU_MODEL, EMBED_MODEL };
