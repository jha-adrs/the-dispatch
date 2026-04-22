import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { openDb } from '../src/db.js';
import { createArchive } from '../src/archive.js';
import { buildMcpServer } from '../src/mcp.js';

async function wire(server) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function callTool(client, name, args) {
  return await client.callTool({ name, arguments: args });
}

function parseTextPayload(result) {
  const text = result?.content?.[0]?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

const FIXTURE_MD = `# Test Briefing

**Date:** 2026-04-22
**TL;DR:** A short summary to satisfy the markdown contract for testing.

## Key Findings

- Bullet one with https://example.com reference.
- Bullet two.

## Background

Some prose. Another sentence.

## Sources

1. https://example.com — example
`;

describe('mcp integration', () => {
  let tmp, db, archive, server, client;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'dispatch-test-'));
    db = openDb(':memory:');
    archive = createArchive(join(tmp, 'archive'));
    server = buildMcpServer({ db, archive, publicBaseUrl: 'http://t.example' });
    client = await wire(server);
  });

  afterEach(async () => {
    try { await client.close(); } catch {}
    try { await server.close(); } catch {}
    try { db.close(); } catch {}
    rmSync(tmp, { recursive: true, force: true });
  });

  it('save_report happy path: writes row + files and returns url', async () => {
    const res = await callTool(client, 'save_report', {
      topic_slug: 'test',
      title: 'Test Briefing',
      markdown_body: FIXTURE_MD,
    });
    expect(res.isError).toBeUndefined();
    const payload = parseTextPayload(res);
    expect(payload.id).toMatch(/^\d{8}T\d{6}Z_test$/);
    expect(payload.url).toBe(`http://t.example/report/${payload.id}`);
    expect(payload.word_count).toBeGreaterThan(5);
    expect(payload.sources_count).toBe(1);
    expect(payload.fulfilled_request_ids).toEqual([]);

    // files on disk + db row
    expect(existsSync(archive.pathFor(payload.id, 'md'))).toBe(true);
    expect(existsSync(archive.pathFor(payload.id, 'pdf'))).toBe(true);
    const row = db.stmts.getReport.get(payload.id);
    expect(row.title).toBe('Test Briefing');
    expect(row.summary).toMatch(/short summary/);
  });

  it('save_report rejects missing TL;DR marker', async () => {
    const bad = '# Title only\n\nno tldr here\n' + 'padding '.repeat(20);
    const res = await callTool(client, 'save_report', {
      topic_slug: 'test',
      title: 'Title only',
      markdown_body: bad,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/TL;DR/);
  });

  it('save_report rejects non-# first line', async () => {
    const bad = 'Not a heading\n\n**TL;DR:** yes\n' + 'padding '.repeat(20);
    const res = await callTool(client, 'save_report', {
      topic_slug: 'test',
      title: 'Not a heading',
      markdown_body: bad,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/# /);
  });

  it('list_recent_reports filters by slug and caps limit', async () => {
    // seed two reports across two slugs
    for (let i = 0; i < 3; i++) {
      await callTool(client, 'save_report', {
        topic_slug: 'alpha',
        title: `Alpha ${i}`,
        markdown_body: FIXTURE_MD,
      });
      await new Promise((r) => setTimeout(r, 1100)); // ensure unique id second
    }
    await callTool(client, 'save_report', {
      topic_slug: 'beta',
      title: 'Beta',
      markdown_body: FIXTURE_MD,
    });

    const alpha = parseTextPayload(await callTool(client, 'list_recent_reports', { topic_slug: 'alpha', limit: 10 }));
    expect(alpha).toHaveLength(3);
    expect(alpha.every((r) => r.slug === 'alpha')).toBe(true);

    const any = parseTextPayload(await callTool(client, 'list_recent_reports', { limit: 10 }));
    expect(any).toHaveLength(4);
  }, 10_000);

  it('get_report_summary returns 404-style isError for unknown id', async () => {
    const res = await callTool(client, 'get_report_summary', { id: 'nope' });
    expect(res.isError).toBe(true);
  });

  it('next_request returns [] when nothing is pending', async () => {
    const out = parseTextPayload(await callTool(client, 'next_request', { topic_slug: 'markets' }));
    expect(out).toEqual([]);
  });

  it('next_request returns pending items in submitted order', async () => {
    db.stmts.insertRequest.run({ id: 'req_1', slug: 'markets', request_text: 'first', submitted_at: '2026-04-22T00:00:00Z' });
    db.stmts.insertRequest.run({ id: 'req_2', slug: 'markets', request_text: 'second', submitted_at: '2026-04-22T01:00:00Z' });
    db.stmts.insertRequest.run({ id: 'req_3', slug: 'agents', request_text: 'other slug', submitted_at: '2026-04-22T00:30:00Z' });
    const rows = parseTextPayload(await callTool(client, 'next_request', { topic_slug: 'markets' }));
    expect(rows.map((r) => r.id)).toEqual(['req_1', 'req_2']);
  });

  it('save_report with request_ids fulfills them atomically', async () => {
    db.stmts.insertRequest.run({ id: 'req_x', slug: 'markets', request_text: 'x', submitted_at: '2026-04-22T00:00:00Z' });
    db.stmts.insertRequest.run({ id: 'req_y', slug: 'markets', request_text: 'y', submitted_at: '2026-04-22T00:01:00Z' });

    const res = await callTool(client, 'save_report', {
      topic_slug: 'markets',
      title: 'Markets',
      markdown_body: FIXTURE_MD,
      request_ids: ['req_x', 'req_y'],
    });
    expect(res.isError).toBeUndefined();
    const payload = parseTextPayload(res);
    expect(payload.fulfilled_request_ids.sort()).toEqual(['req_x', 'req_y']);

    const x = db.stmts.getRequest.get('req_x');
    const y = db.stmts.getRequest.get('req_y');
    expect(x.status).toBe('fulfilled');
    expect(x.fulfilled_report_id).toBe(payload.id);
    expect(y.status).toBe('fulfilled');
    expect(y.fulfilled_report_id).toBe(payload.id);
  });

  it('save_report rolls back atomically if any request_id is wrong-slug', async () => {
    db.stmts.insertRequest.run({ id: 'req_good', slug: 'markets', request_text: 'ok', submitted_at: '2026-04-22T00:00:00Z' });
    db.stmts.insertRequest.run({ id: 'req_bad',  slug: 'agents',  request_text: 'no', submitted_at: '2026-04-22T00:01:00Z' });

    const before = db.stmts.countReports.get().n;
    const res = await callTool(client, 'save_report', {
      topic_slug: 'markets',
      title: 'Markets',
      markdown_body: FIXTURE_MD,
      request_ids: ['req_good', 'req_bad'],
    });
    expect(res.isError).toBe(true);

    // nothing persisted: no new report, good request still pending
    expect(db.stmts.countReports.get().n).toBe(before);
    expect(db.stmts.getRequest.get('req_good').status).toBe('pending');
    expect(db.stmts.getRequest.get('req_bad').status).toBe('pending');
  });

  it('save_report errors on already-fulfilled request_id without side effects', async () => {
    db.stmts.insertRequest.run({ id: 'req_done', slug: 'markets', request_text: 'x', submitted_at: '2026-04-22T00:00:00Z' });
    await callTool(client, 'save_report', {
      topic_slug: 'markets', title: 'first', markdown_body: FIXTURE_MD, request_ids: ['req_done'],
    });
    await new Promise((r) => setTimeout(r, 1100)); // avoid report id collision
    const before = db.stmts.countReports.get().n;
    const res = await callTool(client, 'save_report', {
      topic_slug: 'markets', title: 'second', markdown_body: FIXTURE_MD, request_ids: ['req_done'],
    });
    expect(res.isError).toBe(true);
    expect(db.stmts.countReports.get().n).toBe(before);
  }, 10_000);

  it('sources[] input wins over markdown extraction', async () => {
    const res = await callTool(client, 'save_report', {
      topic_slug: 'test',
      title: 'Test',
      markdown_body: FIXTURE_MD,
      sources: ['https://override.example/a', 'https://override.example/b'],
    });
    const payload = parseTextPayload(res);
    expect(payload.sources_count).toBe(2);
    const row = db.stmts.getReport.get(payload.id);
    const stored = JSON.parse(row.sources_json);
    expect(stored).toEqual(['https://override.example/a', 'https://override.example/b']);
  });
});
