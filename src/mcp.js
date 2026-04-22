import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';

import { validate, extractTitle, extractTldr, extractSources, wordCount } from './markdown.js';
import { renderMarkdownToPdf } from './pdf.js';

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
          .describe('Full markdown body, starting with "# " and containing "**TL;DR:**"'),
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
  const v = validate(args.markdown_body);
  if (!v.ok) return err(v.reason);

  const extractedTitle = extractTitle(args.markdown_body);
  if (!extractedTitle) return err('could not extract title from "# " line');
  const summary = extractTldr(args.markdown_body);

  const id = buildReportId(args.topic_slug);
  const received_at = id.slice(0, 4) + '-' + id.slice(4, 6) + '-' + id.slice(6, 8) +
    'T' + id.slice(9, 11) + ':' + id.slice(11, 13) + ':' + id.slice(13, 15) + 'Z';

  const sources = Array.isArray(args.sources) && args.sources.length
    ? dedupe(args.sources)
    : extractSources(args.markdown_body);

  let pdfBytes;
  try {
    pdfBytes = await renderMarkdownToPdf(args.markdown_body, { title: extractedTitle });
  } catch (e) {
    return err(`pdf render failed: ${e.message}`);
  }

  const reportRow = {
    id,
    slug: args.topic_slug,
    title: args.title,
    summary,
    word_count: wordCount(args.markdown_body),
    sources_json: JSON.stringify(sources),
    received_at,
  };

  let fulfilled;
  try {
    fulfilled = db.saveReportWithRequests(reportRow, args.request_ids ?? []);
  } catch (e) {
    return err(`db transaction failed: ${e.message}`);
  }

  try {
    archive.writeReport(id, args.markdown_body, pdfBytes);
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
