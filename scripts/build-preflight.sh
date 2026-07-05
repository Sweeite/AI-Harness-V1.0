#!/usr/bin/env bash
# build-preflight.sh — "is it safe to build here, and what kind of work?"
#
# Detects which environment this session is running in and prints a verdict telling the operator (and
# the agent) whether LIVE-INFRA work is possible or only OFFLINE-SAFE work. Run at the start of every
# build session (CLAUDE.md "Build environment gate"; also wired as a SessionStart hook).
#
# Environments (see spec/00-foundations/build-environments.md):
#   • cloud        — a fresh Anthropic-managed VM (claude.ai/code / phone). NO access to your Mac's
#                    secrets, authenticated CLIs, or the client silo. Offline-safe work ONLY.
#   • full         — your Mac locally, or a phone driving your Mac via Remote Control. Has the local
#                    secrets file + authenticated supabase/railway CLIs. Live-infra steps OK.
#   • limited      — a local machine but the secrets file and/or CLIs are missing. Offline-safe only.
#
# Never fails a session — always exits 0. Makes no network calls (fast). Prints no secret values.

set -u
SECRETS="$HOME/.ai-harness-secrets.env"

has() { command -v "$1" >/dev/null 2>&1; }
psql_ok() { has psql || [ -x /opt/homebrew/opt/libpq/bin/psql ]; }

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  MODE=cloud
elif [ -f "$SECRETS" ] && has supabase && has railway; then
  MODE=full
else
  MODE=limited
fi

echo "──────────────────────────────────────────────────────────────────────────"
case "$MODE" in
  cloud)
    echo "🌩️  BUILD ENV: CLOUD (fresh Anthropic VM — claude.ai/code / phone)."
    echo "    SAFE (offline-safe work only):"
    echo "      • author migrations / spec / issues, run  npm test · npm run check · typecheck"
    echo "      • git commit + open a PR"
    echo "    BLOCKED (needs a FULL env — your Mac or Remote Control):"
    echo "      • applying migrations to a silo, provisioning, live seeds, connector live-auth,"
    echo "        any AF-* live spike — i.e. every 🧑 you-present step. No silo/Railway CLIs or secrets here."
    echo "    → To do live-infra work from your phone, use REMOTE CONTROL (drives your Mac), not cloud."
    ;;
  full)
    echo "💻  BUILD ENV: FULL (your Mac, or phone via Remote Control)."
    echo "    Secrets file present + supabase & railway CLIs installed. psql: $(psql_ok && echo yes || echo 'via /opt/homebrew/opt/libpq/bin/psql')."
    echo "    Live-infra steps OK. Before any live step:  source ~/.ai-harness-secrets.env"
    echo "    Follow the R1-R9 safety contract (BUILD-SCHEDULE.md) + reconcile trackers first (Rule 0)."
    ;;
  limited)
    echo "⚠️   BUILD ENV: LIMITED (local machine, but secrets file and/or CLIs missing)."
    echo "    Offline-safe work only until restored:"
    [ -f "$SECRETS" ] || echo "      • missing ~/.ai-harness-secrets.env"
    has supabase       || echo "      • supabase CLI not found / not authenticated"
    has railway        || echo "      • railway CLI not found / not authenticated"
    echo "    Do NOT attempt live-infra (you-present) steps until these are back."
    ;;
esac
echo "    Detail: spec/00-foundations/build-environments.md"
echo "──────────────────────────────────────────────────────────────────────────"
exit 0
