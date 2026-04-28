import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../src/db.js';
import {
  mintShareToken,
  clearShareTokenFor,
  lookupByShareToken,
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
