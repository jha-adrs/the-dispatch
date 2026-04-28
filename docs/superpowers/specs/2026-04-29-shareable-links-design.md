# Shareable public links for reports — design

**Date:** 2026-04-29
**Status:** Approved (brainstorming complete; ready for implementation plan)

## Context

The Dispatch dashboard is gated by basic-auth — every report is private. The user wants to share individual reports with people who don't have the dashboard credentials (an article worth forwarding, a brief sent to a colleague). This spec adds per-report shareable public links — possession of the link grants read-only access to that one report, nothing else.

Scope is intentionally tight: a single new column on `reports`, three public routes, two basic-auth API routes, one new button in the reader overlay, and a server-rendered public page. No analytics, no expiry, no per-recipient links, no Open Graph image generation.

## Capability model

**The token IS the capability.** A 128-bit random token (32 hex chars) is generated on demand and stored in `reports.share_token`. Anyone in possession of the URL `/s/<token>` can read that one report; nothing else is exposed.

- **Opt-in.** Reports start with `share_token = NULL` (not shareable). The owner clicks "Share" in the reader to mint a token.
- **Stable.** A given report has at most one active token at a time. Re-clicking "Share" while one already exists returns the same URL.
- **Revocable.** "Revoke" sets `share_token = NULL`. The old URL 404s immediately. A future "Share" click mints a fresh, unrelated token.
- **No expiry, no analytics.** Privacy-first. The owner controls revocation manually.
- **noindex.** The public route emits `X-Robots-Tag: noindex` and `<meta name="robots" content="noindex">` so search engines don't ingest the content even if a token leaks.

## Data model

One additive change to the existing `reports` table — no migration of existing rows.

```sql
ALTER TABLE reports ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_share_token
  ON reports(share_token) WHERE share_token IS NOT NULL;
```

The partial unique index allows many `NULL` rows but enforces uniqueness across the set of issued tokens. Collision probability with `crypto.randomBytes(16)` is negligible; the unique index makes it safe by construction (a colliding insert would fail and trigger one regeneration retry server-side).

`src/db.js` runs the `ALTER TABLE` and `CREATE INDEX IF NOT EXISTS` at server boot, guarded by `PRAGMA table_info(reports)` so existing installs upgrade transparently on `pm2 restart dispatch` and new installs don't double-add.

## Endpoints

| Route                              | Auth        | Purpose                                                                 |
| ---------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `POST /api/reports/:id/share`      | basic-auth  | If `share_token` already set, return existing URL. Otherwise generate, store, return `{ token, url }`. |
| `DELETE /api/reports/:id/share`    | basic-auth  | Set `share_token = NULL`. Returns `{ revoked: true }`. Idempotent.      |
| `GET /s/:token`                    | **none**    | Server-rendered HTML page: broadsheet masthead, OG/Twitter meta tags, article body via `marked` from CDN. `X-Robots-Tag: noindex` header. |
| `GET /s/:token/pdf`                | **none**    | Streams the PDF for that report. `Content-Disposition: inline`.         |
| `GET /s/:token/md`                 | **none**    | Streams the raw markdown. `Content-Type: text/markdown; charset=utf-8`. |

`GET /api/report/:id` (existing, basic-auth) gains one extra field in its JSON: `share_token` (string or null). The reader overlay reads this to show the existing URL without an extra round trip.

Token format check (`/^[a-f0-9]{32}$/`) runs before any DB lookup on the public routes, so bots probing random paths don't hit the DB.

## UI

### Dashboard reader overlay (`public/index.html`)

The reader's action bar (currently `⬇ PDF` and `Markdown`) gains a third action: **Share**. Clicking it:

1. If `share_token` is null in the loaded report data, POST `/api/reports/:id/share`. Update the local report state with the returned token.
2. Render a small inline panel below the action bar:
   ```
   Share link: https://dispatch.platinumj.xyz/s/abcd1234…  [Copy]  [Revoke]
   ```
3. **Copy** writes the URL to `navigator.clipboard.writeText(...)` and flashes a brief "Copied" indicator.
4. **Revoke** sends DELETE, hides the panel, clears the token from local state. The Share button is shown again so the owner can re-share if they want (with a fresh token).

No confirmation modals — revoke is one click.

### Public page `/s/:token`

Server-rendered HTML, no SPA poll. Same Fraunces / Inter / JetBrains Mono fonts loaded from Google. Same dot-pattern background. Same color palette.

```
┌─────────────────────────────────────────────────┐
│  ───────────  Wednesday, 29 April 2026  ─────  │
│             The   Dispatch                       │  (masthead, italic red 'Dispatch')
│  ───────────────────────────────────────────   │
│  ⬇ PDF  ·  Markdown  ·  ←  the-dispatch         │
│                                                 │
│           # Markets close 29 Apr — RBI focus    │
│                                                 │
│           Date: 2026-04-29                      │
│           TL;DR: Nifty closed 24,250…           │  (68ch column,
│           ## Key Findings                       │   serif 18px/1.65,
│           - …                                   │   red H2s)
│                                                 │
│  Filed by Claude on 29 April 2026 ·            │
│  the-dispatch.platinumj.xyz                    │  (footer)
└─────────────────────────────────────────────────┘
```

The page contains:
- `<head>` with `<title>`, `<meta name="robots" content="noindex">`, OG tags (`og:title`, `og:description` = TL;DR truncated to 200 chars, `og:url`, `og:type=article`, `og:site_name=The Dispatch`), Twitter Card tags (`twitter:card=summary`).
- Inline `<style>` with the broadsheet CSS subset (no sidebar/archive styles).
- The markdown embedded in a `<script id="md" type="text/markdown">…</script>` element.
- A small bootstrap script that loads `marked` from CDN and pipes the script's textContent into a render container.

This separation keeps `marked` off the critical path for crawlers (they only need the OG tags, which are server-emitted) while humans get the rich render.

## Files to modify

- `src/db.js` — add `share_token` column + partial index + idempotent migration. New prepared statements: `setShareToken`, `clearShareToken`, `getReportByShareToken`.
- `src/api.js` — add `POST /api/reports/:id/share`, `DELETE /api/reports/:id/share`. Extend `GET /api/report/:id` to include `share_token`.
- `src/server.js` — register a new public router for `GET /s/:token`, `GET /s/:token/pdf`, `GET /s/:token/md` **before** the basic-auth middleware so it's not gated.
- `src/share.js` (new) — render the public HTML page (template literal, no template engine). Lives separate from `api.js` so the HTML stays out of the JSON-API code.
- `public/index.html` — add the Share action button + inline panel + Copy/Revoke handlers. Update the report data model to carry `share_token`.
- `test/share.test.js` (new) — covers token generation, idempotent re-share, revoke, public route 404 on bad/unknown/revoked tokens, OG tag presence in HTML.

## Error handling

- `POST /share` for unknown report id → 404 `{error: "report not found"}`.
- `DELETE /share` is idempotent — both "had a token" and "didn't have one" paths return 200 with `{revoked: true}`.
- `GET /s/:token` with malformed token (regex fail) → 404 (no DB hit).
- `GET /s/:token` with unknown/revoked token → 404 served as a styled "Link no longer active" page (same masthead, single line of body).
- `GET /s/:token/pdf` when `archive.readPdf` returns null → 410 Gone.
- Token-collision on insert (statistically nil but defensive): catch the unique-constraint error and regenerate once; bail with 500 if the second attempt also collides.

## Testing

**Unit / integration (`vitest`):**
- `setShareToken` writes a 32-hex value, returns the token.
- Re-calling `setShareToken` on a report that already has a token returns the existing token (no rotation on second click).
- `clearShareToken` sets to NULL; subsequent lookups return null.
- `getReportByShareToken` returns the row for a valid token, null for unknown, null after revoke.
- Token format regex rejects non-hex / wrong-length input before DB.
- Public HTML response contains `og:title`, `og:description`, `og:url`, `twitter:card`, `<meta name="robots" content="noindex">`.

**End-to-end (manual + automated):**
- Create a report → click Share in the reader → copy URL → open in a private window (no auth cookie) → article renders with masthead, OG tags present in view-source, PDF download works.
- Revoke → reload the share URL → 404 page shown.
- Re-Share after revoke → new token; old URL stays 404.
- `curl https://dispatch.platinumj.xyz/s/<32 zeros>` → 404 with `noindex` header.

## Out of scope (v1)

- Open Graph **image** generation (a custom card image per report). Text OG tags still produce decent Slack/iMessage previews; image gen would require a renderer (canvas/satori) and image storage. Defer.
- Per-recipient links, expiring links, view-count analytics — all "share = capability" simplifications we're explicitly choosing.
- Multi-user / per-user sharing semantics — single-user app.
- Edit history / track changes — not relevant; reports are immutable.

## Verification checklist (post-implementation)

- [ ] Schema migration runs cleanly on the existing production VPS (no DB rebuild).
- [ ] All existing tests still pass (token-introducing changes don't regress).
- [ ] New share-flow tests pass.
- [ ] Manual smoke from a private browser window confirms the article + OG preview.
- [ ] `curl -I https://.../s/<token>` shows `X-Robots-Tag: noindex`.
- [ ] No newly-public route leaks anything beyond the single shared report.
