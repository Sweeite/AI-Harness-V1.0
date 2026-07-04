// ISSUE-003 §8.3 (the INJ pipeline under test) — FR-6.INJ.001/004/006 + ADR-007 parts 2/3/4/6.
//
// CRITICAL POSTURE NOTE (ADR-007 part 1): this pipeline is a SIGNAL + fail-safe, NOT the security
// boundary. It sanitizes, boundary-wraps, and quarantines obvious injections — but the load-bearing
// guarantee is that content which EVADES it and reaches the (compromised) model is STILL contained by
// the code gate downstream (enforcement.ts). "A successful injection is contained, not necessarily
// caught." The red-team battery therefore includes evasion payloads that pass through here untouched.

import { BOOT_CONFIG } from './config.js';
import type { AppendOnlyStore } from './store.js';

export interface ToolRead {
  tool: string; // slack | ghl | gmail | drive
  channel: string;
  sourceRecordId: string | null;
  timestamp: string;
  content: string; // raw external content — potentially hostile
}

export interface SanitizeResult {
  quarantined: boolean;
  // The text that is allowed to proceed to the AI-call, ALWAYS boundary-wrapped (FR-6.INJ.004).
  // null when quarantined (content is held out of the task — FR-6.INJ.006).
  wrapped: string | null;
  regexHits: string[];
  semanticScore: number; // computed but only acted on when semantic detection is ON
  quarantineRowId?: string;
  guardrailRowId?: string;
}

// FR-6.INJ.002 — the deterministic regex tripwire library (always on). A SMALL set of
// high-confidence literals; coverage/quality is AF-117 (a separate EVAL), explicitly NOT this gate.
// These are "high-confidence literal" matches → quarantine even with semantic detection off (OD-066).
const INJECTION_LITERALS: { name: string; re: RegExp }[] = [
  { name: 'ignore-previous', re: /ignore (all )?(previous|prior|above) (instructions|prompts)/i },
  { name: 'you-are-now', re: /you are now (in )?(developer|admin|dan|jailbreak|god) mode/i },
  { name: 'system-override', re: /(system|admin) override|disregard your (rules|guardrails|limits)/i },
  { name: 'new-instructions', re: /new instructions:|<\/?system>|\[\[?system\]?\]/i },
  { name: 'exfil-directive', re: /(send|email|forward|export) (all|the) .*(data|contacts|records|memory) to/i },
];

// A crude stand-in for the embedding classifier (FR-6.INJ.003). It returns a similarity-like
// score; per ADR-007 part 3 it ships but is OFF by default and may NEVER autonomously gate.
function semanticScore(content: string): number {
  const markers = ['instruction', 'ignore', 'override', 'as the system', 'you must', 'do not tell'];
  const hits = markers.filter((m) => content.toLowerCase().includes(m)).length;
  return Math.min(0.99, hits * 0.2);
}

/**
 * The C6 sanitization pipeline, steps 1–4 (FR-6.INJ.001 AC-6.INJ.001.1).
 * Invoked BETWEEN tool-read and AI-call by the harness (AC-6.INJ.001.2 — the named seam).
 */
export function sanitizeToolRead(read: ToolRead, store: AppendOnlyStore, taskId: string): SanitizeResult {
  // Step 1: deterministic regex tripwires (always on — ADR-007 part 2).
  const regexHits = INJECTION_LITERALS.filter((p) => p.re.test(read.content)).map((p) => p.name);

  // Step 2: semantic score is COMPUTED but only consulted when the (off-by-default) detector is on.
  const score = semanticScore(read.content);
  const semanticActive = BOOT_CONFIG.injection_semantic_detection_enabled;

  // Step 3: quarantine decision. A high-confidence LITERAL match always quarantines (OD-066),
  // regardless of the semantic detector. The semantic threshold only participates when the
  // detector is ON — and even then it routes to human, it does not gate an action (ADR-007 pt3).
  const literalQuarantine = regexHits.length > 0;
  const semanticQuarantine = semanticActive && score >= BOOT_CONFIG.injection_quarantine_threshold;
  const quarantined = literalQuarantine || semanticQuarantine;

  if (quarantined) {
    // FR-6.INJ.006 / ADR-007 part 4: retain + route to human. Log loudly (part 5), pause the task.
    const gl = store.logGuardrail({
      task_id: taskId,
      guardrail_type: 'prompt_injection',
      description: `Injection quarantine on ${read.tool}/${read.channel} — literal hits: [${regexHits.join(', ') || 'none'}], semanticScore=${score.toFixed(2)} (detector ${semanticActive ? 'ON' : 'OFF'})`,
      action_blocked: true,
      status: 'pending',
    });
    const q = store.quarantineContent({
      guardrail_log_id: gl.id,
      quarantined_content: read.content, // retained verbatim — never machine-discarded
      source_tool: read.tool,
      source_record_id: read.sourceRecordId,
    });
    return { quarantined: true, wrapped: null, regexHits, semanticScore: score, quarantineRowId: q.id, guardrailRowId: gl.id };
  }

  // Step 4: not quarantined → boundary-wrap and let it proceed (FR-6.INJ.004 AC-6.INJ.004.1).
  // NB: wrapping is a PROMPT-layer signal to the model. A compromised model may ignore it — which
  // is exactly why it is not the boundary. Provenance attributes are attached.
  const wrapped =
    `<external_data source="${read.tool}" channel="${read.channel}" record="${read.sourceRecordId ?? ''}" timestamp="${read.timestamp}">` +
    read.content +
    `</external_data>`;

  return { quarantined: false, wrapped, regexHits, semanticScore: score };
}
