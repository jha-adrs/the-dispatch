#!/usr/bin/env bash
# The Dispatch — scripted install.
#
# Default mode:   assumes Node 20+, npm, pm2, and openssl are already on PATH.
# --bootstrap:    on Ubuntu/Debian, installs missing system deps (Node 20 via
#                 NodeSource, pm2 globally) using sudo. Caddy is out of scope —
#                 bring your own TLS terminator.
# --regen:        rotate bearer tokens in an existing .env.
#
# Idempotent. Safe to re-run.

set -euo pipefail

cd "$(dirname "$0")"

REGEN=0
BOOTSTRAP=0
for a in "$@"; do
  case "$a" in
    --regen) REGEN=1 ;;
    --bootstrap) BOOTSTRAP=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

have() { command -v "$1" >/dev/null 2>&1; }
ask_yes() {
  local q="$1"
  read -rp "$q [y/N] " a
  [[ "$a" == "y" || "$a" == "Y" ]]
}

sudo_cmd() {
  if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

install_node_nodesource() {
  # NodeSource setup script for Node 20.x on Debian/Ubuntu.
  # Safe and idempotent; re-running just refreshes the apt source.
  if ! have curl; then sudo_cmd apt-get update -y && sudo_cmd apt-get install -y curl ca-certificates; fi
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo_cmd -E bash -
  sudo_cmd apt-get install -y nodejs
}

bootstrap_prereqs() {
  if [[ ! -f /etc/debian_version ]]; then
    echo "--bootstrap only supports Debian/Ubuntu. On other distros, install Node 20+, npm, pm2, openssl manually, then re-run without --bootstrap." >&2
    exit 1
  fi

  echo "→ bootstrap: checking / installing system deps"
  sudo_cmd apt-get update -y

  if ! have openssl; then sudo_cmd apt-get install -y openssl; fi
  if ! have git;     then sudo_cmd apt-get install -y git; fi
  if ! have curl;    then sudo_cmd apt-get install -y curl ca-certificates; fi

  # Build toolchain for better-sqlite3's native prebuild fallback.
  # NodeSource packages include npm. On minimal images we also need build-essential
  # + python3 only if prebuilds are unavailable for the platform.
  sudo_cmd apt-get install -y build-essential python3

  local need_node=1
  if have node; then
    local v
    v=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
    [[ "$v" -ge 20 ]] && need_node=0
  fi
  if [[ "$need_node" -eq 1 ]]; then
    echo "→ installing Node 20.x via NodeSource"
    install_node_nodesource
  else
    echo "→ Node $(node -v) already OK"
  fi

  if ! have pm2; then
    echo "→ installing pm2 globally"
    sudo_cmd npm install -g pm2
  else
    echo "→ pm2 already present: $(pm2 -v)"
  fi
}

# ── bootstrap phase ────────────────────────────────────────────────────────
if [[ "$BOOTSTRAP" -eq 1 ]]; then
  bootstrap_prereqs
fi

# ── dependency preflight ───────────────────────────────────────────────────
missing=()
for tool in node npm pm2 openssl; do
  have "$tool" || missing+=("$tool")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "missing on PATH: ${missing[*]}" >&2
  echo "re-run with --bootstrap to auto-install on Ubuntu/Debian, or install them yourself." >&2
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "node >=20 required, got $(node -v)" >&2
  echo "on Ubuntu/Debian: re-run with --bootstrap to upgrade via NodeSource." >&2
  exit 1
fi

# ── install app deps ───────────────────────────────────────────────────────
echo "→ installing npm deps"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi

# ── env file ───────────────────────────────────────────────────────────────
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

# pm2 startup (only on first install, and only if user consents)
if ! pm2 startup --help >/dev/null 2>&1; then :; fi
if [[ ! -f /etc/systemd/system/pm2-"$USER".service ]] 2>/dev/null; then
  echo
  if ask_yes "→ run 'pm2 startup' so the app survives reboots? (prints a sudo command for you to run)"; then
    pm2 startup || true
  fi
fi

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
