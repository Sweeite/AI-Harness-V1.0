/**
 * One representative end-to-end multi-agent task — the ISSUE-001 step-3 unit of measurement.
 * Reproduces the ADR-003 orchestrator→research→specialists SHAPE with real vendor calls; the
 * exact task content matters less than the call shape and token volume being representative of
 * a healthy deployment's substantive task. Every call is recorded under the 'task' phase.
 *
 * Shape: 1 Haiku router → 1 Sonnet orchestrator/plan → 1 Sonnet research → 2 Sonnet specialists
 *        → 1 Sonnet synthesis. (Haiku for cheap classification, Sonnet for reasoning — ADR-003
 *        §7 lever 1 model-routing.)
 */
import { costOf, PRICE_TABLE } from './pricing.js';
import type { CostLedger } from './ledger.js';
import { callHaiku, callSonnet } from './vendors.js';

const rec = (ledger: CostLedger, label: string, family: 'sonnet' | 'haiku', r: { inputTokens: number; outputTokens: number; attempts: number }) =>
  ledger.record('task', label, costOf(PRICE_TABLE, 'anthropic', family, r.inputTokens, r.outputTokens, r.attempts));

export async function runTask(taskPrompt: string, ledger: CostLedger): Promise<string> {
  // Haiku router — cheap classification of the task type (model-routing lever).
  const router = await callHaiku(
    'Classify this task into one category: RESEARCH, ACTION, or ANALYSIS. One word.',
    `Task: "${taskPrompt}"\nCategory?`,
    16,
  );
  rec(ledger, 'router', 'haiku', router);

  // Sonnet orchestrator — decompose into a short plan.
  const plan = await callSonnet(
    'You are an orchestrator. Break the task into 2–3 concrete sub-steps for specialist agents. ' +
      'Be terse — a numbered list only.',
    `Task: "${taskPrompt}"\nProduce the plan.`,
    384,
  );
  rec(ledger, 'orchestrator', 'sonnet', plan);

  // Sonnet research — gather the context the plan needs.
  const research = await callSonnet(
    'You are a research agent. Given a plan, produce the key facts/context needed to execute it. ' +
      '4–6 bullet points.',
    `Plan:\n${plan.text}\nResearch the context.`,
    512,
  );
  rec(ledger, 'research', 'sonnet', research);

  // Two Sonnet specialists — execute distinct halves of the plan.
  const spec1 = await callSonnet(
    'You are specialist A. Execute the first half of the plan using the research. Concrete output.',
    `Plan:\n${plan.text}\nResearch:\n${research.text}\nDeliver your part.`,
    512,
  );
  rec(ledger, 'specialist-1', 'sonnet', spec1);

  const spec2 = await callSonnet(
    'You are specialist B. Execute the second half of the plan using the research. Concrete output.',
    `Plan:\n${plan.text}\nResearch:\n${research.text}\nDeliver your part.`,
    512,
  );
  rec(ledger, 'specialist-2', 'sonnet', spec2);

  // Sonnet synthesis — merge into the final deliverable.
  const synth = await callSonnet(
    'You are the synthesizer. Merge the specialist outputs into a single coherent deliverable.',
    `Specialist A:\n${spec1.text}\nSpecialist B:\n${spec2.text}\nSynthesize.`,
    512,
  );
  rec(ledger, 'synthesis', 'sonnet', synth);

  return synth.text;
}
