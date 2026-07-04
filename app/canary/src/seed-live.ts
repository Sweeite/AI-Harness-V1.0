// Live canary seed entrypoint (FR-10.PRV.003 live half). Reads keys from the process env — in the
// deployment they are the deployment's own env; this session they are injected transiently by
// `railway run` (so OPENAI_API_KEY never lands on the operator's disk). Fails LOUD on any missing
// secret before touching infra (#3). seedCanary() owns the idempotency + typed CanarySeedError.
//
//   railway run --service <svc> npm run -w @harness/canary seed:live
//
// Long-term home: the same entrypoint runs as the canary deployment's first-boot seed hook
// (triggered by provisioning's first deploy, FR-10.PRV.001), reading the same env — not a laptop.

import { CANARY_CORPUS } from "./fixture.ts";
import { seedCanary } from "./seed.ts";
import { SupabaseSeed } from "./supabase-seed.ts";

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    console.error(
      `FATAL: missing required env ${name}. Run under \`railway run\` (or in-deployment) so the ` +
        `deployment env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY) is injected.`,
    );
    process.exit(1);
  }
  return v;
}

async function main() {
  const supabaseUrl = required("SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const openaiApiKey = required("OPENAI_API_KEY");

  const store = new SupabaseSeed({ supabaseUrl, serviceRoleKey, openaiApiKey });
  const host = new URL(supabaseUrl).host;
  console.log(`Seeding canary corpus "${CANARY_CORPUS.clientSlug}" → ${host}`);
  console.log(
    `  corpus: ${CANARY_CORPUS.entities.length} entities · ${CANARY_CORPUS.messages.length} messages · ${CANARY_CORPUS.memories.length} memories`,
  );

  const report = await seedCanary(CANARY_CORPUS, store);
  console.log("\nseed report:");
  console.log(`  inserted: ${JSON.stringify(report.inserted)}`);
  console.log(`  skipped:  ${JSON.stringify(report.skipped)}`);
  const totalInserted =
    report.inserted.entities + report.inserted.messages + report.inserted.memories;
  const totalSkipped = report.skipped.entities + report.skipped.messages + report.skipped.memories;
  console.log(
    totalSkipped === 0
      ? `\n✅ fresh seed: ${totalInserted} rows inserted with real OpenAI embeddings.`
      : totalInserted === 0
        ? `\n✅ idempotent re-seed: nothing re-applied (${totalSkipped} rows already present).`
        : `\n✅ resumed seed: ${totalInserted} inserted, ${totalSkipped} already present (converged).`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
