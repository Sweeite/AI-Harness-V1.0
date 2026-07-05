// ISSUE-060 — the @harness/guardrail-log barrel + a tiny `check` CLI (mirrors app/config-store/app/observability).
// The public surface producer slices (HRD/APR/ANM/INJ/RTL) and the C7 view/export consume.

export * from "./types.ts";
export * from "./store.ts";
export * from "./writer.ts";
export * from "./sinks.ts";
export * from "./learning.ts";
export { SupabaseGuardrailLogStore, SupabaseQuarantineStore } from "./supabase-store.ts";

import { InMemoryDegradedSink, InMemoryGuardrailLogStore } from "./store.ts";
import { GuardrailWriter, type WriterClock } from "./writer.ts";
import { buildExport } from "./sinks.ts";

/** A default clock backed by crypto.randomUUID + the real wall clock (live path / CLI). */
export function systemClock(): WriterClock {
  return { now: () => new Date(), newId: () => globalThis.crypto.randomUUID() };
}

/** `npm run check` — a smoke path proving the guarded write + fail-closed route wire up (offline, no DB). */
async function check(): Promise<void> {
  const store = new InMemoryGuardrailLogStore();
  const degraded = new InMemoryDegradedSink();
  const writer = new GuardrailWriter({ store, degraded, clock: systemClock() });

  const ok = await writer.record({
    guardrail_type: "prompt_injection",
    description: "smoke: an injection attempt was blocked",
    action_blocked: true,
  });
  if (!ok.logged || ok.actionHeld !== true) throw new Error("check: happy-path write did not land");

  // Fail-closed smoke: a substrate failure must NOT abandon the block.
  store.induceWriteFailure("smoke: DB unreachable");
  const failed = await writer.record({
    guardrail_type: "hard_limit",
    description: "smoke: a hard limit was hit while the store was down",
    action_blocked: true,
  });
  if (failed.logged !== false || failed.actionHeld !== true || failed.degraded !== true) {
    throw new Error("check: fail-closed path did not hold the action / did not escalate out-of-band");
  }
  if (degraded.drain().length !== 1) throw new Error("check: lost row was not escalated out-of-band");

  const rows = await store.all();
  const exp = buildExport(rows, { from: "1970-01-01T00:00:00.000Z", to: "2999-01-01T00:00:00.000Z" });
  process.stdout.write(
    `guardrail-log check OK — ${rows.length} row(s); types present: [${exp.typesPresent.join(", ")}]; ` +
      `fail-closed escalated 1 lost row\n`,
  );
}

if (process.argv[2] === "check") {
  check().catch((e) => {
    process.stderr.write(`guardrail-log check FAILED: ${(e as Error).message}\n`);
    process.exit(1);
  });
}
