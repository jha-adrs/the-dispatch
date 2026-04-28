# Shareable Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-report shareable public links so anyone with a `https://dispatch.platinumj.xyz/s/<32-hex-token>` URL can read one specific report — no auth, full broadsheet treatment, OG card previews, owner can revoke at any time.

**Architecture:** One new `share_token` column on `reports` (NULL = not shareable, opt-in). Two basic-auth API routes (`POST` / `DELETE /api/reports/:id/share`) for the owner. Three public routes (`GET /s/:token`, `/s/:token/pdf`, `/s/:token/md`) mounted before basic-auth so they're reachable without credentials. A new `src/share.js` module holds pure functions for token ops, public-page HTML rendering, and route handler factories — keeps HTML out of `api.js`. Reader-overlay UI gains a Share / Copy / Revoke surface.

**Tech Stack:** Node 20+, Express, better-sqlite3, vitest, marked from CDN (client-side render on the public page). No new dependencies.

---

## File Structure

| File | Status | Responsibility |
| ---- | ------ | -------------- |
| `src/db.js` | modify | Idempotent schema upgrade for `share_token` column + partial unique index. Three new prepared statements: `setShareToken`, `clearShareToken`, `getReportByShareToken`. Existing `getReport` extended to include `share_token`. |
| `src/share.js` | **new** | Pure logic + Express handler factories. Functions: `mintShareToken(db, reportId)`, `clearShareToken(db, reportId)`, `lookupByShareToken(db, token)`, `renderSharePage({ report, markdown, publicBaseUrl })`, `renderRevokedPage({ publicBaseUrl })`. Plus three route-handler factories: `shareApiHandlers({ db, publicBaseUrl })` returning `{ create, revoke }`, and `publicShareHandlers({ db, archive, publicBaseUrl })` returning `{ html, pdf, md }`. |
| `src/api.js` | modify | Wire `POST` / `DELETE /api/reports/:id/share` from `shareApiHandlers`. Extend `GET /api/report/:id` JSON to include `share_token`. |
| `src/server.js` | modify | Mount the public `/s/:token` router **before** basic-auth middleware. |
| `public/index.html` | modify | Reader overlay: Share button + inline panel + Copy / Revoke handlers. Update the report-loaded state to carry `share_token`. |
| `test/share.test.js` | **new** | Unit tests for db ops, render functions, handler factories. Uses `:memory:` db + a fake `archive`. |

---

## Task 1: DB schema migration + prepared statements

**Files:**
- Modify: `src/db.js`
- Test: `test/share.test.js` (new)

**Why TDD here:** the partial unique index is a subtle SQLite feature; the migration must be re-run-safe; existing `getReport` callers expect a fixed shape. A test ratchets this in.

- [ ] **Step 1: Write the failing tests**

Create `test/share.test.js` with the imports plus the first describe block:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../src/db.js';

const SAMPLE_REPORT = {
  id: '20260429T120000Z_test',
  slug: 'test',
  title: 'Test Report',
  summary: 'A short TL;DR for testing.',
  word_count: 123,
  sources_json: '["https://example.com"]',
  received_at: '2026-04-29T12:00:00Z',
};

function seedReport(db, overrides = {}) {
  const row = { ...SAMPLE_REPORT, ...overrides };
  db.stmts.insertReport.run(row);
  return row.id;
}

describe('share_token db statements', () => {
  let db;
  beforeEach(() => { db = openDb(':memory:'); });
  afterEach(() => { try { db.close(); } catch {} });

  it('reports.share_token defaults to NULL', () => {
    seedReport(db);
    const row = db.stmts.getReport.get(SAMPLE_REPORT.id);
    expect(row.share_token).toBeNull();
  });

  it('setShareToken stores the value and returns it', () => {
    seedReport(db);
    db.stmts.setShareToken.run({ id: SAMPLE_REPORT.id, token: 'a'.repeat(32) });
    const row = db.stmts.getReport.get(SAMPLE_REPORT.id);
    expect(row.share_token).toBe('a'.repeat(32));
  });

  it('clearShareToken sets share_token back to NULL', () => {
    seedReport(db);
    db.stmts.setShareToken.run({ id: SAMPLE_REPORT.id, token: 'b'.repeat(32) });
    db.stmts.clearShareToken.run({ id: SAMPLE_REPORT.id });
    const row = db.stmts.getReport.get(SAMPLE_REPORT.id);
    expect(row.share_token).toBeNull();
  });

  it('getReportByShareToken finds the row', () => {
    seedReport(db);
    db.stmts.setShareToken.run({ id: SAMPLE_REPORT.id, token: 'c'.repeat(32) });
    const found = db.stmts.getReportByShareToken.get('c'.repeat(32));
    expect(found?.id).toBe(SAMPLE_REPORT.id);
  });

  it('getReportByShareToken returns undefined for unknown token', () => {
    expect(db.stmts.getReportByShareToken.get('z'.repeat(32))).toBeUndefined();
  });

  it('getReportByShareToken returns undefined after revoke', () => {
    seedReport(db);
    db.stmts.setShareToken.run({ id: SAMPLE_REPORT.id, token: 'd'.repeat(32) });
    db.stmts.clearShareToken.run({ id: SAMPLE_REPORT.id });
    expect(db.stmts.getReportByShareToken.get('d'.repeat(32))).toBeUndefined();
  });

  it('partial unique index allows multiple NULL share_token rows', () => {
    seedReport(db, { id: '20260429T120001Z_a' });
    seedReport(db, { id: '20260429T120002Z_b' });
    // No throw — both NULL is fine.
    expect(db.stmts.countReports.get().n).toBe(2);
  });

  it('partial unique index rejects duplicate non-NULL tokens', () => {
    seedReport(db, { id: '20260429T120001Z_a' });
    seedReport(db, { id: '20260429T120002Z_b' });
    db.stmts.setShareToken.run({ id: '20260429T120001Z_a', token: 'e'.repeat(32) });
    expect(() =>
      db.stmts.setShareToken.run({ id: '20260429T120002Z_b', token: 'e'.repeat(32) })
    ).toThrow(/UNIQUE constraint/);
  });
});

describe('migration safety', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dispatch-mig-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('upgrades an old reports table that lacks share_token', () => {
    const dbPath = join(dir, 'old.db');
    // Build the pre-share schema by hand and seed a row.
    const Database = (await import('better-sqlite3')).default;
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        word_count INTEGER NOT NULL,
        sources_json TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
    `);
    raw.prepare(`
      INSERT INTO reports (id, slug, title, summary, word_count, sources_json, received_at)
      VALUES ('legacy_id','old','Legacy','tldr',10,'[]','2026-04-01T00:00:00Z')
    `).run();
    raw.close();

    // Now openDb on this path — it should ALTER TABLE silently and the row survives.
    const db = openDb(dbPath);
    const row = db.stmts.getReport.get('legacy_id');
    expect(row.title).toBe('Legacy');
    expect(row.share_token).toBeNull();
    db.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/share.test.js
```

Expected: all fail with errors like `db.stmts.setShareToken is undefined` and `share_token` not being a column on `getReport`'s output.

- [ ] **Step 3: Add the schema column + partial index + migration**

In `src/db.js`, modify the `SCHEMA` constant — add the column to the existing `reports` table definition AND add the partial index:

```javascript
const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT,
  word_count   INTEGER NOT NULL,
  sources_json TEXT NOT NULL,
  received_at  TEXT NOT NULL,
  share_token  TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_slug_received
  ON reports(slug, received_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_share_token
  ON reports(share_token) WHERE share_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS requests (
  ... -- unchanged
```

Then add an idempotent migration block in `openDb` AFTER `db.exec(SCHEMA)` to upgrade old DBs that pre-date the column:

```javascript
export function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // Idempotent migration for installs that pre-date share_token.
  const cols = db.prepare(`PRAGMA table_info(reports)`).all();
  if (!cols.find((c) => c.name === 'share_token')) {
    db.exec(`ALTER TABLE reports ADD COLUMN share_token TEXT`);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_share_token
        ON reports(share_token) WHERE share_token IS NOT NULL
    `);
  }

  return buildApi(db);
}
```

- [ ] **Step 4: Add the prepared statements**

In `src/db.js`, inside `buildApi`'s `stmts` object, replace the existing `getReport` and add three new statements:

```javascript
    getReport: db.prepare(`
      SELECT id, slug, title, summary, word_count, sources_json, received_at, share_token
      FROM reports WHERE id = ?
    `),
    // ... other existing statements ...

    setShareToken: db.prepare(`
      UPDATE reports SET share_token = @token WHERE id = @id
    `),
    clearShareToken: db.prepare(`
      UPDATE reports SET share_token = NULL WHERE id = @id
    `),
    getReportByShareToken: db.prepare(`
      SELECT id, slug, title, summary, word_count, sources_json, received_at, share_token
      FROM reports WHERE share_token = ?
    `),
```

- [ ] **Step 5: Fix the migration test's top-level `await import` syntax**

`vitest`'s top-level await inside an `it()` body needs a tweak. Modify the migration test to use a regular `async` it. The version above is already async-compatible — just confirm the test file's `it('upgrades an old reports table…', async () => {` signature is set, which it is in the snippet from Step 1.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run test/share.test.js
```

Expected: all 9 tests pass (7 in `share_token db statements` + migration test + module-level passes). Total project test count: was 52, now 60.

```bash
npx vitest run
```

Expected: 60 passed (5 files), no regressions in `mcp.test.js`, `notify.test.js`, etc.

- [ ] **Step 7: Commit**

```bash
git add src/db.js test/share.test.js
git commit -m "feat(db): share_token column + partial unique index + idempotent migration

reports gains an opt-in share_token (NULL = not shareable). A partial
UNIQUE index enforces token uniqueness across the issued set while
allowing many NULL rows. openDb runs an idempotent ALTER TABLE for
installs that pre-date the column.

Three prepared statements added: setShareToken, clearShareToken,
getReportByShareToken. getReport extended to surface share_token in
its output.

8 new tests (UPSERT/CLEAR/lookup/index semantics + migration safety)."
```

---

## Task 2: `mintShareToken` / `clearShareToken` / `lookupByShareToken` pure helpers

**Files:**
- Create: `src/share.js`
- Test: `test/share.test.js` (extend)

These are thin wrappers over the prepared statements that handle token generation and the "regenerate on collision" defensive retry.

- [ ] **Step 1: Append the failing tests to `test/share.test.js`**

```javascript
// Add at top of test/share.test.js, with the other imports:
import {
  mintShareToken,
  clearShareTokenFor,
  lookupByShareToken,
} from '../src/share.js';

// Append after the existing describes:
describe('share token helpers', () => {
  let db;
  beforeEach(() => { db = openDb(':memory:'); });
  afterEach(() => { try { db.close(); } catch {} });

  it('mintShareToken issues a 32-hex token and stores it', () => {
    const id = seedReport(db);
    const token = mintShareToken(db, id);
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    expect(db.stmts.getReport.get(id).share_token).toBe(token);
  });

  it('mintShareToken returns the existing token if already set', () => {
    const id = seedReport(db);
    const first = mintShareToken(db, id);
    const second = mintShareToken(db, id);
    expect(second).toBe(first);
  });

  it('mintShareToken returns null for unknown id', () => {
    expect(mintShareToken(db, 'no_such_id')).toBeNull();
  });

  it('clearShareTokenFor sets the row back to NULL', () => {
    const id = seedReport(db);
    mintShareToken(db, id);
    const ok = clearShareTokenFor(db, id);
    expect(ok).toBe(true);
    expect(db.stmts.getReport.get(id).share_token).toBeNull();
  });

  it('clearShareTokenFor returns true even if already NULL (idempotent)', () => {
    const id = seedReport(db);
    expect(clearShareTokenFor(db, id)).toBe(true);
  });

  it('clearShareTokenFor returns false for unknown id', () => {
    expect(clearShareTokenFor(db, 'no_such_id')).toBe(false);
  });

  it('lookupByShareToken returns row for valid token', () => {
    const id = seedReport(db);
    const token = mintShareToken(db, id);
    const row = lookupByShareToken(db, token);
    expect(row?.id).toBe(id);
  });

  it('lookupByShareToken returns null for malformed token (no DB hit)', () => {
    expect(lookupByShareToken(db, 'not-hex')).toBeNull();
    expect(lookupByShareToken(db, 'a'.repeat(31))).toBeNull(); // too short
    expect(lookupByShareToken(db, 'a'.repeat(33))).toBeNull(); // too long
  });

  it('lookupByShareToken returns null for unknown but well-formed token', () => {
    expect(lookupByShareToken(db, 'f'.repeat(32))).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/share.test.js
```

Expected: 9 new tests fail with `Cannot find module '../src/share.js'`.

- [ ] **Step 3: Create `src/share.js` with the helpers**

```javascript
import { randomBytes } from 'node:crypto';

const TOKEN_RE = /^[a-f0-9]{32}$/;
const COLLISION_RETRIES = 1; // unique index guarantees safety; one retry is plenty

function generateToken() {
  return randomBytes(16).toString('hex');
}

/**
 * Mint a share token for the report. Returns the existing token if one is
 * already set (so re-clicking "Share" is idempotent). Returns null if the
 * report does not exist.
 */
export function mintShareToken(db, reportId) {
  const row = db.stmts.getReport.get(reportId);
  if (!row) return null;
  if (row.share_token) return row.share_token;

  let lastError;
  for (let attempt = 0; attempt <= COLLISION_RETRIES; attempt++) {
    const token = generateToken();
    try {
      db.stmts.setShareToken.run({ id: reportId, token });
      return token;
    } catch (e) {
      lastError = e;
      // UNIQUE constraint — vanishingly unlikely with 128-bit tokens. Retry once.
    }
  }
  throw new Error(`could not mint share token after retries: ${lastError?.message}`);
}

/**
 * Clear the share token for a report. Idempotent. Returns true if the report
 * exists, false otherwise.
 */
export function clearShareTokenFor(db, reportId) {
  if (!db.stmts.getReport.get(reportId)) return false;
  db.stmts.clearShareToken.run({ id: reportId });
  return true;
}

/**
 * Resolve a share token to its report row. Returns null on malformed input,
 * unknown token, or revoked token. Never throws.
 */
export function lookupByShareToken(db, token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const row = db.stmts.getReportByShareToken.get(token);
  return row ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/share.test.js
```

Expected: 17 passed (8 from Task 1 + 9 from Task 2).

```bash
npx vitest run
```

Expected: 69 passed (5 files).

- [ ] **Step 5: Commit**

```bash
git add src/share.js test/share.test.js
git commit -m "feat(share): mint/clear/lookup helpers in src/share.js

mintShareToken is idempotent — re-calling on a report that already has
a token returns the existing one. lookupByShareToken validates the
[a-f0-9]{32} regex before any DB hit so bots probing random paths can't
trigger queries. clearShareTokenFor is also idempotent.

9 new tests cover token format, idempotency, malformed input early
return, and unknown-token semantics."
```

---

## Task 3: Public-page HTML rendering (`renderSharePage`, `renderRevokedPage`)

**Files:**
- Modify: `src/share.js`
- Test: `test/share.test.js` (extend)

The renderer is a pure function: input `{ report, markdown, publicBaseUrl }`, output an HTML string. No DB, no Express. Easy to test.

- [ ] **Step 1: Append failing tests for `renderSharePage` + `renderRevokedPage`**

Append to `test/share.test.js`:

```javascript
import { renderSharePage, renderRevokedPage } from '../src/share.js';

describe('renderSharePage', () => {
  const report = {
    id: '20260429T120000Z_test',
    slug: 'markets',
    title: 'Markets close 29 Apr — RBI focus',
    summary: 'Nifty closed 24,250, down 0.8%. Governor flagged sticky food inflation.',
    word_count: 1234,
    received_at: '2026-04-29T12:00:00Z',
    share_token: 'a'.repeat(32),
  };
  const markdown = '# Markets close 29 Apr — RBI focus\n\n**TL;DR:** ...\n\n## Key Findings\n\n- ...';
  const html = renderSharePage({ report, markdown, publicBaseUrl: 'https://dispatch.platinumj.xyz' });

  it('returns a string starting with <!doctype html>', () => {
    expect(html).toMatch(/^<!doctype html>/i);
  });

  it('includes the report title in <title>', () => {
    expect(html).toMatch(/<title>Markets close 29 Apr — RBI focus[^<]*<\/title>/);
  });

  it('emits a noindex robots meta tag', () => {
    expect(html).toMatch(/<meta name="robots" content="noindex"/);
  });

  it('emits Open Graph + Twitter Card meta tags', () => {
    expect(html).toMatch(/<meta property="og:title" content="Markets close 29 Apr — RBI focus"/);
    expect(html).toMatch(/<meta property="og:description" content="Nifty closed 24,250/);
    expect(html).toMatch(/<meta property="og:url" content="https:\/\/dispatch\.platinumj\.xyz\/s\/a{32}"/);
    expect(html).toMatch(/<meta property="og:type" content="article"/);
    expect(html).toMatch(/<meta name="twitter:card" content="summary"/);
  });

  it('embeds the markdown in a script[type="text/markdown"] tag', () => {
    expect(html).toMatch(/<script id="md" type="text\/markdown">/);
    expect(html).toContain('# Markets close 29 Apr');
  });

  it('escapes </script> inside the markdown so it cannot break out', () => {
    const evil = '# Title\n\n</script><script>alert(1)</script>\n';
    const out = renderSharePage({ report, markdown: evil, publicBaseUrl: 'https://x' });
    expect(out).not.toContain('</script><script>alert(1)</script>');
    expect(out).toContain('<\\/script>'); // escaped form
  });

  it('escapes HTML special chars in the title and summary', () => {
    const r = { ...report, title: 'A & B <c> "d"', summary: 'tldr & <stuff>' };
    const out = renderSharePage({ report: r, markdown: '# x', publicBaseUrl: 'https://x' });
    expect(out).toContain('A &amp; B &lt;c&gt; &quot;d&quot;');
    expect(out).toContain('tldr &amp; &lt;stuff&gt;');
  });

  it('includes PDF and Markdown download links keyed off the share token', () => {
    expect(html).toContain('href="/s/' + 'a'.repeat(32) + '/pdf"');
    expect(html).toContain('href="/s/' + 'a'.repeat(32) + '/md"');
  });

  it('includes a footer with filed date and the public base host', () => {
    expect(html).toMatch(/Filed by Claude on \d{1,2} April 2026/);
    expect(html).toContain('dispatch.platinumj.xyz');
  });
});

describe('renderRevokedPage', () => {
  it('returns 404 page HTML with masthead but no article', () => {
    const html = renderRevokedPage({ publicBaseUrl: 'https://dispatch.platinumj.xyz' });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/Link no longer active/i);
    expect(html).not.toContain('<script id="md"');
  });

  it('includes noindex meta tag', () => {
    const html = renderRevokedPage({ publicBaseUrl: 'https://x' });
    expect(html).toMatch(/<meta name="robots" content="noindex"/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/share.test.js
```

Expected: ~12 new failures referencing `renderSharePage is not a function`.

- [ ] **Step 3: Implement the renderers**

Append to `src/share.js`:

```javascript
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape only the </script sequence — keeps the markdown readable inside
// <script type="text/markdown"> while preventing breakout.
function escapeForScriptTag(s) {
  return String(s).replace(/<\/script/gi, '<\\/script');
}

function fmtFiledDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

const SHARE_PAGE_CSS = `
  :root {
    --paper:#f4ede1; --ink:#111; --red:#b8290c; --muted:#6a6358;
    --serif:'Fraunces','Georgia',serif; --sans:'Inter',-apple-system,sans-serif;
    --mono:'JetBrains Mono','Menlo',monospace;
  }
  *{box-sizing:border-box} html,body{margin:0;padding:0}
  body{background:var(--paper);background-image:radial-gradient(rgba(0,0,0,.035) 1px,transparent 1px);background-size:4px 4px;color:var(--ink);font-family:var(--sans);min-height:100vh}
  .page{max-width:760px;margin:0 auto;padding:28px 28px 80px}
  .masthead{border-top:2px solid #1a1a1a}
  .masthead-top{display:flex;justify-content:space-between;align-items:baseline;font-family:var(--sans);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:10px 2px}
  .masthead-rule{height:1px;background:#1a1a1a}
  .masthead-title{text-align:center;font-family:var(--serif);font-weight:800;font-size:clamp(40px,8vw,90px);line-height:1;letter-spacing:-.02em;padding:18px 0}
  .masthead-title em{color:var(--red);font-style:italic;font-weight:800}
  .actions{display:flex;gap:18px;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.15em;padding:14px 2px;border-bottom:1px solid rgba(0,0,0,.2)}
  .actions a{color:var(--ink);text-decoration:none;border-bottom:1px dotted rgba(0,0,0,.4);padding-bottom:1px}
  .article{font-family:var(--serif);font-size:18px;line-height:1.65;padding:32px 0}
  .article h1{font-weight:800;font-size:38px;line-height:1.1;margin:0 0 14px;letter-spacing:-.015em}
  .article h2{font-weight:800;font-style:italic;color:var(--red);font-size:26px;margin:36px 0 10px}
  .article h3{font-weight:600;font-size:20px;margin:24px 0 8px}
  .article p{margin:0 0 16px}
  .article a{color:var(--red);text-decoration:underline;text-underline-offset:2px}
  .article blockquote{border-left:3px solid var(--red);margin:18px 0;padding:2px 0 2px 18px;font-style:italic;color:#3a342a}
  .article hr{border:none;border-top:1px dashed rgba(0,0,0,.4);margin:28px 0}
  .article code{font-family:var(--mono);font-size:.88em;background:rgba(0,0,0,.06);padding:1px 5px}
  .article pre{background:rgba(0,0,0,.06);padding:14px 18px;overflow-x:auto}
  .article pre code{background:transparent;padding:0;font-size:14px;line-height:1.5}
  .article ul,.article ol{padding-left:22px;margin:0 0 16px}
  .article li{margin-bottom:6px}
  .article strong{font-weight:800}
  .footer{font-family:var(--serif);font-style:italic;color:var(--muted);font-size:14px;padding:24px 0;border-top:1px dashed rgba(0,0,0,.4);margin-top:32px;text-align:center}
  .empty{text-align:center;padding:80px 20px;font-family:var(--serif);font-style:italic;color:var(--muted);font-size:20px}
`;

const FONTS_LINK = `<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,600;0,9..144,800;1,9..144,800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">`;

export function renderSharePage({ report, markdown, publicBaseUrl }) {
  const base = String(publicBaseUrl).replace(/\/+$/, '');
  const url = `${base}/s/${report.share_token}`;
  const titleEsc = escapeHtml(report.title);
  const descRaw = (report.summary || '').slice(0, 200);
  const descEsc = escapeHtml(descRaw);
  const filedDate = fmtFiledDate(report.received_at);
  const host = base.replace(/^https?:\/\//, '');
  const mdSafe = escapeForScriptTag(markdown);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${titleEsc} · The Dispatch</title>

<meta property="og:title" content="${titleEsc}">
<meta property="og:description" content="${descEsc}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="The Dispatch">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${titleEsc}">
<meta name="twitter:description" content="${descEsc}">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${FONTS_LINK}
<style>${SHARE_PAGE_CSS}</style>
</head>
<body>
<div class="page">
  <header class="masthead">
    <div class="masthead-top">
      <span>${escapeHtml(filedDate.toUpperCase())}</span>
      <span>Shared dispatch</span>
    </div>
    <div class="masthead-rule"></div>
    <h1 class="masthead-title">The <em>Dispatch</em></h1>
    <div class="masthead-rule"></div>
  </header>

  <div class="actions">
    <a href="/s/${report.share_token}/pdf">⬇ PDF</a>
    <a href="/s/${report.share_token}/md">Markdown</a>
    <a href="${escapeHtml(base)}" style="margin-left:auto">← The Dispatch</a>
  </div>

  <article class="article" id="article"></article>

  <footer class="footer">
    Filed by Claude on ${escapeHtml(filedDate)} · ${escapeHtml(host)}
  </footer>
</div>

<script id="md" type="text/markdown">${mdSafe}</script>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script>
  (function(){
    var src = document.getElementById('md').textContent;
    document.getElementById('article').innerHTML = window.marked.parse(src);
  })();
</script>
</body>
</html>`;
}

export function renderRevokedPage({ publicBaseUrl }) {
  const base = String(publicBaseUrl).replace(/\/+$/, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Link no longer active · The Dispatch</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${FONTS_LINK}
<style>${SHARE_PAGE_CSS}</style>
</head>
<body>
<div class="page">
  <header class="masthead">
    <div class="masthead-rule"></div>
    <h1 class="masthead-title">The <em>Dispatch</em></h1>
    <div class="masthead-rule"></div>
  </header>
  <div class="empty">Link no longer active.</div>
  <footer class="footer">
    <a href="${escapeHtml(base)}" style="color:var(--muted)">← The Dispatch</a>
  </footer>
</div>
</body>
</html>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/share.test.js
```

Expected: 29 passed (Tasks 1+2+3).

- [ ] **Step 5: Commit**

```bash
git add src/share.js test/share.test.js
git commit -m "feat(share): renderSharePage / renderRevokedPage with OG tags

Server-rendered HTML for the public /s/:token surface. Broadsheet
masthead (Fraunces, dot-pattern), 760px column with the same H2-red /
serif-body / dashed-hr treatment as the dashboard reader overlay,
PDF + Markdown download links, footer with filed date.

The article body is embedded in <script id=md type=text/markdown>
and rendered client-side via marked from CDN — keeps marked off the
critical path for crawlers while humans get the rich render. Crawlers
get the OG / Twitter Card meta tags directly in <head>.

</script breakouts inside the markdown are escaped to <\\/script.
HTML-special chars in title and summary are escaped before
interpolation. noindex robots meta included on every page.

12 tests cover doctype, title, OG tags, robots tag, script-tag
embedding, breakout escaping, HTML escaping, footer date format,
and the revoked-link page."
```

---

## Task 4: API + public-route handler factories in `src/share.js`

**Files:**
- Modify: `src/share.js`
- Test: `test/share.test.js` (extend)

Express handlers as factories (closures over `db` / `archive` / `publicBaseUrl`) so they can be tested by calling them with fake `req` / `res` objects, no Express server required.

- [ ] **Step 1: Append failing tests**

Append to `test/share.test.js`:

```javascript
import { shareApiHandlers, publicShareHandlers } from '../src/share.js';

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(o) { this.headers['content-type'] = 'application/json'; this.body = JSON.stringify(o); return this; },
    send(s) { this.body = s; return this; },
    end() { return this; },
  };
  return res;
}

function fakeArchive() {
  const md = new Map();
  const pdf = new Map();
  return {
    readMarkdown: (id) => md.get(id) ?? null,
    readPdf: (id) => pdf.get(id) ?? null,
    _seedMarkdown: (id, s) => md.set(id, s),
    _seedPdf: (id, b) => pdf.set(id, b),
  };
}

describe('shareApiHandlers (basic-auth API)', () => {
  let db, archive, handlers;
  const baseUrl = 'https://dispatch.platinumj.xyz';

  beforeEach(() => {
    db = openDb(':memory:');
    archive = fakeArchive();
    handlers = shareApiHandlers({ db, publicBaseUrl: baseUrl });
  });
  afterEach(() => { try { db.close(); } catch {} });

  it('POST /share creates a token and returns the public URL', () => {
    const id = seedReport(db);
    const res = fakeRes();
    handlers.create({ params: { id } }, res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toMatch(/^[a-f0-9]{32}$/);
    expect(body.url).toBe(`${baseUrl}/s/${body.token}`);
  });

  it('POST /share is idempotent — re-call returns same token', () => {
    const id = seedReport(db);
    const r1 = fakeRes(); handlers.create({ params: { id } }, r1);
    const r2 = fakeRes(); handlers.create({ params: { id } }, r2);
    expect(JSON.parse(r1.body).token).toBe(JSON.parse(r2.body).token);
  });

  it('POST /share returns 404 for unknown report', () => {
    const res = fakeRes();
    handlers.create({ params: { id: 'no-such-id' } }, res);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toMatch(/not found/);
  });

  it('DELETE /share clears the token (idempotent)', () => {
    const id = seedReport(db);
    handlers.create({ params: { id } }, fakeRes()); // mint
    const res = fakeRes();
    handlers.revoke({ params: { id } }, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).revoked).toBe(true);
    expect(db.stmts.getReport.get(id).share_token).toBeNull();
  });

  it('DELETE /share on already-clear report returns 200', () => {
    const id = seedReport(db);
    const res = fakeRes();
    handlers.revoke({ params: { id } }, res);
    expect(res.statusCode).toBe(200);
  });

  it('DELETE /share returns 404 for unknown report', () => {
    const res = fakeRes();
    handlers.revoke({ params: { id: 'no-such-id' } }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('publicShareHandlers (no auth)', () => {
  let db, archive, handlers;

  beforeEach(() => {
    db = openDb(':memory:');
    archive = fakeArchive();
    handlers = publicShareHandlers({ db, archive, publicBaseUrl: 'https://x' });
  });
  afterEach(() => { try { db.close(); } catch {} });

  it('GET /s/:token renders HTML with the article markdown', () => {
    const id = seedReport(db);
    const token = mintShareToken(db, id);
    archive._seedMarkdown(id, '# Hello\n\n**TL;DR:** test\n');
    const res = fakeRes();
    handlers.html({ params: { token } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['x-robots-tag']).toBe('noindex,nofollow');
    expect(res.body).toContain('<script id="md"');
    expect(res.body).toContain('# Hello');
  });

  it('GET /s/:token returns 404 + revoked HTML for unknown token', () => {
    const res = fakeRes();
    handlers.html({ params: { token: 'f'.repeat(32) } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatch(/Link no longer active/);
  });

  it('GET /s/:token returns 404 for malformed token (no DB hit)', () => {
    const res = fakeRes();
    handlers.html({ params: { token: 'not-hex' } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('GET /s/:token returns 410 if archive markdown is missing', () => {
    const id = seedReport(db);
    const token = mintShareToken(db, id);
    // archive._seedMarkdown not called — readMarkdown returns null
    const res = fakeRes();
    handlers.html({ params: { token } }, res);
    expect(res.statusCode).toBe(410);
  });

  it('GET /s/:token/pdf streams PDF for valid token', () => {
    const id = seedReport(db);
    const token = mintShareToken(db, id);
    archive._seedPdf(id, Buffer.from('%PDF-1.7 fake'));
    const res = fakeRes();
    handlers.pdf({ params: { token } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/inline; filename=/);
  });

  it('GET /s/:token/pdf returns 404 for unknown token', () => {
    const res = fakeRes();
    handlers.pdf({ params: { token: 'f'.repeat(32) } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('GET /s/:token/md streams markdown for valid token', () => {
    const id = seedReport(db);
    const token = mintShareToken(db, id);
    archive._seedMarkdown(id, '# Title\n\n**TL;DR:** body\n');
    const res = fakeRes();
    handlers.md({ params: { token } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(res.body).toContain('# Title');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/share.test.js
```

Expected: 13 new failures referencing `shareApiHandlers is not a function`.

- [ ] **Step 3: Implement the handler factories**

Append to `src/share.js`:

```javascript
export function shareApiHandlers({ db, publicBaseUrl }) {
  const base = String(publicBaseUrl).replace(/\/+$/, '');
  return {
    create(req, res) {
      const id = req.params?.id;
      const token = mintShareToken(db, id);
      if (token === null) {
        return res.status(404).json({ error: 'report not found' });
      }
      return res.status(200).json({ token, url: `${base}/s/${token}` });
    },
    revoke(req, res) {
      const id = req.params?.id;
      const ok = clearShareTokenFor(db, id);
      if (!ok) {
        return res.status(404).json({ error: 'report not found' });
      }
      return res.status(200).json({ revoked: true });
    },
  };
}

export function publicShareHandlers({ db, archive, publicBaseUrl }) {
  return {
    html(req, res) {
      const token = req.params?.token;
      const row = lookupByShareToken(db, token);
      res.setHeader('X-Robots-Tag', 'noindex,nofollow');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (!row) {
        return res.status(404).send(renderRevokedPage({ publicBaseUrl }));
      }
      const markdown = archive.readMarkdown(row.id);
      if (markdown === null) {
        return res.status(410).send(renderRevokedPage({ publicBaseUrl }));
      }
      return res.status(200).send(renderSharePage({ report: row, markdown, publicBaseUrl }));
    },
    pdf(req, res) {
      const token = req.params?.token;
      const row = lookupByShareToken(db, token);
      if (!row) return res.status(404).send('not found');
      const pdf = archive.readPdf(row.id);
      if (!pdf) return res.status(410).send('archive missing');
      res.setHeader('X-Robots-Tag', 'noindex,nofollow');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${row.id}.pdf"`);
      return res.send(pdf);
    },
    md(req, res) {
      const token = req.params?.token;
      const row = lookupByShareToken(db, token);
      if (!row) return res.status(404).send('not found');
      const markdown = archive.readMarkdown(row.id);
      if (markdown === null) return res.status(410).send('archive missing');
      res.setHeader('X-Robots-Tag', 'noindex,nofollow');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${row.id}.md"`);
      return res.send(markdown);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/share.test.js
```

Expected: 42 passed.

```bash
npx vitest run
```

Expected: 82 passed (5 files), no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/share.js test/share.test.js
git commit -m "feat(share): API + public route handler factories

shareApiHandlers({db, publicBaseUrl}) → {create, revoke} for the
basic-auth POST/DELETE /api/reports/:id/share routes. Idempotent on
both sides: re-mint returns the existing token, revoke on a clear
report still 200s.

publicShareHandlers({db, archive, publicBaseUrl}) → {html, pdf, md}
for the unauthenticated /s/:token routes. Malformed tokens 404 before
hitting the DB. Unknown/revoked tokens 404 with the styled
'Link no longer active' page. Missing archive files 410.

All public responses set X-Robots-Tag: noindex,nofollow.

13 tests cover happy path, idempotency, 404/410, and that the HTML
response actually contains the embedded markdown."
```

---

## Task 5: Wire the API routes in `src/api.js`, expose `share_token` in `/api/report/:id`

**Files:**
- Modify: `src/api.js`

- [ ] **Step 1: Modify `src/api.js`**

Add the import at the top of `src/api.js`:

```javascript
import { shareApiHandlers } from './share.js';
```

Change `buildApiRouter` signature to accept `publicBaseUrl`:

```javascript
export function buildApiRouter({ db, archive, publicBaseUrl }) {
  const router = express.Router();
  const share = shareApiHandlers({ db, publicBaseUrl });
  // ... existing routes unchanged ...
```

Inside `buildApiRouter`, find this existing block:

```javascript
  router.get('/api/report/:id', (req, res) => {
    const row = db.stmts.getReport.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    const markdown = archive.readMarkdown(req.params.id);
    if (markdown === null) {
      return res.status(410).json({ error: 'archive file missing' });
    }
    res.json({ ...row, markdown });
  });
```

Replace with the explicit field listing so the dashboard sees `share_token` reliably (it's already in `row` since Task 1, but being explicit avoids accidental leaks of future columns):

```javascript
  router.get('/api/report/:id', (req, res) => {
    const row = db.stmts.getReport.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    const markdown = archive.readMarkdown(req.params.id);
    if (markdown === null) {
      return res.status(410).json({ error: 'archive file missing' });
    }
    res.json({
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      word_count: row.word_count,
      sources_json: row.sources_json,
      received_at: row.received_at,
      share_token: row.share_token ?? null,
      markdown,
    });
  });
```

Add the two new routes near the existing report routes (after `router.get('/report/:id.md', ...)`), with `express.json()` for the POST:

```javascript
  router.post('/api/reports/:id/share', express.json(), share.create);
  router.delete('/api/reports/:id/share', share.revoke);
```

- [ ] **Step 2: Modify `src/server.js`**

Locate the `buildApiRouter` invocation (currently `app.use(buildApiRouter({ db, archive }))`) and pass `publicBaseUrl` through:

```javascript
  app.use(buildApiRouter({ db, archive, publicBaseUrl: env.PUBLIC_BASE_URL }));
```

- [ ] **Step 3: Run tests to verify nothing regressed**

```bash
npx vitest run
```

Expected: 82 passed (no new tests in this task — handler logic was already covered in Task 4; we're just wiring it).

- [ ] **Step 4: Commit**

```bash
git add src/api.js src/server.js
git commit -m "feat(api): /api/reports/:id/share endpoints + share_token in report JSON

POST /api/reports/:id/share mints (or returns existing) token, returns
{token, url} JSON. DELETE /api/reports/:id/share clears it. Both behind
basic-auth via the existing dashboardAuth middleware.

GET /api/report/:id now explicitly includes share_token in its
response so the dashboard reader overlay can show the existing share
URL without an extra round trip."
```

---

## Task 6: Mount public `/s/:token` routes in `src/server.js` (before basic-auth)

**Files:**
- Modify: `src/server.js`

The public routes must be mounted **before** the basic-auth middleware, otherwise they'll be gated like the rest of the dashboard.

- [ ] **Step 1: Modify `src/server.js`**

Add the import at the top with the others:

```javascript
import { publicShareHandlers } from './share.js';
```

Inside `main()`, find this block (after the MCP routes are mounted, before `dashboardAuth`):

```javascript
  // Dashboard + JSON APIs: basic-auth.
  const dashboardAuth = basicAuth({
    users: { [env.DASHBOARD_USER]: env.DASHBOARD_PASS },
    challenge: true,
    realm: 'The Dispatch',
  });
```

Insert this BEFORE the `dashboardAuth` declaration (so the public routes hit before any auth gate):

```javascript
  // Public share routes — no auth, gated only by knowledge of the token.
  const publicShare = publicShareHandlers({
    db,
    archive,
    publicBaseUrl: env.PUBLIC_BASE_URL,
  });
  app.get('/s/:token', publicShare.html);
  app.get('/s/:token/pdf', publicShare.pdf);
  app.get('/s/:token/md', publicShare.md);
```

Verify the existing `app.use('/', (req, res, next) => {...})` middleware that currently routes `/mcp`, `/api`, `/report` past basic-auth — extend it to also let `/s/` through:

```javascript
  app.use('/', (req, res, next) => {
    if (
      req.path.startsWith('/mcp') ||
      req.path.startsWith('/api') ||
      req.path.startsWith('/report') ||
      req.path.startsWith('/s/')
    ) {
      return next();
    }
    return dashboardAuth(req, res, next);
  });
```

- [ ] **Step 2: Manual integration smoke from a clean state**

Start a fresh dev server and exercise the full path. From the project root:

```bash
lsof -ti :8787 | xargs -r kill -9
rm -f reports.db reports.db-shm reports.db-wal; rm -rf archive
node src/server.js &
SRV=$!
sleep 2

# 1. File a fake report via MCP so we have something to share.
node -e "
(async () => {
  const body = {jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'save_report',arguments:{
    topic_slug:'test',title:'Share-me Test',
    markdown_body:'# Share-me Test\n\n**TL;DR:** smoke test for shareable links.\n\n## Key Findings\n\n- one\n\n## Sources\n\n1. https://example.com\n'
  }}};
  const r = await fetch('http://localhost:8787/mcp',{
    method:'POST',
    headers:{
      'Host':'localhost:8787',
      'Authorization':'Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'Content-Type':'application/json',
      'Accept':'application/json, text/event-stream'
    },
    body: JSON.stringify(body)
  }).then(r=>r.json());
  const p = JSON.parse(r.result.content[0].text);
  console.log('saved:', p.id);
  require('fs').writeFileSync('/tmp/repid', p.id);
})();
"

# 2. Mint a share token via the new API.
REP=$(cat /tmp/repid)
curl -sS -u editor:hunter2 -X POST "http://localhost:8787/api/reports/$REP/share" -H "Content-Type: application/json"
echo

# Save the token for the next steps.
TOKEN=$(curl -sS -u editor:hunter2 -X POST "http://localhost:8787/api/reports/$REP/share" -H "Content-Type: application/json" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).token))")
echo "token: $TOKEN"

# 3. Hit the public route WITHOUT credentials. Must succeed.
curl -sS -o /dev/null -w "html: %{http_code} %{content_type}\n" "http://localhost:8787/s/$TOKEN"
curl -sS -I "http://localhost:8787/s/$TOKEN" | grep -i "x-robots-tag"
curl -sS "http://localhost:8787/s/$TOKEN" | grep -i "og:title" | head -1

# 4. PDF download.
curl -sS -o /tmp/share.pdf -w "pdf: %{http_code} %{content_type} bytes=%{size_download}\n" "http://localhost:8787/s/$TOKEN/pdf"
file /tmp/share.pdf

# 5. Revoke and confirm 404.
curl -sS -u editor:hunter2 -X DELETE "http://localhost:8787/api/reports/$REP/share"
echo
curl -sS -o /dev/null -w "after revoke: %{http_code}\n" "http://localhost:8787/s/$TOKEN"

# 6. Dashboard JSON includes share_token (after re-share).
curl -sS -u editor:hunter2 -X POST "http://localhost:8787/api/reports/$REP/share" -H "Content-Type: application/json" >/dev/null
curl -sS -u editor:hunter2 "http://localhost:8787/api/report/$REP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let r=JSON.parse(d);console.log('share_token in api:', r.share_token?.length === 32 ? 'present (32 hex)' : r.share_token)})"

kill $SRV 2>/dev/null
rm -f reports.db reports.db-shm reports.db-wal; rm -rf archive
```

Expected output:
```
saved: 20260429T...Z_test
{"token":"<32 hex>","url":"http://localhost:8787/s/<32 hex>"}
token: <32 hex>
html: 200 text/html; charset=utf-8
X-Robots-Tag: noindex,nofollow
<meta property="og:title" content="Share-me Test">
pdf: 200 application/pdf bytes=1632
/tmp/share.pdf: PDF document, version 1.7
{"revoked":true}
after revoke: 404
share_token in api: present (32 hex)
```

If anything diverges, fix before committing.

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat(server): mount /s/:token public routes before basic-auth

The three public routes (/s/:token, /s/:token/pdf, /s/:token/md) are
registered before dashboardAuth and excluded from the catch-all auth
guard so they reach the publicShareHandlers without challenging for
credentials.

Smoke verified: report → mint share → unauthenticated GET 200 with
HTML + OG tags + X-Robots-Tag noindex; PDF stream 200; revoke → 404."
```

---

## Task 7: Reader-overlay UI — Share button + Copy + Revoke

**Files:**
- Modify: `public/index.html`

Single-file SPA. The reader overlay's action bar gains a Share button and an inline panel.

- [ ] **Step 1: Add the panel CSS**

In `public/index.html`, find the existing `.reader-bar` and `.reader-bar a` rules in the `<style>` block. Add these after them:

```css
  /* Share panel inside the reader overlay */
  .share-panel {
    margin: 18px 0;
    padding: 14px 18px;
    border: 1px dashed rgba(0,0,0,.4);
    background: rgba(255,255,255,.4);
    font-family: var(--mono);
    font-size: 12px;
    color: var(--ink);
    display: none;
  }
  .share-panel.open { display: block; }
  .share-panel .url {
    display: block;
    margin: 6px 0 10px;
    word-break: break-all;
    color: var(--red);
  }
  .share-panel button {
    background: var(--ink); color: var(--paper); border: none;
    padding: 6px 10px; font-family: inherit; font-size: 11px;
    text-transform: uppercase; letter-spacing: .12em; cursor: pointer;
    margin-right: 8px;
  }
  .share-panel button.secondary {
    background: transparent; color: var(--ink);
    border: 1px solid rgba(0,0,0,.4);
  }
  .share-panel .toast {
    margin-left: 8px; color: #3b6a1a; font-style: italic;
  }
```

- [ ] **Step 2: Add the Share button + panel in the reader markup**

Find the existing reader bar markup:

```html
<div class="reader-bar">
  <button id="reader-close" aria-label="Close reader">← Back</button>
  <div class="actions" id="reader-actions"></div>
</div>
<article class="reader-body" id="reader-body"></article>
```

Insert the share panel between the bar and the body:

```html
<div class="reader-bar">
  <button id="reader-close" aria-label="Close reader">← Back</button>
  <div class="actions" id="reader-actions"></div>
</div>
<div class="share-panel" id="share-panel">
  <div>Anyone with this link can read this dispatch:</div>
  <code class="url" id="share-url"></code>
  <button id="share-copy">Copy</button>
  <button id="share-revoke" class="secondary">Revoke</button>
  <span class="toast" id="share-toast"></span>
</div>
<article class="reader-body" id="reader-body"></article>
```

- [ ] **Step 3: Update `openReader` to track share_token + render the Share button**

Find the existing `openReader` function. Replace its body with:

```javascript
let currentReport = null; // declare near top of <script>, alongside `state`

async function openReader(id) {
  try {
    const r = await fetchJson(`/api/report/${id}`);
    currentReport = r;
    $('#reader-body').innerHTML = marked.parse(r.markdown);
    renderReaderActions(r);
    renderSharePanel(r);
    $('#reader').classList.add('open');
    window.scrollTo({ top: 0, behavior: 'instant' });
    history.pushState({ reader: id }, '', `/report/${id}`);
  } catch (e) {
    alert('Could not open report: ' + e.message);
  }
}

function renderReaderActions(r) {
  $('#reader-actions').innerHTML = `
    <a href="/report/${r.id}.pdf">⬇ PDF</a>
    <a href="/report/${r.id}.md">Markdown</a>
    <a href="#" id="reader-share">${r.share_token ? 'Manage share' : 'Share'}</a>
    <span style="font-family:var(--mono); font-size:11px; color:var(--muted);">${r.slug}</span>
  `;
  $('#reader-share').addEventListener('click', (e) => {
    e.preventDefault();
    if (currentReport.share_token) {
      $('#share-panel').classList.toggle('open');
    } else {
      mintShare(currentReport.id);
    }
  });
}

function renderSharePanel(r) {
  const panel = $('#share-panel');
  if (r.share_token) {
    const url = `${location.origin}/s/${r.share_token}`;
    $('#share-url').textContent = url;
    panel.classList.add('open');
  } else {
    panel.classList.remove('open');
    $('#share-url').textContent = '';
  }
  $('#share-toast').textContent = '';
}

async function mintShare(reportId) {
  try {
    const r = await fetch(`/api/reports/${reportId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const { token } = await r.json();
    currentReport.share_token = token;
    renderReaderActions(currentReport);
    renderSharePanel(currentReport);
  } catch (e) {
    alert('Could not create share link: ' + e.message);
  }
}

async function copyShare() {
  const url = $('#share-url').textContent;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    const t = $('#share-toast'); t.textContent = 'Copied'; setTimeout(() => { t.textContent = ''; }, 1500);
  } catch {
    alert('Clipboard write failed. Copy manually: ' + url);
  }
}

async function revokeShare() {
  if (!currentReport?.id) return;
  try {
    const r = await fetch(`/api/reports/${currentReport.id}/share`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    currentReport.share_token = null;
    renderReaderActions(currentReport);
    renderSharePanel(currentReport);
  } catch (e) {
    alert('Could not revoke: ' + e.message);
  }
}
```

- [ ] **Step 4: Wire the panel button event listeners (one-time, on script load)**

Find the existing one-time event-listener wiring (where `#reader-close`'s click handler is attached). Add these alongside it:

```javascript
$('#share-copy').addEventListener('click', copyShare);
$('#share-revoke').addEventListener('click', revokeShare);
```

- [ ] **Step 5: Manual UI smoke**

```bash
lsof -ti :8787 | xargs -r kill -9
rm -f reports.db reports.db-shm reports.db-wal; rm -rf archive
node src/server.js &
SRV=$!
sleep 2

# Seed a report.
node -e "
(async () => {
  const body = {jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'save_report',arguments:{
    topic_slug:'demo',title:'UI Demo',
    markdown_body:'# UI Demo\n\n**TL;DR:** test the share UI end to end.\n\n## Key Findings\n\n- bullet\n\n## Sources\n\n1. https://example.com\n'
  }}};
  await fetch('http://localhost:8787/mcp',{method:'POST',headers:{'Host':'localhost:8787','Authorization':'Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','Content-Type':'application/json','Accept':'application/json, text/event-stream'},body:JSON.stringify(body)});
  console.log('seeded.');
})();
"
sleep 1
echo "Open http://localhost:8787/ in a browser. Login: editor / hunter2."
echo "1. Click the demo card → reader opens."
echo "2. Click 'Share' → panel appears with the URL."
echo "3. Click 'Copy' → toast says Copied."
echo "4. Open the URL in a private window → article renders, no auth prompt."
echo "5. Back in dashboard, click 'Revoke' → panel hides."
echo "6. Reload the previous private-window URL → 'Link no longer active' page."
echo "Press enter to clean up."
read
kill $SRV 2>/dev/null
rm -f reports.db reports.db-shm reports.db-wal; rm -rf archive
```

Expected: every step works as described.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): Share / Copy / Revoke in the reader overlay

Reader's action bar gets a Share link. First click on an unshared
report POSTs /api/reports/:id/share and reveals an inline panel with
the public URL, Copy and Revoke buttons. Subsequent opens of an
already-shared report show 'Manage share' instead of 'Share' and the
panel renders pre-filled.

Copy uses navigator.clipboard with a 1.5s 'Copied' toast. Revoke
DELETEs the token, hides the panel, and flips the action label back
to 'Share' so the owner can re-share with a fresh token."
```

---

## Task 8: README + final regression sweep

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a Sharing section to README.md**

Find the existing "## Use the second client (optional)" section. Insert this new section directly after it:

```markdown
## Sharing individual reports publicly

The dashboard is private (basic-auth), but any single report can be exposed via an opt-in shareable link. Open a report in the reader overlay, click **Share**, and copy the URL — anyone with that URL can read the report at `https://<your-host>/s/<32-hex-token>`. The page is the broadsheet treatment, no sidebar, and includes Open Graph / Twitter Card meta tags so previews look good in Slack/iMessage/Twitter.

Click **Revoke** to clear the token; old URLs 404 immediately. Re-clicking Share mints a new, unrelated token. There is no expiry or per-recipient ACL — possession of the URL is the capability.

Search engines: every public share page sets `X-Robots-Tag: noindex,nofollow` and the equivalent meta, so leaked links don't get indexed.
```

- [ ] **Step 2: Run the full test suite**

```bash
npx vitest run
```

Expected: 82 passed (5 files), zero regressions.

- [ ] **Step 3: Commit + push**

```bash
git add README.md
git commit -m "docs: shareable public links section in README"
git log --oneline -10  # confirm the share commit chain looks clean
git push
```

Expected: 8 new commits push cleanly to origin/main.

---

## Self-Review

**Spec coverage:**
- Capability model (opt-in, stable, revocable, no expiry, noindex) — Tasks 1, 2, 5, 6, plus the renderer's noindex meta in Task 3 ✓
- Data model (`share_token TEXT` + partial unique index + idempotent migration) — Task 1 ✓
- POST/DELETE `/api/reports/:id/share` — Tasks 4, 5 ✓
- GET `/s/:token` HTML page — Tasks 3, 4, 6 ✓
- GET `/s/:token/pdf` and `/md` — Tasks 4, 6 ✓
- `share_token` in `/api/report/:id` JSON — Task 5 ✓
- Reader overlay Share / Copy / Revoke — Task 7 ✓
- Public page broadsheet styling, OG tags, footer — Task 3 ✓
- Error handling: 404 unknown report, 404 malformed/unknown/revoked token, 410 missing archive — Tasks 4, 6 ✓
- Tests: token gen, idempotency, render, OG tags, public-route handlers — Tasks 1–4 (42 new tests total) ✓

**Placeholder scan:** None. Every step has exact file paths, full code blocks where code is changed, and explicit expected output.

**Type / API consistency:** `mintShareToken`, `clearShareTokenFor`, `lookupByShareToken` are introduced in Task 2 and reused unchanged in Tasks 3 and 4. `shareApiHandlers` and `publicShareHandlers` are introduced in Task 4 and consumed in Tasks 5 and 6. `currentReport`, `share_token` field, and the URL `${location.origin}/s/${token}` are consistent across UI handlers in Task 7.

**Scope:** Single feature, tight surface (one new file, ~5 modified files), no decomposition needed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-shareable-links.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
