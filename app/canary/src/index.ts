// Dry-run CLI: print the canary corpus plan + the KNOWN_ANSWERS contract, and seed it into an
// in-memory store to show the idempotent report — WITHOUT touching live infra. The live seed
// (SupabaseSeed against the canary's own Supabase) is wired in the two-party provisioning session.
//
//   npm run seed:dry

import { CANARY_CORPUS, KNOWN_ANSWERS } from "./fixture.ts";
import { InMemorySeedStore } from "./port.ts";
import { seedCanary } from "./seed.ts";

async function main() {
  const c = CANARY_CORPUS;
  console.log(`Canary synthetic client: "${c.clientSlug}"`);
  console.log(`  entities: ${c.entities.length}  messages: ${c.messages.length}  memories: ${c.memories.length}`);
  console.log("\nEntities:");
  for (const e of c.entities) console.log(`  - ${e.name} (${e.type})${e.isInternalOrg ? " [internal_org]" : ""}`);

  console.log("\nKnown-answer contract (owned by C2/C5/C8 to assert):");
  console.log(`  retrieval: "${KNOWN_ANSWERS.retrieval.query}" → expect "${KNOWN_ANSWERS.retrieval.expectSubstring}"`);
  console.log(`  contradiction: ${KNOWN_ANSWERS.contradiction.about} (2 conflicting memories)`);
  console.log(`  routing: ${KNOWN_ANSWERS.routing.map((r) => r.expectRoute).join(", ")}`);

  const store = new InMemorySeedStore();
  const first = await seedCanary(c, store);
  const second = await seedCanary(c, store);
  console.log("\nDry-run seed (in-memory):");
  console.log(`  first run  inserted: ${JSON.stringify(first.inserted)}`);
  console.log(`  second run skipped:  ${JSON.stringify(second.skipped)} (idempotent — nothing re-applied)`);
  console.log("\nLive seed (SupabaseSeed) is the two-party step — TODO(AF-004) in port.ts.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
