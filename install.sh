#!/usr/bin/env bash
# The Dispatch — scripted install.
# Assumes Node 20+, pm2, and Caddy are already installed on the host.
# Idempotent: safe to re-run. Does not touch an existing .env unless you pass --regen.

set -euo pipefail

cd "$(dirname "$0")"

REGEN=0
for a in "$@"; do
  case "$a" in
    --regen) REGEN=1 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
  esac
done

command -v node >/dev/null || { echo "need node >=20 on PATH"; exit 1; }
command -v npm  >/dev/null || { echo "need npm on PATH"; exit 1; }
command -v pm2  >/dev/null || { echo "need pm2 on PATH (npm i -g pm2)"; exit 1; }
command -v openssl >/dev/null || { echo "need openssl on PATH"; exit 1; }

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "node >=20 required, got $(node -v)" >&2
  exit 1
fi

echo "→ installing npm deps"
npm ci --omit=dev --no-audit --no-fund

if [[ -f .env && "$REGEN" -eq 0 ]]; then
  echo "→ .env exists, leaving untouched (pass --regen to rotate tokens)"
else
  ROUTINE_TOKEN="$(openssl rand -hex 32)"
  CLIENT_TOKEN="$(openssl rand -hex 32)"
  read -rp "Dashboard username [editor]: " DUSER;  DUSER=${DUSER:-editor}
  read -rp "Dashboard password: " -s DPASS; echo
  read -rp "MCP expected Host (e.g. dispatch.platinumj.xyz): " MHOST
  read -rp "Public base URL [https://$MHOST]: " PUB; PUB=${PUB:-https://$MHOST}
  read -rp "Local bind port [8787]: " PORT; PORT=${PORT:-8787}
  read -rp "Second client label [cli]: " CLI; CLI=${CLI:-cli}

  umask 077
  cat > .env <<ENV
PORT=$PORT
MCP_BEARER_TOKEN=$ROUTINE_TOKEN
MCP_CLIENT_NAME=$CLI
MCP_CLIENT_TOKEN=$CLIENT_TOKEN
MCP_EXPECTED_HOST=$MHOST
DASHBOARD_USER=$DUSER
DASHBOARD_PASS=$DPASS
DB_PATH=./reports.db
ARCHIVE_DIR=./archive
PUBLIC_BASE_URL=$PUB
ENV
  chmod 600 .env
  echo
  echo "────────────────────────────────────────────────────────────────────"
  echo "  Wrote .env with two freshly-generated bearer tokens (mode 600)."
  echo "  Save these somewhere safe — they are shown ONCE:"
  echo
  echo "  MCP_BEARER_TOKEN (Claude Routine connector):"
  echo "    $ROUTINE_TOKEN"
  echo
  echo "  MCP_CLIENT_TOKEN (label: $CLI):"
  echo "    $CLIENT_TOKEN"
  echo "────────────────────────────────────────────────────────────────────"
  echo
fi

mkdir -p archive logs
echo "→ starting under pm2"
pm2 start ecosystem.config.cjs --update-env
pm2 save

echo
echo "Next steps:"
echo
echo "  1. Append this block to /etc/caddy/Caddyfile (do NOT replace the file):"
echo
PORT_LINE=$(grep -E '^PORT=' .env | cut -d= -f2)
MHOST_LINE=$(grep -E '^MCP_EXPECTED_HOST=' .env | cut -d= -f2)
cat <<CADDY

${MHOST_LINE} {
    reverse_proxy localhost:${PORT_LINE}
}

CADDY
echo "  2. sudo caddy reload --config /etc/caddy/Caddyfile"
echo "  3. Register the MCP connector on claude.ai → Settings → Connectors:"
echo "       URL:  https://${MHOST_LINE}/mcp"
echo "       Auth: Bearer <MCP_BEARER_TOKEN above>"
echo "  4. Point local Claude Code (or other MCP client) at the same URL"
echo "     using MCP_CLIENT_TOKEN for the second client."
