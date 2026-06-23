# ADR-005 — Deploy Fan-out & Provisioning Automation

- **Status:** Accepted
- **Date decided:** 2026-06-23
- **Resolves:** OD-005
- **Affects:** Deploy/release process (Railway + GitHub), database migrations (drizzle on
  release), per-client provisioning (Supabase + Railway + OAuth + secrets), the management
  plane (`client_registry` registration + version reporting), version-skew handling across
  the fleet, plugins distribution, config registry (`DEPLOYMENT_CONFIG` + env secrets),
  components 0/1 (Login/onboarding) and 10 (offboarding inverse). Feasibility AF-004 (umbrella
  provisioning spike), AF-020/AF-021, and new AF-064/AF-065/AF-066. Builds directly on
  **ADR-001** (Silo isolation + hybrid account ownership + Railway-native GitHub auto-deploy +
  push-based management plane) and inherits ADR-003's per-deployment cost framing.

## Context

The design doc **asserts** a deploy-and-provisioning story but never **designs** it. Three
gaps, all promoted into OD-005:

1. **Deploy fan-out.** "One patch, everywhere, without touching any individual deployment
   manually" (`L23`); "Push to main → tests run → deploy to all active Railway projects
   automatically" (`L119–122`); the detailed flow at `L1141–1160` (GitHub Actions triggers a
   Railway deploy "for each active deployment"). The doc frames this as a **central CI pipeline
   that iterates a list of projects** — but never says where that list lives, how it's kept in
   sync, or how a bad push is prevented from hitting all clients at once.

2. **Provisioning.** Standing up a new client needs a Supabase project, a Railway project,
   `DEPLOYMENT_CONFIG` + ~14 env secrets (`L1052–1066`), a seed script on first boot
   (`L1130–1136`, `L671–691`), per-client OAuth apps (`L360–369`, `L2275–2291`), an
   `internal_token`, and a `client_registry` row (`L1222–1239`). The doc lists the *ingredients*
   but never the *recipe* — and ADR-001's hybrid ownership (client owns Supabase + keys + connector
   SaaS; operator owns Railway) makes it a **two-party** process the doc doesn't acknowledge.

3. **Version skew.** Each deployment reports a `core_version` (`L1186`, `L1197–1200`,
   `L1218–1232`) and migrates **independently** — "a migration failure in one client's deployment
   does not affect other clients" (`L1141–1160`). So deployments running **different versions
   simultaneously is an explicit, designed-for state** — but the doc never says it's *safe*, never
   bounds it, and gives no rollback story.

**Two reconciliations ADR-001 already forced** (this ADR makes them explicit so nothing downstream
re-reads the stale doc text):

- **No custom fan-out CI.** ADR-001 §6 replaced the doc's GitHub-Actions-iterates-N-projects model
  with **Railway's native GitHub integration**: each client's Railway project independently
  subscribes to the one shared repo and auto-deploys on push. Fan-out is **N independent
  subscriptions, not one orchestrator**. `client_registry` is therefore the operator's **map for
  observability**, not the deploy driver. This dissolves the doc's "where does the project list
  live" gap entirely.
- **Push, not pull.** ADR-001 §7 replaced the doc's pull-based `/api/internal/status` (`L1197–1200`,
  Super Admin calls each deployment) with **each deployment pushing** health/version snapshots to
  the management plane. Provisioning must therefore hand each deployment the management-plane ingest
  URL + its `internal_token` so it can push.

Scope note: this is all **operator-side infrastructure orchestration**, distinct from ADR-004's
intra-deployment runtime concurrency. The unit here is "a whole client deployment," not "a memory
write."

## Options considered

### Axis 1 — How a core update reaches the fleet (blast radius)

**A1 — Instant global auto-deploy on `main`.** The doc's literal model: every push to `main`
auto-deploys to all client Railway projects at once. Pros: zero extra infra, simplest. Cons: a bad
push breaks **every** client's "business brain" simultaneously, with no catch between merge and
production. **Rejected** — unacceptable blast radius for systems clients run their business on.

**A2 — Per-deployment manual promotion.** Each client's deploy is approved individually. Pros:
maximal control. Cons: ~20 manual approvals per release; doesn't scale to the year-two target and
contradicts "one patch, everywhere" (`L23`). **Rejected** — over-manual.

**A3 — Canary + release-train (chosen).** A single **canary deployment** tracks a `release` branch
*ahead* of `main`; after it passes an automated smoke-test battery and a soak window, the change is
**promoted** by fast-forwarding `main`, at which point the fleet's Railway projects (which track
`main`) auto-deploy natively. Pros: catches "did it even boot / did the migration apply / are the
integrations wired" disasters **before any real client is touched**, while preserving ADR-001's
push-once-goes-everywhere automation; cost is ~1 extra deployment + minutes of soak. Cons: needs a
representative test corpus for the canary to be meaningful (see Axis 3). **Chosen** — standard
canary practice, right-sized: ~90% of the safety for ~10% of the effort.

### Axis 2 — Provisioning automation level

**B1 — Pure manual runbook.** A checklist only. Pros: nothing to build now. Cons: error-prone by
client #5 (a single missed env var silently breaks a deploy); contradicts ADR-001's "automation in
place before client #3–5." **Rejected.**

**B2 — Full IaC (Terraform over Supabase + Railway).** Everything as code. Pros: maximally
reproducible. Cons: large upfront build + maintenance for a system that provisions **≤ ~20 times
ever**; much of the per-client work (account creation, card, OAuth consent screens) *cannot* be
IaC'd because the client must do it under their own ownership (ADR-001 §5). **Rejected** — gold-plating
a ~20-run path.

**B3 — Scripted CLI + runbook (chosen).** A small operator-run **provisioning script** automates the
repeatable operator-side wiring (link Railway to the repo, set `DEPLOYMENT_CONFIG` + env secrets,
generate `internal_token`, insert the `client_registry` row, trigger first deploy → seed). A short
**runbook** covers the irreducibly human, client-owned steps (create Supabase/Anthropic/OpenAI/connector
accounts + add card + grant operator access; register + verify per-client OAuth apps). **Chosen** —
automates the boring/repeatable, documents the consent-gated; matches the ≤20-client ceiling and
ADR-001's hybrid ownership.

### Axis 3 — Making the canary meaningful when the operator has little/no real data

The operator's business is **new** — not enough real emails/content/events to exercise a canary.
An empty canary catches "won't boot / migration failed / integration misconfigured" (the majority
of deploy disasters) but is **blind to data-dependent regressions** (retrieval quality, memory
contradiction handling, agent routing).

**C1 — Wait for real traffic.** Rejected — there isn't any yet, and "hope production exercises it"
is not a test.

**C2 — Seeded synthetic test client + smoke-test battery (chosen, near-term).** The canary boots a
fixed **synthetic client**: curated fake-but-realistic entities, a small message/email corpus, and
seeded memories. A **smoke-test script** fires a deterministic battery of synthetic events after each
deploy and **asserts outputs** ("inbound email → filed correctly", "known-answer query → retrieves
it", "write a contradicting memory → contradiction caught"). Any failed assertion **blocks promotion
to `main`**. Deterministic, repeatable, and *the same fixture corpus the feasibility spikes already
need* (AF-001 cost, AF-002 retrieval) — built once, double duty.

**C3 — Operator dogfooding (chosen, maturing).** The operator (Transpera AI) runs **its own
deployment** as a real client; its own Gmail/Slack/etc. become live canary data that accrues
naturally as the business operates. Starts thin, fills over time, and aligns incentives (it's the
operator's own system that breaks first).

**Chosen: C2 now, C3 as it matures** — synthetic fixture + smoke tests give immediate, deterministic
coverage with zero real data; dogfooding layers real low-stakes traffic on top as it accumulates.

## Decision

Adopt **A3 + B3 + (C2 → C3)**. Seven binding parts:

**1. Deploy = Railway-native per-project auto-deploy; GitHub Actions is a test gate only.**
No custom fan-out CI exists (ADR-001 §6). Each client Railway project natively tracks `main` and
auto-deploys on push. GitHub Actions runs the test suite as a **merge gate into the release flow**,
not as a deployer.

**2. Blast radius is bounded by a canary + release-train.**
Branch model: feature branches → `release` (canary tracks this) → **promote** (fast-forward) → `main`
(the fleet tracks this).
   - The **canary deployment** auto-deploys from `release`, runs migrations against its own Supabase,
     then runs the **smoke-test battery** (part 6).
   - Promotion to `main` is gated on: tests green + migration applied cleanly on the canary + smoke
     battery green + soak window elapsed. Promotion is a deliberate operator action (or an automated
     job once trust is established), never every dev commit.
   - On `main`, the fleet auto-deploys natively (part 1). Per-deployment migration independence is
     retained (`L1141–1160`): a migration failure halts **only** that client, previous version stays
     live, alert fires.

**3. Version skew is a normal, bounded operating condition — not an error.**
Made safe by **backwards-compatible / expand-contract migrations** (`L1106–1136`: no destructive
change in the same migration; add-then-backfill-then-(later)-remove across releases). Because every
migration is additive/back-compatible, a `vN` client and a `vN-1` client each run correctly against
their own schema during a rollout. Bounds + visibility:
   - Each deployment reports `core_version` + last-migrated timestamp via the **push** snapshot
     (part 5); the management plane shows the fleet's version spread.
   - A **max-skew alert** fires when a deployment is more than `deploy_max_version_skew` behind, or
     more than `deploy_max_skew_days` stale (config-tunable), so laggards (e.g. a client stuck on a
     failed migration) are caught.

**4. Rollback = code-redeploy of the prior build; schema rolls *forward*.**
Railway retains build history, so rolling **code** back to the previous build is the rollback
primitive (per-deployment or fleet-wide). Migrations are **not auto-un-applied** (un-migration is
unsafe); the expand-contract discipline (part 3) is exactly what makes this safe — the previous
code runs fine against the newer schema. A bad schema change is fixed by **rolling forward** a
corrective migration, never by destructive down-migration in production.

**5. Provisioning is a scripted two-party process; the operator registers the deployment.**
   - **Client-owned (runbook, consent-gated):** create Supabase project (default region Sydney
     `ap-southeast-2` per ADR-001) + Anthropic/OpenAI accounts + connector SaaS (GHL/Google/Slack),
     put card on each, and **grant the operator delegated access** (e.g. Supabase service role key,
     OAuth app admin). ADR-001 §5.
   - **Operator-owned (provisioning script):** create + link the Railway project to the shared repo;
     set `DEPLOYMENT_CONFIG` (JSON, non-secret) + the env secrets (`L1052–1066`); **generate the
     `internal_token`** and write it to both the deployment's Railway env and the management DB
     (`L1200–1215`); **insert the `client_registry` row** (`L1222–1239`); trigger first deploy →
     the **idempotent seed script** (`L1130–1136`, `L671–691`) creates the Internal Org + first
     Super Admin and sets status `initialising`.
   - **Registration is operator-side** (the script inserts the registry row) — **no deployment
     self-registration**, which avoids the token chicken-and-egg (a deployment can't authenticate
     to register before it has a token). The deployment thereafter **pushes** snapshots using the
     provisioned `internal_token` (ADR-001 §7).

**6. OAuth apps are per-client, in the client's own accounts; the canary is a seeded synthetic client.**
   - **Per-client OAuth** (ADR-001 §5 — client owns connector SaaS): the operator, using delegated
     access, registers/configures the client's own OAuth apps (login provider `L360–369`; connector
     apps Gmail/Drive/Calendar/GHL/Slack `L2275–2291`), sets **redirect URIs to that deployment's
     Railway domain**, and drops the resulting `client_id`/`client_secret` into the deployment's
     Railway env. **Not** one shared operator app. ⚠️ Google **production verification** (`AF-013`,
     `L2275–2279`) has real lead time (days–weeks) — it is a **provisioning schedule dependency**,
     started early in onboarding.
   - **Canary corpus + smoke battery:** the canary boots a fixed **synthetic client** (curated fake
     entities, message/email corpus, seeded memories) and runs a deterministic **smoke-test battery**
     asserting boot, migration, connector wiring, and a set of **behavioral** checks (retrieval of
     known answers, memory contradiction detection, agent routing). Green battery is a promotion
     gate (part 2). This corpus is shared with the AF-001/AF-002 spikes.

**7. Plugins stay out of the release train.**
Per the doc (`L19–27`), `/plugins` is per-deployment, manually updated, and **never touched by a
core push**. ADR-005 keeps plugins **out of the auto-deploy fan-out**; the management plane reports
**plugin version per deployment** (`L3183–3203`) so the operator sees plugin drift. Automated plugin
distribution is explicitly **deferred** (out of scope, see OOS).

## Consequences

**Becomes true / required (new requirements to write):**
- **Release process FRs:** the `release`→canary→promote→`main` branch model; the promotion gate
  (tests + migration + smoke battery + soak); per-deployment migration-failure isolation + alert.
- **Provisioning FRs + the actual script:** the operator-side provisioning script (Railway link, env
  + `DEPLOYMENT_CONFIG`, `internal_token` mint + dual-store, `client_registry` insert, first-deploy
  trigger) and the client-side onboarding **runbook** (accounts + card + delegated access + OAuth
  registration & verification).
- **Migration discipline standard:** codify expand-contract / backwards-compatible migrations as a
  binding standard (a new `standards/migration-discipline.md`), since parts 3 + 4 *depend* on it.
- **Canary harness:** the synthetic test-client fixture + the smoke-test battery (boot + behavioral
  assertions), wired as a promotion gate; shared with the feasibility spikes.
- **Management plane:** `client_registry` carries `core_version` + last-migrated; Super Admin surfaces
  fleet version spread + the **max-skew alert**; plugin-version-per-deployment view (`L3183–3203`).
- **Config registry:** `deploy_max_version_skew`, `deploy_max_skew_days` (skew alerting);
  `canary_soak_minutes`; confirm `DEPLOYMENT_CONFIG` (non-secret JSON) vs the ~14 env secrets split.
- **Secrets custody → NFR-SEC:** operator Railway holds each client's Supabase service key + API
  keys + OAuth secrets + `internal_token`; never in the repo or in `DEPLOYMENT_CONFIG`. (Deep
  treatment deferred to NFR-SEC, consistent with ADR-001.)

**Ruled out:** instant-global deploy on every `main` push (A1); per-deployment manual promotion (A2);
full IaC provisioning (B2); pure-manual provisioning (B1); one shared operator OAuth app across
clients (contradicts ADR-001 §5); deployment self-registration to the management plane (token
chicken-and-egg); destructive down-migrations as the rollback path (replaced by code-rollback +
roll-forward).

**Feasibility (paper until proven):**
- **AF-004 (SPIKE, sharpened):** the end-to-end provisioning path actually wires up — an operator
  Railway app deploying from the shared repo against a **client-owned** Supabase, env + secrets +
  `internal_token` + `client_registry` row + first-boot seed, all green.
- **AF-020 (DOCS+SPIKE, sharpened):** Railway native per-project GitHub auto-deploy **and** running
  `drizzle-kit migrate` on release behave as assumed.
- **AF-064 (DOCS+SPIKE):** Railway supports the **branch-based canary/release-train + promotion**
  model assumed in part 2 (a `release`-tracking canary, fleet tracking `main`, build-history rollback
  in part 4). If Railway's branch/environment model differs, the *mechanism* changes but the
  *decision* (canary gate before fleet) stands.
- **AF-065 (SPIKE):** **expand-contract migrations keep a mixed-version fleet safe** — a `vN` and a
  `vN-1` deployment both run correctly against their own schema through a rollout, and prior code runs
  against the newer schema (the rollback premise of part 4). Parts 3 + 4 rest on this.
- **AF-066 (EVAL):** the **synthetic canary corpus + smoke battery is representative enough** to catch
  behavioral/data-dependent regressions (retrieval, contradiction, routing) before promotion — i.e.
  the canary isn't a false sense of safety. The honest limit of part 6: it only catches what its
  fixtures + assertions cover.

**Spawns:** no new OD. New standard `standards/migration-discipline.md` (expand-contract rules).
New OOS entry: automated plugin distribution/versioning deferred to v2 (part 7). Glossary gains:
*Canary deployment*, *Release train / promotion*, *Version skew*, *Expand-contract migration*,
*Provisioning script vs runbook*, *Synthetic canary corpus / smoke battery*. The "operator dogfoods
its own deployment" practice (part C3) should be cross-referenced when component 0 (onboarding) is
specced.
