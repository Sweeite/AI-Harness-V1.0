// CLI for the observability skeleton. Commands:
//   check — run the offline build-time gates (no DB, no network):
//           (1) observability CFG valid (retention window ≥ audit floor; watchdog cadences sane)
//           (2) the ISSUE-008 0001_baseline already created event_log / notifications / the enums /
//               redacted_at / the t_append_only trigger (§8 step 1 — verify-present, never re-create)
//           (3) the event_type enum guard matches the DDL enum (no drift between app-code + schema)
//
// `check` needs no infra and runs in CI on every change. There is no live command in this offline half —
// the silo read/write happens against a real Supabase at integration time via supabase-store.ts.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DEFAULT_OBSERVABILITY_CONFIG, validateObservabilityConfig } from "./config.ts";
import { checkSchemaPresence, readBaseline } from "./schema-presence.ts";
import { EVENT_TYPES } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_SQL = join(HERE, "..", "..", "silo", "migrations", "0001_baseline.sql");

interface Finding {
  gate: string;
  message: string;
}

function runCheck(): Finding[] {
  const findings: Finding[] = [];

  // (1) CFG valid.
  try {
    validateObservabilityConfig(DEFAULT_OBSERVABILITY_CONFIG);
  } catch (e) {
    findings.push({ gate: "config", message: (e as Error).message });
  }

  // (2) Schema present (verify-present, never re-create — §8 step 1).
  let baseline: string | null = null;
  try {
    baseline = readBaseline(BASELINE_SQL);
  } catch {
    findings.push({ gate: "schema-presence", message: `0001_baseline.sql not found at ${BASELINE_SQL}` });
  }
  if (baseline !== null) {
    for (const c of checkSchemaPresence(baseline)) {
      if (!c.ok) {
        findings.push({
          gate: "schema-presence",
          message: `MISSING: ${c.name} — ${c.detail} (an ISSUE-008 gap; report, do not patch here)`,
        });
      }
    }
    // (3) Enum-guard ↔ DDL drift: every value in the app-code EVENT_TYPES guard must appear in the DDL enum.
    const enumBlockMatch = baseline.match(/create type event_type\s+as enum\s*\(([\s\S]*?)\);/);
    const enumBody = enumBlockMatch?.[1];
    if (enumBody === undefined) {
      findings.push({ gate: "enum-drift", message: "could not locate the event_type enum in the baseline DDL" });
    } else {
      const ddlValues = new Set([...enumBody.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
      for (const v of EVENT_TYPES) {
        if (!ddlValues.has(v)) {
          findings.push({
            gate: "enum-drift",
            message: `event_type '${v}' is in the app-code guard but NOT in the DDL enum — drift (Rule 0)`,
          });
        }
      }
    }
  }

  if (findings.length === 0) {
    console.log(
      "✓ observability check: CFG valid · 0001_baseline schema present (event_log/notifications/enums/" +
        "redacted_at/t_append_only) · event_type guard matches the DDL enum.",
    );
  } else {
    console.error(`✗ observability check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

function main(): void {
  const cmd = process.argv[2] ?? "check";
  if (cmd === "check") {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}

main();
