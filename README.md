# The Dispatch

A self-hosted **remote MCP server** that Anthropic's Claude Code Routines call into to file daily research briefings, paired with a newspaper-styled dashboard for reading the results. One Node.js process; SQLite + filesystem archive; basic-auth on the dashboard; bearer auth on `/mcp`.

```
Claude Code Routines ──HTTPS + Bearer──▶ Caddy ──▶ Node/Express ──▶ SQLite + archive/
                                                       │
                                                       ├── /mcp       — Streamable HTTP, stateless, dual-bearer
                                                       ├── /api/*     — JSON (basic-auth)
                                                       └── /          — broadsheet SPA (basic-auth)
```

Full architecture notes: [`CLAUDE.md`](./CLAUDE.md). Implementation plan archived separately.

## What it is

- **`save_report` tool** — the routine's research pass ends by calling this; the server stores the markdown in SQLite, writes a PDF via `pdf-lib`, and the dashboard picks it up on its next poll.
- **`next_request` + request queue** — queue a "look into X on the next run" from the dashboard; the routine drains pending requests for its slug at the start of each run and atomically marks them fulfilled via `save_report({ request_ids: [...] })`. Failed runs leave requests pending.
- **Newspaper dashboard** — masthead + sidebar (topics, stats, queue-a-brief) + hero "LATEST DISPATCH" card + 2-col archive + reader overlay (`Esc` closes). Polls every 10s. Password-protected.
- **Two bearers on `/mcp`** — one for the Claude Cloud routine connector, one for a named local client (e.g. your desktop Claude Code). Rotate independently.

## Requirements

- Ubuntu/Debian VPS (no Docker) — other distros work, but `--bootstrap` only covers apt-based ones
- **Caddy** already running on the host (TLS terminator)
- A DNS record pointing `<your-host>` at the VPS

Node.js 20+, npm, pm2, openssl — `./install.sh --bootstrap` installs them for you if they're missing (Ubuntu/Debian), or bring your own.

## Install — scripted

**Fresh VPS** (no Node, no pm2 — auto-installs them):

```bash
git clone https://github.com/jha-adrs/the-dispatch.git ~/dispatch
cd ~/dispatch
./install.sh --bootstrap
```

**VPS already has Node 20+, pm2, openssl:**

```bash
git clone https://github.com/jha-adrs/the-dispatch.git ~/dispatch
cd ~/dispatch
./install.sh
```

Either way, the script:

1. Verifies / installs prerequisites (`--bootstrap` only: Node 20 via NodeSource, pm2 globally, build toolchain for `better-sqlite3`).
2. Runs `npm ci` (or `npm install` if no lockfile).
3. Generates **both** bearer tokens (`openssl rand -hex 32` each).
4. Interactively prompts for dashboard credentials, host, port.
5. Writes `.env` (mode 600), starts under pm2, offers to run `pm2 startup` for reboot survival.
6. Prints the two tokens **once** — save them somewhere; the routine bearer goes into the claude.ai custom connector; the client bearer goes into your local Claude Code MCP config.
7. Prints the Caddy site block to **append** to `/etc/caddy/Caddyfile` (never replaces the file).

Flags:
- `--bootstrap`: auto-install missing Node/pm2/build deps on Ubuntu/Debian (uses sudo).
- `--regen`: rotate bearer tokens on an existing install.

## Install — manual

```bash
git clone https://github.com/<you>/the-dispatch.git ~/dispatch
cd ~/dispatch
npm ci

cp .env.example .env
# Generate tokens:
echo "MCP_BEARER_TOKEN=$(openssl rand -hex 32)" >> .env.tokens
echo "MCP_CLIENT_TOKEN=$(openssl rand -hex 32)" >> .env.tokens
# ... edit .env with your host, dashboard user/pass, and the tokens above
chmod 600 .env

mkdir -p archive logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed command once to survive reboots
```

Then append a site block for your host to `/etc/caddy/Caddyfile`:

```caddy
dispatch.example.com {
    reverse_proxy localhost:8787
}
```

...and reload Caddy:

```bash
sudo caddy reload --config /etc/caddy/Caddyfile
```

## Register the connector on claude.ai

1. claude.ai → **Settings → Connectors → Add custom connector**
2. URL: `https://<your-host>/mcp`
3. Auth: `Bearer <MCP_BEARER_TOKEN>`
4. Save. The tool list should show `save_report`, `list_recent_reports`, `get_report_summary`, `next_request`.

## Create a routine

See [`docs/routine-prompt.md`](./docs/routine-prompt.md) for the prompt template and setup walkthrough. Routines are created at [claude.ai/code/routines](https://claude.ai/code/routines). Minimum schedule interval is 1 hour; daily run caps apply (Pro 5, Max/Team/Enterprise 25).

## Use the second client (optional)

Point any MCP-speaking HTTPS client (local Claude Code, another cloud agent, a cron-driven curl) at `https://<your-host>/mcp` with `Authorization: Bearer <MCP_CLIENT_TOKEN>`. The server logs the client label (`MCP_CLIENT_NAME`) with every tool call so you can tell them apart.

## Env vars

See [`.env.example`](./.env.example). All required:

| Var | Purpose |
| --- | --- |
| `PORT` | Local bind. Caddy reverse-proxies to this. |
| `MCP_BEARER_TOKEN` | Routine connector bearer. 64-hex. |
| `MCP_CLIENT_NAME` | Free-form label for the second client (e.g. `cli`). |
| `MCP_CLIENT_TOKEN` | Second-client bearer. 64-hex, independent from the routine's. |
| `MCP_EXPECTED_HOST` | DNS-rebinding defense. Must match the Host header on `/mcp`. |
| `DASHBOARD_USER` / `DASHBOARD_PASS` | Basic-auth for `/`, `/api/*`, `/report/*`. |
| `DB_PATH`, `ARCHIVE_DIR` | Storage paths. |
| `PUBLIC_BASE_URL` | Used to build the `url` field on `save_report` responses. |

## Ops

```bash
pm2 logs dispatch           # tail
pm2 restart dispatch        # after editing .env
pm2 describe dispatch       # health
npm test                    # vitest
```

## Backup

`reports.db` + `archive/` are all the state. A nightly `rsync archive/ reports.db* offsite:dispatch/` covers you. SQLite is in WAL mode — back up all three files (`*.db`, `*-wal`, `*-shm`) or run `sqlite3 reports.db .backup` first.

## Not built (v1)

- Rate limiting on `/mcp` (routines run on fixed cadence; real load is tiny)
- Full-text search over reports (slug filter is sufficient while the corpus is small)
- Edit/delete from UI (read-only by design)
- Dashboard "Run now" button that fires a routine via its `/fire` API endpoint
- Slug-less ad-hoc requests

## Security

Public repo. **Nothing sensitive is ever committed** — `.env` is gitignored, `.env.example` has placeholders, tokens are generated at install time. Rotate the routine bearer by editing `.env` and `pm2 restart dispatch`; you'll need to update the claude.ai connector auth header. Same for the client bearer.

## License

MIT, if you want to lift any of this.
