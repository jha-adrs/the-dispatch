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

// ────────────────────────────────────────────────────────────────────────────
// Draft sections — incremental persistence + assemble-on-save
// ────────────────────────────────────────────────────────────────────────────

describe('draft sections flow', () => {
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

  const HEADER = '# Test Briefing\n\n**Date:** 2026-04-24\n**TL;DR:** A short summary that satisfies the contract.';
  const KEY_FINDINGS = '## Key Findings\n\n- Finding A: https://example.com\n- Finding B';
  const BACKGROUND = '## Background\n\nContext goes here.';
  const SOURCES = '## Sources\n\n1. https://example.com — example';

  it('list_draft_sections is empty when nothing written', async () => {
    const res = await callTool(client, 'list_draft_sections', { topic_slug: 'test' });
    const p = parseTextPayload(res);
    expect(p.sections).toEqual([]);
    expect(p.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('append_draft_section UPSERTs and returns stored names', async () => {
    const r1 = parseTextPayload(await callTool(client, 'append_draft_section', {
      topic_slug: 'test', section_name: 'header', content: HEADER,
    }));
    expect(r1.stored).toEqual(['header']);

    const r2 = parseTextPayload(await callTool(client, 'append_draft_section', {
      topic_slug: 'test', section_name: 'key_findings', content: KEY_FINDINGS,
    }));
    expect(r2.stored).toEqual(['header', 'key_findings']); // canonical position order

    // rewrite the header — still 2 sections, content replaced
    const r3 = parseTextPayload(await callTool(client, 'append_draft_section', {
      topic_slug: 'test', section_name: 'header', content: HEADER + '\n\nextra',
    }));
    expect(r3.stored.sort()).toEqual(['header', 'key_findings']);
  });

  it('list_draft_sections returns content_preview in canonical order', async () => {
    await callTool(client, 'append_draft_section', { topic_slug: 't', section_name: 'sources', content: SOURCES });
    await callTool(client, 'append_draft_section', { topic_slug: 't', section_name: 'header', content: HEADER });
    await callTool(client, 'append_draft_section', { topic_slug: 't', section_name: 'background', content: BACKGROUND });

    const list = parseTextPayload(await callTool(client, 'list_draft_sections', { topic_slug: 't' }));
    expect(list.sections.map((s) => s.name)).toEqual(['header', 'background', 'sources']);
    expect(list.sections[0].content_preview.startsWith('# Test')).toBe(true);
  });

  it('save_report({assemble_from_drafts}) happy path: assembles, saves, clears', async () => {
    await callTool(client, 'append_draft_section', { topic_slug: 'asm', section_name: 'header', content: HEADER });
    await callTool(client, 'append_draft_section', { topic_slug: 'asm', section_name: 'key_findings', content: KEY_FINDINGS });
    await callTool(client, 'append_draft_section', { topic_slug: 'asm', section_name: 'sources', content: SOURCES });

    const res = await callTool(client, 'save_report', {
      topic_slug: 'asm',
      title: 'Test Briefing',
      assemble_from_drafts: true,
    });
    expect(res.isError).toBeUndefined();
    const p = parseTextPayload(res);
    expect(p.id).toMatch(/^\d{8}T\d{6}Z_asm$/);

    // drafts cleared
    const after = parseTextPayload(await callTool(client, 'list_draft_sections', { topic_slug: 'asm' }));
    expect(after.sections).toEqual([]);

    // report persisted
    const row = db.stmts.getReport.get(p.id);
    expect(row.title).toBe('Test Briefing');
    expect(row.summary).toMatch(/short summary/);
    expect(row.sources_json).toContain('example.com');
  });

  it('save_report({assemble_from_drafts}) keeps drafts when assembled body fails validation', async () => {
    // write sections that together LACK **TL;DR:** — validation will fail
    await callTool(client, 'append_draft_section', {
      topic_slug: 'bad', section_name: 'header',
      content: '# Missing TLDR\n\n**Date:** 2026-04-24',
    });
    await callTool(client, 'append_draft_section', {
      topic_slug: 'bad', section_name: 'key_findings', content: KEY_FINDINGS,
    });

    const before = db.stmts.countReports.get().n;
    const res = await callTool(client, 'save_report', {
      topic_slug: 'bad', title: 'Missing TLDR', assemble_from_drafts: true,
    });
    expect(res.isError).toBe(true);
    // no report added
    expect(db.stmts.countReports.get().n).toBe(before);
    // drafts still there for next attempt
    const still = parseTextPayload(await callTool(client, 'list_draft_sections', { topic_slug: 'bad' }));
    expect(still.sections.length).toBe(2);
  });

  it('save_report({assemble_from_drafts}) errors when nothing drafted', async () => {
    const res = await callTool(client, 'save_report', {
      topic_slug: 'empty', title: 'Nothing', assemble_from_drafts: true,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/no draft sections/);
  });

  it('drafts are isolated per slug — two parallel briefings do not collide', async () => {
    await callTool(client, 'append_draft_section', { topic_slug: 'one', section_name: 'header', content: HEADER });
    await callTool(client, 'append_draft_section', { topic_slug: 'two', section_name: 'header', content: HEADER });

    const r1 = parseTextPayload(await callTool(client, 'list_draft_sections', { topic_slug: 'one' }));
    const r2 = parseTextPayload(await callTool(client, 'list_draft_sections', { topic_slug: 'two' }));
    expect(r1.sections).toHaveLength(1);
    expect(r2.sections).toHaveLength(1);

    // finalizing one must not affect the other
    await callTool(client, 'append_draft_section', { topic_slug: 'one', section_name: 'key_findings', content: KEY_FINDINGS });
    await callTool(client, 'append_draft_section', { topic_slug: 'one', section_name: 'sources', content: SOURCES });
    const saved = await callTool(client, 'save_report', { topic_slug: 'one', title: 'One', assemble_from_drafts: true });
    expect(saved.isError).toBeUndefined();

    const r2after = parseTextPayload(await callTool(client, 'list_draft_sections', { topic_slug: 'two' }));
    expect(r2after.sections).toHaveLength(1);
  });

  it('resume flow: partial drafts + new session completes', async () => {
    // Session A: writes header + key_findings, then dies.
    await callTool(client, 'append_draft_section', { topic_slug: 'resume', section_name: 'header', content: HEADER });
    await callTool(client, 'append_draft_section', { topic_slug: 'resume', section_name: 'key_findings', content: KEY_FINDINGS });

    // Session B: lists what's there, writes only the missing bits.
    const seen = parseTextPayload(await callTool(client, 'list_draft_sections', { topic_slug: 'resume' }));
    const have = new Set(seen.sections.map((s) => s.name));
    expect(have.has('header')).toBe(true);
    expect(have.has('key_findings')).toBe(true);
    expect(have.has('sources')).toBe(false);

    await callTool(client, 'append_draft_section', { topic_slug: 'resume', section_name: 'background', content: BACKGROUND });
    await callTool(client, 'append_draft_section', { topic_slug: 'resume', section_name: 'sources', content: SOURCES });

    const saved = await callTool(client, 'save_report', { topic_slug: 'resume', title: 'Resume', assemble_from_drafts: true });
    expect(saved.isError).toBeUndefined();
    const payload = parseTextPayload(saved);
    expect(payload.id).toMatch(/_resume$/);
    // drafts cleared
    const after = parseTextPayload(await callTool(client, 'list_draft_sections', { topic_slug: 'resume' }));
    expect(after.sections).toEqual([]);
  });

  it('save_report with both markdown_body and assemble_from_drafts: assembly wins when set', async () => {
    await callTool(client, 'append_draft_section', { topic_slug: 'both', section_name: 'header', content: HEADER });
    await callTool(client, 'append_draft_section', { topic_slug: 'both', section_name: 'key_findings', content: KEY_FINDINGS });
    await callTool(client, 'append_draft_section', { topic_slug: 'both', section_name: 'sources', content: SOURCES });

    // Ignored body still has to pass the Zod min-100 length check; content doesn't matter
    // because assemble_from_drafts=true overrides it before validate() runs.
    const ignoredBody =
      '# Ignored Body\n\n' +
      '**TL;DR:** should be ignored because assemble wins over markdown_body input.\n' +
      'Lorem ipsum filler to satisfy the minimum length check. '.repeat(3);

    const res = await callTool(client, 'save_report', {
      topic_slug: 'both',
      title: 'Assembled',
      assemble_from_drafts: true,
      markdown_body: ignoredBody,
    });
    expect(res.isError).toBeUndefined();
    const p = parseTextPayload(res);
    const row = db.stmts.getReport.get(p.id);
    expect(row.title).toBe('Assembled');
    expect(row.summary).toMatch(/short summary/); // from drafts HEADER TL;DR
    expect(row.summary).not.toMatch(/ignored/i);
  });

  it('save_report without markdown_body or assemble_from_drafts errors clearly', async () => {
    const res = await callTool(client, 'save_report', { topic_slug: 'xx', title: 'Some title' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/markdown_body|assemble_from_drafts/);
  });
});
