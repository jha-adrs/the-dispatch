import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../src/db.js';
import {
  mintShareToken,
  clearShareTokenFor,
  lookupByShareToken,
  renderSharePage,
  renderRevokedPage,
  shareApiHandlers,
  publicShareHandlers,
} from '../src/share.js';

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

  it('upgrades an old reports table that lacks share_token', async () => {
    const dbPath = join(dir, 'old.db');
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

    const db = openDb(dbPath);
    const row = db.stmts.getReport.get('legacy_id');
    expect(row.title).toBe('Legacy');
    expect(row.share_token).toBeNull();
    db.close();
  });
});

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
    expect(html).toMatch(/<meta name="robots" content="noindex/);
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
    expect(html).toMatch(/<meta name="robots" content="noindex/);
  });
});

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

  it('GET /s/:token/pdf sets X-Robots-Tag on 404', () => {
    const res = fakeRes();
    handlers.pdf({ params: { token: 'f'.repeat(32) } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-robots-tag']).toBe('noindex,nofollow');
  });

  it('GET /s/:token/md sets X-Robots-Tag on 404', () => {
    const res = fakeRes();
    handlers.md({ params: { token: 'f'.repeat(32) } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-robots-tag']).toBe('noindex,nofollow');
  });

  it('GET /s/:token/pdf sets X-Robots-Tag on 410 (archive missing)', () => {
    const id = seedReport(db);
    const token = mintShareToken(db, id);
    // archive._seedPdf not called — readPdf returns null
    const res = fakeRes();
    handlers.pdf({ params: { token } }, res);
    expect(res.statusCode).toBe(410);
    expect(res.headers['x-robots-tag']).toBe('noindex,nofollow');
  });
});
