import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb, positionFor, utcDay } from '../src/db.js';
import { buildRetry, parseFireMap } from '../src/retry.js';

function seedDraft(db, { slug, day, name, content = 'x', updated_at }) {
  db.stmts.upsertDraft.run({
    slug,
    day,
    name,
    position: positionFor(name),
    content,
    updated_at,
  });
}

describe('parseFireMap', () => {
  it('returns {} on empty/invalid input', () => {
    expect(parseFireMap('')).toEqual({});
    expect(parseFireMap(null)).toEqual({});
    expect(parseFireMap('not json')).toEqual({});
    expect(parseFireMap('"a string"')).toEqual({});
  });
  it('keeps only entries with both url and token', () => {
    const out = parseFireMap(JSON.stringify({
      good: { url: 'https://x', token: 't' },
      missing_token: { url: 'https://y' },
      missing_url: { token: 'z' },
    }));
    expect(Object.keys(out).sort()).toEqual(['good']);
  });
});

describe('buildRetry', () => {
  let db;

  beforeEach(() => {
    db = openDb(':memory:');
  });
  afterEach(() => {
    try { db.close(); } catch {}
  });

  it('is a no-op when fireMap empty', async () => {
    const fetchSpy = vi.fn();
    const r = buildRetry({ db, fireMap: {}, fetchImpl: fetchSpy });
    expect(r.enabled).toBe(false);
    const res = await r.tick();
    expect(res).toEqual({ fired: 0, candidates: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips drafts that are still fresh', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    const fireMap = { foo: { url: 'https://x', token: 't' } };
    const day = utcDay();
    const fresh = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min old
    seedDraft(db, { slug: 'foo', day, name: 'header', updated_at: fresh });
    const r = buildRetry({ db, fireMap, retryAfterMinutes: 60, fetchImpl: fetchSpy });
    const res = await r.tick();
    expect(res.candidates).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fires once for a stale draft, records success', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify({
        type: 'routine_fire',
        claude_code_session_id: 'session_abc',
        claude_code_session_url: 'https://claude.ai/code/session_abc',
      }),
    });
    const fireMap = { foo: { url: 'https://x/fire', token: 'tok' } };
    const day = utcDay();
    const old = new Date(Date.now() - 90 * 60 * 1000).toISOString(); // 90 min old
    seedDraft(db, { slug: 'foo', day, name: 'header', updated_at: old });

    const r = buildRetry({ db, fireMap, retryAfterMinutes: 60, fetchImpl: fetchSpy });
    const res = await r.tick();

    expect(res.fired).toBe(1);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://x/fire');
    expect(opts.headers.Authorization).toBe('Bearer tok');
    expect(opts.headers['anthropic-beta']).toBe('experimental-cc-routine-2026-04-01');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(opts.body);
    expect(body.text).toMatch(/resume.*foo/);

    const fires = db.stmts.countFiresForDay.get({ slug: 'foo', day }).n;
    expect(fires).toBe(1);
  });

  it('honors MAX_RETRIES_PER_DAY cap', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    const fireMap = { capped: { url: 'https://x', token: 't' } };
    const day = utcDay();
    const old = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    seedDraft(db, { slug: 'capped', day, name: 'header', updated_at: old });

    const r = buildRetry({ db, fireMap, retryAfterMinutes: 60, maxRetriesPerDay: 2, fetchImpl: fetchSpy });
    await r.tick();
    await r.tick();
    await r.tick(); // third attempt — should be capped
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const fires = db.stmts.countFiresForDay.get({ slug: 'capped', day }).n;
    expect(fires).toBe(2);
  });

  it('skips slugs not in fireMap, fires those that are', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    const fireMap = { mapped: { url: 'https://x', token: 't' } };
    const day = utcDay();
    const old = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    seedDraft(db, { slug: 'mapped', day, name: 'header', updated_at: old });
    seedDraft(db, { slug: 'unmapped', day, name: 'header', updated_at: old });

    const r = buildRetry({ db, fireMap, retryAfterMinutes: 60, fetchImpl: fetchSpy });
    await r.tick();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://x');
  });

  it('records failures with HTTP status, still counts toward cap', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false, status: 503, text: async () => 'service unavailable',
    });
    const fireMap = { failing: { url: 'https://x', token: 't' } };
    const day = utcDay();
    const old = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    seedDraft(db, { slug: 'failing', day, name: 'header', updated_at: old });

    const r = buildRetry({ db, fireMap, retryAfterMinutes: 60, fetchImpl: fetchSpy });
    await r.tick();
    const fires = db.stmts.countFiresForDay.get({ slug: 'failing', day }).n;
    expect(fires).toBe(1);
    const row = db.raw.prepare(`SELECT ok, detail FROM retry_fires WHERE slug='failing'`).get();
    expect(row.ok).toBe(0);
    expect(row.detail).toMatch(/503/);
  });

  it('handles fetch throwing — records as failure, does not crash tick', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const fireMap = { boom: { url: 'https://x', token: 't' } };
    const day = utcDay();
    const old = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    seedDraft(db, { slug: 'boom', day, name: 'header', updated_at: old });

    const r = buildRetry({ db, fireMap, retryAfterMinutes: 60, fetchImpl: fetchSpy });
    await expect(r.tick()).resolves.toBeDefined();
    const row = db.raw.prepare(`SELECT detail FROM retry_fires WHERE slug='boom'`).get();
    expect(row.detail).toMatch(/ECONNREFUSED/);
  });

  it('once draft is finalized (deleted), it is no longer a candidate', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    const fireMap = { fin: { url: 'https://x', token: 't' } };
    const day = utcDay();
    const old = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    seedDraft(db, { slug: 'fin', day, name: 'header', updated_at: old });

    // simulate save_report finalizing — clears drafts
    db.stmts.clearDrafts.run({ slug: 'fin', day });

    const r = buildRetry({ db, fireMap, retryAfterMinutes: 60, fetchImpl: fetchSpy });
    const res = await r.tick();
    expect(res.fired).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
