# Build environments — where it's safe to build, and what needs your Mac

**Read this before building from a new place (phone, cloud, a second machine).** It answers one question:
*can this session touch live infrastructure (the client silo, Railway, real CLIs), or only do offline-safe
work?* The `scripts/build-preflight.sh` detector prints the verdict at session start (CLAUDE.md gate).

Grounded in the official Claude Code docs (cloud / remote-control / how-it-works), verified 2026-07-04.

## The three environments

| Env | What it is | Your Mac's secrets + authed CLIs? | Can it do live-infra steps? |
|---|---|---|---|
| **CLOUD** | A **fresh Anthropic-managed VM** with your GitHub repo cloned. This is what claude.ai/code and **building from your phone** use by default. | **No.** Nothing installed/configured only on your Mac carries over. | **No** (offline-safe work only) |
| **REMOTE CONTROL** | Your **Mac stays on**, driven from a browser/phone. Code runs on your machine. | **Yes** — your local secrets, `supabase`/`railway` sessions, `psql`, MCP are all live. | **Yes** |
| **LOCAL** | The `claude` CLI on your Mac. | **Yes** | **Yes** |

**The detector collapses these to:** `cloud` (offline-safe only) · `full` (Mac local **or** Remote Control —
live-infra OK) · `limited` (a local machine but secrets/CLIs missing → offline-safe until restored).

## Your question, answered directly

> *If I build on my phone, does it have access to the CLIs we use on the PC (supabase, railway, psql)?*

- **Phone via cloud (claude.ai/code): NO.** It's a fresh VM. `supabase login` / `railway login` are interactive
  browser auths that **cannot run** in a cloud session, `~/.ai-harness-secrets.env` isn't there, and it has no
  network trust to your client silo. It **cannot** apply migrations to the silo, provision, seed live, or run an
  AF-* live spike. (It *can* author code, run the tests / discipline gate / typecheck, commit, and open a PR — a
  large share of build work. The cloud VM even ships a Postgres **client**, but it's not authenticated to your silo.)
- **Phone via Remote Control: YES.** Remote Control drives your **Mac**, so every local CLI, secret, and auth is
  live exactly as if you were sitting at it. **This is the way to run live-infra steps from your phone** — keep the
  Mac on with a `claude` session, connect from the phone.

## The rule (what the guardrail enforces)

**Live-infra / "you-present" work runs ONLY in a `full` env (your Mac or Remote Control). A `cloud` session does
offline-safe work only.** A cloud session must never *attempt* a live-infra step — with no secrets/CLIs it can't
succeed, and a half-attempt against real infra is a #2/#3 risk.

**Offline-safe (any env, incl. cloud/phone):**
- authoring migrations, FRs, ADRs, issues, specs, decision-log entries
- `npm test`, `npm run check` (the discipline gate), `npm run typecheck`, unit/offline tests
- reading the repo, reconciling trackers, `git commit`, opening a PR

**You-present / live-infra (needs `full` — 🧑 in BUILD-SCHEDULE):**
- applying migrations to a silo (`app/silo` `npm run migrate` against `$SILO_DB_URL`)
- provisioning (`app/provisioning --execute`), live canary seeds, connector OAuth/live-auth
- any **AF-\*** live spike (AF-004 provisioning, AF-065 mixed-fleet, AF-069 restore, AF-077 brute-force, …)
- anything that reads/writes the client silo, Railway, or a vendor account with real credentials

**Rule of thumb:** if a step needs `source ~/.ai-harness-secrets.env`, a `supabase`/`railway`/`psql` call against
real infra, or an operator account → it's `full`-only. Everything else is offline-safe.

## Can you enable live infra *in the cloud*? (possible, not recommended)

You *could* let a cloud session reach live infra by putting **static tokens** (`SUPABASE_ACCESS_TOKEN`,
`RAILWAY_TOKEN`, a `SILO_DB_URL`) into the cloud **environment config** + a setup script that installs the CLIs.
**Don't, for this project.** The trade-offs (per the docs): the cloud env has **no dedicated secrets store** — env
vars/setup scripts are **visible in plaintext to anyone who can edit that environment**, calls originate from
Anthropic IPs (breaks IP allowlists), and tokens can't carry MFA. For a system whose #1/#2 invariants are *never
lose/corrupt knowledge* and *never do something it shouldn't*, live-infra credentials belong in the local security
boundary. **Use Remote Control for live-infra-from-phone instead** — same result, no credential sprawl.

## How the guardrail is wired

- **`scripts/build-preflight.sh`** — the detector. Prints the env + verdict. No network calls, no secrets printed,
  always exits 0.
- **CLAUDE.md → "Build environment gate"** — instructs every build session to run the preflight first and obey it
  (portable: the agent reads CLAUDE.md first on every device, incl. cloud).
- **`.claude/settings.json` SessionStart hook** — auto-runs the preflight so the verdict appears without asking.
  *(Committed so it also fires in the cloud VM; `.claude/settings.local.json` stays local/ignored.)*
- **BUILD-SCHEDULE.md `R8` (🧑 you-present)** — the per-stage marker for steps that need a `full` env. This doc is
  the environment-level companion to R8.
