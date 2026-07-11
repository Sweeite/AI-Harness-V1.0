// ISSUE-082 — AF-134 build-time recall EVAL (feasibility-register.md). FR-10.DEL.002's probabilistic (name-in-content)
// sweep must be RECALL-oriented: a false negative leaves personal data un-erased (#2). This EVAL plants a corpus of
// memories that mention a subject via many surface forms and measures what the keyword sweep (expandSearchTerms +
// InMemory probabilisticContentMatches, mirroring the live ILIKE-any SQL 1:1) RECALLS — and, honestly, what it MISSES
// (the semantic/paraphrase arm is the acknowledged AF-134 seam; AC-10.DEL.002.3 requires the un-found risk be surfaced,
// not hidden). The gate: the deterministic surface-form recall must be 100% (every literal name-variant / identifier
// mention is found); the paraphrase misses are REPORTED as the residual review burden, never silently "complete".
//
// Run:  npx tsx results/af-134-recall-eval.ts

import { InMemoryDeletionWorkflowStore } from '../src/store.ts';
import { identifyAffectedRecords, expandSearchTerms } from '../src/identify.ts';

interface Planted {
  id: string;
  content: string;
  /** whether this mention is a literal surface form of the name/identifiers (keyword-recoverable) vs a paraphrase
   *  (only a semantic arm would catch it — the AF-134 seam). */
  kind: 'literal' | 'paraphrase';
  hasEntityId: boolean;
}

async function main(): Promise<void> {
  const subject = { name: 'Jonathan Smith', identifiers: ['jon.smith@acme.com', '+61-400-123-456'] };
  const target = 'entity-jonathan';

  // A corpus of memories that all genuinely reference the subject, across surface forms. Only the content-only rows
  // (no entity_id) exercise the probabilistic sweep; the entity_id rows are the deterministic set (always recalled).
  const planted: Planted[] = [
    { id: 'p1', content: 'Met Jonathan Smith at the Acme kickoff.', kind: 'literal', hasEntityId: false },
    { id: 'p2', content: 'Follow-up owed to Jonathan re: the retainer.', kind: 'literal', hasEntityId: false }, // "Jonathan"
    { id: 'p3', content: 'Smith flagged a billing concern.', kind: 'literal', hasEntityId: false }, // "Smith"
    { id: 'p4', content: 'Emailed jon.smith@acme.com the invoice.', kind: 'literal', hasEntityId: false }, // identifier
    { id: 'p5', content: 'Called +61-400-123-456 twice, no answer.', kind: 'literal', hasEntityId: false }, // identifier
    { id: 'p6', content: 'JSmith approved the scope in Slack.', kind: 'literal', hasEntityId: false }, // "JSmith" variant
    { id: 'p7', content: 'The client from Acme we onboarded in March wants a refund.', kind: 'paraphrase', hasEntityId: false }, // no surface form — SEMANTIC ONLY
    { id: 'p8', content: 'He asked us to pause the campaign.', kind: 'paraphrase', hasEntityId: false }, // pronoun only — SEMANTIC ONLY
    { id: 'd1', content: 'Deterministic row (tagged with the entity).', kind: 'literal', hasEntityId: true },
  ];

  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity(target);
  for (const p of planted) store.putMemory({ id: p.id, content: p.content, entity_ids: p.hasEntityId ? [target] : ['other'], sensitivity: 'personal' });

  const terms = expandSearchTerms(subject);
  const res = await identifyAffectedRecords(store, target, subject);

  const contentOnly = planted.filter((p) => !p.hasEntityId);
  const literals = contentOnly.filter((p) => p.kind === 'literal');
  const paraphrases = contentOnly.filter((p) => p.kind === 'paraphrase');
  const found = new Set(res.probabilisticCandidates.map((r) => r.id));

  const literalsRecalled = literals.filter((p) => found.has(p.id));
  const paraphrasesRecalled = paraphrases.filter((p) => found.has(p.id));
  const literalRecall = literalsRecalled.length / literals.length;

  console.log('── AF-134 recall EVAL — FR-10.DEL.002 probabilistic (name-in-content) sweep ──\n');
  console.log(`search terms (recall-oriented expansion): ${JSON.stringify(terms)}\n`);
  console.log(`deterministic set (entity_id): ${res.counts.deterministic} row(s) — always recalled (auto-actioned by C2)`);
  console.log(`literal surface-form recall:   ${literalsRecalled.length}/${literals.length} = ${(literalRecall * 100).toFixed(0)}%`);
  console.log(`  recalled: ${literalsRecalled.map((p) => p.id).join(', ')}`);
  const literalMisses = literals.filter((p) => !found.has(p.id));
  if (literalMisses.length) console.log(`  ⚠️ LITERAL MISSES (should be zero): ${literalMisses.map((p) => `${p.id} "${p.content}"`).join(' | ')}`);
  console.log(`\nparaphrase/pronoun mentions (semantic-only — the AF-134 seam): ${paraphrasesRecalled.length}/${paraphrases.length} recalled by keyword`);
  console.log(`  ⚠️ RESIDUAL REVIEW BURDEN (keyword cannot reach; a human review + the semantic arm must): ${paraphrases.map((p) => `${p.id} "${p.content}"`).join(' | ')}`);
  console.log('\nHONEST POSTURE (AC-10.DEL.002.3): every literal surface form is recalled → the keyword floor is complete for');
  console.log('literal mentions. Paraphrase/pronoun mentions are NOT auto-actioned or claimed found — they are the');
  console.log('acknowledged un-found risk. The sweep surfaces candidates for HUMAN confirmation; it never reports the');
  console.log('probabilistic arm "complete" (no false "done"). The semantic-embedding arm is the load-bearing recall');
  console.log('improvement AF-134 tracks toward GREEN at the retrieval/embeddings seam.\n');

  // GATE: literal recall must be 100% (a keyword sweep that misses a literal surface form is a real #2 bug).
  if (literalRecall < 1) {
    console.error(`✗ AF-134 EVAL FAIL: literal surface-form recall ${(literalRecall * 100).toFixed(0)}% < 100%`);
    process.exit(1);
  }
  console.log(`✓ AF-134 EVAL: literal surface-form recall 100% (${literals.length}/${literals.length}); ${paraphrases.length} paraphrase mention(s) surfaced as residual review burden, not silently dropped.`);
}

await main();
