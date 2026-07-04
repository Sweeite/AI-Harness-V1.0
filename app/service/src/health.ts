// Boot-readiness check for the deployable service (the AF-004 Railway deploy target).
//
// Railway's healthcheck is the ZERO-DOWNTIME GATE: it holds traffic on the prior deploy until the
// new one returns 200 on `healthcheckPath`, and with NO healthcheck a broken-but-booting app goes
// live (tool-integrations/railway.md §10). So readiness is expressed as a health check, not a
// process exit: `/health` returns 200 ONLY when every required secret is present AND the client
// Supabase is reachable. A required-missing secret ⇒ 503 with the exact missing keys ⇒ the deploy is
// marked failed and never routed to — loud, never a silent half-configured silo (#1/#2/#3).

// The required-secret manifest, VENDORED here on purpose. Railway's isolated-monorepo Root Directory
// (`/app/service`) scopes the build/deploy context to THIS directory only (tool-integrations/railway.md
// §7), so a runtime import reaching up into `../../provisioning` would break the deploy. The canonical
// list lives in provisioning/src/types.ts (Rule 0); health.test.ts imports it and asserts this vendored
// copy stays in lockstep — so drift is caught locally, at test time, without a cross-package deploy dep.
export const REQUIRED_SECRETS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "INTERNAL_TOKEN",
  "LOGIN_OAUTH_CLIENT_ID",
  "LOGIN_OAUTH_CLIENT_SECRET",
] as const;

export interface HealthResult {
  ok: boolean;
  missingSecrets: string[];
  supabaseReachable: boolean | null; // null = not probed (secrets missing, probe skipped)
  detail: string;
}

/** Which required secrets are absent/empty in this env. */
export function missingSecrets(env: NodeJS.ProcessEnv): string[] {
  return REQUIRED_SECRETS.filter((k) => {
    const v = env[k];
    return v === undefined || v.trim() === "";
  });
}

/** Best-effort reachability ping of the client-owned Supabase (PostgREST root). */
export async function probeSupabase(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    // PostgREST returns 200 on the root with a valid key; any HTTP response proves reachability.
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function checkHealth(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthResult> {
  const missing = missingSecrets(env);
  if (missing.length > 0) {
    // Fail loud: don't even probe the DB — surface the exact gap.
    return {
      ok: false,
      missingSecrets: missing,
      supabaseReachable: null,
      detail: `missing required secrets: ${missing.join(", ")}`,
    };
  }
  const reachable = await probeSupabase(env, fetchImpl);
  return {
    ok: reachable,
    missingSecrets: [],
    supabaseReachable: reachable,
    detail: reachable ? "ready" : "client Supabase not reachable",
  };
}
