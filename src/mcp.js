import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';

import { validate, extractTitle, extractTldr, extractSources, wordCount } from './markdown.js';
import { renderMarkdownToPdf } from './pdf.js';
import { SECTION_POSITIONS, positionFor, utcDay } from './db.js';

const SECTION_NAMES = Object.keys(SECTION_POSITIONS);

const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'topic_slug must be kebab-case, 1-64 chars');

export function buildMcpServer({ db, archive, publicBaseUrl, notifier }) {
  const server = new McpServer(
    { name: 'the-dispatch', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'save_report',
    {
      title: 'File a completed research dispatch',
      description:
        'Persist a markdown briefing to the Dispatch archive. Returns an ID, a URL to ' +
        'read it in the dashboard, word count, and which queued request_ids were fulfilled. ' +
        'The markdown body MUST start with "# <title>" and include a "**TL;DR:**" marker.',
      inputSchema: {
        topic_slug: slugSchema.describe(
          "Kebab-case topic identifier, e.g. 'agent-engineering'"
        ),
        title: z.string().min(3).max(200).describe('Descriptive briefing title'),
        markdown_body: z
          .string()
          .min(100)
          .max(200_000)
          .optional()
          .describe(
            'Full markdown body, starting with "# " and containing "**TL;DR:**". ' +
              'Required UNLESS assemble_from_drafts is true.'
          ),
        assemble_from_drafts: z
          .boolean()
          .optional()
          .describe(
            'If true, the server reads all draft_sections for (topic_slug, today UTC), ' +
              'sorts by canonical position, concatenates into markdown_body, and on success ' +
              'deletes those drafts in the same transaction as the report insert. Use this ' +
              'as the last step of a routine that built the briefing via append_draft_section.'
          ),
        sources: z
          .array(z.string().url())
          .optional()
          .describe('Source URLs cited. If omitted, URLs are extracted from the markdown.'),
        request_ids: z
          .array(z.string())
          .optional()
          .describe(
            'IDs returned by next_request. All are marked fulfilled atomically with this save. ' +
              'If any id is invalid/already-fulfilled/mismatched-slug, the whole call fails.'
          ),
      },
    },
    async (args) => saveReport(args, { db, archive, publicBaseUrl, notifier })
  );

  server.registerTool(
    'append_draft_section',
    {
      title: 'Incrementally save one section of a briefing',
      description:
        'UPSERTs one section of an in-progress briefing to the server, keyed by (topic_slug, today UTC, section_name). ' +
        'Call once per section during step 4 of the routine. If a stream timeout kills the session, sections ' +
        'already appended survive — the next run can list_draft_sections to see what was done and pick up. ' +
        'When all sections are present, call save_report({ assemble_from_drafts: true, ... }).',
      inputSchema: {
        topic_slug: slugSchema,
        section_name: z
          .enum(SECTION_NAMES)
          .describe(
            'Canonical section name. Deep briefings use: header, key_findings, background, ' +
              'analysis_1..analysis_6, whats_new, open_questions, sources. World snapshots use: ' +
              'header, geopolitics, markets, tech_science, business_policy, science_research, ' +
              'future_trends, finance_global, regional_asia, regional_africa, regional_latam, ' +
              'regional_mena, offbeat, one_to_read, sources.'
          ),
        content: z
          .string()
          .min(1)
          .max(30_000)
          .describe('Full markdown for this section, including its own heading (## or ###).'),
      },
    },
    async ({ topic_slug, section_name, content }) => {
      const day = utcDay();
      const now = new Date().toISOString();
      db.stmts.upsertDraft.run({
        slug: topic_slug,
        day,
        name: section_name,
        position: positionFor(section_name),
        content,
        updated_at: now,
      });
      const stored = db.stmts
        .listDrafts.all({ slug: topic_slug, day })
        .map((r) => r.name);
      return ok({ slug: topic_slug, day, section_name, stored });
    }
  );

  server.registerTool(
    'list_draft_sections',
    {
      title: 'List sections already saved for an in-progress briefing',
      description:
        'Returns the sections written so far for (topic_slug, today UTC). Call this at the ' +
        'start of a routine run to detect and resume an incomplete previous run. Response is ' +
        '{ day, sections: [{ name, position, updated_at, content_preview }] }; empty array means ' +
        'no draft exists — start fresh.',
      inputSchema: { topic_slug: slugSchema },
    },
    async ({ topic_slug }) => {
      const day = utcDay();
      const sections = db.stmts.listDrafts.all({ slug: topic_slug, day });
      return ok({ day, sections });
    }
  );

  server.registerTool(
    'list_recent_reports',
    {
      title: 'List recently filed dispatches',
      description: 'Returns the most recent reports, optionally filtered by topic_slug.',
      inputSchema: {
        topic_slug: slugSchema.optional(),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ topic_slug = null, limit = 10 }) => {
      const rows = db.stmts.listRecent.all({ slug: topic_slug, limit });
      return ok(rows.map((r) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        received_at: r.received_at,
        word_count: r.word_count,
      })));
    }
  );

  server.registerTool(
    'get_report_summary',
    {
      title: 'Fetch the summary of a prior dispatch',
      description: 'Returns id/title/summary/received_at/slug for the given report id.',
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const row = db.stmts.getReport.get(id);
      if (!row) return err(`no report with id "${id}"`);
      return ok({
        id: row.id,
        title: row.title,
        summary: row.summary,
        received_at: row.received_at,
        slug: row.slug,
      });
    }
  );

  server.registerTool(
    'next_request',
    {
      title: 'Read pending user-queued requests for a topic',
      description:
        'Returns all pending request items for the given topic_slug, oldest first. ' +
        'Items are NOT consumed by this call. To mark them fulfilled, pass their ids ' +
        'in save_report({ request_ids: [...] }) — consumption is transactional with the save.',
      inputSchema: { topic_slug: slugSchema },
    },
    async ({ topic_slug }) => {
      const rows = db.stmts.pendingRequestsForSlug.all(topic_slug);
      return ok(rows.map((r) => ({
        id: r.id,
        request_text: r.request_text,
        submitted_at: r.submitted_at,
      })));
    }
  );

  return server;
}

async function saveReport(args, { db, archive, publicBaseUrl, notifier }) {
  // Resolve the markdown body: either the caller passed it, or assemble from
  // draft_sections on the server.
  let markdown_body = args.markdown_body;
  let assembleDay = null;

  if (args.assemble_from_drafts) {
    assembleDay = utcDay();
    const rows = db.stmts.readDraftsForAssembly.all({ slug: args.topic_slug, day: assembleDay });
    if (rows.length === 0) {
      return err(
        `assemble_from_drafts: no draft sections for slug "${args.topic_slug}" today (${assembleDay}). ` +
          'Call append_draft_section first.'
      );
    }
    markdown_body = rows.map((r) => r.content.replace(/\s+$/, '')).join('\n\n') + '\n';
  }

  if (!markdown_body) {
    return err(
      'either markdown_body or assemble_from_drafts=true is required'
    );
  }

  const v = validate(markdown_body);
  if (!v.ok) return err(v.reason);

  const extractedTitle = extractTitle(markdown_body);
  if (!extractedTitle) return err('could not extract title from "# " line');
  const summary = extractTldr(markdown_body);

  const id = buildReportId(args.topic_slug);
  const received_at = id.slice(0, 4) + '-' + id.slice(4, 6) + '-' + id.slice(6, 8) +
    'T' + id.slice(9, 11) + ':' + id.slice(11, 13) + ':' + id.slice(13, 15) + 'Z';

  const sources = Array.isArray(args.sources) && args.sources.length
    ? dedupe(args.sources)
    : extractSources(markdown_body);

  let pdfBytes;
  try {
    pdfBytes = await renderMarkdownToPdf(markdown_body, { title: extractedTitle });
  } catch (e) {
    return err(`pdf render failed: ${e.message}`);
  }

  const reportRow = {
    id,
    slug: args.topic_slug,
    title: args.title,
    summary,
    word_count: wordCount(markdown_body),
    sources_json: JSON.stringify(sources),
    received_at,
  };

  let fulfilled;
  try {
    fulfilled = db.saveReportWithRequests(
      reportRow,
      args.request_ids ?? [],
      assembleDay ? { clearDraftsFor: { slug: args.topic_slug, day: assembleDay } } : {}
    );
  } catch (e) {
    return err(`db transaction failed: ${e.message}`);
  }

  try {
    archive.writeReport(id, markdown_body, pdfBytes);
  } catch (e) {
    return err(`archive write failed after db commit: ${e.message}`);
  }

  const reportUrl = `${publicBaseUrl.replace(/\/+$/, '')}/report/${id}`;

  // Fire-and-forget notification. Errors are logged, never propagated.
  if (notifier?.enabled) {
    notifier.notify({
      id,
      url: reportUrl,
      slug: args.topic_slug,
      title: args.title,
      summary,
      word_count: reportRow.word_count,
    });
  }

  return ok({
    id,
    url: reportUrl,
    word_count: reportRow.word_count,
    sources_count: sources.length,
    fulfilled_request_ids: fulfilled,
  });
}

function buildReportId(slug) {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  return `${stamp}_${slug}`;
}

function newRequestId() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  return `req_${stamp}_${randomBytes(3).toString('hex')}`;
}

function dedupe(arr) {
  return [...new Set(arr)];
}

function ok(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function err(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export { newRequestId };

export function buildMcpTransport() {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
}
