import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT,
  word_count   INTEGER NOT NULL,
  sources_json TEXT NOT NULL,
  received_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_slug_received
  ON reports(slug, received_at DESC);

CREATE TABLE IF NOT EXISTS requests (
  id                   TEXT PRIMARY KEY,
  slug                 TEXT NOT NULL,
  request_text         TEXT NOT NULL,
  submitted_at         TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','fulfilled','cancelled')),
  fulfilled_report_id  TEXT REFERENCES reports(id) ON DELETE SET NULL,
  fulfilled_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_slug_status_submitted
  ON requests(slug, status, submitted_at);
`;

export function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return buildApi(db);
}

function buildApi(db) {
  const stmts = {
    insertReport: db.prepare(`
      INSERT INTO reports (id, slug, title, summary, word_count, sources_json, received_at)
      VALUES (@id, @slug, @title, @summary, @word_count, @sources_json, @received_at)
    `),
    listRecent: db.prepare(`
      SELECT id, slug, title, received_at, word_count
      FROM reports
      WHERE (@slug IS NULL OR slug = @slug)
      ORDER BY received_at DESC
      LIMIT @limit
    `),
    getReport: db.prepare(`
      SELECT id, slug, title, summary, received_at
      FROM reports WHERE id = ?
    `),
    countReports: db.prepare(`SELECT COUNT(*) AS n FROM reports`),
    slugSummary: db.prepare(`
      SELECT slug, COUNT(*) AS count, MAX(received_at) AS latest
      FROM reports GROUP BY slug ORDER BY latest DESC
    `),
    reportsPage: db.prepare(`
      SELECT id, slug, title, summary, received_at, word_count
      FROM reports
      WHERE (@slug IS NULL OR slug = @slug)
      ORDER BY received_at DESC
      LIMIT @limit OFFSET @offset
    `),

    insertRequest: db.prepare(`
      INSERT INTO requests (id, slug, request_text, submitted_at, status)
      VALUES (@id, @slug, @request_text, @submitted_at, 'pending')
    `),
    pendingRequestsForSlug: db.prepare(`
      SELECT id, slug, request_text, submitted_at
      FROM requests
      WHERE slug = ? AND status = 'pending'
      ORDER BY submitted_at ASC
    `),
    getRequest: db.prepare(`SELECT * FROM requests WHERE id = ?`),
    cancelRequest: db.prepare(`
      UPDATE requests SET status = 'cancelled'
      WHERE id = ? AND status = 'pending'
    `),
    fulfillRequest: db.prepare(`
      UPDATE requests
      SET status = 'fulfilled',
          fulfilled_report_id = @report_id,
          fulfilled_at = @fulfilled_at
      WHERE id = @id AND status = 'pending' AND slug = @slug
    `),
    listRequests: db.prepare(`
      SELECT id, slug, request_text, submitted_at, status, fulfilled_report_id, fulfilled_at
      FROM requests
      WHERE (@status IS NULL OR status = @status)
        AND (@slug IS NULL OR slug = @slug)
      ORDER BY submitted_at DESC
      LIMIT @limit
    `),
  };

  const saveReportWithRequests = db.transaction((reportRow, requestIds) => {
    stmts.insertReport.run(reportRow);
    const fulfilled = [];
    if (requestIds && requestIds.length) {
      const fulfilled_at = reportRow.received_at;
      for (const rid of requestIds) {
        const info = stmts.fulfillRequest.run({
          id: rid,
          slug: reportRow.slug,
          report_id: reportRow.id,
          fulfilled_at,
        });
        if (info.changes !== 1) {
          throw new Error(
            `request ${rid} is not pending or does not belong to slug "${reportRow.slug}"`
          );
        }
        fulfilled.push(rid);
      }
    }
    return fulfilled;
  });

  return {
    raw: db,
    stmts,
    close: () => db.close(),
    saveReportWithRequests,
  };
}
