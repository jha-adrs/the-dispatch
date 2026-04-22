import express from 'express';
import { newRequestId } from './mcp.js';

export function buildApiRouter({ db, archive }) {
  const router = express.Router();

  router.get('/api/stats', (req, res) => {
    const { n } = db.stmts.countReports.get();
    const slugs = db.stmts.slugSummary.all();
    const pending = db.raw
      .prepare(`SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'`)
      .get().n;
    res.json({
      report_count: n,
      topic_count: slugs.length,
      pending_request_count: pending,
      latest: slugs[0]?.latest ?? null,
    });
  });

  router.get('/api/slugs', (req, res) => {
    const slugs = db.stmts.slugSummary.all();
    const pending = db.raw
      .prepare(
        `SELECT slug, COUNT(*) AS n FROM requests WHERE status='pending' GROUP BY slug`
      )
      .all();
    const pMap = Object.fromEntries(pending.map((r) => [r.slug, r.n]));
    res.json(
      slugs.map((s) => ({
        slug: s.slug,
        count: s.count,
        latest: s.latest,
        pending: pMap[s.slug] ?? 0,
      }))
    );
  });

  router.get('/api/reports', (req, res) => {
    const slug = req.query.slug || null;
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);
    const offset = parseInt(req.query.offset ?? '0', 10) || 0;
    const rows = db.stmts.reportsPage.all({ slug, limit, offset });
    res.json(rows);
  });

  router.get('/api/report/:id', (req, res) => {
    const row = db.stmts.getReport.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    const markdown = archive.readMarkdown(req.params.id);
    if (markdown === null) {
      return res.status(410).json({ error: 'archive file missing' });
    }
    res.json({ ...row, markdown });
  });

  router.get('/report/:id.pdf', (req, res) => {
    const pdf = archive.readPdf(req.params.id);
    if (!pdf) return res.status(404).send('not found');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${req.params.id}.pdf"`
    );
    res.send(pdf);
  });

  router.get('/report/:id.md', (req, res) => {
    const md = archive.readMarkdown(req.params.id);
    if (md === null) return res.status(404).send('not found');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${req.params.id}.md"`
    );
    res.send(md);
  });

  router.get('/api/requests', (req, res) => {
    const status = req.query.status || null;
    const slug = req.query.slug || null;
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 500);
    const rows = db.stmts.listRequests.all({ status, slug, limit });
    res.json(rows);
  });

  router.post('/api/requests', express.json(), (req, res) => {
    const { slug, request_text } = req.body || {};
    if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
      return res.status(400).json({ error: 'invalid slug' });
    }
    if (typeof request_text !== 'string' || request_text.trim().length < 3) {
      return res
        .status(400)
        .json({ error: 'request_text must be a non-empty string (min 3 chars)' });
    }
    if (request_text.length > 2000) {
      return res.status(400).json({ error: 'request_text too long (max 2000)' });
    }
    const id = newRequestId();
    const submitted_at = new Date().toISOString();
    db.stmts.insertRequest.run({
      id,
      slug,
      request_text: request_text.trim(),
      submitted_at,
    });
    res.status(201).json({ id, slug, request_text: request_text.trim(), submitted_at, status: 'pending' });
  });

  router.delete('/api/requests/:id', (req, res) => {
    const info = db.stmts.cancelRequest.run(req.params.id);
    if (info.changes !== 1) {
      return res.status(404).json({ error: 'not pending (cancelled, fulfilled, or missing)' });
    }
    res.json({ id: req.params.id, status: 'cancelled' });
  });

  return router;
}
