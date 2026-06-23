# Tool Integration Dossier — <Tool Name>

> Copy this file to `<tool-slug>.md`, fill every section, and follow
> `standards/tool-integration-research.md`. **No connector FR may be written until this dossier is
> 🟢.** Cite **primary vendor sources** with URLs; date-stamp every fact (vendor facts go stale).

- **Tool / vendor:** <name + product>
- **Status:** 🟡 researching · 🟢 verified · 🟠 stale (past re-verify date) · ⛔ blocked
- **Verified on:** <YYYY-MM-DD>   ·   **Re-verify by:** <YYYY-MM-DD (default +6 months)>
- **Researched by / session:** <session #>
- **Applicability — which clients / use cases / entity types / memory slots need this, and why:**
  <…>
- **Read / write / both:** <…>

---

## Verdict summary

One-line headline per dimension: what's **VERIFIED**, what's **STALE/REFUTED** vs any prior
assumption, and the **one finding that most changes the spec**. (Mirror the AF-003 F1–F12 style.)

| Dimension | Verdict | Headline | Source date |
|---|---|---|---|
| 2 Auth & token lifecycle | | | |
| 3 Rate limits & quotas | | | |
| 5 Webhooks / events | | | |
| 6 Data & sensitivity | | | |
| 7 Provisioning | | | |
| 8 Isolation & security | | | |
| 9 Cost | | | |
| 10 Failure modes | | | |
| 11 Versioning / staleness | | | |

---

## 1. Identity & applicability
What it is; which clients / use cases / entity types / memory slots; read-only / write / both.

## 2. Auth & token lifecycle  *(→ non-negotiable #1: never lose access)*
- OAuth flow / auth mechanism:
- Access-token lifetime (design to the returned `expires_in`, not a hardcoded number):
- **Refresh-token lifetime + rotation** — single-use? returns a new token each refresh? expiry-from-disuse?
  *(If it rotates, the harness MUST persist the new token every refresh — the F5/GHL trap.)*
- Revocation triggers (password reset, admin revoke, uninstall, scope change):
- Per-account token-count caps:
- Scope verification / security assessment required? Lead time?:
- **Token storage** (per ADR-001 — client-owned accounts; where the secret lives):
- **Source(s) + date:**

## 3. Rate limits & quotas  *(→ #3: never fail silently)*
- Exact current limits with **scope** (per user / location / app / token):
- Burst / sustained / **daily** caps; quota-unit model if any:
- 429 / `Retry-After` behaviour; rate-limit headers exposed:
- **What changed in the last 12–18 months?** (the Slack-2025 lesson):
- **Source(s) + date:**

## 4. API surface & capabilities
Endpoints we need; pagination; bulk vs incremental; filtering; batch limits; idempotency. **Source + date:**

## 5. Webhooks / events / realtime
Push vs pull; event catalogue; delivery guarantees; **signature/HMAC auth** (ADR-007); replay/dedup
(ADR-004 idempotency). **Source + date:**

## 6. Data, sensitivity & ingestion  *(→ #1 integrity, #2 containment)*
What data + volume; entity/memory mapping; **PII/sensitivity class** (ADR-006); **external-data
boundary tagging** (ADR-007 — untrusted by default). **Source + date:**

## 7. Provisioning & per-client setup  *(ADR-001 §5 / ADR-005 §5)*
Per-client app registration **in the client's own accounts**; redirect URIs → deployment domain;
**consent/verification lead time** (schedule dependency); who creates + pays. **Source + date:**

## 8. Isolation & security
Silo fit (ADR-001); RLS implications (ADR-006); **least-privilege scope set** (request the minimum);
service-role / god-mode-key exposure (F12); injection/containment surface (ADR-007). **Source + date:**

## 9. Cost  *(→ ADR-003)*
Per-call / per-volume cost; token/compute implications; price-table entries to add. **Source + date:**

## 10. Failure modes & limits  *(→ #3, ADR-004, OD-010)*
Outages; partial failures; retry/backoff; idempotent safe re-run; compensation exposure for external
writes. **Source + date:**

## 11. Versioning & staleness risk
API version targeted; deprecation cadence; how fast facts go stale → sets `Re-verify by`. **Source + date:**

---

## Outputs filed (Rule 0 — write it down)

- **AF (feasibility) items raised:** AF-… — <claim + method DOCS/SPIKE/EVAL/LOAD>
- **OD (open decisions) raised:** OD-… — <fork + recommendation>
- **Glossary terms added:** <term> — <one-line>
- **Out-of-scope logged:** OOS-… — <deferred capability>
- **Connector FRs this unblocks (Phase 1):** <FR-comp.area.n …>
- **Config keys this implies (Phase 2):** <CFG-… rate limits, token TTLs, scopes>

## Verification-gate result
Independent re-check of stale/refuted/load-bearing claims — pass/fail + who/when.
