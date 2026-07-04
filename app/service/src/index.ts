// The deployable service — the Railway boot target for the AF-004 provisioning run.
//
// SCOPE: this is the minimal, correct boot skeleton, NOT the product. Its only job today is to prove
// the provisioning plumbing end-to-end — env + secrets injected, the client-owned Supabase reachable,
// a healthcheck Railway can gate on. The real product surface (C0/C1 seed, the agent harness, the
// ingest endpoint) lands per its own issues. Binds Railway's injected `PORT` on 0.0.0.0; exposes
// `/health` (the zero-downtime gate) and `/` (liveness).

import { createServer } from "node:http";
import { checkHealth, missingSecrets } from "./health.ts";

const PORT = Number(process.env.PORT ?? 3000);

// Loud boot log: state exactly which required secrets are missing (never a silent half-config).
const missing = missingSecrets(process.env);
if (missing.length > 0) {
  console.error(`[boot] NOT READY — missing required secrets: ${missing.join(", ")}`);
  console.error("[boot] serving /health as 503 so Railway marks this deploy failed (no half-silo).");
} else {
  console.log("[boot] all required secrets present; probing client Supabase on /health.");
}

const server = createServer(async (req, res) => {
  if (req.url === "/health") {
    const health = await checkHealth(process.env);
    res.writeHead(health.ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(health));
    if (!health.ok) console.error(`[health] 503 — ${health.detail}`);
    return;
  }
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ai-harness service (AF-004 boot target) — see /health\n");
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found\n");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[boot] listening on 0.0.0.0:${PORT}`);
});
