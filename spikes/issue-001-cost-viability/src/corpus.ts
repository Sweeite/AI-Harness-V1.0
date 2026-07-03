/**
 * The assembled measurement corpus — ISSUE-001 step 1.
 *
 * test-strategy.md references an "AF-001/AF-002 shared corpus" but NO canonical corpus file
 * exists in the repo. So the spike assembles one and records its composition here; that recorded
 * composition is a spike output (and what the AF-002 retrieval spike can later reuse).
 *
 * Kept deliberately small: the spike measures ONE task + a handful of write events, then
 * extrapolates via the declared profile (profile.ts). Representativeness is in the call SHAPE,
 * not in running a full day of volume against live APIs.
 */
import type { MemoryEvent } from './memoryWrite.js';

/** The one representative multi-agent task (orchestrator→research→specialists). */
export const TASK_PROMPT =
  'A client contact asked us to prepare a short brief on their Q3 renewal: pull the account ' +
  'status, summarize the open support threads, and recommend next steps for the account manager.';

/**
 * Memory events fed to the write path. Designed so at least one clearly SURVIVES (a durable
 * fact) and at least one clearly DIES (ephemeral noise) — proving the 1-Sonnet-on-survival /
 * 0-Sonnet-on-drop shape (AF-043).
 */
export const MEMORY_EVENTS: MemoryEvent[] = [
  {
    // Durable fact → a correct gate KEEPS it → full write path (1 Sonnet + 3 Haiku + embed).
    id: 'survivor-1',
    text: 'The account manager for Northwind Traders is Dana Ruiz; their renewal date is 2026-09-30 and they prefer email over calls.',
  },
  {
    // Ephemeral but long enough to PASS the code filter → reaches the Haiku gate → DROP (0 Sonnet).
    // This is the event that prices one Haiku gate call for the non-survivor extrapolation.
    id: 'gatedrop-1',
    text: 'I am feeling a little tired this afternoon and will probably grab a coffee before the next meeting.',
  },
  // Dies free at the code filter (too short / filler) — a non-survivor at 0 model cost.
  { id: 'noise-1', text: 'ok thanks' },
];

/** Recorded composition of the assembled corpus — part of the spike evidence (step 7g). */
export const CORPUS_COMPOSITION = {
  tasks: 1,
  taskType: 'account-brief (research+summarize+recommend) — orchestrator→research→2 specialists→synthesis',
  memoryEventsFed: MEMORY_EVENTS.length,
  designedSurvivors: 1,
  designedGateDrops: 1, // passes code filter, Haiku gate drops → prices the non-survivor unit
  designedCodeFilterDrops: 1, // dies free at the code filter
  note: 'Small by design; the declared profile (profile.ts) is the extrapolation basis, not corpus size. Shares dimensions (entities, mention mix) with the AF-002 retrieval corpus.',
};
