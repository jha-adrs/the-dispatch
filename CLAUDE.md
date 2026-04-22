# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**The Dispatch** — a self-hosted remote MCP server that Anthropic's Claude Routines call into via a custom connector, paired with a newspaper-styled dashboard for reading the reports Claude files. Both halves run in a single Node.js process on a VPS.

Domain: `dispatch.platinumj.xyz`. TLS is terminated by an existing Caddy install (`/etc/caddy/Caddyfile`); we only append a new site block, never rewrite it.

**This is a public repo.** No secrets, tokens, or hostnames-with-keys in committed files. All runtime config comes from `.env` (gitignored). `.env.example` is committed.

## Architecture

One Node.js process serves two surfaces from the same Express app, against the same SQLite DB and `archive/` folder:

```
Claude Cloud (Routines) ──HTTPS + Bearer──▶ Caddy ──▶ Express
                                                       ├── POST/GET/DELETE /mcp   (MCP Streamable HTTP, bearer auth)
                                                       ├── GET  /api/*           (dashboard JSON, basic-auth)
                                                       └── GET  /                (SPA, basic-auth)
                                                              │
                                                              ▼
                                                   SQLite (reports.db) + archive/{id}.{md,pdf}
```

- **MCP transport:** `@modelcontextprotocol/sdk` with `StreamableHTTPServerTransport` in **stateless mode** (`sessionIdGenerator: undefined`, `enableJsonResponse: true`). Each tool call is a one-shot; no session state. The SDK dispatches POST/GET/DELETE on `/mcp` itself — mount one handler for all three verbs.
- **Auth split:**
  - `/mcp` — `Authorization: Bearer ${MCP_BEARER_TOKEN}` checked in Express middleware *before* the SDK sees the request. Also validate `Host` matches `MCP_EXPECTED_HOST` (DNS-rebinding defense the MCP spec calls out).
  - `/` and `/api/*` — `express-basic-auth` with `DASHBOARD_USER` / `DASHBOARD_PASS`. Keep auth minimal; do not reach for Passport.
- **Report ID:** `{UTC_YYYYMMDDTHHMMSSZ}_{topic_slug}` — sortable, unique, human-readable. Used as filename stem *and* DB primary key.
- **Persistence is dual:** the canonical store is SQLite (metadata + summary + word count + sources), but the markdown and PDF are also written to `archive/{id}.md` and `archive/{id}.pdf` so they can be downloaded directly and survive a DB rebuild (rehydratable).
- **Markdown contract enforced by `save_report`:** body must start with `# ` (the title line) and contain `**TL;DR:**` somewhere in the first section. Reject with `isError: true` if not — never throw from a tool handler.
- **PDF rendering is server-side** via `pdf-lib`. Dashboard rendering is client-side via `marked` loaded from CDN — no server-side markdown dep for the reader view.
- **Dashboard is a single static SPA** (`public/index.html`) that polls `/api/stats`, `/api/slugs`, `/api/reports` every 10s. **No `localStorage`/`sessionStorage`** — hosting doesn't support them; all state lives in memory or comes from the API.

## MCP tools (exposed on `/mcp`)

All inputs validated with Zod. Errors return `{ isError: true, content: [...] }` — never throw.

- `save_report({ topic_slug, title, markdown_body, sources? })` → validates markdown contract, extracts TL;DR, renders PDF, writes files + DB row, returns `{ id, url, word_count, sources_count }` JSON-stringified in a text block. If `sources` omitted, extract URLs from markdown.
- `list_recent_reports({ topic_slug?, limit? })` → `limit` defaults 10, caps at 50. Returns `[{ id, title, slug, received_at, word_count }]`.
- `get_report_summary({ id })` → `{ id, title, summary, received_at, slug }`.

`topic_slug` regex: `/^[a-z0-9][a-z0-9-]{0,63}$/`. Enforce in Zod, not ad-hoc.

## Dashboard aesthetic (non-negotiable)

Editorial broadsheet, not admin panel. Palette: cream `#f4ede1`, ink `#111`, red `#b8290c`, muted `#6a6358`. Fonts: Fraunces (display serif), JetBrains Mono, Inter. Subtle dot-pattern background via `radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px)` at `4px 4px`. Masthead: date/vol/count row → rule → "The *Dispatch*" centered at `clamp(48px, 9vw, 110px)` with "Dispatch" italic red → rule → byline. Grid: `280px sidebar + fluid main`, collapses under 900px. Reader overlay: 68ch measure, serif 18px/1.65, red underlined links, dashed hr, red-left-border blockquote, Esc closes.

## Deploy model

- No Docker. Deploy directly on Ubuntu/Debian host.
- Node.js **20+**. `pm2` for process supervision (`pm2 start ecosystem.config.cjs`, `pm2 save`, `pm2 startup`).
- Caddy already running — append a site block for `dispatch.platinumj.xyz` that reverse-proxies to the Node process's local port. Never overwrite the file.
- Generate bearer once at setup: `openssl rand -hex 32` → `.env` as `MCP_BEARER_TOKEN`. Paste the same value into the Claude Routine connector config.
- Offer the user installation choices (bash one-liner script vs. manual step-through) rather than assuming.

## Commits

Fresh repo at `~/dispatch/`. Conventional commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`). Commit in discrete, reviewable units — one concern per commit.

## Env vars (all required unless noted)

```
PORT                  # local bind, e.g. 8787
MCP_BEARER_TOKEN      # 64-hex, paste into routine connector
MCP_EXPECTED_HOST     # e.g. dispatch.platinumj.xyz
DASHBOARD_USER
DASHBOARD_PASS
DB_PATH               # default ./reports.db
ARCHIVE_DIR           # default ./archive
PUBLIC_BASE_URL       # e.g. https://dispatch.platinumj.xyz, used to build report URLs
```

## Common commands

```bash
npm install
npm run dev           # nodemon, loads .env
npm start             # production entry (pm2 runs this)
npm test              # vitest; run a single test file: npx vitest run path/to/x.test.js
pm2 logs dispatch     # tail logs on the VPS
pm2 restart dispatch
```
