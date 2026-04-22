import 'dotenv/config';
import express from 'express';
import basicAuth from 'express-basic-auth';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { openDb } from './db.js';
import { createArchive } from './archive.js';
import { buildMcpServer, buildMcpTransport } from './mcp.js';
import { mcpAuthMiddleware } from './auth.js';
import { buildApiRouter } from './api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const env = {
  PORT: parseInt(process.env.PORT || '8787', 10),
  MCP_BEARER_TOKEN: required('MCP_BEARER_TOKEN'),
  MCP_CLIENT_TOKEN: required('MCP_CLIENT_TOKEN'),
  MCP_CLIENT_NAME: process.env.MCP_CLIENT_NAME || 'cli',
  MCP_EXPECTED_HOST: required('MCP_EXPECTED_HOST'),
  DASHBOARD_USER: required('DASHBOARD_USER'),
  DASHBOARD_PASS: required('DASHBOARD_PASS'),
  DB_PATH: process.env.DB_PATH || join(ROOT, 'reports.db'),
  ARCHIVE_DIR: process.env.ARCHIVE_DIR || join(ROOT, 'archive'),
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8787}`,
};

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const db = openDb(env.DB_PATH);
  const archive = createArchive(env.ARCHIVE_DIR);

  const app = express();
  app.disable('x-powered-by');

  // MCP endpoint: bearer + Host, no basic-auth. Stateless transport —
  // new McpServer + new StreamableHTTPServerTransport per request.
  const mcpAuth = mcpAuthMiddleware({
    routineToken: env.MCP_BEARER_TOKEN,
    clientToken: env.MCP_CLIENT_TOKEN,
    clientName: env.MCP_CLIENT_NAME,
    expectedHost: env.MCP_EXPECTED_HOST,
  });

  const mcpPost = async (req, res) => {
    console.log(
      `[mcp] POST client=${req.mcpClient} body-bytes=${req.headers['content-length'] || 0}`
    );
    const server = buildMcpServer({ db, archive, publicBaseUrl: env.PUBLIC_BASE_URL });
    const transport = buildMcpTransport();
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('[mcp] handler error', e);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'internal error' },
          id: null,
        });
      }
    }
  };

  app.post('/mcp', mcpAuth, express.json({ limit: '1mb' }), mcpPost);
  app.get('/mcp', mcpAuth, (req, res) => {
    res
      .status(405)
      .set('Allow', 'POST')
      .json({ jsonrpc: '2.0', error: { code: -32000, message: 'method not allowed' }, id: null });
  });
  app.delete('/mcp', mcpAuth, (req, res) => {
    res
      .status(405)
      .set('Allow', 'POST')
      .json({ jsonrpc: '2.0', error: { code: -32000, message: 'method not allowed' }, id: null });
  });

  // Dashboard + JSON APIs: basic-auth.
  const dashboardAuth = basicAuth({
    users: { [env.DASHBOARD_USER]: env.DASHBOARD_PASS },
    challenge: true,
    realm: 'The Dispatch',
  });
  app.use('/api', dashboardAuth);
  app.use('/report', dashboardAuth);
  app.use('/', (req, res, next) => {
    if (req.path.startsWith('/mcp') || req.path.startsWith('/api') || req.path.startsWith('/report')) {
      return next();
    }
    return dashboardAuth(req, res, next);
  });

  app.use(buildApiRouter({ db, archive }));
  app.use(express.static(join(ROOT, 'public'), { index: 'index.html', maxAge: '5m' }));

  // SPA deep link: /report/:id  (no .pdf/.md suffix) → serve SPA shell.
  app.get(/^\/report\/[A-Za-z0-9_:\-]+$/, (req, res) => {
    res.sendFile(join(ROOT, 'public', 'index.html'));
  });

  const server = app.listen(env.PORT, () => {
    console.log(`[dispatch] listening on :${env.PORT}`);
    console.log(`[dispatch] mcp host expected: ${env.MCP_EXPECTED_HOST}`);
    console.log(`[dispatch] mcp clients: routine (${env.MCP_BEARER_TOKEN.slice(0, 6)}…) + ${env.MCP_CLIENT_NAME} (${env.MCP_CLIENT_TOKEN.slice(0, 6)}…)`);
  });

  const shutdown = (sig) => {
    console.log(`[dispatch] ${sig} → shutting down`);
    server.close(() => {
      try { db.close(); } catch {}
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
